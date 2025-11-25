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
    "opinion", "review", "social media", "viral", "trend", "market", "shares", 
    "stocks", "investors", "investment", "profit", "revenue", "quarterly", 
    "earnings", "brands", "cosmetics", "luxury", "retail", "sales", "consumers", 
    "wealth", "billionaire", "rich list", "tourism", "holiday", "coroner", 
    "inquest", "inquiry", "historic", "memorial", "anniversary", 
    "blog is now closed", "live coverage", "follow our", "live blog", "stabbed",
    "stabbing", "arrested", "charged", "jail", "prison", "court", "cocaine", "drug"
]

# --- HARDCODED GEOCODER (Guarantees Map Pins) ---
CITY_COORDINATES = {
    "sydney": [-33.86, 151.20], "melbourne": [-37.81, 144.96], "brisbane": [-27.47, 153.02], "perth": [-31.95, 115.86], "canberra": [-35.28, 149.13],
    "tokyo": [35.67, 139.65], "osaka": [34.69, 135.50], "fukuoka": [33.59, 130.40], "seoul": [37.56, 126.97], "busan": [35.17, 129.07],
    "beijing": [39.90, 116.40], "shanghai": [31.23, 121.47], "hong kong": [22.31, 114.16], "taipei": [25.03, 121.56], "shenzhen": [22.54, 114.05],
    "bangalore": [12.97, 77.59], "mumbai": [19.07, 72.87], "delhi": [28.70, 77.10], "chennai": [13.08, 80.27], "hyderabad": [17.38, 78.48],
    "singapore": [1.35, 103.81], "bangkok": [13.75, 100.50], "hanoi": [21.02, 105.83], "jakarta": [-6.20, 106.84], "manila": [14.59, 120.98],
    "london": [51.50, -0.12], "paris": [48.85, 2.35], "berlin": [52.52, 13.40], "dubai": [25.20, 55.27], "tel aviv": [32.08, 34.78],
    "new york": [40.71, -74.00], "washington": [38.90, -77.03], "san francisco": [37.77, -122.41], "austin": [30.26, -97.74], "chicago": [41.87, -87.62]
}

DB_PATH = "public/data/news.json"
MAP_PATH = "public/map.html"

GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
    model = genai.GenerativeModel('gemini-pro') 
else:
    model = None

def clean_html(raw_html):
    cleanr = re.compile('<.*?>')
    text = re.sub(cleanr, '', raw_html)
    text = re.sub(r'http\S+', '', text)
    text = text.replace("Read full story", "").replace("&nbsp;", " ")
    return text.strip()

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
    Task: Filter, Categorize, and Rewrite this news.
    
    Headline: "{title}"
    Snippet: "{snippet}"
    
    RULES:
    1. DISCARD (Return Irrelevant) if: Business, Politics, Social Issues, General Crime (murder/stabbing/drugs/arrests).
    2. KEEP if: Terrorism, War, Mass Casualty, Infrastructure/Logistics Failure, Cyber Attack, Major Disaster.
    
    Output JSON: {{ "category": "Physical Security"|"Cyber"|"Logistics"|"Weather/Event"|"Irrelevant", "severity": 1-3, "clean_title": "Short Professional Title", "summary": "1 sentence impact.", "region": "AMER"|"EMEA"|"APJC"|"Global", "lat": 0.0, "lon": 0.0 }}
    """
    try:
        time.sleep(1.5)
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except: return None

def get_hardcoded_coords(text):
    # Check if any known city is in the text
    for city, coords in CITY_COORDINATES.items():
        if city in text.lower():
            return coords[0], coords[1]
    return 0.0, 0.0

def analyze_article_hybrid(title, summary, source_name):
    text = (title + " " + summary).lower()
    if any(block in text for block in BLOCKED_KEYWORDS): return None

    ai_result = ask_gemini_analyst(title, summary)
    
    if ai_result:
        if ai_result.get('category') == "Irrelevant": return None
        
        # Override 0.0 coords with Hardcoded City DB if available
        lat = ai_result.get('lat', 0.0)
        lon = ai_result.get('lon', 0.0)
        if lat == 0.0:
            lat, lon = get_hardcoded_coords(text)

        return {
            "category": ai_result.get('category', "Uncategorized"),
            "severity": ai_result.get('severity', 1),
            "region": ai_result.get('region', "Global"),
            "clean_title": ai_result.get('clean_title', title),
            "ai_summary": ai_result.get('summary', summary),
            "lat": lat,
            "lon": lon
        }
    return None

def generate_interactive_map(articles):
    m = folium.Map(location=[20, 0], zoom_start=3, min_zoom=3, max_bounds=True, tiles=None)
    folium.TileLayer("cartodb positron", no_wrap=True, min_zoom=3).add_to(m)
    
    for item in articles:
        lat = item.get('lat')
        lon = item.get('lon')
        if lat and lon and (lat != 0.0 or lon != 0.0):
            color = "blue"
            if item['severity'] == 3: color = "red"
            elif item['severity'] == 2: color = "orange"
            
            popup_html = f"<div style='font-family:Arial;width:200px'><b>{item['title']}</b><br><span style='color:gray;font-size:12px'>{item['category']}</span></div>"
            folium.Marker([lat, lon], popup=folium.Popup(popup_html, max_width=250), icon=folium.Icon(color=color, icon="info-sign")).add_to(m)
    m.save(MAP_PATH)

def fetch_news():
    all_candidates = []
    
    # Load History (Append Mode)
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                all_candidates = json.load(f)
        except: pass

    print("Scanning feeds...")
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]: 
                title = entry.title
                if len(title) < 15: continue
                
                # Check Duplicate by Title Similarity
                is_dup = False
                for old in all_candidates:
                    if SequenceMatcher(None, title, old.get('original_title', old['title'])).ratio() > 0.65:
                        is_dup = True
                        break
                if is_dup: continue

                clean_summary = clean_html(entry.summary if 'summary' in entry else "")
                analysis = analyze_article_hybrid(title, clean_summary, source_name)
                
                if analysis:
                    all_candidates.append({
                        "id": hashlib.md5(title.encode()).hexdigest(),
                        "title": analysis['clean_title'],
                        "original_title": title, # Keep for dedup
                        "snippet": analysis['ai_summary'],
                        "link": entry.link,
                        "published": parse_date(entry)[1],
                        "date_str": parse_date(entry)[0],
                        "timestamp": parse_date(entry)[2],
                        "source": source_name,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region'],
                        "lat": analysis.get('lat'),
                        "lon": analysis.get('lon')
                    })
        except Exception as e: print(f"Error {source_name}: {e}")

    # Sort & Save
    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    if len(all_candidates) > 1000: all_candidates = all_candidates[:1000] # Keep DB light

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f: json.dump(all_candidates, f, indent=2)
    
    generate_interactive_map(all_candidates)

if __name__ == "__main__":
    fetch_news()
