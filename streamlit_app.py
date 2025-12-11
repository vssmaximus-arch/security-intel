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
# Rerun once per second so the clock (and anything else time-based) updates
st_autorefresh(interval=1000, key="live_clock_refresh")

# --------------------------------------------------------------------------
# 2. CSS STYLING
# --------------------------------------------------------------------------
st.markdown(
    """
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root { --dell-blue: #0076CE; --bg-dark: #0f1115; }

/* STREAMLIT ROOT – NO PADDING, JUST BLACK BACKGROUND */
.stApp {
    background-color: var(--bg-dark);
    font-family: 'Inter', sans-serif;
}

/* REMOVE VIEW CONTAINER PADDING */
[data-testid="stAppViewContainer"] {
    padding: 0;
}

/* MAIN WHITE CARD (APP CONTAINER) */
div.block-container {
    background-color: #fff;
    border-radius: 24px;
    min-height: calc(100vh - 48px);  /* viewport height minus 24px top/bottom */
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);

    margin: 24px;                               /* black frame all around */
    padding: 0 !important;

    width: calc(100% - 48px) !important;        /* account for 24px left+right */
    max-width: calc(100% - 48px) !important;
}

/* ------------------------------------------------------------------ */
/* HEADER ROW (FIRST HORIZONTAL BLOCK) */
/* ------------------------------------------------------------------ */
div.block-container div[data-testid="stHorizontalBlock"]:first-of-type {
    padding: 15px 32px;
    border-bottom: 1px solid #f0f0f0;
}

/* Make header columns vertically centred */
div.block-container div[data-testid="stHorizontalBlock"]:first-of-type > div[data-testid="column"] {
    display: flex;
    align-items: center;
}

/* Logo */
.logo-container {
    display: flex;
    align-items: center;
    gap: 12px;
}
.logo-icon { font-size: 1.6rem; color: #1a73e8; }
.logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
.logo-text span { color: var(--dell-blue); }

/* --- REGION PILLS: ORIGINAL STYLE (DO NOT MOVE, JUST STYLE) --- */
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
div[data-testid="stPills"] button:hover {
    background-color: rgba(0,0,0,0.05);
}
div[data-testid="stPills"] button[aria-selected="true"] {
    background-color: #202124 !important;
    color: #fff !important;
    border-radius: 6px;
}

/* Clock */
.clock-container {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    text-align: right;
}
.clock-date {
    font-weight: 600;
    color: #202124;
    white-space: nowrap;
}
.clock-time {
    font-weight: 500;
    color: #5f6368;
    white-space: nowrap;
}

/* Daily Briefings button */
.header-btn-wrap {
    width: 100%;
    display: flex;
    justify-content: flex-end;
}
.header-btn-wrap > div.stButton > button {
    background-color: #1a73e8;
    color: white !important;
    padding: 9px 18px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    border: none;
}
.header-btn-wrap > div.stButton > button:hover {
    background-color: #1557b0;
}

/* CONTENT AREA */
.content-area {
    padding: 30px;
    flex: 1;
}

/* MAP + STREAM */
.map-wrapper {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    height: 520px;
    background: #eef2f6;
    border: 1px solid #e0e0e0;
}
.map-placeholder {
    width: 100%;
    height: 100%;
    display:flex;
    align-items:center;
    justify-content:center;
    color:#5f6368;
    font-size:0.9rem;
}

.stream-section {
    margin-top: 25px;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
}
.stream-placeholder {
    margin-top: 10px;
    font-size: 0.9rem;
    color: #5f6368;
}

/* SIDEBAR CARDS */
.sidebar-col { display: flex; flex-direction: column; gap: 24px; }
.side-card {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.card-label {
    font-size: 0.95rem;
    font-weight: 700;
    color: #202124;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
}

/* Hide Streamlit chrome */
#MainMenu, footer, header {visibility: hidden;}
</style>
""",
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------
# 3. HEADER ROW (LOGO + PILLS + CLOCK + BUTTON)
# --------------------------------------------------------------------------
col_logo, col_pills, col_clock, col_button = st.columns(
    [2.5, 4.0, 2.0, 1.5],
    vertical_alignment="center",
)

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

with col_pills:
    selected_region = st.pills(
        "Region",
        options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
        default="Global",
        label_visibility="collapsed",
    )

# Live clock (recomputed each autorefresh)
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
date_str = now.strftime("%A, %d %b %Y")
time_str = now.strftime("%H:%M:%S GMT+11 UTC")

with col_clock:
    st.markdown(
        f"""
        <div class="clock-container">
            <div class="clock-date">{date_str}</div>
            <div class="clock-time">{time_str}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with col_button:
    st.markdown('<div class="header-btn-wrap">', unsafe_allow_html=True)
    st.button("📄 Daily Briefings")
    st.markdown("</div>", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 4. CONTENT AREA (MAP + SIDEBAR)
# --------------------------------------------------------------------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

left_col, right_col = st.columns([9, 3], gap="large")

with left_col:
    # Map wrapper
    st.markdown('<div class="map-wrapper mb-3">', unsafe_allow_html=True)
    st.markdown(
        f'<div class="map-placeholder">MAP PLACEHOLDER – {selected_region.upper()}</div>',
        unsafe_allow_html=True,
    )
    st.markdown("</div>", unsafe_allow_html=True)

    # Stream header + placeholder
    st.markdown(
        f"""
        <div class="stream-section">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="fw-bold">
                    <i class="fas fa-circle text-primary me-2" style="font-size:0.6rem"></i>
                    Real-time Intelligence Stream
                </div>
                <div class="badge bg-light text-secondary">CONNECTING</div>
            </div>
            <div class="stream-placeholder">
                Stream placeholder – filter: <b>{selected_region}</b>.
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with right_col:
    st.markdown(
        """
        <div class="sidebar-col">
            <div class="side-card">
                <div class="card-label"><i class="fas fa-history"></i> History Search</div>
                <div class="small text-muted">Streamlit version – hook your date picker here.</div>
            </div>
            <div class="side-card">
                <div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>
                <div class="small text-muted">Travel card placeholder.</div>
            </div>
            <div class="side-card">
                <div class="card-label"><i class="fas fa-bullseye"></i> Proximity Alerts</div>
                <div class="small text-muted">Proximity alerts placeholder.</div>
            </div>
            <div class="side-card">
                <div class="card-label"><i class="fas fa-filter"></i> Risk Category Filter</div>
                <div class="small text-muted">Risk filter placeholder.</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

st.markdown("</div>", unsafe_allow_html=True)  # close .content-area
::contentReference[oaicite:0]{index=0}
