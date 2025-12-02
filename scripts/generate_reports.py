#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SRO Intelligence – Report + Proximity Generator

Responsibilities
---------------
1) Load news (public/data/news.json) and Dell locations (config/locations.json)
2) Build proximity alerts (within RADIUS_KM) and write public/data/proximity.json
3) Build last-24h HTML briefings and write public/reports/*_latest.html

Design notes
------------
- Never crashes on missing/invalid inputs; emits empty outputs instead.
- Tolerant JSON parsing: strips // and /* */ comments, ignores trailing commas.
- Proximity: severity>=2 AND security-relevant; handles articles without lat/lon by
  matching location/country names in text and snapping to the site coordinates.
- RADIUS_KM can be overridden via env PROXIMITY_RADIUS_KM; default 50km.
- Gemini is optional (GEMINI_API_KEY). If unavailable, falls back to simple summary.
"""

from __future__ import annotations
import os
import re
import json
import math
import html
import traceback
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# ---------- Paths ----------
THIS_FILE = Path(__file__).resolve()
REPO_ROOT = THIS_FILE.parent.parent  # scripts/ -> repo root
NEWS_PATH = REPO_ROOT / "public" / "data" / "news.json"
LOCATIONS_PATH = REPO_ROOT / "config" / "locations.json"
PROXIMITY_PATH = REPO_ROOT / "public" / "data" / "proximity.json"
REPORTS_DIR = REPO_ROOT / "public" / "reports"

# ---------- Constants ----------
RADIUS_KM = float(os.getenv("PROXIMITY_RADIUS_KM", "50"))
NOW_UTC = datetime.now(timezone.utc)

SECURITY_KEYWORDS = [
    # Crisis / natural hazards / civil unrest / terror
    "earthquake", "flood", "hurricane", "typhoon", "cyclone", "storm", "wildfire", "landslide",
    "eruption", "tsunami", "tornado", "heatwave", "extreme heat", "cold snap",
    "protest", "demonstration", "riot", "strike", "martial law", "curfew", "evacuation",
    "explosion", "bomb", "blast", "terror", "shooting", "hostage", "attack",
    # Duty of care / personnel
    "travel advisory", "travel warning", "kidnap", "abduction", "civil unrest",
    # Physical security / site security
    "intrusion", "arson", "vandalism", "facility closure", "lockdown",
    # Supply chain / logistics
    "port closure", "airport closure", "rail strike", "truckers strike", "border closure",
    "supply chain", "shipment delay", "logistics disruption",
    # Health security
    "outbreak", "pandemic", "epidemic", "who alert", "cdc alert", "ecdc alert", "health emergency",
    # Cyber
    "ransomware", "data breach", "data leak", "zero-day", "0-day", "exploit", "ddos",
    "credential stuffing", "supply chain attack", "cisa kev", "malware", "phishing",
    # Compliance & investigations
    "sanction", "regulatory action", "ofac", "fine", "fraud", "corruption", "bribery", "money laundering",
]

SEVERITY_MAP = {3: "CRITICAL", 2: "WARNING", 1: "INFO"}

REGION_KEYS = {
    "AMER": ["united states", "usa", "us", "canada", "mexico", "brazil", "argentina", "chile", "peru", "colombia"],
    "EMEA": ["uk", "united kingdom", "england", "scotland", "wales", "ireland", "france", "germany", "italy",
             "spain", "portugal", "poland", "netherlands", "belgium", "sweden", "norway", "denmark",
             "finland", "czech", "austria", "switzerland", "romania", "saudi", "uae", "united arab emirates",
             "south africa", "nigeria", "kenya", "egypt", "turkey", "israel", "qatar"],
    "APJC": ["india", "china", "hong kong", "singapore", "japan", "korea", "south korea", "taiwan",
             "australia", "new zealand", "philippines", "vietnam", "thailand", "malaysia", "indonesia",
             "pakistan", "bangladesh"],
    "LATAM": ["mexico", "brazil", "argentina", "chile", "peru", "colombia", "uruguay", "paraguay", "ecuador",
              "guatemala", "panama", "costa rica", "dominican"],
}

# ---------- Utilities ----------
def _strip_json_comments(text: str) -> str:
    # Remove // and /* */ comments
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//.*", "", text)
    return text

def _strip_trailing_commas(text: str) -> str:
    # Remove trailing commas before } ]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text

def _load_json_tolerant(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8", errors="ignore")
        raw = _strip_json_comments(raw)
        raw = _strip_trailing_commas(raw)
        return json.loads(raw)
    except Exception:
        return None

def _norm(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()

def _is_security_relevant(text: str, severity: int) -> bool:
    if severity >= 3:
        return True
    t = _norm(text)
    for kw in SECURITY_KEYWORDS:
        if kw in t:
            return True
    return False

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 1)

# ---------- Models ----------
@dataclass
class Location:
    name: str
    country: str
    region: str
    lat: float
    lon: float

# ---------- Loaders ----------
def load_locations() -> List[Location]:
    data = _load_json_tolerant(LOCATIONS_PATH)
    results: List[Location] = []
    if not isinstance(data, list):
        return results
    for i, row in enumerate(data):
        try:
            name = str(row.get("name", "")).strip()
            country = str(row.get("country", "")).strip()
            region = str(row.get("region", "")).strip().upper()
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
            if not name or not country or region not in {"AMER", "EMEA", "APJC", "LATAM"}:
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            results.append(Location(name=name, country=country, region=region, lat=lat, lon=lon))
        except Exception:
            continue
    return results

def load_news() -> List[Dict[str, Any]]:
    data = _load_json_tolerant(NEWS_PATH)
    if not isinstance(data, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in data:
        try:
            title = str(item.get("title") or "").strip()
            link = str(item.get("url") or item.get("link") or "").strip()
            source = str(item.get("source") or "").strip()
            snippet = str(item.get("snippet") or item.get("snippet_raw") or "").strip()
            region = str(item.get("region") or "").strip()
            severity = int(item.get("severity") or 1)
            lat = item.get("lat")
            lon = item.get("lon")
            time_str = item.get("time") or item.get("timestamp") or item.get("article_timestamp")
            # Normalize timestamp to ISO-8601 UTC if possible
            ts = None
            if time_str:
                try:
                    ts = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                except Exception:
                    ts = None
            out.append({
                "title": title,
                "link": link,
                "source": source,
                "summary": snippet,
                "region": region,
                "severity": severity,
                "lat": float(lat) if isinstance(lat, (float, int)) else None,
                "lon": float(lon) if isinstance(lon, (float, int)) else None,
                "timestamp": ts,
            })
        except Exception:
            continue
    return out

# ---------- Proximity ----------
def build_proximity_alerts(articles: List[Dict[str, Any]], sites: List[Location],
                           radius_km: float) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []
    if not articles or not sites:
        return alerts

    for a in articles:
        title = a["title"]
        summary = a["summary"]
        text = f"{title}. {summary}"
        severity = int(a.get("severity") or 1)
        if severity < 2:
            continue
        if not _is_security_relevant(text, severity):
            continue

        has_geo = (a.get("lat") is not None) and (a.get("lon") is not None)
        for site in sites:
            matched = False
            distance = None
            lat = None
            lon = None

            if has_geo:
                distance = _haversine_km(a["lat"], a["lon"], site.lat, site.lon)
                if distance <= radius_km:
                    matched = True
                    lat, lon = a["lat"], a["lon"]
            else:
                t = _norm(text)
                # Deterministic, transparent string match
                if site.name.lower() in t or site.country.lower() in t:
                    matched = True
                    distance = 0.0
                    lat, lon = site.lat, site.lon

            if matched:
                alerts.append({
                    "article_title": title,
                    "article_source": a.get("source") or "",
                    "article_timestamp": (a["timestamp"].astimezone(timezone.utc).isoformat()
                                          if a.get("timestamp") else ""),
                    "article_link": a.get("link") or "",
                    "severity": severity,
                    "summary": summary,
                    "site_name": site.name,
                    "site_country": site.country,
                    "site_region": site.region,
                    "distance_km": float(distance) if distance is not None else None,
                    "lat": lat,
                    "lon": lon,
                })

    # Sort: severity desc, then distance asc, then recency desc
    def _sort_key(x: Dict[str, Any]) -> Tuple[int, float, float]:
        sev = int(x.get("severity") or 1)
        dist = float(x.get("distance_km") or 9e9)
        ts = x.get("article_timestamp")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else datetime.min.replace(tzinfo=timezone.utc)
            rec = dt.timestamp()
        except Exception:
            rec = 0.0
        # severity desc => -sev ; distance asc ; recency desc => -rec
        return (-sev, dist, -rec)

    alerts.sort(key=_sort_key)
    return alerts

def write_proximity(alerts: List[Dict[str, Any]], radius_km: float) -> None:
    PROXIMITY_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = {
        "generated_at": NOW_UTC.isoformat(),
        "radius_km": int(radius_km),
        "alerts": alerts,
    }
    PROXIMITY_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------- Daily briefings (simplified but operational) ----------
PROFILE_REGIONS = {
    "global": ["Global", "AMER", "EMEA", "APJC", "LATAM"],
    "amer": ["AMER"],
    "emea": ["EMEA"],
    "apjc": ["APJC"],
    "latam": ["LATAM"],
}

def filter_last_24h(articles: List[Dict[str, Any]], allowed_regions: List[str]) -> List[Dict[str, Any]]:
    floor = NOW_UTC - timedelta(hours=24)
    out = []
    seen_titles = set()
    for a in articles:
        ts = a.get("timestamp")
        if not ts or ts.tzinfo is None:
            continue
        if ts < floor:
            continue
        if a.get("region") not in allowed_regions:
            continue
        text = f"{a.get('title','')}. {a.get('summary','')}"
        if not _is_security_relevant(text, int(a.get("severity") or 1)):
            continue
        # Deduplicate by normalized title
        tnorm = re.sub(r"[^a-z0-9]+", " ", _norm(a.get("title"))).strip()
        if tnorm in seen_titles:
            continue
        seen_titles.add(tnorm)
        out.append(a)
    # Sort by severity desc then recency desc
    out.sort(key=lambda x: (-(int(x.get("severity") or 1)),
                            -(x.get("timestamp").timestamp() if x.get("timestamp") else 0)))
    return out

def _gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=api_key)
        return genai.GenerativeModel("gemini-1.5-flash")
    except Exception:
        return None

def summarise_with_gemini(articles: List[Dict[str, Any]]) -> str:
    model = _gemini_client()
    if not model:
        return simple_text_summary(articles)
    bullet_lines = []
    for a in articles[:15]:
        sev = SEVERITY_MAP.get(int(a.get("severity") or 1), "INFO")
        bullet_lines.append(f"- [{sev}] {a.get('title')} — {a.get('summary')}")
    prompt = (
        "You are preparing an executive daily security briefing for Dell SRO leadership. "
        "Summarize the last 24 hours, focusing on operational impact (personnel safety, site security, supply chain, travel, compliance, major cyber). "
        "Write three short sections: Overview, Top Risks (3 bullets), Outlook & Recommendations (3 bullets). "
        "Source items:\n" + "\n".join(bullet_lines)
    )
    try:
        resp = model.generate_content(prompt)  # type: ignore
        txt = (resp.text or "").strip()
        return txt if txt else simple_text_summary(articles)
    except Exception:
        return simple_text_summary(articles)

def simple_text_summary(articles: List[Dict[str, Any]]) -> str:
    if not articles:
        return "No high-impact, security-relevant incidents in the last 24 hours for this region."
    top = articles[:5]
    lines = [f"Overview: {len(articles)} security-relevant items in scope over the last 24 hours.",
             "",
             "Top Risks:"]
    for a in top:
        sev = SEVERITY_MAP.get(int(a.get("severity") or 1), "INFO")
        lines.append(f"- [{sev}] {a.get('title')} ({a.get('source','')}) — {a.get('summary')}")
    lines += ["",
              "Outlook & Recommendations:",
              "- Monitor proximity to Dell facilities and critical vendors; validate local escalation paths.",
              "- Review duty-of-care posture for affected regions/travel routes.",
              "- For cyber items: confirm patch guidance, detections, and supplier exposure."]
    return "\n".join(lines)

def render_html_report(title: str, body_text: str) -> str:
    body_html = "<br>".join(html.escape(line) for line in body_text.split("\n"))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {{ background:#0b0f14; color:#e9eef5; font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin:0; }}
    .wrap {{ max-width: 960px; margin: 40px auto; padding: 0 16px; }}
    h1 {{ font-size: 24px; margin: 0 0 16px; }}
    .card {{ background:#121821; border:1px solid #223042; border-radius: 10px; padding: 16px; }}
    a {{ color:#7ec8ff; }}
    .muted {{ color:#9fb3c8; font-size: 12px; margin-top: 8px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>{html.escape(title)}</h1>
    <div class="card">
      <div style="white-space: pre-wrap; line-height:1.5">{body_html}</div>
      <div class="muted">Generated at {NOW_UTC.strftime('%Y-%m-%d %H:%M UTC')}</div>
    </div>
  </div>
</body>
</html>"""

