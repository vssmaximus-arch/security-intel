import feedparser
import json
import os
import hashlib
import re
import time
import folium
import google.generativeai as genai
from datetime import datetime
from difflib import SequenceMatcher
from time import mktime

# --- CONFIGURATION: TRUSTED SOURCES ---
TRUSTED_SOURCES = {
    "http://feeds.bbci.co.uk/news/world/rss.xml": "BBC World News",
    "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best": "Reuters Global",
    "https://www.dw.com/xml/rss/rss-n-all": "Deutsche Welle",
    "http://rss.cnn.com/rss/edition_world.rss": "CNN World",
    "https://www.nytimes.com/services/xml/rss/nyt/World.xml": "New York Times World",
    "https://www.theguardian.com/world/rss": "The Guardian World",
    "https://feeds.washingtonpost.com/rss/world": "The Washington Post World",
    "https://www.cnbc.com/id/100727362/device/rss/rss.html": "CNBC World News",
    "http://feeds.skynews.com/feeds/rss/world.xml": "Sky News (UK) World",
    "https://www.france24.com/en/rss": "France 24",
    "https://www.cbc.ca/webfeed/rss/rss-world": "CBC World (Canada)",
    "https://www.abc.net.au/news/feed/52278/rss.xml": "ABC News (Australia) Just In",
    "https://rss.upi.com/news/world_news.rss": "United Press International (UPI)",
    "http://www.xinhuanet.com/english/rss/world.xml": "Xinhua (China)",
    "https://english.kyodonews.net/rss/all.xml": "Kyodo News (Japan)",
    "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms": "Times of India World",
    "https://www.scmp.com/rss/91/feed": "South China Morning Post (HK)",
    "https://www.straitstimes.com/news/world/rss.xml": "The Straits Times (Singapore)",
    "https://www.japantimes.co.jp/feed": "The Japan Times",
    "https://kyivindependent.com/feed": "The Kyiv Independent",
    "https://www.themoscowtimes.com/rss/news": "The Moscow Times",
    "https://feeds.npr.org/1004/rss.xml": "NPR World (USA)",
    "https://www.cisa.gov/uscert/ncas/alerts.xml": "US CISA (Cyber Govt)",
    "https://gdacs.org/xml/rss.xml": "UN GDACS (Disaster Alert)",
    "https://reliefweb.int/updates/rss.xml": "UN ReliefWeb"
}

# --- NOISE FILTER (Expanded Blocklist) ---
BLOCKED_KEYWORDS = [
    "entertainment", "celebrity", "movie", "film", "star", "actor", "actress", 
    "music", "song", "chart", "concert", "sport", "football", "cricket", "rugby", 
    "tennis", "olympic", "strictly come dancing", "reality tv", "royal", "prince", 
    "princess", "gossip", "dating", "fashion", "lifestyle", "sexual assault", 
    "rape", "domestic", "murder trial", "hate speech", "convicted", "podcast",
    "claims", "alleges", "survey", "poll", "pledges", "vows", "commentary",
    "opinion", "review", "social media", "viral", "trend"
]

# --- KEYWORDS ---
KEYWORDS = {
    "Cyber": ["ransomware", "data breach", "ddos", "vulnerability", "malware", "cyber", "zero-day", "hacker", "botnet"],
    "Physical Security": ["terror", "gunman", "explosion", "riot", "protest", "shooting", "kidnap", "bomb", "assassination", "hostage", "armed attack", "active shooter", "mob violence", "insurgency", "coup"],
    "Logistics": ["port strike", "supply chain", "cargo", "shipping", "customs", "road closure", "airport closed", "grounded", "embargo", "trade war", "blockade", "railway"],
    "Weather/Event": ["earthquake", "tsunami", "hurricane", "typhoon", "wildfire", "cyclone", "magnitude", "flood", "eruption", "volcano"]
}

DB_PATH = "public/data/news.json"
MAP_PATH = "public/map.html"

GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
    model = genai.GenerativeModel('gemini-pro') 
else:
    model = None

def clean_html(raw_html):
    cleanr = re.compile('<.*?>')
    return re.sub(cleanr, '', raw_html).strip()

def load_locations():
    try:
        with open('config/locations.json', 'r') as f:
            return json.load(f)
    except:
        return []

def parse_date(entry):
    try:
        if 'published_parsed' in entry:
            dt = datetime.fromtimestamp(mktime(entry.published_parsed))
            return dt.strftime("%Y-%m-%d"), dt.isoformat(), dt.timestamp()
        else:
            now = datetime.now()
            return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()
    except:
        now = datetime.now()
        return now.strftime("%Y-%m-%d"), now.isoformat(), now.timestamp()

def is_duplicate_title(new_title, existing_titles):
    for old_title in existing_titles:
        if SequenceMatcher(None, new_title, old_title).ratio() > 0.60:
            return True
    return False

# --- STRICT AI ANALYST ---
def ask_gemini_analyst(title, snippet):
    if not model: return None
    
    # STRICT PROMPT FOR CORPORATE SECURITY
    prompt = f"""
    You are a Corporate Security Watchdog for a Fortune 500 company.
    Filter this news item.
    
    Headline: "{title}"
    Snippet: "{snippet}"
    
    INSTRUCTIONS:
    1. DISCARD (Mark as Irrelevant) if it is:
       - Political statements, speeches, or opinions (e.g., "claims", "pledges").
       - Social issues, surveys, or polls.
       - Individual crimes (murder, assault) UNLESS it is a mass-casualty event or terrorism.
       - Entertainment, sports, or celebrity gossip.
    
    2. KEEP only if it matches:
       - Civil Unrest / Riots.
       - Natural Disasters impacting infrastructure.
       - Verified Cyber Attacks.
       - Supply Chain / Logistics Disruptions.
       - Active Terrorism / War.

    Output JSON: {{ "category": "...", "severity": int (1-3), "summary": "...", "lat": float, "lon": float }}
    Use Category "Irrelevant" to discard.
    """
    
    try:
        time.sleep(1.5) # Slower pace to avoid rate limits
        response = model.generate_content(prompt)
        text = response.text.replace("```json", "").replace("```", "")
        return json.loads(text)
    except Exception as e:
        print(f"AI Error: {e}")
        return None

def analyze_article_hybrid(title, summary, source_name, locations):
    text = (title + " " + summary).lower()
    
    # 1. NOISE BLOCK
    if any(block in text for block in BLOCKED_KEYWORDS): return None

    # 2. KEYWORD PRE-CHECK (If it doesn't even have a trigger word, skip AI to save quota)
    pre_category = "Uncategorized"
    if "CISA" in source_name or "Cyber" in source_name: pre_category = "Cyber"
    elif "GDACS" in source_name or "Earthquake" in source_name: pre_category = "Weather/Event"
    else:
        for cat, keys in KEYWORDS.items():
            if any(k in text for k in keys):
                pre_category = cat
                break
    
    if pre_category == "Uncategorized": return None

    # 3. AI FILTER
    ai_result = ask_gemini_analyst(title, summary)
    
    if ai_result:
        if ai_result.get('category') == "Irrelevant": return None
        return {
            "category": ai_result.get('category', pre_category),
            "severity": ai_result.get('severity', 1),
            "region": determine_region(text, locations),
            "ai_summary": ai_result.get('summary'),
            "lat": ai_result.get('lat', 0.0),
            "lon": ai_result.get('lon', 0.0)
        }
    else:
        # 4. FALLBACK (Downgraded Severity to prevent false alarms)
        # If AI fails, we assume LOW severity unless it's obviously catastrophic
        return fallback_analysis(pre_category, text, locations)

