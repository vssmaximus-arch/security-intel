import json
import os
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
from typing import List, Dict, Any

from json import JSONDecodeError

try:
    import google.generativeai as genai
except Exception:
    genai = None

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
REPORT_DIR = os.path.join(BASE_DIR, "public", "reports")
CONFIG_DIR = os.path.join(BASE_DIR, "config")

NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROXIMITY_PATH = os.path.join(DATA_DIR, "proximity.json")
LOCATIONS_PATH = os.path.join(CONFIG_DIR, "locations.json")
PUBLIC_LOCATIONS_PATH = os.path.join(DATA_DIR, "locations.json")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

# Distance threshold for proximity alerts (km)
RADIUS_KM = 50

# Report audiences
REPORT_PROFILES = {
    "global": {"label": "Global", "regions": ["Global", "AMER", "EMEA", "APJC", "LATAM"]},
    "amer": {"label": "AMER", "regions": ["AMER"]},
    "emea": {"label": "EMEA", "regions": ["EMEA"]},
    "apjc": {"label": "APJC", "regions": ["APJC"]},
    "latam": {"label": "LATAM", "regions": ["LATAM"]},
}

GEMINI_MODEL = "gemini-1.5-flash"

# Keyword buckets reuse... (kept same as your previous version for robust matching)
SECURITY_KEYWORDS = {
    "resilience_crisis": [
        "earthquake", "flood", "flash flood", "landslide", "hurricane",
        "typhoon", "cyclone", "storm", "wildfire", "bushfire", "tsunami",
        "eruption", "volcano", "heatwave", "power outage", "blackout",
        "grid failure", "infrastructure failure", "dam failure",
        "port closure", "airport closure", "state of emergency",
    ],
    "civil_unrest": [
        "protest", "demonstration", "riot", "unrest", "clashes",
        "looting", "curfew", "martial law", "strike", "walkout",
        "industrial action", "labour dispute", "labor dispute",
    ],
    "duty_of_care": [
        "kidnap", "kidnapping", "abduction", "hostage", "shooting",
        "stabbing", "armed attack", "terror attack", "terrorist",
        "gunfire", "explosion", "bomb", "car bomb", "ied",
        "assassination", "crime wave", "gang violence",
        "sexual assault", "health alert", "health advisory",
        "outbreak", "epidemic", "pandemic", "virus", "infection",
        "covid", "cholera", "dengue",
    ],
    "supply_chain_assets": [
        "supply chain disruption", "supply disruption", "logistics disruption",
        "shipping delay", "shipment delay", "cargo theft", "truck hijack",
        "warehouse fire", "factory fire", "plant fire",
        "port congestion", "port strike", "dock strike", "rail strike",
        "airport strike", "customs strike", "manufacturing halt",
        "production halt", "production stopped", "plant shutdown",
        "factory shutdown", "distribution centre", "distribution center",
    ],
    "site_security_insider": [
        "security breach", "intrusion", "break-in", "break in", "trespass",
        "unauthorised access", "unauthorized access", "badge misuse",
        "access control failure", "cctv failure",
        "insider threat", "employee theft", "loss prevention",
        "armed robbery", "robbery", "burglary",
    ],
    "compliance_investigations": [
        "regulation change", "regulatory change", "new law",
        "security law", "data protection law", "privacy law", "fine",
        "regulator", "regulatory action", "law enforcement", "police raid",
        "investigation", "corruption", "bribery", "fraud",
        "criminal charges", "indicted",
    ],
    "cyber": [
        "ransomware", "data breach", "data leak", "credential leak",
        "cyber attack", "cyberattack", "ddos", "denial of service",
        "malware", "botnet", "vulnerability", "zero-day", "zero day",
        "exploit", "spyware", "backdoor",
    ],
}

ALL_SECURITY_TERMS = [kw.lower() for bucket in SECURITY_KEYWORDS.values() for kw in bucket]


@dataclass
class Location:
    name: str
    country: str
    region: str
    lat: float
    lon: float

def load_news() -> List[Dict[str, Any]]:
    if not os.path.exists(NEWS_PATH):
        print("news.json not found; continuing with zero articles.")
        return []
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except JSONDecodeError:
        return []
    
    if isinstance(data, list):
        return data
    elif isinstance(data, dict) and "articles" in data:
        return data["articles"]
    return []

def load_locations() -> List[Location]:
    if not os.path.exists(LOCATIONS_PATH):
        print("locations.json not found.")
        return []

    with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
        raw_text = f.read()

    try:
        raw = json.loads(raw_text)
    except JSONDecodeError:
        return []

    locations = []
    for item in raw:
        try:
            locations.append(Location(
                name=item["name"],
                country=item.get("country", ""),
                region=item.get("region", "Global"),
                lat=float(item["lat"]),
                lon=float(item["lon"])
            ))
        except (KeyError, ValueError):
            continue
    return locations

def haversine_km(lat1, lon1, lat2, lon2) -> float:
    rlat1, rlon1, rlat2, rlon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlon = rlon2 - rlon1
    dlat = rlat2 - rlat1
    a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return 6371 * c

