# streamlit_app.py
# OS INFOHUB – Streamlit Edition
# Single source of truth UI – no index.html / style.css / app.js required

import os
import json
import math
from datetime import datetime, timedelta
from collections import Counter
import re

import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium

# Optional – only used if you actually set GOOGLE_API_KEY / st.secrets
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except Exception:
    GEMINI_AVAILABLE = False

# ============================================================
# 1. PATHS & BASIC CONFIG
# ============================================================

st.set_page_config(page_title="OS INFOHUB", layout="wide", page_icon="🛡️")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROXIMITY_PATH = os.path.join(DATA_DIR, "proximity.json")
LOCATIONS_PATH = os.path.join(DATA_DIR, "locations.json")
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

# Optional Gemini key
GEMINI_KEY = os.environ.get("GOOGLE_API_KEY") or st.secrets.get("GOOGLE_API_KEY", None)
if GEMINI_AVAILABLE and GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
else:
    GEMINI_AVAILABLE = False

# Regions used everywhere
REGIONS = ["Global", "AMER", "EMEA", "APJC", "LATAM"]

# ============================================================
# 2. STYLING (mimic original OS INFOHUB)
# ============================================================

st.markdown(
    """
<style>
/* Global look */
.stApp {
    background-color: #0f1115;
    color: #e8eaed;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Kill default header/footer */
#MainMenu, header, footer {visibility: hidden;}

/* Header strip */
.os-header {
    background: #14161c;
    border-bottom: 1px solid #23252d;
    padding: 16px 32px 12px 32px;
    margin: -60px -16px 8px -16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.os-logo {
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: #e8eaed;
}
.os-logo span {
    color: #1a73e8;
}
.os-sub {
    font-size: 0.8rem;
    color: #9aa0a6;
}

/* Region tabs */
.os-region-tabs {
    margin: 6px 0 4px 32px;
    font-size: 0.8rem;
}
.os-region-pill {
    display: inline-flex;
    align-items: center;
    margin-right: 12px;
    cursor: pointer;
    color: #9aa0a6;
}
.os-region-pill-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    margin-right: 5px;
    background: #5f6368;
}
.os-region-pill.active {
    color: #e8eaed;
    font-weight: 600;
}
.os-region-pill.active .os-region-pill-dot {
    background: #ea4335;
}

/* Cards */
.os-card {
    background: #15171e;
    border-radius: 10px;
    border: 1px solid #272a33;
    padding: 16px 18px;
    margin-bottom: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.os-card-title {
    font-size: 0.92rem;
    font-weight: 700;
    color: #e8eaed;
    margin-bottom: 4px;
}
.os-card-meta {
    font-size: 0.72rem;
    color: #9aa0a6;
    margin-bottom: 6px;
}
.os-card-body {
    font-size: 0.82rem;
    color: #e8eaed;
}

/* Feed badges */
.os-tag {
    font-size: 0.60rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 3px;
    text-transform: uppercase;
    border: 1px solid rgba(255,255,255,0.1);
    margin-right: 4px;
}
.os-tag-crit {
    background: #3c1b1b;
    border-color: #ea4335;
    color: #f28b82;
}
.os-tag-warn {
    background: #3c2a1b;
    border-color: #fbbc04;
    color: #fbbc04;
}
.os-tag-info {
    background: #1b2733;
    border-color: #1a73e8;
    color: #8ab4f8;
}
.os-tag-type {
    background: #22242b;
    border-color: #44464f;
    color: #e8eaed;
}
.os-tag-region {
    background: transparent;
    border-color: transparent;
    color: #9aa0a6;
}

/* Side cards */
.os-side-card {
    background: #15171e;
    border-radius: 10px;
    border: 1px solid #272a33;
    padding: 14px 14px 10px 14px;
    margin-bottom: 12px;
}
.os-side-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: #e8eaed;
    margin-bottom: 8px;
}

/* Proximity rows */
.os-alert-row {
    padding: 6px 0;
    border-bottom: 1px solid #262831;
    font-size: 0.78rem;
}
.os-alert-top {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
}
.os-alert-site {
    color: #9aa0a6;
    font-size: 0.75rem;
}

/* Buttons – make them smaller */
.stButton>button {
    font-size: 0.72rem;
    padding: 1px 9px;
    border-radius: 999px;
}

/* Toast text */
div[data-testid="stToast"] {
    font-size: 0.75rem;
}
</style>
""",
    unsafe_allow_html=True,
)

