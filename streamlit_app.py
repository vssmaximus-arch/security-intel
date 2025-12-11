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
# 2. STRICT VISUAL STYLING (CSS)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* 1. FORCE DARK APP BACKGROUND */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* 2. THE WHITE HEADER CARD */
        /* This targets the specific container we create for the header to make it white */
        div[data-testid="stVerticalBlockBorderWrapper"] > div > div[data-testid="stVerticalBlock"] > div.element-container:first-child + div[data-testid="stVerticalBlock"] {
             background-color: #ffffff;
             border-radius: 16px;
             padding: 1rem 2rem;
             margin-bottom: 20px;
             box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        
        /* ALTERNATIVE ROBUST SELECTOR FOR HEADER CARD */
        /* We will wrap the header in a container and this targets the first main container in the app */
        [data-testid="stAppViewContainer"] > .main > .block-container > [data-testid="stVerticalBlock"] > [data-testid="stVerticalBlock"] > div:first-child {
             background-color: #ffffff;
             border-radius: 12px;
             padding: 20px;
        }

        /* 3. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
            height: 100%;
        }
        .logo-icon {
            font-size: 24px;
            color: #0076CE;
        }
        .logo-text {
            font-size: 22px;
            font-weight: 800;
            color: #202124 !important; /* Force dark text on white card */
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE;
        }

        /* 4. PILLS (Region Select) STYLING */
        /* We must override Dark Mode defaults so they look good on the White Card */
        div[data-testid="stPills"] {
            background-color: #f1f3f4; /* Light grey track */
            border-radius: 8px;
            gap: 0px;
            padding: 4px;
        }
        
        div[data-testid="stPills"] button {
            background-color: transparent;
            color: #5f6368 !important; /* Dark Grey text */
            font-weight: 700;
            border: none;
            font-size: 13px;
            transition: all 0.2s;
        }
        
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #ffffff !important; /* White active pill */
            color: #0076CE !important; /* Blue active text */
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            font-weight: 800;
        }

        /* 5. DATE & TIME STYLING */
        .date-container {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
            color: #444 !important; /* Dark text */
            font-weight: 500;
            font-size: 14px;
        }

        /* 6. BUTTON STYLING */
        div.stButton > button {
            background-color: #1a73e8;
            color: white !important;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 14px;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* Hide standard streamlit chrome */
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
        header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER CONTAINER (The White Card)
# --------------------------------------------------------------------------
with st.container():
    # Grid: Logo(2) | Spacer(1) | Pills(4) | Date(3) | Button(2)
    c1, c2, c3, c4, c5 = st.columns([2, 0.5, 4, 3, 1.5], gap="small")

    with c1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    with c2:
        st.write("")

    with c3:
        # Pills for region selection
        selected_region = st.pills(
            "Region",
            options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
            default="GLOBAL",
            label_visibility="collapsed"
        )

    with c4:
        # Date Display
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        st.markdown(f'<div class="date-container">{date_str} | {time_str}</div>', unsafe_allow_html=True)

    with c5:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. MAIN APP CONTENT (Dark Background)
# --------------------------------------------------------------------------
st.markdown("<br>", unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    st.info(f"Showing Intelligence for: **{selected_region}**")

with side_col:
    st.warning("Sidebar: Proximity Alerts")