def _is_security_relevant(article: Dict[str, Any]) -> bool:
    title = article.get("title", "") or ""
    summary = article.get("summary", "") or ""
    text = f"{title} {summary}".lower()
    if int(article.get("severity", 1)) >= 3:
        return True
    for kw in ALL_SECURITY_TERMS:
        if kw in text:
            return True
    return False

def build_proximity_alerts(articles: List[Dict[str, Any]], locations: List[Location]) -> List[Dict[str, Any]]:
    alerts = []
    for article in articles:
        if int(article.get("severity", 1)) < 2: continue
        if not _is_security_relevant(article): continue

        alat, alon = article.get("lat"), article.get("lon")
        
        # Exact coordinate match
        if alat is not None and alon is not None:
            try:
                alat, alon = float(alat), float(alon)
                for loc in locations:
                    dist = haversine_km(alat, alon, loc.lat, loc.lon)
                    if dist <= RADIUS_KM:
                        alerts.append({
                            "article_title": article.get("title"),
                            "article_source": article.get("source"),
                            "article_timestamp": article.get("timestamp"),
                            "article_link": article.get("url") or article.get("link"),
                            "severity": int(article.get("severity", 1)),
                            "summary": article.get("summary") or article.get("snippet", ""),
                            "site_name": loc.name,
                            "site_country": loc.country,
                            "site_region": loc.region,
                            "distance_km": round(dist, 1),
                            "lat": alat, "lon": alon,
                            "type": article.get("type", "GENERAL")
                        })
            except ValueError:
                pass
        
        # Fallback text match if no coords
        else:
            text = (article.get("title", "") + " " + article.get("summary", "")).lower()
            for loc in locations:
                if loc.name.lower() in text:
                    alerts.append({
                        "article_title": article.get("title"),
                        "article_source": article.get("source"),
                        "article_timestamp": article.get("timestamp"),
                        "article_link": article.get("url") or article.get("link"),
                        "severity": int(article.get("severity", 1)),
                        "summary": article.get("summary") or article.get("snippet", ""),
                        "site_name": loc.name,
                        "site_country": loc.country,
                        "site_region": loc.region,
                        "distance_km": 0.0,
                        "lat": loc.lat, "lon": loc.lon,
                        "type": article.get("type", "GENERAL")
                    })
    
    alerts.sort(key=lambda a: (-int(a["severity"]), a["distance_km"]))
    return alerts

# --- Reporting Logic ---

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def summarise_with_gemini(model, profile_label, articles):
    if not model or not articles: return ""
    bullets = [f"- {a.get('title')}" for a in articles[:40]]
    txt = "\n".join(bullets)
    prompt = f"Security Briefing for {profile_label}. Incidents:\n{txt}"
    try:
        resp = model.generate_content(prompt)
        return resp.text
    except:
        return "Summary unavailable."

def simple_text_summary(profile_label, articles):
    if not articles: return f"No major incidents for {profile_label}."
    lines = [f"Daily Briefing: {profile_label}", "-"*30]
    for a in articles[:40]:
        lines.append(f"[{a.get('severity')}] {a.get('title')} ({a.get('source')})")
    return "\n".join(lines)

def render_html_report(label, body, date_obj):
    safe_body = body.replace("<", "&lt;")
    return f"""<html>
<head><title>Briefing: {label}</title>
<style>body{{font-family:sans-serif;padding:20px;background:#111;color:#eee}}</style>
</head>
<body><h1>{label} - {date_obj.strftime('%Y-%m-%d')}</h1><pre>{safe_body}</pre></body></html>"""

def main():
    articles = load_news()
    locations = load_locations()
    
    # 1. Export Locations to Public Data (Crucial for Frontend)
    # We convert dataclasses to dicts for JSON serialization
    loc_dicts = [asdict(l) for l in locations]
    with open(PUBLIC_LOCATIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(loc_dicts, f, indent=2)
    print(f"Exported {len(locations)} locations to {PUBLIC_LOCATIONS_PATH}")

    # 2. Proximity Alerts
    proximity_alerts = build_proximity_alerts(articles, locations)
    with open(PROXIMITY_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "radius_km": RADIUS_KM,
            "alerts": proximity_alerts
        }, f, indent=2)
    print(f"Wrote {len(proximity_alerts)} alerts to {PROXIMITY_PATH}")

    # 3. Reports
    model = init_gemini()
    now = datetime.now(timezone.utc)
    
    # We filter only recent articles for reports
    cutoff = now - timedelta(hours=24)
    recent_articles = [a for a in articles if a.get("timestamp") and a.get("timestamp") > cutoff.isoformat()]

    for key, cfg in REPORT_PROFILES.items():
        # simple region filter
        region_arts = [a for a in recent_articles if a.get("region") in cfg["regions"] or "Global" in cfg["regions"]]
        
        if model:
            body = summarise_with_gemini(model, cfg["label"], region_arts)
        else:
            body = simple_text_summary(cfg["label"], region_arts)
            
        html = render_html_report(cfg["label"], body, now)
        with open(os.path.join(REPORT_DIR, f"{key}_latest.html"), "w", encoding="utf-8") as f:
            f.write(html)
            
if __name__ == "__main__":
    main()
