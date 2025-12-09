# streamlit_app.py
# OS INFOHUB / SRO INTELLIGENCE – Streamlit dashboard

import os
import json
from datetime import datetime
from pathlib import Path

import streamlit as st
import folium
from streamlit_folium import st_folium

# ============================================================
# 1. CONFIG
# ============================================================

st.set_page_config(
    page_title="OS INFOHUB",
    layout="wide",
    page_icon="🛡️"
)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

NEWS_PATH = DATA_DIR / "news.json"
PROX_PATH = DATA_DIR / "proximity.json"
FORECAST_PATH = DATA_DIR / "forecast.json"
FEEDBACK_PATH = DATA_DIR / "feedback.jsonl"

# If you later want to call Gemini/OpenAI, plug it into this function.
def score_with_ai_if_available(item: dict) -> float:
    """
    Placeholder for AI relevance scoring.
    - If you wire in Gemini/OpenAI, use the title, snippet, tags, etc.
    - For now, returns existing `relevance` from the JSON if present,
      or a simple default score.
    """
    if "relevance" in item:
        try:
            return float(item["relevance"])
        except Exception:
            pass
    # trivial fallback: higher severity = higher score
    sev = int(item.get("severity", 1))
    return 0.1 * sev


# ============================================================
# 2. STATIC DATA – DELL SITES & ADVISORIES
# ============================================================