def write_html_reports(articles: List[Dict[str, Any]]) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    for key, allowed in PROFILE_REGIONS.items():
        filtered = filter_last_24h(articles, allowed)
        title = {
            "global": "Global Daily Security Briefing",
            "amer": "AMER Daily Security Briefing",
            "emea": "EMEA Daily Security Briefing",
            "apjc": "APJC Daily Security Briefing",
            "latam": "LATAM Daily Security Briefing",
        }[key]
        # Use Gemini if available, else simple
        body = summarise_with_gemini(filtered)
        html_doc = render_html_report(title, body)
        (REPORTS_DIR / f"{key}_latest.html").write_text(html_doc, encoding="utf-8")

# ---------- Main ----------
def main() -> None:
    try:
        articles = load_news()
        sites = load_locations()
        alerts = build_proximity_alerts(articles, sites, RADIUS_KM)
        write_proximity(alerts, RADIUS_KM)
        # Briefings
        write_html_reports(articles)
        print(f"[OK] proximity:{len(alerts)} | news:{len(articles)} | sites:{len(sites)} | radius_km:{RADIUS_KM}")
    except Exception as e:
        # Hard fail should still emit empty proximity skeleton and empty reports
        traceback.print_exc()
        try:
            write_proximity([], RADIUS_KM)
            write_html_reports([])
        except Exception:
            pass
        print(f"[WARN] Generator encountered an error: {e}")

if __name__ == "__main__":
    main()
