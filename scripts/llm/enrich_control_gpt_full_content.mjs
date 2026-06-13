// Re-enrichment of GPT-5 mini labels without the 10,000-char truncation.
//
// Scope:
//   - Only URLs that the original pass labelled as `listicle` or `product_page`
//     (other page types are out of the regression scope).
//   - Of those, only URLs whose saved `.txt` body exceeds 10,000 chars after
//     whitespace collapse — the ones the original run actually truncated.
//   URLs under that threshold already have valid full-content labels in the
//   existing `page_labels_control_gpt5_mini.jsonl` and are not re-processed.
//
// Safety cap: content is capped at 400,000 chars (~100k tokens) before being
// sent to the model — effectively no practical truncation for normal web
// content (only 25 files in the fetched_content pool exceed this), while
// preventing pathological edge cases (multi-MB documentation dumps) from
// crashing the run with context-window errors.
//
// Output: `datapass/page_labels_control_gpt5_mini_full_content.jsonl`.
// Does NOT overwrite the existing labels file. After the run, the new labels
// can be merged on top of the original file (new label wins on URL match).
//
// Usage:
//   OPEN_AI_KEY=... node scripts/llm/enrich_control_gpt_full_content.mjs
//
// Env overrides:
//   REPROCESS_ALL=1     Re-process every in-scope URL, not just truncated.
//   CONTENT_CAP=<N>     Override the 400,000-char safety cap.
//   INCLUDE_TYPES=...   Comma-separated page types to include
//                       (default: "listicle,product_page").

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Bottleneck from 'bottleneck';
import OpenAI from 'openai';

const CONFIG = {
    rerunQueuePath: 'data/enrichment/drift_enrichment_queue.csv',
    originalLabelsPath: 'datapass/page_labels_control_gpt5_mini.jsonl',
    outJsonlPath: 'datapass/page_labels_control_gpt5_mini_full_content.jsonl',
    promptPath: 'prompts/page_label_dna_only_v1.txt',
    contentDir: 'data/fetched_content',
    concurrency: 20,
    minTime: 50,
    model: 'gpt-5-mini',
    oldTruncationLimit: 10000,
    contentCap: parseInt(process.env.CONTENT_CAP || '400000', 10),
    reprocessAll: process.env.REPROCESS_ALL === '1',
    includeTypes: (process.env.INCLUDE_TYPES || 'listicle,product_page').split(',').map((s) => s.trim()),
    skipDomains: [
        'wikipedia.org', 'reddit.com', 'arxiv.org', 'github.com', 'youtube.com', 'youtu.be',
        'apple.com', 'apps.apple.com', 'microsoft.com', 'microsoftstore.com',
        'chrome.google.com', 'chromewebstore.google.com', 'play.google.com',
        'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
        'google.com', 'apps.microsoft.com', 'support.microsoft.com', 'support.apple.com',
        'support.google.com',
    ],
};

function shortHash(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function normalizeUrlKey(rawUrl) {
    if (!rawUrl) return '';
    let url = rawUrl.trim();
    if (!url.includes('://')) url = `https://${url}`;
    try {
        const p = new URL(url);
        let host = (p.hostname || '').toLowerCase();
        if (host.startsWith('www.')) host = host.slice(4);
        let pathname = p.pathname || '/';
        if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        const dropExact = new Set(['gclid', 'fbclid', 'msclkid', 'yclid', 'mc_cid', 'mc_eid', 'igshid']);
        const kept = [];
        for (const [k, v] of p.searchParams.entries()) {
            const lk = k.toLowerCase();
            if (lk.startsWith('utm_') || dropExact.has(lk)) continue;
            kept.push([k, v]);
        }
        const q = new URLSearchParams(kept).toString();
        return `${host}${pathname}${q ? `?${q}` : ''}`;
    } catch {
        return rawUrl.toLowerCase();
    }
}

const limiter = new Bottleneck({
    maxConcurrent: CONFIG.concurrency,
    minTime: CONFIG.minTime,
});

async function gptCall(prompt) {
    const openai = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });
    const completion = await openai.chat.completions.create({
        model: CONFIG.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 1,
    });
    return JSON.parse(completion.choices[0].message.content);
}

function sanitize(rawContent) {
    return rawContent.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}

