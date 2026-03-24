#!/usr/bin/env python3
"""
SRO Intelligence Brain v2.0 — Multi-source AI intelligence pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Scout   → Curated RSS feeds + GDELT real-time global news
  Analyst → Groq batch (primary) or Gemini 2.0 Flash (if quota available)
             Full Dell operational context — second-order reasoning
             No keyword gating — AI reasons about intent and impact
  Output  → news.json scored, filtered, Dell-context-aware

AI priority order:
  1. Groq llama-3.3-70b  — primary (14,400 req/day free, 30 RPM, batch mode)
  2. Gemini 2.0 Flash    — upgrade path (1500 req/day, requires valid quota)
  3. Keyword fallback    — last resort

Environment variables:
  GROQ_API_KEY     — primary AI (already configured)
  GEMINI_API_KEY   — optional upgrade (get new key from aistudio.google.com)
"""

import json
import os
import re
import time
import math
import urllib.request
import urllib.error
from datetime import datetime, timezone
from urllib.parse import urlparse, urlencode

import feedparser
from bs4 import BeautifulSoup

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR   = os.path.join(BASE_DIR, "public", "data")
CONFIG_DIR = os.path.join(BASE_DIR, "config")
os.makedirs(DATA_DIR, exist_ok=True)

NEWS_PATH      = os.path.join(DATA_DIR, "news.json")
FEEDBACK_PATH  = os.path.join(DATA_DIR, "feedback.jsonl")
LOCATIONS_PATH = os.path.join(CONFIG_DIR, "locations.json")

# ── Groq config (PRIMARY AI) ───────────────────────────────────────────────────
GROQ_API_URL       = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL         = "llama-3.3-70b-versatile"  # best free Groq model for reasoning
GROQ_BATCH_SIZE    = 8    # articles per call
GROQ_MAX_CALLS     = 100  # 48 runs/day × 100 = 4800 (well within 14,400/day free)
GROQ_DELAY_S       = 2.5  # 30 RPM limit → 1 call per 2s minimum; 2.5s is safe
MIN_RELEVANCE_SCORE = 4   # 1-10 scale — below this is discarded

# ── Gemini config (OPTIONAL UPGRADE) ──────────────────────────────────────────
GEMINI_MODEL       = "gemini-2.0-flash"
GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_BATCH_SIZE  = 8
GEMINI_MAX_CALLS   = 10   # conservative — free tier quota issues; use Groq instead
GEMINI_DELAY_S     = 5.0  # 15 RPM free tier → 4s minimum; 5s is safe

# ── GDELT config ───────────────────────────────────────────────────────────────
GDELT_API_URL   = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_TIMESPAN  = "60min"   # look back 60 min (GDELT has ~10-15 min lag)
GDELT_MAX_ARTS  = 20        # per query — reduced to avoid hammering their servers
GDELT_DELAY_S   = 4.0       # seconds between GDELT queries — they rate-limit fast requests

# ── Dell site data ─────────────────────────────────────────────────────────────
def _load_sites():
    try:
        with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  WARN: could not load locations.json: {e}")
        return []

DELL_SITES = _load_sites()

# Compact representation for Gemini prompt (~400 tokens for all 55 sites)
_SITE_LINES = ", ".join(
    f"{s['name'].replace('Dell ', '')}"
    for s in DELL_SITES
)
DELL_SITES_COMPACT = f"Dell has {len(DELL_SITES)} global sites: {_SITE_LINES}."

