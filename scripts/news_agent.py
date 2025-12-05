import json
import os
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
from bs4 import BeautifulSoup

try:
    import google.generativeai as genai
except Exception:  # optional dependency
    genai = None

# ---------- PATHS ----------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# ---------- CONFIGURATION ----------
GEMINI_MODEL = "gemini-1.5-flash"

# ---------- STRICT SRO KEYWORD FILTERS ----------
# These map directly to your frontend "type" filters.
SRO_FILTERS = {
    "CYBER SECURITY": [
        "ransomware", "data breach", "data leak",
        "cyberattack", "cyber attack", "cyber-attack",
        "scada", "industrial control",
        "zero-day", "zeroday", "zero day",
        "vulnerability",
        "ddos", "denial of service",
        "malware",
        "system failure", "outage", "service disruption"
    ],
    "SUPPLY CHAIN": [
        "port strike", "ports strike", "dockworkers strike",
        "cargo theft",
        "supply chain disruption", "supply-chain disruption",
        "shipping delay", "shipping disruption",
        "customs halt", "customs strike",
        "manufacturing stop", "factory fire",
        "production halt",
        "labour dispute", "labor dispute",
        "truckers strike",
        "rail strike", "rail shutdown",
        "airport closed", "airport closure",
        "airspace closed", "airspace restriction"
    ],
    "CRISIS / WEATHER": [
        "earthquake", "aftershock", "tsunami",
        "typhoon", "cyclone", "hurricane", "tropical storm",
        "tornado",
        "flash flood", "flooding",
        "wildfire", "bushfire", "forest fire",
        "power outage", "blackout", "grid failure",
        "state of emergency",
        "evacuation order", "evacuate"
    ],
    "PHYSICAL SECURITY": [
        "active shooter", "mass shooting",
        "terror", "terrorist",
        "bomb", "bombing", "explosion",
        "shooting", "gunman",
        "kidnap", "kidnapping",
        "hostage",
        "assassination",
        "civil unrest", "violent protest",
        "protesters clash", "clashes with police",
        "riot", "tear gas",
        "curfew",
        "martial law",
        "coup",
        "armed group"
    ],
    "HEALTH / SAFETY": [
        "epidemic", "pandemic", "outbreak",
        "infectious disease",
        "quarantine",
        "travel ban",
        "radiation",
        "chemical spill", "toxic leak"
    ],
}

# ---------- NOISE BLOCKLIST ----------
BLOCKLIST = [
    # Sports / entertainment
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "golf",
    "league", "cup", "tournament", "olympics", "world cup", "championship",
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "music festival", "grammy", "oscars",
    # Soft / aftermath
    "residents return", "collect personal items", "cleanup begins",
    "recovery continues", "aftermath of",
    # Junk
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "opinion:", "editorial:", "review:",
    "cultivation", "poppy", "drug trade", "opium",
    "estate dispute",
    "MH370",
]

