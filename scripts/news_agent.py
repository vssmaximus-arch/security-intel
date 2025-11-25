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

# --- 1. CONFIGURATION ---

# GOOGLE NEWS FIREHOSE + OFFICIAL SOURCES
TRUSTED_SOURCES = {
    "https://news.google.com/rss/search?q=cyberattack+OR+ransomware+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Cyber",
    "https://news.google.com/rss/search?q=port+strike+OR+supply+chain+disruption+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Logistics",
    "https://news.google.com/rss/search?q=terrorist+attack+OR+bombing+OR+mass+shooting+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Security",
    "https://news.google.com/rss/search?q=earthquake+OR+typhoon+OR+tsunami+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Disaster",
    "https://travel.state.gov/_res/rss/TAs_TWs.xml": "US State Dept",
    "https://gdacs.org/xml/rss.xml": "UN GDACS",
    "http://feeds.bbci.co.uk/news/world/rss.xml": "BBC World"
}

# NOISE FILTER (Blocks Non-SRO topics)
BLOCKED_KEYWORDS = [
    "entertainment", "celebrity", "movie", "film", "star", "music", "sport", "football", "cricket", 
    "dating", "gossip", "royal", "prince", "princess", "fashion", "lifestyle", "murder trial", 
    "convicted", "podcast", "opinion", "review", "market", "shares", "stocks", "profit", "revenue", 
    "earnings", "cosmetics", "luxury", "retail", "tourism", "holiday", "coroner", "inquest", 
    "blog is now closed", "live coverage", "arrested", "charged", "jail", "prison", "stabbing"
]

# REPORT PROFILES
REPORT_PROFILES = [
    { "id": "global", "title": "Global VP Security", "region": "ALL", "min_severity": 2, "keywords": [] },
    { "id": "apjc", "title": "Director APJC", "region": "APJC", "min_severity": 1, "keywords": [] },
    { "id": "india", "title": "India Lead", "region": "APJC", "min_severity": 1, "keywords": ["india", "bangalore", "delhi", "mumbai"] },
    { "id": "china", "title": "Greater China", "region": "APJC", "min_severity": 1, "keywords": ["china", "hong kong", "taiwan", "beijing", "shanghai"] },
    { "id": "japan", "title": "Japan", "region": "APJC", "min_severity": 1, "keywords": ["japan", "tokyo", "osaka"] },
    { "id": "anz", "title": "Oceania (ANZ)", "region": "APJC", "min_severity": 1, "keywords": ["australia", "new zealand", "sydney", "melbourne"] }
]

# PATHS
DB_PATH = "public/data/news.json"
FORECAST_PATH = "public/data/forecast.json"
MAP_PATH = "public/map.html"
REPORTS_DIR = "public/reports"

# AI SETUP
GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
    model = genai.GenerativeModel('gemini-pro') 
else:
    model = None

# --- 2. HELPER FUNCTIONS ---

def clean_html(raw_html):
    text = re.sub(r'<.*?>', '', raw_html)
    text = text.replace("Read full story", "").replace("&nbsp;", " ")
    return text.strip()

def parse_date(entry):
    try:
        if 'published_parsed' in entry:
            dt = datetime.fromtimestamp(mktime(entry.published_parsed))
            return dt.strftime("%Y-%m-%d"), dt.isoformat(), dt.timestamp()
    except: pass
    now = datetime.now()
    return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()

# --- 3. AI ANALYSIS ---

def ask_gemini_analyst(title, snippet):
    if not model: return None
    prompt = f"""Role: Security Analyst.
    Headline: "{title}" 
    Snippet: "{snippet}"
    
    INSTRUCTIONS:
    1. DISCARD if: Politics, Business/Stocks, Sports, Celebrity, Local Crime.
    2. KEEP if: Terrorism, War, Riots, Cyber Attack, Logistics/Port Strike, Natural Disaster.
    
    OUTPUT JSON: {{ 
        "category": "Physical Security"|"Cyber"|"Logistics"|"Weather/Event"|"Irrelevant", 
        "severity": 1-3, 
        "clean_title": "Professional Title", 
        "summary": "1 sentence impact.", 
        "region": "AMER"|"EMEA"|"APJC"|"LATAM"|"Global", 
        "lat": 0.0, "lon": 0.0 
    }}"""
    try:
        time.sleep(1.5)
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except: return None

