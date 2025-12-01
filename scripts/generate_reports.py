import os
import json
import datetime

DATA_DIR = "public/data"
NEWS_FILE = os.path.join(DATA_DIR, "news.json")
LOC_FILE = "config/locations.json"
REPORT_FILE = os.path.join(DATA_DIR, "daily_summary.json")

def safe_load_json(path, fallback):
    """Load JSON safely. Never crashes."""
    try:
        if not os.path.exists(path):
            print(f"[WARN] Missing {path}")
            return fallback

        raw = open(path, "r", encoding="utf-8").read().strip()
        if raw == "":
            print(f"[WARN] Empty {path}")
            return fallback

        return json.loads(raw)
    except Exception as e:
        print(f"[WARN] Corrupt JSON in {path}: {e}")
        return fallback


def load_news():
    raw = safe_load_json(NEWS_FILE, fallback={"articles": []})

    # FIX — always return list of articles
    if isinstance(raw, dict) and "articles" in raw:
        return raw["articles"]

    if isinstance(raw, list):
        return raw

    print("[WARN] Unexpected news.json format, using empty list")
    return []


def load_locations():
    raw = safe_load_json(LOC_FILE, fallback=[])
    return raw if isinstance(raw, list) else []


def generate_daily_summary(articles):
    return {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "article_count": len(articles),
        "top_articles": articles[:10]
    }


def main():
    print("=== Running Secure Report Generator ===")

    articles = load_news()
    print(f"Loaded {len(articles)} articles")

    locations = load_locations()
    print(f"Loaded {len(locations)} locations")

    summary = generate_daily_summary(articles)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("Summary written to", REPORT_FILE)
    print("=== Done ===")


if __name__ == "__main__":
    main()
