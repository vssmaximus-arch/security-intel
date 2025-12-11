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
# 2. ROBUST CSS STYLING
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* 1. GLOBAL BACKGROUND -> STRICT DARK */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* 2. HEADER CARD -> TARGETED BY LOGO CLASS */
        /* This selector finds the vertical block that contains the logo and turns it white */
        div[data-testid="stVerticalBlock"]:has(div.logo-text) {
            background-color: #ffffff;
            border-radius: 16px;
            padding: 1rem 2rem;
            margin-top: -30px; /* Pull it up slightly */
            margin-bottom: 2rem;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }

        /* 3. TEXT COLOR OVERRIDES INSIDE HEADER */
        /* Force all text inside the white header to be dark grey/black */
        div[data-testid="stVerticalBlock"]:has(div.logo-text) p, 
        div[data-testid="stVerticalBlock"]:has(div.logo-text) span, 
        div[data-testid="stVerticalBlock"]:has(div.logo-text) div {
            color: #333333 !important;
        }

        /* 4. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .logo-icon {
            font-size: 24px;
            color: #0076CE !important;
        }
        .logo-text {
            font-size: 22px;
            font-weight: 800;
            color: #202124 !important;
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE !important;
        }

        /* 5. PILLS (REGION SELECT) STYLING */
        div[data-testid="stPills"] {
            background-color: #f1f3f4 !important;
            border-radius: 8px;
            padding: 5px;
            gap: 2px;
        }
        div[data-testid="stPills"] button {
            border: none;
            background-color: transparent;
            color: #5f6368 !important;
            font-weight: 700;
            font-size: 13px;
        }
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #ffffff !important;
            color: #0076CE !important;
            font-weight: 800;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        /* 6. BUTTON (DAILY BRIEFINGS) */
        div.stButton > button {
            background-color: #1a73e8;
            color: white !important;
            border: none;
            font-weight: 600;
            border-radius: 6px;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }
        
        /* 7. DATE TEXT ALIGNMENT */
        .date-text {
            text-align: right;
            font-weight: 500;
            font-size: 14px;
            color: #555 !important;
            white-space: nowrap;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
        }

        /* UI CLEANUP */
        #MainMenu, footer, header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER STRUCTURE
# --------------------------------------------------------------------------
# The CSS above looks for ".logo-text" inside this container to turn it white.
with st.container():
    # Grid: Logo(2) | Spacer(1) | Pills(4) | Date(3.5) | Button(1.5)
    col1, col2, col3, col4, col5 = st.columns([2, 0.5, 4, 3.5, 1.5], gap="small")

    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    with col2:
        st.write("")

    with col3:
        # Region Selection
        selected_region = st.pills(
            "Region",
            options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
            default="GLOBAL",
            label_visibility="collapsed"
        )

    with col4:
        # Date Display (Matches screenshot)
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        st.markdown(f'<div class="date-text">{date_str} | {time_str}</div>', unsafe_allow_html=True)

    with col5:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. MAIN CONTENT
# --------------------------------------------------------------------------
st.markdown("<br>", unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    # Use container to create the map card visual
    with st.container():
        st.info(f"Checking region: **{selected_region}**")

with side_col:
    with st.container():
        st.warning("Sidebar: Proximity Alerts")
