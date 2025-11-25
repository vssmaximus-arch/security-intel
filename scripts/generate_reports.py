#!/usr/bin/env python3
"""
Dell Global Security & Resiliency Intelligence – HTML Report Generator

Reads public/data/news.json (written by news_agent.py) and produces
profile-specific HTML reports into public/reports/.

Profiles:
- Global VP          -> global_latest.html       (Severity 2–3, all regions)
- APJC Director      -> apjc_latest.html         (All APJC events)
- India Lead         -> india_latest.html        (India-focused)
- China Lead         -> china_latest.html        (Mainland China only)
- Greater China      -> greater_china_latest.html (China, Hong Kong, Macau, Taiwan)
- Japan Lead         -> japan_latest.html
- Korea Lead         -> korea_latest.html
- Oceania Lead       -> oceania_latest.html      (Australia, New Zealand)
- SE Asia Lead       -> sea_latest.html          (ASEAN region)
- ANZ Lead           -> anz_latest.html          (Australia, New Zealand – all severities)

The script is defensive:
- Handles news.json as either an object { "events": [...] } or a raw list.
- Skips any non-dict entries so malformed data cannot crash the pipeline.
"""

import os
import json
from datetime import datetime, timezone
from typing import List, Dict, Any

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_PATH = os.path.join(PUBLIC_DIR, "data", "news.json")
REPORTS_DIR = os.path.join(PUBLIC_DIR, "reports")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_events() -> List[Dict[str, Any]]:
    """Load events from news.json, tolerating multiple shapes."""
    if not os.path.exists(DATA_PATH):
        return []

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # news.json might be { "events": [...] } or just [...]
    if isinstance(raw, list):
        events = raw
    elif isinstance(raw, dict):
        events = raw.get("events", [])
    else:
        events = []

    # Keep only dicts, normalise some fields
    cleaned = []
    for item in events:
        if not isinstance(item, dict):
            continue
        item = dict(item)  # shallow copy

        # Normalise basic fields
        item.setdefault("title", "Untitled incident")
        item.setdefault("summary", "")
        item.setdefault("impact_summary", item.get("summary", ""))
        item.setdefault("source", "")
        item.setdefault("link", "")
        item.setdefault("region", "Global")
        item.setdefault("country", "")
        item.setdefault("city", "")
        try:
            item["severity"] = int(item.get("severity", 1) or 1)
        except Exception:
            item["severity"] = 1

        cleaned.append(item)

    return cleaned


def html_escape(text: str) -> str:
    """Very small HTML escaper."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def write_report(filename: str, title: str, events: List[Dict[str, Any]]):
    os.makedirs(REPORTS_DIR, exist_ok=True)
    path = os.path.join(REPORTS_DIR, filename)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    rows_html = ""
    if not events:
        rows_html = (
            "<tr><td colspan='5' class='text-center text-muted'>"
            "No qualifying items for this profile.</td></tr>"
        )
    else:
        for ev in events:
            sev = ev.get("severity", 1)
            sev_badge = (
                f"<span class='badge bg-danger'>Sev {sev}</span>"
                if sev == 3 else
                f"<span class='badge bg-warning text-dark'>Sev {sev}</span>"
                if sev == 2 else
                f"<span class='badge bg-secondary'>Sev {sev}</span>"
            )

            when = html_escape(ev.get("published", "")[:16].replace("T", " "))
            region = html_escape(ev.get("region", "Global"))
            country = html_escape(ev.get("country", ""))
            city = html_escape(ev.get("city", ""))
            location = (city + ", " + country).strip(", ")
            if not location:
                location = "&mdash;"

            title_link = html_escape(ev.get("title", "Untitled incident"))
            link = ev.get("link") or "#"
            impact = html_escape(ev.get("impact_summary", ev.get("summary", "")))

            rows_html += f"""
<tr>
  <td>{when}</td>
  <td>{region}</td>
  <td>{location}</td>
  <td>{sev_badge}</td>
  <td>
    <a href="{link}" target="_blank">{title_link}</a><br>
    <small class="text-muted">{impact}</small>
  </td>
