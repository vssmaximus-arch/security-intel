#!/usr/bin/env python3
"""
Feedback API for SRO Intel - persist feedback and trigger ingest.

Replace/merge into your existing public/data/feedback_api.py.

Endpoints:
 - POST /feedback  JSON payload: { "title","url","source","label","snippet"(optional) }
 - GET  /health

Behavior:
 - Appends a JSON line to public/data/feedback.jsonl
 - Triggers the ingest script in a background subprocess so public/data/news.json is re-generated
"""
import json
import os
import subprocess
import threading
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from flask_cors import CORS

# Resolve paths relative to repository root (two levels up from this file)
THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))  # .. (repo)/public/data -> repo root
DATA_DIR = os.path.join(REPO_ROOT, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")
NEWS_PATH = os.path.join(DATA_DIR, "news.json")
# Candidate ingest script locations (adjust if your ingest script lives elsewhere)
CANDIDATE_INGEST_PATHS = [
    os.path.join(REPO_ROOT, "public", "scripts", "news_ingest.py"),
    os.path.join(REPO_ROOT, "public", "scripts", "ingest.py"),
    os.path.join(REPO_ROOT, "scripts", "news_ingest.py"),
    os.path.join(REPO_ROOT, "news_ingest.py"),
]

VALID_LABELS = {"NOT_RELEVANT", "CRITICAL", "RELEVANT", "MONITOR"}

app = Flask(__name__)
CORS(app)  # tighten origin in production

def _find_ingest_script():
    for p in CANDIDATE_INGEST_PATHS:
        if os.path.exists(p):
            return p
    return None

INGEST_SCRIPT = _find_ingest_script()

def _append_feedback(obj: dict):
    """
    Append feedback JSON line to FEEDBACK_PATH. Use append mode; POSIX append of a single write is atomic.
    """
    line = json.dumps(obj, ensure_ascii=False)
    with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def _trigger_ingest():
    """
    Trigger ingest script in background using subprocess.Popen to avoid blocking.
    If no ingest script found, log and return.
    """
    if not INGEST_SCRIPT:
        app.logger.warning("No ingest script found in candidate paths; skipping ingest trigger.")
        return

    def _run():
        try:
            # Best-effort: call the script with same python interpreter
            python_exe = os.environ.get("PYTHON_BIN", "python3")
            subprocess.Popen([python_exe, INGEST_SCRIPT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            app.logger.info("Ingest triggered in background: %s", INGEST_SCRIPT)
        except Exception as e:
            app.logger.exception("Failed to start ingest subprocess: %s", e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

@app.route("/feedback", methods=["POST"])
def feedback():
    """
    Accepts:
    {
      "title": "...",
      "url": "...",
      "source": "...",
      "label": "NOT_RELEVANT"|"CRITICAL"|"RELEVANT"|"MONITOR",
      "snippet": "optional"
    }
    """
    try:
        payload = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "invalid json"}), 400

    if not payload or not isinstance(payload, dict):
        return jsonify({"error": "empty or invalid payload"}), 400

    title = (payload.get("title") or "").strip()
    url = (payload.get("url") or "").strip()
    source = (payload.get("source") or "").strip()
    label = (payload.get("label") or "").strip().upper()
    snippet = payload.get("snippet") or ""

    if not title and not url:
        return jsonify({"error": "title or url required"}), 400
    if label not in VALID_LABELS:
        return jsonify({"error": f"invalid label. allowed: {', '.join(sorted(VALID_LABELS))}"}), 400

    fb_obj = {
        "title": title,
        "url": url,
        "source": source,
        "label": label,
        "snippet": snippet,
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    try:
        _append_feedback(fb_obj)
    except Exception as e:
        app.logger.exception("Failed to persist feedback: %s", e)
        return jsonify({"error": "failed to persist feedback"}), 500

    # Trigger ingest in background so news.json is refreshed
    _trigger_ingest()

    return jsonify({"ok": True}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "feedback_file_exists": os.path.exists(FEEDBACK_PATH),
        "news_file_exists": os.path.exists(NEWS_PATH),
        "ingest_script": INGEST_SCRIPT or "not-found"
    }), 200

if __name__ == "__main__":
    # Development server - in prod run via gunicorn/uvicorn etc.
    app.run(host="127.0.0.1", port=5001, debug=False)
