import streamlit as st
import json
import os
import math
import pandas as pd
import folium
from streamlit_folium import st_folium
from datetime import datetime, timedelta

# ==========================================
# 1. CONFIGURATION & PATHS
# ==========================================
st.set_page_config(page_title="OS INFOHUB", layout="wide", page_icon="🛡️")

# Paths based on your file structure
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NEWS_PATH = os.path.join(BASE_DIR, "public", "data", "news.json")
PROX_PATH = os.path.join(BASE_DIR, "public", "data", "proximity.json")
FEEDBACK_PATH = os.path.join(BASE_DIR, "public", "data", "feedback.jsonl")

# Ensure Data Dir Exists
os.makedirs(os.path.join(BASE_DIR, "public", "data"), exist_ok=True)

# --- DATA: DELL SITES (From your app.js) ---
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

# --- DATA: ADVISORIES (From your app.js) ---
ADVISORIES = {
    "Afghanistan": { "level": 4, "text": "Do Not Travel" },
    "Israel": { "level": 3, "text": "Reconsider Travel" },
    "China": { "level": 3, "text": "Reconsider Travel" },
    "Mexico": { "level": 2, "text": "Exercise Increased Caution" },
    "India": { "level": 2, "text": "Exercise Increased Caution" },
    "United Kingdom": { "level": 2, "text": "Exercise Increased Caution" },
    "Russia": { "level": 4, "text": "Do Not Travel" },
    "Ukraine": { "level": 4, "text": "Do Not Travel" }
}

