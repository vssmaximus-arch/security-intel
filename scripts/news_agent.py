#!/usr/bin/env python3
"""
Dell Global Security & Resiliency Intelligence – News Agent (RELAXED FILTERS)

- Ingests RSS feeds
- Uses a LIGHT SRO pre-filter:
    * Only a blocklist (entertainment, sports, etc.)
    * NO hard "must contain SRO keyword" gate anymore
- Uses Gemini (google-generativeai, model: gemini-pro) for relevance & classification
- Writes public/data/news.json  ->  { "generated_at": "...", "events": [ ... ] }
- Writes public/map.html

Guarantees:
- If feeds return items, Gemini + fallback always produce >= MIN_EVENTS_AFTER_AI events
- If feeds return nothing, a HEARTBEAT mock incident is written so the dashboard is never empty
"""

import os
import json
import hashlib
from datetime import datetime, timezone
from typing import List, Dict, Any

import feedparser
import folium
import google.generativeai as genai

# ---------------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_PATH = os.path.join(PUBLIC_DIR, "data", "news.json")
MAP_PATH = os.path.join(PUBLIC_DIR, "map.html")
LOCATIONS_PATH = os.path.join(BASE_DIR, "config", "locations.json")

# ---------------------------------------------------------------------------
# FEEDS & LIMITS
# ---------------------------------------------------------------------------

MAX_ITEMS_PER_FEED = 40       # hard cap per RSS source
MAX_TOTAL_ITEMS = 300         # hard cap overall before AI
MIN_EVENTS_AFTER_AI = 15      # target minimum incidents after AI filtering

