# scripts/generate_reports.py

import json
import os
import re
from dataclasses import dataclass
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

# Keyword buckets reused from fetcher for “security relevant” test
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


# ---------- LOADERS ----------


def load_news() -> List[Dict[str, Any]]:
    """
    Normalise public/data/news.json into internal schema:

    {
        title, source, timestamp, summary, severity, region, lat, lon, link
    }
    """
    if not os.path.exists(NEWS_PATH):
        print("news.json not found; continuing with zero articles.")
        return []

    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except JSONDecodeError as exc:
        print(f"news.json is not valid JSON: {exc}")
        return []

    if isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict) and "articles" in data:
        raw_items = data["articles"]
    else:
        print("news.json format not recognised; expected list or {articles:[...]} ")
        return []

    items: List[Dict[str, Any]] = []
    for it in raw_items:
        try:
            items.append(
                {
                    "title": it.get("title", ""),
                    "source": it.get("source", ""),
                    "timestamp": it.get("time") or it.get("timestamp"),
                    "summary": it.get("snippet") or it.get("snippet_raw", ""),
                    "severity": int(it.get("severity", 1)),
                    "region": it.get("region", "Global"),
                    "lat": it.get("lat"),
                    "lon": it.get("lon"),
                    "link": it.get("url") or it.get("link"),
                }
            )
        except Exception:
            # If one row is weird, skip it and move on.
            continue

    print(f"Loaded {len(items)} normalised articles from news.json")
    return items