# ── RSS Feed Sources ───────────────────────────────────────────────────────────
# Curated for physical security / supply chain / crisis / workforce domain.
# Removed: ~20 pure cybersecurity feeds (DarkReading, THN, Bleeping, MSRC, etc.)
# Added: labor/industrial action, broader APJC/EMEA regional coverage
FEEDS = [
    # ── Natural Hazards (always fetch — deterministic tier-1 sources) ──────────
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "https://www.emsc-csem.org/service/rss/rss.php?typ=emsc",
    "https://www.jma.go.jp/bosai/feed/rss/eqvol.xml",
    "https://emergency.copernicus.eu/mapping/list-of-activations-rapid/feed",
    "https://www.fema.gov/rss/disaster_declarations.rss",
    # ── Dell Brand / Workforce Monitoring ─────────────────────────────────────
    "https://news.google.com/rss/search?q=Dell+Technologies&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Dell+layoffs+OR+Dell+restructuring+OR+Dell+executive&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22Dell+Technologies%22+breach+OR+incident+OR+security&hl=en-US&gl=US&ceid=US:en",
    "https://www.reddit.com/r/layoffs/search.rss?q=dell&sort=new&restrict_sr=1",
    # ── Tier-1 Global News ────────────────────────────────────────────────────
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/topNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://apnews.com/apf-worldnews?format=xml",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.theguardian.com/world/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://feeds.washingtonpost.com/rss/world",
    "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
    "https://www.scmp.com/rss/91/feed",
    # ── APJC Regional (Dell's largest manufacturing + workforce region) ────────
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed",  # Singapore
    "https://www.thehindu.com/news/feeder/default.rss",          # India
    "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", # India
    "https://www.hindustantimes.com/rss/topnews/rssfeed.xml",    # India
    "https://www.japantimes.co.jp/news/feed/",                   # Japan
    "https://www3.nhk.or.jp/nhkworld/en/news/feeds/",            # Japan NHK
    "https://japantoday.com/feed/atom",
    "https://www.koreatimes.co.kr/www/rss/rss.xml",              # Korea
    "https://www.bangkokpost.com/rss",                           # Thailand
    "https://vnexpress.net/rss",                                  # Vietnam
    "https://www.abc.net.au/news/feed/51120/rss.xml",            # Australia
    "https://www.abc.net.au/news/feed/48480/rss.xml",
    "https://www.theguardian.com/australia-news/rss",
    "https://www.asahi.com/rss/asahi/newsheadlines.rdf",
    # ── EMEA Regional ─────────────────────────────────────────────────────────
    "https://www.france24.com/en/rss",
    "https://www.euronews.com/rss?level=world",
    "https://www.dw.com/en/top-stories/world/s-1429/rss",
    "https://www.arabnews.com/taxonomy/term/1/feed",
    "https://www.middleeasteye.net/rss",
    "https://www.spiegel.de/schlagzeilen/tops/index.rss",        # Germany
    "https://www.themoscowtimes.com/rss/news",                   # Russia/Ukraine context
    "https://meduza.io/rss/all",
    # ── LATAM Regional ────────────────────────────────────────────────────────
    "https://www.batimes.com.ar/rss-feed",                       # Argentina
    "https://en.mercopress.com/rss",
    "https://www.latinnews.com/index.php?format=feed",
    # ── Africa ────────────────────────────────────────────────────────────────
    "https://www.africanews.com/feed/xml",
    "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf",
    "https://dailytrust.com/feed/",
    # ── Supply Chain / Logistics (HIGH PRIORITY domain) ───────────────────────
    "https://www.freightwaves.com/feed",
    "https://www.supplychaindive.com/feeds/news/",
    "https://gcaptain.com/feed/",
    "https://theloadstar.com/feed/",
    "https://splash247.com/feed/",
    "https://www.maritime-executive.com/rss",
    "https://www.joc.com/rss.xml",
    "https://www.porttechnology.org/feed/",
    "https://www.maritimebulletin.net/feed/",
    "https://www.iata.org/en/pressroom/news-releases/rss/",
    "https://www.aircargonews.net/feed/",
    "https://www.portoflosangeles.org/rss/news",
    "https://www.portofantwerpbruges.com/en/news/rss",
    # ── Labor / Industrial Action (NEW — was completely missing) ──────────────
    # These sources cover workforce disruptions that cascade to Dell operations
    "https://news.google.com/rss/search?q=strike+workers+industrial+action+2025&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=teachers+strike+school+closure&hl=en-AU&gl=AU&ceid=AU:en",
    "https://news.google.com/rss/search?q=transport+strike+bus+train+metro+workers&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=port+strike+shipping+workers+dock&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=manufacturing+strike+factory+workers&hl=en-US&gl=US&ceid=US:en",
    # ── Government / Travel / Emergency ───────────────────────────────────────
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",
    "https://www.fbi.gov/feeds/fbi-top-stories/rss.xml",
    "https://www.europol.europa.eu/media-press/rss.xml",
    "https://www.publicsafety.gc.ca/cnt/ntnl-scrt/rss-en.aspx",
    "https://www.civildefence.govt.nz/rss-feed",
    "https://www.dhs.gov/news-releases.xml",
    "https://www.state.gov/press-releases/rss/",
    "https://www.cisa.gov/news.xml",    # General CISA alerts (not pure cyber advisories)
    "https://www.abf.gov.au/_layouts/15/AppPages/Rss.aspx?site=newsroom",
    "https://www.iaea.org/feeds/topnews",  # Nuclear/radiological events
    # ── Humanitarian / Crisis Organizations ───────────────────────────────────
    "https://reliefweb.int/updates/rss.xml",
    "https://www.crisisgroup.org/rss.xml",
    "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
    "https://www.who.int/rss-feeds/news-english.xml",
    "https://www.ifrc.org/feeds/all.xml",
    "https://www.icrc.org/en/rss-feed",
    "https://acleddata.com/feed/",
    # ── Security / Geopolitical Think Tanks ───────────────────────────────────
    "https://www.cfr.org/rss.xml",
    "https://www.chathamhouse.org/rss-feeds/all",
    "https://www.rand.org/tools/rss.xml",
    "https://www.globalsecurity.org/military/world/rss.xml",
    "https://www.bellingcat.com/feed/",
    "https://www.nato.int/cps/en/natolive/news.rss",
    "https://responsiblestatecraft.org/feed/",
    # ── Aviation / Transport ──────────────────────────────────────────────────
    "https://avherald.com/h?subscribe=rss",
    "https://simpleflying.com/feed/",
]

