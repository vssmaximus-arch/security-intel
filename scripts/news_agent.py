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

# --- CONFIGURATION: SRO INTEL SOURCES ---
TRUSTED_SOURCES = {
    # GLOBAL WIRES (The Baseline)
    "http://feeds.bbci.co.uk/news/world/rss.xml": "BBC World Service",
    "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best": "Reuters Global",
    "https://apnews.com/hub/ap-top-news.rss": "Associated Press",
    "https://www.dw.com/xml/rss/rss-n-all": "Deutsche Welle",
    
    # DUTY OF CARE & TRAVEL RISK
    "https://travel.state.gov/_res/rss/TAs_TWs.xml": "US State Dept Travel",
    "https://www.smartraveller.gov.au/rss": "Aus Smartraveller",
    "https://gdacs.org/xml/rss.xml": "UN GDACS (Disaster Alert)",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom": "USGS Seismic Alert",
    
    # REGIONAL (APJC Focus)
    "https://www.channelnewsasia.com/api/v1/rss-feeds/asia": "Channel News Asia",
    "https://www.scmp.com/rss/91/feed": "South China Morning Post",
    "https://www.straitstimes.com/news/world/rss.xml": "The Straits Times",
    "https://en.yna.co.kr/RSS/news.xml": "Yonhap News (Korea)",
    "https://english.kyodonews.net/rss/news.xml": "Kyodo News (Japan)",
    
    # SUPPLY CHAIN & RESILIENCY
    "https://theloadstar.com/feed/": "The Loadstar (Logistics)",
    "https://www.maritime-executive.com/rss/news": "The Maritime Executive",
    "https://splash247.com/feed/": "Splash247 (Asian Maritime)",
    
    # CYBER (Strategic Only)
    "https://www.cisa.gov/uscert/ncas/alerts.xml": "US CISA (Cyber Govt)",
    "https://www.bleepingcomputer.com/feed/": "BleepingComputer"
}

# --- NOISE FILTER ---
# Block "Low Value" items that clutter executive feeds
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
    "blog is now closed", "live coverage", "follow our", "live blog", "crypto", "bitcoin"
]

# --- SRO CATEGORIES ---
# Used for pre-filtering before AI takes over
KEYWORDS = {
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyber", "hacker", "botnet", "apt group"],
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "shooting", "kidnap", "bomb", "assassination", "hostage", "armed attack", "active shooter", "mob violence", "insurgency", "coup", "civil unrest"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway", "border crossing", "flight cancellation"],
    "Infrastructure": ["power outage", "grid failure", "blackout", "telecom outage", "internet disruption", "undersea cable", "fiber cut", "water supply", "gas leak", "dam failure", "bridge collapse"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "severe flood", "flood warning", "flash flood", "eruption", "volcano"]
}

DB_PATH = "public/data/news.json"
MAP_PATH = "public/map.html"

# --- GEOCODER ---
CITY_COORDINATES = {
    "sydney": [-33.86, 151.20], "melbourne": [-37.81, 144.96], "brisbane": [-27.47, 153.02], "perth": [-31.95, 115.86], "canberra": [-35.28, 149.13],
    "tokyo": [35.67, 139.65], "osaka": [34.69, 135.50], "fukuoka": [33.59, 130.40], "seoul": [37.56, 126.97], "busan": [35.17, 129.07],
    "beijing": [39.90, 116.40], "shanghai": [31.23, 121.47], "hong kong": [22.31, 114.16], "taipei": [25.03, 121.56], "shenzhen": [22.54, 114.05],
    "bangalore": [12.97, 77.59], "mumbai": [19.07, 72.87], "delhi": [28.70, 77.10], "chennai": [13.08, 80.27], "hyderabad": [17.38, 78.48],
    "singapore": [1.35, 103.81], "bangkok": [13.75, 100.50], "hanoi": [21.02, 105.83], "jakarta": [-6.20, 106.84], "manila": [14.59, 120.98],
    "london": [51.50, -0.12], "paris": [48.85, 2.35], "berlin": [52.52, 13.40], "dubai": [25.20, 55.27], "tel aviv": [32.08, 34.78],
    "new york": [40.71, -74.00], "washington": [38.90, -77.03], "san francisco": [37.77, -122.41], "austin": [30.26, -97.74], "chicago": [41.87, -87.62]
}

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

def load_locations():
    try:
        with open('config/locations.json', 'r') as f: return json.load(f)
    except: return []

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

