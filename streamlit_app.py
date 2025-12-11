import streamlit as st
import datetime

# --------------------------------------------------------------------------
# 1. PAGE CONFIG
# --------------------------------------------------------------------------
st.set_page_config(
    page_title="Dell OS | InfoHub",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# --------------------------------------------------------------------------
# 2. GLOBAL CSS (DIRECTLY MIRRORING ORIGINAL INDEX.HTML)
# --------------------------------------------------------------------------
st.markdown("""
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
    --dell-blue: #0076CE;
    --bg-dark: #0f1115;
}

/* Streamlit shell */
.stApp {
    background-color: var(--bg-dark);
    font-family: 'Inter', sans-serif;
}

/* Remove Streamlit’s white card look; we’ll use .app-container instead */
div.block-container {
    background: transparent !important;
    box-shadow: none !important;
    padding: 24px !important;
    max-width: 100% !important;
}

/* Main white card (from original) */
.app-container {
    background-color: #fff;
    border-radius: 24px;
    min-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

/* HEADER (EXACT CLASSES FROM ORIGINAL SITE) */
.header-container {
    padding: 15px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #f0f0f0;
    height: 70px;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.logo-icon {
    font-size: 1.6rem;
    color: #1a73e8;
}

.logo-text {
    font-size: 1.2rem;
    font-weight: 800;
    color: #202124;
    letter-spacing: -0.5px;
}

.logo-text span {
    color: var(--dell-blue);
}

.header-right {
    display: flex;
    align-items: center;
    gap: 20px;
}

/* NAV PILLS */
.nav-pills-custom {
    background-color: #f1f3f4;
    padding: 4px;
    border-radius: 10px;
    display: flex;
    gap: 2px;
}

.nav-item-custom {
    padding: 7px 18px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 0.8rem;
    color: #5f6368;
    cursor: pointer;
    text-decoration: none;
    text-transform: uppercase;
}

.nav-item-custom.active {
    background-color: #202124;
    color: #fff;
}

/* Clock */
.clock-container {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    text-align: right;
}

.clock-date {
    font-weight: 600;
    color: #202124;
    white-space: nowrap;
}

.clock-time {
    font-weight: 500;
    color: #5f6368;
    white-space: nowrap;
}

/* Daily Briefings button */
.btn-daily {
    background-color: #1a73e8;
    color: white;
    padding: 9px 18px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
    border: none;
}

/* Content area layout */
.content-area {
    padding: 30px;
    flex: 1;
}

/* Map + sidebar placeholders just so layout feels similar */
.map-wrapper {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    height: 520px;
    background: #eef2f6;
    border: 1px solid #e0e0e0;
}

.sidebar-col {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.side-card {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}

/* Hide Streamlit menu/footer */
#MainMenu, footer, header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. APP WRAPPER (MIRROR .app-container)
# --------------------------------------------------------------------------
st.markdown('<div class="app-container">', unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 4. HEADER (MIRROR ORIGINAL HTML STRUCTURE)
# --------------------------------------------------------------------------
# Build the clock text in Python (instead of JS)
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
date_str = now.strftime("%A, %d %b %Y")
time_str = now.strftime("%H:%M GMT+11 UTC")

st.markdown(
    f"""
    <div class="header-container">
        <div class="header-left">
            <div class="logo-icon"><i class="fas fa-shield-alt"></i></div>
            <div class="logo-text">OS <span>INFOHUB</span></div>
        </div>
        <div class="header-right">
            <div class="nav-pills-custom">
                <a class="nav-item-custom active">Global</a>
                <a class="nav-item-custom">AMER</a>
                <a class="nav-item-custom">EMEA</a>
                <a class="nav-item-custom">APJC</a>
                <a class="nav-item-custom">LATAM</a>
            </div>
            <div class="clock-container">
                <div class="clock-date">{date_str}</div>
                <div class="clock-time">{time_str}</div>
            </div>
            <button class="btn-daily">
                <i class="fas fa-file-alt"></i>
                Daily Briefings
            </button>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# 5. CONTENT AREA (USE STREAMLIT INSIDE .content-area)
# --------------------------------------------------------------------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

left_col, right_col = st.columns([3, 1], gap="large")

with left_col:
    st.markdown('<div class="map-wrapper">', unsafe_allow_html=True)
    st.info("MAP PLACEHOLDER")
    st.markdown('</div>', unsafe_allow_html=True)

with right_col:
    st.markdown('<div class="sidebar-col">', unsafe_allow_html=True)

    st.markdown('<div class="side-card">History Search</div>', unsafe_allow_html=True)
    st.markdown('<div class="side-card">Travel Safety Check</div>', unsafe_allow_html=True)
    st.markdown('<div class="side-card">Proximity Alerts</div>', unsafe_allow_html=True)
    st.markdown('<div class="side-card">Risk Category Filter</div>', unsafe_allow_html=True)

    st.markdown('</div>', unsafe_allow_html=True)

st.markdown('</div>', unsafe_allow_html=True)  # close .content-area
st.markdown('</div>', unsafe_allow_html=True)  # close .app-container
