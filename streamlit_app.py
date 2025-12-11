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
# 2. CSS STYLING (THE FIX)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* 1. GLOBAL BACKGROUND (DARK) */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* 2. HEADER CARD (THE CRITICAL FIX) */
        /* We use the :has() selector to find the container with our custom marker class */
        div[data-testid="stVerticalBlock"]:has(div.header-marker) {
            background-color: #ffffff;
            border-radius: 16px;
            padding: 1.5rem 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            border: 1px solid #e0e0e0;
        }

        /* 3. TEXT COLORS INSIDE HEADER */
        /* Force all text inside the white header to be dark */
        div[data-testid="stVerticalBlock"]:has(div.header-marker) p,
        div[data-testid="stVerticalBlock"]:has(div.header-marker) span,
        div[data-testid="stVerticalBlock"]:has(div.header-marker) div {
            color: #202124;
        }

        /* 4. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .logo-icon {
            font-size: 24px;
            color: #0076CE !important; /* Dell Blue */
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

        /* 5. PILLS (REGION SELECTOR) */
        /* Override dark mode for the pills inside the header */
        div[data-testid="stPills"] {
            background-color: #f1f3f4; /* Light Grey Track */
            border-radius: 8px;
            padding: 4px;
            gap: 4px;
        }
        div[data-testid="stPills"] button {
            background-color: transparent;
            color: #5f6368 !important;
            border: none;
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
            border-radius: 6px;
            font-weight: 600;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* 7. HIDE STREAMLIT UI */
        #MainMenu, footer, header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (WHITE CARD)
# --------------------------------------------------------------------------
with st.container():
    # INVISIBLE MARKER: This triggers the CSS above to turn this container WHITE
    st.markdown('<div class="header-marker"></div>', unsafe_allow_html=True)

    # Grid: Logo(2) | Spacer(1) | Pills(4) | Date(3) | Button(2)
    col1, col2, col3, col4, col5 = st.columns([2, 0.5, 4, 3, 1.5], gap="small")

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
        # Region Selector Pills
        selected_region = st.pills(
            "Region",
            options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
            default="GLOBAL",
            label_visibility="collapsed"
        )

    with col4:
        # Date & Time Display
        # Hardcoded timezone offset for Sydney (GMT+11) as per screenshot
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        
        st.markdown(f"""
            <div style="text-align: right; font-weight: 500; font-size: 15px; color: #444; height: 100%; display: flex; align-items: center; justify-content: flex-end;">
                {date_str} | {time_str}
            </div>
        """, unsafe_allow_html=True)

    with col5:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. MAIN CONTENT (DARK BACKGROUND)
# --------------------------------------------------------------------------
# This content is OUTSIDE the marked container, so it stays dark.
st.markdown("<br>", unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    # Map Placeholder
    with st.container():
        st.info(f"Showing Intelligence for: **{selected_region}**")

with side_col:
    # Sidebar Placeholder
    with st.container():
        st.warning("Sidebar: Proximity Alerts")
