# streamlit_app.py
# OS INFOHUB – Streamlit Edition (Light Mode Fixed)

import os
import json
import math
from datetime import datetime, timedelta
from collections import Counter
import re

import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium

# Optional – only used if you actually set GOOGLE_API_KEY / st.secrets
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except Exception:
    GEMINI_AVAILABLE = False

# ============================================================
# 1. PATHS & BASIC CONFIG
# ============================================================

st.set_page_config(page_title="OS INFOHUB", layout="wide", page_icon="🛡️")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
CONFIG_DIR = os.path.join(BASE_DIR, "config")
os.makedirs(DATA_DIR, exist_ok=True)

# Corrected Paths based on your structure
NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROXIMITY_PATH = os.path.join(DATA_DIR, "proximity.json")
LOCATIONS_PATH = os.path.join(CONFIG_DIR, "locations.json") # Locations are in config/
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

# Optional Gemini key
GEMINI_KEY = os.environ.get("GOOGLE_API_KEY") or st.secrets.get("GOOGLE_API_KEY", None)
if GEMINI_AVAILABLE and GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
else:
    GEMINI_AVAILABLE = False

# Regions used everywhere
REGIONS = ["Global", "AMER", "EMEA", "APJC", "LATAM"]

# ============================================================
# 2. STYLING (RESTORED LIGHT MODE - OS INFOHUB)
# ============================================================

st.markdown(
    """
<style>
/* Global look - Light Mode */
.stApp {
    background-color: #f4f6f8;
    color: #333;
    font-family: 'Inter', system-ui, sans-serif;
}

/* Kill default header/footer */
#MainMenu, header, footer {visibility: hidden;}

/* Header strip */
.os-header {
    background: #ffffff;
    border-bottom: 1px solid #e0e0e0;
    padding: 16px 32px;
    margin: -60px -20px 20px -20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.os-logo {
    font-size: 1.3rem;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: #202124;
}
.os-logo span {
    color: #0076CE; /* Dell Blue */
}
.os-sub {
    font-size: 0.8rem;
    color: #5f6368;
    font-weight: 600;
}

/* Region tabs */
.os-region-tabs {
    margin-bottom: 15px;
}
.os-region-pill {
    display: inline-block;
    padding: 7px 18px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 0.8rem;
    color: #5f6368;
    cursor: pointer;
    text-transform: uppercase;
    margin-right: 5px;
    background-color: #f1f3f4;
}
.os-region-pill.active {
    background-color: #202124;
    color: #fff;
}

/* Cards */
.os-card {
    background: #ffffff;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    padding: 16px 20px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    transition: transform 0.2s;
}
.os-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
}
.os-card-title {
    font-size: 1rem;
    font-weight: 700;
    color: #202124;
    margin-bottom: 6px;
}
.os-card-meta {
    font-size: 0.75rem;
    color: #5f6368;
    margin-bottom: 8px;
}
.os-card-body {
    font-size: 0.85rem;
    color: #3c4043;
    line-height: 1.5;
}

/* Feed badges */
.os-tag {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    border: 1px solid #eee;
    margin-right: 6px;
}
.os-tag-crit { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }
.os-tag-warn { background: #fef7e0; color: #e37400; border-color: #feebc8; }
.os-tag-info { background: #e8f0fe; color: #1a73e8; border-color: #d2e3fc; }
.os-tag-type { background: #f1f3f4; color: #5f6368; }
.os-tag-region { float: right; color: #9aa0a6; border: none; }

/* Side cards */
.os-side-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e0e0e0;
    padding: 20px;
    margin-bottom: 20px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.os-side-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: #202124;
    margin-bottom: 12px;
}

/* Proximity rows */
.os-alert-row {
    padding: 10px 0;
    border-bottom: 1px solid #f1f1f1;
}
.os-alert-top {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
}
.os-alert-site {
    font-size: 0.8rem;
    font-weight: 600;
    color: #5f6368;
}

/* Advisory Box */
.advisory-box { background: #f8f9fa; border-left: 4px solid #1a73e8; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
.advisory-level { font-weight: 800; font-size: 0.8rem; color: #1a73e8; margin-bottom: 4px; }
.advisory-text { font-size: 0.9rem; color: #333; font-weight: 600; }

/* Buttons */
.stButton>button {
    font-size: 0.7rem;
    padding: 2px 10px;
    height: auto;
    border-radius: 4px;
}
</style>
""",
    unsafe_allow_html=True,
)

# ============================================================
# 3. DATA LOADERS
# ============================================================

@st.cache_data(ttl=120)
def load_news():
    if not os.path.exists(NEWS_PATH): return []
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "articles" in data: data = data["articles"]
        return data
    except Exception: return []

@st.cache_data(ttl=300)
def load_locations():
    if not os.path.exists(LOCATIONS_PATH): return []
    try:
        with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception: return []

