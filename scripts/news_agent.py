import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
from bs4 import BeautifulSoup

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# Feeds to pull
FEEDS = [
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://www.bleepingcomputer.com/feed/",
    "https://rsshub.app/apnews/security",
]

# Very simple region classifier based on keywords in title/summary
REGION_KEYWORDS = {
    "AMER": [
        "united states", "u.s.", "america", "american", "canada",
        "brazil", "mexico", "argentina", "chile", "peru", "colombia",
        "panama", "caribbean"
    ],
    "EMEA": [
        "europe", "eu ", "european", " uk ", "united kingdom", "britain",
        "england", "germany", "france", "spain", "italy", "poland",
        "ireland", "africa", "nigeria", "south africa", "kenya",
        "middle east", "saudi", "uae", "dubai", "israel", "egypt"
    ],
    "APJC": [
        "asia", "asian", "india", "china", "hong kong", "taiwan",
        "japan", "tokyo", "osaka", "singapore", "malaysia",
        "thailand", "philippines", "vietnam", "australia", "sydney",
        "melbourne", "korea", "seoul", "indonesia"
    ],
    "LATAM": [
        "latin america", "latam", "brazil", "mexico", "chile", "peru",
        "argentina", "colombia", "bogota", "santiago", "buenos aires"
    ],
}


def classify_region(text: str) -> str:
    if not text:
        return "Global"
    t = text.lower()
    for region, words in REGION_KEYWORDS.items():
        for w in words:
            if w in t:
                return region
    return "Global"


def guess_severity(text: str) -> int:
    """
    3 = critical
    2 = warning
    1 = informational
    """
    if not text:
        return 1
    t = text.lower()

    critical_words = [
        "attack", "massive", "explosion", "bomb", "killed", "dead",
        "critical", "severe", "breach", "ransomware", "earthquake",
        "hurricane", "typhoon", "evacuate", "evacuation",
        "state of emergency",
    ]
    warning_words = [
        "warning", "alert", "flood", "storm", "malware",
        "vulnerability", "outage", "disruption", "protest", "unrest",
    ]

    if any(w in t for w in critical_words):
        return 3
    if any(w in t for w in warning_words):
        return 2
    return 1


def clean_html(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    return " ".join(text.split())


def entry_timestamp(entry) -> str:
    """Return ISO8601 UTC timestamp for the item."""
    dt = None
    if getattr(entry, "published_parsed", None):
        dt = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
    elif getattr(entry, "updated_parsed", None):
        dt = datetime.fromtimestamp(time.mktime(entry.updated_parsed), tz=timezone.utc)
    else:
        dt = datetime.now(tz=timezone.utc)
    return dt.isoformat()


def extract_coords(entry):
    """
    Try to pull geo coordinates if the feed provides them.
    If not present, return (None, None) – proximity engine will skip.
    """
    lat = getattr(entry, "geo_lat", None) or getattr(entry, "lat", None)
    lon = getattr(entry, "geo_long", None) or getattr(entry, "lon", None)
    try:
        if lat is not None and lon is not None:
            return float(lat), float(lon)
    except (TypeError, ValueError):
        return None, None
    return None, None


def fetch_feed(url: str):
    print(f"Fetching: {url}")
    parsed = feedparser.parse(url)
    items = []

    for e in parsed.entries[:30]:  # cap per feed
        title = getattr(e, "title", "").strip()
        link = getattr(e, "link", "").strip()
        summary_html = getattr(e, "summary", "") or getattr(e, "description", "")
        summary = clean_html(summary_html)

        source = urlparse(link or url).netloc or urlparse(url).netloc
        ts = entry_timestamp(e)
        region = classify_region(title + " " + summary)
        severity = guess_severity(title + " " + summary)
        lat, lon = extract_coords(e)

        tags = []
        if getattr(e, "tags", None):
            tags = [t.term for t in e.tags if getattr(t, "term", None)]

        items.append(
            {
                "title": title,
                "link": link,
                "summary": summary,
                "source": source,
                "timestamp": ts,
                "region": region,
                "severity": severity,
                "lat": lat,
                "lon": lon,
                "tags": tags,
            }
        )
    return items


def main():
    all_items = []
    for url in FEEDS:
        try:
            all_items.extend(fetch_feed(url))
        except Exception as exc:
            print(f"[WARN] Failed feed {url}: {exc}")

    # Newest first, cap at 100
    all_items.sort(key=lambda x: x["timestamp"], reverse=True)
    all_items = all_items[:100]

    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "articles": all_items,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"Wrote {len(all_items)} items to {NEWS_PATH}")


if __name__ == "__main__":
    main()
