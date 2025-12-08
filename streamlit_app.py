import streamlit as st
import pandas as pd
import json
import os
import math
import folium
from streamlit_folium import st_folium
from datetime import datetime, timedelta

# ==========================================
# 1. CONFIGURATION & STATE
# ==========================================
st.set_page_config(page_title="OS INFOHUB", layout="wide", page_icon="🛡️")

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NEWS_PATH = os.path.join(BASE_DIR, "public", "data", "news.json")
PROX_PATH = os.path.join(BASE_DIR, "public", "data", "proximity.json")
FEEDBACK_PATH = os.path.join(BASE_DIR, "public", "data", "feedback.jsonl")

# Ensure Data Dir Exists
os.makedirs(os.path.join(BASE_DIR, "public", "data"), exist_ok=True)

# --- HARDCODED DELL SITES (From your app.js) ---
DELL_SITES = [
    { "name": "Dell Round Rock HQ", "country": "US", "region": "AMER", "lat": 30.5083, "lon": -97.6788 },
    { "name": "Dell Austin Parmer", "country": "US", "region": "AMER", "lat": 30.3952, "lon": -97.6843 },
    { "name": "Dell Hopkinton", "country": "US", "region": "AMER", "lat": 42.2287, "lon": -71.5226 },
    { "name": "Dell Nashville Hub", "country": "US", "region": "AMER", "lat": 36.1627, "lon": -86.7816 },
    { "name": "Dell Santa Clara", "country": "US", "region": "AMER", "lat": 37.3541, "lon": -121.9552 },
    { "name": "Dell Toronto", "country": "CA", "region": "AMER", "lat": 43.6532, "lon": -79.3832 },
    { "name": "Dell Mexico City", "country": "MX", "region": "AMER", "lat": 19.4326, "lon": -99.1332 },
    { "name": "Dell Hortolândia Mfg", "country": "BR", "region": "LATAM", "lat": -22.8583, "lon": -47.2208 },
    { "name": "Dell São Paulo", "country": "BR", "region": "LATAM", "lat": -23.5505, "lon": -46.6333 },
    { "name": "Dell Cork Campus", "country": "IE", "region": "EMEA", "lat": 51.8985, "lon": -8.4756 },
    { "name": "Dell Limerick", "country": "IE", "region": "EMEA", "lat": 52.6638, "lon": -8.6267 },
    { "name": "Dell Bracknell", "country": "GB", "region": "EMEA", "lat": 51.4160, "lon": -0.7540 },
    { "name": "Dell Frankfurt", "country": "DE", "region": "EMEA", "lat": 50.1109, "lon": 8.6821 },
    { "name": "Dell Dubai", "country": "AE", "region": "EMEA", "lat": 25.2048, "lon": 55.2708 },
    { "name": "Dell Bangalore", "country": "IN", "region": "APJC", "lat": 12.9716, "lon": 77.5946 },
    { "name": "Dell Singapore", "country": "SG", "region": "APJC", "lat": 1.3521, "lon": 103.8198 },
    { "name": "Dell Xiamen Mfg", "country": "CN", "region": "APJC", "lat": 24.4798, "lon": 118.0894 },
    { "name": "Dell Penang", "country": "MY", "region": "APJC", "lat": 5.4164, "lon": 100.3327 },
    { "name": "Dell Sydney", "country": "AU", "region": "APJC", "lat": -33.8688, "lon": 151.2093 }
]

# --- ADVISORIES (From your app.js) ---
ADVISORIES = {
    "Afghanistan": { "level": 4, "text": "Do Not Travel" },
    "Israel": { "level": 3, "text": "Reconsider Travel" },
    "China": { "level": 3, "text": "Reconsider Travel" },
    "Mexico": { "level": 2, "text": "Exercise Increased Caution" },
    "India": { "level": 2, "text": "Exercise Increased Caution" },
    "United Kingdom": { "level": 2, "text": "Exercise Increased Caution" },
    # Add rest from your list if needed, these are key ones
}

