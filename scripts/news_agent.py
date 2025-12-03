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

# ---------- AGGRESSIVE BLOCKLIST (Kill fluff/sports/recovery stories) ----------
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament",
    "celebrity", "entertainment", "movie", "film", "star", "actor", "actress",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", "aftermath of fire",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "opinion:", "editorial:", "review:", "best of", "top 10"
]

# ---------- FULL FEED LIST (RESTORED) ----------
FEEDS = [
    # --- GLOBAL NEWS ---
    'https://apnews.com/apf-topnews&format=atom',
    'https://apnews.com/hub/world-news?format=atom',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
    'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
    'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml',
    'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
    'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
    'https://feeds.reuters.com/reuters/worldNews',
    'https://feeds.reuters.com/reuters/businessNews',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.scmp.com/rss/91/feed',  # APJC / Hong Kong
    'https://www.straitstimes.com/news/asia/rss.xml', # APJC
    'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', # India
    'https://www.japantimes.co.jp/feed/', # Japan
    'https://www.abc.net.au/news/feed/51120/rss.xml', # Australia
    'https://globalnews.ca/feed/', # Canada
    'https://www.france24.com/en/rss', # Europe
    'https://www.dw.com/en/top-stories/rss-10021', # Germany
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    
    # --- SECURITY & CYBER ---
    'https://feeds.feedburner.com/TheHackersNews',
    'https://www.bleepingcomputer.com/feed/',
    'https://krebsonsecurity.com/feed/',
    'https://www.securityweek.com/feed',
    'https://www.darkreading.com/rss.xml',
    'https://www.zdnet.com/topic/security/rss.xml',
    'https://www.schneier.com/feed/atom/',
    'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    'https://www.cisa.gov/known-exploited-vulnerabilities-catalog.xml',
    'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml',
    'https://www.europol.europa.eu/media-press/newsroom/news/rss',
    
    # --- CRISIS & GOV ---
    'https://reliefweb.int/updates/rss.xml',
    'https://www.who.int/feeds/entity/csr/don/en/rss.xml', # Disease Outbreaks
    'https://www.state.gov/rss-feed/', # US State Dept
    'https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom', # UK FCDO
    'https://www.smartraveller.gov.au/rss.xml', # AU Travel
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom',
    'https://www.nhc.noaa.gov/rss_examples.php', # Hurricanes
    
    # --- BUSINESS & LOGISTICS ---
    'https://www.supplychainbrain.com/rss/logistics-and-transportation',
    'https://www.maritime-executive.com/rss/all/security',
    'https://www.ft.com/world/rss',
    'https://www.economist.com/the-world-this-week/rss.xml'
]

GEMINI_MODEL = "gemini-1.5-flash"

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def classify_region(text: str) -> str:
    t = text.lower()
    # Region Keywords
    if any(x in t for x in ["china", "hong kong", "taiwan", "japan", "india", "australia", "asia", "korea", "singapore", "malaysia", "vietnam", "thailand", "indonesia"]): return "APJC"
    if any(x in t for x in ["uk", "europe", "germany", "france", "africa", "middle east", "israel", "gaza", "ukraine", "russia", "london", "dubai", "paris"]): return "EMEA"
    if any(x in t for x in ["brazil", "mexico", "latin america", "colombia", "argentina", "chile", "peru", "venezuela"]): return "LATAM"
    if any(x in t for x in ["usa", "u.s.", "united states", "canada", "america", "texas", "california", "new york"]): return "AMER"
    return "Global"

def clean_html(html: str) -> str:
    if not html: return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_blocked(text: str) -> bool:
    t = text.lower()
    for word in BLOCKLIST:
        if word in t:
            return True
    return False

def ai_process(model, title, summary):
    """Returns (is_relevant, severity, new_summary)"""
    if not model:
        # Fallback if no AI: Keep logic simple
        t_low = (title + summary).lower()
        sev = 2
        if any(x in t_low for x in ["killed", "dead", "attack", "explosion", "breach", "ransomware"]): sev = 3
        return True, sev, summary[:200] + "..."

    prompt = f"""
    Role: Security Analyst for Dell Technologies SRO.
    Task: Filter news for Corporate Security relevance.

    Input:
    Title: {title}
    Summary: {summary}

    Rules:
    1. BLOCK (keep=false): Sports, Celebrity, Politics (unless violent/unrest), Post-incident recovery (e.g. "residents return", "cleaning up"), Generic financial news.
    2. KEEP (keep=true): Active/Ongoing threats to life/safety, Cyber attacks, Infrastructure failure, Strikes/Protests, Natural Disasters (active), Travel bans.
    3. Severity: 3 (Critical/Immediate Danger), 2 (Warning/Disruption), 1 (Info).
    4. One Liner: Write a crisp, executive summary (max 15 words) focusing on the IMPACT.

    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Impact summary"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary)
    except Exception as e:
        print(f"AI Error: {e}")
        return True, 2, summary 

def main():
    print("Fetching feeds...")
    all_items = []
    seen = set()
    model = init_gemini()

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            # Fetch top 10 items per feed to keep it fast but broad
            for e in f.entries[:10]:
                title = e.title.strip()
                if title in seen: continue
                seen.add(title)

                raw_summary = clean_html(getattr(e, "summary", ""))
                full_text = f"{title} {raw_summary}"

                # 1. Hard Blocklist Filter (Fastest)
                if is_blocked(full_text):
                    continue

                # 2. AI Processing
                keep, severity, snippet = ai_process(model, title, raw_summary)
                
                if not keep:
                    continue

                # 3. Build Object
                region = classify_region(full_text)
                
                # Timestamp parsing
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                all_items.append({
                    "title": title,
                    "url": e.link,
                    "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts,
                    "region": region,
                    "severity": severity,
                    "type": "GENERAL"
                })
                print(f"[+] Added: {title}")

        except Exception as x:
            print(f"Feed error {url}: {x}")

    # Sort by time desc
    all_items.sort(key=lambda x: x["time"], reverse=True)
    
    # Save
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)
    print(f"Saved {len(all_items)} articles to {NEWS_PATH}")

if __name__ == "__main__":
    main()
