"""
Build the Bing / SerpApi scraper input from a ChatGPT Response Scraper CSV.

Takes the per-run ChatGPT results CSV and emits a `run_id,query` CSV of the
fan-out queries (from `hidden_queries_json`) — the queries you actually scrape
the engines for (WORKFLOW steps 2 -> 3/4). One output row per fan-out query.

run_id is `{padded_prompt_id}_r{run_number}` (e.g. P0031_r1). The prompt_id is
zero-padded to the SAME P0000 form `normalize_and_match.py` uses, so the scrape
output lines up with the citations at match time. If a run fired two fan-out
queries, you get two rows with the same run_id (the scraper suffixes _q1/_q2 in
its own output; normalize_and_match strips that back off).

Usage:
  python build_bing_input.py --chatgpt chatgpt_results_2026-06-08T15-24-22.csv
  python build_bing_input.py --chatgpt results.csv --out bing_input.csv --no-pad
"""
import csv, json, os, argparse

csv.field_size_limit(2**31 - 1)


def pad(pid):
    """Zero-pad to P0000 form — matches normalize_and_match.py."""
    return "P" + pid[1:].zfill(4) if pid.startswith("P") and pid[1:].isdigit() else pid


def main():
    ap = argparse.ArgumentParser(description="ChatGPT results CSV -> Bing/SerpApi run_id,query input.")
    ap.add_argument("--chatgpt", required=True, help="ChatGPT Response Scraper results CSV")
    ap.add_argument("--out", help="output CSV (default: <input>_bing_input.csv)")
    ap.add_argument("--no-pad", action="store_true",
                    help="keep prompt_id as-is (default pads P31 -> P0031 to match the matcher)")
    a = ap.parse_args()

    out = a.out or os.path.splitext(a.chatgpt)[0] + "_bing_input.csv"
    rows, seen = [], set()
    runs_total = runs_with_fanout = skipped = 0

    with open(a.chatgpt, encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            runs_total += 1
            pid = (r.get("prompt_id") or "").strip()
            if not a.no_pad:
                pid = pad(pid)
            run_id = f"{pid}_r{(r.get('run_number') or '').strip()}"

            try:
                queries = json.loads(r.get("hidden_queries_json", "[]") or "[]")
            except json.JSONDecodeError:
                queries = []
            queries = [q.strip() for q in queries if isinstance(q, str) and q.strip()]

            if not queries:
                skipped += 1            # run never searched (no fan-out) -> nothing to scrape
                continue
            runs_with_fanout += 1
            for q in queries:
                key = (run_id, q)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({"run_id": run_id, "query": q})

    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["run_id", "query"])
        w.writeheader()
        w.writerows(rows)

    print(f"runs read:            {runs_total}")
    print(f"  with fan-out:       {runs_with_fanout}")
    print(f"  skipped (no search):{skipped}")
    print(f"fan-out queries out:  {len(rows)}  ->  {out}")


if __name__ == "__main__":
    main()