def load_locations() -> List[Location]:
    """
    Robust loader for config/locations.json.

    Handles:
    - Missing file  -> empty list
    - Empty file    -> empty list
    - Invalid JSON  -> tries to strip comments / trailing commas
    """
    if not os.path.exists(LOCATIONS_PATH):
        print("locations.json not found; continuing with zero locations.")
        return []

    with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
        raw_text = f.read()

    if not raw_text.strip():
        print("locations.json is empty; continuing with zero locations.")
        return []

    try:
        raw = json.loads(raw_text)
    except JSONDecodeError:
        cleaned_lines: List[str] = []
        for line in raw_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("#"):
                continue
            cleaned_lines.append(line)
        cleaned = "\n".join(cleaned_lines)
        cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
        try:
            raw = json.loads(cleaned)
        except JSONDecodeError as exc:
            print(f"locations.json is not valid JSON even after cleanup: {exc}")
            print("Continuing with zero locations.")
            return []

    locations: List[Location] = []
    for item in raw:
        try:
            locations.append(
                Location(
                    name=item["name"],
                    country=item.get("country", ""),
                    region=item.get("region", "Global"),
                    lat=float(item["lat"]),
                    lon=float(item["lon"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    print(f"Loaded {len(locations)} locations from locations.json")
    return locations


# ---------- GEO / PROXIMITY ----------


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

    severity = int(article.get("severity", 1))
    if severity >= 3:
        return True

    for kw in ALL_SECURITY_TERMS:
        if kw in text:
            return True

    return False


def build_proximity_alerts(articles: List[Dict[str, Any]], locations: List[Location]) -> List[Dict[str, Any]]:
    """
    Proximity rules:
    - Only incidents with severity >= 2 and security relevance.
    - Use article lat/lon when present.
    - If no lat/lon, try to snap to Dell sites by matching site name or country
      in the article text (title + summary).
    """
    alerts: List[Dict[str, Any]] = []

    for article in articles:
        sev = int(article.get("severity", 1))
        if sev < 2:
            continue
        if not _is_security_relevant(article):
            continue

        title = article.get("title", "") or ""
        summary = article.get("summary", "") or ""
        text = f"{title} {summary}".lower()

        alat = article.get("lat")
        alon = article.get("lon")

        # 1) If we have coordinates, do real distance checks.
        if alat is not None and alon is not None:
            try:
                alat = float(alat)
                alon = float(alon)
            except (TypeError, ValueError):
                alat = alon = None

        if alat is not None and alon is not None:
            for loc in locations:
                dist = haversine_km(alat, alon, loc.lat, loc.lon)
                if dist <= RADIUS_KM:
                    alerts.append(
                        {
                            "article_title": title,
                            "article_source": article.get("source"),
                            "article_timestamp": article.get("timestamp"),
                            "article_link": article.get("link"),
                            "severity": sev,
                            "summary": summary,
                            "site_name": loc.name,
                            "site_country": loc.country,
                            "site_region": loc.region,
                            "distance_km": round(dist, 1),
                            "lat": alat,
                            "lon": alon,
                        }
                    )
            continue  # done with this article

        # 2) No coordinates – try to snap to Dell sites by text match.
        if alat is None or alon is None:
            for loc in locations:
                loc_name = loc.name.lower()
                loc_country = (loc.country or "").lower()

                if loc_name and loc_name in text:
                    matched = True
                elif loc_country and loc_country in text:
                    matched = True
                else:
                    matched = False

                if not matched:
                    continue

                alerts.append(
                    {
                        "article_title": title,
                        "article_source": article.get("source"),
                        "article_timestamp": article.get("timestamp"),
                        "article_link": article.get("link"),
                        "severity": sev,
                        "summary": summary,
                        "site_name": loc.name,
                        "site_country": loc.country,
                        "site_region": loc.region,
                        "distance_km": 0.0,
                        "lat": loc.lat,
                        "lon": loc.lon,
                    }
                )

    alerts.sort(key=lambda a: (-int(a["severity"]), a["distance_km"]))
    return alerts


# ---------- SUMMARY GENERATION ----------


def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        print("Gemini not configured – using plain-text summary.")
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)


def summarise_with_gemini(model, profile_label: str, articles: List[Dict[str, Any]]) -> str:
    if model is None or not articles:
        return ""

    bullets = []
    for a in articles[:40]:
        line = f"- [{a.get('source')}] {a.get('title')} ({a.get('timestamp')}) – {a.get('summary')}"
        bullets.append(line)
    incidents_text = "\n".join(bullets)

    prompt = f"""
You are the lead security intelligence analyst for Dell Technologies.

Region / audience: {profile_label}

Using ONLY the incidents listed below, produce a one-page briefing with:

1) Executive Overview – 3–5 sentences focused on business impact (people, facilities, travel, supply chain, brand).
2) Top 3 risks for the next 24–72 hours – numbered list. For each risk, clearly explain:
   - What is happening
   - Why it matters to Dell (sites, staff, suppliers, major customers, travel)
   - Immediate watchpoints or decisions for SRO / Regional Security leadership.
3) Outlook & recommendations – 1–2 short paragraphs with concrete, actionable guidance for Regional Security Managers.

Tone: concise, analytical, operational. Do NOT invent events that are not in the list.

Incidents:
{incidents_text}
"""
    try:
        resp = model.generate_content(prompt)
        return resp.text
    except Exception as exc:
        print(f"Gemini error: {exc}")
        return ""


def simple_text_summary(profile_label: str, articles: List[Dict[str, Any]]) -> str:
    if not articles:
        return f"No significant items in the last 24 hours for {profile_label}."

    lines = [f"{len(articles)} security-relevant items in the last 24 hours affecting {profile_label}:", ""]
    for a in articles[:40]:
        ts = a.get("timestamp", "")[:19].replace("T", " ")
        sev = int(a.get("severity", 1))
        sev_label = {3: "CRITICAL", 2: "WARNING"}.get(sev, "INFO")
        lines.append(f"- [{ts}] ({sev_label}) {a.get('source')}: {a.get('title')}")
    return "\n".join(lines)


def render_html_report(profile_label: str, body_text: str, generated_at: datetime) -> str:
    safe_body = (
        body_text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SRO Daily Briefing – {profile_label}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 32px;
      background:#0f172a;
      color:#e5e7eb;
    }}
    .card {{
      max-width: 960px;
      margin: 0 auto;
      background:#020617;
      border-radius: 18px;
      padding: 24px 28px;
      box-shadow: 0 18px 45px rgba(15,23,42,0.8);
      border:1px solid rgba(148,163,184,0.3);
    }}
    h1 {{
      font-size: 24px;
      margin-bottom: 4px;
    }}
    pre {{
      white-space: pre-wrap;
      font-family: inherit;
      line-height: 1.5;
      font-size: 14px;
    }}
    .meta {{
      font-size: 12px;
      color:#9ca3af;
      margin-bottom: 12px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <h1>SRO Daily Briefing – {profile_label}</h1>
    <div class="meta">Generated automatically at {generated_at.strftime('%Y-%m-%d %H:%M UTC')}</div>
    <pre>{safe_body}</pre>
  </div>
</body>
</html>
"""


def _normalise_title(title: str) -> str:
    if not title:
        return ""
    t = title.lower().strip()
    for sep in [" - ", " | ", " — "]:
        if sep in t:
            t = t.split(sep)[0]
            break
    return re.sub(r"\s+", " ", t)


def filter_last_24h(articles: List[Dict[str, Any]], allowed_regions: List[str]) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)

    selected: List[Dict[str, Any]] = []
    seen_titles: set[str] = set()

    for a in articles:
        ts_raw = a.get("timestamp")
        if not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts < cutoff:
            continue

        if allowed_regions and a.get("region", "Global") not in allowed_regions:
            continue

        if not _is_security_relevant(a):
            continue

        norm = _normalise_title(a.get("title", ""))
        if norm in seen_titles:
            continue
        seen_titles.add(norm)

        selected.append(a)

    selected.sort(
        key=lambda x: (
            x.get("timestamp", ""),
            int(x.get("severity", 1)),
        ),
        reverse=True,
    )
    return selected


# ---------- MAIN ----------


def main():
    articles = load_news()
    locations = load_locations()
    print(f"Loaded {len(articles)} articles and {len(locations)} locations")

    # Proximity alerts (used by map + sidebar)
    proximity_alerts = build_proximity_alerts(articles, locations)
    with open(PROXIMITY_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "radius_km": RADIUS_KM,
                "alerts": proximity_alerts,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"Wrote {len(proximity_alerts)} proximity alerts to {PROXIMITY_PATH}")

    # Regional daily briefings
    model = init_gemini()
    now = datetime.now(timezone.utc)

    for key, cfg in REPORT_PROFILES.items():
        region_articles = filter_last_24h(articles, cfg["regions"])

        if model:
            body = summarise_with_gemini(model, cfg["label"], region_articles)
        else:
            body = simple_text_summary(cfg["label"], region_articles)

        html = render_html_report(cfg["label"], body, now)
        out_path = os.path.join(REPORT_DIR, f"{key}_latest.html")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote report {out_path} with {len(region_articles)} filtered articles")


if __name__ == "__main__":
    main()