# ── GDELT real-time queries ────────────────────────────────────────────────────
# GDELT monitors every global news source in near real-time, translated from 65 langs.
# Catches events that never make it to Western RSS feeds (local strikes, regional unrest).
# No API key needed. Rate limit: use GDELT_DELAY_S between each query.
# Kept to 8 queries (down from 12) to stay within rate limits.
GDELT_QUERIES = [
    "civil unrest protest riot curfew state of emergency",
    "workers strike industrial action stoppage school closure",
    "port closure shipping disruption cargo container factory",
    "power outage blackout grid failure infrastructure disruption",
    "disease outbreak epidemic quarantine health emergency",
    "flood earthquake typhoon hurricane wildfire evacuation disaster",
    "travel ban border closure airport shutdown advisory",
    "supply chain logistics disruption manufacturing shutdown",
]

# ── Hard blocklist — never relevant ───────────────────────────────────────────
_HARD_BLOCK = re.compile(
    r"\b(sport(?:s)?|football|soccer|cricket|rugby|tennis|basketball|nba|nfl|"
    r"premier.league|champions.league|formula.?1|nascar|golf.tournament|"
    r"celebrity|movie|film|cinema|concert|award|oscar|grammy|emmy|bafta|"
    r"tv.show|series.finale|season.premiere|sitcom|reality.show|"
    r"lottery|horoscope|astrology|fashion|gossip|lifestyle|recipe|restaurant|"
    r"real.estate.tips|home.decor|gardening)\b",
    flags=re.IGNORECASE,
)

# ── Cyber-only filter — deprioritize unless Dell-specific ─────────────────────
# These are pure cyber/IT articles that have no physical operational consequence
_CYBER_ONLY = re.compile(
    r"\b(ransomware|phishing|malware|zero.?day|CVE-\d|patch.tuesday|"
    r"vulnerability.(?:discovered|found|patched|disclosed)|"
    r"exploit.(?:released|published|found)|bug.bounty|penetration.test|"
    r"security.advisory|firmware.update|software.patch|"
    r"threat.actor|apt.group|threat.intelligence.report)\b",
    flags=re.IGNORECASE,
)
_DELL_MENTION = re.compile(r"\bdell\b", flags=re.IGNORECASE)

# ── Helpers ────────────────────────────────────────────────────────────────────
def _clean(html):
    """Strip HTML tags, return plain text."""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True) if html else ""


def _haversine_km(lat1, lon1, lat2, lon2):
    """Distance in km between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _nearest_site(lat, lon):
    """Return (site_name, distance_km) for nearest Dell site."""
    if not DELL_SITES or not lat or not lon:
        return None, None
    best, best_d = None, float("inf")
    for s in DELL_SITES:
        d = _haversine_km(lat, lon, s["lat"], s["lon"])
        if d < best_d:
            best_d, best = d, s["name"]
    return best, round(best_d)


# ── GDELT Scout ───────────────────────────────────────────────────────────────
def fetch_gdelt(query):
    """
    Query GDELT Doc 2.0 API. Returns list of raw article dicts.
    Free, no API key. Covers global news in near real-time.
    """
    params = {
        "query":       query,
        "mode":        "artlist",
        "maxrecords":  str(GDELT_MAX_ARTS),
        "format":      "json",
        "timespan":    GDELT_TIMESPAN,
        "sourcelang":  "english",
        "sort":        "datedesc",
    }
    url = GDELT_API_URL + "?" + urlencode(params)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        out = []
        for item in (data.get("articles") or []):
            title = (item.get("title") or "").strip()
            if not title:
                continue
            out.append({
                "title":   title,
                "url":     item.get("url", ""),
                "body":    title,   # GDELT doesn't return body text
                "source":  urlparse(item.get("url", "")).netloc.replace("www.", ""),
                "time":    item.get("seendate", ""),
                "gdelt":   True,
            })
        return out
    except Exception as ex:
        print(f"    GDELT error [{query[:40]}]: {ex}")
        return []


# ── Gemini Analyst ────────────────────────────────────────────────────────────
_GEMINI_SYSTEM = f"""You are the AI Security Intelligence Analyst for Dell Technologies' Global Security & Resiliency Operations (SRO) team.
Your users are Regional Security Managers, Regional Security Directors, the Security VP, and Crisis Leads.

{DELL_SITES_COMPACT}

DOMAIN: Physical security, workforce safety, supply chain, crisis management.
CYBER: Lowest priority — only surface if there is a confirmed DIRECT physical or operational impact on Dell (e.g., cyberattack causing power failure at a Dell facility, OT/ICS attack affecting Dell manufacturing). Exclude all other cyber news: ransomware reports, CVEs, patches, advisories, vendor security updates, threat research.

