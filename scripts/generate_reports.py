#!/usr/bin/env python3
"""
generate_reports.py

End-to-end script that:
- Safely loads news.json and locations.json (never crashes on bad JSON)
- Generates simple regional HTML reports
- Generates proximity.json for the map
- Generates a lightweight forecast.json summary

Drop this file into scripts/generate_reports.py and run:
    python scripts/news_agent.py
    python scripts/generate_reports.py
"""

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# ---------- PATHS ----------

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(BASE_DIR, "public", "data")
REPORT_DIR = os.path.join(BASE_DIR, "public", "reports")
CONFIG_DIR = os.path.join(BASE_DIR, "config")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

NEWS_FILE = os.path.join(DATA_DIR, "news.json")
LOC_FILE = os.path.join(CONFIG_DIR, "locations.json")
PROX_FILE = os.path.join(DATA_DIR, "proximity.json")
FORECAST_FILE = os.path.join(DATA_DIR, "forecast.json")

# HTML report outputs expected by the front-end
REGION_REPORT_FILES = {
    "AMER": os.path.join(REPORT_DIR, "amer_latest.html"),
    "EMEA": os.path.join(REPORT_DIR, "emea_latest.html"),
    "APJC": os.path.join(REPORT_DIR, "apjc_latest.html"),
    "LATAM": os.path.join(REPORT_DIR, "latam_latest.html"),
    "Global": os.path.join(REPORT_DIR, "global_latest.html"),
}


# ---------- MODELS ----------


@dataclass
class Location:
    name: str
    country: str
    region: str
    lat: float
    lon: float


@dataclass
class Incident:
    title: str
    url: str
    snippet: str
    source: str
    time: str
    region: str
    severity: int
    lat: Optional[float]
    lon: Optional[float]
    tags: List[str]
    pillar: Optional[str]
    incident_type: str  # "CRISIS", "PHYSICAL SECURITY", etc.


# ---------- UTILS ----------


def safe_load_json(path: str, fallback: Any):
    """
    Load JSON safely.
    - Missing file  -> fallback
    - Empty file    -> fallback
    - Corrupt JSON  -> fallback
    Never raises; only prints a warning.
    """
    try:
        if not os.path.exists(path):
            print(f"[WARN] Missing JSON: {path}. Using fallback.")
            return fallback

        if os.path.getsize(path) == 0:
            print(f"[WARN] Empty JSON: {path}. Using fallback.")
            return fallback

        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"[WARN] Corrupt JSON in {path}: {exc}. Using fallback.")
        return fallback


def parse_iso(dt_str: str) -> datetime:
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return datetime.utcnow()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points on Earth in km."""
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(
        dlambda / 2
    ) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


# ---------- LOADERS ----------


def load_news() -> List[Incident]:
    raw = safe_load_json(NEWS_FILE, fallback=[])

    incidents: List[Incident] = []
    for item in raw:
        try:
            incidents.append(
                Incident(
                    title=item.get("title", "").strip(),
                    url=item.get("url", "").strip(),
                    snippet=item.get("snippet") or item.get("snippet_raw", "") or "",
                    source=item.get("source", ""),
                    time=item.get("time", ""),
                    region=item.get("region", "Global"),
                    severity=int(item.get("severity", 1)),
                    lat=item.get("lat"),
                    lon=item.get("lon"),
                    tags=item.get("tags", []) or [],
                    pillar=item.get("pillar"),
                    incident_type=item.get("type", "GENERAL"),
                )
            )
        except Exception:
            # Skip obviously broken rows but keep going
            continue

    # Newest first
    incidents.sort(key=lambda x: parse_iso(x.time), reverse=True)
    print(f"Loaded {len(incidents)} incidents from {NEWS_FILE}")
    return incidents


def load_locations() -> List[Location]:
    raw = safe_load_json(LOC_FILE, fallback=[])
    locations: List[Location] = []

    for item in raw:
        try:
            locations.append(
                Location(
                    name=str(item["name"]),
                    country=str(item.get("country", "")),
                    region=str(item.get("region", "Global")),
                    lat=float(item["lat"]),
                    lon=float(item["lon"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            # Bad entry – ignore
            continue

    print(f"Loaded {len(locations)} locations from {LOC_FILE}")
    return locations


# ---------- REPORT GENERATION ----------


def group_by_region(incidents: List[Incident]) -> Dict[str, List[Incident]]:
    groups: Dict[str, List[Incident]] = {
        "AMER": [],
        "EMEA": [],
        "APJC": [],
        "LATAM": [],
        "Global": [],
    }
    for inc in incidents:
        region = inc.region if inc.region in groups else "Global"
        groups[region].append(inc)
    return groups


def render_region_html(region: str, incidents: List[Incident]) -> str:
    """Very simple HTML report; front-end just iframes this."""
    title = f"{region} – Latest Security & Risk Incidents"

    rows = []
    for inc in incidents[:80]:  # cap per report
        sev_label = {3: "CRITICAL", 2: "WARNING", 1: "INFO"}.get(inc.severity, "INFO")
        pillar = inc.pillar or "General"
        tags = ", ".join(inc.tags) if inc.tags else ""
        when = inc.time

        rows.append(
            f"""
            <article class="incident">
              <header>
                <span class="severity severity-{inc.severity}">{sev_label}</span>
                <span class="type">{pillar}</span>
              </header>
              <h3><a href="{inc.url}" target="_blank" rel="noopener noreferrer">{inc.title}</a></h3>
              <p class="meta">{when} · {inc.source}</p>
              <p class="snippet">{inc.snippet}</p>
              <p class="tags">{tags}</p>
            </article>
            """
        )

    body = "\n".join(rows) if rows else "<p>No recent incidents matching filters.</p>"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <style>
    body {{
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      margin: 0;
      padding: 12px 16px;
      background: #0b0c10;
      color: #e5e7eb;
    }}
    h1 {{
      font-size: 18px;
      margin-bottom: 8px;
    }}
    .incident {{
      border-bottom: 1px solid #1f2933;
      padding: 12px 0;
    }}
    .incident:last-child {{
      border-bottom: none;
    }}
    .severity {{
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 999px;
      margin-right: 6px;
      text-transform: uppercase;
    }}
    .severity-3 {{ background: #b91c1c; color: #f9fafb; }}
    .severity-2 {{ background: #d97706; color: #111827; }}
    .severity-1 {{ background: #4b5563; color: #f9fafb; }}
    .type {{
      font-size: 11px;
      text-transform: uppercase;
      color: #9ca3af;
    }}
    h3 {{
      margin: 4px 0;
      font-size: 14px;
    }}
    h3 a {{
      color: #f9fafb;
      text-decoration: none;
    }}
    h3 a:hover {{
      text-decoration: underline;
    }}
    .meta {{
      font-size: 11px;
      color: #9ca3af;
      margin: 2px 0 4px 0;
    }}
    .snippet {{
      margin: 0 0 4px 0;
    }}
    .tags {{
      font-size: 11px;
      color: #6b7280;
    }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  {body}
</body>
</html>
"""
    return html


