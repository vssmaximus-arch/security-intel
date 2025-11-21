import feedparser
import json
import os
import hashlib
from datetime import datetime

# --- CONFIGURATION: TIER 1 SOURCES ONLY ---
# We Map the URL to a clean, professional name. 
# If a feed isn't in this list, the agent will ignore it.
TRUSTED_SOURCES = {
    "http://feeds.bbci.co.uk/news/world/rss.xml": "BBC World News",
    "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best": "Reuters Global",
    "https://www.aljazeera.com/xml/rss/all.xml": "Al Jazeera",
    "https://www.dw.com/xml/rss/rss-n-all": "Deutsche Welle",
    "https://www.cisa.gov/uscert/ncas/alerts.xml": "US CISA (Cyber Govt)",
    "https://gdacs.org/xml/rss.xml": "UN GDACS (Disaster Alert)",
    "https://reliefweb.int/updates/rss.xml": "UN ReliefWeb"
}

# Risk Keywords (Refined for serious incidents only)
KEYWORDS = {
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "attack", "shooting", "kidnap", "bomb", "assassination"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo"],
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyberattack", "zero-day", "hacker"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude"]
}

def load_locations():
    try:
        with open('config/locations.json', 'r') as f:
            return json.load(f)
    except:
        return []

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
    
    for loc in locations:
        if loc['city'].lower() in text:
            region = loc['region']
            proximity_alert = True
            break
    
    if not proximity_alert:
        if "asia" in text or "china" in text or "india" in text or "japan" in text: region = "APJC"
        elif "europe" in text or "uk" in text or "germany" in text or "france" in text: region = "EMEA"
        elif "usa" in text or "america" in text or "brazil" in text or "mexico" in text: region = "AMER"

    # 3. Calculate Severity
    severity = 1
    critical_terms = ["dead", "killed", "critical", "state of emergency", "catastrophic", "terrorist"]
    warning_terms = ["injured", "severe", "outage", "threat", "warning", "strike"]

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
    all_articles = []
    
    print("Scanning Tier-1 Global Feeds...")
    
    # We only loop through our TRUSTED dictionary
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                title = entry.title
                summary = entry.summary if 'summary' in entry else ""
                link = entry.link
                # Use current time if feed doesn't provide one
                pub_date = entry.published if 'published' in entry else str(datetime.now())
                
                # FILTER: Skip short/empty items
                if len(title) < 10: continue

                analysis = analyze_article(title, summary, locations)
                
                if analysis:
                    # Create a hash to prevent duplicate stories
                    article_hash = hashlib.md5(title.encode()).hexdigest()
                    
                    all_articles.append({
                        "id": article_hash,
                        "title": title,
                        "snippet": summary[:250] + "...", # Clean snippet length
                        "link": link,
                        "published": pub_date,
                        "source": source_name, # Uses our clean Hardcoded Name
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region']
                    })
        except Exception as e:
            print(f"Skipping {source_name}: {e}")

    # Deduplicate (If BBC and Reuters report exact same headline, keep one)
    unique = {v['id']:v for v in all_articles}.values()
    
    # Sort: Critical first, then Newest
    sorted_news = sorted(unique, key=lambda x: (x['severity'], x['published']), reverse=True)
    
    os.makedirs("public/data", exist_ok=True)
    with open("public/data/news.json", "w") as f:
        json.dump(list(sorted_news), f, indent=2)
    
    print(f"Published {len(sorted_news)} verified intelligence items.")

if __name__ == "__main__":
    fetch_news()