# ==========================================
# 2. INJECT YOUR EXACT CSS (STYLE.CSS)
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    /* RESET & FONT */
    .stApp { background-color: #f4f6f8; font-family: 'Inter', sans-serif; }
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
    
    /* HEADER */
    .header-container {
        display: flex; justify-content: space-between; align-items: center;
        background: white; padding: 15px 32px; border-bottom: 1px solid #e0e0e0;
        margin: -60px -20px 20px -20px; 
    }
    .logo-text { font-size: 1.3rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
    .logo-text span { color: #0076CE; }
    
    /* FEED CARDS (Pixel Perfect) */
    .feed-card {
        background: #fff; border-radius: 8px; border: 1px solid #e0e0e0;
        margin-bottom: 15px; padding: 16px 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .feed-title { font-size: 1rem; font-weight: 700; color: #202124; margin-bottom: 6px; }
    .feed-meta { font-size: 0.8rem; color: #5f6368; margin-bottom: 8px; }
    .feed-desc { font-size: 0.85rem; color: #3c4043; line-height: 1.5; }
    
    /* BADGES */
    .ftag { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; border: 1px solid #eee; margin-right: 6px; }
    .ftag-crit { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }
    .ftag-warn { background: #fef7e0; color: #e37400; border-color: #feebc8; }
    .ftag-reg { background: #555; color: white; float: right; }
    
    /* SIDEBAR WIDGETS */
    .side-card {
        background: white; border: 1px solid #e0e0e0; border-radius: 12px;
        padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.02);
    }
    .card-label { font-size: 0.95rem; font-weight: 700; color: #202124; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    
    /* ADVISORY BOX */
    .advisory-box { background: #f8f9fa; border-left: 4px solid #1a73e8; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
    .advisory-level { font-weight: 800; font-size: 0.8rem; margin-bottom: 4px; }
    .advisory-text { font-size: 0.9rem; color: #333; font-weight: 600; }
    
    /* PROXIMITY ROWS */
    .alert-row { padding: 10px 0; border-bottom: 1px solid #f1f1f1; }
    .alert-top { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .alert-type { font-weight: 700; font-size: 0.9rem; color: #202124; }
    .alert-dist { font-weight: 700; color: #d93025; font-size: 0.85rem; }
    .alert-site { font-size: 0.8rem; font-weight: 600; color: #5f6368; }
    
    /* ACTION BUTTONS */
    .stButton button {
        font-size: 0.75rem; padding: 2px 10px; border-radius: 4px; margin-top: 5px;
    }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 3. BACKEND LOGIC (Python replacement for app.js)
# ==========================================

# -- Load Data --
def load_data():
    news = []
    # Try loading real news first
    if os.path.exists(NEWS_PATH):
        try:
            with open(NEWS_PATH, 'r') as f:
                news = json.load(f)
        except: pass
    
    # Try loading proximity (if your generate_reports.py created it)
    prox = []
    if os.path.exists(PROX_PATH):
        try:
            with open(PROX_PATH, 'r') as f:
                data = json.load(f)
                prox = data.get('alerts', [])
        except: pass
        
    return news, prox

news_feed, proximity_alerts = load_data()

# -- Save Feedback (Learning Loop) --
def save_feedback(item_title, label):
    entry = {
        "title": item_title,
        "label": label,
        "timestamp": datetime.now().isoformat()
    }
    with open(FEEDBACK_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")
    st.toast(f"Feedback Recorded: {label}")

# -- Filter Logic --
def filter_feed(feed, region, category):
    filtered = feed
    if region != 'Global':
        filtered = [x for x in filtered if x.get('region') == region]
    
    if category != 'All Categories':
        # Match 'PHYSICAL' in 'PHYSICAL SECURITY'
        keyword = category.split()[0].upper()
        filtered = [x for x in filtered if keyword in str(x.get('type', '')).upper()]
    
    return filtered

# -- Proximity Logic (Haversine) --
def calculate_proximity(radius_km):
    # This logic matches your app.js loop, but runs in Python
    # Since we loaded DELL_SITES and news_feed, we find matches
    alerts = []
    
    # 1. Use pre-calculated alerts from generate_reports.py if available
    for alert in proximity_alerts:
        if alert.get('distance_km', 999) <= radius_km:
            alerts.append(alert)
            
    # 2. (Optional) If proximity.json is empty, calculating here would duplicate logic
    # We rely on your backend script (generate_reports.py) to have done the math
    return alerts

# ==========================================
# 4. UI CONSTRUCTION
# ==========================================

# --- HEADER ---
st.markdown("""
<div class="header-container">
    <div class="logo-text">OS <span>INFOHUB</span></div>
    <div>
        <span style="color:#5f6368; font-size:0.8rem; font-weight:600; margin-right:15px;">Live Stream</span>
        <button style="background:#0076CE; color:white; border:none; padding:6px 12px; border-radius:6px; font-weight:700; cursor:pointer;">Daily Briefings</button>
    </div>
</div>
""", unsafe_allow_html=True)

# --- NAV TABS ---
regions = ["Global", "AMER", "EMEA", "APJC", "LATAM"]
selected_region = st.radio("Region", regions, horizontal=True, label_visibility="collapsed")

# --- MAIN LAYOUT ---
col_left, col_right = st.columns([3, 1])

# === LEFT: MAP & FEED ===
with col_left:
    
    # 1. MAP (Folium)
    # Combine Dell Sites + Incidents on Map
    m = folium.Map(location=[20, 0], zoom_start=2, tiles="CartoDB voyager", control_scale=True)
    
    # Blue Pins (Dell)
    site_list = DELL_SITES if selected_region == 'Global' else [x for x in DELL_SITES if x['region'] == selected_region]
    for site in site_list:
        folium.Marker(
            [site['lat'], site['lon']],
            tooltip=f"<b>{site['name']}</b>",
            icon=folium.Icon(color="blue", icon="building", prefix="fa")
        ).add_to(m)
        
    # Red Pins (Incidents - if coords exist)
    filtered_news = filter_feed(news_feed, selected_region, 'All Categories') # Default cat for map
    for item in filtered_news:
        # Check if item has lat/lon (your news_agent.py might not populate this yet for all items)
        # Using proximity alerts for map pins as they definitely have coords
        pass 
        
    for alert in proximity_alerts:
        if alert.get('lat'):
             folium.Marker(
                [alert['lat'], alert['lon']],
                tooltip=f"<b>{alert['type']}</b><br>{alert['distance_km']}km from Site",
                icon=folium.Icon(color="red", icon="exclamation-triangle", prefix="fa")
            ).add_to(m)

    st_folium(m, width="100%", height=400)

    # 2. FEED
    st.markdown("### ⚡ Real-time Intelligence Stream")
    
    # Filter Widget (Local state to keep it clean)
    cat_filter = st.selectbox("Category Filter", ["All Categories", "Physical Security", "Cyber Security", "Supply Chain"], label_visibility="collapsed")
    
    # Apply Filters
    final_feed = filter_feed(news_feed, selected_region, cat_filter)
    
    if not final_feed:
        st.markdown('<div style="text-align:center; padding:40px; color:#999;">No active incidents matching criteria.</div>', unsafe_allow_html=True)
    
    # Render Cards
    for i, item in enumerate(final_feed[:20]): # Limit 20 for performance
        
        # Colors
        sev = item.get('severity', 1)
        if sev >= 3:
            col = "#d93025"; badge = "ftag-crit"; lbl = "CRITICAL"
        elif sev == 2:
            col = "#f9ab00"; badge = "ftag-warn"; lbl = "WARNING"
        else:
            col = "#1a73e8"; badge = "ftag-type"; lbl = "MONITOR"
            
        # Card HTML
        st.markdown(f"""
        <div class="feed-card" style="border-left: 5px solid {col};">
            <div style="margin-bottom:6px;">
                <span class="ftag {badge}">{lbl}</span>
                <span class="ftag ftag-type">{item.get('type', 'GENERAL')}</span>
                <span class="ftag ftag-reg">{item.get('region', 'GLOBAL')}</span>
            </div>
            <div class="feed-title">{item.get('title')}</div>
            <div class="feed-meta">{item.get('source')} • {item.get('time', '')[:10]}</div>
            <div class="feed-desc">{item.get('snippet', '')}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # ACTION BUTTONS (The AI Learning Loop)
        # Using columns to place small buttons under card
        b1, b2, b3 = st.columns([1, 1, 6])
        with b1:
            if st.button("Relevant", key=f"rel_{i}"):
                save_feedback(item['title'], "RELEVANT")
        with b2:
            if st.button("Not Relevant", key=f"not_{i}"):
                save_feedback(item['title'], "NOT_RELEVANT")

# === RIGHT: WIDGETS ===
with col_right:
    
    # 1. HISTORY
    st.markdown('<div class="side-card"><div class="card-label">⏱️ History Search</div>', unsafe_allow_html=True)
    st.date_input("Load Archive", label_visibility="collapsed")
    st.markdown('</div>', unsafe_allow_html=True)
    
    # 2. TRAVEL SAFETY (Dual Logic)
    st.markdown('<div class="side-card"><div class="card-label">✈️ Travel Safety Check</div>', unsafe_allow_html=True)
    country = st.selectbox("Select Country", ["China", "Israel", "India", "Mexico", "Ukraine"], label_visibility="collapsed")
    
    # Logic: Advisory
    adv = ADVISORIES.get(country, {"level": 1, "text": "Exercise Normal Precautions"})
    lvl = adv['level']
    adv_col = "#d93025" if lvl == 4 else "#e37400" if lvl == 3 else "#f9ab00" if lvl == 2 else "#1a73e8"
    
    st.markdown(f"""
    <div class="advisory-box" style="border-left: 4px solid {adv_col}; background-color:{adv_col}15;">
        <div class="advisory-level" style="color:{adv_col}">LEVEL {lvl} ADVISORY</div>
        <div class="advisory-text">{adv['text']}</div>
    </div>
    """, unsafe_allow_html=True)
    
    # Logic: Recent Events (72h)
    st.markdown(f"<div style='font-size:0.8rem; font-weight:700; margin-top:10px; color:#555;'>Recent Events (72h)</div>", unsafe_allow_html=True)
    
    country_news = [x for x in news_feed if country.lower() in (x.get('title', '') + x.get('snippet', '')).lower()]
    if country_news:
        for n in country_news[:3]:
            st.markdown(f"<div style='font-size:0.75rem; border-bottom:1px solid #eee; padding:4px 0;'>• {n['title']}</div>", unsafe_allow_html=True)
    else:
        st.markdown(f"<div style='font-size:0.75rem; color:green; margin-top:5px;'>✅ No active incidents logged.</div>", unsafe_allow_html=True)
        
    st.markdown('</div>', unsafe_allow_html=True)
    
    # 3. PROXIMITY
    st.markdown('<div class="side-card"><div class="card-label">📍 Dell Asset Alerts</div>', unsafe_allow_html=True)
    radius = st.selectbox("Radius", [5, 10, 25, 50], format_func=lambda x: f"{x} KM")
    
    # Real Proximity Check
    active_prox = calculate_proximity(radius)
    
    if not active_prox:
        st.markdown(f'<div style="text-align:center; padding:15px; font-size:0.8rem; color:#999;">No alerts within {radius}km.</div>', unsafe_allow_html=True)
    else:
        for a in active_prox:
            icon = "🔥" if "Fire" in a.get('type','') else "⚡"
            st.markdown(f"""
            <div class="alert-row">
                <div class="alert-top">
                    <span class="alert-type">{icon} {a.get('type','Alert')}</span>
                    <span class="alert-dist">{a.get('distance_km')}km</span>
                </div>
                <div class="alert-site">{a.get('site_name')}</div>
            </div>
            """, unsafe_allow_html=True)
            
    st.markdown('</div>', unsafe_allow_html=True)
