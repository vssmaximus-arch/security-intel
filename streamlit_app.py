import datetime
from pathlib import Path

import streamlit as st
from streamlit.components.v1 import html

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
# 2. GLOBAL STYLES TO MATCH THE REFERENCE HEADER
# --------------------------------------------------------------------------
st.markdown(
    """
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* Background behind the card */
        .stApp {
            background-color: #eef2f6;
            font-family: 'Inter', sans-serif;
        }

        /* White card wrapper */
        div.block-container {
            background: #ffffff;
            border-radius: 18px;
            max-width: 98% !important;
            padding: 0 !important;
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
            margin-top: 1rem;
        }

        /* Header strip */
        .header-strip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 28px;
            border-bottom: 1px solid #e6e6e6;
            background: #ffffff;
        }

        .logo-block {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 800;
            letter-spacing: -0.4px;
            color: #202124;
        }
        .logo-block i { color: #1a73e8; font-size: 1.4rem; }
        .logo-block span { color: #0076CE; }

        /* Region pills */
        .pill-wrapper {
            background: #f1f3f4;
            border-radius: 10px;
            padding: 4px;
        }
        .pill-wrapper button {
            background: transparent;
            color: #5f6368;
            font-weight: 700;
            font-size: 0.78rem;
            text-transform: uppercase;
            padding: 7px 14px;
            border: none;
            border-radius: 8px;
            cursor: default;
        }
        .pill-wrapper button.active {
            background: #202124;
            color: #ffffff;
        }

        /* Clock and button */
        .clock-text { font-weight: 700; color: #202124; font-size: 0.92rem; white-space: nowrap; }
        .clock-sub { color: #5f6368; font-weight: 500; margin-left: 8px; }

        div.stButton > button {
            background: #1a73e8;
            color: #ffffff !important;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.85rem;
            padding: 9px 14px;
            box-shadow: 0 2px 6px rgba(26,115,232,0.25);
        }
        div.stButton > button:hover { background: #1557b0; }

        /* Content padding */
        .content-area { padding: 20px 28px 28px 28px; }

        /* Hide default menu/footer */
        #MainMenu, footer, header { visibility: hidden; }
    </style>
    """,
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# 3. HEADER
# --------------------------------------------------------------------------
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
date_str = now.strftime("%A, %d %b %Y")
time_str = now.strftime("%H:%M GMT+11 UTC")

header_html = f"""
<div class='header-strip'>
    <div class='logo-block'>
        <i class='fas fa-shield-alt'></i>
        <div>OS <span>INFOHUB</span></div>
    </div>
    <div class='pill-wrapper' style='flex:1; display:flex; justify-content:center;'>
        <div style='display:flex; gap:2px;'>
            <button class='active' disabled>Global</button>
            <button disabled>AMER</button>
            <button disabled>EMEA</button>
            <button disabled>APJC</button>
            <button disabled>LATAM</button>
        </div>
    </div>
    <div style='display:flex; align-items:center; gap:16px;'>
        <div class='clock-text'>{date_str} <span class='clock-sub'>| {time_str}</span></div>
        <div class='stButton'>
            <button>\ud83d\udcc4 Daily Briefings</button>
        </div>
    </div>
</div>
"""

st.markdown(header_html, unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 4. CONTENT AREA
# --------------------------------------------------------------------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

map_col, sidebar_col = st.columns([3, 1], gap="large")

with map_col:
    map_html = Path("public/map.html").read_text(encoding="utf-8") if Path("public/map.html").exists() else ""
    html(map_html, height=580)

with sidebar_col:
    st.markdown(
        """
        <div style="background:#f8f9fa; border:1px solid #e5e7eb; border-radius:12px; padding:16px; color:#5f6368; font-weight:600;">
            Sidebar placeholder
        </div>
        """,
        unsafe_allow_html=True,
    )

st.markdown('</div>', unsafe_allow_html=True)
