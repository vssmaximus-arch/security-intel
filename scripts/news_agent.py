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

# ---------- STRICT SRO CATEGORIZATION & FILTERING ----------
# Logic: An article MUST hit a keyword in one of these lists to be kept.
# If it hits a keyword, it gets assigned that Category.

SRO_FILTERS = {
    "CYBER SECURITY": [
        "ransomware", "data breach", "cyberattack", "scada", "industrial control", 
        "zero-day", "vulnerability", "ddos", "malware", "spyware", "hacker", 
        "telecom outage", "internet outage", "system failure"
    ],
    "SUPPLY CHAIN": [
        "port strike", "cargo theft", "supply chain disruption", "logistics", 
        "shipping delay", "customs halt", "manufacturing stop", "factory fire", 
        "production halt", "semiconductor", "labor dispute", "trade route"
    ],
    "CRISIS / WEATHER": [
        "earthquake", "tsunami", "typhoon", "cyclone", "hurricane", "tornado", 
        "flash flood", "wildfire", "bushfire", "power outage", "blackout", 
        "grid failure", "state of emergency", "airport closed", "flights cancelled"
    ],
    "PHYSICAL SECURITY": [
        "active shooter", "terror", "bomb", "explosion", "ied", "shooting", 
        "kidnap", "hostage", "assassination", "civil unrest", "violent protest", 
        "riot", "tear gas", "curfew", "martial law", "coup", "armed attack"
    ],
    "HEALTH / SAFETY": [
        "epidemic", "outbreak", "infectious disease", "quarantine", "travel ban",
        "radiation", "chemical spill", "hazmat"
    ]
}

# ---------- BLOCKLIST (Safety Net) ----------
# Even if it hits a keyword (e.g. "fire" in a movie title), these kill it.
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament", 
    "olympic", "championship", "medal", "score", "vs", "final", "win", "loss",
    "celebrity", "entertainment", "movie", "film", "star", "actor", "actress", "concert",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", 
    "aftermath of", "reopens after", "normalcy returns", "anniversary", "memorial", 
    "search for", "found dead", "body found", # Minor crimes
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion", "museum", "art",
    "opinion:", "editorial:", "review:", "cultivation", "poppy", "drug trade", "estate dispute",
    "election results", "polling", "vote count", "campaign", "parliament" # Generic politics
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
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def classify_and_filter(text):
    """Returns (Category, Is_Relevant)"""
    text_lower = text.lower()
    
    # 1. Check Blocklist
    for word in BLOCKLIST:
        if word in text_lower: return None, False
        
    # 2. Check SRO Categories (Positive Selection)
    for category, keywords in SRO_FILTERS.items():
        for kw in keywords:
            if kw in text_lower:
                return category, True
                
    return "GENERAL", False # Dropped if no keyword match

def ai_process(model, title, summary, category):
    if not model: return True, 2, summary[:200] + "...", category
    
    prompt = f"""
    Role: Security Analyst for Dell SRO.
    Task: Assess relevance for Corporate Security.
    Input: "{title} - {summary}"
    Detected Category: {category}
    
    Rules:
    1. STRICTLY EXCLUDE: Politics, Sports, General Crime, Post-event cleanup, Opium/Drugs.
    2. INCLUDE ONLY: Active threats to staff, facilities, supply chain, or travel.
    3. Severity: 3 (Life Safety/Critical Ops), 2 (Disruption), 1 (Awareness).
    4. One Liner: Summarize the operational impact in 1 sentence.
    
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
            for e in f.entries[:20]: # Check more, filter harder
                title = e.title.strip()
                if title in seen: continue
                seen.add(title)
                
                raw_summary = clean_html(getattr(e, "summary", ""))
                full_text = f"{title} {raw_summary}"
                
                # 1. STRICT CLASSIFICATION
                category, is_relevant = classify_and_filter(full_text)
                if not is_relevant:
                    continue # Silently drop irrelevant news

                # 2. AI RE-VERIFICATION (If available)
                keep, severity, snippet, final_cat = ai_process(model, title, raw_summary, category)
                if not keep:
                    continue

                # 3. REGION
                region = "Global"
                t_lower = full_text.lower()
                if any(x in t_lower for x in ["china","asia","india","japan","australia","thailand","vietnam"]): region = "APJC"
                elif any(x in t_lower for x in ["uk","europe","gaza","israel","russia","ukraine","germany"]): region = "EMEA"
                elif any(x in t_lower for x in ["usa","america","canada","brazil","mexico","colombia"]): region = "AMER"

                # 4. TIMESTAMP
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

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
