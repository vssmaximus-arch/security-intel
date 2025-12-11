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
# 1a. AUTO-REFRESH (LIVE CLOCK)
# --------------------------------------------------------------------------
st_autorefresh(interval=1000, key="live_clock_refresh")

# --------------------------------------------------------------------------
# 2. CSS STYLING
# --------------------------------------------------------------------------
st.markdown(
    """
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root { --dell-blue: #0076CE; --bg-dark: #0f1115; }

/* 1. RESET STREAMLIT DEFAULTS */
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

/* 3. HEADER CONTAINER STYLING */
/* We target the container that holds the columns via a marker class */
div[data-testid="stVerticalBlock"]:has(div.header-marker) {
    border-bottom: 1px solid #f0f0f0;
    padding: 12px 32px !important;
    display: flex;
    align-items: center;
    background: white;
}

/* 4. COMPONENT STYLING */

/* Logo */
.logo-container { display: flex; align-items: center; gap: 12px; height: 100%; }
.logo-icon { font-size: 1.6rem; color: #1a73e8; }
.logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; margin: 0; }
.logo-text span { color: var(--dell-blue); }

/* --- CUSTOM PILLS (Region Selector) --- */
/* This targets the st.pills widget to look like your gray bar */
[data-testid="stPills"] {
    background-color: #f1f3f4;
    padding: 4px;
    border-radius: 10px;
    display: inline-flex;
    gap: 4px;
    border: none;
}

/* Individual Pill Buttons */
[data-testid="stPills"] button {
    border: none;
    background: transparent;
    color: #5f6368;
    font-weight: 700;
    font-size: 0.8rem;
    text-transform: uppercase;
    padding: 6px 18px;
    border-radius: 8px;
    transition: all 0.2s;
    line-height: 1.2;
}

/* Hover Effect */
[data-testid="stPills"] button:hover {
    background-color: rgba(0,0,0,0.05);
    color: #202124;
    border: none;
}

/* Active/Selected State */
[data-testid="stPills"] button[aria-selected="true"] {
    background-color: #202124 !important;
    color: #ffffff !important;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    border: none;
}

/* Clock */
.clock-container { display: flex; flex-direction: column; font-size: 0.85rem; text-align: right; justify-content: center; height: 100%; }
.clock-date { font-weight: 600; color: #202124; white-space: nowrap; }
#clock-time { font-weight: 500; color: #5f6368; white-space: nowrap; }

/* Daily Briefing Button */
div.stButton > button {
    background-color: #1a73e8;
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 8px 20px;
}
div.stButton > button:hover {
    background-color: #1557b0;
    color: white;
}

/* 5. SIDEBAR & CONTENT */
.content-area { padding: 30px; }
.map-wrapper { background: #eef2f6; border-radius: 16px; height: 520px; display: flex; align-items: center; justify-content: center; color: #888; border: 1px solid #e0e0e0; }

/* Sidebar Cards */
div[data-testid="stVerticalBlock"]:has(div.card-marker) {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.card-label { font-size: 0.95rem; font-weight: 700; color: #202124; display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }

/* Hide standard UI */
#MainMenu, footer, header {visibility: hidden;}
div[data-testid="stDateInput"] label, div[data-testid="stSelectbox"] label { display: none; }
</style>
""", unsafe_allow_html=True)

# ---------------- DATA ----------------
COUNTRIES = ["Select Country...", "United States", "India", "China", "United Kingdom", "Germany", "Japan", "Brazil", "Australia", "France", "Canada"]

# ---------------- HEADER ----------------
# We use a container with a 'header-marker' class to trigger the CSS styling above
with st.container():
    st.markdown('<div class="header-marker"></div>', unsafe_allow_html=True)
    
    # Grid: Logo(2.5) | Spacer(0.5) | Pills(4) | Clock(2) | Button(1.5)
    # vertical_alignment="center" ensures everything lines up perfectly
    col1, col2, col3, col4, col5 = st.columns([2.5, 0.5, 4.5, 2, 1.5], vertical_alignment="center")
    
    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span>INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)
        
    with col2:
        st.write("") # Spacer

    with col3:
        # FUNCTIONAL REGION TABS
        # This replaces the static HTML. The value is stored in 'selected_region'
        selected_region = st.pills(
            "Region",
            options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
            default="Global",
            label_visibility="collapsed"
        )

    with col4:
        # Live Clock (HTML/JS)
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M:%S GMT+11 UTC")
        
        st.markdown(f"""
            <div class="clock-container">
                <div class="clock-date" id="clock-date">{date_str}</div>
                <div id="clock-time">{time_str}</div>
            </div>
            <script>
                function updateClock() {{
                    var now = new Date();
                    var dateEl = document.getElementById('clock-date');
                    var timeEl = document.getElementById('clock-time');
                    if(timeEl) {{
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
        """, unsafe_allow_html=True)

    with col5:
        st.button("📄 Daily Briefings")

# ---------------- CONTENT ----------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

# Main Grid: Map/Stream (9) | Sidebar (3)
main_col, side_col = st.columns([9, 3], gap="large")

with main_col:
    # 1. MAP
    st.markdown('<div class="map-wrapper">', unsafe_allow_html=True)
    st.info(f"📍 MAP VIEW: Showing data for {selected_region.upper()}")
    st.markdown('</div>', unsafe_allow_html=True)

    # 2. STREAM HEADER
    st.markdown("""
        <div style="margin-top: 25px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div style="font-weight: 700; font-size: 1rem;">
                <i class="fas fa-circle text-primary me-2" style="font-size: 0.6rem;"></i>
                Real-time Intelligence Stream
            </div>
            <span class="badge bg-light text-secondary" style="border: 1px solid #eee;">LIVE FEED</span>
        </div>
    """, unsafe_allow_html=True)
    
    # 3. STREAM CONTENT (Placeholder)
    st.info(f"waiting for news feed... (Filter: {selected_region})")

with side_col:
    # SIDEBAR CARD 1
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-history"></i> History Search</div>', unsafe_allow_html=True)
        st.date_input("Date", label_visibility="collapsed")
        st.caption("Pick a date to load archived intelligence.")

    # SIDEBAR CARD 2
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>', unsafe_allow_html=True)
        st.selectbox("Country", COUNTRIES, label_visibility="collapsed")
    
    # SIDEBAR CARD 3
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-bullseye"></i> Proximity Alerts</div>', unsafe_allow_html=True)
        st.selectbox("Radius", ["5 KM", "10 KM", "25 KM"], label_visibility="collapsed")
        st.caption("Currently no alerts in proximity.")

st.markdown('</div>', unsafe_allow_html=True)
