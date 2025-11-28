#!/usr/bin/env python3
"""
generate_reports.py

Reads public/data/news.json and produces simple HTML briefings for the
Daily Briefings modal.

Outputs:
  public/reports/global_latest.html
  public/reports/apjc_latest.html
  public/reports/emea_latest.html
  public/reports/amer_latest.html
  public/reports/latam_latest.html

Plus a few country/cluster profiles mapped very roughly by keywords.
"""

from __future__ import annotations

import html
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Callable


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT_DIR / "public" / "data" / "news.json"
REPORT_DIR = ROOT_DIR / "public" / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)


def load_articles() -> List[Dict[str, Any]]:
    if not DATA_FILE.exists():
        print(f"{DATA_FILE} not found, no reports generated.")
        return []
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    arts = data.get("articles") or data.get("Articles") or []
    if not isinstance(arts, list):
        return []
    return arts


def simple_filter(region: str) -> Callable[[Dict[str, Any]], bool]:
    r = region.upper()
    def f(a: Dict[str, Any]) -> bool:
        return (a.get("region", "").upper() == r) or (r == "GLOBAL")
    return f


def keyword_filter(keywords: List[str]) -> Callable[[Dict[str, Any]], bool]:
    lowers = [k.lower() for k in keywords]
    def f(a: Dict[str, Any]) -> bool:
        text = f"{a.get('title','')} {a.get('snippet','')}".lower()
        return any(k in text for k in lowers)
    return f


REPORT_PROFILES: Dict[str, Dict[str, Any]] = {
    # region field based
    "Global": {"slug": "global", "filter": simple_filter("Global")},
    "APJC": {"slug": "apjc", "filter": simple_filter("APJC")},
    "EMEA": {"slug": "emea", "filter": simple_filter("EMEA")},
    "AMER": {"slug": "amer", "filter": simple_filter("AMER")},
    "LATAM": {"slug": "latam", "filter": simple_filter("LATAM")},

    # RSM / country clusters – coarse keyword filters
    "India": {"slug": "india", "filter": keyword_filter(["India", "New Delhi", "Mumbai", "Bangalore"])},
    "Oceania": {"slug": "oceania", "filter": keyword_filter(["Australia", "Sydney", "Melbourne", "New Zealand", "Auckland"])},
    "Japan": {"slug": "japan", "filter": keyword_filter(["Japan", "Tokyo", "Osaka"])},
    "South_Korea": {"slug": "south_korea", "filter": keyword_filter(["South Korea", "Seoul", "Busan", "ROK"])},
    "SAEM": {"slug": "saem", "filter": keyword_filter(["Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Myanmar", "emerging market"])},
    "Greater_China_HK": {"slug": "greater_china_hk", "filter": keyword_filter(["China", "Hong Kong", "PRC", "Shanghai", "Beijing", "Guangzhou"])},
    "Taiwan": {"slug": "taiwan", "filter": keyword_filter(["Taiwan", "Taipei"])},
    "Malaysia": {"slug": "malaysia", "filter": keyword_filter(["Malaysia", "Kuala Lumpur", "Penang", "Cyberjaya"])},
    "Singapore": {"slug": "singapore", "filter": keyword_filter(["Singapore"])},
}


def render_report(title: str, profile_key: str, articles: List[Dict[str, Any]]) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    if not articles:
        body_html = "<p>No relevant articles in the current feed window for this profile.</p>"
    else:
        items = []
        for a in articles[:25]:
            items.append(
                f"""
                <li style="margin-bottom:12px;">
                    <div style="font-weight:700;">{html.escape(a.get('title',''))}</div>
                    <div style="font-size:12px;color:#555;margin-bottom:2px;">
                        {html.escape(a.get('source',''))} • {html.escape(str(a.get('time','')))}
                        • Severity: {html.escape(str(a.get('severity', '')))}
                        • Type: {html.escape(a.get('type',''))}
                    </div>
                    <div style="font-size:13px;margin-bottom:4px;">{html.escape(a.get('snippet',''))}</div>
                    <div><a href="{html.escape(a.get('url','#'))}" target="_blank">Source link</a></div>
                </li>
                """
            )
        body_html = "<ul style='list-style:none;padding-left:0;'>" + "\n".join(items) + "</ul>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(title)} – SRO Daily Briefing</title>
  <style>
    body {{
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:#f5f5f5;
      margin:0;
      padding:0;
    }}
    .container {{
      max-width: 960px;
      margin: 32px auto;
      background:#ffffff;
      border-radius:12px;
      padding:24px 28px;
      box-shadow:0 4px 16px rgba(0,0,0,0.12);
    }}
    h1 {{
      margin-top:0;
      font-size:22px;
    }}
    .meta {{
      font-size:12px;
      color:#666;
      margin-bottom:12px;
    }}
    .badge {{
      display:inline-block;
      font-size:11px;
      font-weight:700;
      padding:2px 6px;
      border-radius:4px;
      background:#e8f0fe;
      color:#1a73e8;
      margin-right:4px;
    }}
  </style>
</head>
<body>
  <div class="container">
    <h1>SRO Daily Intelligence Briefing – {html.escape(title)}</h1>
    <div class="meta">
      <span class="badge">AUTO-GENERATED</span>
      <span class="badge">{html.escape(profile_key)}</span>
      Generated at {html.escape(ts)} from live feed (heuristic classification).
    </div>
    {body_html}
  </div>
</body>
</html>
"""


def main() -> None:
    all_articles = load_articles()
    if not all_articles:
        return

    for key, cfg in REPORT_PROFILES.items():
        slug = cfg["slug"]
        filt = cfg["filter"]
        subset = [a for a in all_articles if filt(a)]
        title = key.replace("_", " ")
        html_text = render_report(title, key, subset)
        out_path = REPORT_DIR / f"{slug}_latest.html"
        out_path.write_text(html_text, encoding="utf-8")
        print(f"Wrote report {out_path} with {len(subset)} articles.")


if __name__ == "__main__":
    main()