PRIORITY CATEGORIES:
1 PHYSICAL_SECURITY  — Protests, civil unrest, riots, terrorism, armed conflict, violent crime near Dell offices
2 CIVIL_UNREST       — Political instability, coups, mass demonstrations, curfews, states of emergency
3 NATURAL_DISASTER   — Earthquakes, floods, typhoons, hurricanes, wildfires, extreme weather
4 SUPPLY_CHAIN       — Port/airport closures, shipping lane disruptions, cargo disruptions, logistics failures, manufacturing shutdowns
5 LABOR_ACTION       — Any strikes or work stoppages. CRITICAL: include SECONDARY EFFECTS even if the strike is not in Dell's industry:
                       * Teacher/school strike → employees with children cannot attend work → workforce availability impact
                       * Bus/train/metro strike → employees cannot commute → Dell office attendance drop
                       * Public sector strike → government services disrupted → operational impact
6 INFRASTRUCTURE     — Power grid failures, internet outages, road/bridge/tunnel closures affecting Dell site access
7 HEALTH_WORKFORCE   — Disease outbreaks, health advisories that reduce workforce availability or require travel restrictions
8 TRAVEL_SECURITY    — Government travel advisories, airport/border closures, executive travel risk
9 BRAND_MONITORING   — Dell layoffs, restructuring, executive changes, data breaches, insider incidents, reputation risk
10 CYBER_DIRECT      — ONLY if confirmed direct physical/operational impact on Dell operations (see above)
NOT_RELEVANT         — General cyber/IT news, sports, entertainment, opinion, academic research, general financial news

SECOND-ORDER REASONING: Always consider how an event cascades to Dell operations.
Example: "NSW teachers strike" → schools close → Dell Sydney/Melbourne employees with school-age children cannot come to work → estimated 10-25% workforce reduction at those sites for the duration."""


def gemini_classify_batch(api_key, articles):
    """
    Send a batch of articles to Gemini 2.0 Flash.
    Returns list of assessment dicts (one per article), or [] on failure.
    """
    articles_payload = json.dumps([
        {
            "idx":    i,
            "title":  a["title"],
            "body":   a["body"][:250],
            "source": a.get("source", ""),
        }
        for i, a in enumerate(articles)
    ], ensure_ascii=False)

    user_msg = f"""Analyze these {len(articles)} articles for Dell SRO operational relevance.

ARTICLES:
{articles_payload}

Return a JSON array, one object per article:
[{{"idx":0,"relevant":true,"score":1-10,"category":"PHYSICAL_SECURITY|CIVIL_UNREST|NATURAL_DISASTER|SUPPLY_CHAIN|LABOR_ACTION|INFRASTRUCTURE|HEALTH_WORKFORCE|TRAVEL_SECURITY|BRAND_MONITORING|CYBER_DIRECT|NOT_RELEVANT","severity":"LOW|MEDIUM|HIGH|CRITICAL","locations":["city, country"],"dell_region":"AMER|EMEA|APJC|LATAM|Global","operational_impact":"one sentence","second_order":"cascading Dell workforce/ops effect if any, else empty string"}}]"""

    payload = json.dumps({
        "contents": [
            {"role": "user", "parts": [{"text": _GEMINI_SYSTEM}]},
            {"role": "model", "parts": [{"text": "Understood. I will analyze articles for Dell SRO operational relevance with second-order reasoning. I will return only valid JSON."}]},
            {"role": "user", "parts": [{"text": user_msg}]},
        ],
        "generationConfig": {
            "temperature":      0,
            "maxOutputTokens":  2048,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")

    url = f"{GEMINI_API_BASE}/{GEMINI_MODEL}:generateContent?key={api_key}"
    req = urllib.request.Request(url, data=payload,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        raw = result["candidates"][0]["content"]["parts"][0]["text"]
        raw = re.sub(r"```json\s*|\s*```", "", raw).strip()
        assessments = json.loads(raw)
        if isinstance(assessments, dict):
            assessments = [assessments]
        return assessments

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:400]
        print(f"    Gemini HTTP {e.code}: {body}")
        if e.code == 429:
            time.sleep(15)
        return []
    except Exception as ex:
        print(f"    Gemini error: {ex}")
        return []


# ── Groq batch classifier (PRIMARY AI) ────────────────────────────────────────
_GROQ_SYSTEM = f"""You are the AI Security Intelligence Analyst for Dell Technologies' Global Security & Resiliency Operations (SRO).
Users: Regional Security Managers, Regional Security Directors, Security VP, Crisis Leads.

{DELL_SITES_COMPACT}

DOMAIN: Physical security, workforce safety, supply chain, crisis management. NOT cyber/IT.

