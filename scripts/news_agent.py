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

TRUSTED_SOURCES = {
    "https://news.google.com/rss/search?q=cyberattack+OR+ransomware+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Cyber",
    "https://news.google.com/rss/search?q=port+strike+OR+supply+chain+disruption+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Logistics",
    "https://news.google.com/rss/search?q=terrorist+attack+OR+bombing+OR+mass+shooting+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Security",
    "https://news.google.com/rss/search?q=earthquake+OR+typhoon+OR+tsunami+when:1d&hl=en-US&gl=US&ceid=US:en": "Google News: Disaster",
    "https://travel.state.gov/_res/rss/TAs_TWs.xml": "US State Dept Travel",
    "https://gdacs.org/xml/rss.xml": "UN GDACS"
}

BLOCKED_KEYWORDS = ["entertainment", "celebrity", "movie", "film", "music", "sport", "football", "cricket", "dating", "gossip"]

DB_PATH = "public/data/news.json"
FORECAST_PATH = "public/data/forecast.json"
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
    return text.strip()

def parse_date(entry):
    try:
        if 'published_parsed' in entry:
            dt = datetime.fromtimestamp(mktime(entry.published_parsed))
            return dt.strftime("%Y-%m-%d"), dt.isoformat(), dt.timestamp()
    except: pass
    now = datetime.now()
    return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()

def ask_gemini_analyst(title, snippet):
    if not model: return None
    prompt = f"""Role: Security Analyst. Filter & Categorize.
    Headline: "{title}" Snippet: "{snippet}"
    RULES: Keep only Physical Security, Cyber, Logistics. Discard Politics/Stocks/Crime.
    OUTPUT JSON: {{ "category": "Physical Security"|"Cyber"|"Logistics"|"Irrelevant", "severity": 1-3, "clean_title": "Title", "summary": "Summary", "region": "Global", "lat": 0.0, "lon": 0.0 }}"""
    try:
        time.sleep(1.5)
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except: return None

def fetch_news():
    all_candidates = []
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                all_candidates = json.load(f)
        except: pass

    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]: 
                title = entry.title
                if len(title) < 15: continue
                
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

    # FIX: Safe Sort handles missing keys
    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    
    # Remove duplicates
    unique = {v['id']:v for v in all_candidates}.values()
    final_list = list(unique)[:500]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f: json.dump(final_list, f, indent=2)
    
    # Create dummy forecast if needed to prevent errors
    if not os.path.exists(FORECAST_PATH):
        with open(FORECAST_PATH, "w") as f: json.dump({"outlook_title": "System Initializing"}, f)

if __name__ == "__main__":
    fetch_news()
