#!/usr/bin/env python3
"""
SRO Intelligence – News Agent

Pulls real RSS news, normalises it, and writes:
  public/data/news.json

The frontend expects each item to have:
  region, type, severity, url, source, time, title, snippet
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import feedparser

# -------- CONFIG --------

# Where to write news.json (repo root / public / data / news.json)
ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
NEWS_PATH = DATA_DIR / "news.json"

MAX_ITEMS_PER_FEED = 10
TOTAL_ITEM_LIMIT = 80

FEEDS = [
    # Reuters – global / general
    {
        "url": "https://feeds.reuters.com/reuters/worldNews",
        "region": "Global",
        "type": "General",
        "source": "Reuters",
    },
    {
        "url": "https://feeds.reuters.com/reuters/businessNews",
        "region": "Global",
        "type": "Supply Chain",
        "source": "Reuters",
    },
    # BleepingComputer – cyber
    {
        "url": "https://www.bleepingcomputer.com/feed/",
        "region": "Global",
        "type": "Cyber Security",
        "source": "BleepingComputer",
    },
    # AP – security / conflict style
    {
        "url": "https://rsshub.app/apnews/security",
        "region": "Global",
        "type": "Physical Security",
        "source": "AP (via RSSHub)",
    },
]


# -------- HELPERS --------


TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    if not text:
        return ""
    text = TAG_RE.sub("", text)
    return " ".join(text.split())


KEYWORDS_CRITICAL = [
    "attack",
    "explosion",
    "blast",
    "shooting",
    "terror",
    "ransomware",
    "malware",
    "breach",
    "kidnap",
    "kidnapping",
    "war",
    "missile",
    "airstrike",
    "riot",
    "unrest",
    "strike",
    "shutdown",
    "hurricane",
    "earthquake",
    "typhoon",
    "flood",
    "wildfire",
]


def guess_severity(title: str, summary: str) -> int:
    """Very rough keyword-based severity classifier."""
    text = f"{title} {summary}".lower()
    for kw in KEYWORDS_CRITICAL:
        if kw in text:
            return 3  # Critical
    return 2  # Warning / elevated


def iso_time_from_entry(entry) -> str:
    # Try RSS fields, fall back to "Recently"
    dt = None
    for attr in ("published_parsed", "updated_parsed"):
        if getattr(entry, attr, None):
            dt = getattr(entry, attr)
            break

    if dt:
        try:
            dt_ = datetime(
                dt.tm_year,
                dt.tm_mon,
                dt.tm_mday,
                dt.tm_hour,
                dt.tm_min,
                dt.tm_sec,
                tzinfo=timezone.utc,
            )
            return dt_.isoformat()
        except Exception:
            pass

    # Text fallback
    text = (
        getattr(entry, "published", None)
        or getattr(entry, "updated", None)
        or "Recently"
    )
    return str(text)


# -------- MAIN COLLECTION --------


def collect_news() -> list[dict]:
    items: list[dict] = []

    for feed_cfg in FEEDS:
        url = feed_cfg["url"]
        print(f"Fetching: {url}")
        parsed = feedparser.parse(url)

        if getattr(parsed, "bozo", 0):
            print(f"  ! Problem parsing feed (bozo flag set) – skipping")
            continue

        for entry in parsed.entries[:MAX_ITEMS_PER_FEED]:
            title = getattr(entry, "title", "").strip()
            link = getattr(entry, "link", "").strip()
            summary = strip_html(getattr(entry, "summary", "") or getattr(entry, "description", ""))
            if not title or not link:
                continue

            severity = guess_severity(title, summary)
            time_str = iso_time_from_entry(entry)

            item = {
                "region": feed_cfg["region"],
                "type": feed_cfg["type"],
                "severity": severity,
                "url": link,
                "source": feed_cfg["source"],
                "time": time_str,
                "title": title,
                "snippet": summary[:500],
            }
            items.append(item)

    # De-dup by (title, url)
    seen = set()
    unique_items = []
    for it in items:
        key = (it["title"], it["url"])
        if key in seen:
            continue
        seen.add(key)
        unique_items.append(it)

    unique_items = unique_items[:TOTAL_ITEM_LIMIT]
    print(f"Collected {len(unique_items)} news items.")
    return unique_items


def main() -> None:
    items = collect_news()
    if not items:
        raise SystemExit("No news items collected – refusing to overwrite news.json with empty list.")

    NEWS_PATH.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"Wrote {len(items)} items to {NEWS_PATH}")


if __name__ == "__main__":
    main()
