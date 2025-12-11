import streamlit as st
import datetime

# --------------------------------------------------------------------------
# 1. PAGE CONFIGURATION
# --------------------------------------------------------------------------
st.set_page_config(
    page_title="Dell OS | InfoHub",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# --------------------------------------------------------------------------
# 2. CSS – MATCH GITHUB PAGES STYLE
# --------------------------------------------------------------------------
st.markdown(
    """
<link rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
    --os-blue: #0076CE;
    --os-dark-bg: #0f1115;
}

/* STREAMLIT SHELL */
.stApp {
    background-color: var(--os-dark-bg);
    font-family: 'Inter', sans-serif;
}

/* MAIN WHITE CARD */
div.block-container {
    background-color: #ffffff;
    border-radius: 24px;
    max-width: 98% !important;
    padding-top: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
    padding-bottom: 24px !important;
    margin-top: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

/* TOP HEADER BAR – ALWAYS FIRST THING INSIDE THE CARD */
.os-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 32px 10px 32px;
    border-bottom: 1px solid #f0f0f0;
}

/* LEFT: LOGO */
.os-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
}

.os-logo-icon {
    font-size: 1.5rem;
    color: #1a73e8;
}

.os-logo-text {
    font-size: 1.25rem;
    font-weight: 800;
    color: #202124;
    letter-spacing: -0.5px;
    white-space: nowrap;
}

.os-logo-text span {
    color: var(--os-blue);
}

/* RIGHT SIDE GROUP: PILLS + CLOCK + BUTTON */
.os-header-right {
    display: flex;
    align-items: center;
    gap: 20px;
}

/* REGION PILLS (STATIC BUT VISUALLY MATCHED) */
.os-pills {
    display: inline-flex;
    background-color: #f1f3f4;
    border-radius: 10px;
    padding: 4px;
    gap: 2px;
}

.os-pill {
    padding: 7px 18px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 0.78rem;
    text-transform: uppercase;
    color: #5f6368;
    cursor: pointer;
    user-select: none;
}

.os-pill.active {
    background-color: #202124;
    color: #ffffff;
}

/* DATE / TIME */
.os-clock {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    text-align: right;
    white-space: nowrap;
}

.os-clock-date {
    font-weight: 600;
    color: #202124;
}

.os-clock-time {
    font-weight: 500;
    color: #5f6368;
}

/* DAILY BRIEFINGS BUTTON */
.os-header-btn {
    background-color: #1a73e8;
    color: #ffffff;
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    font-weight: 600;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
}

.os-header-btn:hover {
    background-color: #1557b0;
}

/* CONTENT AREA PADDING (BELOW HEADER) */
.os-content {
    padding: 20px 32px 0 32px;
}

/* SIMPLE CARDS FOR PLACEHOLDER LAYOUT */
.os-map-placeholder {
    border-radius: 16px;
    border: 1px solid #e0e0e0;
    background: #eef2f6;
    padding: 16px;
    height: 480px;
}

.os-side-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e0e0e0;
    padding: 16px;
    margin-bottom: 16px;
    font-size: 0.9rem;
}

/* HIDE STREAMLIT CHROME */
#MainMenu, footer, header { visibility: hidden; }
</style>
""",
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# 3. HEADER BAR (PIXEL-CLOSE TO ORIGINAL)
# --------------------------------------------------------------------------
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
date_str = now.strftime("%A, %d %b %Y")
time_str = now.strftime("%H:%M GMT+11 UTC")

st.markdown(
    f"""
<div class="os-header">
    <div class="os-header-left">
        <div class="os-logo-icon">
            <i class="fas fa-shield-alt"></i>
        </div>
        <div class="os-logo-text">
            OS <span>INFOHUB</span>
        </div>
    </div>

    <div class="os-header-right">
        <div class="os-pills">
            <div class="os-pill active">GLOBAL</div>
            <div class="os-pill">AMER</div>
            <div class="os-pill">EMEA</div>
            <div class="os-pill">APJC</div>
            <div class="os-pill">LATAM</div>
        </div>

        <div class="os-clock">
            <div class="os-clock-date">{date_str}</div>
            <div class="os-clock-time">{time_str}</div>
        </div>

        <button class="os-header-btn">
            <i class="fas fa-file-alt"></i>
            Daily Briefings
        </button>
    </div>
</div>
""",
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# 4. CONTENT AREA (INSIDE SAME WHITE CARD)
# --------------------------------------------------------------------------
st.markdown('<div class="os-content">', unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="large")

with main_col:
    st.markdown('<div class="os-map-placeholder">', unsafe_allow_html=True)
    st.write("MAP PLACEHOLDER")
    st.markdown('</div>', unsafe_allow_html=True)

with side_col:
    st.markdown('<div class="os-side-card"><b>History Search</b></div>', unsafe_allow_html=True)
    st.markdown('<div class="os-side-card"><b>Travel Safety Check</b></div>', unsafe_allow_html=True)
    st.markdown('<div class="os-side-card"><b>Proximity Alerts</b></div>', unsafe_allow_html=True)
    st.markdown('<div class="os-side-card"><b>Risk Category Filter</b></div>', unsafe_allow_html=True)

st.markdown('</div>', unsafe_allow_html=True)  # close .os-content
