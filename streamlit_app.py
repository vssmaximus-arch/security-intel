import streamlit as st
import datetime

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
# 2. CSS STYLING (LOCKED)
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

/* REMOVE VIEW CONTAINER PADDING AS WELL */
[data-testid="stAppViewContainer"] {
    padding: 0;
}

/* USE block-container AS THE WHITE CARD, WITH UNIFORM 24PX MARGIN */
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

/* --- HEADER ------------------------------------------------- */
.header-container {
    padding: 15px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #f0f0f0;
    height: 70px;
}
.header-left { display: flex; align-items: center; gap:12px; }
.logo-icon { font-size: 1.6rem; color: #1a73e8; }
.logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; }
.logo-text span { color: var(--dell-blue); }
.header-right { display: flex; align-items: center; gap: 20px; }

.nav-pills-custom {
    background-color: #f1f3f4;
    padding: 4px;
    border-radius: 10px;
    display: flex;
    gap: 2px;
}
.nav-item-custom {
    padding: 7px 18px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 0.8rem;
    color: #5f6368;
    cursor: pointer;
    text-decoration: none;
    text-transform: uppercase;
}
.nav-item-custom.active { background-color: #202124; color: #fff; }

.clock-container { display: flex; flex-direction: column; font-size: 0.85rem; text-align: right; }
.clock-date { font-weight: 600; color: #202124; white-space: nowrap; }
#clock-time { font-weight: 500; color: #5f6368; white-space: nowrap; }

.btn-daily {
    background-color: #1a73e8;
    color: white;
    padding: 9px 18px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    display: flex;
    gap:8px;
    align-items: center;
    border: none;
}

/* --- CONTENT AREA ------------------------------------------- */
.content-area {
    padding: 30px;
    flex: 1;
}

.map-wrapper {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    height: 520px;
    background: #eef2f6;
    border:1px solid #e0e0e0;
}
.stream-section {
    margin-top: 25px;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
}

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

.map-placeholder {
    width: 100%;
    height: 100%;
    display:flex;
    align-items:center;
    justify-content:center;
    color:#5f6368;
    font-size:0.9rem;
}
.stream-placeholder {
    margin-top: 10px;
    font-size: 0.9rem;
    color: #5f6368;
}

/* Hide Streamlit chrome */
#MainMenu, footer, header {visibility: hidden;}
</style>
""",
    unsafe_allow_html=True,
)

# ---------------- HEADER (REAL-TIME CLOCK) ----------------
st.markdown(
    """
<div class="header-container">
    <div class="header-left">
        <div class="logo-icon"><i class="fas fa-shield-alt"></i></div>
        <div class="logo-text">OS <span>INFOHUB</span></div>
    </div>
    <div class="header-right">
        <div class="nav-pills-custom">
            <a class="nav-item-custom active">Global</a>
            <a class="nav-item-custom">AMER</a>
            <a class="nav-item-custom">EMEA</a>
            <a class="nav-item-custom">APJC</a>
            <a class="nav-item-custom">LATAM</a>
        </div>
        <div class="clock-container ms-3">
            <div class="clock-date" id="clock-date">Loading...</div>
            <div id="clock-time">--:--:-- UTC</div>
        </div>
        <div class="btn-daily ms-3">
            <i class="fas fa-file-alt"></i>
            Daily Briefings
        </div>
    </div>
</div>

<script>
    function startRealTimeClock() {
        const dateEl = document.getElementById('clock-date');
        const timeEl = document.getElementById('clock-time');
        
        function update() {
            const now = new Date();
            
            // Format Date: "Thursday, 11 Dec 2025"
            const dateOptions = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
            const dateStr = now.toLocaleDateString('en-GB', dateOptions);
            
            // Format Time: "17:30:45"
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            
            // Calculate GMT Offset automatically (e.g., GMT+11)
            const offset = -now.getTimezoneOffset();
            const sign = offset >= 0 ? '+' : '-';
            const hoursOffset = String(Math.floor(Math.abs(offset) / 60));
            const tzString = 'GMT' + sign + hoursOffset;
            
            if(dateEl) dateEl.innerText = dateStr;
            if(timeEl) timeEl.innerText = `${h}:${m}:${s} ${tzString} UTC`;
        }
        
        update(); // Run immediately
        setInterval(update, 1000); // Update every second
    }
    
    // Slight delay to ensure DOM elements exist
    setTimeout(startRealTimeClock, 50);
</script>
""",
    unsafe_allow_html=True,
)

# ---------------- CONTENT ----------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

left_col, right_col = st.columns([9, 3], gap="large")

with left_col:
    st.markdown('<div class="map-wrapper mb-3">', unsafe_allow_html=True)
    st.markdown('<div class="map-placeholder">MAP PLACEHOLDER</div>', unsafe_allow_html=True)
    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown('<div class="stream-section">', unsafe_allow_html=True)
    st.markdown(
        """
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div class="fw-bold">
                <i class="fas fa-circle text-primary me-2" style="font-size:0.6rem"></i>
                Real-time Intelligence Stream
            </div>
            <div class="badge bg-light text-secondary">CONNECTING</div>
        </div>
        <div class="stream-placeholder">
            Stream placeholder – plug your feed here.
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown('</div>', unsafe_allow_html=True)

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

st.markdown('</div>', unsafe_allow_html=True)
