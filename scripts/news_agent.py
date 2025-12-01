import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
from bs4 import BeautifulSoup

try:
    import google.generativeai as genai
except Exception:
    genai = None

# ---------- PATHS ----------

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# ---------- FEEDS ----------

# Focused on security / risk / world disruption
FEEDS = [
    # General world / crisis
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/businessNews",

    # Cyber / security specific
    "https://www.bleepingcomputer.com/feed/",
    "https://rsshub.app/apnews/security",

    # Additional security / tech risk feeds (feedparser will just skip if unreachable)
    "https://feeds.feedburner.com/TheHackersNews",
    "https://krebsonsecurity.com/feed/",
    "https://www.securityweek.com/feed",
]

# ---------- REGIONS ----------

REGION_KEYWORDS = {
    "AMER": [
        "united states", "u.s.", "usa", "america", "american", "canada",
        "brazil", "mexico", "argentina", "chile", "peru", "colombia",
        "panama", "caribbean"
    ],
    "EMEA": [
        "europe", " eu ", "european", " uk ", "united kingdom", "britain",
        "england", "scotland", "wales", "germany", "france", "spain",
        "italy", "poland", "ireland", "africa", "nigeria", "south africa",
        "kenya", "morocco", "algeria", "tunisia",
        "middle east", "saudi", "uae", "dubai", "israel", "egypt", "turkey"
    ],
    "APJC": [
        "asia", "asian", "india", "new delhi", "mumbai",
        "china", "beijing", "shanghai", "hong kong", "taiwan",
        "japan", "tokyo", "osaka", "singapore", "malaysia",
        "thailand", "philippines", "vietnam", "australia", "sydney",
        "melbourne", "korea", "seoul", "indonesia"
    ],
    "LATAM": [
        "latin america", "latam", "brazil", "mexico", "chile", "peru",
        "argentina", "colombia", "bogota", "santiago", "buenos aires"
    ],
}

# ---------- SRO PILLAR FILTERING ----------

# Each rule has:
#   pillar   – which SRO pillar
#   type     – short label used in the UI "type" chip
#   keywords – any of these words => relevant
PILLAR_RULES = [
    {
        "pillar": "Resilience / Crisis Management",
        "type": "CRISIS",
        "keywords": [
            "earthquake", "hurricane", "typhoon", "cyclone", "tsunami",
            "flood", "landslide", "storm", "wildfire", "heatwave",
            "power outage", "blackout", "infrastructure failure",
            "state of emergency", "evacuation", "airport closed",
            "port closed", "port closure", "operations suspended",
            "shutdown", "lockdown", "civil unrest", "riot", "curfew"
        ],
    },
    {
        "pillar": "Regional Security / Duty of Care",
        "type": "PERSONNEL",
        "keywords": [
            "kidnapping", "kidnapped", "abduction", "abducted",
            "assassination", "shooting", "stabbing", "armed robbery",
            "gang violence", "terror attack", "terrorist attack",
            "explosion", "bombing",
            "travel advisory", "do not travel", "travel warning",
            "infectious disease", "epidemic", "outbreak",
            "cholera", "ebola", "covid", "pandemic"
        ],
    },
    {
        "pillar": "Supply Chain / Asset Protection",
        "type": "SUPPLY CHAIN",
        "keywords": [
            "supply chain disruption", "supply disruption",
            "logistics disruption", "port strike", "port workers",
            "dock workers", "container ship", "shipping delays",
            "cargo theft", "truck hijacking", "warehouse fire",
            "manufacturing plant", "factory fire", "industrial fire",
            "semiconductor plant", "logistics hub"
        ],
    },
    {
        "pillar": "Site Security / Insider Risk",
        "type": "PHYSICAL SECURITY",
        "keywords": [
            "unauthorised access", "unauthorized access",
            "intrusion", "breach of perimeter", "gate crash",
            "security guard assaulted", "access control failure",
            "security camera failure", "cctv failure",
            "insider threat", "internal theft", "loss prevention"
        ],
    },
    {
        "pillar": "Compliance & Investigations",
        "type": "COMPLIANCE",
        "keywords": [
            "regulation change", "regulatory change", "new regulation",
            "data protection law", "privacy law",
            "law enforcement raid", "police raid",
            "corruption investigation", "bribery investigation",
            "fraud investigation", "criminal charges",
        ],
    },
]


def classify_region(text: str) -> str:
    if not text:
        return "Global"
    t = text.lower()
    for region, words in REGION_KEYWORDS.items():
        for w in words:
            if w in t:
                return region
    return "Global"


