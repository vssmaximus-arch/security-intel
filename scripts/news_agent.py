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

# --- SRO PILLAR MAPPING (STRICT) ---
SRO_CATEGORIES = {
    "RESILIENCE / CRISIS": ["earthquake", "flood", "typhoon", "cyclone", "hurricane", "power outage", "blackout", "grid failure", "disaster", "state of emergency"],
    "DUTY OF CARE": ["kidnap", "shooting", "active shooter", "terror", "bomb", "hostage", "assassination", "civil unrest", "riot", "epidemic", "outbreak"],
    "SUPPLY CHAIN": ["port strike", "cargo theft", "supply chain", "logistics disruption", "shipping delay", "manufacturing halt", "factory fire", "semiconductor"],
    "SITE SECURITY": ["intrusion", "security breach", "unauthorized access", "access control", "video surveillance failure", "insider threat", "perimeter breach"],
    "COMPLIANCE": ["new regulation", "security law", "data protection law", "sanctions", "law enforcement raid", "corruption investigation"]
}

# --- BLOCKLIST (KILL NOISE) ---
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", 
    "celebrity", "entertainment", "movie", "film", "star", "actor", "concert",
    "residents return", "collect personal items", "cleanup begins", "recovery continues", 
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "opinion:", "editorial:", "cultivation", "poppy", "drug trade", "opium", 
    "husband", "wife", "marriage", "divorce", "estate dispute", "MH370", "search for missing"
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

def get_sro_category(text):
    text = text.lower()
    # 1. Blocklist
    for word in BLOCKLIST:
        if word in text: return None
    # 2. Positive Match
    for cat, keywords in SRO_CATEGORIES.items():
        for kw in keywords:
            if kw in text: return cat
    return None

def ai_process(model, title, summary, category):
    if not model: return True, 2, summary[:200] + "...", category
    prompt = f"""
    Role: Security Analyst for Dell SRO.
    Task: Filter for OPERATIONAL IMPACT.
    Input: "{title} - {summary}"
    Category: {category}
    Rules:
    1. REJECT: Politics, Sports, General Crime, Fluff, Post-event cleanup.
    2. KEEP: Active threats to staff, facilities, supply chain.
    3. Severity: 3 (Life Safety/Critical), 2 (Disruption), 1 (Awareness).
    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Impact summary", "category": "{category}"}}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary), data.get("category", category)
    except:
        return True, 2, summary, category

def main():
    all_items = []
    seen = set()
    model = init_gemini()

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            for e in f.entries[:20]:
                title = e.title.strip()
                if title in seen: continue
                seen.add(title)
                
                raw_summary = clean_html(getattr(e, "summary", ""))
                full_text = f"{title} {raw_summary}"
                
                category = get_sro_category(full_text)
                if not category: continue # DROP IRRELEVANT

                keep, severity, snippet, final_cat = ai_process(model, title, raw_summary, category)
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
                    "title": title, "url": e.link, "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": final_cat
                })
        except: pass

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)

if __name__ == "__main__":
    main()