# --- 4. GENERATORS ---

def generate_map(articles):
    m = folium.Map(location=[20, 0], zoom_start=2, min_zoom=2, max_bounds=True, tiles=None)
    folium.TileLayer("cartodb positron", no_wrap=True).add_to(m)
    
    # Add Dell Assets (Blue)
    try:
        with open('config/locations.json', 'r') as f:
            for asset in json.load(f):
                folium.Marker([asset['lat'], asset['lon']], 
                             popup=f"<b>{asset['name']}</b><br>{asset['type']}", 
                             icon=folium.Icon(color="blue", icon="shield", prefix='fa')).add_to(m)
    except: pass

    # Add Threats (Red/Orange)
    for item in articles:
        if item['lat'] != 0.0:
            color = "red" if item['severity'] == 3 else "orange"
            folium.Marker([item['lat'], item['lon']], 
                         popup=f"<b>{item['title']}</b>", 
                         icon=folium.Icon(color=color, icon="warning-sign")).add_to(m)
    m.save(MAP_PATH)

def generate_forecast(articles):
    if not model or not articles: return
    prompt = f"Based on these events: {[a['title'] for a in articles[:10]]}, write a strategic security outlook."
    try:
        response = model.generate_content(prompt)
        with open(FORECAST_PATH, "w") as f:
            json.dump({"outlook_title": "AI Strategic Outlook", "analysis": response.text}, f)
    except: pass

def generate_html_reports(data):
    os.makedirs(REPORTS_DIR, exist_ok=True)
    
    for profile in REPORT_PROFILES:
        filtered = []
        for item in data:
            if item['severity'] < profile['min_severity']: continue
            if profile['region'] != "ALL" and item['region'] != profile['region'] and item['region'] != "Global": continue
            if profile['keywords']:
                text = (item['title'] + item['snippet']).lower()
                if not any(k in text for k in profile['keywords']): continue
            filtered.append(item)
            
        # Create HTML
        html = f"<html><head><title>{profile['title']}</title><style>body{{font-family:sans-serif;padding:20px}}.card{{border:1px solid #ddd;padding:15px;margin:10px 0;border-radius:5px}}</style></head><body>"
        html += f"<h1>{profile['title']}</h1><p>Generated: {datetime.now().strftime('%Y-%m-%d')}</p><hr>"
        if not filtered: html += "<p>No active threats.</p>"
        for item in filtered:
            color = "red" if item['severity'] == 3 else "orange"
            html += f"<div class='card' style='border-left:5px solid {color}'><h3><a href='{item['link']}'>{item['title']}</a></h3><p>{item['snippet']}</p><small>{item['source']} | {item['date_str']}</small></div>"
        html += "</body></html>"
        
        with open(os.path.join(REPORTS_DIR, f"{profile['id']}_latest.html"), "w") as f:
            f.write(html)

# --- 5. MAIN LOOP ---

def fetch_news():
    all_candidates = []
    # Load History
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f: all_candidates = json.load(f)
        except: pass

    # Fetch New
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:4]: # Check top 4 per source
                title = entry.title
                if len(title) < 15: continue
                
                # Check Duplicates
                is_dup = False
                for old in all_candidates:
                    if SequenceMatcher(None, title, old['title']).ratio() > 0.65:
                        is_dup = True; break
                if is_dup: continue

                # Analyze
                analysis = ask_gemini_analyst(title, entry.summary if 'summary' in entry else "")
                
                if analysis and analysis.get('category') != "Irrelevant":
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
                        "region": analysis.get('region', "Global"),
                        "lat": analysis.get('lat', 0.0),
                        "lon": analysis.get('lon', 0.0)
                    })
        except Exception as e: print(f"Skipping {source_name}: {e}")

    # Sort & Save
    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    final_list = all_candidates[:500] # Keep DB size managed

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f: json.dump(final_list, f, indent=2)
    
    # Run Generators
    generate_interactive_map(final_list)
    generate_forecast(final_list)
    generate_html_reports(final_list)
    print("Update Complete.")

if __name__ == "__main__":
    fetch_news()
