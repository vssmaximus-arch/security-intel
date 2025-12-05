import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
import feedparser
from bs4 import BeautifulSoup
import re

try:
    import google.generativeai as genai
except Exception:
    genai = None

# ---------- PATHS ----------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# ---------- CONFIGURATION ----------
GEMINI_MODEL = "gemini-1.5-flash"

# ---------- FULL 110+ FEED LIST ----------
FEEDS = [
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
    "https://www.crisisgroup.org/rss.xml",
    "https://reliefweb.int/updates/rss.xml",
    "https://www.globalsecurity.org/military/world/rss.xml",
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
    "https://alerts.weather.gov/cap/us.php?x=0",
    "https://www.jma.go.jp/bosai/feed/rss/eqvol.xml",
    "https://www.jma.go.jp/bosai/feed/rss/warn.xml",
    "https://www.metoffice.gov.uk/public/data/PWSCache/FeedsRSSAll?format=xml",
    "https://feeds.meteoalarm.org/RSS",
    "https://www.emsc-csem.org/service/rss/rss.php?typ=emsc",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.atom",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",
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
    "https://www.wmo.int/rss",
    "https://www.weather.gov/rss_page.php",
    "https://www.emergencyemail.org/rss.aspx",
    "https://www.ifrc.org/feeds/all.xml",
    "https://english.alarabiya.net/.mrss/en.xml",
    "https://www.africanews.com/feed/xml",
    "https://www.latinnews.com/index.php?format=feed&type=rss",
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed"
]

# Basic Blocklist for obvious noise before AI processing (Cost/Time Saving)
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament",
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "opinion:", "editorial:", "review:", "cultivation", "poppy", "drug trade", "estate dispute",
    "husband", "wife", "marriage", "divorce", "dating", "best of", "top 10"
]

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None: return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def clean_html(html):
    if not html: return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_obviously_irrelevant(text):
    """Fast filter to drop obvious noise before calling AI."""
    text = text.lower()
    for word in BLOCKLIST:
        if word in text: return True
    return False

def map_region(ai_geo_data, text_fallback):
    """Maps AI Geo output or fallback text to Dashboard Regions."""
    # If AI returned a list of countries, check them
    text_to_check = ""
    if isinstance(ai_geo_data, dict):
        text_to_check = " ".join(ai_geo_data.get("mentioned_countries_or_cities", []))
    
    if not text_to_check:
        text_to_check = text_fallback

    t = text_to_check.lower()
    
    if any(x in t for x in ["china", "asia", "india", "japan", "australia", "thailand", "vietnam", "indonesia", "malaysia", "singapore", "korea", "taiwan", "philippines"]): return "APJC"
    if any(x in t for x in ["uk", "europe", "germany", "france", "poland", "ireland", "israel", "gaza", "russia", "ukraine", "middle east", "africa", "netherlands", "sweden", "spain", "italy"]): return "EMEA"
    if any(x in t for x in ["usa", "america", "canada", "brazil", "mexico", "colombia", "argentina", "chile", "peru", "panama"]): return "AMER"
    
    return "Global"

