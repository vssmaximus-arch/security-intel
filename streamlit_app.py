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
# 2. CSS
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* BODY */
        .stApp {
            background-color: #0f1115;
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
            padding-bottom: 3rem !important;
            margin-top: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        /* TOP HEADER STRIP */
        .os-header {
            display: grid;
            grid-template-columns: auto 1fr auto auto; /* logo | pills | date | button */
            align-items: center;
            column-gap: 16px;
            padding: 10px 32px 8px 32px;
            border-bottom: 1px solid #e0e0e0;
            border-radius: 24px 24px 0 0;
            background: #ffffff;
        }

        /* Streamlit puts columns as children divs; align them */
        .os-header > div[data-testid="column"] {
            display: flex;
            align-items: center;
        }

        /* LOGO */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
            height: 40px;
        }
        .logo-icon {
            font-size: 1.4rem;
            color: #1a73e8;
        }
        .logo-text {
            font-size: 1.25rem;
            font-weight: 800;
            color: #202124;
            letter-spacing: -0.5px;
            line-height: 1;
            white-space: nowrap;
        }
        .logo-span {
            color: #0076CE;
        }

        /* NAV PILLS */
        .os-header-nav {
            width: 100%;
            display: flex;
            justify-content: flex-end; /* pushes pills toward the right, like screenshot */
        }
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
            padding: 0.35rem 1rem;
            min-height: 0px;
            height: auto;
            line-height: 1.2;
        }
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #202124 !important;
            color: #fff !important;
            border-radius: 6px;
        }

        /* DATE/TIME */
        .header-date {
            text-align: right;
            color: #202124;
            font-weight: 600;
            font-size: 0.85rem;
            white-space: nowrap;
        }
        .header-time {
            color: #5f6368;
            font-weight: 500;
            margin-left: 8px;
        }

        /* DAILY BRIEFINGS BUTTON */
        .header-btn-wrap {
            width: 100%;
            display: flex;
            justify-content: flex-end;
        }
        .header-btn-wrap > div.stButton > button {
            background-color: #1a73e8;
            color: white !important;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.85rem;
            border: none;
            padding: 0.45rem 1.3rem;
            min-height: 0;
        }
        .header-btn-wrap > div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* HIDE STREAMLIT CHROME */
        #MainMenu, footer, header {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT
# --------------------------------------------------------------------------
st.markdown('<div class="os-header">', unsafe_allow_html=True)

# create 4 columns INSIDE our custom header div
col_logo, col_pills, col_date, col_btn = st.columns([2, 3, 2.5, 1.5])

# LOGO (left)
with col_logo:
    st.markdown("""
        <div class="logo-container">
            <i class="fas fa-shield-alt logo-icon"></i>
            <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
        </div>
    """, unsafe_allow_html=True)

# PILLS (right side of center area)
with col_pills:
    st.markdown('<div class="os-header-nav">', unsafe_allow_html=True)
    selected_region = st.pills(
        "Region",
        options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
        default="GLOBAL",
        label_visibility="collapsed"
    )
    st.markdown('</div>', unsafe_allow_html=True)

# DATE/TIME (GMT+11)
with col_date:
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
    date_str = now.strftime("%A, %d %b %Y")
    time_str = now.strftime("%H:%M GMT+11 UTC")

    st.markdown(
        f"""
        <div class="header-date">
            {date_str}<span class="header-time"> | {time_str}</span>
        </div>
        """,
        unsafe_allow_html=True
    )

# DAILY BRIEFINGS BUTTON (far right)
with col_btn:
    st.markdown('<div class="header-btn-wrap">', unsafe_allow_html=True)
    st.button("Daily Briefings")
    st.markdown('</div>', unsafe_allow_html=True)

st.markdown('</div>', unsafe_allow_html=True)  # close .os-header

# --------------------------------------------------------------------------
# 4. CONTENT WRAPPER
# --------------------------------------------------------------------------
st.markdown('<div style="padding: 20px 32px;">', unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="large")

with main_col:
    st.info("MAP PLACEHOLDER")

with side_col:
    st.warning("SIDEBAR PLACEHOLDER")

st.markdown('</div>', unsafe_allow_html=True)