DELL_SITES = [
    # AMER – US
    {"name": "Dell Round Rock HQ", "country": "US", "region": "AMER", "lat": 30.5083, "lon": -97.6788},
    {"name": "Dell Austin Parmer", "country": "US", "region": "AMER", "lat": 30.2672, "lon": -97.7431},
    {"name": "Dell Austin Downtown", "country": "US", "region": "AMER", "lat": 30.2713, "lon": -97.7426},
    {"name": "Dell Hopkinton", "country": "US", "region": "AMER", "lat": 42.2287, "lon": -71.5226},
    {"name": "Dell Franklin", "country": "US", "region": "AMER", "lat": 42.0834, "lon": -71.3967},
    {"name": "Dell Nashville Hub", "country": "US", "region": "AMER", "lat": 36.1627, "lon": -86.7816},
    {"name": "Dell Oklahoma City", "country": "US", "region": "AMER", "lat": 35.4676, "lon": -97.5164},
    {"name": "Dell Santa Clara", "country": "US", "region": "AMER", "lat": 37.3541, "lon": -121.9552},
    {"name": "Dell Palo Alto", "country": "US", "region": "AMER", "lat": 37.4419, "lon": -122.1430},
    {"name": "Dell San Jose", "country": "US", "region": "AMER", "lat": 37.3382, "lon": -121.8863},
    {"name": "Dell Seattle", "country": "US", "region": "AMER", "lat": 47.6062, "lon": -122.3321},
    {"name": "Dell Portland", "country": "US", "region": "AMER", "lat": 45.5152, "lon": -122.6784},
    {"name": "Dell Denver", "country": "US", "region": "AMER", "lat": 39.7392, "lon": -104.9903},
    {"name": "Dell Chicago", "country": "US", "region": "AMER", "lat": 41.8781, "lon": -87.6298},
    {"name": "Dell New York", "country": "US", "region": "AMER", "lat": 40.7128, "lon": -74.0060},
    {"name": "Dell Boston", "country": "US", "region": "AMER", "lat": 42.3601, "lon": -71.0589},
    {"name": "Dell Atlanta", "country": "US", "region": "AMER", "lat": 33.7490, "lon": -84.3880},
    {"name": "Dell Miami", "country": "US", "region": "AMER", "lat": 25.7617, "lon": -80.1918},
    {"name": "Dell Dallas", "country": "US", "region": "AMER", "lat": 32.7767, "lon": -96.7970},
    {"name": "Dell Houston", "country": "US", "region": "AMER", "lat": 29.7604, "lon": -95.3698},
    {"name": "Dell Washington DC", "country": "US", "region": "AMER", "lat": 38.9072, "lon": -77.0369},
    {"name": "Dell RTP / Durham", "country": "US", "region": "AMER", "lat": 35.9940, "lon": -78.8986},
    {"name": "Dell Raleigh", "country": "US", "region": "AMER", "lat": 35.7796, "lon": -78.6382},
    {"name": "Dell Phoenix", "country": "US", "region": "AMER", "lat": 33.4484, "lon": -112.0740},
    {"name": "Dell Salt Lake City", "country": "US", "region": "AMER", "lat": 40.7608, "lon": -111.8910},
    {"name": "Dell Minneapolis", "country": "US", "region": "AMER", "lat": 44.9778, "lon": -93.2650},
    {"name": "Dell Detroit", "country": "US", "region": "AMER", "lat": 42.3314, "lon": -83.0458},
    {"name": "Dell St. Louis", "country": "US", "region": "AMER", "lat": 38.6270, "lon": -90.1994},
    {"name": "Dell Orlando", "country": "US", "region": "AMER", "lat": 28.5383, "lon": -81.3792},
    {"name": "Dell Tampa", "country": "US", "region": "AMER", "lat": 27.9506, "lon": -82.4572},

    # AMER – CA / MX
    {"name": "Dell Toronto", "country": "CA", "region": "AMER", "lat": 43.6532, "lon": -79.3832},
    {"name": "Dell Montreal", "country": "CA", "region": "AMER", "lat": 45.5017, "lon": -73.5673},
    {"name": "Dell Vancouver", "country": "CA", "region": "AMER", "lat": 49.2827, "lon": -123.1207},
    {"name": "Dell Ottawa", "country": "CA", "region": "AMER", "lat": 45.4215, "lon": -75.6972},
    {"name": "Dell Mexico City", "country": "MX", "region": "AMER", "lat": 19.4326, "lon": -99.1332},
    {"name": "Dell Monterrey", "country": "MX", "region": "AMER", "lat": 25.6866, "lon": -100.3161},
    {"name": "Dell Guadalajara", "country": "MX", "region": "AMER", "lat": 20.6597, "lon": -103.3496},

    # LATAM
    {"name": "Dell Hortolândia Mfg", "country": "BR", "region": "LATAM", "lat": -22.8583, "lon": -47.2208},
    {"name": "Dell São Paulo", "country": "BR", "region": "LATAM", "lat": -23.5505, "lon": -46.6333},
    {"name": "Dell Porto Alegre", "country": "BR", "region": "LATAM", "lat": -30.0346, "lon": -51.2177},
    {"name": "Dell Rio de Janeiro", "country": "BR", "region": "LATAM", "lat": -22.9068, "lon": -43.1729},
    {"name": "Dell Buenos Aires", "country": "AR", "region": "LATAM", "lat": -34.6037, "lon": -58.3816},
    {"name": "Dell Santiago", "country": "CL", "region": "LATAM", "lat": -33.4489, "lon": -70.6693},
    {"name": "Dell Bogotá", "country": "CO", "region": "LATAM", "lat": 4.7110, "lon": -74.0721},
    {"name": "Dell Lima", "country": "PE", "region": "LATAM", "lat": -12.0464, "lon": -77.0428},
    {"name": "Dell Panama City", "country": "PA", "region": "LATAM", "lat": 8.9824, "lon": -79.5199},
    {"name": "Dell San José", "country": "CR", "region": "LATAM", "lat": 9.9281, "lon": -84.0907},
    {"name": "Dell Montevideo", "country": "UY", "region": "LATAM", "lat": -34.9011, "lon": -56.1645},
    {"name": "Dell Quito", "country": "EC", "region": "LATAM", "lat": -0.1807, "lon": -78.4678},
    {"name": "Dell Caracas", "country": "VE", "region": "LATAM", "lat": 10.4806, "lon": -66.9036},

    # EMEA – Europe/Middle East/Africa (sample – you already gave full list)
    {"name": "Dell Dublin Cherrywood", "country": "IE", "region": "EMEA", "lat": 53.2374, "lon": -6.1450},
    {"name": "Dell Cork Campus", "country": "IE", "region": "EMEA", "lat": 51.8985, "lon": -8.4756},
    {"name": "Dell Limerick", "country": "IE", "region": "EMEA", "lat": 52.6638, "lon": -8.6267},
    {"name": "Dell Bracknell", "country": "GB", "region": "EMEA", "lat": 51.4160, "lon": -0.7540},
    {"name": "Dell London", "country": "GB", "region": "EMEA", "lat": 51.5074, "lon": -0.1278},
    {"name": "Dell Glasgow", "country": "GB", "region": "EMEA", "lat": 55.8642, "lon": -4.2518},
    {"name": "Dell Paris / Bezons", "country": "FR", "region": "EMEA", "lat": 48.8566, "lon": 2.3522},
    {"name": "Dell Frankfurt", "country": "DE", "region": "EMEA", "lat": 50.1109, "lon": 8.6821},
    {"name": "Dell Munich", "country": "DE", "region": "EMEA", "lat": 48.1351, "lon": 11.5820},
    {"name": "Dell Berlin", "country": "DE", "region": "EMEA", "lat": 52.5200, "lon": 13.4050},
    {"name": "Dell Rotterdam", "country": "NL", "region": "EMEA", "lat": 51.9244, "lon": 4.4777},
    {"name": "Dell Madrid", "country": "ES", "region": "EMEA", "lat": 40.4168, "lon": -3.7038},
    {"name": "Dell Milan", "country": "IT", "region": "EMEA", "lat": 45.4642, "lon": 9.1900},
    {"name": "Dell Rome", "country": "IT", "region": "EMEA", "lat": 41.9028, "lon": 12.4964},
    {"name": "Dell Johannesburg", "country": "ZA", "region": "EMEA", "lat": -26.2041, "lon": 28.0473},
    {"name": "Dell Cape Town", "country": "ZA", "region": "EMEA", "lat": -33.9249, "lon": 18.4241},
    {"name": "Dell Lagos", "country": "NG", "region": "EMEA", "lat": 6.5244, "lon": 3.3792},
    {"name": "Dell Nairobi", "country": "KE", "region": "EMEA", "lat": -1.2921, "lon": 36.8219},
    {"name": "Dell Dubai", "country": "AE", "region": "EMEA", "lat": 25.2048, "lon": 55.2708},
    {"name": "Dell Abu Dhabi", "country": "AE", "region": "EMEA", "lat": 24.4539, "lon": 54.3773},
    {"name": "Dell Riyadh", "country": "SA", "region": "EMEA", "lat": 24.7136, "lon": 46.6753},
    {"name": "Dell Jeddah", "country": "SA", "region": "EMEA", "lat": 21.4858, "lon": 39.1925},

    # APJC – India/SE Asia/East Asia/Australia/NZ (again sample – you gave full list)
    {"name": "Dell Bangalore", "country": "IN", "region": "APJC", "lat": 12.9716, "lon": 77.5946},
    {"name": "Dell Bangalore Global Dev Center", "country": "IN", "region": "APJC", "lat": 12.9081, "lon": 77.6476},
    {"name": "Dell Hyderabad", "country": "IN", "region": "APJC", "lat": 17.3850, "lon": 78.4867},
    {"name": "Dell Singapore", "country": "SG", "region": "APJC", "lat": 1.3521, "lon": 103.8198},
    {"name": "Dell Penang", "country": "MY", "region": "APJC", "lat": 5.4164, "lon": 100.3327},
    {"name": "Dell Manila", "country": "PH", "region": "APJC", "lat": 14.5995, "lon": 120.9842},
    {"name": "Dell Tokyo", "country": "JP", "region": "APJC", "lat": 35.6762, "lon": 139.6503},
    {"name": "Dell Osaka", "country": "JP", "region": "APJC", "lat": 34.6937, "lon": 135.5023},
    {"name": "Dell Beijing", "country": "CN", "region": "APJC", "lat": 39.9042, "lon": 116.4074},
    {"name": "Dell Shanghai", "country": "CN", "region": "APJC", "lat": 31.2304, "lon": 121.4737},
    {"name": "Dell Xiamen Mfg", "country": "CN", "region": "APJC", "lat": 24.4798, "lon": 118.0894},
    {"name": "Dell Sydney", "country": "AU", "region": "APJC", "lat": -33.8688, "lon": 151.2093},
    {"name": "Dell Melbourne", "country": "AU", "region": "APJC", "lat": -37.8136, "lon": 144.9631},
    {"name": "Dell Brisbane", "country": "AU", "region": "APJC", "lat": -27.4698, "lon": 153.0251},
    {"name": "Dell Auckland", "country": "NZ", "region": "APJC", "lat": -36.8485, "lon": 174.7633},
    {"name": "Dell Wellington", "country": "NZ", "region": "APJC", "lat": -41.2865, "lon": 174.7762},
]

