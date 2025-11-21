import feedparser
import json
import os
import hashlib
from datetime import datetime
from difflib import SequenceMatcher

# --- CONFIGURATION: GLOBAL TRUSTED SOURCES ---
TRUSTED_SOURCES = {
    "http://feeds.bbci.co.uk/news/world/rss.xml": "BBC World News",
    "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best": "Reuters Global",
    "https://www.aljazeera.com/xml/rss/all.xml": "Al Jazeera",
    "https://www.dw.com/xml/rss/rss-n-all": "Deutsche Welle",
    "http://rss.cnn.com/rss/edition_world.rss": "CNN World",
    "https://www.nytimes.com/services/xml/rss/nyt/World.xml": "New York Times World",
    "https://www.theguardian.com/world/rss": "The Guardian World",
    "https://feeds.washingtonpost.com/rss/world": "The Washington Post World",
    "https://www.cnbc.com/id/100727362/device/rss/rss.html": "CNBC World News",
    "http://feeds.skynews.com/feeds/rss/world.xml": "Sky News (UK) World",
    "https://www.france24.com/en/rss": "France 24",
    "https://www.cbc.ca/webfeed/rss/rss-world": "CBC World (Canada)",
    "https://www.abc.net.au/news/feed/52278/rss.xml": "ABC News (Australia) Just In",
    "https://rss.upi.com/news/world_news.rss": "United Press International (UPI)",
    "http://www.xinhuanet.com/english/rss/world.xml": "Xinhua (China)",
    "https://english.kyodonews.net/rss/all.xml": "Kyodo News (Japan)",
    "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms": "Times of India World",
    "https://www.scmp.com/rss/91/feed": "South China Morning Post (HK)",
    "https://www.straitstimes.com/news/world/rss.xml": "The Straits Times (Singapore)",
    "https://www.japantimes.co.jp/feed": "The Japan Times",
    "https://kyivindependent.com/feed": "The Kyiv Independent",
    "https://www.themoscowtimes.com/rss/news": "The Moscow Times",
    "https://feeds.npr.org/1004/rss.xml": "NPR World (USA)",
    "https://www.cisa.gov/uscert/ncas/alerts.xml": "US CISA (Cyber Govt)",
    "https://gdacs.org/xml/rss.xml": "UN GDACS (Disaster Alert)",
    "https://reliefweb.int/updates/rss.xml": "UN ReliefWeb"
}

# Risk Keywords
KEYWORDS = {
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "attack", "shooting", "kidnap", "bomb", "assassination", "arrest", "conflict", "hostage"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway"],
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyberattack", "zero-day", "hacker", "phishing", "spyware"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "flood", "eruption", "volcano"]
}

def load_locations():
    try:
        with open('config/locations.json', 'r') as f:
            return json.load(f)
    except:
        return []

# --- UTILITY: FUZZY MATCHING ---
def is_similar(a, b):
    """Returns True if strings a and b are > 65% similar"""
    return SequenceMatcher(None, a, b).ratio() > 0.65

def analyze_article(title, summary, locations):
    text = (title + " " + summary).lower()
    
    # 1. Detect Category
    category = "Uncategorized"
    for cat, keys in KEYWORDS.items():
        if any(k in text for k in keys):
            category = cat
            break
    
    if category == "Uncategorized":
        return None 

    # 2. Detect Region & Proximity
    region = "Global"
    proximity_alert = False
    
    # Strict City Match
    for loc in locations:
        if loc['city'].lower() in text:
            region = loc['region']
            proximity_alert = True
            break
    
    # Broad Region Match
    if not proximity_alert:
        if any(x in text for x in ["asia", "china", "india", "japan", "australia", "singapore", "korea"]): region = "APJC"
        elif any(x in text for x in ["europe", "uk", "germany", "france", "ukraine", "russia", "middle east", "israel"]): region = "EMEA"
        elif any(x in text for x in ["usa", "america", "brazil", "mexico", "canada", "latin"]): region = "AMER"

    # 3. Calculate Severity
    severity = 1
    critical_terms = ["dead", "killed", "critical", "state of emergency", "catastrophic", "terrorist", "war declared"]
    warning_terms = ["injured", "severe", "outage", "threat", "warning", "strike", "riot", "cyberattack"]

    if any(x in text for x in critical_terms): severity = 3
    elif any(x in text for x in warning_terms): severity = 2
    
    if proximity_alert and severity < 3:
        severity += 1 

    return {
        "category": category,
        "severity": severity,
        "region": region,
        "proximity_alert": proximity_alert
    }

def fetch_news():
    locations = load_locations()
    raw_articles = []
    
    print("Scanning sources with Deduplication Engine active...")
    
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            if not feed.entries: continue

            for entry in feed.entries:
                title = entry.title
                summary = entry.summary if 'summary' in entry else ""
                link = entry.link
                pub_date = entry.published if 'published' in entry else str(datetime.now())
                
                if len(title) < 15: continue

                analysis = analyze_article(title, summary, locations)
                
                if analysis:
                    article_hash = hashlib.md5(title.encode()).hexdigest()
                    
                    raw_articles.append({
                        "id": article_hash,
                        "title": title,
                        "snippet": summary[:250] + "...",
                        "link": link,
                        "published": pub_date,
                        "source": source_name,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region']
                    })
        except Exception as e:
            print(f"Skipping {source_name}: {e}")

    # --- INTELLIGENT DEDUPLICATION ---
    # 1. Sort by Severity (High first) so we prioritize Critical alerts over duplicates
    raw_articles.sort(key=lambda x: x['severity'], reverse=True)
    
    final_articles = []
    
    for new_item in raw_articles:
        is_duplicate = False
        for existing_item in final_articles:
            # Check similarity ratio
            if is_similar(new_item['title'].lower(), existing_item['title'].lower()):
                is_duplicate = True
                break
        
        if not is_duplicate:
            final_articles.append(new_item)

    # Sort finally by Severity then Date for display
    final_articles = sorted(final_articles, key=lambda x: (x['severity'], x['published']), reverse=True)
    
    os.makedirs("public/data", exist_ok=True)
    with open("public/data/news.json", "w") as f:
        json.dump(list(final_articles), f, indent=2)
    
    print(f"Harvested {len(raw_articles)} raw items -> Reduced to {len(final_articles)} unique stories.")

if __name__ == "__main__":
    fetch_news()