def write_region_reports(incidents: List[Incident]) -> None:
    groups = group_by_region(incidents)
    for region, path in REGION_REPORT_FILES.items():
        html = render_region_html(region, groups.get(region, []))
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote report for {region}: {path}")


# ---------- PROXIMITY / MAP DATA ----------


def compute_proximity(
    incidents: List[Incident],
    locations: List[Location],
    max_distance_km: float = 300.0,
) -> List[Dict[str, Any]]:
    """
    For each location, find nearby incidents with coordinates within max_distance_km.
    Returns data tailored for the map front-end.
    """
    result: List[Dict[str, Any]] = []

    # Pre-filter incidents that have coordinates
    geo_incidents: List[Tuple[Incident, float, float]] = []
    for inc in incidents:
        if inc.lat is None or inc.lon is None:
            continue
        try:
            lat = float(inc.lat)
            lon = float(inc.lon)
            geo_incidents.append((inc, lat, lon))
        except (TypeError, ValueError):
            continue

    for loc in locations:
        nearby: List[Dict[str, Any]] = []

        for inc, ilat, ilon in geo_incidents:
            dist = haversine_km(loc.lat, loc.lon, ilat, ilon)
            if dist <= max_distance_km:
                nearby.append(
                    {
                        "title": inc.title,
                        "url": inc.url,
                        "snippet": inc.snippet,
                        "source": inc.source,
                        "time": inc.time,
                        "region": inc.region,
                        "severity": inc.severity,
                        "pillar": inc.pillar,
                        "type": inc.incident_type,
                        "lat": ilat,
                        "lon": ilon,
                        "distance_km": round(dist, 1),
                    }
                )

        # Only include facilities with at least one hit
        if nearby:
            nearby.sort(key=lambda x: x["distance_km"])
            result.append(
                {
                    "facility": loc.name,
                    "country": loc.country,
                    "region": loc.region,
                    "lat": loc.lat,
                    "lon": loc.lon,
                    "incidents": nearby,
                }
            )

    print(f"Computed proximity for {len(result)} facilities (max {max_distance_km} km)")
    return result


# ---------- FORECAST / SUMMARY ----------


def build_forecast_summary(incidents: List[Incident]) -> Dict[str, Any]:
    """
    Very simple JSON used to feed a dashboard widget:
    counts by region and severity.
    """
    summary: Dict[str, Any] = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "total": len(incidents),
        "by_region": {},
        "by_severity": {1: 0, 2: 0, 3: 0},
    }

    for inc in incidents:
        region = inc.region or "Global"
        summary["by_region"].setdefault(region, 0)
        summary["by_region"][region] += 1

        if inc.severity in summary["by_severity"]:
            summary["by_severity"][inc.severity] += 1
        else:
            summary["by_severity"][inc.severity] = 1

    return summary


# ---------- MAIN ----------


def main():
    print("=== Running generate_reports.py ===")

    incidents = load_news()
    locations = load_locations()

    # HTML regional reports
    write_region_reports(incidents)

    # Proximity data for map
    proximity = compute_proximity(incidents, locations, max_distance_km=300.0)
    with open(PROX_FILE, "w", encoding="utf-8") as f:
        json.dump(proximity, f, ensure_ascii=False, indent=2)
    print(f"Wrote proximity data: {PROX_FILE}")

    # Forecast / high-level summary
    forecast = build_forecast_summary(incidents)
    with open(FORECAST_FILE, "w", encoding="utf-8") as f:
        json.dump(forecast, f, ensure_ascii=False, indent=2)
    print(f"Wrote forecast summary: {FORECAST_FILE}")

    print("=== generate_reports.py completed successfully ===")


if __name__ == "__main__":
    main()