def score_pillars(text: str):
    """
    Return (best_pillar, type, score).
    Score is just number of keyword hits; 0 => not relevant for SRO.
    """
    if not text:
        return None, "GENERAL", 0
    t = text.lower()
    best_rule = None
    best_score = 0
    for rule in PILLAR_RULES:
        hits = sum(1 for kw in rule["keywords"] if kw in t)
        if hits > best_score:
            best_score = hits
            best_rule = rule
    if best_rule and best_score > 0:
        return best_rule["pillar"], best_rule["type"], best_score
    return None, "GENERAL", 0


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
        "attack", "explosion", "bomb", "killed", "dead",
        "critical", "severe", "breach", "ransomware",
        "earthquake", "hurricane", "typhoon", "evacuate",
        "evacuation", "state of emergency", "kidnapping",
        "terrorist attack", "mass shooting",
    ]
    warning_words = [
        "warning", "alert", "flood", "storm", "malware",
        "vulnerability", "outage", "disruption",
        "strike", "protest", "unrest",
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
    dt = None
    if getattr(entry, "published_parsed", None):
        dt = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
    elif getattr(entry, "updated_parsed", None):
        dt = datetime.fromtimestamp(time.mktime(entry.updated_parsed), tz=timezone.utc)
    else:
        dt = datetime.now(tz=timezone.utc)
    return dt.isoformat()


def extract_coords(entry):
    lat = getattr(entry, "geo_lat", None) or getattr(entry, "lat", None)
    lon = getattr(entry, "geo_long", None) or getattr(entry, "lon", None)
    try:
        if lat is not None and lon is not None:
            return float(lat), float(lon)
    except (TypeError, ValueError):
        return None, None
    return None, None


# ---------- GEMINI ONE-LINE SUMMARIES ----------

GEMINI_MODEL = "gemini-1.5-flash"


def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        print("Gemini not configured – using RSS summary text.")
        return None
    try:
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(GEMINI_MODEL)
    except Exception as exc:
        print(f"Gemini init error: {exc}")
        return None


def ai_one_liner(model, title: str, summary: str) -> str:
    if model is None:
        # fallback – trimmed RSS summary
        text = summary or title
        return (text[:260] + "…") if len(text) > 260 else text

    prompt = f"""
You are an analyst writing for Dell Technologies' Security & Resiliency Office.

Write ONE sentence (max 35 words) that:
- starts with an impact label like "Critical Logistics Warning:", "Security Alert:", or "Travel Risk:"
- explains WHY this incident matters operationally for a global tech company.
Avoid marketing fluff.

Headline: {title}
Feed snippet: {summary}
"""
    try:
        resp = model.generate_content(prompt)
        line = (resp.text or "").strip()
        # Hard cap to avoid huge strings
        return (line[:260] + "…") if len(line) > 260 else line
    except Exception as exc:
        print(f"Gemini one-liner error: {exc}")
        text = summary or title
        return (text[:260] + "…") if len(text) > 260 else text


# ---------- FETCH / FILTER ----------


def fetch_feed(url: str):
    print(f"Fetching: {url}")
    parsed = feedparser.parse(url)
    items = []

    for e in parsed.entries[:40]:  # cap per feed
        title = getattr(e, "title", "").strip()
        link = getattr(e, "link", "").strip()
        summary_html = getattr(e, "summary", "") or getattr(e, "description", "")
        summary = clean_html(summary_html)

        source = urlparse(link or url).netloc or urlparse(url).netloc
        ts = entry_timestamp(e)

        core_text = f"{title} {summary}".lower()
        region = classify_region(core_text)
        severity = guess_severity(core_text)
        pillar, incident_type, pillar_score = score_pillars(core_text)
        lat, lon = extract_coords(e)

        tags = []
        if getattr(e, "tags", None):
            tags = [t.term for t in e.tags if getattr(t, "term", None)]

        # ----- HARD FILTER -----
        # * We keep:
        #   - anything with pillar match (pillar_score > 0)
        #   - OR severity >= 2 and region != "Global"
        # This gets rid of "funny sports story" rubbish.
        if pillar_score == 0 and not (severity >= 2 and region != "Global"):
            continue

        items.append(
            {
                "title": title,
                "url": link,
                "snippet_raw": summary,
                "source": source,
                "time": ts,
                "region": region,
                "severity": severity,
                "lat": lat,
                "lon": lon,
                "tags": tags,
                "pillar": pillar,
                "type": incident_type,
            }
        )
    return items


def main():
    all_items = []
    seen_keys = set()

    for url in FEEDS:
        try:
            for it in fetch_feed(url):
                # Deduplicate by title+source
                key = (it["title"].lower(), it["source"].lower())
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                all_items.append(it)
        except Exception as exc:
            print(f"[WARN] Failed feed {url}: {exc}")

    # Newest first
    all_items.sort(key=lambda x: x["time"], reverse=True)
    # Cap to 120 max
    all_items = all_items[:120]

    # Add AI one-liner summaries (snippet field)
    model = init_gemini()
    for art in all_items:
        art["snippet"] = ai_one_liner(model, art["title"], art["snippet_raw"])
        # keep raw if ever needed
        # UI uses 'snippet'

    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        # FRONTEND expects an ARRAY, not {articles: [...]}
        json.dump(all_items, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(all_items)} filtered items to {NEWS_PATH}")


if __name__ == "__main__":
    main()