# ==========================================
# 2. INJECT CSS
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    .stApp { background-color: #f4f6f8; font-family: 'Inter', sans-serif; }
    #MainMenu, footer, header {visibility: hidden;}
    
    /* Header */
    .header-container {
        display: flex; justify-content: space-between; align-items: center;
        background: white; padding: 15px 32px; border-bottom: 1px solid #e0e0e0;
        margin: -60px -20px 20px -20px; 
    }
    .logo-text { font-size: 1.3rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
    .logo-text span { color: #0076CE; }
    
    /* Cards */
    .feed-card { background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 10px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .side-card { background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); }
    
    /* Typography */
    .feed-title { font-size: 1rem; font-weight: 700; color: #202124; margin-bottom: 6px; }
    .feed-meta { font-size: 0.75rem; color: #5f6368; margin-bottom: 8px; }
    .feed-desc { font-size: 0.85rem; color: #3c4043; line-height: 1.5; }
    .card-label { font-size: 0.95rem; font-weight: 700; color: #202124; margin-bottom: 12px; }
    
    /* Badges */
    .ftag { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; border: 1px solid #eee; margin-right: 6px; }
    .crit { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }
    .warn { background: #fef7e0; color: #e37400; border-color: #feebc8; }
    .info { background: #e8f0fe; color: #1a73e8; border-color: #d2e3fc; }
    
    /* Advisory */
    .advisory-box { background: #f8f9fa; border-left: 4px solid #1a73e8; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
    
    /* Proximity */
    .alert-row { padding: 10px 0; border-bottom: 1px solid #f1f1f1; }
    .alert-top { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .alert-val { font-weight: 700; color: #d93025; font-size: 0.85rem; }
    
    /* Buttons */
    .stButton button { font-size: 0.7rem; padding: 2px 8px; height: auto; min-height: 0px; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 3. BACKEND LOGIC
# ==========================================

@st.cache_data(ttl=60) # Updates every 60s
def load_live_data():
    # Load News
    news = []
    if os.path.exists(NEWS_PATH):
        try:
            with open(NEWS_PATH, 'r') as f:
                news = json.load(f)
        except: pass
    
    # Load Proximity (Pre-calculated by your generate_reports.py)
    prox = []
    if os.path.exists(PROX_PATH):
        try:
            with open(PROX_PATH, 'r') as f:
                data = json.load(f)
                prox = data.get('alerts', [])
        except: pass
        
    return news, prox

def save_feedback(title, label):
    """Writes to feedback.jsonl for the AI Agent to learn"""
    entry = {
        "title": title,
        "label": label,
        "timestamp": datetime.now().isoformat()
    }
    with open(FEEDBACK_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")
    st.toast(f"✅ Feedback Saved: {label}")

def calculate_proximity_live(news_data, sites, radius_km):
    """
    If the backend script hasn't run recently, we can calculate proximity
    live here using the news data + Dell Sites list.
    """
    alerts = []
    # Simple check: Does news text mention a site? 
    # (Real geocoding happens in your python backend script, this is a UI-layer backup)
    for item in news_data:
        txt = (item.get('title', '') + item.get('snippet', '')).lower()
        for site in sites:
            if site['name'].lower() in txt:
                alerts.append({
                    "type": "Mention Match",
                    "site_name": site['name'],
                    "distance_km": 0.0,
                    "severity": item.get('severity', 1),
                    "article_title": item.get('title')
                })
    return alerts

# ==========================================
# 4. APP LAYOUT
# ==========================================

news_feed, proximity_backend = load_live_data()

# --- HEADER ---
st.markdown("""
<div class="header-container">
    <div class="logo-text">OS <span>INFOHUB</span></div>
    <div style="font-size:0.8rem; color:#555;"><b>Global Security Operations</b> | Live Stream</div>
</div>
""", unsafe_allow_html=True)

# --- NAV TABS ---
regions = ["Global", "AMER", "EMEA", "APJC", "LATAM"]
sel_region = st.radio("Region", regions, horizontal=True, label_visibility="collapsed")

# --- MAIN SPLIT ---
col_main, col_widgets = st.columns([3, 1])

# === LEFT: MAP + FEED ===
with col_main:
    # 1. MAP
    map_sites = DELL_SITES if sel_region == 'Global' else [x for x in DELL_SITES if x['region'] == sel_region]
    
    m = folium.Map(location=[20, 0], zoom_start=2, tiles="CartoDB voyager", control_scale=True)
    
    # Blue Pins (Sites)
    for s in map_sites:
        folium.Marker(
            [s['lat'], s['lon']], 
            tooltip=s['name'], 
            icon=folium.Icon(color="blue", icon="building", prefix="fa")
        ).add_to(m)
        
    # Red Pins (Alerts)
    # Filter alerts by region
    active_alerts = [a for a in proximity_backend if (sel_region == 'Global' or a.get('site_region') == sel_region)]
    for a in active_alerts:
        if 'lat' in a:
             folium.Marker(
                [a['lat'], a['lon']], 
                tooltip=f"ALERT: {a['type']}", 
                icon=folium.Icon(color="red", icon="exclamation", prefix="fa")
            ).add_to(m)

    st_folium(m, width="100%", height=400)

    # 2. FEED
    st.markdown("### ⚡ Real-time Intelligence Stream")
    
    # Logic: Filter News
    filtered_news = [n for n in news_feed if sel_region == 'Global' or n.get('region') == sel_region]
    
    # Logic: Category Filter (from Widget state)
    cat_val = st.session_state.get('cat_selector', 'All Categories')
    if cat_val != 'All Categories':
        key = cat_val.split()[0].upper() # e.g. "PHYSICAL"
        filtered_news = [n for n in filtered_news if key in str(n.get('type','')).upper()]

    if not filtered_news:
        st.info("No active incidents found.")
    
    for i, item in enumerate(filtered_news[:20]):
        # Style Logic
        sev = item.get('severity', 1)
        if sev >= 3:
            col = "#d93025"; badge = "crit"; lbl = "CRITICAL"
        elif sev == 2:
            col = "#f9ab00"; badge = "warn"; lbl = "WARNING"
        else:
            col = "#1a73e8"; badge = "info"; lbl = "MONITOR"
            
        # Card Body
        st.markdown(f"""
        <div class="feed-card" style="border-left: 5px solid {col};">
            <div style="margin-bottom:6px;">
                <span class="ftag {badge}">{lbl}</span>
                <span class="ftag info" style="color:black; background:#eee; border:none;">{item.get('type', 'GENERAL')}</span>
                <span class="ftag info" style="float:right; background:white; border:none; color:#999;">{item.get('region')}</span>
            </div>
            <div class="feed-title">{item.get('title')}</div>
            <div class="feed-meta">{item.get('source')} • {item.get('time', '')[:10]}</div>
            <div class="feed-desc">{item.get('snippet', '')}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # Feedback Buttons (Real Logic)
        c1, c2, c3 = st.columns([1, 1, 6])
        with c1:
            if st.button("Relevant", key=f"y_{i}"):
                save_feedback(item['title'], "RELEVANT")
        with c2:
            if st.button("Not Relevant", key=f"n_{i}"):
                save_feedback(item['title'], "NOT_RELEVANT")

# === RIGHT: WIDGETS ===
with col_widgets:
    
    # 1. HISTORY
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">⏱️ History Search</div>', unsafe_allow_html=True)
        st.date_input("Load Archive", label_visibility="collapsed")
        st.markdown('</div>', unsafe_allow_html=True)

    # 2. TRAVEL (Real Logic)
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">✈️ Travel Safety Check</div>', unsafe_allow_html=True)
        # Populate country list from advisories + generic list
        c_list = sorted(list(set(list(ADVISORIES.keys()) + ["United States", "Canada", "Germany", "Japan", "Australia"])))
        country = st.selectbox("Country", c_list, label_visibility="collapsed")
        
        # Advisory Display
        adv = ADVISORIES.get(country, {"level": 1, "text": "Exercise Normal Precautions"})
        lvl = adv['level']
        acl = "#d93025" if lvl==4 else "#e37400" if lvl==3 else "#f9ab00" if lvl==2 else "#1a73e8"
        
        st.markdown(f"""
        <div class="advisory-box" style="border-left:4px solid {acl}; background-color:{acl}15;">
            <div class="advisory-level" style="color:{acl}">LEVEL {lvl} ADVISORY</div>
            <div class="advisory-text">{adv['text']}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # 72h Event Search (Real Filter)
        st.markdown("**Recent Events (72h)**")
        hits = [n for n in news_feed if country.lower() in (n.get('title','')+n.get('snippet','')).lower()]
        if hits:
            for h in hits[:2]:
                st.markdown(f"<div style='font-size:0.75rem; border-bottom:1px solid #eee; padding:4px 0;'>• {h['title']}</div>", unsafe_allow_html=True)
        else:
            st.markdown("<div style='font-size:0.75rem; color:green;'>✅ No active incidents.</div>", unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)

    # 3. PROXIMITY (Real Logic)
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">📍 Proximity Alerts</div>', unsafe_allow_html=True)
        rad_km = st.selectbox("Radius", [5, 10, 25, 50], format_func=lambda x: f"{x} KM", label_visibility="collapsed")
        
        # Filter Alerts based on Radius
        visible_alerts = [a for a in proximity_backend if a.get('distance_km', 0) <= rad_km]
        
        if not visible_alerts:
            st.markdown(f"<div style='text-align:center; color:#999; font-size:0.8rem; padding:10px;'>No alerts within {rad_km}km.</div>", unsafe_allow_html=True)
        else:
            for a in visible_alerts:
                icon = "🔥" if "Fire" in a.get('type','') else "⚡"
                st.markdown(f"""
                <div class="alert-row">
                    <div class="alert-top">
                        <span class="alert-type" style="font-size:0.8rem;">{icon} {a.get('type')}</span>
                        <span class="alert-val">{a.get('distance_km')}km</span>
                    </div>
                    <div class="alert-site">{a.get('site_name')}</div>
                </div>
                """, unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)

    # 4. CATEGORY FILTER
    with st.container():
        st.markdown('<div class="side-card"><div class="card-label">🏷️ Risk Filter</div>', unsafe_allow_html=True)
        st.selectbox("Category", ["All Categories", "Physical Security", "Cyber Security", "Supply Chain"], key='cat_selector', label_visibility="collapsed")
        st.markdown('</div>', unsafe_allow_html=True)