# ---------- FEEDS (consolidated ~100+ trusted feeds) ----------
FEEDS = [
    # Global / business majors
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/marketsNews",
    "https://feeds.reuters.com/reuters/politicsNews",
    "https://feeds.reuters.com/reuters/lawNews",
    "https://apnews.com/apf-news?format=xml",
    "https://apnews.com/hub/world-news?format=xml",
    "https://apnews.com/hub/politics?format=xml",
    "https://www.afp.com/en/news-hub/rss",
    "https://www.bbc.co.uk/news/world/rss.xml",
    "https://www.bbc.co.uk/news/business/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://feeds.washingtonpost.com/rss/world",
    "https://feeds.washingtonpost.com/rss/business",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.theguardian.com/world/rss",
    "https://www.theguardian.com/business/rss",
    "https://www.dw.com/en/top-stories/world/s-1429/rss",
    "https://www.dw.com/en/top-stories/business/s-1431/rss",
    "https://www.scmp.com/rss/91/feed",
    "https://asia.nikkei.com/rss/feed/nar",
    "https://www.france24.com/en/rss",
    "https://www.euronews.com/rss?level=world",

    # Risk / crisis / humanitarian
    "https://www.crisisgroup.org/rss.xml",
    "https://reliefweb.int/updates/rss.xml",
    "https://www.globalsecurity.org/military/world/rss.xml",
    "https://www.ifrc.org/feeds/all.xml",

    # Supply chain / logistics
    "https://www.freightwaves.com/feed",
    "https://www.joc.com/rss.xml",
    "https://www.supplychaindive.com/feeds/news/",
    "https://gcaptain.com/feed/",
    "https://theloadstar.com/feed/",
    "https://splash247.com/feed/",
    "https://www.porttechnology.org/feed/",
    "https://www.aircargonews.net/feed/",
    "https://www.maritime-executive.com/rss",
    "https://www.maritimebulletin.net/feed/",
    "https://www.portoflosangeles.org/rss/news",
    "https://www.portofantwerpbruges.com/en/news/rss",
    "https://www.mpa.gov.sg/web/rss/rss.xml",
    "https://www.supplychainbrain.com/rss/logistics-and-transportation",

    # Weather / hazards / earthquakes
    "https://alerts.weather.gov/cap/us.php?x=0",
    "https://www.jma.go.jp/bosai/feed/rss/eqvol.xml",
    "https://www.jma.go.jp/bosai/feed/rss/warn.xml",
    "https://www.metoffice.gov.uk/public/data/PWSCache/FeedsRSSAll?format=xml",
    "https://feeds.meteoalarm.org/RSS",
    "https://www.emsc-csem.org/service/rss/rss.php?typ=emsc",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.atom",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "http://www.bom.gov.au/rss/",

    # Travel & advisories
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",

    # Cybersecurity (major incident sources)
    "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    "https://www.cisa.gov/cybersecurity-advisories/all.atom",
    "https://www.darkreading.com/rss_simple.asp",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://www.bleepingcomputer.com/feed/",
    "https://www.csoonline.com/index.rss",
    "https://www.scmagazine.com/home/feed/",
    "https://www.crowdstrike.com/blog/feed/",
    "https://www.cloudflare.com/rss/",
    "https://msrc.microsoft.com/blog/feed",
    "https://www.mandiant.com/resources/rss.xml",
    "https://www.okta.com/blog/index.xml",
    "https://blog.talosintelligence.com/feed/",

    # Global weather / emergency misc
    "https://www.wmo.int/rss",
    "https://www.weather.gov/rss_page.php",
    "https://www.emergencyemail.org/rss.aspx",

    # Regional / additional
    "https://english.alarabiya.net/.mrss/en.xml",
    "https://www.africanews.com/feed/xml",
    "https://www.latinnews.com/index.php?format=feed&type=rss",
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed",
    "https://www.straitstimes.com/news/asia/rss.xml",
]

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def clean_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def get_sro_category(text: str):
    """
    Fast keyword-based pre-classification.
    Returns one of the SRO categories or None.
    """
    t = text.lower()
    for word in BLOCKLIST:
        if word in t:
            return None
    for category, keywords in SRO_FILTERS.items():
        for kw in keywords:
            if kw in t:
                return category
    return None

def infer_region(text: str) -> str:
    """
    Very simple region inference for dashboard filtering.
    Returns one of: Global, AMER, EMEA, APJC, LATAM
    """
    t = text.lower()

    # APJC
    if any(x in t for x in [
        "china", "beijing", "shanghai",
        "india", "delhi", "mumbai", "bangalore",
        "japan", "tokyo", "osaka",
        "australia", "sydney", "melbourne",
        "thailand", "vietnam", "indonesia",
        "malaysia", "singapore",
        "korea", "south korea", "north korea",
        "taiwan", "philippines",
        "new zealand",
        "bangladesh", "pakistan",
        "sri lanka", "myanmar",
        "cambodia", "laos",
        "nepal", "fiji"
    ]):
        return "APJC"

    # LATAM (subset of AMER, but separate tab)
    if any(x in t for x in [
        "brazil", "mexico", "colombia", "argentina",
        "chile", "peru", "panama", "ecuador",
        "uruguay", "paraguay", "venezuela", "bolivia",
        "central america", "latin america"
    ]):
        return "LATAM"

    # AMER (North America)
    if any(x in t for x in [
        "united states", "u.s.", "usa",
        "america",
        "canada", "toronto", "vancouver", "montreal",
        "texas", "california", "new york"
    ]):
        return "AMER"

    # EMEA
    if any(x in t for x in [
        "uk", "united kingdom", "britain", "england",
        "europe", "european union", "eu",
        "germany", "france", "poland", "ireland",
        "israel", "gaza",
        "russia", "ukraine",
        "middle east", "africa",
        "netherlands", "sweden", "spain", "italy",
        "saudi arabia", "uae", "dubai",
        "egypt", "south africa", "nigeria", "kenya"
    ]):
        return "EMEA"

    return "Global"