def ai_analyze_article(model, title, body, source):
    """
    Uses the specific Security News Classifier persona.
    """
    if not model:
        # Fallback if no AI key
        return None

    prompt = f"""
    ROLE & GOAL
    You are a security news classifier for a global technology company (Dell Technologies).

    Your job:
    1. Decide if a news article is relevant to:
       - Physical security (sites, people, events)
       - Supply chain / logistics security
       - Major cyber incidents that could affect operations, partners or core IT providers
    2. Assign it to the correct category.
    3. Assess severity and how likely it is to matter for corporate security.
    4. Return a structured JSON object, and nothing else.

    CATEGORIES:
    1) PHYSICAL_SECURITY: Protests, riots, terror, war, natural disasters, major crime.
    2) SUPPLY_CHAIN_SECURITY: Port closures, shipping attacks, rail/truck strikes, airport closures, export bans.
    3) CYBER_SECURITY_MAJOR: Global outages, ransomware on critical infra, big data breaches.
    4) NOT_RELEVANT: Politics, sports, opinion, minor incidents.

    INPUT ARTICLE:
    - Title: {title}
    - Body: {body[:600]}...
    - Source: {source}

    OUTPUT FORMAT (JSON ONLY):
    {{
      "category": "PHYSICAL_SECURITY | SUPPLY_CHAIN_SECURITY | CYBER_SECURITY_MAJOR | NOT_RELEVANT",
      "likelihood_relevant": integer 0-100,
      "severity": "LOW | MEDIUM | HIGH | CRITICAL",
      "primary_reason": "short one-sentence explanation focusing on business/security impact",
      "geo_relevance": {{
        "mentioned_countries_or_cities": ["list", "of", "locations"]
      }}
    }}
    """
    
    try:
        resp = model.generate_content(prompt)
        # Clean up potential markdown formatting
        clean_json = resp.text.strip().replace('```json', '').replace('```', '')
        return json.loads(clean_json)
    except Exception as e:
        print(f"AI Processing Error: {e}")
        return None

def main():
    print(f"Starting SRO Intel Ingest on {len(FEEDS)} feeds...")
    all_items = []
    seen = set()
    model = init_gemini()

    # Limit to check per feed to keep runtime reasonable (adjust as needed)
    CHECK_LIMIT = 3

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            print(f"Scanning: {url}...")
            
            for e in f.entries[:CHECK_LIMIT]:
                title = e.title.strip()
                # Deduplication
                if title in seen: continue
                seen.add(title)
                
                raw_summary = clean_html(getattr(e, "summary", ""))
                full_text = f"{title} {raw_summary}"
                
                # 1. Fast Blocklist
                if is_obviously_irrelevant(full_text):
                    continue

                # 2. AI Analysis
                analysis = ai_analyze_article(model, title, raw_summary, url)
                
                if not analysis: continue
                
                # 3. Filtering Decision
                # Only keep if category is NOT 'NOT_RELEVANT' and likelihood is high enough
                cat = analysis.get("category", "NOT_RELEVANT")
                score = analysis.get("likelihood_relevant", 0)
                
                if cat == "NOT_RELEVANT" or score < 45:
                    continue

                # 4. Map AI Output to Dashboard Schema
                
                # Map Severity
                sev_str = analysis.get("severity", "LOW")
                severity = 1
                if sev_str == "MEDIUM": severity = 2
                if sev_str in ["HIGH", "CRITICAL"]: severity = 3

                # Map Category to Dashboard Types
                dash_type = "GENERAL"
                if cat == "PHYSICAL_SECURITY": dash_type = "PHYSICAL SECURITY"
                if cat == "SUPPLY_CHAIN_SECURITY": dash_type = "SUPPLY CHAIN"
                if cat == "CYBER_SECURITY_MAJOR": dash_type = "CYBER SECURITY"
                
                # Map Region
                geo_data = analysis.get("geo_relevance", {})
                region = map_region(geo_data, full_text)

                # Timestamp
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                # Use the AI's "primary_reason" as the snippet for the dashboard
                snippet = analysis.get("primary_reason", raw_summary[:150])

                item = {
                    "title": title,
                    "url": e.link,
                    "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts,
                    "region": region,
                    "severity": severity,
                    "type": dash_type
                }
                
                all_items.append(item)
                print(f"[+] KEPT: [{dash_type}] {title}")

        except Exception as x:
            print(f"Feed Error {url}: {x}")

    # Sort by time
    all_items.sort(key=lambda x: x["time"], reverse=True)
    
    # Save
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)
    
    print(f"Ingest Complete. Saved {len(all_items)} SRO-relevant articles.")

if __name__ == "__main__":
    main()
