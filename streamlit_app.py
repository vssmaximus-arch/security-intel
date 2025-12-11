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
st_autorefresh(interval=1000, key="live_clock_refresh_v4")

# --------------------------------------------------------------------------
# 2. CSS STYLING (FORCE RIGHT ALIGNMENT)
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

/* 3. HEADER CONTAINER */
div[data-testid="stVerticalBlock"]:has(div.header-marker) {
    border-bottom: 1px solid #f0f0f0;
    padding: 0 32px !important;
    height: 80px;
    background: white;
    display: flex;
    align-items: center;
}

/* 4. COMPONENT STYLING */

/* Logo */
.logo-container { display: flex; align-items: center; gap: 12px; height: 100%; }
.logo-icon { font-size: 1.6rem; color: #1a73e8; }
.logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; margin: 0; line-height: 1; }
.logo-text span { color: var(--dell-blue); }

/* --- PILLS (REGION SELECTOR) - FORCED RIGHT --- */
div[data-testid="stPills"] {
    background-color: #f1f3f4 !important;
    padding: 4px !important;
    border-radius: 10px !important;
    display: flex !important;
    justify-content: flex-end !important; /* Force content to right side of column */
    gap: 2px !important;
    margin-right: 0 !important;
    margin-left: auto !important; /* CSS trick to push block right */
}

/* Pill Buttons (Inactive) */
div[data-testid="stPills"] button {
    background-color: transparent !important;
    border: none !important;
    color: #5f6368 !important;
    font-weight: 700 !important;
    font-size: 0.7rem !important; /* Slightly smaller to fit tight */
    text-transform: uppercase !important;
    padding: 6px 14px !important;
    min-height: 0px !important;
    height: auto !important;
    line-height: 1 !important;
}

/* Pill Buttons (Active) - BLUE */
div[data-testid="stPills"] button[aria-selected="true"] {
    background-color: #1a73e8 !important;
    color: #ffffff !important;
    box-shadow: none !important;
}
/* Force internal text color */
div[data-testid="stPills"] button[aria-selected="true"] p {
    color: #ffffff !important;
}

/* Clock */
.clock-container { 
    display: flex; flex-direction: column; 
    font-size: 0.8rem; text-align: right; 
    justify-content: center; height: 100%; line-height: 1.3;
    white-space: nowrap;
    padding-left: 10px; /* Separation from tabs */
}
.clock-date { font-weight: 700; color: #202124; }
#clock-time { font-weight: 500; color: #5f6368; }

/* Button */
div.stButton > button {
    background-color: #1a73e8 !important;
    color: white !important;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 9px 15px;
    white-space: nowrap;
}
div.stButton > button:hover {
    background-color: #1557b0 !important;
}

/* Hide UI */
#MainMenu, footer, header {visibility: hidden;}
div[data-testid="stDateInput"] label, div[data-testid="stSelectbox"] label { display: none; }
</style>
""", unsafe_allow_html=True)

# ---------------- DATA ----------------
COUNTRIES = ["Select Country...", "United States", "India", "China", "United Kingdom", "Germany", "Japan", "Brazil", "Australia", "France", "Canada"]

# ---------------- HEADER ----------------
with st.container():
    st.markdown('<div class="header-marker"></div>', unsafe_allow_html=True)
    
    # NEW LAYOUT RATIOS: [Logo 2.5] [Spacer 6] [Tabs 3.2] [Clock 1.8] [Button 1.5]
    # The '6' Spacer is massive, pushing the '3.2' Tabs column hard to the right.
    # The '3.2' is tight, so the tabs have no room to float left.
    col1, col2, col3, col4, col5 = st.columns([2.5, 6, 3.2, 1.8, 1.5], vertical_alignment="center", gap="small")
    
    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span>INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    with col2:
        st.write("") # Elastic Spacer

    with col3:
        # TABS (Squeezed into column 3)
        selected_region = st.pills(
            "Region",
            options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
            default="Global",
            label_visibility="collapsed",
            key="region_selector"
        )

    with col4:
        # CLOCK
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
        st.button("📄 Daily Briefings", use_container_width=True)

# ---------------- CONTENT ----------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

main_col, side_col = st.columns([9, 3], gap="large")

with main_col:
    st.markdown('<div class="map-wrapper">', unsafe_allow_html=True)
    st.info(f"📍 MAP VIEW: Showing data for {selected_region.upper()}")
    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown("""
        <div style="margin-top: 25px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div style="font-weight: 700; font-size: 1rem;">
                <i class="fas fa-circle text-primary me-2" style="font-size: 0.6rem;"></i>
                Real-time Intelligence Stream
            </div>
            <span class="badge bg-light text-secondary" style="border: 1px solid #eee;">LIVE FEED</span>
        </div>
    """, unsafe_allow_html=True)
    
    st.info(f"waiting for news feed... (Filter: {selected_region})")

with side_col:
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-history"></i> History Search</div>', unsafe_allow_html=True)
        st.date_input("Date", label_visibility="collapsed")
        st.caption("Pick a date to load archived intelligence.")

    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>', unsafe_allow_html=True)
        st.selectbox("Country", COUNTRIES, label_visibility="collapsed")
    
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-bullseye"></i> Proximity Alerts</div>', unsafe_allow_html=True)
        st.selectbox("Radius", ["5 KM", "10 KM", "25 KM"], label_visibility="collapsed")
        st.caption("Currently no alerts in proximity.")

st.markdown('</div>', unsafe_allow_html=True)
