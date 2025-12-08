import os
import json
from datetime import datetime

import streamlit as st
import folium
from streamlit_folium import st_folium

# ==========================================
# 1. CONFIG & PATHS
# ==========================================
st.set_page_config(
    page_title="OS INFOHUB",
    layout="wide",
    page_icon="🛡️",
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROX_PATH = os.path.join(DATA_DIR, "proximity.json")
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

# ==========================================
# 2. STATIC DATA
# ==========================================

DELL_SITES = [
    # AMER
    {"name": "Dell Round Rock HQ", "country": "US", "region": "AMER", "lat": 30.5083, "lon": -97.6788},
    {"name": "Dell Austin Parmer", "country": "US", "region": "AMER", "lat": 30.3952, "lon": -97.6843},
    {"name": "Dell Hopkinton", "country": "US", "region": "AMER", "lat": 42.2287, "lon": -71.5226},
    {"name": "Dell Nashville Hub", "country": "US", "region": "AMER", "lat": 36.1627, "lon": -86.7816},
    {"name": "Dell Santa Clara", "country": "US", "region": "AMER", "lat": 37.3541, "lon": -121.9552},
    {"name": "Dell Toronto", "country": "CA", "region": "AMER", "lat": 43.6532, "lon": -79.3832},
    {"name": "Dell Mexico City", "country": "MX", "region": "AMER", "lat": 19.4326, "lon": -99.1332},
    {"name": "Dell Hortolândia Mfg", "country": "BR", "region": "LATAM", "lat": -22.8583, "lon": -47.2208},
    {"name": "Dell São Paulo", "country": "BR", "region": "LATAM", "lat": -23.5505, "lon": -46.6333},
    # EMEA
    {"name": "Dell Cork Campus", "country": "IE", "region": "EMEA", "lat": 51.8985, "lon": -8.4756},
    {"name": "Dell Limerick", "country": "IE", "region": "EMEA", "lat": 52.6638, "lon": -8.6267},
    {"name": "Dell Bracknell", "country": "GB", "region": "EMEA", "lat": 51.416, "lon": -0.754},
    {"name": "Dell Frankfurt", "country": "DE", "region": "EMEA", "lat": 50.1109, "lon": 8.6821},
    {"name": "Dell Dubai", "country": "AE", "region": "EMEA", "lat": 25.2048, "lon": 55.2708},
    # APJC
    {"name": "Dell Bangalore", "country": "IN", "region": "APJC", "lat": 12.9716, "lon": 77.5946},
    {"name": "Dell Singapore", "country": "SG", "region": "APJC", "lat": 1.3521, "lon": 103.8198},
    {"name": "Dell Xiamen Mfg", "country": "CN", "region": "APJC", "lat": 24.4798, "lon": 118.0894},
    {"name": "Dell Penang", "country": "MY", "region": "APJC", "lat": 5.4164, "lon": 100.3327},
    {"name": "Dell Sydney", "country": "AU", "region": "APJC", "lat": -33.8688, "lon": 151.2093},
]

ADVISORIES = {
    "Afghanistan": {"level": 4, "text": "Do Not Travel"},
    "Israel": {"level": 3, "text": "Reconsider Travel"},
    "China": {"level": 3, "text": "Reconsider Travel"},
    "Mexico": {"level": 2, "text": "Exercise Increased Caution"},
    "India": {"level": 2, "text": "Exercise Increased Caution"},
    "United Kingdom": {"level": 2, "text": "Exercise Increased Caution"},
    "Russia": {"level": 4, "text": "Do Not Travel"},
    "Ukraine": {"level": 4, "text": "Do Not Travel"},
}

CATEGORY_OPTIONS = [
    "All Categories",
    "Physical Security",
    "Cyber Security",
    "Supply Chain",
    "Crisis / Weather",
    "Health / Safety",
]

CATEGORY_KEY = {
    "Physical Security": "PHYSICAL",
    "Cyber Security": "CYBER",
    "Supply Chain": "SUPPLY",
    "Crisis / Weather": "CRISIS",
    "Health / Safety": "HEALTH",
}

# ==========================================
# 3. CSS – mimic original GitHub dashboard
# ==========================================
st.markdown(
    """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

html, body, .stApp {
    background-color: #0f1115;
    font-family: 'Inter', sans-serif;
}

/* center white app shell similar to your HTML */
section.main > div.block-container {
    padding-top: 1rem;
    padding-bottom: 1.5rem;
    max-width: 1500px;
}

.app-shell {
    background-color: #ffffff;
    border-radius: 24px;
    min-height: 92vh;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    padding: 0;
}

/* header */
.header-container {
    padding: 15px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #f0f0f0;
    height: 70px;
}
.logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
.logo-text span { color: #0076CE; }

.header-right { display: flex; align-items: center; gap: 24px; }

/* nav pills (Streamlit radio styling) */
.region-radio > div[role="radiogroup"] {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 10px;
    background-color: #f1f3f4;
}
.region-radio label {
    border-radius: 8px;
    padding: 7px 18px;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    color: #5f6368;
}
.region-radio label > div:first-child {
    display: none; /* hide default circle */
}
.region-radio input:checked + div + span {
    background-color: #202124;
    color: #ffffff;
}

/* cards */
.side-card {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.card-label {
    font-size: 0.95rem;
    font-weight: 700;
    color: #202124;
    margin-bottom: 12px;
}

/* feed */
.feed-card {
    background: #fff;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    margin-bottom: 12px;
    padding: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.feed-title { font-size: 1rem; font-weight: 700; color: #202124; margin-bottom: 6px; }
.feed-meta { font-size: 0.75rem; color: #5f6368; margin-bottom: 8px; }
.feed-desc { font-size: 0.85rem; color: #3c4043; line-height: 1.5; }

.ftag { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; border: 1px solid #eee; margin-right: 6px; }
.crit { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }
.warn { background: #fef7e0; color: #e37400; border-color: #feebc8; }
.info { background: #e8f0fe; color: #1a73e8; border-color: #d2e3fc; }

/* small buttons under cards */
.stButton button {
    font-size: 0.7rem;
    padding: 2px 10px;
    height: auto;
    min-height: 0;
}

/* remove default Streamlit chrome */
#MainMenu, header, footer {visibility: hidden;}
</style>
""",
    unsafe_allow_html=True,
)

# ==========================================
# 4. DATA LOADING
# ==========================================


@st.cache_data(ttl=60)
def load_news():
    if not os.path.exists(NEWS_PATH):
        now = datetime.utcnow().isoformat()
        return [
            {
                "title": "Critical: Port Strike in Northern Europe",
                "snippet": "Major logistics disruption at Rotterdam and Hamburg terminals. Cargo delays expected.",
                "region": "EMEA",
                "severity": 3,
                "type": "SUPPLY CHAIN",
                "time": now,
                "source": "SRO Logistics",
                "url": "#",
            },
            {
                "title": "Security Alert: Active Shooter - Downtown Austin",
                "snippet": "Police operation near 6th St. Dell Security advises avoiding area.",
                "region": "AMER",
                "severity": 3,
                "type": "PHYSICAL SECURITY",
                "time": now,
                "source": "GSOC",
                "url": "#",
            },
        ]

    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "articles" in data:
                return data["articles"]
    except Exception as e:
        st.warning(f"news.json parse error: {e}")
    return []


@st.cache_data(ttl=60)
def load_proximity():
    if not os.path.exists(PROX_PATH):
        return []
    try:
        with open(PROX_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("alerts", [])
    except Exception as e:
        st.warning(f"proximity.json parse error: {e}")
        return []


def save_feedback(item, label: str):
    row = {
        "label": label,
        "title": item.get("title"),
        "url": item.get("url"),
        "source": item.get("source"),
        "region": item.get("region"),
        "type": item.get("type"),
        "severity": item.get("severity"),
        "time_article": item.get("time"),
        "time_marked": datetime.utcnow().isoformat(),
    }
    try:
        with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        st.toast(f"Feedback: {label}", icon="✅")
    except Exception as e:
        st.warning(f"Failed to write feedback: {e}")


news_feed = load_news()
proximity_alerts = load_proximity()

# ==========================================
# 5. SHELL WRAPPER
# ==========================================
with st.container():
    st.markdown('<div class="app-shell">', unsafe_allow_html=True)

    # ---------- HEADER ----------
    st.markdown(
        f"""
<div class="header-container">
  <div class="logo-text">OS <span>INFOHUB</span></div>
  <div class="header-right">
    <div style="font-size:0.8rem; color:#555;">
      <b>Global Security Operations</b> | Live Stream | {datetime.utcnow().strftime('%a %d %b %Y %H:%M UTC')}
    </div>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )

    # ---------- REGION NAV (radio styled as pills) ----------
    regions = ["Global", "AMER", "EMEA", "APJC", "LATAM"]
    col_radio, _ = st.columns([3, 1])
    with col_radio:
        st.markdown("<div class='region-radio'>", unsafe_allow_html=True)
        sel_region = st.radio("Region", regions, horizontal=True, label_visibility="collapsed", key="region_radio")
        st.markdown("</div>", unsafe_allow_html=True)

    # ---------- MAIN ROW: MAP + SIDEBAR ----------
    col_main, col_side = st.columns([3, 1], gap="large")

    # ==========================================
    # LEFT: MAP + FEED
    # ==========================================
    with col_main:
        # Map centre per region
        if sel_region == "Global":
            center = [20, 0]
            zoom = 2.5
            map_sites = DELL_SITES
        else:
            region_centres = {
                "AMER": [30, -90],
                "EMEA": [45, 15],
                "APJC": [15, 110],
                "LATAM": [-15, -60],
            }
            center = region_centres.get(sel_region, [20, 0])
            zoom = 3
            map_sites = [s for s in DELL_SITES if s["region"] == sel_region]

        m = folium.Map(location=center, zoom_start=zoom, tiles="CartoDB Positron")

        for s in map_sites:
            folium.Marker(
                [s["lat"], s["lon"]],
                tooltip=s["name"],
                icon=folium.Icon(color="blue", icon="building", prefix="fa"),
            ).add_to(m)

        # Proximity markers
        for a in proximity_alerts:
            if not a.get("lat") or not a.get("lon"):
                continue
            if sel_region != "Global" and a.get("site_region") != sel_region:
                continue
            folium.Marker(
                [a["lat"], a["lon"]],
                tooltip=f"{a.get('type','Alert')} – {a.get('site_name','')}",
                icon=folium.Icon(color="red", icon="exclamation-triangle", prefix="fa"),
            ).add_to(m)

        st_folium(m, use_container_width=True, height=430)

        # ---- FEED TITLE (orange bolt like original) ----
        st.markdown(
            """
<div style="margin:20px 4px 8px 4px; font-weight:700; color:#202124;">
  <i class="fas fa-bolt" style="color:#f9ab00; margin-right:8px;"></i>
  Real-time Intelligence Stream
</div>
""",
            unsafe_allow_html=True,
        )

        # region filter
        feed = [n for n in news_feed if sel_region == "Global" or n.get("region") == sel_region]

        # category filter
        cat_val = st.session_state.get("cat_selector", "All Categories")
        if cat_val != "All Categories":
            key = CATEGORY_KEY.get(cat_val, "").upper()
            if key:
                feed = [n for n in feed if key in str(n.get("type", "")).upper()]

        if not feed:
            st.info("No active incidents for current filters.")
        else:
            for idx, item in enumerate(feed[:40]):
                sev = int(item.get("severity", 1) or 1)
                if sev >= 3:
                    color = "#d93025"; badge = "crit"; label = "CRITICAL"
                elif sev == 2:
                    color = "#f9ab00"; badge = "warn"; label = "WARNING"
                else:
                    color = "#1a73e8"; badge = "info"; label = "MONITOR"

                title = item.get("title", "Untitled")
                src = item.get("source", "")
                tstr = item.get("time", "")[:16]
                snippet = item.get("snippet", "")
                ntype = item.get("type", "GENERAL")
                region = item.get("region", "GLOBAL")

                st.markdown(
                    f"""
<div class="feed-card" style="border-left:5px solid {color};">
  <div style="margin-bottom:6px;">
    <span class="ftag {badge}">{label}</span>
    <span class="ftag info" style="color:black; background:#eee; border:none;">{ntype}</span>
    <span class="ftag info" style="float:right; background:white; border:none; color:#999;">{region}</span>
  </div>
  <div class="feed-title">{title}</div>
  <div class="feed-meta">{src} • {tstr}</div>
  <div class="feed-desc">{snippet}</div>
</div>
""",
                    unsafe_allow_html=True,
                )

                c1, c2, _ = st.columns([1, 1, 6])
                with c1:
                    if st.button("Relevant", key=f"rel_{idx}"):
                        save_feedback(item, "RELEVANT")
                with c2:
                    if st.button("Not relevant", key=f"nrel_{idx}"):
                        save_feedback(item, "NOT_RELEVANT")

    # ==========================================
    # RIGHT: SIDEBAR CARDS
    # ==========================================
    with col_side:
        # History
        st.markdown('<div class="side-card"><div class="card-label">⏱️ History Search</div>', unsafe_allow_html=True)
        st.date_input("Load Archive", label_visibility="collapsed")
        st.markdown("</div>", unsafe_allow_html=True)

        # Travel Safety
        st.markdown('<div class="side-card"><div class="card-label">✈️ Travel Safety Check</div>', unsafe_allow_html=True)
        country_list = sorted(
            set(list(ADVISORIES.keys()) | {"United States", "Canada", "Germany", "Japan", "Australia"})
        )
        sel_country = st.selectbox("Country", country_list, label_visibility="collapsed")
        adv = ADVISORIES.get(sel_country, {"level": 1, "text": "Exercise Normal Precautions"})
        lvl = adv["level"]
        col = "#d93025" if lvl == 4 else "#e37400" if lvl == 3 else "#f9ab00" if lvl == 2 else "#1a73e8"
        st.markdown(
            f"""
<div class="advisory-box" style="border-left:4px solid {col}; background-color:{col}15;">
  <div style="color:{col}; font-weight:700;">LEVEL {lvl} ADVISORY</div>
  <div>{adv['text']}</div>
</div>
""",
            unsafe_allow_html=True,
        )

        # quick country hits from feed
        st.markdown("**Recent Events (72h)**")
        hits = [
            n for n in news_feed
            if sel_country.lower() in (n.get("title", "") + n.get("snippet", "")).lower()
        ]
        if hits:
            for h in hits[:3]:
                st.markdown(
                    f"<div style='font-size:0.75rem; border-bottom:1px solid #eee; padding:4px 0;'>• {h['title']}</div>",
                    unsafe_allow_html=True,
                )
        else:
            st.markdown(
                "<div style='font-size:0.75rem; color:green;'>✅ No specific incidents in the last 72h.</div>",
                unsafe_allow_html=True,
            )
        st.markdown("</div>", unsafe_allow_html=True)

        # Proximity
        st.markdown('<div class="side-card"><div class="card-label">📍 Proximity Alerts</div>', unsafe_allow_html=True)
        radius = st.selectbox(
            "Radius",
            [5, 10, 25, 50],
            index=0,
            format_func=lambda x: f"{x} KM (Default)" if x == 5 else f"{x} KM",
            label_visibility="collapsed",
        )
        vis_alerts = [a for a in proximity_alerts if a.get("distance_km", 999) <= radius]
        if not vis_alerts:
            st.markdown(
                f"<div style='text-align:center; color:#999; font-size:0.8rem; padding:10px;'>Currently no alerts in proximity to Dell sites.</div>",
                unsafe_allow_html=True,
            )
        else:
            for a in vis_alerts:
                icon = "🔥" if "Fire" in a.get("type", "") else "⚠️"
                st.markdown(
                    f"""
<div class="alert-row">
  <div class="alert-top">
    <span style="font-size:0.8rem;">{icon} {a.get('type')}</span>
    <span class="alert-val">{a.get('distance_km')} km</span>
  </div>
  <div class="alert-site" style="font-size:0.8rem; color:#555;">{a.get('site_name')}</div>
</div>
""",
                    unsafe_allow_html=True,
                )
        st.markdown("</div>", unsafe_allow_html=True)

        # Category filter
        st.markdown('<div class="side-card"><div class="card-label">🏷️ Risk Category Filter</div>', unsafe_allow_html=True)
        st.selectbox(
            "Category",
            CATEGORY_OPTIONS,
            key="cat_selector",
            label_visibility="collapsed",
        )
        st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("</div>", unsafe_allow_html=True)  # close app-shell
