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

# ---------- PATHS ----------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)
NEWS_PATH = os.path.join(DATA_DIR, "news.json")

# ---------- SRO CATEGORY DEFINITIONS (Strict Positive Logic) ----------
# An article MUST match one of these to be kept.
SRO_CATEGORIES = {
    "CYBER SECURITY": [
        "ransomware", "data breach", "cyberattack", "scada", "industrial control", 
        "zero-day", "vulnerability", "ddos", "hacker", "malware", "spyware", 
        "telecom outage", "cable cut"
    ],
    "SUPPLY CHAIN": [
        "port strike", "cargo theft", "supply chain disruption", "logistics", 
        "shipping delay", "customs halt", "manufacturing stop", "factory fire", 
        "production halt", "semiconductor shortage"
    ],
    "CRISIS / WEATHER": [
        "earthquake", "tsunami", "typhoon", "cyclone", "hurricane", "tornado", 
        "flash flood", "wildfire", "power outage", "blackout", "grid failure", 
        "state of emergency", "airport closed", "flights cancelled"
    ],
    "PHYSICAL SECURITY": [
        "active shooter", "terror attack", "bomb", "explosion", "ied", "shooting", 
        "kidnap", "hostage", "assassination", "civil unrest", "violent protest", 
        "riot", "tear gas", "curfew", "martial law", "coup"
    ],
    "HEALTH / SAFETY": [
        "epidemic", "outbreak", "infectious disease", "quarantine", "travel ban",
        "radiation leak", "chemical spill", "hazmat"
    ]
}

# ---------- BLOCKLIST (Kill these instantly) ----------
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament", 
    "olympic", "championship", "medal", "score", "vs", "final", "win", "loss",
    "celebrity", "entertainment", "movie", "film", "star", "actor", "actress", "concert",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", 
    "aftermath of", "reopens after", "normalcy returns", "anniversary", "memorial", 
    "search for", "found dead", "body found", # Minor crimes
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion", "museum", "art",
    "opinion:", "editorial:", "review:", "cultivation", "poppy", "drug trade", "estate dispute",
    "election results", "polling", "vote count" # Generic politics
]

# ---------- FEEDS (Major Global & Security Only) ----------
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
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def get_sro_category(text):
    text = text.lower()
    # 1. Check Blocklist first
    for word in BLOCKLIST:
        if word in text: return None
        
    # 2. Check SRO Categories
    for category, keywords in SRO_CATEGORIES.items():
        for kw in keywords:
            if kw in text:
                return category
    return None

def ai_process(model, title, summary, category):
    if not model: return True, 2, summary[:200] + "...", category
    prompt = f"""
    Role: Security Analyst for Dell SRO.
    Task: Filter for OPERATIONAL IMPACT.
    Input: "{title} - {summary}"
    Detected Category: {category}
    
    Rules:
    1. EXCLUDE: Politics, Sports, General Crime, Post-event cleanup, Historical articles.
    2. INCLUDE: Active threats to staff, facilities, supply chain, or travel.
    3. Severity: 3 (Life Safety/Critical Ops), 2 (Disruption), 1 (Awareness).
    
    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Impact summary", "category": "{category}"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary), data.get("category", category)
    except:
        return True, 2, summary, category

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
                
                # STRICT CATEGORIZATION
                category = get_sro_category(full_text)
                if not category:
                    continue # Drop if it doesn't match SRO pillars

                keep, severity, snippet, final_cat = ai_process(model, title, raw_summary, category)
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
                    "title": title, "url": e.link, "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": final_cat
                })
                print(f"[+] Added: {title} [{final_cat}]")

        except Exception as x:
            print(f"Error {url}: {x}")

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)
    print(f"Saved {len(all_items)} SRO-relevant articles.")

if __name__ == "__main__":
    main()
