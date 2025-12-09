import streamlit as st
import json
import os
from datetime import datetime
import hashlib
import folium
from streamlit_folium import st_folium

# -----------------------------
# 0. BASIC CONFIG
# -----------------------------
st.set_page_config(
    page_title="OS INFOHUB",
    layout="wide",
    page_icon="🛡️",
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROX_PATH = os.path.join(DATA_DIR, "proximity.json")
LOC_PATH = os.path.join(DATA_DIR, "locations.json")
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

os.makedirs(DATA_DIR, exist_ok=True)

# -----------------------------
# 1. DATA HELPERS
# -----------------------------

@st.cache_data(ttl=60)
def load_news():
    """Load news items produced by news_agent.py and attach a stable ID."""
    if not os.path.exists(NEWS_PATH):
        return []
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            news = json.load(f)
    except Exception:
        news = []
    # attach a stable id used for hiding
    for item in news:
        uid = hashlib.sha256(
            (item.get("title", "") + item.get("url", "")).encode("utf-8")
        ).hexdigest()[:16]
        item["_id"] = uid
    return news


@st.cache_data(ttl=300)
def load_locations_and_proximity():
    """Load Dell locations (sites) and precomputed proximity alerts."""
    # Dell sites
    sites = []
    if os.path.exists(LOC_PATH):
        try:
            with open(LOC_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
                # original locations.json structure: {"locations":[{...}]}
                if isinstance(raw, dict) and "locations" in raw:
                    sites = raw["locations"]
                elif isinstance(raw, list):
                    sites = raw
        except Exception:
            sites = []

    # Proximity alerts from backend pipeline
    proximity = []
    if os.path.exists(PROX_PATH):
        try:
            with open(PROX_PATH, "r", encoding="utf-8") as f:
                pdata = json.load(f)
                proximity = pdata.get("alerts", pdata if isinstance(pdata, list) else [])
        except Exception:
            proximity = []

    return sites, proximity


def append_feedback(entry: dict):
    """Persist feedback in feedback.jsonl (one JSON object per line)."""
    os.makedirs(DATA_DIR, exist_ok=True)
    entry = dict(entry)
    entry["timestamp"] = datetime.utcnow().isoformat() + "Z"
    with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def push_feedback(item, label: str):
    """Store feedback and hide this item in the current session."""
    append_feedback(
        {
            "title": item.get("title"),
            "url": item.get("url"),
            "source": item.get("source"),
            "region": item.get("region"),
            "severity": item.get("severity"),
            "type": item.get("type"),
            "label": label,
        }
    )

    # hide in current session
    hidden = st.session_state.setdefault("hidden_ids", set())
    hidden.add(item["_id"])


# -----------------------------
# 2. THEME / CSS
# -----------------------------

if "theme" not in st.session_state:
    st.session_state["theme"] = "light"

# user toggle
with st.sidebar:
    st.markdown("### Appearance")
    theme_choice = st.radio(
        "Theme",
        ["Light", "Dark"],
        index=0 if st.session_state["theme"] == "light" else 1,
    )
    st.session_state["theme"] = "light" if theme_choice == "Light" else "dark"

dark = st.session_state["theme"] == "dark"

BACKGROUND = "#06070a" if dark else "#f5f5f5"
CARD_BG = "#111318" if dark else "#ffffff"
TEXT_MAIN = "#ffffff" if dark else "#202124"
TEXT_MUTED = "#9aa0a6" if dark else "#5f6368"
BORDER = "#202124" if dark else "#e0e0e0"

st.markdown(
    f"""
    <style>
    .stApp {{
        background-color: {BACKGROUND};
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    .os-header {{
        display:flex;
        justify-content: space-between;
        align-items:center;
        padding:10px 24px 6px 24px;
        border-bottom:1px solid {BORDER};
        background: {CARD_BG};
    }}
    .os-logo {{
        display:flex;
        align-items:center;
        gap:8px;
        font-weight:800;
        letter-spacing:-0.02em;
        color:{TEXT_MAIN};
    }}
    .os-logo-icon {{
        width:22px;
        height:22px;
        border-radius:999px;
        background:#0076ce;
        display:flex;
        align-items:center;
        justify-content:center;
        color:white;
        font-size:13px;
        font-weight:900;
    }}
    .os-chip {{
        font-size:0.75rem;
        padding:2px 8px;
        border-radius:999px;
        border:1px solid {BORDER};
        color:{TEXT_MUTED};
    }}
    .os-card {{
        background:{CARD_BG};
        color:{TEXT_MAIN};
        border-radius:8px;
        border:1px solid {BORDER};
        padding:12px 16px;
        margin-bottom:8px;
    }}
    .os-card-title {{
        font-size:0.95rem;
        font-weight:700;
        margin-bottom:4px;
    }}
    .os-card-meta {{
        font-size:0.75rem;
        color:{TEXT_MUTED};
        margin-bottom:6px;
    }}
    .os-card-snippet {{
        font-size:0.8rem;
        line-height:1.4;
    }}
    .os-tag {{
        font-size:0.7rem;
        font-weight:700;
        display:inline-block;
        padding:2px 6px;
        border-radius:4px;
        margin-right:4px;
        text-transform:uppercase;
    }}
    .os-tag-warning {{
        background:#fef3c3;
        color:#8d5a00;
    }}
    .os-tag-critical {{
        background:#fce8e6;
        color:#b3261e;
    }}
    .os-tag-info {{
        background:#e8f0fe;
        color:#1a73e8;
    }}
    .os-link a {{
        color:{TEXT_MAIN};
        text-decoration:none;
    }}
    .os-link a:hover {{
        text-decoration:underline;
    }}
    </style>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# 3. HEADER
# -----------------------------

st.markdown(
    """
    <div class="os-header">
        <div class="os-logo">
            <div class="os-logo-icon">OS</div>
            <div>OS <span style="color:#4c8bf5;">INFOHUB</span></div>
        </div>
        <div style="font-size:0.8rem; color:#9aa0a6;">
            Global Security Operations · Live Stream
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

# -----------------------------
# 4. MAIN LAYOUT
# -----------------------------

news_items = load_news()
sites, proximity_alerts = load_locations_and_proximity()

regions = ["Global", "AMER", "EMEA", "APJC", "LATAM"]
tab_main, tab_briefs = st.tabs(
    ["Real-time Intelligence Stream", "Briefings & Reports"]
)

with tab_main:
    top_col1, top_col2 = st.columns([3, 1])

    # LEFT: region, map, stream
    with top_col1:
        # region selector
        sel_region = st.radio(
            "Region", regions, horizontal=True, label_visibility="collapsed"
        )

        # filter sites by region
        if sel_region == "Global":
            map_sites = sites
        else:
            map_sites = [s for s in sites if s.get("region") == sel_region]

        # map
        m = folium.Map(
            location=[20, 0],
            zoom_start=2,
            tiles="CartoDB positron",
            min_zoom=1,
            max_bounds=True,
        )

        # Dell sites (blue)
        for s in map_sites:
            lat, lon = s.get("lat"), s.get("lon")
            if lat is None or lon is None:
                continue
            tooltip = s.get("name", "Site")
            folium.Marker(
                [lat, lon],
                tooltip=tooltip,
                icon=folium.Icon(color="blue", icon="building", prefix="fa"),
            ).add_to(m)

        # Proximity alerts (red)
        for alert in proximity_alerts:
            lat, lon = alert.get("lat"), alert.get("lon")
            if lat is None or lon is None:
                continue
            if sel_region != "Global" and alert.get("site_region") != sel_region:
                continue
            folium.Marker(
                [lat, lon],
                tooltip=alert.get("type", "Alert"),
                icon=folium.Icon(color="red", icon="exclamation", prefix="fa"),
            ).add_to(m)

        st_folium(m, width="100%", height=360)

        # stream title
        st.markdown("### ⚡ Real-time Intelligence Stream")

        # risk category filter
        cat = st.selectbox(
            "Risk category",
            ["All categories", "Physical Security", "Cyber Security", "Supply Chain"],
            key="cat_selector",
        )

        # apply filters
        hidden_ids = st.session_state.get("hidden_ids", set())

        def visible(item):
            if item.get("_id") in hidden_ids:
                return False
            if sel_region != "Global" and item.get("region") != sel_region:
                return False
            if cat != "All categories":
                key = cat.split()[0].upper()
                itype = str(item.get("type", "")).upper()
                if key not in itype:
                    return False
            return True

        filtered = [n for n in news_items if visible(n)]

        if not filtered:
            st.info("No active incidents after applying current filters.")
        else:
            for item in filtered:
                sev = int(item.get("severity", 1) or 1)
                if sev >= 3:
                    sev_tag = "CRITICAL"
                    sev_cls = "os-tag-critical"
                elif sev == 2:
                    sev_tag = "WARNING"
                    sev_cls = "os-tag-warning"
                else:
                    sev_tag = "MONITOR"
                    sev_cls = "os-tag-info"

                itype = item.get("type", "GENERAL")
                region_label = item.get("region", "GLOBAL")
                url = item.get("url") or "#"
                src = item.get("source", "")
                time_str = item.get("time", "")[:19].replace("T", " ")

                st.markdown(
                    f"""
                    <div class="os-card">
                        <div style="margin-bottom:4px;">
                            <span class="os-tag {sev_cls}">{sev_tag}</span>
                            <span class="os-tag os-tag-info" style="background:transparent; border:1px solid {BORDER}; color:{TEXT_MUTED};">{itype}</span>
                            <span style="float:right; font-size:0.7rem; color:{TEXT_MUTED}; text-transform:uppercase;">{region_label}</span>
                        </div>
                        <div class="os-card-title os-link">
                            <a href="{url}" target="_blank" rel="noopener noreferrer">{item.get("title","(no title)")}</a>
                        </div>
                        <div class="os-card-meta">
                            {src} · {time_str}
                        </div>
                        <div class="os-card-snippet">
                            {item.get("snippet","")}
                        </div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

                b1, b2, _ = st.columns([1, 1, 6])
                with b1:
                    if st.button("Relevant", key=f"rel_{item['_id']}"):
                        push_feedback(item, "RELEVANT")
                        st.experimental_rerun()
                with b2:
                    if st.button("Not relevant", key=f"nrel_{item['_id']}"):
                        push_feedback(item, "NOT_RELEVANT")
                        st.experimental_rerun()

    # RIGHT: history, travel, proximity panel
    with top_col2:
        # History search – UI only, archive is backend responsibility
        with st.expander("🕒 History Search", expanded=True):
            st.date_input("Select date")

        # Travel safety
        with st.expander("✈️ Travel Safety Check", expanded=True):
            # minimal advisory set; extend as needed
            ADVISORIES = {
                "Australia": (2, "Exercise increased caution."),
                "Brazil": (3, "Reconsider travel."),
                "Canada": (1, "Exercise normal precautions."),
                "China": (3, "Reconsider travel."),
                "France": (1, "Exercise normal precautions."),
                "Germany": (1, "Exercise normal precautions."),
                "India": (2, "Exercise increased caution."),
                "Ireland": (1, "Exercise normal precautions."),
                "Italy": (1, "Exercise normal precautions."),
                "Japan": (1, "Exercise normal precautions."),
                "Mexico": (2, "Exercise increased caution."),
                "South Africa": (2, "Exercise increased caution."),
                "United Kingdom": (1, "Exercise normal precautions."),
                "United States": (1, "Exercise normal precautions."),
            }
            countries = sorted(ADVISORIES.keys())
            country = st.selectbox("Country", countries)
            lvl, txt = ADVISORIES[country]
            level_color = (
                "#b3261e"
                if lvl >= 4
                else "#c85b11"
                if lvl == 3
                else "#e3a008"
                if lvl == 2
                else "#1a73e8"
            )
            st.markdown(
                f"""
                <div style="border-left:4px solid {level_color}; padding:8px 10px; background:{CARD_BG}; margin-top:6px; border-radius:4px;">
                    <div style="font-size:0.8rem; font-weight:600; color:{level_color};">LEVEL {lvl} ADVISORY</div>
                    <div style="font-size:0.8rem; margin-top:2px;">{txt}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

        # Proximity alerts sidebar view
        with st.expander("📍 Proximity Alerts", expanded=True):
            radius = st.select_slider("Radius (km)", [5, 10, 25, 50], value=5)
            near = [a for a in proximity_alerts if a.get("distance_km", 9999) <= radius]
            if not near:
                st.write(f"No alerts within {radius}km of Dell sites.")
            else:
                for a in near:
                    st.markdown(
                        f"- **{a.get('type','Alert')}** — {a.get('site_name','Unknown site')} (`{a.get('distance_km','?')} km`)"
                    )

with tab_briefs:
    st.markdown("### 📄 Briefings & Reports")
    st.write(
        "This tab is reserved for daily / weekly / monthly briefings generated from the same news "
        "pipeline. Once your report-generation script is wired to drop files (e.g. JSON or Markdown) "
        "into `public/data/reports/`, we can render them here as cards or downloadable PDFs."
    )