async function main() {
    if (!process.env.OPEN_AI_KEY) {
        console.error('❌ OPEN_AI_KEY environment variable is not set.');
        process.exit(1);
    }

    // 1. Load the queue
    if (!fs.existsSync(CONFIG.rerunQueuePath)) {
        console.error(`❌ Queue file not found at ${CONFIG.rerunQueuePath}`);
        process.exit(1);
    }
    let allUrls = [];
    if (CONFIG.rerunQueuePath.endsWith('.csv')) {
        const csvContent = fs.readFileSync(CONFIG.rerunQueuePath, 'utf8');
        allUrls = csvContent.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    } else {
        allUrls = JSON.parse(fs.readFileSync(CONFIG.rerunQueuePath, 'utf8'));
    }

    // 2. Already processed in THIS (full-content) output file -> resume-safe
    const alreadyDone = new Set();
    if (fs.existsSync(CONFIG.outJsonlPath)) {
        for (const line of fs.readFileSync(CONFIG.outJsonlPath, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const d = JSON.parse(line);
                if (d.url) alreadyDone.add(d.url);
            } catch {}
        }
    }

    // 2b. Load original labels to filter by page type (listicle / product_page only)
    const typeByUrl = new Map();
    if (fs.existsSync(CONFIG.originalLabelsPath)) {
        for (const line of fs.readFileSync(CONFIG.originalLabelsPath, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const d = JSON.parse(line);
                if (!d?.ok) continue;
                const url = d.url;
                const t = d?.response?.urls?.type;
                if (url && t) typeByUrl.set(url, t);
            } catch {}
        }
    } else {
        console.warn(`⚠️  original labels not found at ${CONFIG.originalLabelsPath}; cannot filter by page type.`);
    }

    // 3. Filter: in-scope page types, truncated content (unless REPROCESS_ALL=1)
    const typeSet = new Set(CONFIG.includeTypes);
    const toProcess = [];
    const stats = {
        skipped_done: 0,
        skipped_domain: 0,
        skipped_out_of_scope_type: 0,
        skipped_no_original_label: 0,
        skipped_no_content: 0,
        skipped_short: 0,
    };
    for (const u of allUrls) {
        const raw = u.toLowerCase().trim();
        const norm = normalizeUrlKey(u);
        if (alreadyDone.has(raw) || alreadyDone.has(norm)) { stats.skipped_done++; continue; }

        try {
            const domain = new URL(u).hostname.toLowerCase().replace('www.', '');
            if (CONFIG.skipDomains.some((d) => domain === d || domain.endsWith('.' + d))) {
                stats.skipped_domain++;
                continue;
            }
        } catch {
            continue;
        }

        // Restrict to URLs the original pass labelled as one of the in-scope types
        const origType = typeByUrl.get(u);
        if (!origType) { stats.skipped_no_original_label++; continue; }
        if (!typeSet.has(origType)) { stats.skipped_out_of_scope_type++; continue; }

        const hash = shortHash(norm);
        const contentPath = path.join(CONFIG.contentDir, `${hash}.txt`);
        if (!fs.existsSync(contentPath)) {
            stats.skipped_no_content++;
            continue;
        }

        if (!CONFIG.reprocessAll) {
            const rawContent = fs.readFileSync(contentPath, 'utf8');
            const sanitizedLen = sanitize(rawContent).length;
            if (sanitizedLen <= CONFIG.oldTruncationLimit) {
                stats.skipped_short++;
                continue;
            }
        }

        toProcess.push({ url: u, norm, hash, contentPath, origType });
    }

    console.log(`🧪 GPT-5 mini re-enrichment (full content, cap=${CONFIG.contentCap} chars)`);
    console.log(`   Include page types: ${CONFIG.includeTypes.join(', ')}`);
    console.log(`   Queue size:   ${allUrls.length}`);
    console.log(`   Already done: ${stats.skipped_done}`);
    console.log(`   Skipped domain: ${stats.skipped_domain}`);
    console.log(`   Skipped no original label: ${stats.skipped_no_original_label}`);
    console.log(`   Skipped out-of-scope type: ${stats.skipped_out_of_scope_type}`);
    console.log(`   Skipped no content: ${stats.skipped_no_content}`);
    console.log(`   Skipped short (≤${CONFIG.oldTruncationLimit} chars, original label valid): ${stats.skipped_short}`);
    console.log(`   To process:   ${toProcess.length}`);
    console.log(`   Mode: ${CONFIG.reprocessAll ? 'REPROCESS_ALL' : 'truncated URLs only'}`);

    if (toProcess.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    const promptTemplate = fs.readFileSync(CONFIG.promptPath, 'utf8');

    const tasks = toProcess.map(({ url, contentPath }) =>
        limiter.schedule(async () => {
            try {
                const rawContent = fs.readFileSync(contentPath, 'utf8');
                const sanitizedContent = sanitize(rawContent).slice(0, CONFIG.contentCap);
                const origChars = sanitize(rawContent).length;

                const prompt = promptTemplate
                    .replace(/\{URL\}/g, url)
                    .replace(/\{TITLE\}/g, 'N/A')
                    .replace(/\{SNIPPET_OR_META_DESCRIPTION\}/g, 'N/A')
                    .replace(/\{EXTRACTED_TEXT\}/g, sanitizedContent)
                    .replace('{{URL}}', url)
                    .replace('{{CONTENT}}', sanitizedContent);

                const response = await gptCall(prompt);
                const result = {
                    url,
                    ok: true,
                    response,
                    model: CONFIG.model,
                    timestamp: new Date().toISOString(),
                    chars_sent: sanitizedContent.length,
                    chars_available: origChars,
                    hit_content_cap: origChars > CONFIG.contentCap,
                };
                fs.appendFileSync(CONFIG.outJsonlPath, JSON.stringify(result) + '\n');
                const doneCount = fs.readFileSync(CONFIG.outJsonlPath, 'utf8').split('\n').filter(Boolean).length;
                console.log(`[${doneCount}/${toProcess.length}] ok chars=${sanitizedContent.length}${result.hit_content_cap ? ' [CAPPED]' : ''} ${url}`);
            } catch (err) {
                const result = {
                    url,
                    ok: false,
                    error: String(err?.message || err),
                    model: CONFIG.model,
                    timestamp: new Date().toISOString(),
                };
                fs.appendFileSync(CONFIG.outJsonlPath, JSON.stringify(result) + '\n');
                console.error(`FAIL ${url}: ${err.message}`);
            }
        })
    );

    console.log(`🚀 Processing with concurrency ${CONFIG.concurrency}, minTime ${CONFIG.minTime}ms`);
    await Promise.all(tasks);
    console.log('\n🏁 Re-enrichment complete.');
}

main().catch(console.error);
