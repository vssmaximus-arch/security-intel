import datetime
import streamlit as st
from streamlit_autorefresh import st_autorefresh

# --------------------------------------------------------------------------
# 1. PAGE CONFIGURATION
# --------------------------------------------------------------------------
st.set_page_config(
    page_title="Dell OS | InfoHub",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# --------------------------------------------------------------------------
# 1a. AUTO-REFRESH & STATE MANAGEMENT
# --------------------------------------------------------------------------
st_autorefresh(interval=1000, key="live_clock_refresh_v6")

# READ THE URL PARAMETER (This handles the tab clicks)
# Default to "Global" if no param is set
query_params = st.query_params
selected_region = query_params.get("region", "Global")

# --------------------------------------------------------------------------
# 2. CSS STYLING (THEME & LAYOUT RESET)
# --------------------------------------------------------------------------
st.markdown(
    """
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root { --dell-blue: #0076CE; --bg-dark: #0f1115; }

/* 1. RESET */
.stApp {
    background-color: var(--bg-dark);
    font-family: 'Inter', sans-serif;
}
[data-testid="stAppViewContainer"] { padding: 0; }

/* 2. MAIN WHITE CARD */
div.block-container {
    background-color: #fff;
    border-radius: 24px;
    min-height: calc(100vh - 48px);
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    margin: 24px;
    padding: 0 !important;
    width: calc(100% - 48px) !important;
    max-width: calc(100% - 48px) !important;
}

/* 3. HIDE STREAMLIT CHROME */
#MainMenu, footer, header {visibility: hidden;}
div[data-testid="stDateInput"] label, div[data-testid="stSelectbox"] label { display: none; }

/* 4. CONTENT AREA PADDING */
.content-area { padding: 30px; }

/* 5. SIDEBAR CARDS */
div[data-testid="stVerticalBlock"]:has(div.card-marker) {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.card-label { font-size: 0.95rem; font-weight: 700; color: #202124; display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
</style>
""", unsafe_allow_html=True)

# ---------------- DATA ----------------
COUNTRIES = ["Select Country...", "United States", "India", "China", "United Kingdom", "Germany", "Japan", "Brazil", "Australia", "France", "Canada"]

# ---------------- HEADER (PURE HTML INJECTION) ----------------
# We calculate time in Python for the initial render, JS takes over
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
date_str = now.strftime("%A, %d %b %Y")
time_str = now.strftime("%H:%M:%S GMT+11 UTC")

# Helper to generate the Nav HTML with the correct 'active' class based on Python state
def nav_link(name):
    is_active = "active" if selected_region == name else ""
    # target="_self" is CRITICAL to make it reload the page with new param
    return f'<a href="?region={name}" target="_self" class="nav-item-custom {is_active}">{name}</a>'

html_header = f"""
<style>
    /* YOUR EXACT HEADER CSS */
    .header-container {{ padding: 15px 32px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0f0f0; height: 70px; background: white; }}
    .header-left {{ display: flex; align-items: center; gap:12px; }}
    .logo-icon {{ font-size: 1.6rem; color: #1a73e8; }}
    .logo-text {{ font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; margin: 0; }}
    .logo-text span {{ color: #0076CE; }}
    .header-right {{ display: flex; align-items: center; gap: 20px; }}
    
    .nav-pills-custom {{ background-color: #f1f3f4; padding: 4px; border-radius: 10px; display: flex; gap: 2px; }}
    .nav-item-custom {{ padding: 7px 18px; border-radius: 8px; font-weight: 700; font-size: 0.8rem; color: #5f6368; cursor: pointer; text-decoration: none; text-transform: uppercase; transition: all 0.2s; }}
    .nav-item-custom:hover {{ color: #202124; text-decoration: none; }}
    .nav-item-custom.active {{ background-color: #202124; color: #fff; }}
    
    .clock-container {{ text-align: right; line-height: 1.2; font-size: 0.85rem; }}
    .clock-date {{ font-weight: 700; color: #202124; }}
    .clock-time {{ font-weight: 500; color: #5f6368; }}
    
    .btn-daily {{ background-color: #1a73e8; color: white; padding: 9px 18px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; cursor: pointer; display: flex; gap:8px; align-items: center; text-decoration: none; }}
    .btn-daily:hover {{ background-color: #1557b0; color: white; }}
</style>

<div class="header-container">
    <div class="header-left">
        <div class="logo-icon"><i class="fas fa-shield-alt"></i></div>
        <div class="logo-text">OS <span>INFOHUB</span></div>
    </div>
    <div class="header-right">
        <div class="nav-pills-custom">
            {nav_link("Global")}
            {nav_link("AMER")}
            {nav_link("EMEA")}
            {nav_link("APJC")}
            {nav_link("LATAM")}
        </div>
        <div class="clock-container">
            <div class="clock-date" id="clock-date">{date_str}</div>
            <div class="clock-time" id="clock-time">{time_str}</div>
        </div>
        <a href="#" class="btn-daily">
            <i class="fas fa-file-alt"></i> Daily Briefings
        </a>
    </div>
</div>

<script>
    function updateClock() {{
        var now = new Date();
        var dateEl = document.getElementById('clock-date');
        var timeEl = document.getElementById('clock-time');
        if(timeEl && dateEl) {{
            var h = String(now.getHours()).padStart(2, '0');
            var m = String(now.getMinutes()).padStart(2, '0');
            var s = String(now.getSeconds()).padStart(2, '0');
            var offset = -now.getTimezoneOffset();
            var sign = offset >= 0 ? '+' : '-';
            var hrs = String(Math.floor(Math.abs(offset)/60));
            timeEl.innerText = h + ':' + m + ':' + s + ' GMT' + sign + hrs + ' UTC';
        }}
    }}
    setInterval(updateClock, 1000);
</script>
"""

st.markdown(html_header, unsafe_allow_html=True)

# ---------------- CONTENT ----------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

main_col, side_col = st.columns([9, 3], gap="large")

with main_col:
    # MAP
    st.markdown('<div class="map-wrapper">', unsafe_allow_html=True)
    st.info(f"📍 MAP VIEW: Showing data for {selected_region.upper()}")
    st.markdown('</div>', unsafe_allow_html=True)

    # STREAM HEADER
    st.markdown("""
        <div style="margin-top: 25px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div style="font-weight: 700; font-size: 1rem;">
                <i class="fas fa-circle text-primary me-2" style="font-size: 0.6rem;"></i>
                Real-time Intelligence Stream
            </div>
            <span class="badge bg-light text-secondary" style="border: 1px solid #eee;">LIVE FEED</span>
        </div>
    """, unsafe_allow_html=True)
    
    # STREAM CONTENT
    st.info(f"waiting for news feed... (Filter: {selected_region})")

with side_col:
    # CARD 1: HISTORY
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-history"></i> History Search</div>', unsafe_allow_html=True)
        st.date_input("Date", label_visibility="collapsed")
        st.caption("Pick a date to load archived intelligence.")

    # CARD 2: TRAVEL
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>', unsafe_allow_html=True)
        st.selectbox("Country", COUNTRIES, label_visibility="collapsed")
    
    # CARD 3: PROXIMITY
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-bullseye"></i> Proximity Alerts</div>', unsafe_allow_html=True)
        st.selectbox("Radius", ["5 KM", "10 KM", "25 KM"], label_visibility="collapsed")
        st.caption("Currently no alerts in proximity.")

st.markdown('</div>', unsafe_allow_html=True)