REGIONS = ["Global", "AMER", "EMEA", "APJC", "LATAM"]

TRAVEL_ADVISORIES = {
    # Explicit risk countries
    "Afghanistan": {"level": 4, "text": "Do Not Travel"},
    "Israel": {"level": 3, "text": "Reconsider Travel"},
    "Russia": {"level": 4, "text": "Do Not Travel"},
    "Ukraine": {"level": 4, "text": "Do Not Travel"},
    "Mexico": {"level": 2, "text": "Exercise Increased Caution"},
    "India": {"level": 2, "text": "Exercise Increased Caution"},
    "China": {"level": 3, "text": "Reconsider Travel"},
    "United States": {"level": 1, "text": "Exercise Normal Precautions"},
    "Brazil": {"level": 2, "text": "Exercise Increased Caution"},
    "South Africa": {"level": 2, "text": "Exercise Increased Caution"},
    # Default for everything else
}

DEFAULT_ADVISORY = {"level": 1, "text": "Exercise Normal Precautions"}

# ============================================================
# 3. HELPERS
# ============================================================

@st.cache_data(ttl=60)
def load_json(path: Path, default):
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default

def load_news_and_proximity():
    news = load_json(NEWS_PATH, [])
    prox_raw = load_json(PROX_PATH, {})
    proximity = prox_raw.get("alerts", []) if isinstance(prox_raw, dict) else prox_raw
    return news, proximity

