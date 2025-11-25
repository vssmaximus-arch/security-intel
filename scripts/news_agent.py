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
    "https://news.google.com/rss/search?q=cyberattack+OR+ransomware+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Cyber",
    "https://news.google.com/rss/search?q=port+strike+OR+supply+chain+disruption+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Logistics",
    "https://news.google.com/rss/search?q=terrorist+attack+OR+bombing+OR+mass+shooting+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Security",
    "https://news.google.com/rss/search?q=earthquake+OR+typhoon+OR+tsunami+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Disaster",
    "https://travel.state.gov/_res/rss/TAs_TWs.xml": "US State Dept Travel",
    "https://gdacs.org/xml/rss.xml": "UN GDACS"
}

# --- RESTORED CATEGORIES ---
KEYWORDS = {
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "shooting", "kidnap", "bomb", "assassination", "hostage", "armed attack", "active shooter", "mob violence", "insurgency", "coup", "civil unrest"],
    "Crisis/Disaster": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "severe flood", "flood warning", "flash flood", "eruption", "volcano", "evacuation order", "state of emergency"],
    "Logistics/Supply Chain": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway", "border crossing", "freight disruption"],
    "Cyber/InfoSec": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyber", "hacker", "botnet", "apt group", "phishing", "insider threat", "data leak"],
    "Executive/Travel": ["kidnapping", "travel warning", "aviation risk", "hotel attack", "violent crime", "carjacking", "civil aviation", "no fly zone"],
    "Infrastructure": ["power outage", "grid failure", "blackout", "telecom outage", "internet disruption", "undersea cable", "fiber cut", "water supply", "gas leak", "dam failure", "bridge collapse"]
}

BLOCKED_KEYWORDS = ["entertainment", "celebrity", "movie", "film", "music", "sport", "football", "cricket", "dating", "gossip"]

DB_PATH = "public/data/news.json"
FORECAST_PATH = "public/data/forecast.json"
MAP_PATH = "public/map.html"
REPORTS_DIR = "public/reports"

REPORT_PROFILES = [
    { "id": "global", "title": "Global VP Security", "region": "ALL", "min_severity": 2, "keywords": [] },
    { "id": "apjc", "title": "Director APJC", "region": "APJC", "min_severity": 1, "keywords": [] },
    { "id": "india", "title": "India Lead", "region": "APJC", "min_severity": 1, "keywords": ["india", "bangalore"] },
    { "id": "china", "title": "Greater China", "region": "APJC", "min_severity": 1, "keywords": ["china", "hong kong"] },
    { "id": "japan", "title": "Japan", "region": "APJC", "min_severity": 1, "keywords": ["japan", "tokyo"] },
    { "id": "anz", "title": "Oceania", "region": "APJC", "min_severity": 1, "keywords": ["australia", "new zealand"] }
]

