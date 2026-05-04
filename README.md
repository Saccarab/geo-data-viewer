# GEO Data Viewer

Self-contained Flask app + SQLite data viewer for the v1 (January 2026) study.

## What's in this folder

| Path | Purpose |
|---|---|
| `data_viewer.py` | The Flask app (single file) |
| `requirements.txt` | Python deps: flask, pandas |
| `geo_fresh.db` | SQLite database with all v1 study data (~157 MB, stored via Git LFS) |
| `data/enrichment/*.json` | Pre-computed enrichment outputs the viewer reads |
| `datapass/*.csv` and `*.jsonl` | v1 ChatGPT runs + page labels |
| `datapass/citation_mappings/` | Per-run citation mapping JSONs |

## Cloning

This repo uses Git LFS for `geo_fresh.db`. Make sure LFS is installed before cloning, otherwise you'll get a tiny pointer file instead of the real database:

```bash
git lfs install
git clone https://github.com/Saccarab/geo-data-viewer.git
cd geo-data-viewer
```

If you cloned without LFS first, run `git lfs pull` to fetch the database.

## How to run (local)

Requires Python 3.10+.

```bash
pip install -r requirements.txt
python data_viewer.py
```

Then open http://localhost:5000 in your browser.

To enable Flask debug mode + auto-reload:

```bash
DATA_VIEWER_DEBUG=1 python data_viewer.py
```

(On Windows PowerShell: `$env:DATA_VIEWER_DEBUG=1; python data_viewer.py`)

## Notes

- **Citation mappings nesting**: there's a known nested folder `datapass/citation_mappings/citation_mappings/` from the original build script. The viewer handles this; don't reorganize.
- **Database file**: `geo_fresh.db` is ~157 MB and lives in Git LFS. It's the only large file in the repo.
