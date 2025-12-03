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

# ---------- SRO FILTERING LOGIC ----------

# 1. IMMEDIATE BLOCK (Noise, Sports, Celebs, Post-Event)
BLOCKLIST = [
    # Sports & Entertainment
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament",
    "celebrity", "entertainment", "movie", "film", "star", "actor", "actress",
    "horoscope", "lottery", "gossip", "lifestyle", "fashion", "royal family",
    
    # Post-Event / Low Impact (SRO doesn't need "cleanup" news)
    "residents return", "collect personal items", "cleanup begins", "recovery continues", 
    "aftermath of", "reopens after", "normalcy returns",
    
    # Generic / Irrelevant
    "opinion:", "editorial:", "review:", "best of", "top 10", "stock market", "shares", "investor"
]

# 2. CYBER FILTER (Exclude generic IT, Keep Physical/Operational)
# If title contains these, DROP IT...
CYBER_NOISE = ["phishing", "data breach", "malware", "virus", "scam", "crypto", "bitcoin", "nft"]
# ...UNLESS it also contains these (Operational Impact):
CYBER_CRITICAL = ["industrial", "scada", "manufacturing", "logistics", "transport", "energy", "grid", "pipeline", "hospital", "port", "airline"]

# 3. CRITICAL KEYWORDS (Keep these high priority)
CRITICAL_TERMS = [
    # Crisis / Resilience
    "earthquake", "flood", "typhoon", "cyclone", "tsunami", "power outage", "blackout",
    "grid failure", "dam failure", "port closure", "airport closure", "state of emergency",
    
    # Duty of Care / Safety
    "kidnap", "abduction", "hostage", "shooting", "armed attack", "terror", "bomb", "explosion",
    "assassination", "civil unrest", "riot", "curfew", "martial law", "strike", "protest",
    "epidemic", "outbreak", "infectious disease",
    
    # Supply Chain
    "supply chain disruption", "cargo theft", "truck hijack", "shipping delay", "port congestion",
    "warehouse fire", "factory fire", "manufacturing halt", "production stop"
]

# ---------- FEEDS ----------
FEEDS = [
    'https://feeds.reuters.com/reuters/worldNews',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.scmp.com/rss/91/feed',  # APJC Critical
    'https://www.straitstimes.com/news/asia/rss.xml', # APJC Critical
    'https://www.bleepingcomputer.com/feed/',
    'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    'https://www.supplychainbrain.com/rss/logistics-and-transportation',
    'https://www.maritime-executive.com/rss/all/security'
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

def is_sro_relevant(title, summary):
    text = (title + " " + summary).lower()
    
    # 1. Blocklist Check
    for word in BLOCKLIST:
        if word in text: return False
        
    # 2. Cyber Noise Check
    if any(w in text for w in CYBER_NOISE):
        # Only keep if it hits a CRITICAL infrastructure term
        if not any(c in text for c in CYBER_CRITICAL):
            return False

    # 3. Inclusion Check (Must hit a relevant pillar)
    # If it's a specific security feed (like CISA), we might be more lenient, 
    # but for general news, we want a keyword match.
    if any(w in text for w in CRITICAL_TERMS):
        return True
        
    return False

def ai_process(model, title, summary):
    if not model: return True, 2, summary[:200] + "..."
    
    prompt = f"""
    Role: Security Intelligence Analyst for Dell SRO.
    Task: Filter news based on Operational Impact.
    
    Input: "{title} - {summary}"
    
    STRICT FILTERING RULES:
    1. DISCARD (keep=false) if:
       - Sports, Entertainment, Celebrity, General Politics.
       - "Post-event" recovery (e.g., cleanup, residents returning).
       - Generic Cyber (phishing, data breach) WITHOUT physical/operational impact.
       - Minor crime (unless targeting assets/executives).
       
    2. KEEP (keep=true) if:
       - Active Threat to Life/Safety (Unrest, Terror, Disaster).
       - Impact to Infrastructure (Power, Comms, Transport, Ports).
       - Supply Chain Disruption (Strikes, route blockages).
       - Duty of Care Risks (Kidnap, Disease outbreak).

    3. Severity: 3 (Critical/Life Safety), 2 (Warning/Disruption), 1 (Info).
    4. One Liner: Write a crisp, executive summary (max 15 words) focusing on the IMPACT.

    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Impact summary"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary)
    except:
        return True, 2, summary

def main():
    all_items = []
    seen = set()
    model = init_gemini()

    print("Fetching and Filtering feeds...")
    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            for e in f.entries[:15]:
                title = e.title.strip()
                if title in seen: continue
                seen.add(title)
                
                raw_summary = clean_html(getattr(e, "summary", ""))
                
                # Pre-filter (Save AI tokens and reduce noise)
                if not is_sro_relevant(title, raw_summary):
                    continue

                # AI Processing
                keep, severity, snippet = ai_process(model, title, raw_summary)
                if not keep: continue

                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                # Region Logic
                full_text = (title + " " + raw_summary).lower()
                region = "Global"
                if any(x in full_text for x in ["china","asia","india","japan","australia","thailand","vietnam"]): region = "APJC"
                elif any(x in full_text for x in ["uk","europe","gaza","israel","russia","ukraine","germany"]): region = "EMEA"
                elif any(x in full_text for x in ["usa","america","canada","brazil","mexico","colombia"]): region = "AMER"

                all_items.append({
                    "title": title, "url": e.link, "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": "GENERAL"
                })
        except Exception as x:
            print(f"Error {url}: {x}")

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)
    print(f"Saved {len(all_items)} relevant articles.")

if __name__ == "__main__":
    main()
