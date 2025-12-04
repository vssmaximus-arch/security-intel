import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
import feedparser
from bs4 import BeautifulSoup

try:
    import google.generativeai as genai
except Exception:
    genai = None

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# --- 1. STRICT POSITIVE SELECTION (Must match specific threats) ---
MUST_MATCH = [
    "earthquake", "tsunami", "flood", "typhoon", "cyclone", "hurricane", "tornado", "wildfire", "bushfire",
    "power outage", "blackout", "grid failure", "port closure", "airport closed", "flights cancelled",
    "terror", "bomb", "suicide", "attack", "gunman", "shooting", "kidnap", "hostage", "assassination", 
    "riot", "civil unrest", "violent protest", "tear gas", "curfew", "martial law", "coup", "state of emergency",
    "strike", "port strike", "cargo theft", "supply chain disruption", "factory fire", "manufacturing halt",
    "ransomware", "data breach", "cyberattack", "scada", "industrial control", "zero-day", "vulnerability"
]

# --- 2. BLOCKLIST (Kill Noise) ---
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament", 
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", "aftermath of",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "opinion:", "editorial:", "cultivation", "poppy", "drug trade", "opium", "estate dispute", "MH370"
]

FEEDS = [
    'https://feeds.reuters.com/reuters/worldNews',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.bleepingcomputer.com/feed/',
    'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    'https://www.supplychainbrain.com/rss/logistics-and-transportation',
    'https://reliefweb.int/updates/rss.xml',
    'https://www.scmp.com/rss/91/feed',
    'https://www.straitstimes.com/news/asia/rss.xml'
]

GEMINI_MODEL = "gemini-1.5-flash"

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None: return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def clean_html(html):
    if not html: return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_relevant(text):
    text = text.lower()
    # 1. Check Blocklist (Fast fail)
    for word in BLOCKLIST:
        if word in text: return False
    # 2. Check Positive Match (Must have 1 valid keyword)
    for keyword in MUST_MATCH:
        if keyword in text: return True
    return False

def ai_process(model, title, summary):
    if not model: return True, 2, summary[:200] + "...", "GENERAL"
    
    prompt = f"""
    Role: Security Analyst for Dell SRO.
    Task: Filter for OPERATIONAL IMPACT.
    Input: "{title} - {summary}"
    Rules:
    1. REJECT (keep=false): Politics, Sports, General Crime, Post-event cleanup, Opium/Drugs.
    2. KEEP (keep=true): Active threats to staff, facilities, supply chain, or travel.
    3. Severity: 3 (Life Safety/Critical Ops), 2 (Disruption), 1 (Awareness).
    4. Category: "CYBER SECURITY", "PHYSICAL SECURITY", "SUPPLY CHAIN", "CRISIS / WEATHER", "HEALTH".
    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Impact summary", "category": "CATEGORY"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary), data.get("category", "GENERAL")
    except:
        return True, 2, summary, "GENERAL"

def main():
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
                
                if not is_relevant(full_text): continue

                keep, severity, snippet, category = ai_process(model, title, raw_summary)
                if not keep: continue

                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                region = "Global"
                t_lower = full_text.lower()
                if any(x in t_lower for x in ["china","asia","india","japan","australia"]): region = "APJC"
                elif any(x in t_lower for x in ["uk","europe","germany","france"]): region = "EMEA"
                elif any(x in t_lower for x in ["usa","america","canada","brazil"]): region = "AMER"

                all_items.append({
                    "title": title, "url": e.link, "snippet": snippet[:200],
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": category.upper()
                })
        except: pass

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)

if __name__ == "__main__":
    main()
