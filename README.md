# GEO Data Viewer — v1 Study Deployment

Self-contained Flask app + SQLite data for the v1 (January 2026) study. Deploys to Google Cloud Run as a single container.

## What's in this folder

| Path | Purpose |
|---|---|
| `Dockerfile` | Container build instructions (Python 3.12 + gunicorn) |
| `requirements.txt` | Python deps: flask, pandas, gunicorn |
| `data_viewer.py` | The Flask app (single file, ~280 KB) |
| `geo_fresh.db` | SQLite database with all v1 study data (~157 MB) |
| `data/enrichment/*.json` | Pre-computed enrichment outputs the viewer reads |
| `datapass/*.csv` and `*.jsonl` | v1 ChatGPT runs + page labels |
| `datapass/citation_mappings/` | Per-run citation mapping JSONs |

## Prerequisites for the receiver

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- A GCP project with Cloud Run API enabled (`gcloud services enable run.googleapis.com`)

## Deploy

From inside this folder:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy geo-data-viewer \
  --source . \
  --region europe-west1 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --allow-unauthenticated \
  --timeout 120
```

Cloud Run will:
1. Build a container from the Dockerfile
2. Push it to Google Artifact Registry
3. Deploy as a public service
4. Print the live URL

## Local dev (optional)

```bash
pip install -r requirements.txt
python data_viewer.py
# opens on http://localhost:8080
```

## Notes

- **Large file**: `geo_fresh.db` is ~157 MB. If committing to git, use git-lfs or share via separate transfer (Google Drive, etc.). The `.gitignore` in this folder excludes it by default — uncomment the line if you want to commit it.
- **Region/resources**: tweak the `--region`, `--memory`, `--cpu` flags above to match the receiver's GCP setup. `europe-west1` was the original deployment region.
- **Authentication**: `--allow-unauthenticated` makes the service publicly accessible. Remove this flag and set IAM bindings if private access is needed.
- **Citation mappings nesting**: there's a known nested folder `datapass/citation_mappings/citation_mappings/` from the original build script. The viewer handles this; don't reorganize.