def save_feedback(item: dict, label: str):
    FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "title": item.get("title"),
        "source": item.get("source"),
        "url": item.get("link") or item.get("url"),
        "region": item.get("region"),
        "type": item.get("type"),
        "severity": item.get("severity"),
        "label": label,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    with FEEDBACK_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload) + "\n")

def advisory_for_country(country: str):
    return TRAVEL_ADVISORIES.get(country, DEFAULT_ADVISORY)

def country_list_from_news(news):
    names = set()
    for n in news:
        for key in ("country", "countries"):
            val = n.get(key)
            if isinstance(val, str):
                names.add(val)
            elif isinstance(val, list):
                for c in val:
                    if isinstance(c, str):
                        names.add(c)
    # Add a few major markets so the dropdown is never tiny
    names.update(["Australia", "Canada", "France", "Germany", "Japan", "United Kingdom"])
    return sorted(names)

# ============================================================
# 4. LAYOUT – HEADER
# ============================================================

# Light vs dark toggle (Streamlit built-in theme still applies, this just flips CSS)
if "theme" not in st.session_state:
    st.session_state["theme"] = "light"

theme_choice = st.sidebar.radio("Theme", ["Light", "Dark"], index=0 if st.session_state["theme"] == "light" else 1)
st.session_state["theme"] = theme_choice.lower()

