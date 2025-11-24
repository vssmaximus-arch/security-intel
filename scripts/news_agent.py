import feedparser
import json
import os
import hashlib
import re
from datetime import datetime
from difflib import SequenceMatcher
from time import mktime

# --- CONFIGURATION: TRUSTED SOURCES ---
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

# --- NOISE FILTER: The Blocklist ---
# If ANY of these words appear, the story is deleted.
BLOCKED_KEYWORDS = [
    "entertainment", "celebrity", "movie", "film", "star", "actor", "actress", 
    "music", "song", "chart", "concert", "sport", "football", "cricket", "rugby", 
    "tennis", "olympic", "strictly come dancing", "reality tv", "royal", "prince", 
    "princess", "gossip", "dating", "fashion", "lifestyle", "sexual assault", 
    "rape", "domestic", "murder trial", "hate speech", "convicted"
]

# --- RISK KEYWORDS (Tightened for Corporate Security) ---
KEYWORDS = {
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyber", "zero-day", "hacker", "phishing", "spyware", "trojan", "botnet"],
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "shooting", "kidnap", "bomb", "assassination", "conflict", "hostage", "armed attack", "active shooter", "mob violence", "insurgency", "coup"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway", "border crossing"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "flood", "eruption", "volcano"]
}

DB_PATH = "public/data/news.json"

def clean_html(raw_html):
    cleanr = re.compile('<.*?>')
    return re.sub(cleanr, '', raw_html).strip()

def load_locations():
    try:
        with open('config/locations.json', 'r') as f:
            return json.load(f)
    except:
        return []

def parse_date(entry):
    """Returns (CleanString, ISOString, UnixTimestamp)"""
    try:
        if 'published_parsed' in entry:
            dt = datetime.fromtimestamp(mktime(entry.published_parsed))
            return dt.strftime("%Y-%m-%d"), dt.isoformat(), dt.timestamp()
        else:
            now = datetime.now()
            return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()
    except:
        now = datetime.now()
        return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()

def is_similar(a, b):
    return SequenceMatcher(None, a, b).ratio() > 0.60

def analyze_article(title, summary, source_name, locations):
    text = (title + " " + summary).lower()
    
    # 1. NOISE FILTER (Blocklist Check)
    if any(block in text for block in BLOCKED_KEYWORDS):
        return None # Delete immediately

    # 2. Source Override
    if "CISA" in source_name or "Cyber" in source_name: category = "Cyber"
    elif "GDACS" in source_name or "Earthquake" in source_name: category = "Weather/Event"
    else:
        # 3. Keyword Detection
        category = "Uncategorized"
        for cat, keys in KEYWORDS.items():
            if any(k in text for k in keys):
                category = cat
                break 
    
    if category == "Uncategorized": return None 

    # 4. Region & Proximity
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

    # 5. Severity
    severity = 1
    if any(x in text for x in ["dead", "killed", "critical", "state of emergency", "catastrophic", "terrorist", "war declared"]): severity = 3
    elif any(x in text for x in ["injured", "severe", "outage", "threat", "warning", "strike", "riot", "cyberattack", "ransomware"]): severity = 2
    if proximity_alert and severity < 3: severity += 1 

    return {"category": category, "severity": severity, "region": region, "proximity_alert": proximity_alert}

def fetch_news():
    locations = load_locations()
    allowed_names = list(TRUSTED_SOURCES.values())
    all_candidates = []
    
    # 1. LOAD HISTORY & FILTER
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                history = json.load(f)
                for item in history:
                    # Filter 1: Must be in trusted sources
                    if item['source'] not in allowed_names: continue
                    # Filter 2: Must NOT contain blocked words (Retroactive Cleaning)
                    combined_text = (item['title'] + " " + item['snippet']).lower()
                    if any(block in combined_text for block in BLOCKED_KEYWORDS): continue
                    
                    all_candidates.append(item)
        except: pass

    # 2. FETCH NEW
    print("Scanning feeds...")
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            if not feed.entries: continue

            for entry in feed.entries:
                title = entry.title
                if len(title) < 15: continue
                
                raw_summary = entry.summary if 'summary' in entry else ""
                clean_summary = clean_html(raw_summary)
                clean_date, full_date, timestamp = parse_date(entry) 
                
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
                        "timestamp": timestamp, # Critical for sorting
                        "source": source_name,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region']
                    })
        except Exception as e:
            print(f"Skipping {source_name}: {e}")

    # 3. SORT BY TIMESTAMP (Strict Chronological)
    # Using 'timestamp' float ensures perfect sorting compared to strings
    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    
    # 4. DEDUPLICATE
    clean_list = []
    seen_titles = []
    for item in all_candidates:
        if is_similar(item['title'].lower(), seen_titles): continue
        clean_list.append(item)
        seen_titles.append(item['title'].lower())
        
        # Helper for list check
    def is_similar(new_t, existing_list):
        for old_t in existing_list:
            if SequenceMatcher(None, new_t, old_t).ratio() > 0.60: return True
        return False

    # 5. SAVE
    if len(clean_list) > 1000: clean_list = clean_list[:1000]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(clean_list, f, indent=2)
    
    print(f"Database refined. {len(clean_list)} items active.")

if __name__ == "__main__":
    fetch_news()
