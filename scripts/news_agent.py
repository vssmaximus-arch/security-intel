import feedparser
import json
import os
import hashlib
from datetime import datetime

# --- CONFIGURATION ---
# Global reliable feeds
RSS_FEEDS = [
    "http://feeds.bbci.co.uk/news/world/rss.xml", 
    "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best",
    "https://www.cisa.gov/uscert/ncas/alerts.xml",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://gdacs.org/xml/rss.xml",
    "https://reliefweb.int/updates/rss.xml"
]

# Risk Keywords
KEYWORDS = {
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "attack", "shooting", "kidnap"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "delay"],
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyberattack", "hacker"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "flood", "wildfire", "storm"]
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
        if "asia" in text or "china" in text or "india" in text: region = "APJC"
        elif "europe" in text or "uk" in text or "germany" in text: region = "EMEA"
        elif "usa" in text or "america" in text or "brazil" in text: region = "AMER"

    # 3. Calculate Severity
    severity = 1
    critical_terms = ["dead", "killed", "critical", "emergency", "catastrophic"]
    warning_terms = ["injured", "severe", "outage", "threat", "warning"]

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
    
    print("Scanning global feeds for security-intel...")
    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                title = entry.title
                summary = entry.summary if 'summary' in entry else ""
                link = entry.link
                pub_date = entry.published if 'published' in entry else str(datetime.now())
                source = feed.feed.title if 'title' in feed.feed else "Unknown"
                
                analysis = analyze_article(title, summary, locations)
                
                if analysis:
                    article_hash = hashlib.md5(title.encode()).hexdigest()
                    all_articles.append({
                        "id": article_hash,
                        "title": title,
                        "snippet": summary[:200] + "...",
                        "link": link,
                        "published": pub_date,
                        "source": source,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region']
                    })
        except Exception as e:
            print(f"Skipping {url}: {e}")

    # Remove duplicates and Sort
    unique = {v['id']:v for v in all_articles}.values()
    sorted_news = sorted(unique, key=lambda x: (x['severity'], x['published']), reverse=True)
    
    # Save Data
    os.makedirs("public/data", exist_ok=True)
    with open("public/data/news.json", "w") as f:
        json.dump(list(sorted_news), f, indent=2)
    
    print(f"Published {len(sorted_news)} intelligence items to security-intel.")

if __name__ == "__main__":
    fetch_news()
