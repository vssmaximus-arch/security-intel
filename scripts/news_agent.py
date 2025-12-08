#!/usr/bin/env python3
"""
SRO Intelligence Ingest + Learning (refactored)

Notes:
 - This is the ingest script and MUST be saved as a .py file (example:
   public/scripts/news_ingest.py). The script writes JSON output to:
   public/data/news.json

 - The original file you showed is Python code stored under a .json path;
   that is likely a mistake. Keep the script as .py and let the generated
   news.json be produced by this script.

 - The google.generativeai (Gemini) client APIs have changed over time.
   init_gemini() and ai_analyze_article() include multiple defensive call
   patterns; adjust these to match the library version you have installed.
"""
import json
import os
import re
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

# News / alert feeds (kept as provided)
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
    "https://www.aljazeera.com/xml/rss/all.xml",
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
    "https://www.bleepingcomputer.com/feed/",
    "https://www.csoonline.com/index.rss",
    "https://www.scmagazine.com/home/feed/",
    "https://www.crowdstrike.com/blog/feed/",
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

BLOCKLIST_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in BLOCKLIST_WORDS) + r")\b", flags=re.IGNORECASE)

# ---------- INIT GEMINI ----------
def init_gemini():
    """
    Return a model object or None. This function tries a few common patterns
    for the google.generativeai library; update if your environment uses a
    different client API.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        print("Gemini disabled: GEMINI_API_KEY not set or google.generativeai missing")
        return None

    try:
        # Common pattern: genai.configure(api_key=...)
        if hasattr(genai, "configure"):
            genai.configure(api_key=api_key)
        # Try to obtain a model object; the exact call differs across versions
        if hasattr(genai, "get_model"):
            # newer API pattern
            model = genai.get_model(GEMINI_MODEL)
            return model
        if hasattr(genai, "GenerativeModel"):
            return genai.GenerativeModel(GEMINI_MODEL)
        # If none of the above, return genai (we'll attempt calls directly)
        return genai
    except Exception as ex:
        print(f"Error initializing Gemini client: {ex}")
        return None

# ---------- UTILS ----------
def clean_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_obviously_irrelevant(text: str) -> bool:
    """Cheap textual filter before AI to save tokens. Uses regex word boundaries."""
    if not text:
        return False
    if BLOCKLIST_RE.search(text):
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
    t = (text or "").lower()
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
    block_keys = set()
    boost_keys = set()
    pos_examples = []
    neg_examples = []

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

    pos_examples = pos_examples[-20:]
    neg_examples = neg_examples[-20:]

    print(f"Loaded feedback: {len(block_keys)} NOT_RELEVANT keys, {len(boost_keys)} CRITICAL keys")
    return block_keys, boost_keys, pos_examples, neg_examples

def build_feedback_prompt_section(pos_examples, neg_examples) -> str:
    if not pos_examples and not neg_examples:
        return "No prior feedback – use general security relevance rules only."

    def fmt(ex):
        lbl = ex.get("label")
        title = ex.get("title", "")[:160]
        src = ex.get("source", "")
        return f"- [{lbl}] {src} – {title}"

    lines = ["Recent analyst feedback from Dell SRO:"]

    if pos_examples:
        lines.append("Examples that leadership CARES ABOUT (keep/high priority):")
        for ex in pos_examples:
            lines.append(fmt(ex))

    if neg_examples:
        lines.append("Examples that leadership DOES NOT CARE ABOUT (drop/low value):")
        for ex in neg_examples:
            lines.append(fmt(ex))

    lines.append(
        "When judging new articles, prefer patterns similar to the positive set "
        "and avoid patterns similar to the negative set."
    )
    return "\n".join(lines)

# ---------- GEMINI CALL ----------
def ai_analyze_article(model, title, body, source, feedback_text):
    """
    Tries to call the provided model in multiple common ways. If no working
    path is found, returns a conservative fallback.
    """
    if not model:
        return {
            "category": "PHYSICAL_SECURITY",
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

    # Try a few common call patterns depending on what object we have
    try:
        # Pattern: model has generate_content(...)
        if hasattr(model, "generate_content"):
            resp = model.generate_content(prompt)
            # resp.text or resp.output may exist in different SDK versions
            text = getattr(resp, "text", None) or getattr(resp, "output", None) or str(resp)
        # Pattern: genai.get_model(...) returned a model with .generate(...)
        elif hasattr(model, "generate"):
            resp = model.generate(prompt=prompt)
            text = getattr(resp, "text", None) or getattr(resp, "output", None) or str(resp)
        # Pattern: top-level genai.generate(...) where model is the module
        elif hasattr(genai, "generate"):
            # Some versions require model name as parameter
            try:
                resp = genai.generate(model=GEMINI_MODEL, prompt=prompt)
            except TypeError:
                resp = genai.generate(prompt=prompt)
            text = getattr(resp, "text", None) or getattr(resp, "output", None) or str(resp)
        else:
            # Last resort: attempt to stringify the model call
            resp = model  # fallback
            text = str(resp)

        # Clean code fences if present
        if isinstance(text, str):
            text = text.strip()
            text = text.replace("```json", "").replace("```", "").strip()
            return json.loads(text)
        else:
            raise ValueError("Model response not a string")
    except Exception as e:
        print(f"AI Processing Error: {e}")
        # Return a safe default classification
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

    block_keys, boost_keys, pos_examples, neg_examples = load_feedback()
    feedback_text = build_feedback_prompt_section(pos_examples, neg_examples)

    all_items = []
    seen_titles = set()
    CHECK_LIMIT = 10  # items per feed to inspect; adjust as needed

    for url in FEEDS:
        try:
            f = feedparser.parse(url)
            print(f"Scanning: {url} ({len(getattr(f, 'entries', []))} entries)")
        except Exception as e:
            print(f"Feed parse error {url}: {e}")
            continue

        for e in f.entries[:CHECK_LIMIT]:
            title = getattr(e, "title", "").strip()
            if not title:
                continue

            if title in seen_titles:
                continue
            seen_titles.add(title)

            # Prefer entry.content over summary when available
            raw_summary = ""
            if hasattr(e, "summary"):
                raw_summary = clean_html(getattr(e, "summary", "") or "")
            if hasattr(e, "content") and e.content:
                # content is usually a list of dicts with 'value'
                try:
                    content_val = e.content[0].value
                    if content_val:
                        raw_summary = clean_html(content_val)
                except Exception:
                    pass

            full_text = f"{title} {raw_summary}"
            link = getattr(e, "link", "") or ""
            source_host = urlparse(link).netloc.replace("www.", "") or urlparse(url).netloc.replace("www.", "")

            key = build_article_key(title, source_host, link)
            if key in block_keys:
                print(f"[SKIP-BLOCK] {title}")
                continue

            if is_obviously_irrelevant(full_text):
                continue

            analysis = ai_analyze_article(model, title, raw_summary, source_host, feedback_text)
            cat = analysis.get("category", "NOT_RELEVANT")
            score = int(analysis.get("likelihood_relevant", 0) or 0)

            if cat == "NOT_RELEVANT" or score < 45:
                continue

            sev_str = (analysis.get("severity") or "LOW").upper()
            severity = 1
            if sev_str == "MEDIUM":
                severity = 2
            elif sev_str in ("HIGH", "CRITICAL"):
                severity = 3

            if key in boost_keys and severity < 3:
                print(f"[BOOST-CRITICAL] {title}")
                severity = 3

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

            region = map_region(full_text)

            # Timestamp: prefer feed's published date if present
            ts_iso = datetime.now(timezone.utc).isoformat()
            parsed_time = None
            try:
                if hasattr(e, "published_parsed") and e.published_parsed:
                    parsed_time = datetime(*e.published_parsed[:6]).replace(tzinfo=timezone.utc)
                    ts_iso = parsed_time.isoformat()
            except Exception:
                parsed_time = None

            snippet = analysis.get("primary_reason") or raw_summary[:160]

            item = {
                "title": title,
                "url": link,
                "snippet": snippet,
                "source": source_host,
                "time": ts_iso,
                "region": region,
                "severity": severity,
                "type": dash_type,
                # keep parsed_time for accurate sorting, remove before write
                "_sort_time": parsed_time.isoformat() if parsed_time else ts_iso,
            }
            all_items.append(item)
            print(f"[KEEP] {dash_type} | {region} | {title}")

    # Sort by severity then time (newest first)
    def sort_key(x):
        try:
            dt = datetime.fromisoformat(x.get("_sort_time"))
        except Exception:
            dt = datetime.now(timezone.utc)
        return (x.get("severity", 1), dt)

    all_items.sort(key=sort_key, reverse=True)

    # Remove internal _sort_time before writing
    for it in all_items:
        it.pop("_sort_time", None)

    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2, ensure_ascii=False)

    print(f"Ingest Complete. Saved {len(all_items)} SRO-relevant articles to {NEWS_PATH}.")

if __name__ == "__main__":
    main()