# ============================================================
# 3. DATA LOADERS
# ============================================================

@st.cache_data(ttl=120)
def load_news():
    if not os.path.exists(NEWS_PATH):
        return []
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Allow either list or {"articles":[...]}
        if isinstance(data, dict) and "articles" in data:
            data = data["articles"]
        return data
    except Exception:
        return []


@st.cache_data(ttl=300)
def load_locations():
    # Uses the locations.json you already maintain
    if not os.path.exists(LOCATIONS_PATH):
        return []
    try:
        with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


@st.cache_data(ttl=60)
def load_proximity():
    if not os.path.exists(PROXIMITY_PATH):
        return []
    try:
        with open(PROXIMITY_PATH, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj.get("alerts", [])
    except Exception:
        return []


@st.cache_data(ttl=60)
def load_feedback_counters():
    """
    Turn feedback.jsonl into word counters so the system can learn
    which terms usually mean 'relevant' vs 'not relevant'.
    """
    good = Counter()
    bad = Counter()
    if not os.path.exists(FEEDBACK_PATH):
        return good, bad

    stop = {
        "the","and","for","from","this","that","with","into","over","under",
        "how","why","what","when","where","a","an","of","in","to","on","at",
        "is","are","was","were","be","has","have","had","will","as","by"
    }

    try:
        with open(FEEDBACK_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                label = obj.get("label")
                text = (obj.get("title", "") + " " + obj.get("snippet", "")).lower()
                tokens = [t for t in re.findall(r"[a-z]{3,}", text) if t not in stop]
                target = good if label == "RELEVANT" else bad if label == "NOT_RELEVANT" else None
                if not target:
                    continue
                for t in tokens:
                    target[t] += 1
    except Exception:
        pass

    return good, bad


# ============================================================
# 4. RELEVANCE SCORING / "AI AGENT"
# ============================================================

SRO_KEYWORDS = {
    "CRISIS": [
        "earthquake","typhoon","hurricane","flood","wildfire","storm","cyclone",
        "landslide","evacuation","disaster","tsunami","power outage","blackout",
        "brownout","state of emergency","curfew"
    ],
    "DUTY_OF_CARE": [
        "kidnapping","abduction","violent crime","armed robbery","shooting",
        "carjacking","terrorist","bombing","explosion","health advisory",
        "infectious disease","outbreak","pandemic","cholera","ebola","covid"
    ],
    "SUPPLY_CHAIN": [
        "port strike","dock strike","cargo theft","container theft","piracy",
        "supply chain disruption","logistics disruption","rail strike",
        "truckers strike","border closure","shipment delay","customs backlog"
    ],
    "SITE_SECURITY": [
        "intrusion","unauthorized access","security breach","gate breach",
        "badge violation","access control failure","video surveillance failure",
        "protest","road blockage","sit-in","blockade","encampment"
    ],
    "COMPLIANCE": [
        "new regulation","regulation change","corruption","fraud","money laundering",
        "law enforcement action","raid","investigation","indictment","sanction",
        "export control","fines","audit finding","compliance"
    ],
}

def rule_based_score(text: str):
    """
    Quick SRO rule hit scoring – returns (score 0-1, matched_types list)
    """
    text_l = text.lower()
    hits = []
    score = 0.05  # base noise floor

    for bucket, kws in SRO_KEYWORDS.items():
        for kw in kws:
            if kw in text_l:
                hits.append(bucket)
                score += 0.12
                break

    score = min(score, 1.0)
    return score, list(dict.fromkeys(hits))  # unique order-preserved


def feedback_term_score(text: str, good: Counter, bad: Counter):
    """
    Very small "learning" model:
    if feedback shows some terms appear more in RELEVANT than NOT_RELEVANT, boost.
    """
    text_l = text.lower()
    tokens = [t for t in re.findall(r"[a-z]{3,}", text_l)]
    if not tokens:
        return 0.0

    pos = sum(good.get(t, 0) for t in tokens)
    neg = sum(bad.get(t, 0) for t in tokens)
    total = pos + neg
    if total == 0:
        return 0.0
    raw = (pos - neg) / total  # -1 .. +1
    # squash to -0.3 .. +0.3
    return max(-0.3, min(0.3, raw * 0.6))


def gemini_rank_batch(items):
    """
    Optional: send a batch of headlines to Gemini for an extra relevance pass.
    Keeps it coarse so the dashboard stays responsive.
    If Gemini not configured, returns {}.
    """
    if not GEMINI_AVAILABLE or not items:
        return {}

    prompt_items = [
        {
            "id": i.get("id"),
            "title": i.get("title"),
            "snippet": i.get("snippet") or i.get("summary"),
            "source": i.get("source"),
        }
        for i in items
    ]

    prompt = (
        "You are a security & resilience analyst for a multinational company.\n"
        "Rate each headline for operational relevance to:\n"
        "- crisis management, duty of care, physical security, cyber, supply chain.\n"
        "Return STRICT JSON: a list of objects with keys:\n"
        "  id (copy input id), relevance (0-1 float), reason (short string).\n\n"
        f"HEADLINES:\n{json.dumps(prompt_items)}"
    )

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        resp = model.generate_content(prompt)
        text = resp.text.strip()
        # try to locate JSON inside markdown
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1:
            return {}
        data = json.loads(text[start : end + 1])
        out = {}
        for row in data:
            rid = row.get("id")
            if rid is None:
                continue
            out[str(rid)] = {
                "relevance": float(row.get("relevance", 0.0)),
                "reason": str(row.get("reason", ""))[:220],
            }
        return out
    except Exception:
        return {}


def score_articles(raw_news):
    """
    Attach:
      - os_score: final 0–1 relevance score
      - os_reason: human readable reason
    """
    good_terms, bad_terms = load_feedback_counters()
    if not raw_news:
        return []

    # Make sure each article has a stable id for Gemini + feedback
    items = []
    for idx, art in enumerate(raw_news):
        art = dict(art)
        art["id"] = art.get("id", art.get("_id", idx))
        items.append(art)

    # Optional Gemini ranking, but we ALWAYS have rule+feedback logic
    gemini_scores = gemini_rank_batch(items) if GEMINI_AVAILABLE else {}

    scored = []
    for art in items:
        title = art.get("title", "")
        snippet = art.get("snippet") or art.get("summary") or ""
        text = f"{title}. {snippet}"

        rule_score, rule_hits = rule_based_score(text)
        fb_score = feedback_term_score(text, good_terms, bad_terms)

        gem = gemini_scores.get(str(art["id"]))
        gem_score = gem["relevance"] if gem else None

        # Combine: rule is backbone, feedback adjusts, Gemini tops it up
        base = rule_score + fb_score
        if gem_score is not None:
            final = 0.4 * base + 0.6 * gem_score
        else:
            final = base

        final = max(0.0, min(1.0, final))

        # Reason text
        bits = []
        if rule_hits:
            bits.append("Rules: " + ", ".join(rule_hits))
        if fb_score > 0.05:
            bits.append("Aligned with past RELEVANT feedback")
        elif fb_score < -0.05:
            bits.append("Similar to items marked NOT relevant")
        if gem and gem.get("reason"):
            bits.append("Gemini: " + gem["reason"])
        elif not bits:
            bits.append("Baseline: generic security / risk content")

        art["os_score"] = final
        art["os_reason"] = " | ".join(bits)
        scored.append(art)

    # Highest relevance first
    scored.sort(key=lambda x: x.get("os_score", 0.0), reverse=True)
    return scored


def write_feedback(article, label):
    entry = {
        "label": label,
        "title": article.get("title"),
        "snippet": article.get("snippet") or article.get("summary"),
        "url": article.get("url"),
        "source": article.get("source"),
        "region": article.get("region"),
        "type": article.get("type"),
        "severity": article.get("severity"),
        "time_article": article.get("time"),
        "time_marked": datetime.utcnow().isoformat() + "Z",
    }
    try:
        with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        # clear cached counters so next rerun uses new learning
        load_feedback_counters.clear()
        st.toast(f"Feedback saved: {label}")
    except Exception:
        st.toast("Failed to write feedback", icon="⚠️")


# ============================================================
# 5. UI LAYOUT
# ============================================================

news_raw = load_news()
locations = load_locations()
proximity_alerts = load_proximity()
news_scored = score_articles(news_raw)

# ---- HEADER -------------------------------------------------
now = datetime.utcnow()
clock_str = now.strftime("%a %d %b %Y %H:%M UTC")

st.markdown(
    f"""
<div class="os-header">
  <div class="os-logo">OS <span>INFOHUB</span></div>
  <div class="os-sub">
    Global Security Operations | Live Stream &nbsp;|&nbsp; {clock_str}
  </div>
</div>
""",
    unsafe_allow_html=True,
)

# ---- REGION SELECTION (radio, but visually keep your pills) ----
col_tabs = st.container()
with col_tabs:
    sel_region = st.radio(
        "Region",
        REGIONS,
        horizontal=True,
        label_visibility="collapsed",
        key="region",
    )

st.markdown(
    "<div class='os-region-tabs'>"
    + "".join(
        f"<span class='os-region-pill {'active' if r==sel_region else ''}'>"
        f"<span class='os-region-pill-dot'></span>{r}</span>"
        for r in REGIONS
    )
    + "</div>",
    unsafe_allow_html=True,
)

# ---- MAIN COLUMNS -------------------------------------------
col_main, col_side = st.columns([3.2, 1.0])

# ============================================================
# 6. LEFT: MAP + REAL-TIME STREAM
# ============================================================

with col_main:
    # MAP
    if sel_region == "Global":
        map_sites = locations
    else:
        map_sites = [s for s in locations if s.get("region") == sel_region]

    # pick a sensible map centre
    if map_sites:
        avg_lat = sum(s["lat"] for s in map_sites) / len(map_sites)
        avg_lon = sum(s["lon"] for s in map_sites) / len(map_sites)
        center = [avg_lat, avg_lon]
        zoom_start = 2 if sel_region == "Global" else 3
    else:
        center = [20, 0]
        zoom_start = 2

    m = folium.Map(
        location=center,
        zoom_start=zoom_start,
        tiles="CartoDB positron",
        control_scale=True,
    )

    # Dell sites – blue pins
    for s in map_sites:
        folium.Marker(
            [s["lat"], s["lon"]],
            tooltip=f"{s.get('name')} ({s.get('country')})",
            icon=folium.Icon(color="blue", icon="building", prefix="fa"),
        ).add_to(m)

    # Proximity – red/yellow pins (if backend provided lat/lon)
    radius_km = st.session_state.get("prox_radius", 5)
    active_alerts = []
    for a in proximity_alerts:
        if sel_region != "Global" and a.get("site_region") != sel_region:
            continue
        if a.get("distance_km", 9999) > radius_km:
            continue
        if "lat" in a and "lon" in a:
            color = "red" if a.get("severity", 1) >= 3 else "orange"
            folium.Marker(
                [a["lat"], a["lon"]],
                tooltip=f"{a.get('type')} – {a.get('distance_km')}km from {a.get('site_name')}",
                icon=folium.Icon(color=color, icon="exclamation-triangle", prefix="fa"),
            ).add_to(m)
            active_alerts.append(a)

    st_folium(m, width="100%", height=420)

    # REAL-TIME STREAM
    st.markdown("#### ⚡ Real-time Intelligence Stream")

    # Filter by region
    if sel_region == "Global":
        region_news = news_scored
    else:
        region_news = [n for n in news_scored if n.get("region") == sel_region]

    # Category filter value stored in session state from side panel
    cat_val = st.session_state.get("risk_category", "All Categories")
    if cat_val != "All Categories":
        key = cat_val.split()[0].upper()  # "Physical Security" -> "PHYSICAL"
        region_news = [
            n
            for n in region_news
            if key in str(n.get("type", "")).upper()
        ]

    # Only show items above a minimal score
    visible = [n for n in region_news if n.get("os_score", 0.0) >= 0.15][:80]

    if not visible:
        st.info("No active incidents matching current filters.")
    else:
        for idx, item in enumerate(visible):
            sev = item.get("severity", 1)
            if sev >= 3:
                color_class = "os-tag os-tag-crit"
                sev_lbl = "CRITICAL"
            elif sev == 2:
                color_class = "os-tag os-tag-warn"
                sev_lbl = "WARNING"
            else:
                color_class = "os-tag os-tag-info"
                sev_lbl = "MONITOR"

            type_lbl = item.get("type") or "GENERAL"
            region_lbl = item.get("region") or "GLOBAL"
            source = item.get("source") or "Unknown source"
            time_s = item.get("time") or ""
            snippet = item.get("snippet") or item.get("summary") or ""
            url = item.get("url") or ""

            score = item.get("os_score", 0.0)
            reason = item.get("os_reason", "")

            st.markdown(
                f"""
<div class="os-card">
  <div style="margin-bottom:4px;">
    <span class="{color_class}">{sev_lbl}</span>
    <span class="os-tag os-tag-type">{type_lbl}</span>
    <span class="os-tag os-tag-region" style="float:right;">{region_lbl}</span>
  </div>
  <div class="os-card-title">
    {item.get('title')}
  </div>
  <div class="os-card-meta">
    {source} • {time_s} • Relevance score: {score:.2f}
  </div>
  <div class="os-card-body">
    {snippet}
  </div>
  <div class="os-card-meta" style="margin-top:4px; font-style:italic;">
    {reason}
  </div>
</div>
""",
                unsafe_allow_html=True,
            )

            c1, c2, _ = st.columns([1, 1, 6])
            with c1:
                if st.button("Relevant", key=f"rel_{idx}"):
                    write_feedback(item, "RELEVANT")
            with c2:
                if st.button("Not relevant", key=f"nrel_{idx}"):
                    write_feedback(item, "NOT_RELEVANT")

# ============================================================
# 7. RIGHT: HISTORY / TRAVEL / PROXIMITY / FILTER
# ============================================================

with col_side:
    # HISTORY (UI stub – backend pipeline already handles archived reporting)
    with st.container():
        st.markdown(
            '<div class="os-side-card"><div class="os-side-title">⏱ History Search</div>',
            unsafe_allow_html=True,
        )
        _ = st.date_input("Select date", key="history_date", label_visibility="collapsed")
        st.markdown(
            "<div style='font-size:0.72rem; color:#9aa0a6;'>"
            "Archive content is loaded by the backend pipeline (generate_reports.py)."
            "</div></div>",
            unsafe_allow_html=True,
        )

    # TRAVEL SAFETY – lightweight but aligned with original behaviour
    with st.container():
        st.markdown(
            '<div class="os-side-card"><div class="os-side-title">✈ Travel Safety Check</div>',
            unsafe_allow_html=True,
        )

        # Simple list: advisory countries + locations-country union
        loc_countries = sorted({s.get("country") for s in locations if s.get("country")})
        default_countries = [
            "United States","Canada","Mexico","Brazil","Ireland","United Kingdom",
            "France","Germany","Netherlands","Poland","South Africa",
            "United Arab Emirates","India","China","Japan","Singapore","Australia"
        ]
        all_countries = sorted(set(default_countries).union(loc_countries))

        country = st.selectbox("Country", all_countries, label_visibility="collapsed")

        # very simple advisory; you can later wire it to your proper advisory source
        HIGH_RISK = {
            "Afghanistan","Iraq","Syria","Yemen","Somalia","South Sudan","Mali",
            "Russia","Ukraine","Haiti"
        }
        MED_RISK = {"Mexico","India","Israel","Colombia","Nigeria","Pakistan","Lebanon"}

        if country in HIGH_RISK:
            lvl = 4
            text = "Do Not Travel – high threat and unstable security environment."
            col = "#ea4335"
        elif country in MED_RISK:
            lvl = 3
            text = "Reconsider Travel – elevated security and stability concerns."
            col = "#fbbc04"
        else:
            lvl = 2
            text = "Exercise Increased Caution – monitor local conditions."
            col = "#1a73e8"

        st.markdown(
            f"""
<div class="os-card-meta" style="margin-bottom:4px;">Advisory level</div>
<div style="border-left: 3px solid {col}; padding: 6px 8px; background: rgba(26,115,232,0.07); border-radius:6px;">
  <div style="font-size:0.78rem; font-weight:700; color:{col};">LEVEL {lvl}</div>
  <div style="font-size:0.78rem; color:#e8eaed;">{text}</div>
</div>
""",
            unsafe_allow_html=True,
        )

        # Tie in with news feed – recent items mentioning that country name
        hits = [
            n
            for n in news_scored
            if country.lower() in (n.get("title", "") + " " + (n.get("snippet") or "")).lower()
        ]
        st.markdown(
            "<div class='os-card-meta' style='margin-top:6px;'>Recent incidents (last fetch)</div>",
            unsafe_allow_html=True,
        )
        if hits:
            for h in hits[:3]:
                st.markdown(
                    f"<div style='font-size:0.74rem; border-bottom:1px solid #262831; padding:3px 0;'>• {h['title']}</div>",
                    unsafe_allow_html=True,
                )
        else:
            st.markdown(
                "<div style='font-size:0.74rem; color:#81c995;'>No specific incidents in current feed.</div>",
                unsafe_allow_html=True,
            )

        st.markdown("</div>", unsafe_allow_html=True)

    # PROXIMITY ALERTS PANEL
    with st.container():
        st.markdown(
            '<div class="os-side-card"><div class="os-side-title">📍 Proximity Alerts</div>',
            unsafe_allow_html=True,
        )
        rad_choice = st.selectbox(
            "Radius",
            [5, 10, 25, 50],
            index=0,
            label_visibility="collapsed",
            key="prox_radius",
            format_func=lambda x: f"{x} KM (Default)" if x == 5 else f"{x} KM",
        )

        # re-use same filter as map
        filtered_alerts = []
        for a in proximity_alerts:
            if sel_region != "Global" and a.get("site_region") != sel_region:
                continue
            if a.get("distance_km", 9999) <= rad_choice:
                filtered_alerts.append(a)

        if not filtered_alerts:
            st.markdown(
                "<div style='font-size:0.74rem; color:#9aa0a6; text-align:center; padding:6px 0;'>"
                f"No alerts within {rad_choice}km of Dell sites.</div>",
                unsafe_allow_html=True,
            )
        else:
            for a in filtered_alerts[:20]:
                sev = a.get("severity", 1)
                color = "#ea4335" if sev >= 3 else "#fbbc04"
                st.markdown(
                    f"""
<div class="os-alert-row">
  <div class="os-alert-top">
    <span style="color:{color}; font-weight:600;">{a.get('type')}</span>
    <span style="color:{color}; font-weight:600;">{a.get('distance_km')}km</span>
  </div>
  <div class="os-alert-site">{a.get('site_name')}</div>
  <div style="font-size:0.72rem; color:#e8eaed;">{a.get('article_title','')}</div>
</div>
""",
                    unsafe_allow_html=True,
                )

        st.markdown("</div>", unsafe_allow_html=True)

    # CATEGORY FILTER (drives main feed)
    with st.container():
        st.markdown(
            '<div class="os-side-card"><div class="os-side-title">🏷 Risk Category Filter</div>',
            unsafe_allow_html=True,
        )
        _ = st.selectbox(
            "Category",
            ["All Categories", "Physical Security", "Cyber Security", "Supply Chain", "Compliance / Legal", "Crisis / Natural Hazard"],
            key="risk_category",
            label_visibility="collapsed",
        )
        st.markdown(
            "<div class='os-card-meta' style='margin-top:6px;'>"
            "Filter applies to the real-time stream and proximity overlays."
            "</div></div>",
            unsafe_allow_html=True,
        )
