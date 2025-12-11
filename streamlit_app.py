import streamlit as st
import datetime

# --------------------------------------------------------------------------
# 1. PAGE CONFIGURATION
# --------------------------------------------------------------------------
st.set_page_config(
    page_title="Dell OS | InfoHub",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed" # Collapsed to focus on the custom header
)

# --------------------------------------------------------------------------
# 2. COMMERCIAL-GRADE CSS (STYLING)
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* MAIN BACKGROUND: Dark (as per your previous dark mode requirement, implied by the dark edge in screenshot) */
        .stApp {
            background-color: #0f1115;
            font-family: 'Inter', sans-serif;
        }

        /* ------------------------------------------------ */
        /* HEADER CONTAINER STYLING                         */
        /* ------------------------------------------------ */
        /* This targets the top container to look like the white card in your screenshot */
        [data-testid="stVerticalBlock"] > [style*="flex-direction: column;"] > [data-testid="stVerticalBlock"] {
            background-color: white;
            border-radius: 12px;
            padding: 1rem 1.5rem;
            margin-bottom: 2rem;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }

        /* LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
            height: 100%;
        }
        .logo-icon {
            font-size: 24px;
            color: #0076CE; /* Dell Blue */
        }
        .logo-text {
            font-size: 22px;
            font-weight: 800;
            color: #1c1c1c;
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE;
        }

        /* DATE TEXT STYLING */
        .date-display {
            color: #5f6368;
            font-size: 14px;
            font-weight: 500;
            text-align: right;
            white-space: nowrap;
            display: flex;
            align-items: center;
            height: 100%;
            justify-content: flex-end;
        }

        /* CUSTOMIZING THE STREAMLIT PILLS (Region Select) */
        /* We style these to look like the grey pill bar in your screenshot */
        div[data-testid="stPills"] {
            justify-content: flex-end;
        }
        
        /* ADJUSTING THE BLUE BUTTON ("Daily Briefings") */
        div.stButton > button {
            background-color: #1a73e8;
            color: white;
            border: none;
            font-weight: 600;
            border-radius: 6px;
            padding: 0.5rem 1rem;
            height: auto;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
            color: white;
        }
        
        /* Hiding Default Streamlit Elements */
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
        header {visibility: hidden;} /* Hides the top colored bar */
        
        /* Typography overrides for the white header */
        h1, h2, h3, p, div, span {
            color: #333; /* Force text dark inside the white header */
        }
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (Grid System)
# --------------------------------------------------------------------------

# We use a container to wrap the header elements so the CSS above can target them as a group
with st.container():
    # Layout: [Logo (2)] [Spacer (3)] [Pills (3)] [Date (2)] [Button (1)]
    col_logo, col_spacer, col_pills, col_date, col_btn = st.columns([2.5, 2, 4.5, 3.5, 1.8], gap="small")

    # 1. LOGO (Left)
    with col_logo:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    # 2. SPACER (Middle - Empty to push content right)
    with col_spacer:
        st.write("")

    # 3. REGION TABS (Right-ish)
    with col_pills:
        # Note: 'st.pills' is a newer feature. If your Streamlit version is old, use st.radio with horizontal=True
        selected_region = st.pills(
            "Region",
            options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
            default="GLOBAL",
            label_visibility="collapsed"
        )

    # 4. DATE/TIME (Right)
    with col_date:
        # Dynamic Time Calculation
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11))) # UTC+11 for Sydney as per screenshot request
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        
        st.markdown(f"""
            <div class="date-display">
                {date_str} | {time_str}
            </div>
        """, unsafe_allow_html=True)

    # 5. BUTTON (Far Right)
    with col_btn:
        st.button("📄 Daily Briefings", type="primary", use_container_width=True)


# --------------------------------------------------------------------------
# 4. MAIN CONTENT PLACEHOLDERS (Below the Header)
# --------------------------------------------------------------------------
# Using a spacer to separate the header from the content slightly
st.markdown("<br>", unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    # We will use st.container to create the card effect for the map later
    with st.container():
        st.info(f"📍 MAP VIEW: Showing data for **{selected_region}**")

with side_col:
    with st.container():
        st.warning("⚠️ PROXIMITY ALERTS")
