#!/usr/bin/env python3
"""
SRO Intelligence Ingest — Groq-powered with keyword fallback

Uses Groq free API (llama-3.1-8b-instant) for AI classification.
Falls back to keyword matching if Groq is unavailable.
Requires GROQ_API_KEY environment variable.
Writes to public/data/news.json + mirrors to data/news.json (repo root).
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
GROQ_CALLS_PER_RUN = 90  # free-tier safe limit (138 feeds × 8 items each; Groq free tier: ~100 req/min)

# ---------- RSS FEEDS ----------
# Full 110-source feed list mirrored from Worker.js DETERMINISTIC + ROTATING sources
FEEDS = [
    # ── Natural Hazards (deterministic — always fetched) ──────────────────────
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "https://www.emsc-csem.org/service/rss/rss.php?typ=emsc",
    "https://www.jma.go.jp/bosai/feed/rss/eqvol.xml",
    # ── Global Tier-1 News ────────────────────────────────────────────────────
    "https://feeds.reuters.com/reuters/worldNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/politicsNews",
    "https://feeds.reuters.com/reuters/topNews",
    "https://apnews.com/apf-worldnews?format=xml",
    "https://apnews.com/apf-news?format=xml",
    "https://www.afp.com/en/news-hub/rss",
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "http://rss.cnn.com/rss/edition.rss",
    "http://rss.cnn.com/rss/edition_world.rss",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.dw.com/en/top-stories/world/s-1429/rss",
    "https://www.dw.com/en/top-stories/business/s-1431/rss",
    "https://www.theguardian.com/world/rss",
    "https://www.theguardian.com/business/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://feeds.washingtonpost.com/rss/world",
    "https://feeds.washingtonpost.com/rss/business",
    "https://www.scmp.com/rss/91/feed",
    "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
    # ── Regional Coverage ─────────────────────────────────────────────────────
    "https://www.france24.com/en/rss",
    "https://www.euronews.com/rss?level=world",
    "https://www.arabnews.com/taxonomy/term/1/feed",
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed",
    "https://www.thehindu.com/news/feeder/default.rss",
    "https://www.hindustantimes.com/rss/topnews/rssfeed.xml",
    "https://www.japantimes.co.jp/news/feed/",
    "https://www.koreatimes.co.kr/www/rss/rss.xml",
    "https://www.africanews.com/feed/xml",
    "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf",
    "https://www.latinnews.com/index.php?format=feed",
    "https://www.batimes.com.ar/rss-feed",
    "https://www.abc.net.au/news/feed/51120/rss.xml",
    "https://www.abc.net.au/news/feed/48480/rss.xml",
    # ── Supply Chain / Logistics ──────────────────────────────────────────────
    "https://www.freightwaves.com/feed",
    "https://www.joc.com/rss.xml",
    "https://www.supplychaindive.com/feeds/news/",
    "https://gcaptain.com/feed/",
    "https://theloadstar.com/feed/",
    "https://splash247.com/feed/",
    "https://www.porttechnology.org/feed/",
    "https://www.maritime-executive.com/rss",
    "https://www.maritimebulletin.net/feed/",
    "https://www.portoflosangeles.org/rss/news",
    "https://www.portofantwerpbruges.com/en/news/rss",
    "https://www.mpa.gov.sg/web/rss/rss.xml",
    "https://www.iata.org/en/pressroom/news-releases/rss/",
    "https://www.aircargonews.net/feed/",
    # ── Government / Employee Safety / Travel ─────────────────────────────────
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",
    "https://www.fbi.gov/feeds/fbi-top-stories/rss.xml",
    "https://www.fbi.gov/feeds/national-press-releases/rss.xml",
    "https://www.europol.europa.eu/media-press/rss.xml",
    "https://www.abf.gov.au/_layouts/15/AppPages/Rss.aspx?site=newsroom",
    "https://www.publicsafety.gc.ca/cnt/ntnl-scrt/rss-en.aspx",
    "https://www.civildefence.govt.nz/rss-feed",
    # ── CISA / Cybersecurity Gov ──────────────────────────────────────────────
    "https://www.cisa.gov/news.xml",
    "https://www.cisa.gov/ics/xml",
    "https://www.cisa.gov/cybersecurity-advisories.xml",
    # ── Cybersecurity Industry ────────────────────────────────────────────────
    "https://www.darkreading.com/rss_simple.asp",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://www.bleepingcomputer.com/feed/",
    "https://www.csoonline.com/index.rss",
    "https://www.scmagazine.com/home/feed/",
    "https://msrc.microsoft.com/blog/feed",
    "https://www.crowdstrike.com/blog/feed/",
    "https://www.cloudflare.com/rss/",
    "https://www.mandiant.com/resources/rss.xml",
    "https://www.okta.com/blog/index.xml",
    "https://blog.talosintelligence.com/feed/",
    # ── Humanitarian / Crisis / OSINT ─────────────────────────────────────────
    "https://reliefweb.int/updates/rss.xml",
    "https://www.ifrc.org/feeds/all.xml",
    "https://www.globalsecurity.org/military/world/rss.xml",
    "https://www.crisisgroup.org/rss.xml",
    # ── UN & International Organizations ─────────────────────────────────────
    "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
    "https://www.nato.int/cps/en/natolive/news.rss",
    "https://www.who.int/rss-feeds/news-english.xml",
    "https://www.icrc.org/en/rss-feed",
    "https://www.unicef.org/press-releases/rss",
    # ── Additional Regional / International ───────────────────────────────────
    "https://www3.nhk.or.jp/nhkworld/en/news/feeds/",
    "https://www.middleeasteye.net/rss",
    "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
    "https://tass.com/rss/v2.xml",
    "https://en.mercopress.com/rss",
    # ── Security / Intelligence Think Tanks ───────────────────────────────────
    "https://www.cfr.org/rss.xml",
    "https://www.chathamhouse.org/rss-feeds/all",
    "https://www.sipri.org/rss.xml",
    "https://www.rand.org/tools/rss.xml",
    "https://acleddata.com/feed/",
    # ── US Government Security & Alerts ──────────────────────────────────────
    "https://www.state.gov/press-releases/rss/",
    "https://www.dhs.gov/news-releases.xml",
    "https://www.cbp.gov/newsroom/rss/",
    # ── Additional Cybersecurity ──────────────────────────────────────────────
    "https://krebsonsecurity.com/feed/",
    "https://feeds.feedburner.com/securityweek",
    "https://www.infosecurity-magazine.com/rss/news/",
    "https://isc.sans.edu/rssfeed.xml",
    "https://unit42.paloaltonetworks.com/feed/",
    "https://www.welivesecurity.com/feed/",
    "https://securelist.com/feed/",
    "https://nakedsecurity.sophos.com/feed/",
    "https://blog.rapid7.com/rss/",
    # ── Natural Hazards / Emergency Management ────────────────────────────────
    "https://emergency.copernicus.eu/mapping/list-of-activations-rapid/feed",
    "https://www.fema.gov/rss/disaster_declarations.rss",
    # ── OSINT / Cyber Threat Intelligence ────────────────────────────────────
    "https://www.ransomware.live/rss.xml",
    "https://www.schneier.com/feed/",
    "https://www.bellingcat.com/feed/",
    "https://www.zdnet.com/news/rss.xml",
    # ── Government / Security (additional) ───────────────────────────────────
    "https://www.gov.uk/government/organisations/ministry-of-defence.atom",
    "https://www.iaea.org/feeds/topnews",
    # ── Security Think Tanks (additional) ────────────────────────────────────
    "https://www.nti.org/rss/",
    "https://jamestown.org/feed/",
    "https://carnegieendowment.org/rss/",
    "https://www.stimson.org/feed/",
    "https://www.brookings.edu/feed/",
    "https://www.fpri.org/feed/",
    "https://responsiblestatecraft.org/feed/",
    # ── Regional News (coverage gaps) ────────────────────────────────────────
    "https://meduza.io/rss/all",
    "https://www.themoscowtimes.com/rss/news",
    "https://novayagazeta.eu/feed/rss",
    "https://www.asahi.com/rss/asahi/newsheadlines.rdf",
    "https://japantoday.com/feed/atom",
    "https://www.bangkokpost.com/rss",
    "https://vnexpress.net/rss",
    "https://www.theguardian.com/australia-news/rss",
    "https://dailytrust.com/feed/",
    "https://www.channelstv.com/feed/",
    "https://www.spiegel.de/schlagzeilen/tops/index.rss",
    # ── Aviation ─────────────────────────────────────────────────────────────
    "https://avherald.com/h?subscribe=rss",
    "https://simpleflying.com/feed/",
    "https://www.aerotelegraph.com/feed",
    "https://www.gov.uk/government/organisations/air-accidents-investigation-branch.atom",
    # ── Dell Brand Monitoring (always fetched) ───────────────────────────────
    "https://news.google.com/rss/search?q=Dell+Technologies&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Dell+layoffs+OR+Dell+breach+OR+Dell+hack&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=Dell+data+leak+OR+Dell+insider+OR+Dell+executive&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22Dell+Technologies%22+security+OR+threat+OR+vulnerability&hl=en-US&gl=US&ceid=US:en",
]

# ---------- BLOCKLIST ----------
BLOCKLIST_WORDS = [
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league", "cup", "tournament",
    "celebrity", "entertainment", "movie", "film", "concert",
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "review:", "opinion:", "editorial:", "tv show", "series finale", "premiere",
]
BLOCKLIST_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in BLOCKLIST_WORDS) + r")\b", flags=re.IGNORECASE)


# ---------- KEYWORD FALLBACK ----------
def keyword_classify(title, body):
    text = (title + " " + body).lower()
    if re.search(r"\b(ransomware|breach|hack|malware|cyber|cisa|vulnerability|exploit|phishing|ddos|data.?leak)\b", text):
        sev = "HIGH" if re.search(r"\b(critical|breach|ransomware|nation.state|confirmed)\b", text) else "MEDIUM"
        return {"category": "CYBER_SECURITY_MAJOR", "likelihood_relevant": 80, "severity": sev,
                "primary_reason": "Cybersecurity incident detected.",
                "geo_relevance": {"mentioned_countries_or_cities": []}}
    if re.search(r"\b(port|shipping|cargo|freight|strike|container|vessel|supply.chain|disruption|airport.clos|airspace)\b", text):
        return {"category": "SUPPLY_CHAIN_SECURITY", "likelihood_relevant": 75, "severity": "MEDIUM",
                "primary_reason": "Supply chain or logistics disruption.",
                "geo_relevance": {"mentioned_countries_or_cities": []}}
    if re.search(r"\b(earthquake|flood|hurricane|typhoon|tsunami|wildfire|volcanic|eruption|disaster|emergency|evacuation)\b", text):
        sev = "HIGH" if re.search(r"\b(major|severe|deadly|magnitude [6-9]|category [3-5])\b", text) else "MEDIUM"
        return {"category": "CRISIS_WEATHER", "likelihood_relevant": 80, "severity": sev,
                "primary_reason": "Natural disaster or emergency.",
                "geo_relevance": {"mentioned_countries_or_cities": []}}
    if re.search(r"\b(epidemic|pandemic|outbreak|pathogen|health.advisory|travel.ban|quarantine)\b", text):
        return {"category": "HEALTH_SAFETY", "likelihood_relevant": 75, "severity": "MEDIUM",
                "primary_reason": "Health or safety advisory.",
                "geo_relevance": {"mentioned_countries_or_cities": []}}
    if re.search(r"\b(protest|riot|terror|attack|bomb|shooting|war|conflict|coup|unrest|killed|troops|military|armed)\b", text):
        sev = "HIGH" if re.search(r"\b(terror|bomb|killed|troops|war|coup)\b", text) else "MEDIUM"
        return {"category": "PHYSICAL_SECURITY", "likelihood_relevant": 72, "severity": sev,
                "primary_reason": "Physical security event.",
                "geo_relevance": {"mentioned_countries_or_cities": []}}
    return {"category": "PHYSICAL_SECURITY", "likelihood_relevant": 45, "severity": "LOW",
            "primary_reason": "Keyword heuristic — low confidence.",
            "geo_relevance": {"mentioned_countries_or_cities": []}}


# ---------- GROQ ----------
def init_groq():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("GROQ_API_KEY not set — using keyword-only classification")
        return None
    return api_key


def ai_analyze_article(api_key, title, body, source, feedback_text):
    if not api_key:
        return keyword_classify(title, body)

    user_msg = f"""Classify this article for Dell SRO operational relevance.

