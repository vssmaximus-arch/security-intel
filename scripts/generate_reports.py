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

def _article_text(article: Dict[str, Any]) -> str:
    """Return combined searchable text from an article (handles both 'snippet' and 'summary' field names)."""
    title = article.get("title", "") or ""
    body = article.get("body") or article.get("snippet") or article.get("summary") or ""
    # Also include AI-extracted geo locations list for text matching
    geo_locs = article.get("locations") or []
    geo_str = " ".join(geo_locs) if isinstance(geo_locs, list) else str(geo_locs)
    return f"{title} {body} {geo_str}".lower()

def _is_security_relevant(article: Dict[str, Any]) -> bool:
    text = _article_text(article)
    if int(article.get("severity", 1)) >= 3:
        return True
    for kw in ALL_SECURITY_TERMS:
        if kw in text:
            return True
    return False

# Country code → common name mapping for text matching
COUNTRY_NAMES = {
    "US": ["united states", "usa", "u.s.", "america"],
    "CA": ["canada", "canadian"],
    "MX": ["mexico", "mexican"],
    "BR": ["brazil", "brazil", "são paulo", "sao paulo", "porto alegre"],
    "CO": ["colombia", "colombian", "bogota", "bogotá"],
    "CL": ["chile", "chilean", "santiago"],
    "AR": ["argentina", "buenos aires"],
    "PA": ["panama"],
    "IE": ["ireland", "irish", "dublin", "cork", "limerick"],
    "GB": ["uk", "britain", "england", "scotland", "wales", "london", "glasgow", "bracknell", "brentford"],
    "FR": ["france", "french", "paris", "montpellier", "bezons"],
    "DE": ["germany", "german", "frankfurt", "munich", "münchen", "halle"],
    "NL": ["netherlands", "dutch", "amsterdam"],
    "PL": ["poland", "polish", "lodz", "łódź"],
    "DK": ["denmark", "danish", "copenhagen"],
    "SE": ["sweden", "swedish", "stockholm"],
    "ES": ["spain", "spanish", "madrid"],
    "IT": ["italy", "italian", "milan"],
    "CH": ["switzerland", "swiss", "zurich"],
    "IL": ["israel", "israeli", "tel aviv", "herzliya", "haifa", "beer sheva", "beer-sheva"],
    "MA": ["morocco", "moroccan", "casablanca"],
    "EG": ["egypt", "egyptian", "cairo"],
    "AE": ["uae", "emirates", "dubai", "abu dhabi"],
    "IN": ["india", "indian", "bangalore", "bengaluru", "hyderabad", "gurugram", "gurgaon", "sriperumbudur", "chennai"],
    "SG": ["singapore"],
    "MY": ["malaysia", "malaysian", "penang", "cyberjaya", "kuala lumpur"],
    "CN": ["china", "chinese", "xiamen", "chengdu", "shanghai", "beijing"],
    "TW": ["taiwan", "taipei"],
    "JP": ["japan", "japanese", "tokyo", "kawasaki", "osaka"],
    "AU": ["australia", "australian", "sydney", "melbourne"],
    "KR": ["korea", "korean", "seoul"],
}

def _location_search_terms(loc: Location) -> List[str]:
    """Extract city + country terms from a Location for text matching."""
    terms = []
    # Extract city from name like "Dell Round Rock HQ (US)" → "round rock"
    # Strip "Dell " prefix and " (XX)" suffix
    stripped = re.sub(r'^Dell\s+', '', loc.name, flags=re.IGNORECASE)
    stripped = re.sub(r'\s*\([A-Z]{2}\)\s*$', '', stripped).strip()
    # Handle slash-separated cities: "Paris / Bezons" → ["paris", "bezons"]
    city_parts = [p.strip().lower() for p in re.split(r'[/,]', stripped) if p.strip()]
    # Remove generic suffixes (HQ, Campus, Hub, Mfg, etc.)
    for part in city_parts:
        clean = re.sub(r'\b(hq|campus|hub|mfg|manufacturing|parmer)\b', '', part).strip()
        if clean and len(clean) > 2:
            terms.append(clean)
    # Add country-level terms
    country_code = loc.country.upper() if loc.country else ""
    for code, names in COUNTRY_NAMES.items():
        if code == country_code:
            terms.extend(names)
            break
    return list(set(terms))

