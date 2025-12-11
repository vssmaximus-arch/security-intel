import datetime
import streamlit as st
from streamlit_autorefresh import st_autorefresh

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
# 1a. AUTO-REFRESH (LIVE CLOCK)
# --------------------------------------------------------------------------
st_autorefresh(interval=1000, key="live_clock_refresh_v3")

# --------------------------------------------------------------------------
# 2. CSS STYLING
# --------------------------------------------------------------------------
st.markdown(
    """
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
    --primary-color: #1a73e8 !important;
    --dell-blue: #0076CE;
    --bg-dark: #0f1115;
}

/* APP BACKGROUND */
.stApp {
    background-color: var(--bg-dark);
    font-family: 'Inter', sans-serif;
}
[data-testid="stAppViewContainer"] { padding: 0; }

/* MAIN WHITE CARD */
div.block-container {
    background-color: #fff;
    border-radius: 24px;
    min-height: calc(100vh - 48px);
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    margin: 24px;
    padding: 0 !important;
    width: calc(100% - 48px) !important;
    max-width: calc(100% - 48px) !important;
}

/* HEADER STRIP (uses .header-marker) */
div[data-testid="stVerticalBlock"]:has(div.header-marker) {
    border-bottom: 1px solid #f0f0f0;
    padding: 0 32px !important;
    height: 80px;
    background: white;
    display: flex;
    align-items: center;
}

/* LOGO */
.logo-container { display: flex; align-items: center; gap: 12px; height: 100%; }
.logo-icon { font-size: 1.6rem; color: #1a73e8; }
.logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; margin: 0; line-height: 1; }
.logo-text span { color: var(--dell-blue); }

/* REGION PILLS (NO POSITIONING HACKS – JUST STYLE) */
div[data-testid="stPills"] {
    background-color: #f1f3f4 !important;
    padding: 4px !important;
    border-radius: 10px !important;
    display: inline-flex !important;
    gap: 0;
    border: none !important;
}
div[data-testid="stPills"] button {
    background-color: transparent !important;
    border: none !important;
    color: #5f6368 !important;
    font-weight: 700 !important;
    font-size: 0.75rem !important;
    text-transform: uppercase !important;
    padding: 6px 14px !important;
    min-height: 0px !important;
    height: auto !important;
    line-height: 1 !important;
}
div[data-testid="stPills"] button[aria-selected="true"] {
    background-color: #1a73e8 !important;   /* your blue active style */
    color: #ffffff !important;
    box-shadow: none !important;
}
div[data-testid="stPills"] button:hover {
    color: #1a73e8 !important;
    background-color: rgba(26,115,232,0.1) !important;
}

/* CLOCK */
.clock-container { 
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    text-align: right;
    justify-content: center;
    height: 100%;
    line-height: 1.3;
    white-space: nowrap;
}
.clock-date { font-weight: 700; color: #202124; }
#clock-time, .clock-time { font-weight: 500; color: #5f6368; }

/* DAILY BRIEFINGS BUTTON */
div.stButton > button {
    background-color: #1a73e8 !important;
    color: white !important;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 8px 16px;
    white-space: nowrap;
}
div.stButton > button:hover {
    background-color: #1557b0 !important;
    color: white !important;
}

/* CONTENT + SIDEBAR GENERAL (unchanged) */
.content-area { padding: 30px; }
.map-wrapper {
    background: #eef2f6;
    border-radius: 16px;
    height: 520px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    border: 1px solid #e0e0e0;
}
div[data-testid="stVerticalBlock"]:has(div.card-marker) {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.card-label {
    font-size: 0.95rem;
    font-weight: 700;
    color: #202124;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
}

/* Hide Streamlit chrome */
#MainMenu, footer, header {visibility: hidden;}
div[data-testid="stDateInput"] label,
div[data-testid="stSelectbox"] label { display: none; }
</style>
""",
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT: LOGO | (TABS + CLOCK) | BUTTON
# --------------------------------------------------------------------------
with st.container():
    st.markdown('<div class="header-marker"></div>', unsafe_allow_html=True)

    # Three main zones on the header row
    col_logo, col_mid, col_btn = st.columns([2, 7, 3], vertical_alignment="center")

    # LEFT: Logo
    with col_logo:
        st.markdown(
            """
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span>INFOHUB</span></div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    # MIDDLE: TABS directly next to CLOCK
    with col_mid:
        mid_tabs, mid_clock = st.columns([3.5, 2.5], vertical_alignment="center")

        with mid_tabs:
            selected_region = st.pills(
                "Region",
                options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
                default="Global",
                label_visibility="collapsed",
                key="region_selector",
            )

        with mid_clock:
            now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
            date_str = now.strftime("%A, %d %b %Y")
            time_str = now.strftime("%H:%M:%S GMT+11 UTC")

            st.markdown(
                f"""
                <div class="clock-container">
                    <div class="clock-date">{date_str}</div>
                    <div class="clock-time">{time_str}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

    # RIGHT: Button
    with col_btn:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. CONTENT
# --------------------------------------------------------------------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

main_col, side_col = st.columns([9, 3], gap="large")

with main_col:
    st.markdown('<div class="map-wrapper">', unsafe_allow_html=True)
    st.info(f"📍 MAP VIEW: Showing data for {selected_region.upper()}")
    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(
        """
        <div style="margin-top: 25px; display: flex; justify-content: space-between;
                    align-items: center; margin-bottom: 15px;">
            <div style="font-weight: 700; font-size: 1rem;">
                <i class="fas fa-circle text-primary me-2" style="font-size: 0.6rem;"></i>
                Real-time Intelligence Stream
            </div>
            <span class="badge bg-light text-secondary" style="border: 1px solid #eee;">
                LIVE FEED
            </span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.info(f"waiting for news feed... (Filter: {selected_region})")

with side_col:
    COUNTRIES = [
        "Select Country...",
        "United States",
        "India",
        "China",
        "United Kingdom",
        "Germany",
        "Japan",
        "Brazil",
        "Australia",
        "France",
        "Canada",
    ]

    # History
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown(
            '<div class="card-label"><i class="fas fa-history"></i> History Search</div>',
            unsafe_allow_html=True,
        )
        st.date_input("Date", label_visibility="collapsed")
        st.caption("Pick a date to load archived intelligence.")

    # Travel
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown(
            '<div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>',
            unsafe_allow_html=True,
        )
        st.selectbox("Country", COUNTRIES, label_visibility="collapsed")

    # Proximity
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown(
            '<div class="card-label"><i class="fas fa-bullseye"></i> Proximity Alerts</div>',
            unsafe_allow_html=True,
        )
        st.selectbox("Radius", ["5 KM", "10 KM", "25 KM"], label_visibility="collapsed")
        st.caption("Currently no alerts in proximity.")

st.markdown("</div>", unsafe_allow_html=True)