CITY_COORDINATES = {
    "sydney": [-33.86, 151.20], "melbourne": [-37.81, 144.96], "tokyo": [35.67, 139.65],
    "beijing": [39.90, 116.40], "shanghai": [31.23, 121.47], "hong kong": [22.31, 114.16],
    "bangalore": [12.97, 77.59], "singapore": [1.35, 103.81], "london": [51.50, -0.12],
    "new york": [40.71, -74.00], "austin": [30.26, -97.74], "san francisco": [37.77, -122.41]
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
    return text.strip()

def parse_date(entry):
    try:
        if 'published_parsed' in entry:
            dt = datetime.fromtimestamp(mktime(entry.published_parsed))
            return dt.strftime("%Y-%m-%d"), dt.isoformat(), dt.timestamp()
    except: pass
    now = datetime.now()
    return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()

def get_hardcoded_coords(text):
    for city, coords in CITY_COORDINATES.items():
        if city in text.lower(): return coords[0], coords[1]
    return 0.0, 0.0

def ask_gemini_analyst(title, snippet):
    if not model: return None
    prompt = f"""Role: Security Analyst.
    Headline: "{title}" Snippet: "{snippet}"
    Rules: Discard Politics/Stocks/Crime. Keep Physical/Cyber/Logistics.
    Output JSON: {{ "category": "Physical Security"|"Cyber"|"Logistics"|"Irrelevant", "severity": 1-3, "clean_title": "Title", "summary": "Summary", "region": "Global", "lat": 0.0, "lon": 0.0 }}"""
    try:
        time.sleep(1.5)
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except: return None

def generate_map(articles):
    m = folium.Map(location=[20, 0], zoom_start=2, min_zoom=2, max_bounds=True, tiles=None)
    folium.TileLayer("cartodb positron", no_wrap=True).add_to(m)
    for item in articles:
        lat = item.get('lat')
        lon = item.get('lon')
        if lat and lon and (lat != 0.0 or lon != 0.0):
            color = "orange" if item['severity'] == 2 else "red"
            folium.Marker([lat, lon], popup=item['title'], icon=folium.Icon(color=color, icon="info-sign")).add_to(m)
    m.save(MAP_PATH)

def generate_forecast(articles):
    if not model or not articles: return
    prompt = f"Based on these events: {[a['title'] for a in articles[:10]]}, write a 1 sentence security outlook."
    try:
        response = model.generate_content(prompt)
        with open(FORECAST_PATH, "w") as f:
            json.dump({"outlook_title": "AI Outlook", "analysis": response.text}, f)
    except: pass

def generate_html_reports(data):
    os.makedirs(REPORTS_DIR, exist_ok=True)
    for profile in REPORT_PROFILES:
        filtered = []
        for item in data:
            if item['severity'] < profile['min_severity']: continue
            if profile['region'] != "ALL" and item['region'] != profile['region'] and item['region'] != "Global": continue
            filtered.append(item)
            
        html = f"<html><head><title>{profile['title']}</title><style>body{{font-family:sans-serif;padding:20px}}.card{{border:1px solid #ddd;padding:15px;margin:10px 0}}</style></head><body><h1>{profile['title']}</h1><hr>"
        if not filtered: html += "<p>No active threats.</p>"
        for item in filtered:
            html += f"<div class='card'><h3><a href='{item['link']}'>{item['title']}</a></h3><p>{item['snippet']}</p><small>{item['source']}</small></div>"
        html += "</body></html>"
        
        with open(os.path.join(REPORTS_DIR, f"{profile['id']}_latest.html"), "w") as f:
            f.write(html)

def fetch_news():
    all_candidates = []
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f: all_candidates = json.load(f)
        except: pass

    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]: 
                title = entry.title
                if len(title) < 15: continue
                
                analysis = ask_gemini_analyst(title, entry.summary if 'summary' in entry else "")
                if analysis and analysis.get('category') != "Irrelevant":
                    lat = analysis.get('lat', 0.0)
                    if lat == 0.0: lat, lon = get_hardcoded_coords(title)
                    else: lon = analysis.get('lon', 0.0)
                    
                    region = analysis.get('region', 'Global')
                    # Simple Keyword Region Logic as Backup
                    if "asia" in title.lower(): region = "APJC"
                    if "europe" in title.lower(): region = "EMEA"

                    all_candidates.append({
                        "id": hashlib.md5(title.encode()).hexdigest(),
                        "title": analysis.get('clean_title', title),
                        "snippet": analysis.get('summary', ""),
                        "link": entry.link,
                        "published": parse_date(entry)[1],
                        "date_str": parse_date(entry)[0],
                        "timestamp": parse_date(entry)[2],
                        "source": source_name,
                        "category": analysis.get('category', "Uncategorized"),
                        "severity": analysis.get('severity', 1),
                        "region": region,
                        "lat": lat, "lon": lon
                    })
        except Exception as e: print(f"Skipping {source_name}: {e}")

    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    unique = {v['id']:v for v in all_candidates}.values()
    final_list = list(unique)[:500]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f: json.dump(final_list, f, indent=2)
    
    generate_map(final_list)
    generate_forecast(final_list)
    generate_html_reports(final_list)

if __name__ == "__main__":
    fetch_news()
