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
# All unique RSS/ATOM links from your combined Excel sheet

FEEDS = [
    'https://apnews.com/apf-topnews&format=atom',
    'https://apnews.com/hub/world-news?format=atom',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
    'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
    'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
    'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml',
    'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
    'https://feeds.bbci.co.uk/news/uk/rss.xml',
    'https://feeds.bbci.co.uk/news/business/rss.xml',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
    'https://feeds.reuters.com/reuters/worldNews',
    'https://feeds.reuters.com/reuters/businessNews',
    'https://feeds.reuters.com/reuters/technologyNews',
    'https://feeds.reuters.com/reuters/USdomesticNews',
    'https://feeds.skynews.com/feeds/rss/world.xml',
    'https://feeds.skynews.com/feeds/rss/uk.xml',
    'https://feeds.skynews.com/feeds/rss/business.xml',
    'https://feeds.skynews.com/feeds/rss/technology.xml',
    'https://www.cnn.com/rss/edition_world.rss',
    'https://www.cnn.com/rss/edition_africa.rss',
    'https://www.cnn.com/rss/edition_americas.rss',
    'https://www.cnn.com/rss/edition_asia.rss',
    'https://www.cnn.com/rss/edition_europe.rss',
    'https://www.cnn.com/rss/edition_meast.rss',
    'https://www.cnn.com/rss/edition_technology.rss',
    'https://www.cnn.com/rss/edition_business.rss',
    'https://feeds.feedburner.com/TheHackersNews',
    'https://www.bleepingcomputer.com/feed/',
    'https://krebsonsecurity.com/feed/',
    'https://www.securityweek.com/feed',
    'https://thehackernews.com/feeds/posts/default',
    'https://www.darkreading.com/rss.xml',
    'https://www.zdnet.com/topic/security/rss.xml',
    'https://www.schneier.com/feed/atom/',
    'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    'https://www.cisa.gov/known-exploited-vulnerabilities-catalog.xml',
    'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml',
    'https://www.europol.europa.eu/media-press/newsroom/news/rss',
    'https://www.interpol.int/Layouts/Interpol/Rss/News.ashx?lang=en',
    'https://www.osce.org/rss',
    'https://reliefweb.int/updates/rss.xml',
    'https://reliefweb.int/updates/rss.xml?primary_country=14',
    'https://reliefweb.int/updates/rss.xml?primary_country=107',
    'https://reliefweb.int/updates/rss.xml?primary_country=244',
    'https://reliefweb.int/updates/rss.xml?primary_country=42',
    'https://www.who.int/feeds/entity/csr/don/en/rss.xml',
    'https://www.ecdc.europa.eu/en/news-events/rss.xml',
    'https://www.cdc.gov/media/rss.htm',
    'https://www.ochaopt.org/rss.xml',
    'https://www.undrr.org/rss.xml',
    'https://www.un.org/press/en/rss/all.xml',
    'https://www.imf.org/external/np/spr/rss/eng/rss.aspx?category=Press+Release',
    'https://www.worldbank.org/en/news/all.feed',
    'https://www.weforum.org/agenda/feed',
    'https://www.nato.int/cps/en/natohq/news_rss.htm',
    'https://home.treasury.gov/news/press-releases/feed',
    'https://www.fco.gov.uk/en/news/latest-news/?view=PressRss',
    'https://www.state.gov/rss-feed/',
    'https://www.state.gov/rss-feed/under-secretary-for-political-affairs/',
    'https://www.state.gov/rss-feed/secretary-of-state-press-releases/',
    'https://www.faa.gov/newsroom/all/news?field_news_release_type_target_id=All&newsroom_type=218&field_news_release_topic_target_id=All&created=&combine=&page=0&format=feed&type=rss',
    'https://www.icao.int/Newsroom/_layouts/15/listfeed.aspx?List=bcc6c6cd-184c-4e22-9285-2a552f9d7d07&View=6f7a9ffb-57f2-4f13-9146-8ef1c9c35e5b',
    'https://www.imo.org/en/Media/PressBriefings/Pages/rss.aspx',
    'https://www.noaa.gov/news-rss.xml',
    'https://www.nhc.noaa.gov/rss_examples.php',
    'https://www.spc.noaa.gov/products/spcalert.xml',
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.atom',
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom',
    'https://volcano.si.edu/news/RSS/',
    'https://feeds.feedburner.com/ndtvnews-world-news',
    'https://feeds.feedburner.com/ndtvnews-india-news',
    'https://feeds.hindustantimes.com/HT-World',
    'https://www.hindustantimes.com/rss/india/rssfeed.xml',
    'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',
    'https://timesofindia.indiatimes.com/rssfeeds/1221656.cms',
    'https://www.straitstimes.com/news/world/rss.xml',
    'https://www.straitstimes.com/news/asia/rss.xml',
    'https://www.scmp.com/rss/91/feed',
    'https://www.scmp.com/rss/2/feed',
    'https://www.japantimes.co.jp/feed/',
    'https://www.abc.net.au/news/feed/51120/rss.xml',
    'https://www.abc.net.au/news/feed/45910/rss.xml',
    'https://feeds.abcnews.com/abcnews/internationalheadlines',
    'https://feeds.abcnews.com/abcnews/usheadlines',
    'https://www.theguardian.com/world/rss',
    'https://www.theguardian.com/world/asia/rss',
    'https://www.theguardian.com/world/middleeast/rss',
    'https://www.theguardian.com/world/africa/rss',
    'https://www.theguardian.com/world/americas/rss',
    'https://www.theguardian.com/world/europe-news/rss',
    'https://www.theguardian.com/uk-news/rss',
    'https://www.theguardian.com/business/rss',
    'https://www.theguardian.com/world/asia-pacific/rss',
    'https://www.ft.com/world/uk/rss',
    'https://www.ft.com/world/americas/rss',
    'https://www.ft.com/world/asia-pacific/rss',
    'https://www.ft.com/world/europe/rss',
    'https://www.ft.com/world/mideast/africa/rss',
    'https://www.ft.com/rss/home/uk',
    'https://www.ft.com/companies/financials?format=rss',
    'https://www.economist.com/the-world-this-week/rss.xml',
    'https://www.economist.com/international/rss.xml',
    'https://www.economist.com/business/rss.xml',
    'https://www.economist.com/middle-east-and-africa/rss.xml',
    'https://www.economist.com/asia/rss.xml',
    'https://www.economist.com/europe/rss.xml',
    'https://www.economist.com/united-states/rss.xml',
    'https://www.economist.com/china/rss.xml',
    'https://www.rand.org/rss.xml',
    'https://www.hrw.org/rss/all',
    'https://www.amnesty.org/en/latest/news/feed/',
    'https://feeds.acast.com/public/shows/conflict-zone',
    'https://www.maritime-executive.com/rss/all/security',
    'https://www.supplychainbrain.com/rss/logistics-and-transportation',
    'https://www.supplychainbrain.com/rss/air-cargo',
    'https://globalnews.ca/feed/',
    'https://www.rferl.org/rss/',
    'https://www.axios.com/feeds/feed.rss',
    'https://www.politico.com/rss/politics08.xml',
    'https://www.politico.com/rss/world-news.xml',
    'https://www.bloomberg.com/feed/podcast/etf-report.xml',
    'https://www.bloomberg.com/feed/podcast/benchmark.xml',
    'https://www.bloomberg.com/politics/feeds/site.xml',
    'https://feeds.a.dj.com/rss/RSSWorldNews.xml',
    'https://feeds.a.dj.com/rss/RSSWSJD.xml',
    'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
    'https://www.wsj.com/xml/rss/3_7085.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/World.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/MiddleEast.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/Europe.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/Africa.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/Americas.xml',
    'https://www.nytimes.com/services/xml/rss/nyt/Business.xml',
    'https://feeds.feedburner.com/daily-express-world-news',
    'https://feeds.feedburner.com/daily-express-uk-news',
    'https://feeds.feedburner.com/daily-express-finance',
    'https://rsshub.app/apnews/security',
    'https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom',
    'https://www.smartraveller.gov.au/rss.xml',
    'https://www.worldbank.org/en/news/topic/global-economy/feed'
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
    Score is number of keyword hits; 0 => not relevant.
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

        # HARD FILTER:
        # Keep items that either:
        #   - match an SRO pillar (pillar_score > 0), OR
        #   - severity >= 2 AND region != "Global"
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
                key = (it["title"].lower(), it["source"].lower())
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                all_items.append(it)
        except Exception as exc:
            print(f"[WARN] Failed feed {url}: {exc}")

    all_items.sort(key=lambda x: x["time"], reverse=True)
    all_items = all_items[:200]  # cap overall

    model = init_gemini()
    for art in all_items:
        art["snippet"] = ai_one_liner(model, art["title"], art["snippet_raw"])

    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(all_items)} filtered items to {NEWS_PATH}")


if __name__ == "__main__":
    main()
