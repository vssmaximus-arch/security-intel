import streamlit as st
import json
import os
from datetime import datetime
import hashlib
import folium
from streamlit_folium import st_folium

# -----------------------------
# 0. BASIC CONFIG
# -----------------------------
st.set_page_config(
    page_title="SRO INTELLIGENCE",
    layout="wide",
    page_icon="🛡️",
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROX_PATH = os.path.join(DATA_DIR, "proximity.json")
LOC_PATH = os.path.join(DATA_DIR, "locations.json")
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

os.makedirs(DATA_DIR, exist_ok=True)

# -----------------------------
# 1. DATA HELPERS
# -----------------------------

@st.cache_data(ttl=60)
def load_news():
    """Load news items produced by news_agent.py and attach a stable ID."""
    if not os.path.exists(NEWS_PATH):
        return []
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            news = json.load(f)
    except Exception:
        news = []
    # attach a stable id used for hiding
    for item in news:
        uid = hashlib.sha256(
            (item.get("title", "") + item.get("url", "")).encode("utf-8")
        ).hexdigest()[:16]
        item["_id"] = uid
    return news


@st.cache_data(ttl=300)
def load_locations_and_proximity():
    """Load Dell locations (sites) and precomputed proximity alerts."""
    # Dell sites
    sites = []
    if os.path.exists(LOC_PATH):
        try:
            with open(LOC_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
                # original locations.json structure: {"locations":[{...}]}
                if isinstance(raw, dict) and "locations" in raw:
                    sites = raw["locations"]
                elif isinstance(raw, list):
                    sites = raw
        except Exception:
            sites = []

    # Proximity alerts from backend pipeline
    proximity = []
    if os.path.exists(PROX_PATH):
        try:
            with open(PROX_PATH, "r", encoding="utf-8") as f:
                pdata = json.load(f)
                proximity = pdata.get("alerts", pdata if isinstance(pdata, list) else [])
        except Exception:
            proximity = []

    return sites, proximity


def append_feedback(entry: dict):
    """Persist feedback in feedback.jsonl (one JSON object per line)."""
    os.makedirs(DATA_DIR, exist_ok=True)
    entry = dict(entry)
    entry["timestamp"] = datetime.utcnow().isoformat() + "Z"
    with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def push_feedback(item, label: str):
    """Store feedback and hide this item in the current session."""
    append_feedback(
        {
            "title": item.get("title"),
            "url": item.get("url"),
            "source": item.get("source"),
            "region": item.get("region"),
            "severity": item.get("severity"),
            "type": item.get("type"),
            "label": label,
        }
    )

    # hide in current session
    hidden = st.session_state.setdefault("hidden_ids", set())
    hidden.add(item["_id"])


# -----------------------------
# 2. THEME / CSS
# -----------------------------

# Custom CSS for professional look
st.markdown(
    """
    <style>
    /* Reset and base styles */
    .stApp {
        background-color: #f8f9fa;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    }
    
    /* Hide Streamlit branding */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    
    /* Custom header */
    .custom-header {
        background: white;
        padding: 16px 32px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: -80px -80px 20px -80px;
        position: sticky;
        top: 0;
        z-index: 999;
    }
    
    .header-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 20px;
        font-weight: 700;
        color: #1f2937;
    }
    
    .logo-icon {
        width: 32px;
        height: 32px;
        background: #3b82f6;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
    }
    
    .header-nav {
        display: flex;
        gap: 24px;
        color: #6b7280;
        font-size: 14px;
        font-weight: 500;
    }
    
    .header-right {
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 13px;
        color: #6b7280;
    }
    
    /* Intelligence card */
    .intel-card {
        background: white;
        border: 1px solid #e5e7eb;
        border-left: 4px solid #ef4444;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 16px;
        transition: box-shadow 0.2s;
    }
    
    .intel-card:hover {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    
    .intel-card.warning {
        border-left-color: #f59e0b;
    }
    
    .intel-card.info {
        border-left-color: #3b82f6;
    }
    
    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
    }
    
    .card-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    
    .badge {
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    .badge-critical {
        background: #fee2e2;
        color: #991b1b;
    }
    
    .badge-warning {
        background: #fef3c7;
        color: #92400e;
    }
    
    .badge-info {
        background: #dbeafe;
        color: #1e40af;
    }
    
    .badge-type {
        background: #f3f4f6;
        color: #374151;
    }
    
    .card-region {
        font-size: 12px;
        color: #9ca3af;
        font-weight: 500;
    }
    
    .card-title {
        font-size: 18px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 8px;
        line-height: 1.4;
    }
    
    .card-title a {
        color: #111827;
        text-decoration: none;
    }
    
    .card-title a:hover {
        color: #3b82f6;
    }
    
    .card-meta {
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 12px;
    }
    
    .card-snippet {
        font-size: 14px;
        color: #4b5563;
        line-height: 1.6;
    }
    
    /* Sidebar panel */
    .sidebar-panel {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
    }
    
    .panel-title {
        font-size: 16px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .proximity-alert {
        padding: 12px;
        background: #fef2f2;
        border-left: 3px solid #ef4444;
        border-radius: 4px;
        margin-bottom: 12px;
    }
    
    .proximity-alert.warning {
        background: #fffbeb;
        border-left-color: #f59e0b;
    }
    
    .proximity-alert.info {
        background: #eff6ff;
        border-left-color: #3b82f6;
    }
    
    .alert-type {
        font-weight: 600;
        font-size: 14px;
        color: #111827;
        margin-bottom: 4px;
    }
    
    .alert-location {
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 4px;
    }
    
    .alert-distance {
        font-size: 12px;
        color: #ef4444;
        font-weight: 600;
    }
    
    /* Stream header */
    .stream-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 24px 0 16px 0;
    }
    
    .stream-title {
        font-size: 20px;
        font-weight: 700;
        color: #111827;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .live-badge {
        background: #ef4444;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
    }
    
    .stream-actions {
        display: flex;
        gap: 12px;
        font-size: 13px;
        color: #3b82f6;
    }
    
    /* Travel advisory */
    .advisory-card {
        padding: 16px;
        border-radius: 6px;
        margin-top: 12px;
    }
    
    .advisory-level {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
    }
    
    .advisory-text {
        font-size: 14px;
        line-height: 1.5;
    }
    
    /* Buttons */
    .stButton > button {
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        border: 1px solid #e5e7eb;
        background: white;
        color: #374151;
        padding: 6px 16px;
    }
    
    .stButton > button:hover {
        background: #f9fafb;
        border-color: #d1d5db;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# 3. HEADER
# -----------------------------

now = datetime.now()
date_str = now.strftime("%A, %b %d, %Y")
time_str = now.strftime("%I:%M %p GMT+11")

st.markdown(
    f"""
    <div class="custom-header">
        <div class="header-logo">
            <div class="logo-icon">🛡️</div>
            <div>SRO <span style="color: #3b82f6;">INTELLIGENCE</span></div>
        </div>
        <div class="header-nav">
            <span style="color: #111827; font-weight: 600;">GLOBAL</span>
            <span>AMER</span>
            <span>EMEA</span>
            <span>APJC</span>
            <span>LATAM</span>
        </div>
        <div class="header-right">
            <div>
                <div style="font-weight: 600; color: #111827;">{date_str}</div>
                <div style="font-size: 12px;">{time_str}</div>
            </div>
            <button style="background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                📋 Daily Briefings
            </button>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# 4. MAIN LAYOUT
# -----------------------------

news_items = load_news()
sites, proximity_alerts = load_locations_and_proximity()

# Initialize session state for region
if "selected_region" not in st.session_state:
    st.session_state.selected_region = "GLOBAL"

col1, col2 = st.columns([3, 1])

with col1:
    # Map section
    # Filter sites by region (if needed)
    map_sites = sites  # Show all sites for now
    
    # Create map
    m = folium.Map(
        location=[20, 0],
        zoom_start=2,
        tiles="CartoDB positron",
        min_zoom=1,
        max_bounds=True,
    )
    
    # Dell sites (blue markers)
    for s in map_sites:
        lat, lon = s.get("lat"), s.get("lon")
        if lat is None or lon is None:
            continue
        tooltip = s.get("name", "Site")
        folium.Marker(
            [lat, lon],
            tooltip=tooltip,
            icon=folium.Icon(color="blue", icon="building", prefix="fa"),
        ).add_to(m)
    
    # Proximity alerts (red markers)
    for alert in proximity_alerts:
        lat, lon = alert.get("lat"), alert.get("lon")
        if lat is None or lon is None:
            continue
        folium.Marker(
            [lat, lon],
            tooltip=alert.get("type", "Alert"),
            icon=folium.Icon(color="red", icon="exclamation-triangle", prefix="fa"),
        ).add_to(m)
    
    st_folium(m, width="100%", height=400)
    
    # Intelligence stream header
    st.markdown(
        """
        <div class="stream-header">
            <div class="stream-title">
                🔵 Real-time Intelligence Stream
                <span class="live-badge">LIVE</span>
            </div>
            <div class="stream-actions">
                <span style="cursor: pointer;">CONFIGURE SOURCES</span>
                <span style="cursor: pointer;">VIEW FULL STREAM →</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    # Filter news items
    hidden_ids = st.session_state.get("hidden_ids", set())
    visible_news = [n for n in news_items if n.get("_id") not in hidden_ids]
    
    if not visible_news:
        st.info("No active incidents to display.")
    else:
        for item in visible_news[:10]:  # Show top 10
            sev = int(item.get("severity", 1) or 1)
            if sev >= 3:
                sev_tag = "CRITICAL"
                sev_class = "badge-critical"
                card_class = ""
            elif sev == 2:
                sev_tag = "WARNING"
                sev_class = "badge-warning"
                card_class = "warning"
            else:
                sev_tag = "MONITOR"
                sev_class = "badge-info"
                card_class = "info"
            
            itype = item.get("type", "GENERAL")
            region_label = item.get("region", "GLOBAL")
            url = item.get("url") or "#"
            src = item.get("source", "Unknown Source")
            time_str = item.get("time", "")
            if time_str:
                try:
                    dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                    time_str = dt.strftime("%I:%M %p") + " • " + dt.strftime("%b %d")
                except:
                    time_str = "Recently"
            
            st.markdown(
                f"""
                <div class="intel-card {card_class}">
                    <div class="card-header">
                        <div class="card-badges">
                            <span class="badge {sev_class}">{sev_tag}</span>
                            <span class="badge badge-type">{itype}</span>
                        </div>
                        <div class="card-region">{region_label}</div>
                    </div>
                    <div class="card-title">
                        <a href="{url}" target="_blank">{item.get("title", "(No title)")}</a>
                    </div>
                    <div class="card-meta">
                        {src} • {time_str}
                    </div>
                    <div class="card-snippet">
                        {item.get("snippet", "")}
                    </div>
                </div>
                """,
                unsafe_allow_html=True,
            )

with col2:
    # History Search panel
    st.markdown(
        """
        <div class="sidebar-panel">
            <div class="panel-title">🕒 History Search</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.date_input("Pick a date to load archived intelligence", label_visibility="collapsed")
    
    # Travel Safety Check panel
    st.markdown(
        """
        <div class="sidebar-panel">
            <div class="panel-title">✈️ Travel Safety Check</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    ADVISORIES = {
        "Australia": (2, "Exercise increased caution."),
        "Brazil": (3, "Reconsider travel."),
        "Canada": (1, "Exercise normal precautions."),
        "China": (3, "Reconsider travel."),
        "France": (1, "Exercise normal precautions."),
        "Germany": (1, "Exercise normal precautions."),
        "India": (2, "Exercise increased caution."),
        "Ireland": (1, "Exercise normal precautions."),
        "Italy": (1, "Exercise normal precautions."),
        "Japan": (1, "Exercise normal precautions."),
        "Mexico": (2, "Exercise increased caution."),
        "South Africa": (2, "Exercise increased caution."),
        "United Kingdom": (1, "Exercise normal precautions."),
        "United States": (1, "Exercise normal precautions."),
    }
    
    country = st.selectbox("Select Country...", sorted(ADVISORIES.keys()), label_visibility="collapsed")
    lvl, txt = ADVISORIES[country]
    
    level_colors = {
        1: "#3b82f6",
        2: "#f59e0b",
        3: "#ef4444",
        4: "#991b1b"
    }
    
    bg_colors = {
        1: "#eff6ff",
        2: "#fffbeb",
        3: "#fef2f2",
        4: "#fee2e2"
    }
    
    st.markdown(
        f"""
        <div class="advisory-card" style="background: {bg_colors.get(lvl, '#eff6ff')}; border-left: 4px solid {level_colors.get(lvl, '#3b82f6')};">
            <div class="advisory-level" style="color: {level_colors.get(lvl, '#3b82f6')};">
                LEVEL {lvl} ADVISORY
            </div>
            <div class="advisory-text" style="color: #374151;">
                {txt}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    # Proximity Alerts panel
    st.markdown(
        """
        <div class="sidebar-panel" style="margin-top: 20px;">
            <div class="panel-title">📍 Dell Asset<br/>Proximity Alerts</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    radius = st.select_slider(
        "WITHIN RADIUS",
        options=[5, 10, 25, 50],
        value=5,
        format_func=lambda x: f"{x} KM"
    )
    
    near_alerts = [a for a in proximity_alerts if a.get("distance_km", 9999) <= radius]
    
    if not near_alerts:
        st.info(f"No alerts within {radius}km of Dell sites.")
    else:
        for alert in near_alerts:
            alert_type = alert.get("type", "Alert")
            site_name = alert.get("site_name", "Unknown Site")
            distance = alert.get("distance_km", "?")
            
            # Determine alert style based on type
            if "fire" in alert_type.lower():
                alert_class = ""
                icon = "🔥"
            elif "flood" in alert_type.lower():
                alert_class = "info"
                icon = "💧"
            else:
                alert_class = "warning"
                icon = "⚡"
            
            st.markdown(
                f"""
                <div class="proximity-alert {alert_class}">
                    <div class="alert-type">{icon} {alert_type}</div>
                    <div class="alert-location">🏢 {site_name}</div>
                    <div class="alert-distance">{distance}km</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        
        st.markdown(
            """
            <div style="text-align: center; margin-top: 16px;">
                <a href="#" style="color: #3b82f6; font-size: 13px; font-weight: 600; text-decoration: none;">
                    VIEW ALL ALERTS
                </a>
            </div>
            """,
            unsafe_allow_html=True,
        )
