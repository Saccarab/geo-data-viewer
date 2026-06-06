"""
Normalize URLs and compute citation overlap with Bing / Google.

For one tier of one wave: takes the ChatGPT scraper CSV (cited links), the Bing
scrape CSV, and the SerpApi Google results folder, and reports what share of the
cited links appear in Bing, in Google, in either (coverage), or neither (invisible).

URL normalization is the SAME rule used for the v1 (January) study, so numbers are
comparable across waves: lowercase, strip protocol + www, drop the query string and
fragment, drop a trailing slash.  (e.g. https://www.example.com/page?id=5#x -> example.com/page)

Usage:
  python normalize_and_match.py \
      --chatgpt chatgpt_results_business.csv \
      --bing bing_results_business.csv \
      --google-dir data/serpapi_v3_google_results \
      --account business \
      [--out matches.csv]
"""
import csv, json, re, os, argparse
from collections import defaultdict

csv.field_size_limit(2**31 - 1)


def normalize_url(u):
    """v1-consistent normalization (matches the original study's build step)."""
    if not u:
        return ""
    u = str(u).lower().strip()
    u = u.replace("https://", "").replace("http://", "").replace("www.", "")
    u = u.split("?")[0].split("#")[0]
    if u.endswith("/"):
        u = u[:-1]
    return u


def pad(pid):
    return "P" + pid[1:].zfill(4) if pid.startswith("P") and pid[1:].isdigit() else pid


def base_run(rid):
    # Bing CSV run_ids may carry a query suffix like P0001_r1_q1 -> P0001_r1
    return re.sub(r"_q\d+$", "", rid or "")


def load_bing(path):
    """run_id -> set of normalized URLs."""
    idx = defaultdict(set)
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            rid = base_run(r.get("run_id", ""))
            u = normalize_url(r.get("url", ""))
            if u and rid:
                idx[rid].add(u)
    return idx


def load_google(results_dir, account):
    """chatgpt_run_id -> set of normalized URLs, for the given account tier."""
    idx = defaultdict(set)
    for fn in os.listdir(results_dir):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(results_dir, fn), encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        info = data.get("_query_info", {})
        if info.get("account_type") != account:
            continue
        rid = info.get("chatgpt_run_id", "")
        for r in (data.get("organic_results") or []):
            u = normalize_url(r.get("url") or r.get("link") or "")
            if u and rid:
                idx[rid].add(u)
    return idx


def main():
    ap = argparse.ArgumentParser(description="Compute citation overlap vs Bing/Google.")
    ap.add_argument("--chatgpt", required=True, help="ChatGPT scraper CSV for this tier")
    ap.add_argument("--bing", required=True, help="Bing scrape CSV for this tier")
    ap.add_argument("--google-dir", required=True, help="SerpApi Google results folder")
    ap.add_argument("--account", required=True, choices=["business", "plus"])
    ap.add_argument("--out", help="optional per-citation match CSV")
    a = ap.parse_args()

    bing = load_bing(a.bing)
    goog = load_google(a.google_dir, a.account)

    rows = []
    tot = binhit = goohit = union = 0
    with open(a.chatgpt, encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            rid = f"{pad(r['prompt_id'])}_r{r['run_number']}"
            cited = {
                normalize_url(x.get("url", ""))
                for x in json.loads(r.get("sources_cited_json", "[]") or "[]")
                if isinstance(x, dict) and x.get("url")
            }
            cited.discard("")
            if not cited:
                continue
            b = bing.get(rid, set())
            g = goog.get(rid, set())
            if not b and not g:
                continue  # no baseline scraped for this run — not comparable
            for cu in cited:
                inb, ing = cu in b, cu in g
                tot += 1
                binhit += inb
                goohit += ing
                union += inb or ing
                if a.out:
                    rows.append({"run_id": rid, "url": cu,
                                 "in_bing": int(inb), "in_google": int(ing),
                                 "covered": int(inb or ing)})

    if not tot:
        print("No comparable cited URLs found (no baseline scrape matched any run).")
        return
    print(f"cited URLs (runs with a baseline): {tot}")
    print(f"  in Bing:                {100*binhit/tot:5.1f}%")
    print(f"  in Google:              {100*goohit/tot:5.1f}%")
    print(f"  covered (Bing OR Google): {100*union/tot:5.1f}%")
    print(f"  invisible (neither):    {100*(tot-union)/tot:5.1f}%")
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["run_id", "url", "in_bing", "in_google", "covered"])
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {len(rows)} rows -> {a.out}")


if __name__ == "__main__":
    main()
