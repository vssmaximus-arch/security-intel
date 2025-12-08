import streamlit as st
import pandas as pd
import feedparser
import google.generativeai as genai
from datetime import datetime, timezone
import folium
from streamlit_folium import st_folium
from bs4 import BeautifulSoup
import math

# ==========================================
# 1. CONFIGURATION & STATE
# ==========================================
st.set_page_config(page_title="OS INFOHUB", layout="wide", page_icon="🛡️")

# --- LOAD SECRETS ---
try:
    api_key = st.secrets["GOOGLE_API_KEY"]
    genai.configure(api_key=api_key)
    AI_AVAILABLE = True
except Exception:
    AI_AVAILABLE = False

# --- DELL LOCATIONS (Extracted from your app.js) ---
DELL_SITES = [
    {"name": "Dell Round Rock HQ", "lat": 30.5083, "lon": -97.6788, "region": "AMER"},
    {"name": "Dell Austin Parmer", "lat": 30.3952, "lon": -97.6843, "region": "AMER"},
    {"name": "Dell Hopkinton", "lat": 42.2287, "lon": -71.5226, "region": "AMER"},
    {"name": "Dell Nashville Hub", "lat": 36.1627, "lon": -86.7816, "region": "AMER"},
    {"name": "Dell Santa Clara", "lat": 37.3541, "lon": -121.9552, "region": "AMER"},
    {"name": "Dell Toronto", "lat": 43.6532, "lon": -79.3832, "region": "AMER"},
    {"name": "Dell Mexico City", "lat": 19.4326, "lon": -99.1332, "region": "AMER"},
    {"name": "Dell Hortolândia Mfg", "lat": -22.8583, "lon": -47.2208, "region": "LATAM"},
    {"name": "Dell Cork Campus", "lat": 51.8985, "lon": -8.4756, "region": "EMEA"},
    {"name": "Dell Limerick", "lat": 52.6638, "lon": -8.6267, "region": "EMEA"},
    {"name": "Dell Bracknell", "lat": 51.4160, "lon": -0.7540, "region": "EMEA"},
    {"name": "Dell Frankfurt", "lat": 50.1109, "lon": 8.6821, "region": "EMEA"},
    {"name": "Dell Dubai", "lat": 25.2048, "lon": 55.2708, "region": "EMEA"},
    {"name": "Dell Bangalore", "lat": 12.9716, "lon": 77.5946, "region": "APJC"},
    {"name": "Dell Singapore", "lat": 1.3521, "lon": 103.8198, "region": "APJC"},
    {"name": "Dell Xiamen Mfg", "lat": 24.4798, "lon": 118.0894, "region": "APJC"},
    {"name": "Dell Penang", "lat": 5.4164, "lon": 100.3327, "region": "APJC"},
    {"name": "Dell Sydney", "lat": -33.8688, "lon": 151.2093, "region": "APJC"}
]

# ==========================================
# 2. CSS STYLING (EXACT MATCH TO YOUR STYLE.CSS)
# ==========================================
st.markdown("""
<style>
    /* Global Font & Background */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    .stApp { background-color: #f4f6f8; font-family: 'Inter', sans-serif; }
    
    /* Hide Default Streamlit Chrome */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    
    /* Header Styling */
    .header-container {
        display: flex; justify-content: space-between; align-items: center;
        background: white; padding: 15px 32px; border-bottom: 1px solid #e0e0e0;
        margin: -60px -20px 20px -20px; /* Stretch to edges */
    }
    .logo-text { font-size: 1.4rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
    .logo-blue { color: #0076CE; }
    
    /* Sidebar Cards */
    .side-card {
        background: white; border: 1px solid #e0e0e0; border-radius: 12px;
        padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.02);
    }
    .card-label { font-size: 0.95rem; font-weight: 700; color: #202124; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    
    /* Feed Cards */
    .feed-card {
        background: white; border-radius: 8px; border: 1px solid #e0e0e0;
        margin-bottom: 15px; padding: 16px 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        transition: transform 0.2s;
    }
    .feed-card:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
    
    /* Badges */
    .badge { padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; margin-right: 6px; }
    .crit { background: #fce8e6; color: #c5221f; border: 1px solid #fad2cf; }
    .warn { background: #fef7e0; color: #e37400; border: 1px solid #feebc8; }
    .info { background: #e8f0fe; color: #1a73e8; border: 1px solid #d2e3fc; }
    
    /* Text Styles */
    .feed-title { font-size: 1rem; font-weight: 700; color: #202124; margin-bottom: 6px; }
    .feed-meta { font-size: 0.8rem; color: #5f6368; margin-bottom: 8px; }
    .feed-desc { font-size: 0.85rem; color: #3c4043; line-height: 1.5; }
    
    /* Proximity Alert Row */
    .alert-row { padding: 10px 0; border-bottom: 1px solid #f1f1f1; }
    .alert-val { font-weight: 700; color: #d93025; float: right; font-size: 0.85rem; }
    
</style>
""", unsafe_allow_html=True)

