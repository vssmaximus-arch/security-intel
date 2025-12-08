"""
SRO Intelligence Ingest + Learning
----------------------------------
- Pulls from curated news / alert feeds
- Uses Gemini for classification
- Learns from analyst feedback stored in public/data/feedback.jsonl

Labels expected from the dashboard:
  - "NOT_RELEVANT"  -> hard block, used as negative examples
  - "CRITICAL"      -> boost / strong positive example
  - (optionally "RELEVANT", "MONITOR" later if you add)
"""

import json
import os
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
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

# ---------- CONFIG ----------
GEMINI_MODEL = "gemini-1.5-flash"

# News / alert feeds (keep your existing list here)
FEEDS = [
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/marketsNews",
    "https://feeds.reuters.com/reuters/politicsNews",
    "https://feeds.reuters.com/reuters/lawNews",
    "https://apnews.com/apf-news?format=xml",
    "https://apnews.com/hub/world-news?format=xml",
    "https://apnews.com/hub/politics?format=xml",
    "https://www.afp.com/en/news-hub/rss",
    "https://www.bbc.co.uk/news/world/rss.xml",
    "https://www.bbc.co.uk/news/business/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://feeds.washingtonpost.com/rss/world",
    "https://feeds.washingtonpost.com/rss/business",
    "https://www.theguardian.com/world/rss",
    "https://www.theguardian.com/business/rss",
    "https://www.dw.com/en/top-stories/world/s-1429/rss",
    "https://www.dw.com/en/top-stories/business/s-1431/rss",
    "https://www.scmp.com/rss/91/feed",
    "https://asia.nikkei.com/rss/feed/nar",
    "https://www.crisisgroup.org/rss.xml",
    "https://reliefweb.int/updates/rss.xml",
    "https://www.globalsecurity.org/military/world/rss.xml",
    "https://www.freightwaves.com/feed",
    "https://www.joc.com/rss.xml",
    "https://www.supplychaindive.com/feeds/news/",
    "https://gcaptain.com/feed/",
    "https://theloadstar.com/feed/",
    "https://splash247.com/feed/",
    "https://www.porttechnology.org/feed/",
    "https://www.aircargonews.net/feed/",
    "https://www.maritime-executive.com/rss",
    "https://www.maritimebulletin.net/feed/",
    "https://www.portoflosangeles.org/rss/news",
    "https://www.portofantwerpbruges.com/en/news/rss",
    # crisis/weather / alerts
    "https://www.wmo.int/rss",
    "https://www.weather.gov/rss_page.php",
    "https://alerts.weather.gov/cap/us.php?x=0",
    "https://www.jma.go.jp/bosai/feed/rss/eqvol.xml",
    "https://www.jma.go.jp/bosai/feed/rss/warn.xml",
    "https://feeds.meteoalarm.org/RSS",
    "https://www.emsc-csem.org/service/rss/rss.php?typ=emsc",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",
    # cyber
    "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    "https://www.darkreading.com/rss_simple.asp",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://www.csoonline.com/index.rss",
    "https://www.scmagazine.com/home/feed/",
    "https://www.cloudflare.com/rss/",
    "https://msrc.microsoft.com/blog/feed",
    "https://www.mandiant.com/resources/rss.xml",
    "https://www.okta.com/blog/index.xml",
]

# ---------- HARD BLOCKLIST (pre-AI noise filter) ----------
BLOCKLIST_WORDS = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament",
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "review:", "opinion:", "editorial:",
    "tv show", "series finale", "premiere",
]

# ---------- INIT GEMINI ----------
def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        print("Gemini disabled: GEMINI_API_KEY not set or library missing")
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

# ---------- UTILS ----------
def clean_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_obviously_irrelevant(text: str) -> bool:
    """Cheap textual filter before AI to save tokens."""
    t = text.lower()
    for w in BLOCKLIST_WORDS:
        if w in t:
            return True
    return False

def build_article_key(title: str, source: str, url: str) -> str:
    """
    Must match the logic used on the frontend (app.js).
    Priority:
      1) URL if present
      2) source + title
    """
    title = (title or "").strip().lower()
    source = (source or "").strip().lower()
    url = (url or "").strip().lower()
    if url:
        return f"u:{url}"
    return f"s:{source}|t:{title}"

def map_region(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["china", "asia", "india", "japan", "australia", "thailand",
                            "vietnam", "indonesia", "malaysia", "singapore",
                            "korea", "taiwan", "philippines"]):
        return "APJC"
    if any(x in t for x in ["uk", "britain", "england", "europe", "germany", "france",
                            "poland", "ireland", "israel", "gaza", "russia", "ukraine",
                            "middle east", "africa", "netherlands", "sweden",
                            "spain", "italy"]):
        return "EMEA"
    if any(x in t for x in ["usa", "united states", "america", "canada", "brazil",
                            "mexico", "colombia", "argentina", "chile",
                            "peru", "panama"]):
        return "AMER"
    return "Global"

