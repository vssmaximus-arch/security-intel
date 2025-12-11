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

        /* 1. GLOBAL BACKGROUND - STRICT DARK */
        .stApp {
            background-color: #0f1115; /* Deep dark background */
            font-family: 'Inter', sans-serif;
        }

        /* 2. HEADER CARD CONTAINER - THE WHITE FLOATING BAR */
        /* We target the specific container wrapper at the top to create the white card effect */
        [data-testid="stVerticalBlock"] > [style*="flex-direction: column;"] > [data-testid="stVerticalBlock"] {
            background-color: #ffffff;
            border-radius: 24px; /* Large rounded corners as per screenshot */
            padding: 1.2rem 2rem;
            margin-bottom: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5); /* Drop shadow to separate from dark bg */
        }

        /* 3. LOGO STYLING */
        .logo-container {
            display: flex;
            align-items: center;
            gap: 12px;
            height: 100%;
        }
        .logo-icon {
            font-size: 26px;
            color: #0076CE; /* Dell Blue */
        }
        .logo-text {
            font-size: 24px;
            font-weight: 800;
            color: #202124; /* Dark text on white card */
            letter-spacing: -0.5px;
            line-height: 1;
        }
        .logo-span {
            color: #0076CE;
        }

        /* 4. NAVIGATION PILLS STYLING (Override Dark Mode) */
        /* Force pills to look good on white background even if app is strictly dark mode */
        div[data-testid="stPills"] {
            background-color: #f1f3f4; /* Light grey background for the pill group */
            border-radius: 12px;
            padding: 4px;
            gap: 0px;
        }
        
        /* The individual pill items */
        div[data-testid="stPills"] button {
            background-color: transparent;
            border: none;
            color: #5f6368; /* Grey text for inactive */
            font-weight: 700;
            font-size: 14px;
            text-transform: uppercase;
            border-radius: 8px;
            transition: all 0.2s;
        }
        
        /* The selected pill */
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #202124 !important; /* Dark active state */
            color: #ffffff !important; /* White text */
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        /* Hover effect */
        div[data-testid="stPills"] button:hover {
            color: #202124;
            background-color: rgba(0,0,0,0.05);
        }

        /* 5. DATE & TIME STYLING */
        .date-container {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
            color: #5f6368;
            font-weight: 500;
            font-size: 15px;
            white-space: nowrap;
        }

        /* 6. BUTTON STYLING */
        /* Target the specific button to be Dell Blue */
        div.stButton > button {
            background-color: #1a73e8;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0.6rem 1.2rem;
            font-weight: 600;
            font-size: 14px;
            box-shadow: 0 2px 5px rgba(26, 115, 232, 0.3);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
            color: white;
        }
        div.stButton > button:active {
            background-color: #1557b0;
            color: white;
        }
        
        /* HIDE DEFAULT STREAMLIT UI */
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
        header {visibility: hidden;}
        
        /* FIX TEXT COLORS INSIDE WHITE HEADER */
        /* Ensure any stray text inside the header block is dark, not white */
        [data-testid="stVerticalBlock"] [data-testid="stMarkdownContainer"] p {
            color: #333;
        }
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT
# --------------------------------------------------------------------------
# We create a single container for the header. The CSS above targets this specifically.
with st.container():
    # Grid Layout: Logo | Spacer | Pills | Date | Button
    # Adjusted ratios to match the screenshot spacing
    col1, col2, col3, col4, col5 = st.columns([2, 1, 4, 3, 1.5], gap="small")

    # 1. LOGO (Left)
    with col1:
        st.markdown("""
            <div class="logo-container">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    # 2. SPACER (Middle)
    with col2:
        st.write("")

    # 3. REGION PILLS (Right-Center)
    with col3:
        # Using st.pills to match the segmentation control look
        # The CSS above forces these to be Grey/Black instead of Default Streamlit colors
        selected_region = st.pills(
            "Region",
            options=["GLOBAL", "AMER", "EMEA", "APJC", "LATAM"],
            default="GLOBAL",
            label_visibility="collapsed"
        )

    # 4. DATE/TIME (Right)
    with col4:
        # Hardcoded time format to match your screenshot requirement
        # In production, use datetime.now(timezone)
        # Assuming current requested time or live time
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=11))) # GMT+11
        date_str = now.strftime("%A, %d %b %Y")
        time_str = now.strftime("%H:%M GMT+11 UTC")
        
        st.markdown(f"""
            <div class="date-container">
                {date_str} | {time_str}
            </div>
        """, unsafe_allow_html=True)

    # 5. BUTTON (Far Right)
    with col5:
        st.button("📄 Daily Briefings", use_container_width=True)

# --------------------------------------------------------------------------
# 4. MAIN CONTENT (DARK BACKGROUND)
# --------------------------------------------------------------------------
# This section sits outside the white header card, so it retains the dark background
st.markdown("<br>", unsafe_allow_html=True)

main_col, side_col = st.columns([3, 1], gap="medium")

with main_col:
    # Placeholder for Map
    st.info(f"Checking region: {selected_region}")

with side_col:
    # Placeholder for Sidebar
    st.warning("Sidebar Data")
