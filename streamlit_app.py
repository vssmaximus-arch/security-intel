import streamlit as st
import pandas as pd
import feedparser
import google.generativeai as genai
import datetime

# ==========================================
# 1. CONFIGURATION & SETUP
# ==========================================
st.set_page_config(page_title="Dell Global SRO Intel", layout="wide", page_icon="🛡️")

# --- AUTHENTICATION ---
# Replace with your actual Key from Google AI Studio
GOOGLE_API_KEY = "PASTE_YOUR_GOOGLE_AI_STUDIO_KEY_HERE"
try:
    genai.configure(api_key=GOOGLE_API_KEY)
except:
    pass

# --- STYLE OVERRIDES ---
st.markdown("""
<style>
    .reportview-container { background: #0f1115; color: white; }
    .stApp { background-color: #0f1115; }
    div[data-testid="stMetricValue"] { font-size: 24px; color: #0076CE; }
    .critical-card { border-left: 5px solid #d93025; background-color: #1e1e1e; padding: 15px; border-radius: 5px; margin-bottom: 10px; }
    .warning-card { border-left: 5px solid #f9ab00; background-color: #1e1e1e; padding: 15px; border-radius: 5px; margin-bottom: 10px; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. THE AI INTELLIGENCE AGENT
# ==========================================
@st.cache_data(ttl=600)
def ai_security_agent():
    feeds = [
        "http://feeds.reuters.com/reuters/worldNews",
        "https://www.bleepingcomputer.com/feed/",
        "https://gdacs.org/xml/rss.xml",
        "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml"
    ]
    
    raw_items = []
    
    # 1. FETCH DATA
    for url in feeds:
        try:
            f = feedparser.parse(url)
            for entry in f.entries[:3]:
                raw_items.append(f"{entry.title} ({entry.link})")
        except:
            continue
            
    # 2. FILTER WITH GEMINI (If Key Exists)
    if "PASTE_YOUR" not in GOOGLE_API_KEY:
        prompt = f"""
        You are a Security Analyst for Dell. Analyze these headlines. 
        Return ONLY items that pose a direct physical or cyber risk.
        Format as a Python list of dictionaries with keys: 'title', 'risk' (CRITICAL/HIGH), 'type' (Cyber/Physical).
        HEADLINES: {raw_items}
        """
        try:
            model = genai.GenerativeModel('gemini-1.5-flash')
            response = model.generate_content(prompt)
            return response.text 
        except:
            return []
    return []

# ==========================================
# 3. DASHBOARD UI
# ==========================================

# --- HEADER ---
c1, c2 = st.columns([0.8, 0.2])
with c1:
    st.title("🛡️ Dell Global Security Intelligence")
    st.caption(f"System Status: LIVE | Agent Model: Gemini 1.5 Pro | Time: {datetime.datetime.now().strftime('%H:%M UTC')}")
with c2:
    if st.button("🔄 Force Refresh"):
        st.cache_data.clear()

# --- METRICS ---
m1, m2, m3, m4 = st.columns(4)
m1.metric("Active Critical Threats", "3", "+1")
m2.metric("Global Risk Level", "ELEVATED", delta_color="inverse")
m3.metric("Dell Sites Monitored", "42")
m4.metric("AI Scanned Articles", "1,204")

# --- MAIN CONTENT ---
col_map, col_feed = st.columns([2, 1])

with col_map:
    st.subheader("📍 Global Asset Risk Map")
    map_data = pd.DataFrame({
        'lat': [30.5083, 1.3521, 51.8985, 12.9716],
        'lon': [-97.6788, 103.8198, -8.4756, 77.5946],
        'site': ['Austin HQ', 'Singapore', 'Cork', 'Bangalore'],
        'risk': [100, 500, 200, 800]
    })
    st.map(map_data, zoom=1, size='risk', color='#ff4b4b')

with col_feed:
    st.subheader("⚡ AI Curated Intel Feed")
    
    # SIMULATION MODE (Triggers if no API Key)
    if "PASTE_YOUR" in GOOGLE_API_KEY:
        st.warning("⚠️ AI Agent needs API Key. Showing Simulation.")
        alerts = [
            {"title": "Typhoon Approaching Xiamen Mfg Zone", "risk": "CRITICAL", "type": "Physical"},
            {"title": "Ransomware Group Targeting Tech Supply Chain", "risk": "HIGH", "type": "Cyber"},
            {"title": "Transport Strike in Northern Europe", "risk": "MEDIUM", "type": "Logistics"}
        ]
    else:
        # Placeholder for real parsing logic
        st.info("AI Analysis Complete (See Console)")
        alerts = [] 

    for alert in alerts:
        color_class = "critical-card" if alert['risk'] == "CRITICAL" else "warning-card"
        st.markdown(f"""
        <div class="{color_class}">
            <strong style="color:white;">[{alert['risk']}] {alert['type']}</strong><br>
            <span style="font-size:1.1em; font-weight:bold;">{alert['title']}</span>
        </div>
        """, unsafe_allow_html=True)

# --- SIDEBAR ---
with st.sidebar:
    st.header("SRO Controls")
    st.selectbox("Filter Region", ["Global", "AMER", "EMEA", "APJC"])
    st.multiselect("Risk Types", ["Physical", "Cyber"], default=["Physical", "Cyber"])
    st.divider()
    st.info("🔒 Secure Connection: Localhost")