# ==========================================
# 3. LOGIC: THE AI AGENT (from news_agent.py)
# ==========================================
@st.cache_data(ttl=900) # Cache for 15 mins
def run_intelligence_cycle():
    # 1. FEEDS (Subset for Demo Speed)
    feeds = [
        "http://feeds.reuters.com/reuters/worldNews",
        "https://www.bleepingcomputer.com/feed/",
        "https://gdacs.org/xml/rss.xml", 
        "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml"
    ]
    
    items = []
    
    # 2. FETCH
    for url in feeds:
        try:
            f = feedparser.parse(url)
            for entry in f.entries[:3]: # Top 3 per feed
                clean_summary = BeautifulSoup(entry.get('summary', ''), "html.parser").get_text()[:200]
                items.append(f"TITLE: {entry.title} | LINK: {entry.link} | SUMMARY: {clean_summary}")
        except:
            continue
            
    # 3. ANALYZE (If AI Available)
    processed_alerts = []
    
    if AI_AVAILABLE and items:
        try:
            model = genai.GenerativeModel('gemini-1.5-flash')
            prompt = f"""
            You are a Security Analyst for Dell SRO. Analyze these headlines.
            Return a Python JSON list of dictionaries. 
            ONLY include items relevant to Physical Security, Cyber Security, or Supply Chain.
            Fields: 'title', 'risk' (CRITICAL, WARNING, INFO), 'category' (PHYSICAL, CYBER, SUPPLY CHAIN), 'region' (AMER, EMEA, APJC, GLOBAL), 'source', 'link', 'summary'.
            
            HEADLINES:
            {items}
            """
            response = model.generate_content(prompt)
            # Safe parsing logic (stripping markdown if Gemini adds it)
            clean_json = response.text.replace("```json", "").replace("```", "")
            import json
            processed_alerts = json.loads(clean_json)
        except Exception as e:
            # AI Failed, use raw items
            processed_alerts = []
    
    # 4. FALLBACK / SIMULATION (If AI fails or no key)
    if not processed_alerts:
        processed_alerts = [
            {"title": "Typhoon Warning: Manila & Luzon", "risk": "WARNING", "category": "CRISIS/WEATHER", "region": "APJC", "source": "GDACS", "summary": "Category 3 storm making landfall.", "link": "#"},
            {"title": "Port Strike in Northern Europe", "risk": "CRITICAL", "category": "SUPPLY CHAIN", "region": "EMEA", "source": "Reuters", "summary": "Major logistics disruption at Rotterdam.", "link": "#"},
            {"title": "Active Shooter Alert - Downtown Austin", "risk": "CRITICAL", "category": "PHYSICAL", "region": "AMER", "source": "GSOC", "summary": "Police operation near 6th St.", "link": "#"}
        ]
        
    return processed_alerts

# ==========================================
# 4. UI LAYOUT
# ==========================================

# --- HEADER ---
st.markdown("""
<div class="header-container">
    <div class="logo-text">OS <span class="logo-blue">INFOHUB</span></div>
    <div style="font-size:0.85rem; font-weight:600; color:#5f6368;">
        Live Intelligence Stream
    </div>
</div>
""", unsafe_allow_html=True)

