import streamlit as st
import pandas as pd
import feedparser
import google.generativeai as genai
import datetime
import json

# ==========================================
# 1. CONFIGURATION & SETUP
# ==========================================
st.set_page_config(page_title="Dell Global SRO Intel", layout="wide", page_icon="🛡️")

# --- AUTHENTICATION ---
# Replace with your actual Key from Google AI Studio
GOOGLE_API_KEY = "PASTE_YOUR_GOOGLE_AI_STUDIO_KEY_HERE" # User will need to replace this
try:
    genai.configure(api_key=GOOGLE_API_KEY)
except Exception as e:
    st.error(f"Failed to configure Google Generative AI: {e}. Please ensure your API key is correct.")

# --- STYLE OVERRIDES ---
# Merging common Streamlit customization with a custom dark theme based on the existing /content/streamlit_app.py and general dark theme aesthetics.
st.markdown("""
<style>
    /* General App Styling */
    .stApp {
        background-color: #1a1a2e; /* Darker background */
        color: #e0e0e0; /* Light gray text */
        font-family: 'Segoe UI', sans-serif; /* Modern font */
    }

    /* Header Styling */
    h1 {
        color: #00bcd4; /* Cyan for main title */
        font-size: 2.5em;
        margin-bottom: 0.2em;
    }
    h2, h3, h4, h5, h6 {
        color: #00bcd4; /* Cyan for subheaders */
    }
    /* Targeting Streamlit's internal header components for consistent styling */
    .st-emotion-cache-zt5ig8 {
        color: #00bcd4;
    }


    /* Metrics Styling */
    div[data-testid="stMetric"] {
        background-color: #2c2c54; /* Slightly lighter dark card background */
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 15px;
        border: 1px solid #3a3a6e; /* Subtle border */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    div[data-testid="stMetricLabel"] {
        color: #a0a0a0; /* Lighter gray for metric labels */
        font-size: 0.9em;
        font-weight: normal;
    }
    div[data-testid="stMetricValue"] {
        font-size: 1.8em; /* Slightly larger value */
        color: #f0f0f0; /* White for values */
        font-weight: bold;
    }
    div[data-testid="stMetricDelta"] {
        color: #4CAF50; /* Green for positive delta */
    }
    div[data-testid="stMetricDelta"][data-delta-type="inverse"] {
        color: #F44336; /* Red for inverse delta */
    }

    /* Card Styling for Alerts */
    .critical-card, .warning-card, .info-card {
        background-color: #2c2c54; /* Consistent card background */
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 10px;
        border-left: 5px solid; /* Defined by specific class */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    .critical-card { border-left-color: #e60000; } /* Darker red */
    .warning-card { border-left-color: #ff9800; } /* Orange */
    .info-card { border-left-color: #2196f3; } /* Blue for info */
    .critical-card strong, .warning-card strong, .info-card strong {
        color: #e0e0e0;
    }
    .critical-card span, .warning-card span, .info-card span {
        color: #f0f0f0;
    }

    /* Sidebar Styling */
    /* Specific targeting for Streamlit's sidebar container and elements */
    .st-emotion-cache-vk33i4 {
        background-color: #1a1a2e;
        border-right: 1px solid #3a3a6e;
    }
    .st-emotion-cache-1lcbm6a {
        color: #00bcd4;
    }
    .st-emotion-cache-1gxk71f {
        background-color: #2c2c54;
        border-radius: 5px;
        border: 1px solid #3a3a6e;
        color: #e0e0e0;
    }
    .st-emotion-cache-1gxk71f > div > label > div > p {
        color: #e0e0e0;
    }
    .st-emotion-cache-1gxk71f .st-emotion-cache-l9bibb {
        color: #00bcd4;
    }

    /* Button Styling */
    .st-emotion-cache-tvzdfc {
        background-color: #00bcd4;
        color: black;
        border-radius: 5px;
        border: none;
        padding: 8px 15px;
        font-weight: bold;
        transition: background-color 0.3s;
    }
    .st-emotion-cache-tvzdfc:hover {
        background-color: #00e5ff;
    }

    /* Other elements */
    .st-emotion-cache-p5m047 {
        background-color: #2c2c54;
        border-left: 5px solid #2196f3;
        border-radius: 8px;
        padding: 10px;
        color: #e0e0e0;
    }
    .st-emotion-cache-1wmy9hv p {
        color: #e0e0e0;
    }

    /* Markdown text */
    p {
        color: #e0e0e0;
    }

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
            # Fetch more entries to increase the chance of finding relevant ones
            for entry in f.entries[:10]: # Increased from 3 to 10
                raw_items.append(f"Title: {entry.title}. Link: {entry.link}. Summary: {getattr(entry, 'summary', '')}")
        except Exception as e:
            st.warning(f"Could not parse feed {url}: {e}")
            continue

    # 2. FILTER WITH GEMINI (If Key Exists)
    if "PASTE_YOUR" not in GOOGLE_API_KEY:
        prompt = f"""
        You are a Security Analyst for Dell. Analyze these news items.
        Return ONLY items that pose a direct physical or cyber risk to Dell's operations or employees globally.
        Output your response as a JSON array of dictionaries, with each dictionary having the following keys:
        'title': (string, original title of the news item)
        'risk': (string, either 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW' based on severity. Focus on CRITICAL/HIGH as per user instructions.)
        'type': (string, either 'Cyber' or 'Physical' or 'Geopolitical' or 'Logistics')
        'description': (string, a brief 1-2 sentence summary of why this is a risk for Dell)

        Example Output format:
        [
            {{
                "title": "Severe weather disrupts European logistics",
                "risk": "HIGH",
                "type": "Logistics",
                "description": "Heavy snow and ice across Europe are causing significant delays in shipping and transportation, potentially impacting Dell's supply chain and timely product delivery."
            }},
            {{
                "title": "New ransomware variant targets manufacturing sector",
                "risk": "CRITICAL",
                "type": "Cyber",
                "description": "A sophisticated ransomware strain is actively exploiting vulnerabilities in industrial control systems, posing an immediate threat to Dell's manufacturing operations and data integrity."
            }}
        ]

        Here are the news items:
        {raw_items}
        """
        try:
            model = genai.GenerativeModel('gemini-1.5-flash')
            response = model.generate_content(prompt)
            # Attempt to parse the JSON string from the response
            # Sometimes Gemini might wrap JSON in markdown code block
            response_text = response.text.strip()
            if response_text.startswith("```json") and response_text.endswith("```"):
                response_text = response_text[7:-3].strip()

            alerts = json.loads(response_text)
            return alerts
        except Exception as e:
            st.error(f"Error calling Gemini or parsing response: {e}. Raw response: {response.text if 'response' in locals() else 'No response'}")
            return []
    return []

# ==========================================
# 3. DASHBOARD UI
# ==========================================

# --- HEADER ---
# Using columns for title and refresh button
c1, c2 = st.columns([0.7, 0.3]) # Adjusted column ratio for title
with c1:
    st.title("🛡️ Dell Global Security Intelligence")
    st.caption(f"System Status: LIVE | Agent Model: Gemini 1.5 Flash | Time: {datetime.datetime.now().strftime('%H:%M:%S UTC')}") # Added seconds for more real-time feel
with c2:
    st.markdown("<div style='text-align: right; margin-top: 25px;'>", unsafe_allow_html=True) # Align button to right and lower it slightly
    if st.button("🔄 Force Refresh", key="refresh_button"):
        st.cache_data.clear()
        st.experimental_rerun() # Rerun the app to fetch new data
    st.markdown("</div>", unsafe_allow_html=True)


# --- METRICS ---
# The layout is already 4 columns. Enhancing the metrics display with custom CSS.
m1, m2, m3, m4 = st.columns(4)
# Dummy data for metrics, as there's no live data source for these counts in the current script
m1.metric("Active Critical Threats", "3", "+1")
m2.metric("Global Risk Level", "ELEVATED", delta_color="inverse")
m3.metric("Dell Sites Monitored", "42")
m4.metric("AI Scanned Articles", "1,204") # This could be dynamically updated by ai_security_agent if we count raw_items


# --- MAIN CONTENT ---
col_map, col_feed = st.columns([2, 1])

with col_map:
    st.subheader("📍 Global Asset Risk Map")
    map_data = pd.DataFrame({
        'lat': [30.5083, 1.3521, 51.8985, 12.9716, 34.0522, 40.7128, -23.5505, 35.6895], # Added more locations for a richer map
        'lon': [-97.6788, 103.8198, -8.4756, 77.5946, -118.2437, -74.0060, -46.6333, 139.6917],
        'site': ['Austin HQ', 'Singapore', 'Cork', 'Bangalore', 'Los Angeles', 'New York', 'São Paulo', 'Tokyo'],
        'risk': [100, 500, 200, 800, 300, 600, 400, 700] # Risk values can be dynamic
    })
    # Adjusted zoom for better global view with more points
    st.map(map_data, zoom=1, size='risk', color='#e60000') # Using critical red for map points

with col_feed:
    st.subheader("⚡ AI Curated Intel Feed")

    alerts = ai_security_agent() # Call the AI agent to get alerts

    # SIMULATION MODE (Triggers if no API Key or AI call fails)
    if not alerts: # If alerts list is empty (due to API key or error)
        st.warning("⚠️ AI Agent needs API Key or encountered an error. Showing Simulation.")
        alerts = [
            {"title": "Typhoon Approaching Xiamen Mfg Zone, Supply Chain Impact Expected", "risk": "CRITICAL", "type": "Physical", "description": "A category 4 typhoon is on a direct path to Xiamen, threatening Dell's manufacturing facilities and causing potential disruptions to global supply chains."},
            {"title": "New Ransomware Group Exploiting Zero-Day in Common ERP Software", "risk": "CRITICAL", "type": "Cyber", "description": "An emerging ransomware group is actively leveraging a critical zero-day vulnerability in widely used ERP systems, posing an immediate and severe threat to corporate data and operations."},
            {"title": "Geopolitical Tensions Escalate in East Asia, Risking Trade Routes", "risk": "HIGH", "type": "Geopolitical", "description": "Increased military activities and diplomatic disputes in East Asia are raising concerns about the stability of key shipping lanes and trade agreements, potentially affecting Dell's logistics and market access."},
            {"title": "Major Port Strikes Imminent Across European Hubs", "risk": "HIGH", "type": "Logistics", "description": "Unions at several major European ports are threatening widespread strikes over wage disputes, which could severely impact cargo movement and cause significant delays for Dell's inbound and outbound shipments."},
            {"title": "Cyberattack on Global Satellite Communication Provider Reported", "risk": "MEDIUM", "type": "Cyber", "description": "A prominent satellite communication provider, used by various industries, has reported a cyberattack, potentially disrupting global communication services vital for Dell's remote operations and data transfers."},
        ]

    for alert in alerts:
        color_class = "critical-card" if alert['risk'] == "CRITICAL" else \
                      "warning-card" if alert['risk'] == "HIGH" else \
                      "info-card" # Add a default info card for other risks

        # Ensure 'description' key exists, provide a fallback if not
        description = alert.get('description', 'No detailed description available.')

        st.markdown(f"""
        <div class=\"{color_class}\">
            <strong style=\"color:white;\">[{alert['risk']}] {alert['type']}</strong><br>
            <span style=\"font-size:1.1em; font-weight:bold;\">{alert['title']}</span><br>
            <span style=\"font-size:0.9em; color:#a0a0a0;\">{description}</span>
        </div>
        """, unsafe_allow_html=True)

# --- SIDEBAR ---
with st.sidebar:
    st.header("SRO Controls")
    st.selectbox("Filter Region", ["Global", "AMER", "EMEA", "APJC", "LATAM"], key="region_filter") # Added LATAM
    st.multiselect("Risk Types", ["Physical", "Cyber", "Geopolitical", "Logistics"], default=["Physical", "Cyber"], key="risk_type_filter") # Added Geopolitical, Logistics
    st.slider("Minimum Risk Level", 0, 100, 50, key="risk_level_slider") # Added a slider for filtering
    st.divider()
    st.info("🔒 Secure Connection: Localhost")
    st.markdown("<p style='font-size: 0.8em; color: #888888; text-align: center;'>Powered by Streamlit & Google Gemini</p>", unsafe_allow_html=True)
