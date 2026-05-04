FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the Flask app
COPY data_viewer.py .

# Copy database
COPY geo_fresh.db .

# Copy enrichment JSON files
COPY data/enrichment/*.json data/enrichment/

# Copy datapass files needed by the viewer
COPY datapass/page_labels_combined_v2.5.jsonl datapass/
COPY datapass/page_labels_gemini_v2.5.jsonl datapass/
COPY datapass/page_labels_control_gpt5_mini.jsonl datapass/
COPY datapass/chatgpt_results_2026-01-27T11-23-04-enterprise.csv datapass/
COPY datapass/personal_data_run/chatgpt_results_2026-01-28T02-25-34.csv datapass/personal_data_run/
COPY datapass/citation_mappings/ datapass/citation_mappings/

ENV PORT=8080
EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "120", "data_viewer:app"]
