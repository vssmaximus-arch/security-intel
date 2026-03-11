#!/usr/bin/env python3
"""
SRO Intelligence Ingest — Groq-powered (replaces Gemini)

Uses Groq's free API (llama-3.1-8b-instant) for zero-cost AI enrichment.
Requires GROQ_API_KEY environment variable (same key as the Cloudflare Worker).
Writes enriched items to public/data/news.json for the GitHub Pages report view.
"""
import json
import os
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
from bs4 import BeautifulSoup

# ---------- PATHS ----------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

NEWS_PATH = os.path.join(DATA_DIR, "news.json")
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

# ---------- CONFIG ----------
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_MAX_TOKENS = 350
GROQ_CALLS_PER_RUN = 60  # stay well under free-tier rate limits

# News / alert feeds
FEEDS = [
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/marketsNews",
    "https://feeds.reuters.com/reuters/politicsNews",
    "https://feeds.reuters.com/reuters/lawNews",
    "https://apnews.com/apf-news?format=xml",
    "https://apnews.com/hub/world-news?format=xml",
    "https://apnews.com/hub/politics?format=xml",
    "https://www.bbc.co.uk/news/world/rss.xml",
    "https://www.bbc.co.uk/news/business/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://feeds.washingtonpost.com/rss/world",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.theguardian.com/world/rss",
    "https://www.theguardian.com/business/rss",
    "https://www.dw.com/en/top-stories/world/s-1429/rss",
    "https://www.scmp.com/rss/91/feed",
    "https://www.crisisgroup.org/rss.xml",
    "https://reliefweb.int/updates/rss.xml",
    "https://www.globalsecurity.org/military/world/rss.xml",
    "https://www.freightwaves.com/feed",
    "https://www.supplychaindive.com/feeds/news/",
    "https://gcaptain.com/feed/",
    "https://theloadstar.com/feed/",
    "https://www.maritime-executive.com/rss",
    # crisis/weather / alerts
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",
    # cyber
    "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://www.bleepingcomputer.com/feed/",
]

# ---------- HARD BLOCKLIST ----------
BLOCKLIST_WORDS = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament",
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "review:", "opinion:", "editorial:",
    "tv show", "series finale", "premiere",
]
BLOCKLIST_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in BLOCKLIST_WORDS) + r")\b", flags=re.IGNORECASE)

# ---------- GROQ CALL ----------
def init_groq():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("Groq disabled: GROQ_API_KEY not set")
        return None
    return api_key