def ai_process(model, title: str, summary: str, category: str):
    """
    Optional Gemini pass to decide keep/drop and refine severity/snippet.
    If model is None, returns sensible defaults for a kept item.
    """
    if not model:
        snippet = (summary or title)[:200]
        return True, 2, snippet, category

    prompt = f"""
Role: Security Analyst for Dell SRO.
Task: Filter this news item for OPERATIONAL IMPACT only.

INPUT:
Title: "{title}"
Summary: "{summary}"
Preliminary Category: {category}

Rules:
1. REJECT (keep=false): Pure politics, generic crime, sports, celebrity, soft business, or post-event clean-up with no ongoing operational risk.
2. KEEP (keep=true): Anything that poses an active or imminent threat to staff safety, Dell facilities, logistics/supply chain, or major IT/cyber operations.
3. Severity scale:
   - 3 = Life safety or major operational impact (e.g. war, major terror, port closure, big cyber outage).
   - 2 = Significant disruption / credible risk (e.g. large protest, regional weather, notable cyber incident).
   - 1 = Awareness / monitoring only.

Return ONLY JSON in this schema:
{{
  "keep": true or false,
  "severity": 1 to 3,
  "one_liner": "Impact-focused summary in one short sentence.",
  "category": "{category}"
}}
"""
    try:
        resp = model.generate_content(prompt)
        text = resp.text or ""
        clean = text.strip().replace("```json", "").replace("```", "")
        data = json.loads(clean)

        keep = bool(data.get("keep", False))
        severity = int(data.get("severity", 2))
        one_liner = data.get("one_liner") or summary or title
        final_cat = data.get("category") or category

        if severity < 1 or severity > 3:
            severity = 2

        return keep, severity, one_liner[:300], final_cat
    except Exception as exc:
        print(f"[AI ERROR] {exc}")
        snippet = (summary or title)[:200]
        return True, 2, snippet, category

def main():
    print(f"[news_agent] Starting ingest from {len(FEEDS)} feeds")
    all_items = []
    seen_titles = set()
    model = init_gemini()

    PER_FEED_LIMIT = 20  # adjust if you want more/less per feed

    for url in FEEDS:
        try:
            parsed = feedparser.parse(url)
            print(f"[news_agent] Scanning: {url} ({len(parsed.entries)} entries)")
        except Exception as exc:
            print(f"[news_agent] Feed error for {url}: {exc}")
            continue

        for entry in parsed.entries[:PER_FEED_LIMIT]:
            try:
                title = (getattr(entry, "title", "") or "").strip()
                if not title:
                    continue

                if title in seen_titles:
                    continue
                seen_titles.add(title)

                raw_summary = clean_html(getattr(entry, "summary", "")) or ""
                full_text = f"{title} {raw_summary}"

                # 1) Strict keyword pre-filter
                category = get_sro_category(full_text)
                if not category:
                    continue

                # 2) Optional AI refinement
                keep, severity, snippet, final_cat = ai_process(
                    model, title, raw_summary, category
                )
                if not keep:
                    continue

                # 3) Timestamp (prefer feed publish time)
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        ts = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                    except Exception:
                        pass

                # 4) Region inference
                region = infer_region(full_text)

                # 5) Build item for dashboard
                item = {
                    "title": title,
                    "url": getattr(entry, "link", ""),
                    "snippet": snippet,
                    "source": urlparse(getattr(entry, "link", "")).netloc.replace("www.", ""),
                    "time": ts,
                    "region": region,                # Global / AMER / EMEA / APJC / LATAM
                    "severity": int(severity),      # 1–3
                    "type": final_cat               # matches frontend filters
                }
                all_items.append(item)
                print(f"[news_agent] [+] {final_cat} | {region} | {title}")

            except Exception as exc:
                print(f"[news_agent] Entry error in {url}: {exc}")
                continue

    # Sort newest first
    all_items.sort(key=lambda x: x["time"], reverse=True)

    # Save to JSON for frontend
    try:
        with open(NEWS_PATH, "w", encoding="utf-8") as fh:
            json.dump(all_items, fh, indent=2)
        print(f"[news_agent] Ingest complete – saved {len(all_items)} items to {NEWS_PATH}")
    except Exception as exc:
        print(f"[news_agent] Failed to write {NEWS_PATH}: {exc}")

if __name__ == "__main__":
    main()
