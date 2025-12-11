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
# 2. COMMERCIAL-GRADE CSS (Replicating your HTML)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* --- GLOBAL VARIABLES --- */
        :root {
            --bg-dark: #0f1115;
            --dell-blue: #0076CE;
            --action-blue: #1a73e8;
            --text-main: #202124;
            --text-gray: #5f6368;
        }

        /* --- 1. BODY BACKGROUND --- */
        .stApp {
            background-color: var(--bg-dark);
            font-family: 'Inter', sans-serif;
        }

        /* --- 2. MAIN APP CONTAINER (The White Card) --- */
        /* We style the main block of Streamlit to look like .app-container */
        div.block-container {
            background-color: #ffffff;
            border-radius: 24px;
            max-width: 95% !important;
            padding: 0 !important; /* Remove default padding to let header touch top */
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            margin-top: 40px;
            margin-bottom: 40px;
            overflow: hidden;
        }

        /* --- 3. HEADER CONTAINER --- */
        .header-wrapper {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 15px 32px;
            height: 80px;
            border-bottom: 1px solid #f0f0f0;
            background-color: #fff;
        }

        /* LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .logo-icon {
            font-size: 1.6rem;
            color: var(--action-blue);
        }
        .logo-text {
            font-size: 1.4rem;
            font-weight: 800;
            color: var(--text-main);
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: var(--dell-blue);
        }

        /* --- 4. COMPONENT OVERRIDES --- */
        
        /* REGION PILLS (Replicating .nav-pills-custom) */
        /* Target Streamlit's st.pills / st.radio group */
        div[data-testid="stPills"] {
            background-color: #f1f3f4;
            border-radius: 10px;
            padding: 4px;
            gap: 2px;
        }
        
        div[data-testid="stPills"] button {
            background-color: transparent;
            border: none;
            color: var(--text-gray) !important;
            font-weight: 700;
            font-size: 0.85rem;
            text-transform: uppercase;
            padding: 6px 16px;
        }
        
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: var(--text-main) !important; /* Dark Active */
            color: #ffffff !important;
            border-radius: 8px;
        }

        /* DAILY BUTTON (Replicating .btn-daily) */
        div.stButton > button {
            background-color: var(--action-blue);
            color: white !important;
            font-weight: 600;
            border-radius: 8px;
            border: none;
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* CLOCK TEXT */
        .clock-text {
            text-align: right;
            line-height: 1.2;
        }
        .clock-date { font-weight: 700; color: var(--text-main); font-size: 0.9rem; }
        .clock-time { font-size: 0.8rem; color: var(--text-gray); font-weight: 500; }

        /* HIDE DEFAULT ELEMENTS */
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
        header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (Replicating .header-container)
# --------------------------------------------------------------------------
# We create a container to hold the top bar
with st.container():
    # Grid: Logo(3) | Spacer(1) | Pills(4) | Clock(2) | Button(2)
    col1, col2, col3, col4, col5 = st.columns([2.5, 0.5, 4.5, 2, 2.5])

    # 1. LOGO
    with col1:
        st.markdown("""
            <div class="logo-container" style="padding-top: 15px; padding-left: 20px;">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    # 2. SPACER
    with col2:
        st.write("")

    # 3. REGION PILLS
    with col3:
        st.markdown('<div style="padding-top: 10px;">', unsafe_allow_html=True)
        selected_region = st.pills(
            "Region",
            options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
            default="Global",
            label_visibility="collapsed"
        )
        st.markdown('</div>', unsafe_allow_html=True)

    # 4. CLOCK (Static Placeholder for now)
    with col4:
        now = datetime.datetime.now()
        date_str = now.strftime("%a, %d %b %Y")
        time_str = now.strftime("%H:%M Local")
        st.markdown(f"""
            <div class="clock-text" style="padding-top: 12px;">
                <div class="clock-date">{date_str}</div>
                <div class="clock-time">{time_str}</div>
            </div>
        """, unsafe_allow_html=True)

    # 5. BUTTON
    with col5:
        st.markdown('<div style="padding-top: 12px; padding-right: 20px;">', unsafe_allow_html=True)
        st.button("📄 Daily Briefings", use_container_width=True)
        st.markdown('</div>', unsafe_allow_html=True)

    # HEADER BORDER BOTTOM (Visual Divider)
    st.markdown('<hr style="margin: 15px 0 0 0; padding: 0; border-top: 1px solid #f0f0f0;">', unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 4. EMPTY CONTENT AREA (Waiting for next step)
# --------------------------------------------------------------------------
# This area is inside the White Card but currently empty as requested.
with st.container():
    st.markdown('<div style="padding: 30px; height: 600px;"></div>', unsafe_allow_html=True)