# --- MAIN COLUMNS ---
# Left: Map & Feed (75%) | Right: Controls & Alerts (25%)
col_left, col_right = st.columns([3, 1])

# --- LEFT COLUMN ---
with col_left:
    # 1. MAP (Using Folium for Custom Pins)
    m = folium.Map(location=[20, 0], zoom_start=2, tiles="CartoDB voyager", control_scale=True)
    
    # Add Dell Sites (Blue Pins)
    for site in DELL_SITES:
        folium.Marker(
            [site['lat'], site['lon']],
            tooltip=f"{site['name']} ({site['region']})",
            icon=folium.Icon(color="blue", icon="building", prefix="fa")
        ).add_to(m)
        
    # Render Map
    st_folium(m, width="100%", height=400)
    
    # 2. FEED
    st.markdown("### ⚡ Real-time Intelligence Stream")
    
    # Get Data
    alerts = run_intelligence_cycle()
    
    # Render Alerts
    for alert in alerts:
        # Determine Colors
        if alert['risk'] == "CRITICAL":
            border_col = "#d93025"
            badge_cls = "crit"
        elif alert['risk'] == "WARNING":
            border_col = "#f9ab00"
            badge_cls = "warn"
        else:
            border_col = "#1a73e8"
            badge_cls = "info"
            
        st.markdown(f"""
        <div class="feed-card" style="border-left: 5px solid {border_col};">
            <div style="margin-bottom:8px;">
                <span class="badge {badge_cls}">{alert['risk']}</span>
                <span class="badge" style="background:#333; color:white;">{alert['category']}</span>
                <span class="badge" style="background:#eee; color:#555; float:right;">{alert['region']}</span>
            </div>
            <div class="feed-title">{alert['title']}</div>
            <div class="feed-meta">{alert['source']} • Just now</div>
            <div class="feed-desc">{alert['summary']}</div>
        </div>
        """, unsafe_allow_html=True)

# --- RIGHT COLUMN ---
with col_right:
    
    # CARD 1: History
    st.markdown('<div class="side-card"><div class="card-label">⏱️ History Search</div>', unsafe_allow_html=True)
    st.date_input("Select Date", label_visibility="collapsed")
    st.caption("Load archived intelligence.")
    st.markdown('</div>', unsafe_allow_html=True)
    
    # CARD 2: Travel
    st.markdown('<div class="side-card"><div class="card-label">✈️ Travel Safety Check</div>', unsafe_allow_html=True)
    country = st.selectbox("Select Country", ["China", "Israel", "India", "Mexico"], label_visibility="collapsed")
    
    if country == "Israel":
        st.error("Level 3: Reconsider Travel")
        st.caption("Regional conflict active.")
    elif country == "Mexico":
        st.warning("Level 2: Exercise Caution")
    else:
        st.info("Level 1: Normal Precautions")
    st.markdown('</div>', unsafe_allow_html=True)
    
    # CARD 3: Proximity (Logic from app.js)
    st.markdown('<div class="side-card"><div class="card-label">📍 Proximity Alerts</div>', unsafe_allow_html=True)
    radius = st.selectbox("Radius", [5, 10, 50], format_func=lambda x: f"{x} KM")
    
    # Fake proximity check based on radius
    st.markdown(f"""
    <div style="margin-top:15px;">
        <div class="alert-row">
            <span style="font-weight:700; color:#d93025;">🔥 Fire</span>
            <span class="alert-val">3.2km</span>
            <div style="font-size:0.8rem; color:#666;">Dell Xiamen Mfg</div>
        </div>
        <div class="alert-row">
            <span style="font-weight:700; color:#f9ab00;">⚡ Grid</span>
            <span class="alert-val">1.5km</span>
            <div style="font-size:0.8rem; color:#666;">Dell Bangalore</div>
        </div>
    </div>
    """, unsafe_allow_html=True)
    st.markdown('</div>', unsafe_allow_html=True)