CATEGORIES:
- PHYSICAL_SECURITY: Protests, riots, terror, war, crime, kidnapping, unrest, coups.
- SUPPLY_CHAIN_SECURITY: Port/airport closures, shipping disruption, strikes, cargo theft.
- CYBER_SECURITY_MAJOR: Confirmed breaches, ransomware, major outages, nation-state intrusions.
- CRISIS_WEATHER: Earthquakes, typhoons, floods, wildfires, grid failure, states of emergency.
- HEALTH_SAFETY: Epidemics, pandemics, travel bans, major health advisories.
- BRAND_MONITORING: Dell Technologies layoffs, restructuring, data breaches, leadership changes, executive departures, insider leaks, employee/chatter threats, harassment, reputational risk, Dell-specific vulnerabilities or incidents.
- NOT_RELEVANT: General politics, sports, entertainment, opinion, patch notes without confirmed impact.

FEEDBACK: {feedback_text}

ARTICLE:
Title: {title}
Body: {body[:800]}
Source: {source}

Return JSON only: {{"category":"...","likelihood_relevant":0-100,"severity":"LOW|MEDIUM|HIGH|CRITICAL","primary_reason":"one sentence","geo_relevance":{{"mentioned_countries_or_cities":[]}}}}"""

    payload = json.dumps({
        "model": GROQ_MODEL, "temperature": 0, "max_tokens": GROQ_MAX_TOKENS,
        "messages": [
            {"role": "system", "content": "You are a security news classifier for Dell SRO. Return ONLY valid JSON."},
            {"role": "user", "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib.request.Request(GROQ_API_URL, data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"].strip().strip("```json").strip("```").strip()
        return json.loads(content)
    except urllib.error.HTTPError as e:
        print(f"Groq HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
        if e.code in (429, 503):
            time.sleep(5)
        return keyword_classify(title, body)
    except Exception as ex:
        print(f"Groq error: {ex}")
        return keyword_classify(title, body)


# ---------- UTILS ----------
def clean_html(html):
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True) if html else ""

def is_obviously_irrelevant(text):
    return bool(BLOCKLIST_RE.search(text)) if text else False

def build_article_key(title, source, url):
    url = (url or "").strip().lower()
    if url:
        return f"u:{url}"
    return f"s:{(source or '').strip().lower()}|t:{(title or '').strip().lower()}"

def map_region(text):
    t = (text or "").lower()
    if any(x in t for x in ["china","asia","india","japan","australia","thailand","vietnam",
                             "indonesia","malaysia","singapore","korea","taiwan","philippines"]):
        return "APJC"
    if any(x in t for x in ["uk","britain","england","europe","germany","france","poland",
                             "ireland","israel","gaza","russia","ukraine","middle east",
                             "africa","netherlands","sweden","spain","italy"]):
        return "EMEA"
    if any(x in t for x in ["usa","united states","america","canada","brazil","mexico",
                             "colombia","argentina","chile","peru","panama"]):
        return "AMER"
    return "Global"


# ---------- FEEDBACK ----------
def load_feedback():
    block_keys, boost_keys, pos_ex, neg_ex = set(), set(), [], []
    if not os.path.exists(FEEDBACK_PATH):
        return block_keys, boost_keys, pos_ex, neg_ex
    with open(FEEDBACK_PATH, "r", encoding="utf-8") as f:
        for line in f:
            try:
                obj = json.loads(line.strip())
            except Exception:
                continue
            label = (obj.get("label") or "").upper()
            key = build_article_key(obj.get("title",""), obj.get("source",""), obj.get("url",""))
            if label == "NOT_RELEVANT":
                block_keys.add(key); neg_ex.append(obj)
            elif label == "CRITICAL":
                boost_keys.add(key); pos_ex.append(obj)
    return block_keys, boost_keys, pos_ex[-20:], neg_ex[-20:]

def build_feedback_prompt_section(pos_ex, neg_ex):
    if not pos_ex and not neg_ex:
        return "No prior feedback — use general security relevance rules."
    lines = ["Recent analyst feedback:"]
    if pos_ex:
        lines.append("KEEP:")
        lines += [f"- {e.get('source','')} – {e.get('title','')[:100]}" for e in pos_ex]
    if neg_ex:
        lines.append("DROP:")
        lines += [f"- {e.get('source','')} – {e.get('title','')[:100]}" for e in neg_ex]
    return "\n".join(lines)


# ---------- THELAYOFF.COM SCRAPER ----------
def scrape_thelayoff_dell(seen_titles: set) -> list:
    """
    Directly scrape thelayoff.com/dell for the latest 24-hour posts.
    Returns a list of article dicts in the same format as all_items.
    """
    url = "https://www.thelayoff.com/dell"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.thelayoff.com/",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  thelayoff.com fetch error: {e}")
        return []

    soup = BeautifulSoup(html, "html.parser")
    posts = []
    now_utc = datetime.now(timezone.utc)
    cutoff = now_utc.timestamp() - 24 * 3600  # last 24 hours

    # thelayoff.com post structure: <li class="list-group-item"> with nested <a> for title
    # and data-id / data-date attributes, plus a paragraph for the snippet
    for item in soup.select("li.list-group-item, div.post-item, article.post, .chat-post"):
        # Title link
        link_el = item.select_one("a.post-title, a[href*='/dell/'], h3 a, h4 a, .subject a, a.title")
        if not link_el:
            link_el = item.select_one("a")
        if not link_el:
            continue

        title = link_el.get_text(" ", strip=True)
        if not title or len(title) < 10:
            continue
        if title in seen_titles:
            continue

        href = link_el.get("href", "")
        if href and not href.startswith("http"):
            href = "https://www.thelayoff.com" + href

        # Snippet / body text
        snippet_el = item.select_one("p, .post-body, .content, .text-muted, .post-snippet")
        snippet = snippet_el.get_text(" ", strip=True)[:400] if snippet_el else ""

        # Timestamp — try data attributes or text
        ts_iso = now_utc.isoformat()
        for attr in ["data-date", "data-time", "datetime"]:
            val = item.get(attr) or (item.select_one("time") or {}).get(attr, "")
            if val:
                try:
                    from datetime import datetime as _dt
                    parsed_ts = _dt.fromisoformat(val.replace("Z", "+00:00"))
                    if parsed_ts.timestamp() < cutoff:
                        ts_iso = None  # too old, skip
                    else:
                        ts_iso = parsed_ts.isoformat()
                    break
                except Exception:
                    pass

        if ts_iso is None:
            continue  # older than 24h

        # Classify keyword-only (no Groq call for these — they're always Dell-relevant)
        sev = 2  # default MEDIUM for layoff/insider chatter
        full_text = f"{title} {snippet}".lower()
        if re.search(r"\b(confirmed|massive|thousands|entire|shutdown|bankruptcy|scandal|fraud|criminal)\b", full_text):
            sev = 3
        if re.search(r"\b(data.?breach|credentials|hack|ransomware|leaked|confidential|internal.?memo)\b", full_text):
            sev = 3

        seen_titles.add(title)
        posts.append({
            "title": title,
            "url": href,
            "snippet": snippet[:160] or "Dell insider discussion from thelayoff.com",
            "body": snippet[:600],
            "source": "thelayoff.com",
            "time": ts_iso,
            "region": "Global",
            "severity": sev,
            "type": "INSIDER / LEAKS",
            "_sort_time": ts_iso,
            "locations": ["United States"],
        })

    return posts


# ---------- MAIN ----------
def main():
    print(f"SRO Ingest starting — {len(FEEDS)} feeds")
    api_key = init_groq()
    block_keys, boost_keys, pos_ex, neg_ex = load_feedback()
    feedback_text = build_feedback_prompt_section(pos_ex, neg_ex)

    all_items, seen_titles, groq_calls = [], set(), 0

    for url in FEEDS:
        if groq_calls >= GROQ_CALLS_PER_RUN:
            print(f"Groq cap reached ({GROQ_CALLS_PER_RUN}) — stopping")
            break
        try:
            f = feedparser.parse(url)
            print(f"  {url} → {len(getattr(f,'entries',[]))} entries")
        except Exception as e:
            print(f"  SKIP {url}: {e}"); continue

        for e in f.entries[:8]:
            if groq_calls >= GROQ_CALLS_PER_RUN:
                break
            title = getattr(e, "title", "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)

            raw_summary = clean_html(getattr(e, "summary", "") or "")
            if hasattr(e, "content") and e.content:
                try:
                    cv = e.content[0].value
                    if cv: raw_summary = clean_html(cv)
                except Exception: pass

            full_text = f"{title} {raw_summary}"
            link = getattr(e, "link", "") or ""
            source_host = urlparse(link).netloc.replace("www.","") or urlparse(url).netloc.replace("www.","")
            key = build_article_key(title, source_host, link)

            if key in block_keys or is_obviously_irrelevant(full_text):
                continue

            groq_calls += 1
            analysis = ai_analyze_article(api_key, title, raw_summary, source_host, feedback_text)
            cat = analysis.get("category", "NOT_RELEVANT")
            score = int(analysis.get("likelihood_relevant", 0) or 0)

            if cat == "NOT_RELEVANT" or (score < 45 and cat != "BRAND_MONITORING"):
                continue

            sev_str = (analysis.get("severity") or "LOW").upper()
            severity = {"MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}.get(sev_str, 1)
            if key in boost_keys and severity < 3:
                severity = 3

            dash_type = {"PHYSICAL_SECURITY": "PHYSICAL SECURITY", "SUPPLY_CHAIN_SECURITY": "SUPPLY CHAIN",
                         "CYBER_SECURITY_MAJOR": "CYBER SECURITY", "CRISIS_WEATHER": "CRISIS / WEATHER",
                         "HEALTH_SAFETY": "HEALTH / SAFETY", "BRAND_MONITORING": "INSIDER / LEAKS"}.get(cat, "GENERAL")

            ts_iso = datetime.now(timezone.utc).isoformat()
            sort_time = ts_iso
            try:
                if hasattr(e, "published_parsed") and e.published_parsed:
                    pt = datetime(*e.published_parsed[:6]).replace(tzinfo=timezone.utc)
                    ts_iso = pt.isoformat(); sort_time = ts_iso
            except Exception: pass

            geo = analysis.get("geo_relevance") or {}
            geo_locations = geo.get("mentioned_countries_or_cities") or []

            all_items.append({
                "title": title, "url": link,
                "snippet": analysis.get("primary_reason") or raw_summary[:160],
                "body": raw_summary[:600],
                "source": source_host, "time": ts_iso,
                "region": map_region(full_text), "severity": severity,
                "type": dash_type, "_sort_time": sort_time,
                "locations": geo_locations,
            })
            print(f"  [KEEP] {dash_type}|sev={severity}|{map_region(full_text)}| {title[:70]}")

    # ── thelayoff.com/dell direct scrape ─────────────────────────────────────
    layoff_items = scrape_thelayoff_dell(seen_titles)
    print(f"  thelayoff.com/dell → {len(layoff_items)} posts")
    all_items.extend(layoff_items)

    all_items.sort(key=lambda x: (x.get("severity", 1), x.get("_sort_time", "")), reverse=True)
    for it in all_items:
        it.pop("_sort_time", None)

    # Write primary output
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2, ensure_ascii=False)
    print(f"\nDone: {len(all_items)} items → {NEWS_PATH} | Groq calls: {groq_calls}")

    # Mirror to /data/news.json for Worker fetch
    try:
        root_data = os.path.join(BASE_DIR, "data")
        os.makedirs(root_data, exist_ok=True)
        with open(os.path.join(root_data, "news.json"), "w", encoding="utf-8") as f2:
            json.dump(all_items, f2, indent=2, ensure_ascii=False)
        print(f"Mirrored to {root_data}/news.json")
    except Exception as ex:
        print(f"Mirror failed (non-fatal): {ex}")


if __name__ == "__main__":
    main()