PRIORITY CATEGORIES (highest first):
1 PHYSICAL_SECURITY  — Protests, unrest, riots, terrorism, armed conflict, crime near Dell offices
2 CIVIL_UNREST       — Coups, mass demos, curfews, states of emergency, political instability
3 NATURAL_DISASTER   — Earthquakes M5+, floods, typhoons, hurricanes, wildfires
4 SUPPLY_CHAIN       — Port/airport closures, shipping disruption, cargo issues, manufacturing shutdowns
5 LABOR_ACTION       — ANY strike/stoppage including SECONDARY EFFECTS: teacher strike=school closure=employee childcare crisis; transport strike=employee commute failure
6 INFRASTRUCTURE     — Power outages, internet failures, road/rail closures affecting Dell site access
7 HEALTH_WORKFORCE   — Disease outbreaks, health advisories reducing workforce availability
8 TRAVEL_SECURITY    — Travel advisories, airport/border closures, executive travel risk
9 BRAND_MONITORING   — Dell layoffs, executive changes, breaches, insider incidents
10 CYBER_DIRECT      — ONLY if cyber causes confirmed physical/operational impact (OT/ICS attack, grid failure). NOT: ransomware news, CVEs, patches, security research.
NOT_RELEVANT         — Pure cyber/IT news, sports, entertainment, opinion, general markets

SECOND-ORDER REASONING: Always ask how an event cascades to Dell.
Teacher strike → schools close → employees with children absent → workforce drop at nearby Dell sites.
Transit strike → employees can't commute → office attendance falls."""


