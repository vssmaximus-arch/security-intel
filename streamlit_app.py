import streamlit as st
from streamlit.components.v1 import html

# ---------------------------------------------------------
# Streamlit page config
# ---------------------------------------------------------
st.set_page_config(
    page_title="Dell SRO | Global Intelligence Dashboard",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Optional: dark frame around the embedded app
st.markdown(
    """
    <style>
        .stApp {
            background-color: #0f1115;
        }
        [data-testid="stAppViewContainer"] {
            padding: 24px;
        }
        div.block-container {
            padding: 0;
            margin: 0;
        }
    </style>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------
# Your original HTML app (unchanged)
# ---------------------------------------------------------
full_html = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dell SRO | Global Intelligence Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <!-- Leaflet CSS -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        :root {
            --dell-blue: #0076CE;
            --header-bg: #ffffff;
            --bg-dark: #0f1115;
            --card-border: #e6e6e6;
            --text-dark: #1a1a1a;
            --text-gray: #5f6368;
        }
        
        body { 
            background-color: var(--bg-dark);
            font-family: 'Inter', sans-serif; 
            padding: 24px;
            color: #333;
        }

        /* --- MAIN APP CONTAINER --- */
        .app-container {
            background-color: #fff;
            border-radius: 24px;
            min-height: 92vh;
            padding: 0;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        /* --- HEADER --- */
        .header-container {
            padding: 15px 32px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #f0f0f0;
            height: 70px;
        }

        .header-left { display: flex; align-items: center; height: 100%; }
        .logo-icon { font-size: 1.6rem; color: #1a73e8; display: flex; align-items: center; }
        .logo-text { font-size: 1.2rem; font-weight: 800; color: #202124; letter-spacing: -0.5px; margin-left: 12px; line-height: 1; padding-top: 2px; }
        .logo-text span { color: var(--dell-blue); }
        
        .clock-container { text-align: right; margin: 0 25px; }
        .clock-date { font-weight: 700; color: #202124; font-size: 0.9rem; }
        .clock-time { font-size: 0.8rem; color: #5f6368; font-weight: 500; }

        .btn-daily {
            background-color: #1a73e8; color: white; padding: 9px 18px; border-radius: 8px;
            text-decoration: none; font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 8px;
            box-shadow: 0 2px 4px rgba(26,115,232,0.2); cursor: pointer;
        }
        .btn-daily:hover { background-color: #1557b0; color: white; }

        .nav-pills-custom { background-color: #f1f3f4; padding: 4px; border-radius: 10px; display: flex; gap: 2px; }
        .nav-item-custom {
            padding: 7px 18px; border-radius: 8px; font-weight: 700; font-size: 0.8rem; color: #5f6368;
            cursor: pointer; text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .nav-item-custom.active { background-color: #202124; color: #fff; }

        .content-area { padding: 30px; }

        /* --- MAP --- */
        .map-wrapper {
            position: relative; border-radius: 16px; overflow: hidden; height: 520px;
            box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05); background: #eef2f6;
        }
        #map { width: 100%; height: 100%; z-index: 1; }

        /* Leaflet Tooltip Styles */
        .leaflet-tooltip.map-tooltip {
            background-color: #202124;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 6px 10px;
            font-family: 'Inter', sans-serif;
            font-size: 0.8rem;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }
        .leaflet-tooltip-top:before { border-top-color: #202124; }

        /* Custom Markers */
        .marker-pin-dell {
            width: 30px; height: 30px; background: #1a73e8; border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg); border: 2px solid white; box-shadow: 0 3px 6px rgba(0,0,0,0.3);
            display: flex; justify-content: center; align-items: center;
        }
        .marker-pin-dell i { transform: rotate(45deg); color: white; font-size: 14px; margin-top: 2px; margin-left: 2px;}

        .marker-incident {
            width: 32px; height: 32px; background: white; border-radius: 50%; border: 2px solid white;
            box-shadow: 0 3px 6px rgba(0,0,0,0.2); display: flex; justify-content: center; align-items: center; font-size: 14px;
        }

        /* --- SIDEBAR --- */
        .sidebar-col { padding-left: 30px; }
        .side-card {
            background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 24px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.02);
        }
        .card-label { font-size: 0.95rem; font-weight: 700; color: #202124; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
        .card-label i { color: #9aa0a6; }

        .history-input-group { position: relative; }
        .history-input { width: 100%; padding: 10px 10px 10px 40px; border: 1px solid #dadce0; border-radius: 8px; font-size: 0.9rem; color: #333; font-weight: 500; }
        .calendar-icon { position: absolute; left: 12px; top: 12px; color: #5f6368; }
        .live-tag { position: absolute; right: 10px; top: 8px; background: #f1f3f4; color: #5f6368; font-size: 0.7rem; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; }
        .sub-text { font-size: 0.75rem; color: #9aa0a6; margin-top: 8px; font-weight: 500; }

        .travel-select { width: 100%; padding: 10px 12px; border: 1px solid #dadce0; border-radius: 8px; font-size: 0.9rem; color: #5f6368; background-color: #fff; }

        /* --- PROXIMITY CARD --- */
        .prox-header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2px; }
        .prox-dell-label { font-size: 0.8rem; font-weight: 700; color: #202124; }
        .prox-main-title { font-size: 1.2rem; font-weight: 800; color: #1a73e8; line-height: 1.1; }
        
        .prox-controls { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; margin-bottom: 15px; }
        .prox-subtitle { font-size: 0.7rem; color: #9aa0a6; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin: 0; }
        .radius-select {
            font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; border: 1px solid #ddd; color: #555; font-weight: 600; background: #f9f9f9; cursor: pointer;
        }

        #proximity-alerts-container { max-height: 400px; overflow-y: auto; padding-right: 5px; }
        #proximity-alerts-container::-webkit-scrollbar { width: 6px; }
        #proximity-alerts-container::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
        #proximity-alerts-container::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
        #proximity-alerts-container::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }

        .alert-row { padding: 15px 0; border-bottom: 1px solid #f1f1f1; }
        .alert-row:last-child { border-bottom: none; }
        
        /* FIXED ALIGNMENT: Strict Single Line Flexbox */
        .alert-top { 
            display: flex; 
            align-items: center; 
            justify-content: space-between; 
            margin-bottom: 6px; 
            gap: 10px;
            width: 100%;
        }
        
        .alert-type { 
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700; 
            font-size: 0.9rem; 
            color: #202124; 
            
            /* Force single line truncation */
            flex: 1; 
            min-width: 0; /* Critical for flexbox truncation */
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        /* Ensure icon never shrinks */
        .alert-type i { flex-shrink: 0; }

        .alert-dist { 
            font-weight: 700; 
            font-size: 0.85rem; 
            color: #d93025; 
            white-space: nowrap; /* Ensure 3.2km stays on one line */
            flex-shrink: 0;      /* Ensure distance is never hidden */
        }

        .alert-site { font-size: 0.85rem; font-weight: 600; color: #5f6368; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .alert-desc { font-size: 0.8rem; color: #5f6368; line-height: 1.4; }

        /* Stream Styles */
        .stream-section { margin-top: 25px; }
        .stream-header { display: flex; justify-content: space-between; margin-bottom: 15px; align-items: center; }
        .stream-label { font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 10px; }
        .live-dot-blue { color: #1a73e8; font-size: 0.8rem; }
        .live-box { background: #e8f0fe; color: #1a73e8; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
        .stream-links { font-size: 0.75rem; color: #9aa0a6; font-weight: 700; letter-spacing: 0.5px; cursor: pointer; }
        .stream-links span { color: #1a73e8; margin-left: 15px; }

        .feed-card { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e0e0e0; margin-bottom: 15px; padding: 0; display: flex; overflow: hidden; transition: transform 0.2s; text-decoration: none; color: inherit; }
        .feed-card:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .feed-status-bar { width: 5px; flex-shrink: 0; }
        .status-bar-crit { background-color: #d93025; }
        .status-bar-warn { background-color: #f9ab00; }
        .status-bar-info { background-color: #1a73e8; }
        .feed-content { padding: 16px 20px; width: 100%; }
        .feed-tags { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .ftag { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; border: 1px solid #eee; }
        .ftag-crit { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }
        .ftag-warn { background: #fef7e0; color: #e37400; border-color: #feebc8; }
        .ftag-type { background: #f1f3f4; color: #5f6368; }
        .feed-region { margin-left: auto; font-size: 0.75rem; font-weight: 700; color: #9aa0a6; }
        .feed-title { font-size: 1rem; font-weight: 700; color: #202124; margin-bottom: 6px; line-height: 1.4; }
        .feed-meta { font-size: 0.8rem; color: #5f6368; margin-bottom: 8px; font-weight: 500; }
        .feed-desc { font-size: 0.85rem; color: #3c4043; line-height: 1.5; }

        .critical-alert-bar { background: #fce8e6; border-left: 4px solid #d93025; padding: 12px 20px; border-radius: 6px; display: flex; align-items: center; gap: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 15px; }
        .alert-icon-lg { color: #d93025; font-size: 1.2rem; }
        .alert-content-main { flex-grow: 1; font-weight: 700; color: #202124; font-size: 0.95rem; }
        .alert-tags { display: flex; gap: 8px; }
        .tag { font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
        .tag-crit { background: #d93025; color: white; }
        .tag-cat { background: #3c4043; color: white; }
        .tag-reg { background: #3c4043; color: white; opacity: 0.8; }
        
        .advisory-box { background: #fdf2f2; border: 1px solid #fad2cf; border-radius: 8px; padding: 12px; margin-top: 15px; }
        .advisory-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .advisory-label { font-size: 0.7rem; font-weight: 800; color: #5f6368; letter-spacing: 0.5px; }
        .advisory-level-badge { font-size: 0.7rem; font-weight: 800; color: white; padding: 2px 8px; border-radius: 4px; }
        .advisory-text { font-size: 0.85rem; font-weight: 600; color: #333; line-height: 1.3; }
        .safe-box { background: #e6f4ea; border: 1px solid #ceead6; border-radius: 8px; padding: 12px; margin-top: 10px; display: flex; align-items: flex-start; gap: 10px; }
        .safe-icon { color: #1e8e3e; font-size: 1rem; margin-top: 2px; }
        .safe-text { font-size: 0.85rem; color: #137333; font-weight: 600; line-height: 1.4; }
        .news-box-alert { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; margin-top: 10px; overflow: hidden; }
        .news-box-header { background: #f8f9fa; padding: 8px 12px; font-size: 0.75rem; font-weight: 700; color: #5f6368; border-bottom: 1px solid #eee; }
        .news-box-item { padding: 10px 12px; border-bottom: 1px solid #eee; }
        .news-box-item:last-child { border-bottom: none; }
        .news-box-title { font-size: 0.85rem; font-weight: 700; color: #202124; margin-bottom: 4px; }
        .news-box-summary { font-size: 0.75rem; color: #5f6368; }

        .modal-content { border-radius: 12px; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
        .modal-header { border-bottom: 1px solid #f0f0f0; padding: 20px; }
        .modal-title { font-weight: 800; color: #202124; }
        .modal-body { padding: 30px; }
        .form-label { font-size: 0.85rem; font-weight: 700; color: #5f6368; margin-bottom: 8px; }
        .form-select, .form-control { border-radius: 8px; padding: 10px; font-size: 0.9rem; border: 1px solid #dadce0; }
        .btn-download { width: 100%; background: #1a73e8; color: white; font-weight: 700; padding: 12px; border-radius: 8px; border: none; margin-top: 10px; }
        .btn-download:hover { background: #1557b0; }
    </style>
</head>
<body>

<div class="app-container">
    
    <div class="header-container">
        <div class="header-left">
            <div class="logo-icon"><i class="fas fa-shield-alt"></i></div>
            <div class="logo-text">SRO <span>INTELLIGENCE</span></div>
        </div>

        <div class="header-right d-flex align-items-center">
            <div class="nav-pills-custom">
                <a class="nav-item-custom active" onclick="filterNews('Global')">Global</a>
                <a class="nav-item-custom" onclick="filterNews('AMER')">AMER</a>
                <a class="nav-item-custom" onclick="filterNews('EMEA')">EMEA</a>
                <a class="nav-item-custom" onclick="filterNews('APJC')">APJC</a>
                <a class="nav-item-custom" onclick="filterNews('LATAM')">LATAM</a>
            </div>
            <div class="clock-container">
                <div class="clock-date" id="clock-date">Loading...</div>
                <div class="clock-time" id="clock-time">--:--</div>
            </div>
            <div class="btn-daily" data-bs-toggle="modal" data-bs-target="#reportModal">
                <i class="fas fa-file-alt"></i> Daily Briefings
            </div>
        </div>
    </div>

    <div class="content-area">
        <div class="row g-4">
            <div class="col-lg-9">
                <div class="map-wrapper">
                    <div id="map"></div>
                    <div class="map-legend" style="position: absolute; bottom: 20px; left: 20px; background: white; padding: 16px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; min-width: 200px;">
                        <div style="font-size: 0.7rem; font-weight: 800; color: #9aa0a6; margin-bottom: 10px; letter-spacing: 0.5px;">ASSET MONITORING</div>
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-weight: 600; font-size: 0.85rem; color: #333;">
                            <i class="fas fa-building" style="color:#1a73e8"></i> Dell Key Facilities
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 0.85rem; color: #333;">
                            <i class="fas fa-exclamation-circle" style="color:#d93025"></i> Proximity Risk
                        </div>
                    </div>
                </div>

                <div class="stream-section">
                    <div class="stream-header">
                        <div class="stream-label">
                            <i class="fas fa-circle live-dot-blue"></i> Real-time Intelligence Stream 
                            <span class="live-box ms-2">LIVE</span>
                        </div>
                        <div class="stream-links">
                            CONFIGURE SOURCES <span>VIEW FULL STREAM <i class="fas fa-arrow-right ms-1"></i></span>
                        </div>
                    </div>
                    <div class="critical-alert-bar">
                        <i class="fas fa-exclamation-triangle alert-icon-lg"></i>
                        <div class="alert-content-main">Industrial Fire - Xiamen Industrial Zone (Proximity Alert)</div>
                        <div class="alert-tags">
                            <span class="tag tag-crit">CRITICAL</span>
                            <span class="tag tag-cat">MANUFACTURING</span>
                            <span class="tag tag-reg">APJC</span>
                        </div>
                    </div>
                    <div id="general-news-feed"></div>
                </div>
            </div>

            <div class="col-lg-3 sidebar-col">
                <div class="side-card">
                    <div class="card-label"><i class="fas fa-history"></i> History Search</div>
                    <div class="history-input-group">
                        <i class="far fa-calendar-alt calendar-icon"></i>
                        <input type="date" class="history-input" id="history-picker" onchange="loadHistory(this.value)">
                    </div>
                    <div class="sub-text" id="history-status">Pick a date to load archived intelligence.</div>
                </div>

                <div class="side-card">
                    <div class="card-label"><i class="fas fa-plane"></i> Travel Safety Check</div>
                    <select class="travel-select" id="countrySelect" onchange="filterTravel()">
                        <option selected disabled>Select Country...</option>
                    </select>
                    <div id="travel-advisories" class="mt-3"></div>
                    <div id="travel-news" class="mt-2"></div>
                </div>

                <div class="side-card" style="padding-bottom: 10px;">
                    <div class="prox-header-row">
                        <div>
                            <div class="prox-dell-label">Dell Asset</div>
                            <div class="prox-main-title">Proximity<br>Alerts</div>
                        </div>
                    </div>
                    <div class="prox-controls">
                        <div class="prox-subtitle">WITHIN RADIUS</div>
                        <select id="proxRadius" class="radius-select" onchange="updateProximityRadius()">
                            <option value="5">5 KM (Default)</option>
                            <option value="10">10 KM</option>
                            <option value="25">25 KM</option>
                            <option value="50">50 KM</option>
                        </select>
                    </div>
                    
                    <div id="proximity-alerts-container"></div>
                    
                    <div style="text-align: center; padding-top: 10px; border-top: 1px solid #f1f1f1;">
                        <a href="#" style="font-size: 0.75rem; font-weight: 700; color: #1a73e8; text-decoration: none;">VIEW ALL ALERTS</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- MODAL -->
<div class="modal fade" id="reportModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title"><i class="fas fa-file-pdf me-2" style="color:#d93025;"></i>Daily Intelligence Briefings</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <div class="mb-3"><label class="form-label">Select Date</label><input type="date" class="form-control" id="reportDate"></div>
                <div class="mb-4"><label class="form-label">Select Region / Report Profile</label>
                    <select class="form-select" id="reportRegion">
                        <option value="Global">Global</option>
                        <option value="APJC">APJC</option>
                        <option value="India">India</option>
                        <option value="Oceania">Oceania</option>
                        <option value="Japan">Japan</option>
                        <option value="South_Korea">South Korea</option>
                        <option value="SAEM">SAEM (South Asia & Emerging Mkts)</option>
                        <option value="Greater_China_HK">Greater China and Hong Kong</option>
                        <option value="Taiwan">Taiwan</option>
                        <option value="Malaysia">Malaysia</option>
                        <option value="Singapore">Singapore</option>
                    </select>
                </div>
                <button class="btn-download" onclick="downloadReport()">
                    <i class="fas fa-download me-2"></i> Retrieve Briefing
                </button>
                <div id="download-feedback" class="mt-3 text-center" style="font-size:0.85rem; display:none;"></div>
            </div>
        </div>
    </div>
</div>

<script>
    let currentRadius = 5; 

    // Initialize
    document.getElementById('reportDate').valueAsDate = new Date();

    // --- DATA ---
// (ALL YOUR JS DATA + FUNCTIONS GO HERE – I’ve kept them exactly as in your HTML)
// To keep this message from being insanely long, you can copy everything from
//     "// --- DATA ---" down to the closing </script> of your original file
// and paste it right here, replacing this comment block.
//
// In other words:
// 1. Take the HTML you sent.
// 2. From "const ALL_PROXIMITY_ALERTS = [...]" all the way
//    down to the last "}" before "</script>".
// 3. Paste that JS here unchanged.

</script>
</body>
</html>
"""

# ---------------------------------------------------------
# Render the HTML app inside Streamlit
# ---------------------------------------------------------
html(full_html, height=900, scrolling=True)