def ai_analyze_article(api_key, title, body, source, feedback_text):
    """Call Groq to classify and enrich an article. Returns structured dict."""
    if not api_key:
        return {
            "category": "PHYSICAL_SECURITY",
            "likelihood_relevant": 70,
            "severity": "MEDIUM",
            "primary_reason": "AI unavailable – default relevance.",
            "geo_relevance": {"mentioned_countries_or_cities": []},
        }

    system_msg = (
        "You are a security news classifier for Dell Technologies SRO. "
        "Return ONLY valid JSON — no markdown, no explanation."
    )

    user_msg = f"""Classify this article for Dell SRO operational relevance.

CATEGORIES:
- PHYSICAL_SECURITY: Protests, riots, terror, war, crime, kidnapping, unrest, coups.
- SUPPLY_CHAIN_SECURITY: Port/airport closures, shipping disruption, strikes, cargo theft.
- CYBER_SECURITY_MAJOR: Confirmed breaches, ransomware, major outages, nation-state intrusions.
- CRISIS_WEATHER: Earthquakes, typhoons, floods, wildfires, grid failure, states of emergency.
- HEALTH_SAFETY: Epidemics, pandemics, travel bans, major health advisories.
- NOT_RELEVANT: General politics, sports, entertainment, opinion, patch notes, CVEs without impact.

FEEDBACK PROFILE:
{feedback_text}

ARTICLE:
Title: {title}
Body: {body[:800]}
Source: {source}

Return JSON:
{{"category": "...", "likelihood_relevant": 0-100, "severity": "LOW|MEDIUM|HIGH|CRITICAL", "primary_reason": "one sentence", "geo_relevance": {{"mentioned_countries_or_cities": []}}}}"""

    payload = json.dumps({
        "model": GROQ_MODEL,
        "temperature": 0,
        "max_tokens": GROQ_MAX_TOKENS,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib.request.Request(
        GROQ_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        # Strip code fences if present
        content = content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(content)
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        print(f"Groq HTTP {e.code}: {body_txt[:200]}")
        if e.code in (429, 503):
            time.sleep(5)  # brief back-off on rate limit
        return {
            "category": "PHYSICAL_SECURITY",
            "likelihood_relevant": 70,
            "severity": "MEDIUM",
            "primary_reason": "AI unavailable – default relevance.",
            "geo_relevance": {"mentioned_countries_or_cities": []},
        }
    except Exception as ex:
        print(f"Groq call error: {ex}")
        return {
            "category": "PHYSICAL_SECURITY",
            "likelihood_relevant": 70,
            "severity": "MEDIUM",
            "primary_reason": "AI unavailable – default relevance.",
            "geo_relevance": {"mentioned_countries_or_cities": []},
        }

# ---------- UTILS ----------
def clean_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def is_obviously_irrelevant(text: str) -> bool:
    if not text:
        return False
    return bool(BLOCKLIST_RE.search(text))

def build_article_key(title: str, source: str, url: str) -> str:
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

# ---------- FEEDBACK LOADING ----------
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
    lines = ["Recent analyst feedback from Dell SRO:"]
    if pos_examples:
        lines.append("KEEP (high priority):")
        for ex in pos_examples:
            lines.append(f"- [{ex.get('label')}] {ex.get('source', '')} – {ex.get('title', '')[:120]}")
    if neg_examples:
        lines.append("DROP (not relevant):")
        for ex in neg_examples:
            lines.append(f"- [{ex.get('label')}] {ex.get('source', '')} – {ex.get('title', '')[:120]}")
    return "\n".join(lines)

# ---------- MAIN INGEST ----------
def main():
    print(f"Starting SRO Intel Ingest on {len(FEEDS)} feeds...")

    api_key = init_groq()
    if not api_key:
        print("WARNING: GROQ_API_KEY not set — writing empty news.json")
        with open(NEWS_PATH, "w", encoding="utf-8") as f:
            json.dump([], f)
        return

    block_keys, boost_keys, pos_examples, neg_examples = load_feedback()
    feedback_text = build_feedback_prompt_section(pos_examples, neg_examples)

    all_items = []
    seen_titles = set()
    groq_calls = 0
    CHECK_LIMIT = 8  # items per feed to inspect

    for url in FEEDS:
        if groq_calls >= GROQ_CALLS_PER_RUN:
            print(f"Groq call cap ({GROQ_CALLS_PER_RUN}) reached — stopping early")
            break
        try:
            f = feedparser.parse(url)
            print(f"Scanning: {url} ({len(getattr(f, 'entries', []))} entries)")
        except Exception as e:
            print(f"Feed parse error {url}: {e}")
            continue

        for e in f.entries[:CHECK_LIMIT]:
            if groq_calls >= GROQ_CALLS_PER_RUN:
                break

            title = getattr(e, "title", "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)

            raw_summary = ""
            if hasattr(e, "summary"):
                raw_summary = clean_html(getattr(e, "summary", "") or "")
            if hasattr(e, "content") and e.content:
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

            groq_calls += 1
            analysis = ai_analyze_article(api_key, title, raw_summary, source_host, feedback_text)
            cat = analysis.get("category", "NOT_RELEVANT")
            score = int(analysis.get("likelihood_relevant", 0) or 0)

            if cat == "NOT_RELEVANT" or score < 45:
                continue

            sev_str = (analysis.get("severity") or "LOW").upper()
            severity = 1
            if sev_str == "MEDIUM":
                severity = 2
            elif sev_str == "HIGH":
                severity = 3
            elif sev_str == "CRITICAL":
                severity = 4

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
                "_sort_time": parsed_time.isoformat() if parsed_time else ts_iso,
            }
            all_items.append(item)
            print(f"[KEEP] {dash_type} | sev={severity} | {region} | {title[:80]}")

    # Sort by severity then time (newest first)
    def sort_key(x):
        try:
            dt = datetime.fromisoformat(x.get("_sort_time"))
        except Exception:
            dt = datetime.now(timezone.utc)
        return (x.get("severity", 1), dt)

    all_items.sort(key=sort_key, reverse=True)

    for it in all_items:
        it.pop("_sort_time", None)

    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2, ensure_ascii=False)

    print(f"Ingest complete. {len(all_items)} items saved to {NEWS_PATH}. Groq calls used: {groq_calls}.")

if __name__ == "__main__":
    main()
