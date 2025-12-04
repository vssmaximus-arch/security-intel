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

# ---------- 1. STRICT POSITIVE KEYWORDS (Must match to be kept) ----------
# If the news doesn't contain one of these, it is TRASHED.
MUST_HAVE_TERMS = [
    # Crisis
    "earthquake", "tsunami", "flood", "typhoon", "cyclone", "hurricane", "tornado", "wildfire", 
    "power outage", "blackout", "grid failure", "port closure", "airport closed", "flights cancelled",
    "state of emergency", "evacuation", "derailment", "collapse",
    # Security
    "terror", "bomb", "suicide", "attack", "gunman", "shooting", "active shooter", "kidnap", 
    "hostage", "assassination", "riot", "civil unrest", "violent protest", "tear gas", 
    "curfew", "martial law", "coup", "security breach", "intrusion",
    # Supply Chain
    "strike", "walkout", "labor dispute", "port strike", "cargo theft", "supply chain disruption", 
    "shipping delay", "customs halt", "manufacturing stop", "factory fire", "production halt",
    # Cyber
    "ransomware", "data breach", "cyberattack", "scada", "industrial control", "zero-day", 
    "vulnerability", "ddos", "malware", "spyware", "telecom outage", "cable cut"
]

# ---------- 2. BLOCKLIST (Safety Net) ----------
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament", 
    "olympic", "championship", "medal", "score", "vs", "final", "win", "loss",
    "celebrity", "entertainment", "movie", "film", "star", "actor", "actress", "concert",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", 
    "aftermath of", "reopens after", "normalcy returns", "anniversary", "memorial", 
    "search for", "found dead", "body found", "investigation into", # Post-event/Minor
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion", "museum", "art",
    "opinion:", "editorial:", "review:", "cultivation", "poppy", "drug trade", "estate dispute",
    "election results", "polling", "vote count", "campaign", "parliament", "senate"
]

# ---------- FEEDS ----------
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
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    return text[:200] + "..." if len(text) > 200 else text # FORCE TRUNCATION

def get_category_and_severity(text):
    text = text.lower()
    
    # Blocklist check
    for bad in BLOCKLIST:
        if bad in text: return None, 0

    # Positive Match check
    found = False
    for good in MUST_HAVE_TERMS:
        if good in text: 
            found = True
            break
    if not found: return None, 0

    # Categorization
    if any(x in text for x in ["ransomware", "cyber", "hack", "breach", "vulnerability"]):
        return "CYBER SECURITY", 3
    if any(x in text for x in ["strike", "cargo", "port", "supply chain", "shipping", "logistics"]):
        return "SUPPLY CHAIN", 2
    if any(x in text for x in ["earthquake", "flood", "storm", "typhoon", "hurricane", "outage"]):
        return "CRISIS / WEATHER", 2
    if any(x in text for x in ["attack", "shooting", "bomb", "terror", "riot", "unrest", "kidnap"]):
        return "PHYSICAL SECURITY", 3
    
    return "MONITOR", 1 # Default low severity if it passed keyword check but not specific category

def ai_process(model, title, summary, current_cat, current_sev):
    if not model: return True, current_sev, summary, current_cat
    
    prompt = f"""
    Role: Security Analyst.
    Task: Filter for OPERATIONAL IMPACT.
    Input: "{title} - {summary}"
    
    Rules:
    1. DELETE if Sports, Politics, Celebrity, Drugs/Opium, or Post-Event Cleanup.
    2. KEEP if Active Threat (Fire, Strike, Cyber, Weather).
    3. REWRITE summary to max 15 words.
    4. SEVERITY: 3 (Critical/Life Safety), 2 (Warning/Disruption), 1 (Info).
    
    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Summary...", "category": "{current_cat}"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", current_sev), data.get("one_liner", summary), data.get("category", current_cat)
    except:
        return True, current_sev, summary, current_cat

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
                
                # 1. STRICT KEYWORD FILTER
                category, severity = get_category_and_severity(full_text)
                if not category: continue # Drop it

                # 2. AI REFINEMENT
                keep, severity, snippet, final_cat = ai_process(model, title, raw_summary, category, severity)
                if not keep: continue

                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                # Region Logic
                region = "Global"
                t_lower = full_text.lower()
                if any(x in t_lower for x in ["china","asia","india","japan","australia","thailand","vietnam"]): region = "APJC"
                elif any(x in t_lower for x in ["uk","europe","germany","france","poland","ireland"]): region = "EMEA"
                elif any(x in t_lower for x in ["usa","america","canada","brazil","mexico","colombia"]): region = "AMER"

                all_items.append({
                    "title": title, "url": e.link, "snippet": snippet[:200], # Hard truncate
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": final_cat
                })
        except: pass

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)

if __name__ == "__main__":
    main()
