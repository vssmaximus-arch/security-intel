import feedparser
import json
import os
import hashlib
import re
from datetime import datetime
from difflib import SequenceMatcher
from time import mktime

# --- CONFIGURATION: YOUR EXACT TRUSTED SOURCES ---
TRUSTED_SOURCES = {
    "http://feeds.bbci.co.uk/news/world/rss.xml": "BBC World News",
    "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best": "Reuters Global",
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

KEYWORDS = {
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyber", "zero-day", "hacker", "phishing", "spyware", "trojan", "botnet"],
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "shooting", "kidnap", "bomb", "assassination", "arrest", "conflict", "hostage", "armed attack", "violence", "hate crime", "stabbing"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "flood", "eruption", "volcano"]
}

DB_PATH = "public/data/news.json"

def clean_html(raw_html):
    """Removes images and HTML tags from summaries"""
    cleanr = re.compile('<.*?>')
    cleantext = re.sub(cleanr, '', raw_html)
    return cleantext.strip()

def load_locations():
    try:
        with open('config/locations.json', 'r') as f:
            return json.load(f)
    except:
        return []

def parse_date(entry):
    try:
        if 'published_parsed' in entry:
            dt = datetime.fromtimestamp(mktime(entry.published_parsed))
            return dt.strftime("%Y-%m-%d"), dt.isoformat()
        else:
            now = datetime.now()
            return now.strftime("%Y-%m-%d"), now.isoformat()
    except:
        now = datetime.now()
        return now.strftime("%Y-%m-%d"), now.isoformat()

def is_similar(a, b):
    # Returns True if titles are > 60% similar
    return SequenceMatcher(None, a, b).ratio() > 0.60

def analyze_article(title, summary, source_name, locations):
    text = (title + " " + summary).lower()
    
    if "CISA" in source_name or "Cyber" in source_name: category = "Cyber"
    elif "GDACS" in source_name or "Earthquake" in source_name: category = "Weather/Event"
    else:
        category = "Uncategorized"
        for cat, keys in KEYWORDS.items():
            if any(k in text for k in keys):
                category = cat
                break 
    
    if category == "Uncategorized": return None 

    region = "Global"
    proximity_alert = False
    for loc in locations:
        if loc['city'].lower() in text:
            region = loc['region']
            proximity_alert = True
            break
    if not proximity_alert:
        if any(x in text for x in ["asia", "china", "india", "japan", "australia", "singapore", "korea"]): region = "APJC"
        elif any(x in text for x in ["europe", "uk", "germany", "france", "ukraine", "russia", "middle east", "israel"]): region = "EMEA"
        elif any(x in text for x in ["usa", "america", "brazil", "mexico", "canada", "latin"]): region = "AMER"

    severity = 1
    if any(x in text for x in ["dead", "killed", "critical", "state of emergency", "catastrophic", "terrorist", "war declared"]): severity = 3
    elif any(x in text for x in ["injured", "severe", "outage", "threat", "warning", "strike", "riot", "cyberattack", "ransomware"]): severity = 2
    if proximity_alert and severity < 3: severity += 1 

    return {"category": category, "severity": severity, "region": region, "proximity_alert": proximity_alert}

def fetch_news():
    locations = load_locations()
    
    # 1. LOAD ALL CANDIDATES
    all_candidates = []
    
    # Load History
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                history = json.load(f)
                
                # --- COMPLIANCE PURGE ---
                # Only keep items if their source is in the CURRENT Allowed List
                allowed_names = list(TRUSTED_SOURCES.values())
                
                print(f"Checking {len(history)} history items for compliance...")
                for item in history:
                    if item['source'] in allowed_names:
                        all_candidates.append(item)
                    else:
                        print(f"Purging banned source: {item['source']}")
                # ------------------------
        except: pass

    # Fetch New
    print("Scanning feeds...")
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            if not feed.entries: continue

            for entry in feed.entries:
                title = entry.title
                if len(title) < 15: continue
                
                # CLEAN HTML (Removes Images)
                raw_summary = entry.summary if 'summary' in entry else ""
                clean_summary = clean_html(raw_summary)
                
                clean_date, full_date = parse_date(entry) 
                
                analysis = analyze_article(title, clean_summary, source_name, locations)
                
                if analysis:
                    article_hash = hashlib.md5(title.encode()).hexdigest()
                    all_candidates.append({
                        "id": article_hash,
                        "title": title,
                        "snippet": clean_summary[:250] + "...",
                        "link": entry.link,
                        "published": full_date,
                        "date_str": clean_date,
                        "source": source_name,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region']
                    })
        except Exception as e:
            print(f"Skipping {source_name}: {e}")

    # 2. STRICT SORT: Date (Newest) -> Severity (Highest)
    all_candidates.sort(key=lambda x: (x.get('published', ''), x.get('severity', 1)), reverse=True)
    
    # 3. DEDUPLICATE
    clean_list = []
    seen_titles = []

    print(f"Processing {len(all_candidates)} items...")

    for item in all_candidates:
        is_duplicate = False
        current_title = item['title'].lower()
        
        for seen in seen_titles:
            if is_similar(current_title, seen):
                is_duplicate = True
                break
        
        if not is_duplicate:
            clean_list.append(item)
            seen_titles.append(current_title)

    # 4. SAVE
    if len(clean_list) > 1000: clean_list = clean_list[:1000]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(clean_list, f, indent=2)
    
    print(f"Database clean. Saved {len(clean_list)} items.")

if __name__ == "__main__":
    fetch_news()
