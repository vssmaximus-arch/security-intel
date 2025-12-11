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
# 2. EXACT CSS OVERRIDES (PIXEL PERFECT ATTEMPT)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* 1. BODY & BACKGROUND */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* 2. MAIN WHITE CARD CONTAINER */
        div.block-container {
            background-color: #ffffff;
            border-radius: 24px;
            max-width: 98% !important; /* WIDER to match your screenshot */
            padding-top: 0 !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
            padding-bottom: 3rem !important;
            margin-top: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        /* 3. HEADER WRAPPER */
        /* This targets the container holding the Logo/Nav to act as the header strip */
        [data-testid="stVerticalBlock"] > [style*="flex-direction: column;"] > [data-testid="stVerticalBlock"] {
            border-bottom: 1px solid #e0e0e0;
            padding: 12px 32px !important; /* Matches HTML padding */
            background: white;
            border-radius: 24px 24px 0 0;
            margin-bottom: 0px !important;
        }

        /* 4. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
            height: 45px; /* Fixed height for vertical centering */
        }
        .logo-icon {
            font-size: 1.5rem;
            color: #1a73e8;
        }
        .logo-text {
            font-size: 1.3rem;
            font-weight: 800;
            color: #202124;
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE;
        }

        /* 5. NAV PILLS (Region) */
        div[data-testid="stPills"] {
            background-color: #f1f3f4;
            border-radius: 8px;
            padding: 3px;
            gap: 0px;
            display: inline-flex;
        }
        div[data-testid="stPills"] button {
            background-color: transparent;
            border: none;
            color: #5f6368 !important;
            font-weight: 700;
            font-size: 0.75rem;
            text-transform: uppercase;
            padding: 0.4rem 1rem;
            min-height: 0px;
            height: auto;
            line-height: 1.2;
        }
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #202124 !important;
            color: #fff !important;
            border-radius: 6px;
        }
        
        /* 6. BUTTON (Daily Briefings) */
        div.stButton > button {
            background-color: #1a73e8;
            color: white !important;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.85rem;
            border: none;
            padding: 0.5rem 1rem;
            margin-top: 4px; /* Align with text */
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }
        
        /* 7. DATE/TIME TEXT */
        .header-date {
            text-align: right;
            color: #202124;
            font-weight: 600;
            font-size: 0.85rem;
            white-space: nowrap;
            margin-top: 10px; /* Align vertically with buttons */
        }
        .header-time {
            color: #5f6368;
            font-weight: 500;
            margin-left: 8px;
        }

        /* HIDE UI BLOAT */
        #MainMenu, footer, header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (ADJUSTED RATIOS)
# --------------------------------------------------------------------------
# Using specific ratios to push items to the edges like "justify-content: space-between"
with st.container():
    # Columns: [Logo 2] [Spacer 4] [Pills 3] [Date 2.5] [Button 1.5]
    col1, col2, col3, col4, col5 = st.columns([2, 4, 3, 2.5, 1.5])

    # 1. LOGO (Far Left)
    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    # 2. SPACER (Middle - Pushes everything else right)
    with col2:
        st.write("")

    # 3. PILLS (Right Align Group)
    with col3:
        # We wrap this to control alignment
        st.markdown('<div style="display:flex; justify-content:flex-end; padding-top:4px;">', unsafe_allow_html=True)
        selected_region = st.pills(
            "Region",
            options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
            default="Global",
            label_visibility="collapsed"
        )
        st.markdown('</div>', unsafe_allow_html=True)

    # 4. DATE (Right Align Group)
    with col4:
        # Dynamic Time logic
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        
        st.markdown(f"""
            <div class="header-date">
                {date_str} <span class="header-time">| {time_str}</span>
            </div>
        """, unsafe_allow_html=True)

    # 5. BUTTON (Far Right)
    with col5:
        # st.button doesn't support float:right easily, so we rely on the column being narrow/last
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. CONTENT WRAPPER
# --------------------------------------------------------------------------
# Manual padding to replace what we stripped from block-container
st.markdown('<div style="padding: 20px 32px;">', unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="large")

with main_col:
    st.info("MAP PLACEHOLDER")

with side_col:
    st.warning("SIDEBAR PLACEHOLDER")

st.markdown('</div>', unsafe_allow_html=True)