# Inject CSS (close to your original clean white dashboard)
LIGHT_CSS = """
<style>
body, .stApp {
    background-color: #f5f7fb;
    font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.os-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:14px 24px 8px 24px;
}
.os-logo {
    display:flex;
    align-items:center;
    gap:8px;
    font-weight:800;
    letter-spacing:-0.03em;
    color:#202124;
}
.os-logo-badge {
    width:24px;height:24px;
    border-radius:999px;
    background:#0057ff;
    display:flex;
    align-items:center;
    justify-content:center;
    color:#fff;
    font-size:14px;
    font-weight:900;
}
.os-logo span {
    color:#0057ff;
}
.os-top-meta {
    font-size:12px;
    color:#5f6368;
    text-align:right;
}
.os-pill-btn {
    background:#0057ff;
    color:#fff;
    padding:6px 14px;
    border-radius:999px;
    font-size:12px;
    border:none;
}
.os-region-row {
    padding:0 24px 4px 24px;
    border-bottom:1px solid #e0e0e0;
}
.os-stream-title {
    font-size:16px;
    font-weight:700;
    margin-top:8px;
    margin-bottom:8px;
}
.feed-card {
    background:#fff;
    border-radius:10px;
    border:1px solid #e0e0e0;
    padding:14px 18px;
    margin-bottom:10px;
}
.feed-tags {
    font-size:10px;
    margin-bottom:4px;
}
.badge {
    display:inline-block;
    padding:2px 6px;
    border-radius:4px;
    font-size:9px;
    font-weight:700;
    margin-right:4px;
    text-transform:uppercase;
}
.badge-critical {background:#fce8e6;color:#c5221f;}
.badge-warning {background:#fef7e0;color:#b06000;}
.badge-info {background:#e8f0fe;color:#1a73e8;}
.badge-type {background:#eaecee;color:#555;}
.feed-title {
    font-size:14px;
    font-weight:700;
    margin-bottom:2px;
}
.feed-meta {
    font-size:11px;
    color:#5f6368;
    margin-bottom:4px;
}
.feed-snippet {
    font-size:12px;
    color:#3c4043;
}
.side-card {
    background:#fff;
    border-radius:10px;
    border:1px solid #e0e0e0;
    padding:12px 14px;
    margin-bottom:10px;
}
.side-title {
    font-size:13px;
    font-weight:700;
    margin-bottom:6px;
}
.advisory-box {
    padding:8px;
    border-radius:6px;
    font-size:11px;
}
.advisory-level {
    font-weight:700;
    margin-bottom:2px;
}
.prox-row {
    border-bottom:1px solid #f1f3f4;
    padding:6px 0;
    font-size:11px;
}
.prox-type {
    font-weight:600;
}
.prox-dist {
    font-weight:700;
    color:#c5221f;
}
.os-footer-note {
    font-size:11px;
    color:#70757a;
}
</style>
"""

DARK_CSS = """
<style>
body, .stApp { background-color:#111827; }
.feed-card,.side-card{background:#111827;border-color:#374151;}
.feed-title,.feed-snippet,.side-title,.os-logo{color:#f9fafb;}
.feed-meta,.os-top-meta,.os-footer-note{color:#9ca3af;}
</style>
"""

st.markdown(LIGHT_CSS, unsafe_allow_html=True)
if st.session_state["theme"] == "dark":
    st.markdown(DARK_CSS, unsafe_allow_html=True)

# ---------- header ----------
now = datetime.utcnow()
col_h1, col_h2, col_h3 = st.columns([2, 2, 1.3])

