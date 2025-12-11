import streamlit as st
import datetime

# --------------------------------------------------------------------------
# 1. PAGE CONFIGURATION
# --------------------------------------------------------------------------
st.set_page_config(
    page_title="Dell OS | InfoHub",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --------------------------------------------------------------------------
# 2. BRANDING & CSS (Commercial Grade Styling)
# --------------------------------------------------------------------------
# This replicates the CSS from your HTML file, adapting it for Streamlit components
st.markdown("""
    <style>
        /* Import Inter Font */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        
        /* Global Variables */
        :root {
            --dell-blue: #0076CE;
            --bg-dark: #0f1115;
            --text-main: #333;
        }

        /* Main Container Background */
        .stApp {
            background-color: #f4f6f9; /* Light grey for enterprise feel */
        }

        /* Header Styling */
        h1, h2, h3 {
            font-family: 'Inter', sans-serif;
            font-weight: 800;
            letter-spacing: -0.5px;
        }
        
        /* Custom Header Bar */
        .header-container {
            padding: 1rem 0;
            border-bottom: 2px solid #e0e0e0;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
        }
        
        .logo-text {
            font-size: 1.8rem;
            font-weight: 800;
            color: #202124;
        }
        
        .logo-span {
            color: #0076CE;
        }

        /* Hide Streamlit Default Menu/Footer for cleaner look */
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER & REGION SELECTION
# --------------------------------------------------------------------------
# We use columns to separate the Logo from the Region Toggles and Time
col_head_1, col_head_2, col_head_3 = st.columns([2, 4, 2])

with col_head_1:
    st.markdown('<div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>', unsafe_allow_html=True)

with col_head_2:
    # This replaces the nav-pills from HTML
    # It saves the selected region to a variable we will use later for filtering
    selected_region = st.pills(
        "Region Filter",
        options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
        default="Global",
        selection_mode="single",
        label_visibility="collapsed"
    )

with col_head_3:
    # Static Time Display (Streamlit cannot do real-time clocks efficiently without reruns)
    now = datetime.datetime.now(datetime.timezone.utc)
    date_str = now.strftime("%a, %d %b %Y")
    time_str = now.strftime("%H:%M UTC")
    st.markdown(f"<div style='text-align:right; font-weight:600; color:#5f6368'>{date_str} | {time_str}</div>", unsafe_allow_html=True)

st.markdown("---") # Visual separator

# --------------------------------------------------------------------------
# 4. MAIN LAYOUT SKELETON
# --------------------------------------------------------------------------
# We define the two main columns here:
# Left (Main Content): Map + News Stream
# Right (Sidebar): Filters, Search, Proximity Alerts

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    st.info("PLACEHOLDER: Interactive Map will go here.")
    st.info("PLACEHOLDER: Real-time News Stream will go here.")

with side_col:
    st.warning("PLACEHOLDER: Proximity Alerts & Controls.")
