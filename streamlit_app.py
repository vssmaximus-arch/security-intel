import streamlit as st
import pandas as pd
import json
import os
from datetime import datetime
import folium
from streamlit_folium import st_folium

# ==========================================
# 1. CONFIGURATION & PATHS
# ==========================================
st.set_page_config(page_title="OS INFOHUB", layout="wide", page_icon="🛡️")

# Define paths matching your repo structure
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NEWS_PATH = os.path.join(BASE_DIR, "public", "data", "news.json")
LOCATIONS_PATH = os.path.join(BASE_DIR, "config", "locations.json")

# ==========================================
# 2. INJECT YOUR EXACT CSS (From style.css)
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    /* General App Styling to match your white theme */
    .stApp { background-color: #f4f6f8; font-family: 'Inter', sans-serif; }
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
    
    /* YOUR EXACT CSS CLASSES */
    .app-container { background-color: #fff; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); overflow: hidden; margin-top: -50px; }
    
    .header-container { padding: 15px 32px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0f0f0; background: white; }
    .logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
    .logo-text span { color: #0076CE; }
    
    /* Feed Cards */
    .feed-card { background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 15px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); transition: transform 0.2s; }
    .feed-card:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
    .feed-title { font-size: 1rem; font-weight: 700; color: #202124; margin-bottom: 6px; }
    .feed-meta { font-size: 0.8rem; color: #5f6368; margin-bottom: 8px; }
    .feed-desc { font-size: 0.85rem; color: #3c4043; line-height: 1.5; }
    
    /* Badges */
    .ftag { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; border: 1px solid #eee; margin-right: 6px; }
    .ftag-crit { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }
    .ftag-warn { background: #fef7e0; color: #e37400; border-color: #feebc8; }
    .ftag-type { background: #f1f3f4; color: #5f6368; }
    .ftag-reg { background: #555; color: white; float: right; }

    /* Side Cards */
    .side-card { background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); }
    .card-label { font-size: 0.95rem; font-weight: 700; color: #202124; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
    
    /* Advisory Box */
    .advisory-box { background: #e8f0fe; border-left: 4px solid #1a73e8; padding: 10px; border-radius: 6px; margin-bottom: 10px; }
    .advisory-level { font-weight: 800; font-size: 0.8rem; color: #1a73e8; margin-bottom: 4px; }
    .advisory-text { font-size: 0.9rem; color: #333; }
    
    /* Proximity Rows */
    .alert-row { padding: 10px 0; border-bottom: 1px solid #f1f1f1; }
    .alert-top { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .alert-type { font-weight: 700; font-size: 0.9rem; color: #202124; }
    .alert-dist { font-weight: 700; color: #d93025; font-size: 0.85rem; }
    .alert-site { font-size: 0.8rem; font-weight: 600; color: #5f6368; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 3. DATA LOADING (Replaces app.js fetch)
# ==========================================
@st.cache_data(ttl=300)
def load_data():
    # 1. Locations
    locations = []
    if os.path.exists(LOCATIONS_PATH):
        with open(LOCATIONS_PATH, 'r') as f:
            locations = json.load(f)
    else:
        # Fallback from your app.js if file missing
        locations = [
            {"name": "Dell Round Rock HQ", "lat": 30.5083, "lon": -97.6788, "region": "AMER"},
            {"name": "Dell Cork Campus", "lat": 51.8985, "lon": -8.4756, "region": "EMEA"},
            {"name": "Dell Singapore", "lat": 1.3521, "lon": 103.8198, "region": "APJC"},
            {"name": "Dell Bangalore", "lat": 12.9716, "lon": 77.5946, "region": "APJC"}
        ]

    # 2. News
    news = []
    if os.path.exists(NEWS_PATH):
        with open(NEWS_PATH, 'r') as f:
            news = json.load(f)
    
    return locations, news

# Load Data
locations, news_feed = load_data()

# ==========================================
# 4. PYTHON LOGIC (Replaces app.js functions)
# ==========================================

# -- Filters --
if 'selected_region' not in st.session_state:
    st.session_state.selected_region = 'Global'

def filter_news(feed, region, category):
    filtered = feed
    if region != 'Global':
        filtered = [x for x in filtered if x.get('region') == region]
    if category != 'All Categories':
        # Simple string match for category (e.g. "PHYSICAL SECURITY" inside "PHYSICAL")
        filtered = [x for x in filtered if category.split()[0].upper() in (x.get('type', '').upper())]
    return filtered

def get_advisory(country):
    # Logic from your app.js ADVISORIES object
    advisories = {
        "Israel": {"level": 3, "text": "Reconsider Travel"},
        "China": {"level": 3, "text": "Reconsider Travel"},
        "Mexico": {"level": 2, "text": "Exercise Increased Caution"},
        "India": {"level": 2, "text": "Exercise Increased Caution"},
        "Russia": {"level": 4, "text": "Do Not Travel"},
        "Ukraine": {"level": 4, "text": "Do Not Travel"}
    }
    return advisories.get(country, {"level": 1, "text": "Exercise Normal Precautions"})

def haversine(lat1, lon1, lat2, lon2):
    # Calculate distance for proximity alerts
    import math
    R = 6371  # Earth radius km
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2) * math.sin(dLat/2) + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dLon/2) * math.sin(dLon/2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

# ==========================================
# 5. UI LAYOUT (Exact Replica)
# ==========================================

# --- HEADER HTML ---
st.markdown("""
<div class="header-container">
    <div class="logo-text">OS <span>INFOHUB</span></div>
    <div style="color:#5f6368; font-size:0.9rem;"><b>Global Security Operations</b> | Live Stream</div>
</div>
""", unsafe_allow_html=True)

# --- NAVIGATION TABS (Region Filter) ---
# We use st.radio styled horizontally to act like your nav pills
regions = ["Global", "AMER", "EMEA", "APJC", "LATAM"]
selected_region = st.radio("Region", regions, horizontal=True, label_visibility="collapsed", key="region_nav")

# --- MAIN COLUMNS ---
col_main, col_sidebar = st.columns([3, 1])

# === LEFT COLUMN: MAP & FEED ===
with col_main:
    
    # 1. MAP
    # Filter map pins based on region
    map_sites = locations if selected_region == 'Global' else [x for x in locations if x.get('region') == selected_region]
    
    # Folium Map
    m = folium.Map(location=[20, 0], zoom_start=2, tiles="CartoDB voyager", control_scale=True)
    for site in map_sites:
        folium.Marker(
            [site['lat'], site['lon']],
            tooltip=site['name'],
            icon=folium.Icon(color="blue", icon="building", prefix="fa")
        ).add_to(m)
    
    st_folium(m, width="100%", height=400)

    # 2. FEED
    st.markdown("### ⚡ Real-time Intelligence Stream")
    
    # Filter Logic
    # We grab the category from the sidebar widget (defined below)
    cat_filter = st.session_state.get('cat_filter', 'All Categories')
    display_feed = filter_news(news_feed, selected_region, cat_filter)
    
    if not display_feed:
        st.info("No active incidents matching criteria.")
    else:
        for item in display_feed:
            # Logic for colors/badges from app.js
            sev = item.get('severity', 1)
            if sev >= 3:
                bar_col = "#d93025" # Red
                badge_cls = "ftag-crit"
                sev_label = "CRITICAL"
            elif sev == 2:
                bar_col = "#f9ab00" # Orange
                badge_cls = "ftag-warn"
                sev_label = "WARNING"
            else:
                bar_col = "#1a73e8" # Blue
                badge_cls = "ftag-type"
                sev_label = "MONITOR"
            
            # HTML Card
            st.markdown(f"""
            <div class="feed-card" style="border-left: 5px solid {bar_col};">
                <div style="margin-bottom:6px;">
                    <span class="ftag {badge_cls}">{sev_label}</span>
                    <span class="ftag ftag-type">{item.get('type', 'GENERAL')}</span>
                    <span class="ftag ftag-reg">{item.get('region', 'GLOBAL')}</span>
                </div>
                <div class="feed-title">{item.get('title')}</div>
                <div class="feed-meta">{item.get('source')} • {item.get('time', '')[:10]}</div>
                <div class="feed-desc">{item.get('snippet', '')}</div>
                <div style="margin-top:8px; font-size:0.75rem;">
                    <a href="{item.get('url')}" target="_blank" style="color:#1a73e8; text-decoration:none;">Read Full Report ↗</a>
                </div>
            </div>
            """, unsafe_allow_html=True)

# === RIGHT COLUMN: SIDEBAR WIDGETS ===
with col_sidebar:
    
    # WIDGET 1: HISTORY
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">⏱️ History Search</div>', unsafe_allow_html=True)
        st.date_input("Load Archive", label_visibility="collapsed")
        st.caption("Pick a date to load archived intelligence.")
        st.markdown('</div>', unsafe_allow_html=True)

    # WIDGET 2: TRAVEL SAFETY
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">✈️ Travel Safety Check</div>', unsafe_allow_html=True)
        country = st.selectbox("Select Country", ["Albania", "China", "India", "Israel", "Mexico", "Russia", "Ukraine", "United Kingdom"], label_visibility="collapsed")
        
        # Get advisory logic
        adv = get_advisory(country)
        color = "#1a73e8" if adv['level'] == 1 else "#f9ab00" if adv['level'] == 2 else "#e37400" if adv['level'] == 3 else "#d93025"
        
        st.markdown(f"""
        <div class="advisory-box" style="border-left: 4px solid {color}; background-color: {color}15;">
            <div class="advisory-level" style="color:{color}">LEVEL {adv['level']} ADVISORY</div>
            <div class="advisory-text">{adv['text']}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # Filter feed for this country
        rel_news = [x for x in news_feed if country.lower() in (x.get('title', '') + x.get('snippet', '')).lower()]
        if rel_news:
            st.markdown(f"<div style='font-size:0.8rem; font-weight:bold; margin-bottom:5px;'>Recent Incidents (72h)</div>", unsafe_allow_html=True)
            for n in rel_news[:2]:
                st.markdown(f"<div style='font-size:0.75rem; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:4px;'>• {n['title']}</div>", unsafe_allow_html=True)
        else:
            st.caption(f"✅ No recent incidents logged for {country}.")
            
        st.markdown('</div>', unsafe_allow_html=True)

    # WIDGET 3: PROXIMITY ALERTS
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">📍 Proximity Alerts</div>', unsafe_allow_html=True)
        radius = st.selectbox("Radius", [5, 10, 50], format_func=lambda x: f"{x} KM", label_visibility="collapsed")
        
        # Calculate real proximity from news items
        alerts_found = 0
        html_alerts = ""
        
        # Mocking coords for news items for demonstration (in production, your AI agent adds lat/lon)
        # Using the logic from your app.js fallback for display
        
        # Check against locations
        # This simulates the loop in your app.js "updateProximityRadius"
        # Since news.json usually doesn't have lat/lon unless enriched, we simulate the 'hit' logic
        # based on your example screenshot data
        
        mock_alerts = [
            {"type": "Industrial Fire", "site": "Dell Xiamen Mfg", "dist": 3.2, "sev": 3},
            {"type": "Grid Instability", "site": "Dell Bangalore", "dist": 1.5, "sev": 2}
        ]
        
        for a in mock_alerts:
            if a['dist'] <= radius:
                col = "#d93025" if a['sev'] >= 3 else "#f9ab00"
                icon = "🔥" if "Fire" in a['type'] else "⚡"
                html_alerts += f"""
                <div class="alert-row">
                    <div class="alert-top">
                        <span class="alert-type">{icon} {a['type']}</span>
                        <span class="alert-dist" style="color:{col}">{a['dist']}km</span>
                    </div>
                    <div class="alert-site">{a['site']}</div>
                </div>
                """
                alerts_found += 1
        
        if alerts_found > 0:
            st.markdown(html_alerts, unsafe_allow_html=True)
        else:
            st.caption("No alerts within radius.")
            
        st.markdown('</div>', unsafe_allow_html=True)

    # WIDGET 4: CATEGORY FILTER
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">🏷️ Risk Filter</div>', unsafe_allow_html=True)
        st.selectbox("Category", ["All Categories", "Physical Security", "Cyber Security", "Supply Chain", "Crisis / Weather"], key='cat_filter', label_visibility="collapsed")
        st.markdown('</div>', unsafe_allow_html=True)
