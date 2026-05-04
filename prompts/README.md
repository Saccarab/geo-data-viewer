# Analysis Prompts

LLM prompts used during the v1 study's data enrichment / analysis phase. These are NOT the user-facing study queries — those live in `datapass/bing_prompts_input.csv` (or are baked into the database).

## Active in production pipeline

| File | Purpose |
|---|---|
| `page_label_dna_only_v1.txt` | Page-labeling prompt — classifies a scraped web page (URL + title + snippet/meta only, no full text) into types like `listicle`, `product_page`, `news_article`, etc. Returns strict JSON. Used by `scripts/llm/enrich_*.mjs` in the main repo. |

## Drafts (under `drafts/`)

These prompts were written for specific analysis tasks but were either rendered for inspection only or remained experimental. Not all of them ran against an LLM in the final pipeline.

| File | Task |
|---|---|
| `drafts/listicle_selection_omission_analysis_v1.txt` | Task A — listicle selection / omission (uptake) |
| `drafts/listicle_bias_uptake_analysis_v1.txt` | Task A2 — listicle bias / rank uptake / dismissal signals |
| `drafts/listicle_fidelity_verification_chunks_v1.txt` | Task B — listicle fidelity / groundedness verification |
| `drafts/semantic_verification_listicle_chunks_v1.txt` | Strict citation verifier for listicle chunks |
| `drafts/semantic_verification_per_url_batch.txt` | Strict citation verifier per URL (batch mode) |

## How they were used

The labeler runs against either OpenAI's API or Google's Gemini API depending on which enrichment script is invoked (see the `scripts/llm/enrich_*` family in the source repo). The prompt text is read directly from these files and concatenated with the per-page input data.