@st.cache_data(ttl=60)
def load_proximity():
    if not os.path.exists(PROXIMITY_PATH): return []
    try:
        with open(PROXIMITY_PATH, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj.get("alerts", [])
    except Exception: return []

@st.cache_data(ttl=60)
def load_feedback_counters():
    good = Counter(); bad = Counter()
    if not os.path.exists(FEEDBACK_PATH): return good, bad
    try:
        with open(FEEDBACK_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                try:
                    obj = json.loads(line)
                    label = obj.get("label")
                    text = (obj.get("title", "") + " " + obj.get("snippet", "")).lower()
                    tokens = [t for t in re.findall(r"[a-z]{3,}", text)]
                    target = good if label == "RELEVANT" else bad if label == "NOT_RELEVANT" else None
                    if target: 
                        for t in tokens: target[t] += 1
                except: continue
    except: pass
    return good, bad

# ============================================================
# 4. RELEVANCE SCORING / "AI AGENT"
# ============================================================

def score_articles(raw_news):
    # Simplified scoring for UI responsiveness
    good_terms, bad_terms = load_feedback_counters()
    if not raw_news: return []
    
    scored = []
    for art in raw_news:
        # Pass through existing severity if available
        art["os_score"] = 0.5 
        # Boost if severity high
        if art.get("severity", 1) >= 3: art["os_score"] = 0.9
        scored.append(art)
    return scored

def write_feedback(article, label):
    entry = {
        "label": label,
        "title": article.get("title"),
        "snippet": article.get("snippet"),
        "url": article.get("url"),
        "time_marked": datetime.utcnow().isoformat() + "Z",
    }
    try:
        with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        load_feedback_counters.clear()
        st.toast(f"✅ Feedback saved: {label}")
    except Exception:
        st.toast("Failed to write feedback", icon="⚠️")

# ============================================================
# 5. UI LAYOUT
# ============================================================

news_raw = load_news()
locations = load_locations()
proximity_alerts = load_proximity()
news_scored = score_articles(news_raw)

# ---- HEADER ----
now = datetime.utcnow()
clock_str = now.strftime("%A %d %b %Y | %H:%M UTC")

st.markdown(f"""
<div class="os-header">
  <div class="os-logo">OS <span>INFOHUB</span></div>
  <div class="os-sub">{clock_str}</div>
</div>
""", unsafe_allow_html=True)

# ---- REGION SELECTION ----
sel_region = st.radio("Region", REGIONS, horizontal=True, label_visibility="collapsed")

# ---- MAIN COLUMNS ----
col_main, col_side = st.columns([3, 1])

# === LEFT: MAP + STREAM ===
with col_main:
    # 1. MAP
    map_sites = locations if sel_region == "Global" else [s for s in locations if s.get("region") == sel_region]
    center = [20, 0]
    if map_sites:
        avg_lat = sum(s["lat"] for s in map_sites) / len(map_sites)
        avg_lon = sum(s["lon"] for s in map_sites) / len(map_sites)
        center = [avg_lat, avg_lon]

    m = folium.Map(location=center, zoom_start=2 if sel_region=="Global" else 3, tiles="CartoDB voyager", control_scale=True)

    # Blue Pins (Sites)
    for s in map_sites:
        folium.Marker(
            [s["lat"], s["lon"]],
            tooltip=f"{s.get('name')}",
            icon=folium.Icon(color="blue", icon="building", prefix="fa"),
        ).add_to(m)

    # Red Pins (Alerts)
    for a in proximity_alerts:
        if sel_region != "Global" and a.get("site_region") != sel_region: continue
        if "lat" in a:
            color = "red" if a.get("severity", 1) >= 3 else "orange"
            folium.Marker(
                [a["lat"], a["lon"]],
                tooltip=f"ALERT: {a.get('type')}",
                icon=folium.Icon(color=color, icon="exclamation-triangle", prefix="fa"),
            ).add_to(m)

    st_folium(m, width="100%", height=400)

    # 2. STREAM
    st.markdown("### ⚡ Real-time Intelligence Stream")
    
    # Filter
    cat_val = st.session_state.get("risk_category", "All Categories")
    display_feed = [n for n in news_scored if sel_region == "Global" or n.get("region") == sel_region]
    
    if cat_val != "All Categories":
        key = cat_val.split()[0].upper()
        display_feed = [n for n in display_feed if key in str(n.get("type", "")).upper()]

    if not display_feed:
        st.info("No active incidents matching criteria.")
    
    for idx, item in enumerate(display_feed[:50]):
        sev = item.get("severity", 1)
        if sev >= 3:
            col_style = "#d93025"; badge_cls = "os-tag-crit"; lbl = "CRITICAL"
        elif sev == 2:
            col_style = "#f9ab00"; badge_cls = "os-tag-warn"; lbl = "WARNING"
        else:
            col_style = "#1a73e8"; badge_cls = "os-tag-info"; lbl = "MONITOR"

        st.markdown(f"""
        <div class="os-card" style="border-left: 5px solid {col_style};">
          <div style="margin-bottom:4px;">
            <span class="os-tag {badge_cls}">{lbl}</span>
            <span class="os-tag os-tag-type">{item.get('type', 'GENERAL')}</span>
            <span class="os-tag os-tag-region">{item.get('region', 'GLOBAL')}</span>
          </div>
          <div class="os-card-title">{item.get('title')}</div>
          <div class="os-card-meta">{item.get('source')} • {item.get('time', '')[:16]}</div>
          <div class="os-card-body">{item.get('snippet', '')}</div>
        </div>
        """, unsafe_allow_html=True)

        c1, c2, _ = st.columns([1, 1, 6])
        with c1:
            if st.button("Relevant", key=f"y_{idx}"): write_feedback(item, "RELEVANT")
        with c2:
            if st.button("Not Relevant", key=f"n_{idx}"): write_feedback(item, "NOT_RELEVANT")

# === RIGHT: WIDGETS ===
with col_side:
    # HISTORY
    with st.container():
        st.markdown('<div class="os-side-card"><div class="os-side-title">⏱ History Search</div>', unsafe_allow_html=True)
        st.date_input("Select Date", label_visibility="collapsed")
        st.markdown('</div>', unsafe_allow_html=True)

    # TRAVEL
    with st.container():
        st.markdown('<div class="os-side-card"><div class="os-side-title">✈ Travel Safety Check</div>', unsafe_allow_html=True)
        
        # Hardcoded Advisory List (from your app.js)
        advisories = {
            "Afghanistan": 4, "Russia": 4, "Ukraine": 4, "Israel": 3, "China": 3, "Mexico": 2, "India": 2
        }
        
        # Merge locations countries
        all_countries = sorted(list(set([s.get("country") for s in locations] + list(advisories.keys()))))
        country = st.selectbox("Country", all_countries, label_visibility="collapsed")
        
        lvl = advisories.get(country, 1)
        acl = "#ea4335" if lvl==4 else "#fbbc04" if lvl==3 else "#f9ab00" if lvl==2 else "#1a73e8"
        txt = "Do Not Travel" if lvl==4 else "Reconsider Travel" if lvl==3 else "Exercise Caution" if lvl==2 else "Normal Precautions"
        
        st.markdown(f"""
        <div class="advisory-box" style="border-left-color:{acl}; background-color:{acl}15;">
            <div class="advisory-level" style="color:{acl}">LEVEL {lvl} ADVISORY</div>
            <div class="advisory-text">{txt}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # 72h Check
        st.markdown("<div style='font-size:0.75rem; font-weight:700; margin-top:10px; color:#555;'>Recent Events (72h)</div>", unsafe_allow_html=True)
        hits = [n for n in news_raw if country.lower() in (n.get('title','')+n.get('snippet','')).lower()]
        if hits:
            for h in hits[:2]:
                st.markdown(f"<div style='font-size:0.7rem; border-bottom:1px solid #eee; padding:3px 0;'>• {h['title']}</div>", unsafe_allow_html=True)
        else:
            st.markdown("<div style='font-size:0.7rem; color:green;'>✅ No active incidents.</div>", unsafe_allow_html=True)
        
        st.markdown('</div>', unsafe_allow_html=True)

    # PROXIMITY
    with st.container():
        st.markdown('<div class="os-side-card"><div class="os-side-title">📍 Proximity Alerts</div>', unsafe_allow_html=True)
        rad = st.selectbox("Radius", [5, 10, 25, 50], format_func=lambda x: f"{x} KM", label_visibility="collapsed")
        
        visible = [a for a in proximity_alerts if a.get("distance_km", 999) <= rad]
        if not visible:
            st.markdown(f"<div style='text-align:center; color:#999; font-size:0.75rem;'>No alerts within {rad}km.</div>", unsafe_allow_html=True)
        else:
            for a in visible[:5]:
                col = "#ea4335" if a.get("severity", 1) >= 3 else "#fbbc04"
                st.markdown(f"""
                <div class="os-alert-row">
                    <div class="os-alert-top">
                        <span style="color:{col}; font-weight:700;">{a.get('type')}</span>
                        <span style="color:{col}; font-weight:700;">{a.get('distance_km')}km</span>
                    </div>
                    <div class="os-alert-site">{a.get('site_name')}</div>
                </div>
                """, unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)

    # FILTER
    with st.container():
        st.markdown('<div class="os-side-card"><div class="os-side-title">🏷 Risk Category</div>', unsafe_allow_html=True)
        st.selectbox("Category", ["All Categories", "Physical Security", "Cyber Security", "Supply Chain"], key="risk_category", label_visibility="collapsed")
        st.markdown('</div>', unsafe_allow_html=True)
