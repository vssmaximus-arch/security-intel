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
st_autorefresh(interval=1000, key="live_clock_refresh")

# --------------------------------------------------------------------------
# 2. CSS STYLING (LOCKED & EXTENDED FOR SIDEBAR)
# --------------------------------------------------------------------------
st.markdown(
    """
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root { --dell-blue: #0076CE; --bg-dark: #0f1115; }

/* 1. GLOBAL RESET */
.stApp {
    background-color: var(--bg-dark);
    font-family: 'Inter', sans-serif;
}
[data-testid="stAppViewContainer"] { padding: 0; }

/* 2. MAIN WHITE CARD BLOCK */
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

/* 3. HEADER STYLES */
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

/* 4. CONTENT & MAP */
.content-area { padding: 30px; flex: 1; }
.map-wrapper {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    height: 520px;
    background: #eef2f6;
    border:1px solid #e0e0e0;
}
.map-placeholder {
    width: 100%; height: 100%; display:flex; align-items:center; justify-content:center;
    color:#5f6368; font-size:0.9rem;
}

/* 5. SIDEBAR CARDS (The Magic Fix) */
/* We target any Streamlit container that has our hidden 'card-marker' */
div[data-testid="stVerticalBlock"]:has(div.card-marker) {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
    margin-bottom: 24px;
    gap: 10px; /* Space between label and widget */
}

/* Sidebar Labels */
.card-label {
    font-size: 0.95rem;
    font-weight: 700;
    color: #202124;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: -10px; /* Pull widget closer */
}

/* Streamlit Widget Overrides to match design */
div[data-testid="stDateInput"] label, 
div[data-testid="stSelectbox"] label, 
div[data-testid="stMultiSelect"] label {
    display: none; /* Hide default streamlit labels */
}
div[data-testid="stDateInput"] input {
    background-color: #fff;
    border: 1px solid #dadce0;
    border-radius: 8px;
    padding-left: 10px;
}
div[data-testid="stSelectbox"] > div > div {
    background-color: #fff;
    border: 1px solid #dadce0;
    border-radius: 8px;
}

/* Hide Streamlit chrome */
#MainMenu, footer, header {visibility: hidden;}
</style>
""",
    unsafe_allow_html=True,
)

# ---------------- DATA: COUNTRIES LIST ----------------
COUNTRIES = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bolivia", "Bosnia", "Botswana", "Brazil", "Bulgaria", "Burkina Faso", "Cambodia", "Cameroon", "Canada", "Chad", "Chile", "China", "Colombia", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Korea, North", "Korea, South", "Kuwait", "Latvia", "Lebanon", "Libya", "Lithuania", "Luxembourg", "Malaysia", "Malta", "Mexico", "Moldova", "Mongolia", "Morocco", "Mozambique", "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa", "Spain", "Sri Lanka", "Sudan", "Sweden", "Switzerland", "Syria", "Taiwan", "Thailand", "Tunisia", "Turkey", "Uganda", "Ukraine", "UAE", "UK", "USA", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"]

# ---------------- HEADER ----------------
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11)))
date_str = now.strftime("%A, %d %b %Y")
time_str = now.strftime("%H:%M:%S GMT+11 UTC")

st.markdown(
    f"""
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
            <div class="clock-date" id="clock-date">{date_str}</div>
            <div id="clock-time">{time_str}</div>
        </div>
        <div class="btn-daily ms-3">
            <i class="fas fa-file-alt"></i>
            Daily Briefings
        </div>
    </div>
</div>
""",
    unsafe_allow_html=True,
)

# ---------------- CONTENT ----------------
st.markdown('<div class="content-area">', unsafe_allow_html=True)

left_col, right_col = st.columns([9, 3], gap="large")

with left_col:
    # MAP
    st.markdown('<div class="map-wrapper mb-3">', unsafe_allow_html=True)
    st.markdown('<div class="map-placeholder">MAP PLACEHOLDER</div>', unsafe_allow_html=True)
    st.markdown('</div>', unsafe_allow_html=True)

    # NEWS STREAM
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
    # --- CARD 1: HISTORY SEARCH ---
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True) # Trigger CSS
        st.markdown('<div class="card-label"><i class="fas fa-history"></i> History Search</div>', unsafe_allow_html=True)
        # Functional Streamlit Date Picker
        history_date = st.date_input("History", value=datetime.date.today(), label_visibility="collapsed")
        st.markdown('<div class="small text-muted mt-2">Pick a date to load archived intelligence.</div>', unsafe_allow_html=True)

    # --- CARD 2: TRAVEL SAFETY ---
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>', unsafe_allow_html=True)
        # Functional Country Dropdown
        selected_country = st.selectbox("Country", ["Select Country..."] + COUNTRIES, label_visibility="collapsed")
        st.markdown('<div id="travel-result"></div>', unsafe_allow_html=True)

    # --- CARD 3: PROXIMITY ALERTS ---
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown(
            """
            <div class="d-flex justify-content-between mb-2">
                <div class="card-label" style="margin:0"><i class="fas fa-bullseye"></i> Proximity</div>
                <div style="font-size:0.7rem; font-weight:700; color:#5f6368">DELL ASSET</div>
            </div>
            """, 
            unsafe_allow_html=True
        )
        # Functional Radius Selector
        radius = st.selectbox("Radius", ["5 KM (Default)", "10 KM", "25 KM", "50 KM"], label_visibility="collapsed")
        st.markdown('<div class="small text-muted text-center mt-2">Currently no alerts in proximity.</div>', unsafe_allow_html=True)

    # --- CARD 4: RISK FILTER ---
    with st.container():
        st.markdown('<div class="card-marker"></div>', unsafe_allow_html=True)
        st.markdown('<div class="card-label"><i class="fas fa-filter"></i> Risk Category</div>', unsafe_allow_html=True)
        # Functional Category Selector
        category = st.selectbox("Category", ["All Categories", "Cyber Security", "Supply Chain", "Physical Security", "Health / Safety"], label_visibility="collapsed")

st.markdown('</div>', unsafe_allow_html=True)
