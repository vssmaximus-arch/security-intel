#!/usr/bin/env python3
"""
Feedback API for SRO Intel - persist feedback and trigger ingest.

This version normalizes the URL and stores the same article key the ingest script
uses so the ingest will correctly filter items after feedback is added.

Additionally: when feedback is received we immediately prune public/data/news.json
(for fast UX) and then trigger the full ingest in background (as before).
"""
import json
import os
import subprocess
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from flask import Flask, request, jsonify
from flask_cors import CORS

# Resolve repository paths
THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))
DATA_DIR = os.path.join(REPO_ROOT, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

CANDIDATE_INGEST_PATHS = [
    os.path.join(REPO_ROOT, "public", "scripts", "news_ingest.py"),
    os.path.join(REPO_ROOT, "public", "scripts", "ingest.py"),
    os.path.join(REPO_ROOT, "scripts", "news_ingest.py"),
    os.path.join(REPO_ROOT, "news_ingest.py"),
]

VALID_LABELS = {"NOT_RELEVANT", "CRITICAL", "RELEVANT", "MONITOR"}

app = Flask(__name__)
CORS(app)


def _find_ingest_script():
    for p in CANDIDATE_INGEST_PATHS:
        if os.path.exists(p):
            return p
    return None


INGEST_SCRIPT = _find_ingest_script()


def normalize_url(u: str) -> str:
    """Lowercase, remove UTM/tracking query params, and strip trailing slash."""
    if not u:
        return ""
    try:
        p = urlparse(u.strip())
        scheme = (p.scheme or "https").lower()
        netloc = p.netloc.lower()
        path = p.path.rstrip("/")  # drop trailing slash
        # Remove common tracking params (UTM)
        qs = dict(parse_qsl(p.query, keep_blank_values=True))
        filtered_qs = {k: v for k, v in qs.items() if not k.lower().startswith("utm_")}
        query = urlencode(filtered_qs, doseq=True)
        cleaned = urlunparse((scheme, netloc, path, "", query, ""))
        return cleaned
    except Exception:
        return u.strip().lower()


def build_article_key(title: str, source: str, url: str) -> str:
    title = (title or "").strip().lower()
    source = (source or "").strip().lower()
    url = (url or "").strip().lower()
    if url:
        return f"u:{url}"
    return f"s:{source}|t:{title}"


def _append_feedback(obj: dict):
    line = json.dumps(obj, ensure_ascii=False)
    with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _trigger_ingest():
    if not INGEST_SCRIPT:
        app.logger.warning("No ingest script found; skipping ingest trigger")
        return

    def _run():
        try:
            python_exe = os.environ.get("PYTHON_BIN", "python3")
            subprocess.Popen([python_exe, INGEST_SCRIPT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            app.logger.info("Ingest triggered: %s", INGEST_SCRIPT)
        except Exception as e:
            app.logger.exception("Failed to start ingest: %s", e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _prune_news_for_feedback(key: str, title: str, url: str, source: str):
    """
    Remove items from NEWS_PATH that match the feedback key, normalized url,
    or have an exact title match (case-insensitive). This runs in background
    so the feedback endpoint can return quickly.
    """
    try:
        if not os.path.exists(NEWS_PATH):
            app.logger.debug("news.json not found, skipping prune.")
            return

        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            try:
                items = json.load(f)
            except Exception:
                app.logger.exception("Failed to parse existing news.json; skipping prune.")
                return

        if not isinstance(items, list):
            app.logger.warning("news.json not list, skipping prune.")
            return

        norm_url = normalize_url(url) if url else ""
        removed = 0
        kept = []
        for it in items:
            it_title = (it.get("title") or "").strip()
            it_source = (it.get("source") or "").strip()
            it_url_raw = it.get("url") or ""
            it_url = normalize_url(it_url_raw)
            it_key = build_article_key(it_title, it_source, it_url)

            match = False
            # Exact key match (preferred)
            if key and it_key and key == it_key:
                match = True
            # Normalized URL match
            elif norm_url and it_url and norm_url == it_url:
                match = True
            # Title + source fallback (case-insensitive)
            elif title and it_title and title.strip().lower() == it_title.strip().lower():
                match = True

            if match:
                removed += 1
                app.logger.debug("Pruning news.json matching feedback: %s", it_title)
            else:
                kept.append(it)

        if removed:
            # Write back the pruned list atomically
            tmp_path = NEWS_PATH + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(kept, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, NEWS_PATH)
            app.logger.info("Pruned %d items from news.json due to feedback.", removed)
        else:
            app.logger.debug("No items pruned from news.json for this feedback.")
    except Exception as e:
        app.logger.exception("Error pruning news.json: %s", e)


@app.route("/feedback", methods=["POST"])
def feedback():
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

    norm_url = normalize_url(url)
    key = build_article_key(title, source, norm_url)

    fb_obj = {
        "title": title,
        "url": norm_url,
        "source": source,
        "label": label,
        "snippet": snippet,
        "key": key,
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    try:
        _append_feedback(fb_obj)
    except Exception as e:
        app.logger.exception("Failed to persist feedback: %s", e)
        return jsonify({"error": "failed to persist feedback"}), 500

    # Prune news.json quickly in background for immediate UX fix
    try:
        t = threading.Thread(target=_prune_news_for_feedback, args=(key, title, norm_url, source), daemon=True)
        t.start()
    except Exception:
        app.logger.exception("Failed to start prune thread.")

    # Trigger full ingest in background as before
    _trigger_ingest()

    return jsonify({"ok": True, "key": key}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "feedback_file_exists": os.path.exists(FEEDBACK_PATH),
            "news_file_exists": os.path.exists(NEWS_PATH),
            "ingest_script": INGEST_SCRIPT or "not-found",
        }
    ), 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
