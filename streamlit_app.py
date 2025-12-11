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
# 2. EXACT CSS REPLICATION (MATCHING HTML DASHBOARD)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* 1. BODY BACKGROUND (Dark #0f1115) */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* 2. THE MAIN WHITE CARD (The .app-container equivalent) */
        /* We target Streamlit's main block container to be the white card */
        div.block-container {
            background-color: #ffffff;
            border-radius: 24px;
            max-width: 95% !important; /* Matches the width in your screenshot */
            padding-top: 0rem !important; /* CRITICAL: Removes top gap */
            padding-left: 0rem !important; /* CRITICAL: Goes edge to edge */
            padding-right: 0rem !important;
            padding-bottom: 2rem !important;
            margin-top: 40px; /* Centers it vertically like the HTML body padding */
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        /* 3. HEADER WRAPPER (.header-container) */
        /* This creates the border and padding for the top section */
        div[data-testid="stVerticalBlock"]:has(.logo-text) {
            border-bottom: 1px solid #f0f0f0;
            padding: 15px 32px !important; /* Exact padding from your HTML */
            background: white;
            border-radius: 24px 24px 0 0; /* Rounded top corners only */
        }

        /* 4. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
            height: 50px; /* Fix height for alignment */
        }
        .logo-icon {
            font-size: 1.6rem;
            color: #1a73e8;
        }
        .logo-text {
            font-size: 1.4rem;
            font-weight: 800;
            color: #202124;
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE;
        }

        /* 5. PILLS (Region Select) */
        div[data-testid="stPills"] {
            background-color: #f1f3f4;
            border-radius: 10px;
            padding: 4px;
            gap: 0px;
            display: flex;
            justify-content: flex-end;
        }
        div[data-testid="stPills"] button {
            background-color: transparent;
            border: none;
            color: #5f6368 !important;
            font-weight: 700;
            font-size: 0.8rem;
            text-transform: uppercase;
            padding: 0.5rem 1rem;
        }
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #202124 !important;
            color: #fff !important;
            border-radius: 8px;
        }

        /* 6. BUTTON (Daily Briefings) */
        div.stButton > button {
            background-color: #1a73e8;
            color: white !important;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.9rem;
            border: none;
            padding: 0.55rem 1.2rem;
            margin-top: 2px; /* Visual alignment fix */
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* 7. CLOCK TEXT */
        .clock-container {
            text-align: right;
            font-size: 0.85rem;
            color: #202124;
            display: flex;
            flex-direction: column;
            justify-content: center;
            height: 100%;
            line-height: 1.3;
        }
        .clock-date { font-weight: 700; }
        .clock-time { font-weight: 500; color: #5f6368; }

        /* HIDE UI BLOAT */
        #MainMenu, footer, header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (Edge-to-Edge)
# --------------------------------------------------------------------------
# We create the header container. The CSS above targets this using the .logo-text class
# to apply the border-bottom and padding.

with st.container():
    # Grid Layout: Logo (Left) | Spacer | Pills | Clock | Button (Right)
    # Ratios adjusted to push items to the correct edges
    col1, col2, col3, col4, col5 = st.columns([2.5, 0.5, 4, 2.5, 1.8])

    # 1. LOGO
    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    # 2. SPACER
    with col2:
        st.write("")

    # 3. PILLS (Region)
    with col3:
        # Align right using CSS flex on the parent container
        st.markdown('<div style="display:flex; justify-content:flex-end; width:100%;">', unsafe_allow_html=True)
        selected_region = st.pills(
            "Region",
            options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
            default="Global",
            label_visibility="collapsed"
        )
        st.markdown('</div>', unsafe_allow_html=True)

    # 4. CLOCK
    with col4:
        # Static time for prototype matching (UTC+11)
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        
        st.markdown(f"""
            <div class="clock-container">
                <div class="clock-date">{date_str}</div>
                <div class="clock-time">{time_str}</div>
            </div>
        """, unsafe_allow_html=True)

    # 5. BUTTON
    with col5:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. CONTENT AREA (Inside White Card)
# --------------------------------------------------------------------------
# We add padding here because we removed it from the main container to let the header touch the edges.
st.markdown('<div style="padding: 20px 32px;">', unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="large")

with main_col:
    # Placeholder for Map (Next Step)
    st.info("Map Area (Will replace this with Leaflet)")

with side_col:
    # Placeholder for Sidebar
    st.warning("Sidebar Area (Will replace with Alerts)")

st.markdown('</div>', unsafe_allow_html=True)