def get_hardcoded_coords(text):
    for city, coords in CITY_COORDINATES.items():
        if city in text.lower(): return coords[0], coords[1]
    return 0.0, 0.0

def is_duplicate_title(new_title, existing_titles):
    for old_title in existing_titles:
        if SequenceMatcher(None, new_title, old_title).ratio() > 0.65: return True
    return False

# --- SRO AI ANALYST CORE ---
def ask_gemini_analyst(title, snippet):
    if not model: return None
    
    prompt = f"""
    Role: Senior Intelligence Analyst for Dell Security & Resiliency Organization (SRO).
    Context: We support Crisis Management, Executive Protection, Supply Chain, and Regional Security.
    
    Headline: "{title}"
    Snippet: "{snippet}"
    
    STRICT EVALUATION PROTOCOL:
    
    1. **PHYSICAL / DUTY OF CARE (Keep High Priority)**:
       - Terrorism, War/Conflict, Civil Unrest (Protests/Riots).
       - Active Shooters, Kidnapping, Credible Threats to Executives/Facilities.
       - Major Natural Disasters (Earthquake, Typhoon) impacting infrastructure.
    
    2. **RESILIENCY & LOGISTICS (Keep High Priority)**:
       - Power Grid Failures, Telecom/Internet Outages.
       - Port Strikes, Airport Closures, Trade Blockades.
       - Supply Chain disruptions in key hubs (China, India, Malaysia, etc).
    
    3. **CYBER (Keep ONLY Significant Events)**:
       - DISCARD: Generic vulnerability news, patches, minor hacks, crypto scams.
       - KEEP: Massive Global Outages (e.g. CrowdStrike style events), Nation-State Cyber Warfare, or breaches of Critical Infrastructure/Major Tech Partners.
    
    4. **NOISE (DISCARD)**:
       - Politics (Opinion/Polls), Business (Stocks/Earnings), Social Issues, General/Local Crime.
    
    OUTPUT JSON: 
    {{ 
      "category": "Physical Security"|"Cyber"|"Logistics"|"Infrastructure"|"Weather/Event"|"Irrelevant", 
      "severity": 1 (Info)|2 (Warning)|3 (Critical), 
      "clean_title": "Professional, Executive-Ready Headline", 
      "summary": "1 sentence operational impact assessment.", 
      "region": "AMER"|"EMEA"|"APJC"|"Global", 
      "lat": 0.0, 
      "lon": 0.0 
    }}
    """
    
    try:
        time.sleep(1.5)
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except: return None

def analyze_article_hybrid(title, summary, source_name):
    text = (title + " " + summary).lower()
    if any(block in text for block in BLOCKED_KEYWORDS): return None

    ai_result = ask_gemini_analyst(title, summary)
    
    if ai_result:
        if ai_result.get('category') == "Irrelevant": return None
        
        lat = ai_result.get('lat', 0.0)
        lon = ai_result.get('lon', 0.0)
        if lat == 0.0: lat, lon = get_hardcoded_coords(text)

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
    folium.TileLayer("cartodb positron", no_wrap=True, min_zoom=3, bounds=[[-90, -180], [90, 180]]).add_to(m)
    
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
    locations = load_locations()
    allowed_names = list(TRUSTED_SOURCES.values())
    all_candidates = []
    
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                history = json.load(f)
                for item in history:
                    if item['source'] in allowed_names:
                        combined = (item['title'] + " " + item['snippet']).lower()
                        if not any(b in combined for b in BLOCKED_KEYWORDS):
                            all_candidates.append(item)
        except: pass

    print("Scanning feeds with SRO AI Agent...")
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]: 
                title = entry.title
                if len(title) < 15: continue
                
                is_dup = False
                for old in all_candidates:
                    if SequenceMatcher(None, title, old.get('title', '')).ratio() > 0.65:
                        is_dup = True
                        break
                if is_dup: continue

                clean_summary = clean_html(entry.summary if 'summary' in entry else "")
                analysis = analyze_article_hybrid(title, clean_summary, source_name)
                
                if analysis:
                    all_candidates.append({
                        "id": hashlib.md5(title.encode()).hexdigest(),
                        "title": analysis['clean_title'],
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
        except Exception as e: print(f"Skipping {source_name}: {e}")

    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    if len(all_candidates) > 1000: all_candidates = all_candidates[:1000]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f: json.dump(all_candidates, f, indent=2)
    
    generate_interactive_map(all_candidates)

if __name__ == "__main__":
    fetch_news()