def determine_region(text, locations):
    for loc in locations:
        if loc['city'].lower() in text: return loc['region']
    if any(x in text for x in ["asia", "china", "india", "japan", "australia", "singapore", "korea"]): return "APJC"
    elif any(x in text for x in ["europe", "uk", "germany", "france", "ukraine", "russia", "middle east", "israel"]): return "EMEA"
    elif any(x in text for x in ["usa", "america", "brazil", "mexico", "canada", "latin"]): return "AMER"
    return "Global"

def fallback_analysis(category, text, locations):
    severity = 1 # Default to Low
    # Only escalate if explicit WAR keywords are present
    if any(x in text for x in ["war declared", "terrorist attack", "massive earthquake"]): severity = 3
    return {"category": category, "severity": severity, "region": determine_region(text, locations), "ai_summary": None, "lat": 0.0, "lon": 0.0}

# --- MAP GENERATOR ---
def generate_interactive_map(articles):
    m = folium.Map(location=[20, 0], zoom_start=2, tiles="cartodb positron")
    count = 0
    for item in articles:
        lat = item.get('lat')
        lon = item.get('lon')
        if lat and lon and (lat != 0.0 or lon != 0.0):
            color = "blue"
            if item['severity'] == 3: color = "red"
            elif item['severity'] == 2: color = "orange"
            
            popup_html = f"""
            <b>{item['title']}</b><br>
            <span style='color:gray'>{item['category']}</span><br>
            <a href='{item['link']}' target='_blank'>Source</a>
            """
            folium.Marker([lat, lon], popup=folium.Popup(popup_html, max_width=300), icon=folium.Icon(color=color, icon="info-sign")).add_to(m)
            count += 1
    m.save(MAP_PATH)

def fetch_news():
    locations = load_locations()
    allowed_names = list(TRUSTED_SOURCES.values())
    all_candidates = []
    
    # Load History
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, 'r') as f:
                history = json.load(f)
                for item in history:
                    if item['source'] in allowed_names:
                        # Re-run Blocklist on History
                        combined = (item['title'] + " " + item['snippet']).lower()
                        if not any(b in combined for b in BLOCKED_KEYWORDS):
                            all_candidates.append(item)
        except: pass

    print("Scanning feeds with STRICT AI Agent...")
    for url, source_name in TRUSTED_SOURCES.items():
        try:
            feed = feedparser.parse(url)
            if not feed.entries: continue

            for entry in feed.entries[:5]: 
                title = entry.title
                if len(title) < 15: continue
                
                raw_summary = entry.summary if 'summary' in entry else ""
                clean_summary = clean_html(raw_summary)
                clean_date, full_date, timestamp = parse_date(entry) 
                
                analysis = analyze_article_hybrid(title, clean_summary, source_name, locations)
                
                if analysis:
                    article_hash = hashlib.md5(title.encode()).hexdigest()
                    final_snippet = analysis.get('ai_summary') if analysis.get('ai_summary') else clean_summary[:250] + "..."
                    
                    all_candidates.append({
                        "id": article_hash,
                        "title": title,
                        "snippet": final_snippet,
                        "link": entry.link,
                        "published": full_date,
                        "date_str": clean_date,
                        "timestamp": timestamp,
                        "source": source_name,
                        "category": analysis['category'],
                        "severity": analysis['severity'],
                        "region": analysis['region'],
                        "lat": analysis.get('lat'),
                        "lon": analysis.get('lon')
                    })
        except Exception as e:
            print(f"Skipping {source_name}: {e}")

    all_candidates.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    
    clean_list = []
    seen_titles = []
    for item in all_candidates:
        t_low = item['title'].lower()
        if is_duplicate_title(t_low, seen_titles): continue
        clean_list.append(item)
        seen_titles.append(t_low)

    if len(clean_list) > 1000: clean_list = clean_list[:1000]

    os.makedirs("public/data", exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(clean_list, f, indent=2)
    
    generate_interactive_map(clean_list)
    print(f"Database refined. {len(clean_list)} items active.")

if __name__ == "__main__":
    fetch_news()
