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
# 2. CSS STYLING (THE "WHITE CARD" FIX)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* 1. APP BACKGROUND -> STRICT DARK */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* 2. HEADER CARD CONTAINER */
        /* This locates the container holding our 'header-anchor' and turns it WHITE */
        div[data-testid="stVerticalBlock"]:has(div#header-anchor) {
            background-color: #ffffff;
            border-radius: 16px;
            padding: 1.5rem 2rem;
            margin-top: -40px; /* Pull to top */
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border: 1px solid #e0e0e0;
        }

        /* 3. TEXT COLORS INSIDE HEADER */
        /* Force text inside the white card to be DARK */
        div[data-testid="stVerticalBlock"]:has(div#header-anchor) p,
        div[data-testid="stVerticalBlock"]:has(div#header-anchor) span,
        div[data-testid="stVerticalBlock"]:has(div#header-anchor) div {
            color: #202124 !important;
        }

        /* 4. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .logo-icon {
            font-size: 26px;
            color: #0076CE !important;
        }
        .logo-text {
            font-size: 24px;
            font-weight: 800;
            color: #202124 !important;
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE !important;
        }

        /* 5. REGION PILLS (Tabs) STYLING */
        div[data-testid="stPills"] {
            background-color: #f1f3f4 !important; /* Light Grey Bar */
            border-radius: 8px;
            padding: 5px;
            gap: 5px;
        }
        div[data-testid="stPills"] button {
            background-color: transparent;
            border: none;
            color: #5f6368 !important; /* Grey Text */
            font-weight: 700;
            font-size: 13px;
            text-transform: uppercase;
        }
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #ffffff !important; /* White Active Pill */
            color: #0076CE !important; /* Blue Active Text */
            font-weight: 800;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        /* 6. BUTTON (Daily Briefings) */
        div.stButton > button {
            background-color: #1a73e8;
            color: white !important;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            box-shadow: none;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* 7. DATE TEXT */
        .date-text {
            text-align: right;
            font-weight: 500;
            font-size: 15px;
            color: #444 !important;
            white-space: nowrap;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
        }

        /* HIDE DEFAULT STREAMLIT UI elements */
        #MainMenu, footer, header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (THE WHITE CARD)
# --------------------------------------------------------------------------
with st.container():
    # ANCHOR: This invisible div is what the CSS looks for to turn the background WHITE
    st.markdown('<div id="header-anchor"></div>', unsafe_allow_html=True)

    # Grid: Logo(2.2) | Spacer(0.8) | Pills(4) | Date(3.5) | Button(1.5)
    col1, col2, col3, col4, col5 = st.columns([2.2, 0.8, 4, 3.5, 1.5], gap="small")

    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    with col2:
        st.write("") # Spacer

    with col3:
        # Region Selection
        selected_region = st.pills(
            "Region",
            options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
            default="GLOBAL",
            label_visibility="collapsed"
        )

    with col4:
        # Date Display (GMT+11 for Sydney)
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        
        st.markdown(f'<div class="date-text">{date_str} | {time_str}</div>', unsafe_allow_html=True)

    with col5:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. MAIN CONTENT (DARK BACKGROUND)
# --------------------------------------------------------------------------
st.markdown("<br>", unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    # This info box will show on the DARK background, proving the header is separate.
    with st.container():
        st.info(f"Checking region: **{selected_region}**")

with side_col:
    with st.container():
        st.warning("Sidebar: Proximity Alerts")