with col_h1:
    st.markdown(
        """
        <div class="os-header">
          <div class="os-logo">
            <div class="os-logo-badge">S</div>
            <div>OS <span>INFOHUB</span></div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with col_h2:
    st.markdown(
        f"""
        <div class="os-header" style="justify-content:flex-start;">
          <div class="os-top-meta">
            Global Security Operations | Live Stream
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with col_h3:
    st.markdown(
        f"""
        <div class="os-header" style="justify-content:flex-end;">
          <div class="os-top-meta">
            {now:%A, %d %b %Y}<br/>{now:%H:%M} GMT
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

st.markdown(
    """
    <div class="os-region-row">
    """,
    unsafe_allow_html=True,
)

sel_region = st.radio(
    "Region",
    REGIONS,
    horizontal=True,
    label_visibility="collapsed",
)

st.markdown("</div>", unsafe_allow_html=True)

# ============================================================
# 5. MAIN CONTENT – MAP + STREAM + SIDE WIDGETS
# ============================================================

news_items, proximity_alerts = load_news_and_proximity()

# Map + stream + side widgets layout
col_main, col_side = st.columns([3.2, 1.1])

# ---------- MAP + STREAM ----------
with col_main:
    # MAP
    map_sites = DELL_SITES if sel_region == "Global" else [s for s in DELL_SITES if s["region"] == sel_region]

    m = folium.Map(location=[20, 0], zoom_start=2, tiles="CartoDB positron", control_scale=True)

    # Dell sites
    for site in map_sites:
        folium.Marker(
            location=[site["lat"], site["lon"]],
            tooltip=site["name"],
            icon=folium.Icon(color="blue", icon="building", prefix="fa"),
        ).add_to(m)

    # Proximity alerts for selected region (if JSON contains `site_region`)
    active_prox = []
    for a in proximity_alerts:
        if sel_region != "Global" and a.get("site_region") != sel_region:
            continue
        active_prox.append(a)
        if "lat" in a and "lon" in a:
            folium.Marker(
                location=[a["lat"], a["lon"]],
                tooltip=f"{a.get('type','Alert')} – {a.get('site_name','')}",
                icon=folium.Icon(color="red", icon="exclamation", prefix="fa"),
            ).add_to(m)

    st_folium(m, width="100%", height=360)

    # STREAM HEADER
    st.markdown(
        '<div class="os-stream-title">⚡ Real-time Intelligence Stream</div>',
        unsafe_allow_html=True,
    )

    # Category filter
    cat = st.selectbox(
        "Category filter",
        ["All categories", "Physical Security", "Cyber Security", "Supply Chain", "Crisis / Natural Hazards"],
        label_visibility="collapsed",
    )

    # ---- filter news by region & category ----
    filtered = []
    for item in news_items:
        if sel_region != "Global" and item.get("region") != sel_region:
            continue
        if cat != "All categories":
            cat_key = cat.split()[0].upper()
            if cat_key not in str(item.get("type", "")).upper():
                continue
        filtered.append(item)

    # Sort by AI score (or fallback)
    for n in filtered:
        n["_score"] = score_with_ai_if_available(n)
    filtered.sort(key=lambda x: x.get("_score", 0), reverse=True)

    if not filtered:
        st.info("No items for current filters.")
    else:
        for idx, item in enumerate(filtered[:40]):
            sev = int(item.get("severity", 1))
            if sev >= 3:
                sev_label = "critical"
                badge_class = "badge-critical"
            elif sev == 2:
                sev_label = "warning"
                badge_class = "badge-warning"
            else:
                sev_label = "monitor"
                badge_class = "badge-info"

            tag_type = item.get("type", "GENERAL")
            region_tag = item.get("region", "GLOBAL")
            source = item.get("source", "")
            link = item.get("link") or item.get("url") or ""
            time_str = item.get("time", "")[:16]

            # Card HTML
            st.markdown(
                f"""
                <div class="feed-card">
                  <div class="feed-tags">
                    <span class="badge {badge_class}">{sev_label.upper()}</span>
                    <span class="badge badge-type">{tag_type}</span>
                    <span style="float:right;font-size:10px;color:#9aa0a6;">{region_tag}</span>
                  </div>
                  <div class="feed-title">
                    <a href="{link}" target="_blank" style="text-decoration:none;color:inherit;">
                      {item.get('title','')}
                    </a>
                  </div>
                  <div class="feed-meta">
                    {source} • {time_str}
                  </div>
                  <div class="feed-snippet">
                    {item.get('snippet','')}
                  </div>
                  <div class="feed-meta" style="margin-top:4px;">
                    Relevance score: {item.get('_score',0):.2f}
                  </div>
                </div>
                """,
                unsafe_allow_html=True,
            )

            c1, c2, _ = st.columns([0.8, 0.8, 4])
            with c1:
                if st.button("Relevant", key=f"rel_{idx}"):
                    save_feedback(item, "RELEVANT")
                    st.toast("Feedback logged as RELEVANT")
            with c2:
                if st.button("Not relevant", key=f"nrel_{idx}"):
                    save_feedback(item, "NOT_RELEVANT")
                    st.toast("Feedback logged as NOT_RELEVANT")

# ---------- SIDE WIDGETS ----------
with col_side:
    # HISTORY
    with st.container():
        st.markdown('<div class="side-card"><div class="side-title">🕒 History Search</div>', unsafe_allow_html=True)
        st.date_input("Select date", label_visibility="collapsed", key="history_date")
        st.markdown(
            '<div class="os-footer-note">Archive is loaded by your backend pipeline (generate_reports.py / news_agent.py).</div>',
            unsafe_allow_html=True,
        )
        st.markdown("</div>", unsafe_allow_html=True)

    # TRAVEL SAFETY
    with st.container():
        st.markdown('<div class="side-card"><div class="side-title">✈️ Travel Safety Check</div>', unsafe_allow_html=True)

        country_options = country_list_from_news(news_items)
        country = st.selectbox("Country", country_options, label_visibility="collapsed")

        adv = advisory_for_country(country)
        lvl = adv["level"]
        col = "#1a73e8"
        if lvl == 2:
            col = "#f9ab00"
        elif lvl == 3:
            col = "#e37400"
        elif lvl == 4:
            col = "#c5221f"

        st.markdown(
            f"""
            <div class="advisory-box" style="background:{col}15;border-left:4px solid {col};">
              <div class="advisory-level" style="color:{col};">LEVEL {lvl} ADVISORY</div>
              <div class="advisory-text">{adv['text']}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # Recent country hits
        st.markdown('<div class="side-title" style="margin-top:6px;">Recent incidents (72h)</div>', unsafe_allow_html=True)
        hits = [n for n in news_items if country.lower() in (n.get("title", "") + n.get("snippet", "")).lower()]
        if not hits:
            st.markdown("<div class='os-footer-note'>No recent incidents found in feed.</div>", unsafe_allow_html=True)
        else:
            for h in hits[:3]:
                href = h.get("link") or h.get("url") or "#"
                st.markdown(
                    f"<div style='font-size:11px;margin-bottom:4px;'>• <a href='{href}' target='_blank'>{h.get('title','')}</a></div>",
                    unsafe_allow_html=True,
                )

        st.markdown("</div>", unsafe_allow_html=True)

    # PROXIMITY
    with st.container():
        st.markdown('<div class="side-card"><div class="side-title">📍 Proximity Alerts</div>', unsafe_allow_html=True)

        radius = st.selectbox(
            "Radius",
            [5, 10, 25, 50, 100],
            index=2,
            format_func=lambda x: f"{x} KM (default)" if x == 5 else f"{x} KM",
            label_visibility="collapsed",
        )

        visible = [a for a in active_prox if float(a.get("distance_km", 9999)) <= radius]

        if not visible:
            st.markdown("<div class='os-footer-note'>No alerts within selected radius.</div>", unsafe_allow_html=True)
        else:
            for a in visible[:6]:
                dist = a.get("distance_km", "?")
                site_name = a.get("site_name", "Dell site")
                typ = a.get("type", "Alert")
                st.markdown(
                    f"""
                    <div class="prox-row">
                      <div class="prox-type">{typ}</div>
                      <div>{site_name}</div>
                      <div class="prox-dist">{dist} km</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

        st.markdown("</div>", unsafe_allow_html=True)

    # RISK FILTER FOOTNOTE (applies to stream + proximity)
    with st.container():
        st.markdown(
            '<div class="side-card"><div class="side-title">🏷️ Risk Category Filter</div>',
            unsafe_allow_html=True,
        )
        st.markdown(
            "<div class='os-footer-note'>Use the category dropdown above the stream to filter both the feed and proximity overlays.</div>",
            unsafe_allow_html=True,
        )
        st.markdown("</div>", unsafe_allow_html=True)

# ============================================================
# 6. BRIEFINGS TAB (SIMPLE IMPLEMENTATION)
# ============================================================

st.markdown("---")
st.subheader("📘 Briefings & Reports")

briefs = load_json(FORECAST_PATH, [])
if not briefs:
    st.markdown(
        "<div class='os-footer-note'>No briefings file found yet. "
        "Point your backend to write daily reports into public/data/forecast.json "
        "or a dedicated reports.json and they will appear here.</div>",
        unsafe_allow_html=True,
    )
else:
    for b in briefs:
        st.markdown(
            f"""
            <div class="feed-card">
              <div class="feed-title">{b.get('title','Daily Briefing')}</div>
              <div class="feed-meta">{b.get('date','')}</div>
              <div class="feed-snippet">{b.get('summary','')}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
