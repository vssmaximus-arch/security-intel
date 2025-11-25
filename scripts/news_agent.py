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

BLOCKED_KEYWORDS = ["entertainment", "celebrity", "movie", "film", "music", "sport", "football", "cricket", "dating", "gossip"]

DB_PATH = "public/data/news.json"
FORECAST_PATH = "public/data/forecast.json"
MAP_PATH = "public/map.html"

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

def generate_interactive_map(articles):
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

def fetch_news():
    all_candidates = []
    if os.path.exists(DB_PATH):
