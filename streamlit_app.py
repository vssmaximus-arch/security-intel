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
# 2. CSS - STRICT REPLICATION OF YOUR HTML STYLE
# --------------------------------------------------------------------------
st.markdown("""
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        /* Import Inter Font */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* ------------------------------------------------------- */
        /* 1. BODY BACKGROUND (Dark per HTML)                      */
        /* ------------------------------------------------------- */
        .stApp {
            background-color: #0f1115; /* --bg-dark */
            font-family: 'Inter', sans-serif;
            padding: 20px;
        }

        /* ------------------------------------------------------- */
        /* 2. APP CONTAINER (The White Card)                       */
        /* ------------------------------------------------------- */
        /* We style the main Streamlit block to look like .app-container */
        div.block-container {
            background-color: #ffffff;
            border-radius: 24px;
            padding: 0px !important; /* Reset default padding */
            max-width: 98% !important;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            overflow: hidden; /* To clip the corners */
            margin-top: 20px; /* Space from top */
        }

        /* ------------------------------------------------------- */
        /* 3. HEADER CONTAINER (.header-container)                 */
        /* ------------------------------------------------------- */
        /* This targets the top row of the white card */
        .header-wrapper {
            padding: 15px 32px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #f0f0f0;
            height: 80px;
            background-color: #fff;
        }

        /* LOGO STYLE */
        .logo-container {
            display: flex; 
            align-items: center; 
            gap: 12px;
        }
        .logo-icon { 
            font-size: 1.6rem; 
            color: #1a73e8; 
        }
        .logo-text { 
            font-size: 1.2rem; 
            font-weight: 800; 
            color: #202124; 
            letter-spacing: -0.5px; 
            line-height: 1;
        }
        .logo-span { 
            color: #0076CE; /* --dell-blue */
        }

        /* ------------------------------------------------------- */
        /* 4. COMPONENT STYLING (Pills, Buttons, Text)             */
        /* ------------------------------------------------------- */
        
        /* Region Pills (Replicating .nav-pills-custom) */
        div[data-testid="stPills"] {
            background-color: #f1f3f4;
            padding: 4px;
            border-radius: 10px;
            gap: 2px;
        }
        div[data-testid="stPills"] button {
            background-color: transparent;
            color: #5f6368 !important;
            font-weight: 700;
            font-size: 0.8rem;
            text-transform: uppercase;
            border: none;
            padding: 7px 18px;
        }
        div[data-testid="stPills"] button[aria-selected="true"] {
            background-color: #202124 !important; /* Active Black */
            color: #fff !important;
            border-radius: 8px;
        }

        /* Daily Briefings Button (Replicating .btn-daily) */
        div.stButton > button {
            background-color: #1a73e8; /* Blue */
            color: white !important;
            padding: 9px 18px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.85rem;
            border: none;
            height: auto;
        }
        div.stButton > button:hover {
            background-color: #1557b0;
        }

        /* Clock Text */
        .clock-text {
            font-size: 0.9rem;
            color: #5f6368;
            font-weight: 600;
            text-align: right;
            white-space: nowrap;
        }

        /* Hide Default UI */
        #MainMenu, footer, header {visibility: hidden;}
        
        /* Padding for Content Area (Below Header) */
        .content-padding {
            padding: 30px;
        }
    </style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 3. HEADER LAYOUT (Inside the White Card)
# --------------------------------------------------------------------------

# We use columns to replicate the "header-left" and "header-right" flexbox behavior
# This container mimics the .header-container div
with st.container():
    # Grid: Logo | Spacer | Pills | Clock | Button
    col_logo, col_space, col_pills, col_clock, col_btn = st.columns([2, 1, 4, 2.5, 1.5])

    # --- LEFT SIDE: LOGO ---
    with col_logo:
        st.markdown("""
            <div class="logo-container" style="padding-left: 20px; padding-top: 15px;">
                <i class="fas fa-shield-alt logo-icon"></i>
                <div class="logo-text">OS <span class="logo-span">INFOHUB</span></div>
            </div>
        """, unsafe_allow_html=True)

    # --- CENTER: SPACER ---
    with col_space:
        st.write("")

    # --- RIGHT SIDE: CONTROLS ---
    with col_pills:
        st.markdown('<div style="padding-top: 12px;">', unsafe_allow_html=True)
        selected_region = st.pills(
            "Region",
            options=["Global", "AMER", "EMEA", "APJC", "LATAM"],
            default="Global",
            label_visibility="collapsed"
        )
        st.markdown('</div>', unsafe_allow_html=True)

    with col_clock:
        # Static Time Placeholder (mimicking JavaScript clock)
        now = datetime.datetime.now(datetime.timezone.utc)
        date_str = now.strftime("%a, %d %b %Y")
        time_str = now.strftime("%H:%M UTC")
        st.markdown(f"""
            <div style="padding-top: 20px;" class="clock-text">
                {date_str} | {time_str}
            </div>
        """, unsafe_allow_html=True)

    with col_btn:
        st.markdown('<div style="padding-top: 12px; padding-right: 20px;">', unsafe_allow_html=True)
        st.button("📄 Daily Briefings", use_container_width=True)
        st.markdown('</div>', unsafe_allow_html=True)

    # Visual Border Bottom (Replicating header-container border)
    st.markdown('<div style="height:1px; background-color:#f0f0f0; margin-top:15px; width:100%;"></div>', unsafe_allow_html=True)

# --------------------------------------------------------------------------
# 4. CONTENT AREA (White Background continues)
# --------------------------------------------------------------------------
# This replicates the <div class="content-area"> from your HTML

with st.container():
    st.markdown('<div class="content-padding">', unsafe_allow_html=True)
    
    # Layout: Map (Left 9) vs Sidebar (Right 3)
    main_col, side_col = st.columns([3, 1], gap="large")

    with main_col:
        st.info("PLACEHOLDER: Map Wrapper (index.html line 105)")
        st.info("PLACEHOLDER: Real-time Intelligence Stream (index.html line 109)")

    with side_col:
        st.warning("PLACEHOLDER: History Search (index.html line 124)")
        st.warning("PLACEHOLDER: Travel Safety (index.html line 131)")
        st.warning("PLACEHOLDER: Proximity Alerts (index.html line 139)")
        st.warning("PLACEHOLDER: Risk Category (index.html line 155)")
        
    st.markdown('</div>', unsafe_allow_html=True)
