import datetime
import streamlit as st
from streamlit_autorefresh import st_autorefresh

# ---------------------------------------------------------
# 1. PAGE CONFIG
# ---------------------------------------------------------
st.set_page_config(
    page_title="SRO Intelligence",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Live clock refresh
st_autorefresh(interval=1000, key="sro_clock_refresh")

# ---------------------------------------------------------
# 2. GLOBAL CSS – FRAME + THEME + COMPONENTS
# ---------------------------------------------------------
st.markdown(
    """
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
    --sro-blue: #0076CE;
    --accent-blue: #1a73e8;
    --bg-dark: #0f1115;
    --critical-red: #d93025;
    --warning-amber: #f9ab00;
}

/* App background */
.stApp {
    background-color: var(--bg-dark);
    font-family: 'Inter', sans-serif;
}

/* Remove padding around view container */
[data-testid="stAppViewContainer"] {
    padding: 0;
}

/* Main white card */
div.block-container {
    background-color: #ffffff;
    border-radius: 24px;
    min-height: calc(100vh - 48px);
    margin: 24px;
    padding: 0 !important;
    width: calc(100% - 48px) !important;
    max-width: calc(100% - 48px) !important;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.45);
}

/* Hide Streamlit chrome */
#MainMenu, footer, header {visibility: hidden;}

/* ----------------------------------------------------- */
/* HEADER                                                 */
/* ----------------------------------------------------- */
.header-row {
    padding: 14px 28px;
    border-bottom: 1px solid #f0f0f0;
}

/* Make first horizontal block into flex header strip */
div.block-container div[data-testid="stHorizontalBlock"]:first-of-type {
    padding: 0 28px;
    border-bottom: 1px solid #f0f0f0;
}

/* Logo */
.logo-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
}
.logo-icon {
    font-size: 1.4rem;
    color: var(--accent-blue);
}
.logo-text {
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: -0.4px;
    color: #202124;
}
.logo-text span {
    color: var(--sro-blue);
}

/* Region pills – based on st.pills */
div[data-testid="stPills"] {
    background-color: #f1f3f4 !important;
    padding: 4px !important;
    border-radius: 999px !important;
    display: inline-flex !important;
    gap: 0;
}
div[data-testid="stPills"] button {
    background: transparent !important;
    border: none !important;
    color: #5f6368 !important;
    font-weight: 700 !important;
    font-size: 0.78rem !important;
    text-transform: uppercase !important;
    padding: 6px 18px !important;
    border-radius: 999px !important;
    line-height: 1.1 !important;
}
div[data-testid="stPills"] button:hover {
    background-color: rgba(0,0,0,0.05) !important;
}
div[data-testid="stPills"] button[aria-selected="true"] {
    background-color: #202124 !important;
    color: #ffffff !important;
}

/* Clock */
.clock-container {
    text-align: right;
    font-size: 0.82rem;
    line-height: 1.25;
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

/* Daily briefings button */
.header-btn-wrap {
    display: flex;
    justify-content: flex-end;
    width: 100%;
}
.header-btn-wrap > div.stButton > button {
    background-color: var(--accent-blue) !important;
    color: #ffffff !important;
    border-radius: 999px;
    border: none;
    font-weight: 600;
    font-size: 0.86rem;
    padding: 8px 18px;
}
.header-btn-wrap > div.stButton > button:hover {
    background-color: #1557b0 !important;
}

/* ----------------------------------------------------- */
/* CONTENT LAYOUT                                         */
/* ----------------------------------------------------- */
.content-area {
    padding: 22px 24px 28px 24px;
}

/* Map wrapper */
.map-wrapper {
    border-radius: 16px;
    border: 1px solid #e0e0e0;
    overflow: hidden;
    height: 520px;
    background-color: #eef2f6;
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

/* Asset monitoring card on map */
.asset-overlay {
    position: absolute;
    left: 22px;
    bottom: 20px;
    background: #ffffff;
    border-radius: 14px;
    border: 1px solid #e0e0e0;
    padding: 12px 14px;
    font-size: 0.8rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}
.asset-header {
    font-size: 0.7rem;
    text-transform: uppercase;
    font-weight: 700;
    color: #a0a6ad;
}
.asset-row {
    margin-top: 6px;
    display:flex;
    align-items:center;
    gap:6px;
}
.asset-row i {
    color: var(--accent-blue);
}
.asset-badge {
    margin-left: auto;
    font-size: 0.68rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: #ffe6d5;
    color: #d35400;
    font-weight: 700;
}

/* Right column cards */
.side-card {
    background: #ffffff;
    border-radius: 16px;
    border: 1px solid #e0e0e0;
    padding: 18px 18px 16px 18px;
    margin-bottom: 18px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}
.side-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: #202124;
    display:flex;
    align-items:center;
    gap:8px;
}
.side-title i {
    color:#5f6368;
}

/* Proximity alerts card specifics */
.prox-header-top {
    display:flex;
    justify-content: space-between;
    align-items:flex-start;
}
.prox-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    color:#a0a6ad;
    font-weight:700;
}
.prox-title-link {
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--accent-blue);
    line-height:1.15;
}
.badge-test-only {
    font-size:0.7rem;
    padding:2px 8px;
    border-radius:999px;
    background:#fff7e0;
    color:#b37400;
    font-weight:700;
}
.prox-radius-select {
    margin-top:8px;
}

/* Proximity alert rows */
.prox-alert-row {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #f1f3f4;
    font-size: 0.82rem;
}
.prox-alert-main {
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom: 2px;
}
.prox-alert-main span {
    font-weight:700;
}
.prox-alert-main .distance {
    color:#d93025;
    font-size:0.78rem;
}
.prox-alert-meta {
    font-size:0.78rem;
    color:#5f6368;
}

/* ----------------------------------------------------- */
/* STREAM SECTION                                         */
/* ----------------------------------------------------- */
.stream-header {
    margin-top: 14px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    font-size:0.9rem;
}
.stream-header-left {
    display:flex;
    align-items:center;
    gap:8px;
    font-weight:700;
}
.stream-header-left i {
    font-size:0.55rem;
}
.badge-stream-note {
    font-size:0.7rem;
    padding:2px 8px;
    border-radius:4px;
    background:#e3f2fd;
    color:#1565c0;
    font-weight:700;
}
.stream-header-right {
    font-size:0.78rem;
    display:flex;
    gap:16px;
}
.stream-header-right a {
    text-decoration:none;
    color:#5f6368;
    font-weight:600;
}

/* Critical banner */
.critical-banner {
    margin-top: 10px;
    padding: 12px 14px;
    border-radius: 8px;
    border-left:4px solid var(--critical-red);
    background:#fde7e6;
    font-size:0.82rem;
    display:flex;
    align-items:center;
    gap:10px;
}
.critical-banner i {
    color:var(--critical-red);
}

/* Feed cards */
.feed-card {
    margin-top:10px;
    background:#ffffff;
    border-radius: 10px;
    border:1px solid #e0e0e0;
    display:flex;
    overflow:hidden;
    box-shadow:0 2px 4px rgba(0,0,0,0.03);
}
.feed-status-bar {
    width:4px;
    background:var(--warning-amber);
}
.feed-status-bar.crit { background: var(--critical-red); }
.feed-content {
    padding: 10px 14px 12px 14px;
    width:100%;
}
.feed-tags {
    display:flex;
    gap:6px;
    font-size:0.7rem;
    margin-bottom:4px;
}
.feed-tag {
    padding:2px 8px;
    border-radius:999px;
    border:1px solid #eee;
    font-weight:700;
    text-transform:uppercase;
}
.feed-tag.warn { background:#fff7e0; color:#b37400; }
.feed-tag.crit { background:#fce8e6; color:#b3261e; }
.feed-tag.type { background:#f1f3f4; color:#5f6368; }
.feed-tag.region { background:#e3f2fd; color:#1565c0; }

.feed-title {
    font-size:0.92rem;
    font-weight:700;
    color:#202124;
    margin-bottom:4px;
}
.feed-meta {
    font-size:0.75rem;
    color:#5f6368;
    margin-bottom:4px;
}
.feed-desc {
    font-size:0.8rem;
    color:#3c4043;
}
</style>
""",
    unsafe_allow_html=True,
)

# ---------------------------------------------------------
# 3. HEADER ROW (LOGO | PILLS | CLOCK | BUTTON)
# ---------------------------------------------------------
header_logo_col, header_center_col, header_right_col = st.columns(
    [2.4, 5.2, 2.4],
    vertical_alignment="center",
)

with header_logo_col:
    st.markdown(
        """
        <div class="logo-wrap">
            <span class="logo-icon"><i class="fas fa-shield-alt"></i></span>
            <span class="logo-text">SRO <span>INTELLIGENCE</span></span>
        </div>
        """,
        unsafe_allow_html=True,
    )

with header_center_col:
    # Region selector
    selected_region = st.pills(
        "Region",
        options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
        default="GLOBAL",
        label_visibility="collapsed",
    )

with header_right_col:
    c_clock, c_btn = st.columns([1.4, 1.2], vertical_alignment="center")

    with c_clock:
        now = datetime.datetime.now(datetime.timezone.utc)
        # Example offset +11; adjust as needed
        offset_hours = 11
        now_offset = now + datetime.timedelta(hours=offset_hours)
        date_str = now_offset.strftime("%A, %b %d, %Y")
        time_str = now_offset.strftime("%I:%M %p GMT+11")

        st.markdown(
            f"""
            <div class="clock-container">
                <div class="clock-date">{date_str}</div>
                <div class="clock-time">{time_str}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    with c_btn:
        st.markdown('<div class="header-btn-wrap">', unsafe_allow_html=True)
        st.button("📄 Daily Briefings")
        st.markdown("</div>", unsafe_allow_html=True)

# ---------------------------------------------------------
# 4. CONTENT
# ---------------------------------------------------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

main_col, side_col = st.columns([8.2, 3.8], gap="large")

# ---------------- LEFT MAIN: MAP + STREAM ----------------
with main_col:
    # Map
    st.markdown(
        """
        <div class="map-wrapper" style="position:relative;">
            <div class="map-placeholder">
                MAP PLACEHOLDER (Leaflet / Mapbox / etc.)
            </div>
            <div class="asset-overlay">
                <div class="asset-header">Asset Monitoring</div>
                <div class="asset-row">
                    <i class="fas fa-building"></i> <span>Dell Key Facilities</span>
                </div>
                <div class="asset-row">
                    <i class="fas fa-bullseye"></i> <span>Proximity Risk</span>
                    <span class="asset-badge">TEST ALERTS</span>
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Stream header
    st.markdown(
        """
        <div class="stream-header">
            <div class="stream-header-left">
                <i class="fas fa-circle text-primary"></i>
                <span>Real-time Intelligence Stream</span>
                <span class="badge-stream-note">TEST DATA – PLACEHOLDER ONLY</span>
            </div>
            <div class="stream-header-right">
                <a href="#">CONFIGURE SOURCES</a>
                <a href="#">VIEW FULL STREAM →</a>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Critical banner
    st.markdown(
        """
        <div class="critical-banner">
            <i class="fas fa-exclamation-triangle"></i>
            <span>CISA Adds Actively Exploited XSS Bug CVE-2021-26829 in OpenPLC ScadaBR to KEV.</span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Warning feed card
    st.markdown(
        """
        <div class="feed-card">
            <div class="feed-status-bar"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="feed-tag warn">Warning</span>
                    <span class="feed-tag type">General</span>
                    <span class="feed-tag region">AMER</span>
                </div>
                <div class="feed-title">
                    CISA Adds Actively Exploited XSS Bug CVE-2021-26829 in OpenPLC ScadaBR to KEV
                </div>
                <div class="feed-meta">
                    thehackernews.com • 2025-11-30T09:23:00+00:00
                </div>
                <div class="feed-desc">
                    The U.S. Cybersecurity and Infrastructure Security Agency (CISA) has updated its
                    Known Exploited Vulnerabilities (KEV) catalog to include a security flaw impacting
                    OpenPLC ScadaBR, citing evidence of active exploitation in the wild.
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Critical feed card
    st.markdown(
        """
        <div class="feed-card">
            <div class="feed-status-bar crit"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="feed-tag crit">Critical</span>
                    <span class="feed-tag type">General</span>
                    <span class="feed-tag region">APJC</span>
                </div>
                <div class="feed-title">
                    Example critical incident headline placeholder across multiple regions
                </div>
                <div class="feed-meta">
                    example.com • 2025-11-30T06:00:00+00:00
                </div>
                <div class="feed-desc">
                    Placeholder text for a second incident entry. Plug your real feed logic here
                    and render cards dynamically from your data source.
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

# ---------------- RIGHT SIDEBAR ----------------
with side_col:
    # History Search
    with st.container():
        st.markdown(
            """
            <div class="side-card">
                <div class="side-title">
                    <i class="fas fa-history"></i> <span>History Search</span>
                </div>
            """,
            unsafe_allow_html=True,
        )
        st.date_input("History date", key="history_date", label_visibility="collapsed")
        st.markdown(
            '<div style="font-size:0.75rem;color:#84888f;margin-top:6px;">'
            "Pick a date to load archived intelligence (simulated).</div></div>",
            unsafe_allow_html=True,
        )

    # Travel Safety
    with st.container():
        st.markdown(
            """
            <div class="side-card">
                <div class="side-title">
                    <i class="fas fa-plane"></i> <span>Travel Safety Check</span>
                </div>
            """,
            unsafe_allow_html=True,
        )
        st.selectbox(
            "Travel country",
            ["Select Country...", "United States", "India", "China", "Germany", "Australia"],
            index=0,
            key="travel_country",
            label_visibility="collapsed",
        )
        st.markdown(
            '<div style="font-size:0.75rem;color:#84888f;margin-top:6px;">'
            "Simulated advisory content placeholder.</div></div>",
            unsafe_allow_html=True,
        )

    # Proximity Alerts
    with st.container():
        st.markdown(
            """
            <div class="side-card">
                <div class="prox-header-top">
                    <div>
                        <div class="prox-label">Dell Asset</div>
                        <div class="prox-title-link">Proximity<br>Alerts</div>
                    </div>
                    <div class="badge-test-only">TEST ONLY</div>
                </div>
            """,
            unsafe_allow_html=True,
        )

        st.selectbox(
            "Radius",
            ["5 KM (Default)", "10 KM", "25 KM", "50 KM"],
            index=0,
            key="prox_radius",
            label_visibility="collapsed",
        )

        st.markdown(
            """
            <div class="prox-alert-row">
                <div class="prox-alert-main">
                    <span><i class="fas fa-fire-alt" style="color:#d93025;margin-right:6px;"></i>Industrial Fire [TEST]</span>
                    <span class="distance">3.2km</span>
                </div>
                <div class="prox-alert-meta">
                    Dell Xiamen Mfg – TEST: example incident near manufacturing site.
                </div>
            </div>

            <div class="prox-alert-row">
                <div class="prox-alert-main">
                    <span><i class="fas fa-bolt" style="color:#f9ab00;margin-right:6px;"></i>Grid Instability [TEST]</span>
                    <span class="distance">1.5km</span>
                </div>
                <div class="prox-alert-meta">
                    Dell Bangalore Campus – TEST: rolling brownouts affecting Electronic City Phase 1.
                </div>
            </div>

            <div class="prox-alert-row">
                <div class="prox-alert-main">
                    <span><i class="fas fa-water" style="color:#4285f4;margin-right:6px;"></i>Flash Flood [TEST]</span>
                    <span class="distance">4.8km</span>
                </div>
                <div class="prox-alert-meta">
                    Dell Nashville Hub – TEST: example river flooding scenario.
                </div>
            </div>

            <div style="text-align:right;margin-top:10px;font-size:0.75rem;font-weight:600;">
                <a href="#" style="text-decoration:none;color:#1a73e8;">VIEW ALL ALERTS (TEST)</a>
            </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

st.markdown("</div>", unsafe_allow_html=True)  # end .content-area