FEEDS = [
    # --- Global wires ---
    {"source": "Reuters World", "url": "https://feeds.reuters.com/reuters/worldnews"},
    {"source": "AP World", "url": "https://apnews.com/hub/apf-intlnews?format=atom"},
    {"source": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
    {"source": "DW World", "url": "https://rss.dw.com/rdf/rss-en-world"},

    # --- Official alerts / disasters ---
    {"source": "USGS Significant EQ", "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.atom"},
    {"source": "GDACS Alerts", "url": "https://www.gdacs.org/xml/rss.xml"},

    # --- Regional (APJC focus) ---
    {"source": "CNA Singapore", "url": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml"},
    {"source": "SCMP", "url": "https://www.scmp.com/rss/91/feed"},
    {"source": "Straits Times", "url": "https://www.straitstimes.com/news/world/rss.xml"},
    {"source": "Yonhap Korea", "url": "https://en.yna.co.kr/feed/rss/world.xml"},
    {"source": "Kyodo Japan", "url": "https://english.kyodonews.net/rss/news.xml"},

    # --- Logistics / supply chain ---
    {"source": "Loadstar", "url": "https://theloadstar.com/feed/"},
    {"source": "Maritime Executive", "url": "https://www.maritime-executive.com/rss"},
    {"source": "Splash247", "url": "https://splash247.com/feed/"},

    # --- Cyber ---
    {"source": "CISA Alerts", "url": "https://www.cisa.gov/cybersecurity-advisories/all.xml"},
    {"source": "BleepingComputer", "url": "https://www.bleepingcomputer.com/feed/"}
]

# ---------------------------------------------------------------------------
# FILTERING – LIGHT BLOCKLIST ONLY
# ---------------------------------------------------------------------------

BLOCKLIST_KEYWORDS = {
    "celebrity", "gossip", "sport", "football", "soccer", "nba", "nfl",
    "entertainment", "movie", "box office", "concert", "music video",
    "stocks", "shares", "earnings", "ipo", "cryptocurrency",
    "live blog", "live updates",
    "theft", "burglary", "shoplifting", "pickpocket", "shoplifter"
}

CITY_COORDS = {
    "Sydney": (-33.8688, 151.2093),
    "Tokyo": (35.6762, 139.6503),
    "Bangalore": (12.9716, 77.5946),
    "Bengaluru": (12.9716, 77.5946),
    "Round Rock": (30.5083, -97.6789),
    "Singapore": (1.3521, 103.8198),
    "Hong Kong": (22.3193, 114.1694),
    "Shanghai": (31.2304, 121.4737),
    "Seoul": (37.5665, 126.9780),
    "Mumbai": (19.0760, 72.8777),
    "Delhi": (28.6139, 77.2090),
    "Chennai": (13.0827, 80.2707)
}

REGION_BY_COUNTRY = {
    "United States": "AMER",
    "Canada": "AMER",
    "Mexico": "LATAM",
    "Brazil": "LATAM",
    "Chile": "LATAM",
    "Argentina": "LATAM",

    "United Kingdom": "EMEA",
    "Germany": "EMEA",
    "France": "EMEA",
    "Netherlands": "EMEA",
    "UAE": "EMEA",
    "Saudi Arabia": "EMEA",
    "South Africa": "EMEA",

    "India": "APJC",
    "China": "APJC",
    "Japan": "APJC",
    "South Korea": "APJC",
    "Republic of Korea": "APJC",
    "Australia": "APJC",
    "New Zealand": "APJC",
    "Singapore": "APJC",
    "Malaysia": "APJC",
    "Thailand": "APJC",
    "Vietnam": "APJC",
    "Philippines": "APJC"
}


def hash_id(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def is_blocked(text: str) -> bool:
    t = text.lower()
    return any(word in t for word in BLOCKLIST_KEYWORDS)


def load_locations():
    """Support either { "assets": [...] } or a plain list."""
    if not os.path.exists(LOCATIONS_PATH):
        return []
    with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

# ---------------------------------------------------------------------------
# GEMINI (google-generativeai)
# ---------------------------------------------------------------------------


def get_gemini_model():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable not set")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-pro")


def analyze_article(model, title: str, summary: str, link: str) -> Dict[str, Any]:
    """
    Call Gemini to decide relevance and classify.
    Soft-fail (relevant=None) if JSON is bad or request errors.
    """
    user_prompt = f"""
Act as a Dell Safety & Risk Operations (SRO) analyst.
You only care about corporate security, business continuity and logistics.

Article:
Title: {title}
Summary: {summary}
Link: {link}

Tasks:
1. Decide if this is relevant for Dell corporate security / business continuity / supply chain.
2. If NOT relevant, set "relevant": false.
3. If relevant, fill:
   - category: one of ["Physical", "Cyber", "Logistics", "Weather"]
   - severity: integer 1, 2, or 3 (3 = highest impact)
   - region: one of ["AMER", "LATAM", "EMEA", "APJC"]
   - country: country most affected
   - city: impacted city / metro if clearly known
   - impact_summary: 2–3 sentence professional summary focused on business continuity.

Return ONLY a single JSON object.
"""

    try:
        resp = model.generate_content(user_prompt)
        text = (resp.text or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()

        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("Not a JSON object")
        return data
    except Exception:
        return {"relevant": None}

# ---------------------------------------------------------------------------
# FEED INGESTION (RELAXED)
# ---------------------------------------------------------------------------


def fetch_entries() -> List[Dict[str, Any]]:
    """
    Pull items from all FEEDS.

    Only apply a BLOCKLIST (no SRO keyword gate). This ensures plenty of
    candidates reach Gemini, which will then mark severity / category.
    """
    items: List[Dict[str, Any]] = []
    for feed in FEEDS:
        try:
            parsed = feedparser.parse(feed["url"])
        except Exception:
            continue

        count = 0
        for entry in parsed.entries:
            if count >= MAX_ITEMS_PER_FEED:
                break

            title = entry.get("title", "") or ""
            summary = entry.get("summary", "") or ""
            link = entry.get("link", "") or ""
            combined = f"{title} {summary}"

            if is_blocked(combined):
                continue

            # Timestamp
            try:
                if getattr(entry, "published_parsed", None):
                    dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                elif getattr(entry, "updated_parsed", None):
                    dt = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
                else:
                    dt = datetime.now(timezone.utc)
            except Exception:
                dt = datetime.now(timezone.utc)

            items.append({
                "id": hash_id(link or title),
                "title": title,
                "summary": summary,
                "link": link,
                "source": feed["source"],
                "published": dt.isoformat()
            })
            count += 1

            if len(items) >= MAX_TOTAL_ITEMS:
                break

        if len(items) >= MAX_TOTAL_ITEMS:
            break

    return items

# ---------------------------------------------------------------------------
# AI ENRICHMENT + FALLBACK
# ---------------------------------------------------------------------------


def enrich_with_ai(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Main intelligence layer:

    - Ask Gemini to classify each candidate.
    - Keep "relevant": true items as-is.
    - If Gemini is too strict, promote some rejected items as severity-1 warnings.
    - If NO items at all (feeds dead), emit a heartbeat event.
    """
    # If feeds were totally empty, return heartbeat immediately
    if not items:
        now = datetime.now(timezone.utc).isoformat()
        return [{
            "id": "heartbeat-no-feeds",
            "title": "No qualifying incidents – monitoring active",
            "summary": "No eligible items were returned by upstream feeds during this cycle.",
            "link": "",
            "source": "System",
            "published": now,
            "category": "Physical",
            "severity": 1,
            "region": "Global",
            "country": "",
            "city": "",
            "lat": None,
            "lon": None,
            "impact_summary": "Pipeline ran successfully but no relevant items were returned by news sources."
        }]

    model = get_gemini_model()
    enriched: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    for item in items:
        try:
            ai = analyze_article(model, item["title"], item["summary"], item["link"])
        except Exception:
            ai = {"relevant": None}

        if ai.get("relevant") is False:
            rejected.append(item)
            continue

        if ai.get("relevant") is True:
            category = ai.get("category") or "Physical"
            severity = int(ai.get("severity") or 1)
            region = ai.get("region") or "Global"
            country = ai.get("country") or ""
            city = ai.get("city") or ""
            impact_summary = ai.get("impact_summary") or item["summary"]

            if region == "Global" and country in REGION_BY_COUNTRY:
                region = REGION_BY_COUNTRY[country]

            lat, lon = None, None
            if city in CITY_COORDS:
                lat, lon = CITY_COORDS[city]

            enriched.append({
                **item,
                "category": category,
                "severity": severity,
                "region": region,
                "country": country,
                "city": city,
                "lat": lat,
                "lon": lon,
                "impact_summary": impact_summary
            })
        else:
            # JSON parse error / model hiccup – keep for possible promotion
            rejected.append(item)

    # If Gemini was strict, promote some rejected items as Sev-1 warnings
    if len(enriched) < MIN_EVENTS_AFTER_AI and rejected:
        needed = MIN_EVENTS_AFTER_AI - len(enriched)
        for item in rejected[:needed]:
            combined = item.get("summary") or item.get("title") or ""
            enriched.append({
                **item,
                "category": "Physical",
                "severity": 1,
                "region": "Global",
                "country": "",
                "city": "",
                "lat": None,
                "lon": None,
                "impact_summary": combined[:400]
            })

    # Absolute floor – if something went weird, still emit a heartbeat
    if not enriched:
        now = datetime.now(timezone.utc).isoformat()
        enriched.append({
            "id": "heartbeat-empty-after-ai",
            "title": "No qualifying incidents – system heartbeat",
            "summary": "AI filtering removed all items; this record confirms the pipeline executed.",
            "link": "",
            "source": "System",
            "published": now,
            "category": "Physical",
            "severity": 1,
            "region": "Global",
            "country": "",
            "city": "",
            "lat": None,
            "lon": None,
            "impact_summary": "All candidate items were filtered out by AI. Review filters if this persists."
        })

    return enriched

# ---------------------------------------------------------------------------
# MAP
# ---------------------------------------------------------------------------


def build_map(events: List[Dict[str, Any]], locations_cfg):
    """
    Build the folium map.

    locations_cfg can be:
    - dict with key "assets" -> list
    - plain list of asset dicts
    """
    m = folium.Map(
        location=[10, 10],
        zoom_start=2,
        min_zoom=2,
        max_bounds=True,
        prefer_canvas=True
    )
    m.options["no_wrap"] = True

    # Normalise assets structure
    if isinstance(locations_cfg, dict):
        assets = locations_cfg.get("assets", [])
    elif isinstance(locations_cfg, list):
        assets = locations_cfg
    else:
        assets = []

    # Dell assets – blue markers
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        lat = asset.get("lat")
        lon = asset.get("lon")
        if lat is None or lon is None:
            continue
        folium.CircleMarker(
            location=[lat, lon],
            radius=6,
            color="blue",
            fill=True,
            fill_opacity=0.8,
            popup=f"Dell Asset: {asset.get('name')} ({asset.get('city')}, {asset.get('country')})"
        ).add_to(m)

    # Threats – colored by severity
    for ev in events:
        lat, lon = ev.get("lat"), ev.get("lon")
        if lat is None or lon is None:
            continue
        severity = ev.get("severity", 1)
        color = "red" if severity == 3 else "orange" if severity == 2 else "darkred"
        popup = (
            f"<b>{ev['title']}</b><br>"
            f"{ev.get('impact_summary', '')}<br>"
            f"<i>{ev.get('source', '')}</i>"
        )
        folium.CircleMarker(
            location=[lat, lon],
            radius=6 + severity,
            color=color,
            fill=True,
            fill_opacity=0.9,
            popup=popup
        ).add_to(m)

    m.save(MAP_PATH)

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------


def main():
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(MAP_PATH), exist_ok=True)

    raw_items = fetch_entries()
    print(f"[news_agent] Candidates after blocklist: {len(raw_items)}")

    events = enrich_with_ai(raw_items)
    print(f"[news_agent] Final events written: {len(events)}")

    locations_cfg = load_locations()

    db = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "events": events
    }
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    build_map(events, locations_cfg)


if __name__ == "__main__":
    main()
