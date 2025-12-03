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

# Aggressive Blocklist
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup",
    "celebrity", "entertainment", "movie", "film", "star",
    "residents return", "collect personal items", "cleanup begins", "recovery continues",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle"
]

FEEDS = [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.reuters.com/reuters/worldNews',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.theguardian.com/world/rss',
    'https://www.scmp.com/rss/91/feed',
    'https://www.straitstimes.com/news/asia/rss.xml',
    'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',
    'https://www.bleepingcomputer.com/feed/',
    'https://www.cisa.gov/cybersecurity-advisories/all.xml'
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

def is_blocked(text):
    t = text.lower()
    for word in BLOCKLIST:
        if word in t: return True
    return False

def ai_process(model, title, summary):
    if not model: return True, 2, summary[:200] + "..."
    prompt = f"""
    Role: Security Intelligence Analyst.
    Task: Assess relevance for Corporate Security (SRO).
    Input: "{title} - {summary}"
    Rules:
    1. REJECT (keep=false): Sports, Entertainment, Politics (unless violent), Post-disaster cleanup/recovery stories (e.g. residents returning).
    2. KEEP (keep=true): Active threats, ongoing protests, fresh attacks, cyber breaches, travel bans.
    3. Severity: 3 (Critical/Life Safety), 2 (Warning), 1 (Info).
    Output JSON: {{"keep": true/false, "severity": 1-3, "one_liner": "Concise impact summary"}}
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

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            for e in f.entries[:15]:
                title = e.title.strip()
                if title in seen: continue
                seen.add(title)
                
                raw_summary = clean_html(getattr(e, "summary", ""))
                if is_blocked(f"{title} {raw_summary}"): continue

                keep, severity, snippet = ai_process(model, title, raw_summary)
                if not keep: continue

                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                # Simple Region Classification
                t_lower = (title + raw_summary).lower()
                region = "Global"
                if any(x in t_lower for x in ["china","asia","india","japan","australia"]): region = "APJC"
                elif any(x in t_lower for x in ["uk","europe","gaza","israel","russia"]): region = "EMEA"
                elif any(x in t_lower for x in ["usa","america","canada","brazil"]): region = "AMER"

                all_items.append({
                    "title": title, "url": e.link, "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts, "region": region, "severity": severity, "type": "GENERAL"
                })
        except: pass

    all_items.sort(key=lambda x: x["time"], reverse=True)
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)

if __name__ == "__main__":
    main()
