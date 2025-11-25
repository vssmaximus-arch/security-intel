import feedparser
import json
import os
import hashlib
import re
import time
import folium
import google.generativeai as genai
from datetime import datetime
from difflib import SequenceMatcher
from time import mktime

# --- CONFIGURATION ---
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

BLOCKED_KEYWORDS = [
    "entertainment", "celebrity", "movie", "film", "star", "actor", "actress", 
    "music", "song", "chart", "concert", "sport", "football", "cricket", "rugby", 
    "tennis", "olympic", "strictly come dancing", "reality tv", "royal", "prince", 
    "princess", "gossip", "dating", "fashion", "lifestyle", "sexual assault", 
    "rape", "domestic", "murder trial", "hate speech", "convicted", "podcast",
    "claims", "alleges", "survey", "poll", "pledges", "vows", "commentary",
    "opinion", "review", "social media", "viral", "trend",
    "market", "shares", "stocks", "investors", "investment", "profit", "revenue",
    "quarterly", "earnings", "brands", "cosmetics", "luxury", "retail", "sales",
    "consumers", "wealth", "billionaire", "rich list", "tourism", "holiday",
    "coroner", "inquest", "inquiry", "historic", "memorial", "anniversary",
    "blog is now closed", "live coverage", "follow our", "live blog"
]

KEYWORDS = {
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyber", "zero-day", "hacker", "botnet"],
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "shooting", "kidnap", "bomb", "assassination", "hostage", "armed attack", "active shooter", "mob violence", "insurgency", "coup"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway", "border crossing"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "severe flood", "flood warning", "flash flood", "eruption", "volcano"]
}

DB_PATH = "public/data/news.json"
MAP_PATH = "public/map.html"

GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
    model = genai.GenerativeModel('gemini-pro') 
else:
    model = None

# --- NUCLEAR CLEANER ---
def clean_text(text):
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Remove URLs
    text = re.sub(r'http\S+', '', text)
    # Remove weird characters and smart quotes
    text = text.replace("’", "'").replace("“", '"').replace("”", '"').replace("…", "...")
    # Remove "Read full story" or "Continue reading" junk
    text = re.sub(r'Read\s+full\s+story.*', '', text, flags=re.IGNORECASE)
    text = text.replace("&nbsp;", " ")
    return text.strip()

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
            return dt.strftime("%Y-%m-%d"), dt.isoformat(), dt.timestamp()
        else:
            now = datetime.now()
            return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()
    except:
        now = datetime.now()
        return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()

def ask_gemini_analyst(title, snippet):
    if not model: return None
    
    prompt = f"""
    Role: Corporate Security Intelligence Analyst.
    Task: Filter, Categorize, and Rewrite this news item.
    
    Input Headline: "{title}"
    Input Snippet: "{snippet}"
    
    STRICT RULES:
    1. IF this is about Business (Stocks/Brands), Politics (Polls/Speeches), Social Issues, or Individual Crime -> RETURN "Irrelevant".
    2. IF this is a real threat (Cyber, Terror, Disaster, Riots) -> KEEP IT.
    
    OUTPUT JSON FORMAT:
    {{
        "category": "Physical Security" | "Cyber" | "Logistics" | "Weather/Event" | "Irrelevant",
        "severity": 1 | 2 | 3,
        "clean_title": "Write a professional, clear headline (No clickbait)",
        "summary": "Write 1 concise sentence on the operational impact.",
        "region": "AMER" | "EMEA" | "APJC" | "Global",
        "lat": 0.0,
        "lon": 0.0
    }}
    
    NOTE on Region: 
    - US, Canada, LatAm = AMER.
    - UK, Europe, Middle East, Africa = EMEA.
    - Asia, Australia, NZ, India, China, Japan = APJC.
    """
    
    try:
        time.sleep(1.5)
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except Exception as e:
        print(f"AI Error: {e}")
        return None

def analyze_article_hybrid(title, summary, source_name, locations):
    # 1. Noise Block
    if any(block in (title + summary).lower() for block in BLOCKED_KEYWORDS): return None

    # 2. AI Analysis
    ai_result = ask_gemini_analyst(title, summary)
    
    if ai_result:
        if ai_result.get('category') == "Irrelevant": return None
        
        # TRUST THE AI'S REGION - It is smarter than keywords
        return {
            "category": ai_result.get('category', "Uncategorized"),
            "severity": ai_result.get('severity', 1),
            "region": ai_result.get('region', "Global"), # Use AI region
            "clean_title": ai_result.get('clean_title', title),
            "ai_summary": ai_result.get('summary', summary),
            "lat": ai_result.get('lat', 0.0),
            "lon": ai_result.get('lon', 0.0)
        }
    return None

def generate_interactive_map(articles):
    m = folium.Map(location=[20, 0], zoom_start=3, min_zoom=2, max_bounds=True, tiles=None)
    folium.TileLayer("cartodb positron", no_wrap=True).add_to(m)
    
    for item in articles:
        lat = item.get('lat')
        lon = item.get('lon')
        if lat and lon and (lat != 0.0 or lon != 0.0):
            color = "blue"
            if item['severity'] == 3: color = "red"
            elif item['severity'] == 2: color = "orange"
            
            popup_html = f"<b>{item['title']}</b><br><span style='color:gray'>{item['category']}</span>"
            folium.Marker([lat, lon], popup=folium.Popup(popup_html, max_width=250), icon=folium.Icon(color=color, icon="info-sign")).add_to(m)
    m.save(MAP_PATH)

def fetch_news():
    allowed_names = list(TRUSTED_SOURCES.values())
    all_candidates = []
    
    # Load History & Re-Clean
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                history = json.load(f)
                for item in history:
                    # Re-run blocklist on old items
                    if not any(b in (item['title']+item['snippet']).lower() for b in BLOCKED_KEYWORDS):
                        all_candidates.append(item)
        except: pass

    print("Scanning feeds...")
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            if not feed.entries: continue

            for entry in feed.entries[:5]: 
                title = entry.title
                if len(title) < 15: continue
                
                raw_summary = entry.summary if 'summary' in entry else ""
                clean_summary = clean_html(raw_summary)
                clean_date, full_date, timestamp = parse_date(entry) 
                
                # DEDUPLICATION CHECK BEFORE AI (Saves Money/Time)
                is_dup = False
                for old in all_candidates:
                    if SequenceMatcher(None, title, old['title']).ratio() > 0.70: # 70% match = Duplicate
                        is_dup = True
                        break
                if is_dup: continue

                analysis = analyze_article_hybrid(title, clean_summary, source_name, [])
                
                if analysis:
                    article_hash = hashlib.md5(title.encode()).hexdigest()
                    all_candidates.append({
                        "id": article_hash,
                        "title": analysis['clean_title'], # Use Clean AI Title
                        "snippet": analysis['ai_summary'], # Use Clean AI Summary
                        "link": entry.link,
                        "published": full_date,
                        "date_str": clean_date,
                        "timestamp": timestamp,
                        "source": source_name,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region'], # Use AI Region
                        "lat": analysis.get('lat'),
                        "lon": analysis.get('lon')
                    })
        except Exception as e:
            print(f"Skipping {source_name}: {e}")

    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    
    # Final Dedup
    unique_list = []
    seen_titles = []
    for item in all_candidates:
        if item['title'] not in seen_titles:
            unique_list.append(item)
            seen_titles.append(item['title'])

    if len(unique_list) > 1000: unique_list = unique_list[:1000]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(unique_list, f, indent=2)
    
    generate_interactive_map(unique_list)
    print(f"Database refined. {len(unique_list)} items active.")

if __name__ == "__main__":
    fetch_news()