# ---------- FEEDBACK LOADING / PROFILE ----------
def load_feedback():
    """
    Reads feedback.jsonl and builds:
      - block_keys: set of article keys to always skip
      - boost_keys: set of article keys to boost (CRITICAL)
      - pos_examples / neg_examples: recent examples for Gemini prompt
    """
    block_keys = set()
    boost_keys = set()
    pos_examples = []  # CRITICAL
    neg_examples = []  # NOT_RELEVANT

    if not os.path.exists(FEEDBACK_PATH):
        print("No feedback file yet – running with default behaviour.")
        return block_keys, boost_keys, pos_examples, neg_examples

    with open(FEEDBACK_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue

            label = (obj.get("label") or "").upper()
            title = obj.get("title") or ""
            source = obj.get("source") or ""
            url = obj.get("url") or ""

            key = build_article_key(title, source, url)
            if not key:
                continue

            if label == "NOT_RELEVANT":
                block_keys.add(key)
                neg_examples.append(obj)
            elif label == "CRITICAL":
                boost_keys.add(key)
                pos_examples.append(obj)
            # you can add more labels later (e.g. "RELEVANT", "MONITOR")

    # keep only the most recent 20 of each for the few-shot prompt
    pos_examples = pos_examples[-20:]
    neg_examples = neg_examples[-20:]

    print(f"Loaded feedback: {len(block_keys)} NOT_RELEVANT keys, {len(boost_keys)} CRITICAL keys")
    return block_keys, boost_keys, pos_examples, neg_examples

def build_feedback_prompt_section(pos_examples, neg_examples) -> str:
    """
    Converts feedback examples into a compact text block
    to be injected into the Gemini prompt.
    """
    if not pos_examples and not neg_examples:
        return "No prior feedback – use general security relevance rules only."

    def fmt(ex):
        lbl = ex.get("label")
        title = ex.get("title", "")[:160]
        src = ex.get("source", "")
        return f"- [{lbl}] {src} – {title}"

    lines = ["Recent analyst feedback from Dell SRO:"]

    if pos_examples:
        lines.append("\nExamples that leadership CARES ABOUT (keep/high priority):")
        for ex in pos_examples:
            lines.append(fmt(ex))

    if neg_examples:
        lines.append("\nExamples that leadership DOES NOT CARE ABOUT (drop/low value):")
        for ex in neg_examples:
            lines.append(fmt(ex))

    lines.append(
        "\nWhen judging new articles, prefer patterns similar to the positive set "
        "and avoid patterns similar to the negative set."
    )
    return "\n".join(lines)

# ---------- GEMINI CALL ----------
def ai_analyze_article(model, title, body, source, feedback_text):
    """
    Uses Gemini with:
      - SRO task description
      - current article
      - feedback examples (few-shot profile)
    """
    if not model:
        # fallback – keep everything to avoid losing incidents if AI is down
        return {
            "category": "PHYSICAL_SECURITY",  # default bucket
            "likelihood_relevant": 70,
            "severity": "MEDIUM",
            "primary_reason": "Gemini unavailable – default relevance.",
            "geo_relevance": {"mentioned_countries_or_cities": []},
        }

    prompt = f"""
ROLE & GOAL
You are a security news classifier for Dell Technologies Security & Resiliency (SRO).

1) You ONLY keep stories that have operational impact for:
   - Physical security of people, offices, and facilities
   - Supply chain and logistics (ports, air/sea/land freight, manufacturing, HVA)
   - Major cyber incidents that can disrupt operations or key partners
   - Crisis / weather events that can affect sites or travel
   - Compliance / investigations that materially impact security operations

2) You must REJECT:
   - General politics without clear operational impact
   - Sports, entertainment, lifestyle, celebrity, gossip
   - Local soft features, human-interest stories
   - Post-event clean-up, anniversary, or "memories" pieces that do not affect operations now

3) Use the recent analyst feedback to align your decisions with leadership expectations.

FEEDBACK PROFILE:
{feedback_text}

CATEGORIES:
- PHYSICAL_SECURITY: Protests, riots, terror, war, major crime, kidnapping, violent unrest, active shooter, civil disorder, martial law, coups.
- SUPPLY_CHAIN_SECURITY: Port/airport closures, shipping disruption, strikes affecting logistics, factory shutdown, cargo theft, customs blockages.
- CYBER_SECURITY_MAJOR: Outages, ransomware, large data leaks, major vulnerability or incident that can hit Dell, its partners, or critical infrastructure.
- CRISIS_WEATHER: Earthquakes, typhoons, hurricanes, floods, wildfires, large power outages, grid failure, states of emergency.
- HEALTH_SAFETY: Epidemics/outbreaks, pandemics, travel bans, major health advisories.
- NOT_RELEVANT: Everything else.

INPUT ARTICLE:
- Title: {title}
- Body: {body[:1200]}
- Source: {source}

OUTPUT STRICTLY AS JSON:
{{
  "category": "PHYSICAL_SECURITY | SUPPLY_CHAIN_SECURITY | CYBER_SECURITY_MAJOR | CRISIS_WEATHER | HEALTH_SAFETY | NOT_RELEVANT",
  "likelihood_relevant": integer 0-100,
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "primary_reason": "One sentence explaining business/security impact in plain language",
  "geo_relevance": {{
    "mentioned_countries_or_cities": ["list", "of", "locations or regions (if any)"]
  }}
}}
    """.strip()

    try:
        resp = model.generate_content(prompt)
        text = resp.text.strip().replace("```json", "").replace("```", "")
        return json.loads(text)
    except Exception as e:
        print(f"AI Processing Error: {e}")
        return {
            "category": "NOT_RELEVANT",
            "likelihood_relevant": 0,
            "severity": "LOW",
            "primary_reason": "AI processing error.",
            "geo_relevance": {"mentioned_countries_or_cities": []},
        }

# ---------- MAIN INGEST ----------
def main():
    print(f"Starting SRO Intel Ingest on {len(FEEDS)} feeds...")

    model = init_gemini()

    # Load analyst feedback profile
    block_keys, boost_keys, pos_examples, neg_examples = load_feedback()
    feedback_text = build_feedback_prompt_section(pos_examples, neg_examples)

    all_items = []
    seen_titles = set()

    CHECK_LIMIT = 10  # items per feed to inspect; you can increase if needed

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            print(f"Scanning: {url} ({len(f.entries)} entries)")
        except Exception as e:
            print(f"Feed parse error {url}: {e}")
            continue

        for e in f.entries[:CHECK_LIMIT]:
            title = getattr(e, "title", "").strip()
            if not title:
                continue

            # Deduplicate by title
            if title in seen_titles:
                continue
            seen_titles.add(title)

            raw_summary = clean_html(getattr(e, "summary", ""))
            full_text = f"{title} {raw_summary}"
            link = getattr(e, "link", "") or ""
            source_host = urlparse(link).netloc.replace("www.", "") or urlparse(url).netloc.replace("www.", "")

            # Build stable key and apply hard user-block if present
            key = build_article_key(title, source_host, link)
            if key in block_keys:
                print(f"[SKIP-BLOCK] {title}")
                continue

            # Fast lexical blocklist
            if is_obviously_irrelevant(full_text):
                continue

            # AI classification
            analysis = ai_analyze_article(model, title, raw_summary, source_host, feedback_text)
            cat = analysis.get("category", "NOT_RELEVANT")
            score = int(analysis.get("likelihood_relevant", 0) or 0)

            if cat == "NOT_RELEVANT" or score < 45:
                # borderline calls will naturally be corrected by your feedback over time
                continue

            # Map severity string to numeric
            sev_str = (analysis.get("severity") or "LOW").upper()
            severity = 1
            if sev_str == "MEDIUM":
                severity = 2
            elif sev_str in ("HIGH", "CRITICAL"):
                severity = 3

            # Apply boost if analysts marked similar item CRITICAL before
            if key in boost_keys and severity < 3:
                print(f"[BOOST-CRITICAL] {title}")
                severity = 3
                cat = "PHYSICAL_SECURITY" if cat == "NOT_RELEVANT" else cat

            # Map category to dashboard type label
            dash_type = "GENERAL"
            if cat == "PHYSICAL_SECURITY":
                dash_type = "PHYSICAL SECURITY"
            elif cat == "SUPPLY_CHAIN_SECURITY":
                dash_type = "SUPPLY CHAIN"
            elif cat == "CYBER_SECURITY_MAJOR":
                dash_type = "CYBER SECURITY"
            elif cat == "CRISIS_WEATHER":
                dash_type = "CRISIS / WEATHER"
            elif cat == "HEALTH_SAFETY":
                dash_type = "HEALTH / SAFETY"

            # Region mapping
            region = map_region(full_text)

            # Timestamp: prefer feed's published date if present
            ts = datetime.now(timezone.utc).isoformat()
            if hasattr(e, "published_parsed") and e.published_parsed:
                ts = datetime(*e.published_parsed[:6]).replace(tzinfo=timezone.utc).isoformat()

            snippet = analysis.get("primary_reason") or raw_summary[:160]

            item = {
                "title": title,
                "url": link,
                "snippet": snippet,
                "source": source_host,
                "time": ts,
                "region": region,
                "severity": severity,
                "type": dash_type,
            }
            all_items.append(item)
            print(f"[KEEP] {dash_type} | {region} | {title}")

    # Sort by severity then time (newest first)
    all_items.sort(key=lambda x: (x["severity"], x["time"]), reverse=True)

    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2)

    print(f"Ingest Complete. Saved {len(all_items)} SRO-relevant articles to {NEWS_PATH}.")

if __name__ == "__main__":
    main()