def build_proximity_alerts(articles: List[Dict[str, Any]], locations: List[Location]) -> List[Dict[str, Any]]:
    alerts = []
    seen = set()  # deduplicate on (article_url, site_name)

    for article in articles:
        if int(article.get("severity", 1)) < 2:
            continue
        if not _is_security_relevant(article):
            continue

        alat, alon = article.get("lat"), article.get("lon")
        art_time = article.get("time") or article.get("timestamp", "")
        art_url = article.get("url") or article.get("link", "")
        art_snippet = article.get("snippet") or article.get("summary", "")

        # Exact coordinate match
        if alat is not None and alon is not None:
            try:
                alat, alon = float(alat), float(alon)
                for loc in locations:
                    dist = haversine_km(alat, alon, loc.lat, loc.lon)
                    if dist <= RADIUS_KM:
                        key = (art_url, loc.name)
                        if key in seen:
                            continue
                        seen.add(key)
                        alerts.append({
                            "article_title": article.get("title"),
                            "article_source": article.get("source"),
                            "article_timestamp": art_time,
                            "article_link": art_url,
                            "severity": int(article.get("severity", 1)),
                            "summary": art_snippet,
                            "site_name": loc.name,
                            "site_country": loc.country,
                            "site_region": loc.region,
                            "distance_km": round(dist, 1),
                            "lat": alat, "lon": alon,
                            "type": article.get("type", "GENERAL")
                        })
            except ValueError:
                pass

        # Fallback: text-based country/city match (uses body + title + AI geo locations)
        else:
            text = _article_text(article)
            # Also build a set of normalised strings from AI-extracted location list
            geo_list = article.get("locations") or []
            geo_norm = set(g.lower().strip() for g in geo_list if g) if isinstance(geo_list, list) else set()

            for loc in locations:
                terms = _location_search_terms(loc)

                matched = any(term in text for term in terms if len(term) > 2)

                # Also check if any AI-extracted location overlaps with our search terms
                if not matched and geo_norm:
                    matched = any(
                        any(term in geo_entry or geo_entry in term for geo_entry in geo_norm)
                        for term in terms if len(term) > 2
                    )

                # Region-level fallback: match article region code to location region
                if not matched:
                    art_region = (article.get("region") or "").upper()
                    if art_region and art_region != "GLOBAL" and art_region == loc.region.upper():
                        # Only fire on severity >= 3 for region-only matches (avoid noise)
                        if int(article.get("severity", 1)) >= 3:
                            matched = True

                if not matched:
                    continue

                key = (art_url, loc.name)
                if key in seen:
                    continue
                seen.add(key)
                alerts.append({
                    "article_title": article.get("title"),
                    "article_source": article.get("source"),
                    "article_timestamp": art_time,
                    "article_link": art_url,
                    "severity": int(article.get("severity", 1)),
                    "summary": art_snippet,
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
        sev = a.get("severity", 1)
        title = a.get("title", "")
        source = a.get("source", "")
        snippet = a.get("snippet") or a.get("summary", "")
        lines.append(f"[sev={sev}] {title} ({source})")
        if snippet:
            lines.append(f"  {snippet[:120]}")
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
    # news_agent.py writes field "time" (not "timestamp")
    cutoff = now - timedelta(hours=24)
    cutoff_iso = cutoff.isoformat()
    recent_articles = [
        a for a in articles
        if (a.get("time") or a.get("timestamp", "")) > cutoff_iso
    ]

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
