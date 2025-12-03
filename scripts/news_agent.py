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

# ---------- BLOCKLIST (Aggressive Filtering) ----------
# Kill these topics instantly before they reach AI or the dashboard
BLOCKLIST = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup",
    "celebrity", "entertainment", "movie", "film", "star",
    "residents return", "collect personal items", "cleanup begins", # Post-event fluff
    "lottery", "horoscope", "royal family", "gossip"
]

# ---------- FEEDS ----------
FEEDS = [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.reuters.com/reuters/worldNews',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.theguardian.com/world/rss',
    'https://www.scmp.com/rss/91/feed', # APJC focus
    'https://www.straitstimes.com/news/asia/rss.xml',
    'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', # India
    'https://www.bleepingcomputer.com/feed/', # Cyber
    'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    'https://ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml'
]

GEMINI_MODEL = "gemini-1.5-flash"

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def classify_region(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["china", "hong kong", "taiwan", "japan", "india", "australia", "asia", "korea", "singapore", "malaysia"]): return "APJC"
    if any(x in t for x in ["uk", "europe", "germany", "france", "africa", "middle east", "israel", "gaza", "ukraine", "russia"]): return "EMEA"
    if any(x in t for x in ["brazil", "mexico", "latin america", "colombia", "argentina"]): return "LATAM"
    if any(x in t for x in ["usa", "u.s.", "united states", "canada", "america"]): return "AMER"
    return "Global"

def clean_html(html: str) -> str:
    if not html: return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_blocked(text: str) -> bool:
    t = text.lower()
    for word in BLOCKLIST:
        if word in t:
            return True
    return False

def ai_process(model, title, summary):
    """Returns (is_relevant, severity, new_summary)"""
    if not model:
        # Fallback if no AI
        return True, 2, summary[:200] + "..."

    prompt = f"""
    Role: Security Analyst for Dell Technologies.
    Task: Assess this news item for Corporate Security relevance.

    Input:
    Title: {title}
    Summary: {summary}

    Rules:
    1. IGNORE sports, entertainment, politics without violence, and "post-disaster recovery" (e.g. residents returning home, cleanup).
    2. IGNORE small local crimes unless it involves critical infrastructure.
    3. KEEP: Active protests, active fires/floods, cyber attacks, geopolitical conflict, travel bans, infectious disease.
    4. Severity: 3 (Critical/Life Safety), 2 (Warning/Disruption), 1 (Info).

    Output format: JSON only.
    {{
        "keep": true/false,
        "severity": 1-3,
        "one_liner": "Actionable 15-word summary focusing on impact."
    }}
    """
    try:
        resp = model.generate_content(prompt)
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        return data.get("keep", False), data.get("severity", 1), data.get("one_liner", summary)
    except Exception as e:
        print(f"AI Error: {e}")
        return True, 2, summary  # Default keep if AI fails

def main():
    print("Fetching feeds...")
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

                # 1. Hard Blocklist Filter
                if is_blocked(full_text):
                    print(f"[-] Blocked: {title}")
                    continue

                # 2. AI Processing
                keep, severity, snippet = ai_process(model, title, raw_summary)
                
                if not keep:
                    print(f"[-] AI Dropped: {title}")
                    continue

                # 3. Build Object
                region = classify_region(full_text)
                
                # Timestamp parsing
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                all_items.append({
                    "title": title,
                    "url": e.link,
                    "snippet": snippet,
                    "source": urlparse(e.link).netloc.replace("www.", ""),
                    "time": ts,
                    "region": region,
                    "severity": severity,
                    "type": "GENERAL" # You can expand this logic later
                })
                print(f"[+] Added: {title} ({region})")

        except Exception as x:
            print(f"Feed error {url}: {x}")

    # Sort by time desc
    all_items.sort(key=lambda x: x["time"], reverse=True)
    
    # Save
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)
    print(f"Saved {len(all_items)} articles to {NEWS_PATH}")

if __name__ == "__main__":
    main()
