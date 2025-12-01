import os
import json
import datetime

DATA_DIR = "public/data"
NEWS_FILE = os.path.join(DATA_DIR, "news.json")
LOC_FILE = "config/locations.json"
REPORT_FILE = os.path.join(DATA_DIR, "daily_summary.json")


def safe_load_json(path, fallback):
    """Load JSON safely. Never crashes. Returns fallback on any error."""
    try:
        if not os.path.exists(path):
            print(f"[WARN] Missing JSON: {path}. Using fallback.")
            return fallback

        raw = open(path, "r", encoding="utf-8").read().strip()
        if raw == "":
            print(f"[WARN] Empty JSON: {path}. Using fallback.")
            return fallback

        return json.loads(raw)

    except Exception as e:
        print(f"[WARN] Corrupt JSON in {path}: {e}. Using fallback.")
        return fallback


def load_news():
    return safe_load_json(NEWS_FILE, fallback=[])


def load_locations():
    return safe_load_json(LOC_FILE, fallback=[])


def generate_daily_summary(news_items):
    """Generate simple summary instead of crashing."""
    return {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "count": len(news_items),
        "top_items": news_items[:10]
    }


def main():
    print("=== Running Secure Report Generator ===")

    news = load_news()
    print(f"Loaded {len(news)} news items safely.")

    locations = load_locations()
    print(f"Loaded {len(locations)} locations safely.")

    summary = generate_daily_summary(news)
    print("Generated summary.")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(f"Written summary to {REPORT_FILE}")
    print("=== Completed Successfully ===")


if __name__ == "__main__":
    main()
