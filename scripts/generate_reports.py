import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
from typing import List, Dict, Any

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

RADIUS_KM = 50

REPORT_PROFILES = {
    "global": {"label": "Global", "regions": ["Global", "AMER", "EMEA", "APJC", "LATAM"]},
    "amer": {"label": "AMER", "regions": ["AMER"]},
    "emea": {"label": "EMEA", "regions": ["EMEA"]},
    "apjc": {"label": "APJC", "regions": ["APJC"]},
    "latam": {"label": "LATAM", "regions": ["LATAM"]},
}

GEMINI_MODEL = "gemini-1.5-flash"


@dataclass
class Location:
    name: str
    country: str
    region: str
    lat: float
    lon: float


def load_news() -> List[Dict[str, Any]]:
    if not os.path.exists(NEWS_PATH):
        return []
    with open(NEWS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Support both [ {..} ] and { "articles": [...] }
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("articles", [])
    return []


def load_locations() -> List[Location]:
    if not os.path.exists(LOCATIONS_PATH):
        return []
    with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

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
    return locations


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    rlat1, rlon1, rlat2, rlon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlon = rlon2 - rlon1
    dlat = rlat2 - rlat1
    a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return 6371 * c


def build_proximity_alerts(articles: List[Dict[str, Any]], locations: List[Location]) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []

    for article in articles:
        lat = article.get("lat")
        lon = article.get("lon")
        if lat is None or lon is None:
            continue
        try:
            alat = float(lat)
            alon = float(lon)
        except (TypeError, ValueError):
            continue

        for loc in locations:
            dist = haversine_km(alat, alon, loc.lat, loc.lon)
            if dist <= RADIUS_KM:
                alerts.append(
                    {
                        "title": article.get("title"),
                        "source": article.get("source"),
                        "timestamp": article.get("time"),
                        "url": article.get("url"),
                        "severity": int(article.get("severity", 1)),
                        "pillar": article.get("pillar"),
                        "type": article.get("type", "GENERAL"),
                        "snippet": article.get("snippet") or article.get("snippet_raw"),

                        "site_name": loc.name,
                        "site_country": loc.country,
                        "site_region": loc.region,
                        "distance_km": round(dist, 1),
                        "lat": alat,
                        "lon": alon,
                    }
                )

    alerts.sort(key=lambda a: (-int(a["severity"]), a["distance_km"]))
    return alerts


def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        print("Gemini not configured; using simple text reports.")
        return None
    try:
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(GEMINI_MODEL)
    except Exception as exc:
        print(f"Gemini init error: {exc}")
        return None


def summarise_with_gemini(model, profile_label: str, articles: List[Dict[str, Any]]) -> str:
    if model is None or not articles:
        return ""

    bullets = []
    for a in articles[:40]:
        line = f"- [{a.get('time')}] ({a.get('region')}/{a.get('type')}) {a.get('source')}: {a.get('title')} – {a.get('snippet') or a.get('snippet_raw')}"
        bullets.append(line)
    incidents_text = "\n".join(bullets)

    prompt = f"""
You are an intelligence analyst for Dell Technologies' Security & Resiliency Office.

Region / audience: {profile_label}

You are given incidents from the last 24 hours. Using ONLY this data, produce a concise one-page briefing with the following structure:

1. "Executive Overview" – 3–5 sentences summarising the overall risk picture.
2. "Top 3 Risks to Dell" – 3 numbered bullets. For each bullet:
   - Name the risk.
   - Explain in 1–2 sentences how it could affect Dell people, sites, or operations.
3. "Regional & Thematic Highlights" – 4–8 bullets grouped by:
   - Crisis / Natural Hazards
   - Personnel & Duty of Care
   - Supply Chain & Manufacturing
   - Physical Security / Insider Risk
   (only include groups that have incidents)
4. "Watch list (next 24–72h)" – 3–5 very short bullets focused on what to monitor or decisions leadership may need.

Use direct business language, avoid marketing or generic IT security advice.
Do NOT invent incidents that are not in the list.

Incident feed:
{incidents_text}
"""
    try:
        resp = model.generate_content(prompt)
        return resp.text
    except Exception as exc:
        print(f"Gemini error while summarising: {exc}")
        return ""


def simple_text_summary(profile_label: str, articles: List[Dict[str, Any]]) -> str:
    if not articles:
        return f"No significant items in the last 24 hours for {profile_label}."

    lines = [f"{len(articles)} filtered items in the last 24 hours affecting {profile_label}:", ""]
    for a in articles[:40]:
        ts = a.get("time", "")[:19].replace("T", " ")
        lines.append(f"- [{ts}] ({a.get('region')}/{a.get('type')}) {a.get('source')}: {a.get('title')}")
    return "\n".join(lines)


def render_html_report(profile_label: str, body_text: str, generated_at: datetime) -> str:
    safe_body = (
        (body_text or "")
        .replace("&", "&amp;")
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


def filter_last_24h(articles: List[Dict[str, Any]], allowed_regions: List[str]) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)

    selected: List[Dict[str, Any]] = []
    for a in articles:
        ts_raw = a.get("time") or a.get("timestamp")
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
        selected.append(a)

    selected.sort(key=lambda x: (x.get("time", ""), x.get("severity", 1)), reverse=True)
    return selected


def main():
    articles = load_news()
    locations = load_locations()
    print(f"Loaded {len(articles)} news items and {len(locations)} locations")

    # --- Proximity alerts JSON ---
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

    # --- Daily briefings ---
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
        print(f"Wrote report {out_path} with {len(region_articles)} items")


if __name__ == "__main__":
    main()