def groq_classify_batch(api_key, articles):
    """
    Send batch of articles to Groq llama-3.3-70b for Dell-context-aware classification.
    Primary AI path. Returns list of assessment dicts, or [] on failure.
    """
    articles_payload = json.dumps([
        {"idx": i, "title": a["title"], "body": a["body"][:250], "source": a.get("source", "")}
        for i, a in enumerate(articles)
    ], ensure_ascii=False)

    user_msg = f"""Analyze these {len(articles)} articles for Dell SRO operational relevance.

ARTICLES:
{articles_payload}

Return a JSON array with one object per article:
[{{"idx":0,"relevant":true,"score":1-10,"category":"PHYSICAL_SECURITY|CIVIL_UNREST|NATURAL_DISASTER|SUPPLY_CHAIN|LABOR_ACTION|INFRASTRUCTURE|HEALTH_WORKFORCE|TRAVEL_SECURITY|BRAND_MONITORING|CYBER_DIRECT|NOT_RELEVANT","severity":"LOW|MEDIUM|HIGH|CRITICAL","locations":["city, country"],"dell_region":"AMER|EMEA|APJC|LATAM|Global","operational_impact":"one sentence on Dell ops impact","second_order":"cascading effect on Dell workforce/supply chain, or empty string"}}]"""

    payload = json.dumps({
        "model":       GROQ_MODEL,
        "temperature": 0,
        "max_tokens":  2048,
        "messages": [
            {"role": "system", "content": _GROQ_SYSTEM},
            {"role": "user",   "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib.request.Request(GROQ_API_URL, data=payload,
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"].strip()
        content = re.sub(r"```json\s*|\s*```", "", content).strip()
        parsed = json.loads(content)
        # Groq JSON mode returns object, not array — unwrap if needed
        if isinstance(parsed, dict):
            # Try common wrapper keys
            for key in ("articles", "results", "assessments", "items"):
                if key in parsed and isinstance(parsed[key], list):
                    return parsed[key]
            # Single result wrapped as object — return as list
            if "idx" in parsed:
                return [parsed]
            return []
        return parsed  # already a list
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"    Groq HTTP {e.code}: {body}")
        if e.code == 429:
            time.sleep(10)
        return []
    except Exception as ex:
        print(f"    Groq batch error: {ex}")
        return []


# ── Keyword fallback (last resort — no AI available) ──────────────────────────
def keyword_classify(title, body):
    """Heuristic fallback when neither Gemini nor Groq is available."""
    text = (title + " " + body).lower()
    # Immediately reject pure cyber-only
    if _CYBER_ONLY.search(text) and not _DELL_MENTION.search(text):
        return None

    checks = [
        (r"\b(protest|riot|unrest|coup|curfew|martial.law|demonstration|civil.war|"
         r"attack|bomb|explosion|shooting|terror|hostage|armed|troops|military.action)\b",
         "PHYSICAL_SECURITY", "HIGH"),
        (r"\b(strike|industrial.action|walkout|picket|work.stoppage|"
         r"teachers?.strike|school.clos|transport.strike|bus.strike|train.strike|"
         r"metro.strike|transit.strike|dock.strike|port.strike)\b",
         "LABOR_ACTION", "MEDIUM"),
        (r"\b(port.clos|shipping.disrupt|supply.chain|cargo.disrupt|"
         r"container.shortage|logistics.halt|factory.clos|manufacturing.halt|"
         r"freight.disrupt|airspace.clos|airport.clos)\b",
         "SUPPLY_CHAIN", "MEDIUM"),
        (r"\b(earthquake|tsunami|typhoon|hurricane|flood|wildfire|eruption|"
         r"disaster|emergency.declar|evacuation|state.of.emergency)\b",
         "NATURAL_DISASTER", "HIGH"),
        (r"\b(power.outage|blackout|grid.failure|infrastructure.attack|"
         r"internet.outage|road.clos|bridge.clos)\b",
         "INFRASTRUCTURE", "MEDIUM"),
        (r"\b(outbreak|epidemic|pandemic|quarantine|health.advisory|"
         r"travel.ban|disease.spread|health.emergency)\b",
         "HEALTH_WORKFORCE", "MEDIUM"),
        (r"\b(travel.advisory|do.not.travel|border.clos|embassy|"
         r"evacuation.order|safety.alert)\b",
         "TRAVEL_SECURITY", "MEDIUM"),
        (r"\b(dell.layoff|dell.breach|dell.incident|dell.restructur|"
         r"dell.executive|dell.ceo|dell.cto|dell.insider)\b",
         "BRAND_MONITORING", "HIGH"),
    ]
    for pattern, cat, sev in checks:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return {"category": cat, "score": 6, "severity": sev,
                    "operational_impact": f"{cat.replace('_', ' ').title()} event detected.",
                    "locations": [], "dell_region": "Global"}
    return None


# ── Feedback loader ────────────────────────────────────────────────────────────
def load_feedback():
    block_keys, boost_keys = set(), set()
    if not os.path.exists(FEEDBACK_PATH):
        return block_keys, boost_keys
    with open(FEEDBACK_PATH, "r", encoding="utf-8") as f:
        for line in f:
            try:
                obj = json.loads(line.strip())
                label = (obj.get("label") or "").upper()
                url   = (obj.get("url") or "").strip().lower()
                title = (obj.get("title") or "").strip().lower()
                key   = url or title
                if not key:
                    continue
                if label == "NOT_RELEVANT":
                    block_keys.add(key)
                elif label in ("CRITICAL", "KEEP"):
                    boost_keys.add(key)
            except Exception:
                continue
    return block_keys, boost_keys


# ── Region mapper (for dashboard display) ─────────────────────────────────────
def map_region(text):
    t = (text or "").lower()
    if any(x in t for x in ["china", "asia", "india", "japan", "australia",
                             "thailand", "vietnam", "indonesia", "malaysia",
                             "singapore", "korea", "taiwan", "philippines",
                             "apjc", "hong kong", "myanmar", "bangladesh"]):
        return "APJC"
    if any(x in t for x in ["uk", "britain", "europe", "germany", "france",
                             "ireland", "israel", "ukraine", "russia", "africa",
                             "netherlands", "sweden", "spain", "italy", "emea",
                             "middle east", "dubai", "saudi", "poland", "czech"]):
        return "EMEA"
    if any(x in t for x in ["usa", "united states", "canada", "brazil", "mexico",
                             "colombia", "argentina", "chile", "latam", "amer",
                             "peru", "venezuela", "ecuador"]):
        return "AMER"
    return "Global"


_TYPE_MAP = {
    "PHYSICAL_SECURITY":  "PHYSICAL SECURITY",
    "CIVIL_UNREST":       "CIVIL UNREST",
    "NATURAL_DISASTER":   "CRISIS / WEATHER",
    "SUPPLY_CHAIN":       "SUPPLY CHAIN",
    "LABOR_ACTION":       "LABOR / WORKFORCE",
    "INFRASTRUCTURE":     "INFRASTRUCTURE",
    "HEALTH_WORKFORCE":   "HEALTH / SAFETY",
    "TRAVEL_SECURITY":    "TRAVEL ADVISORY",
    "BRAND_MONITORING":   "INSIDER / LEAKS",
    "CYBER_DIRECT":       "CYBER SECURITY",
}

_SEV_NUM = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


# ── Main pipeline ──────────────────────────────────────────────────────────────
def main():
    groq_key   = os.getenv("GROQ_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    # Groq is primary — 14,400 req/day free, reliable, batch-capable
    # Gemini is optional upgrade — only use if Groq unavailable AND Gemini quota exists
    if groq_key:
        print(f"SRO Brain v2.0 — Groq {GROQ_MODEL} (PRIMARY, batch mode)")
        ai_mode = "groq"
    elif gemini_key:
        print("SRO Brain v2.0 — Gemini 2.0 Flash (fallback — check quota at aistudio.google.com)")
        ai_mode = "gemini"
    else:
        print("SRO Brain v2.0 — Keyword-only mode (no AI keys set)")
        ai_mode = "keyword"

    block_keys, boost_keys = load_feedback()

    # ── Phase 1: Scout — collect raw articles ─────────────────────────────────
    print(f"\n[SCOUT] Fetching {len(FEEDS)} RSS feeds...")
    raw_articles = []
    seen_titles  = set()

    for feed_url in FEEDS:
        try:
            f = feedparser.parse(feed_url)
            entries = getattr(f, "entries", [])
            if entries:
                print(f"  ✓ {feed_url[-60:]:60s} → {len(entries)} entries")
            for e in entries[:6]:
                title = (getattr(e, "title", "") or "").strip()
                if not title or title.lower() in seen_titles:
                    continue
                seen_titles.add(title.lower())

                raw_body = _clean(getattr(e, "summary", "") or "")
                if hasattr(e, "content") and e.content:
                    try:
                        cv = e.content[0].value
                        if cv:
                            raw_body = _clean(cv)
                    except Exception:
                        pass

                link   = getattr(e, "link", "") or ""
                source = (urlparse(link).netloc or urlparse(feed_url).netloc).replace("www.", "")

                url_key   = link.strip().lower()
                title_key = title.lower()
                if url_key in block_keys or title_key in block_keys:
                    continue

                # Hard blocklist — entertainment/sports
                if _HARD_BLOCK.search(title + " " + raw_body[:200]):
                    continue

                # Cyber-only pre-filter: skip if clearly pure IT security and no Dell mention
                if _CYBER_ONLY.search(title) and not _DELL_MENTION.search(title + " " + raw_body[:100]):
                    continue

                pub_time = datetime.now(timezone.utc).isoformat()
                try:
                    if hasattr(e, "published_parsed") and e.published_parsed:
                        pub_time = datetime(
                            *e.published_parsed[:6], tzinfo=timezone.utc
                        ).isoformat()
                except Exception:
                    pass

                raw_articles.append({
                    "title":    title,
                    "url":      link,
                    "body":     raw_body[:500],
                    "source":   source,
                    "time":     pub_time,
                    "url_key":  url_key,
                    "title_key": title_key,
                    "boost":    (url_key in boost_keys or title_key in boost_keys),
                })
        except Exception as ex:
            print(f"  ✗ {feed_url[-60:]:60s} → {ex}")

    # ── Phase 1b: GDELT Scout ─────────────────────────────────────────────────
    print(f"\n[SCOUT] Querying GDELT ({len(GDELT_QUERIES)} queries, last {GDELT_TIMESPAN})...")
    gdelt_total = 0
    for qi, query in enumerate(GDELT_QUERIES):
        if qi > 0:
            time.sleep(GDELT_DELAY_S)  # respect GDELT rate limits
        articles = fetch_gdelt(query)
        for a in articles:
            title = a["title"]
            if title.lower() in seen_titles:
                continue
            if _HARD_BLOCK.search(title):
                continue
            if _CYBER_ONLY.search(title) and not _DELL_MENTION.search(title):
                continue
            seen_titles.add(title.lower())
            raw_articles.append({
                "title":     title,
                "url":       a["url"],
                "body":      title,   # GDELT returns title only
                "source":    a["source"],
                "time":      datetime.now(timezone.utc).isoformat(),
                "url_key":   a["url"].strip().lower(),
                "title_key": title.lower(),
                "boost":     False,
                "gdelt":     True,
            })
            gdelt_total += 1

    print(f"  GDELT added {gdelt_total} new articles")
    print(f"\n[SCOUT] Total raw articles: {len(raw_articles)}")

    # ── Phase 2: Analyst — AI classification ──────────────────────────────────
    print(f"\n[ANALYST] Mode: {ai_mode.upper()} — classifying {len(raw_articles)} articles...")
    results = []

    if ai_mode == "gemini":
        # Batch articles and send to Gemini
        gemini_calls = 0
        for batch_start in range(0, len(raw_articles), GEMINI_BATCH_SIZE):
            if gemini_calls >= GEMINI_MAX_CALLS:
                print(f"  Gemini call cap reached ({GEMINI_MAX_CALLS})")
                break

            batch = raw_articles[batch_start: batch_start + GEMINI_BATCH_SIZE]
            print(f"  Gemini batch {gemini_calls + 1}: articles {batch_start}–{batch_start + len(batch) - 1}")
            assessments = gemini_classify_batch(gemini_key, batch)
            gemini_calls += 1

            if assessments:
                for assessment in assessments:
                    idx = assessment.get("idx", 0)
                    if idx >= len(batch):
                        continue
                    article = batch[idx]

                    relevant = assessment.get("relevant", False)
                    score    = int(assessment.get("score", 0) or 0)
                    cat      = assessment.get("category", "NOT_RELEVANT")

                    if not relevant or cat == "NOT_RELEVANT" or score < MIN_RELEVANCE_SCORE:
                        continue

                    # Boost flagged articles
                    if article.get("boost") and score < 7:
                        score = 7

                    sev_str = (assessment.get("severity") or "LOW").upper()
                    sev_num = _SEV_NUM.get(sev_str, 1)
                    if article.get("boost") and sev_num < 3:
                        sev_num = 3

                    op_impact   = assessment.get("operational_impact", "")
                    second_ord  = assessment.get("second_order", "")
                    locations   = assessment.get("locations") or []
                    dell_region = assessment.get("dell_region") or map_region(
                        article["title"] + " " + " ".join(locations)
                    )

                    snippet = op_impact
                    if second_ord:
                        snippet = f"{op_impact} | {second_ord}"
                    if not snippet:
                        snippet = article["body"][:160]

                    results.append({
                        "title":            article["title"],
                        "url":              article["url"],
                        "snippet":          snippet,
                        "body":             article["body"][:600],
                        "source":           article["source"],
                        "time":             article["time"],
                        "region":           dell_region,
                        "severity":         sev_num,
                        "type":             _TYPE_MAP.get(cat, "GENERAL"),
                        "locations":        locations,
                        "operational_impact": op_impact,
                        "second_order":     second_ord,
                        "ai_score":         score,
                        "gdelt":            article.get("gdelt", False),
                    })
                    print(f"  [KEEP] {cat:20s} sev={sev_num} score={score:2d} | {article['title'][:70]}")

            time.sleep(GEMINI_DELAY_S)

        print(f"  Gemini calls used: {gemini_calls}")

    elif ai_mode == "groq":
        # Batch mode — same quality prompt as Gemini, 8 articles per call
        groq_calls = 0
        for batch_start in range(0, len(raw_articles), GROQ_BATCH_SIZE):
            if groq_calls >= GROQ_MAX_CALLS:
                print(f"  Groq call cap reached ({GROQ_MAX_CALLS})")
                break

            batch = raw_articles[batch_start: batch_start + GROQ_BATCH_SIZE]
            print(f"  Groq batch {groq_calls + 1}: articles {batch_start}–{batch_start + len(batch) - 1}")
            assessments = groq_classify_batch(groq_key, batch)
            groq_calls += 1

            if assessments:
                for assessment in assessments:
                    idx = assessment.get("idx", 0)
                    if idx >= len(batch):
                        continue
                    article = batch[idx]

                    relevant = assessment.get("relevant", False)
                    score    = int(assessment.get("score", 0) or 0)
                    cat      = assessment.get("category", "NOT_RELEVANT")

                    if not relevant or cat == "NOT_RELEVANT" or score < MIN_RELEVANCE_SCORE:
                        continue

                    if article.get("boost") and score < 7:
                        score = 7

                    sev_str = (assessment.get("severity") or "LOW").upper()
                    sev_num = _SEV_NUM.get(sev_str, 1)
                    if article.get("boost") and sev_num < 3:
                        sev_num = 3

                    op_impact   = assessment.get("operational_impact", "")
                    second_ord  = assessment.get("second_order", "")
                    locations   = assessment.get("locations") or []
                    dell_region = assessment.get("dell_region") or map_region(
                        article["title"] + " " + " ".join(locations)
                    )

                    snippet = op_impact
                    if second_ord:
                        snippet = f"{op_impact} | {second_ord}"
                    if not snippet:
                        snippet = article["body"][:160]

                    results.append({
                        "title":              article["title"],
                        "url":                article["url"],
                        "snippet":            snippet,
                        "body":               article["body"][:600],
                        "source":             article["source"],
                        "time":               article["time"],
                        "region":             dell_region,
                        "severity":           sev_num,
                        "type":               _TYPE_MAP.get(cat, "GENERAL"),
                        "locations":          locations,
                        "operational_impact": op_impact,
                        "second_order":       second_ord,
                        "ai_score":           score,
                        "gdelt":              article.get("gdelt", False),
                    })
                    print(f"  [KEEP] {cat:20s} sev={sev_num} score={score:2d} | {article['title'][:70]}")

            time.sleep(GROQ_DELAY_S)

        print(f"  Groq calls used: {groq_calls}")

    else:
        # Keyword-only mode
        for article in raw_articles:
            analysis = keyword_classify(article["title"], article["body"])
            if not analysis:
                continue
            cat     = analysis.get("category", "NOT_RELEVANT")
            sev_str = (analysis.get("severity") or "LOW").upper()
            sev_num = _SEV_NUM.get(sev_str, 1)
            results.append({
                "title":              article["title"],
                "url":                article["url"],
                "snippet":            article["body"][:160],
                "body":               article["body"][:600],
                "source":             article["source"],
                "time":               article["time"],
                "region":             map_region(article["title"]),
                "severity":           sev_num,
                "type":               _TYPE_MAP.get(cat, "GENERAL"),
                "locations":          [],
                "operational_impact": "",
                "second_order":       "",
                "ai_score":           5,
            })

    # ── Phase 3: Sort, deduplicate, write ─────────────────────────────────────
    # Sort: severity (high first), then time (newest first)
    results.sort(key=lambda x: (x.get("severity", 1), x.get("time", "")), reverse=True)

    # Cap to 300 items (KV limit)
    results = results[:300]

    # Write primary output
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n[OUTPUT] {len(results)} items → {NEWS_PATH}")

    # Mirror to /data/news.json for Worker fetch
    try:
        root_data = os.path.join(BASE_DIR, "data")
        os.makedirs(root_data, exist_ok=True)
        with open(os.path.join(root_data, "news.json"), "w", encoding="utf-8") as f2:
            json.dump(results, f2, indent=2, ensure_ascii=False)
        print(f"[OUTPUT] Mirrored to data/news.json")
    except Exception as ex:
        print(f"[OUTPUT] Mirror failed (non-fatal): {ex}")

    print(f"\nSRO Brain v2.0 complete — {len(results)} intelligence items | mode={ai_mode}")


if __name__ == "__main__":
    main()