</tr>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{html_escape(title)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">
  <div class="container my-4">
    <h2 class="mb-1">{html_escape(title)}</h2>
    <p class="text-muted">Generated: {generated_at}</p>
    <div class="table-responsive">
      <table class="table table-sm table-striped align-middle">
        <thead class="table-dark">
          <tr>
            <th style="width: 13%">Time (UTC)</th>
            <th style="width: 8%">Region</th>
            <th style="width: 16%">Location</th>
            <th style="width: 8%">Severity</th>
            <th>Incident</th>
          </tr>
        </thead>
        <tbody>
          {rows_html}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)


# ---------------------------------------------------------------------------
# Profile filters
# ---------------------------------------------------------------------------

ASEAN_COUNTRIES = {
    "singapore", "malaysia", "thailand", "vietnam", "indonesia",
    "philippines", "cambodia", "laos", "myanmar", "brunei"
}

GREATER_CHINA_COUNTRIES = {
    "china", "hong kong", "hong kong sar", "macau", "taiwan"
}


def filter_global_vp(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Severity 2 and 3 only, all regions
    return [e for e in events if e.get("severity", 1) >= 2]


def filter_apjc(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [e for e in events if e.get("region") == "APJC"]


def filter_country(events: List[Dict[str, Any]], country_name: str) -> List[Dict[str, Any]]:
    c_key = country_name.lower()
    out = []
    for e in events:
        country = (e.get("country") or "").lower()
        text = f"{e.get('title','')} {e.get('summary','')} {e.get('impact_summary','')}".lower()
        if c_key in country or c_key in text:
            out.append(e)
    return out


def filter_greater_china(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for e in events:
        country = (e.get("country") or "").lower()
        if country in GREATER_CHINA_COUNTRIES:
            out.append(e)
            continue
        text = f"{e.get('title','')} {e.get('summary','')} {e.get('impact_summary','')}".lower()
        if any(k in text for k in ["china", "hong kong", "taiwan", "macau"]):
            out.append(e)
    return out


def filter_oceania(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for e in events:
        country = (e.get("country") or "").lower()
        if country in {"australia", "new zealand"}:
            out.append(e)
            continue
        text = f"{e.get('title','')} {e.get('summary','')} {e.get('impact_summary','')}".lower()
        if "australia" in text or "new zealand" in text:
            out.append(e)
    return out


def filter_se_asia(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for e in events:
        country = (e.get("country") or "").lower()
        if country in ASEAN_COUNTRIES:
            out.append(e)
            continue
        text = f"{e.get('title','')} {e.get('summary','')} {e.get('impact_summary','')}".lower()
        if any(c in text for c in ASEAN_COUNTRIES):
            out.append(e)
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    events = load_events()
    print(f"[generate_reports] Loaded events: {len(events)}")

    # --- Build each profile list ---
    global_vp_events = filter_global_vp(events)
    apjc_events = filter_apjc(events)
    india_events = filter_country(events, "India")
    china_events = filter_country(events, "China")
    greater_china_events = filter_greater_china(events)
    japan_events = filter_country(events, "Japan")
    korea_events = filter_country(events, "Korea")
    oceania_events = filter_oceania(events)
    sea_events = filter_se_asia(events)
    anz_events = filter_oceania(events)  # same geography, separate label

    # --- Write reports ---
    write_report("global_latest.html", "Global VP – High Severity Incidents", global_vp_events)
    write_report("apjc_latest.html", "APJC Director – All APJC Incidents", apjc_events)
    write_report("india_latest.html", "India – Regional Intelligence", india_events)
    write_report("china_latest.html", "China – Mainland Intelligence", china_events)
    write_report("greater_china_latest.html", "Greater China – Regional Intelligence", greater_china_events)
    write_report("japan_latest.html", "Japan – Regional Intelligence", japan_events)
    write_report("korea_latest.html", "Korea – Regional Intelligence", korea_events)
    write_report("oceania_latest.html", "Oceania – Australia & New Zealand", oceania_events)
    write_report("sea_latest.html", "South East Asia – Regional Intelligence", sea_events)
    write_report("anz_latest.html", "ANZ – Australia & New Zealand", anz_events)

    print("[generate_reports] Reports generated.")


if __name__ == "__main__":
    main()
