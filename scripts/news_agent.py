import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
import feedparser
from bs4 import BeautifulSoup
import re

try:
    import google.generativeai as genai
except Exception:
    genai = None

# ---------- PATHS ----------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# ---------- 1. STRICT POSITIVE SELECTION (Article MUST match one to be kept) ----------
MUST_HAVE_TERMS = [
    # Crisis / Resilience
    "earthquake", "tsunami", "volcano", "flood", "flash flood", 
    "typhoon", "cyclone", "hurricane", "tornado", "storm", "wildfire", "bushfire",
    "power outage", "blackout", "grid failure", "port closure", "airport closed", 
    "flights cancelled", "explosion", "blast", "derailment", "collapse",
    
    # Security / Duty of Care
    "terror", "bomb", "suicide", "attack", "gunman", "shooting", "active shooter",
    "kidnap", "abduction", "hostage", "assassination", "murder", "stabbing",
    "riot", "civil unrest", "violent protest", "clashes", "tear gas", "curfew", 
    "martial law", "coup", "state of emergency", "evacuation", "lockdown",
    
    # Supply Chain
    "strike", "walkout", "labor dispute", "port strike", "cargo theft", 
    "supply chain", "manufacturing halt", "factory fire", "logistics disruption",
    
    # Cyber (Physical Impact focus)
    "ransomware", "data breach", "cyberattack", "scada", "industrial control", 
    "infrastructure", "telecom outage", "cable cut", "satellite", "vulnerability", "zero-day"
]

# ---------- 2. BLOCKLIST (Kill these instantly) ----------
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament", 
    "olympic", "championship", "medal", "score", "vs",
    "celebrity", "entertainment", "movie", "film", "star", "actor", "actress", "concert",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", 
    "aftermath of", "reopens after", "normalcy returns", "anniversary", "memorial", "search for",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion", "museum", "art",
    "opinion:", "editorial:", "review:", "cultivation", "poppy", "drug trade", "estate dispute",
    "husband", "wife", "marriage", "divorce", "mh370", "missing flight", "tourism", "tourist"
]

# ---------- FEEDS ----------
FEEDS = [
    'https://feeds.reuters.com/reuters/worldNews',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.bleepingcomputer.com/feed/', # Cyber
    'https://www.cisa.gov/cybersecurity-advisories/all.xml', # US Gov Cyber
    'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml', # UK Gov Cyber
    'https://www.supplychainbrain.com/rss/logistics-and-transportation', # Logistics
    'https://reliefweb.int/updates/rss.xml', # Humanitarian/Disaster
    'https://www.scmp.com/rss/91/feed',  # Asia specific
    'https://www.straitstimes.com/news/asia/rss.xml' # Asia specific
]

GEMINI_MODEL = "gemini-1.5-flash"

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None: return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def clean_html(html):
    if not html: return ""
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    # FORCE TRUNCATION TO 200 CHARS
    return text[:200] + "..." if len(text) > 200 else text

def is_sro_relevant(text):
    text = text.lower()
    # 1. Blocklist (Kill noise)
    for word in BLOCKLIST:
        if word in text: return False
    # 2. Positive Selection (Must contain a threat keyword)
    for keyword in MUST_HAVE_TERMS:
        if keyword in text: return True
    return False

def get_sro_category_severity(text):
    text = text.lower()
    # Default
    cat = "GENERAL"
    sev = 1
    
    if any(x in text for x in ["ransomware", "cyber", "hack", "breach"]):
        cat = "CYBER SECURITY"
        sev = 3
    elif any(x in text for x in ["earthquake", "flood", "typhoon", "storm"]):
        cat = "CRISIS / WEATHER"
        sev = 2
    elif any(x in text for x in ["strike", "cargo", "port", "supply chain"]):
        cat = "SUPPLY CHAIN"
        sev = 2
    elif any(x in text for x in ["attack", "shooting", "bomb", "terror", "riot", "unrest"]):
        cat = "PHYSICAL SECURITY"
        sev = 3
        
    return cat, sev

def ai_process(model, title, summary, current_cat, current_sev):
    if not model: return True, current_sev, summary, current_cat
    
    prompt = f"""
    Role: Security Analyst for Dell SRO.
    Task: Filter for OPERATIONAL IMPACT.
    Input: "{title} - {summary}"
    
    Rules:
    1. EXCLUDE: Politics, Sports, General Crime, Post-event cleanup, Historical articles, Drugs/Opium.
    2. INCLUDE: Active threats to staff, facilities, supply chain, or travel.
    3. Severity: 3 (Life Safety/Critical Ops), 2 (Warning/Disruption), 1 (Monitor/Info).
    4. One Liner: Summarize impact in max 15 words.
    
    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Impact summary", "category": "{current_cat}"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary), data.get("category", current_cat)
    except:
        return True, current_sev, summary, current_cat

def main():
    print("Running SRO Intel Agent...")
    all_items = []
    seen = set()
    model = init_gemini()

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            for e in f.entries[:15]:
                title = e.title.strip()
                if title in seen: continue
                seen.add(title)
                
                raw_summary = clean_html(getattr(e, "summary", ""))
                full_text = f"{title} {raw_summary}"
                
                # STRICT FILTERING
                if not is_sro_relevant(full_text):
                    continue

                # PRE-CALC CATEGORY
                cat, sev = get_sro_category_severity(full_text)

                # AI REFINEMENT
                keep, severity, snippet, category = ai_process(model, title, raw_summary, cat, sev)
                if not keep: continue

                # Normalization
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                region = "Global"
                t_lower = full_text.lower()
                if any(x in t_lower for x in ["china","asia","india","japan","australia","thailand","vietnam"]): region = "APJC"
                elif any(x in t_lower for x in ["uk","europe","gaza","israel","russia","ukraine","germany"]): region = "EMEA"
                elif any(x in t_lower for x in ["usa","america","canada","brazil","mexico","colombia"]): region = "AMER"

                all_items.append({
                    "title": title, "url": e.link, 
                    "snippet": snippet[:200], # Double check truncation
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": category
                })
        except Exception as x:
            print(f"Error {url}: {x}")

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)
    print(f"Saved {len(all_items)} SRO-relevant articles.")

if __name__ == "__main__":
    main()
