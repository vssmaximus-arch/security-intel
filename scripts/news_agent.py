import json
import os
import hashlib
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
FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")  # JSONL with feedback from UI

# ---------- STRICT SRO CATEGORIES ----------
SRO_FILTERS = {
    "CYBER SECURITY": [
        "ransomware", "data breach", "cyberattack", "scada", "industrial control",
        "zero-day", "vulnerability", "ddos", "malware", "system failure"
    ],
    "SUPPLY CHAIN": [
        "port strike", "cargo theft", "supply chain disruption", "shipping delay",
        "customs halt", "manufacturing stop", "factory fire", "production halt",
        "labor dispute", "truck blockade", "port closure"
    ],
    "CRISIS / WEATHER": [
        "earthquake", "tsunami", "typhoon", "cyclone", "hurricane", "tornado",
        "flash flood", "flooding", "wildfire", "bushfire", "power outage",
        "blackout", "grid failure", "state of emergency", "evacuation ordered"
    ],
    "PHYSICAL SECURITY": [
        "active shooter", "terror", "bomb", "explosion", "shooting", "gunman",
        "kidnap", "kidnapping", "hostage", "assassination", "civil unrest",
        "violent protest", "riot", "tear gas", "curfew", "martial law", "coup",
        "armed group", "militant", "insurgent", "car bomb"
    ],
    "HEALTH / SAFETY": [
        "epidemic", "outbreak", "infectious disease", "quarantine", "travel ban",
        "pandemic", "virus variant", "radiation", "chemical spill", "toxic leak"
    ]
}

# ---------- BLOCKLIST (HARD REJECTIONS) ----------
BLOCKLIST = [
    # Sports / entertainment / lifestyle noise
    "sport", "football", "soccer", "cricket", "rugby", "tennis", "league",
    "cup", "tournament", "olympics", "world cup",
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "royal family", "gossip", "lifestyle", "fashion", "awards show",

    # Post-incident recovery fluff (not operational)
    "residents return", "collect personal items", "cleanup begins",
    "recovery continues", "aftermath of", "memorial service",

    # Misc low-value noise
    "lottery", "horoscope", "poppy cultivation", "drug trade",
    "opium", "estate dispute", "wedding of", "divorce battle", "MH370"
]

# ---------- FEEDS ----------
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

# ---------- GEMINI INIT ----------
def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

# ---------- UTILS ----------
def clean_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

def make_article_key(title: str, source: str) -> str:
    """
    Stable key so UI feedback can be matched back to new articles.
    Uses SHA1(title|source) in lowercase.
    """
    base = f"{(title or '').strip().lower()}|{(source or '').strip().lower()}"
    return hashlib.sha1(base.encode("utf-8", "ignore")).hexdigest()

# ---------- FEEDBACK LOADING ----------
def load_feedback():
    """
    Reads feedback.jsonl and builds:
      - NEG_KEYS: set of article keys marked NOT_RELEVANT
      - POS_META: dict key -> meta for CRITICAL (type, severity, region)
    """
    neg_keys = set()
    pos_meta = {}

    if not os.path.exists(FEEDBACK_PATH):
        return neg_keys, pos_meta  # no feedback yet

    with open(FEEDBACK_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue

            label = str(rec.get("label", "")).upper()
            title = rec.get("title") or ""
            source = rec.get("source") or ""
            key = make_article_key(title, source)
            if not key:
                continue

            if label == "NOT_RELEVANT":
                neg_keys.add(key)
            elif label == "CRITICAL":
                pos_meta[key] = {
                    "label": "CRITICAL",
                    "type": rec.get("type"),
                    "severity": rec.get("severity"),
                    "region": rec.get("region"),
                }

    return neg_keys, pos_meta

# ---------- RULE-BASED CATEGORY ----------
def get_sro_category(text: str):
    t = text.lower()

    # Hard reject on blocklist
    for word in BLOCKLIST:
        if word in t:
            return None

    for category, keywords in SRO_FILTERS.items():
        for kw in keywords:
            if kw in t:
                return category
    return None

# ---------- AI LAYER ----------
def ai_process(model, title, summary, category, pos_hint=None):
    """
    model   : Gemini model or None
    title   : Article title
    summary : Cleaned summary / body
    category: Initial category from rules (can be None if only kept due to feedback)
    pos_hint: Optional dict from POS_META for CRITICAL examples (type, severity, region)
    """
    # If no Gemini, just keep with default severity and truncated snippet
    if not model:
        final_cat = category or (pos_hint.get("type") if pos_hint else None) or "PHYSICAL SECURITY"
        return True, int(pos_hint.get("severity", 2) if pos_hint else 2), (summary[:200] + "..."), final_cat

    # Build a small hint line if we have positive feedback history
    feedback_hint = ""
    if pos_hint:
        hint_cat = pos_hint.get("type") or category or "PHYSICAL SECURITY"
        hist_sev = pos_hint.get("severity", 3)
        feedback_hint = (
            f"\nHistorical feedback: This type of story was previously marked CRITICAL "
            f"for SRO operations (category: {hint_cat}, severity: {hist_sev}). "
            f"Bias slightly towards KEEP with at least severity 3 if pattern matches."
        )

    prompt = f"""
    Role: Security Analyst for Dell SRO.
    Task: Decide if this article has OPERATIONAL impact for Security & Resilience.

    Article:
    Title: {title}
    Summary: {summary}
    Proposed_category_from_rules: {category}

   {feedback_hint}

    Rules:
    1. REJECT (keep=false): elections, general politics, sports, celebrity, lifestyle,
       post-disaster cleanup (no ongoing disruption), generic crime not affecting
       corporate operations.
    2. KEEP (keep=true): anything with clear impact to:
       - Staff safety, Dell facilities, major cities where Dell has presence
       - Ports, airports, major logistics hubs, manufacturing zones
       - National-level crises, travel bans, states of emergency
       - Major cyber incidents impacting operations, partners, or core IT providers
    3. Severity:
       - 3 = Life safety / major operational impact
       - 2 = Meaningful disruption, monitor closely
       - 1 = Awareness only

    Output JSON ONLY, no text around it:
    {{
      "keep": true/false,
      "severity": 1-3,
      "one_liner": "Short operational impact summary",
      "category": "PHYSICAL SECURITY | SUPPLY CHAIN | CYBER SECURITY | CRISIS / WEATHER | HEALTH / SAFETY"
    }}
    """

    try:
        resp = model.generate_content(prompt)
        text = resp.text.strip().replace("```json", "").replace("```", "")
        data = json.loads(text)
        keep = bool(data.get("keep", False))
        severity = int(data.get("severity", 1))
        one_liner = data.get("one_liner", summary) or summary
        final_cat = data.get("category") or category or "PHYSICAL SECURITY"

        return keep, severity, one_liner, final_cat
    except Exception:
        # Conservative fallback: keep if category exists, medium severity
        final_cat = category or (pos_hint.get("type") if pos_hint else "PHYSICAL SECURITY")
        sev = max(int(pos_hint.get("severity", 2)) if pos_hint else 2, 2)
        return True, sev, (summary[:200] + "..."), final_cat

# ---------- MAIN ----------
def main():
    print("=== SRO Intel Ingest (Strict SRO + Feedback) ===")

    all_items = []
    seen_titles = set()
    model = init_gemini()

    # Load user feedback from UI
    NEG_KEYS, POS_META = load_feedback()
    print(f"Loaded feedback: {len(NEG_KEYS)} NOT_RELEVANT, {len(POS_META)} CRITICAL markers")

    for url in FEEDS:
        try:
            print(f"[FEED] {url}")
            f = feedparser.parse(url)

            # No per-feed cap: all entries, filters will do the work
            for e in f.entries:
                title = getattr(e, "title", "").strip()
                if not title:
                    continue

                # Deduplicate by title to avoid clutter
                if title in seen_titles:
                    continue
                seen_titles.add(title)

                raw_summary = clean_html(getattr(e, "summary", ""))
                full_text = f"{title} {raw_summary}"
                source_host = urlparse(getattr(e, "link", "")).netloc.replace("www.", "")
                article_key = make_article_key(title, source_host)

                # 1) Auto drop if previously marked NOT_RELEVANT
                if article_key in NEG_KEYS:
                    # Skip immediately – leadership already told us this pattern is noise
                    continue

                # 2) Rule-based category
                category = get_sro_category(full_text)

                # 3) If rules found nothing AND there's no positive feedback hint, skip
                pos_hint = POS_META.get(article_key)
                if not category and not pos_hint:
                    continue

                # 4) AI pass (with positive feedback hint if exists)
                keep, severity, snippet, final_cat = ai_process(
                    model=model,
                    title=title,
                    summary=raw_summary,
                    category=category,
                    pos_hint=pos_hint
                )

                if not keep:
                    continue

                # 5) If leadership previously marked as CRITICAL, force severity >= 3
                if pos_hint and pos_hint.get("label") == "CRITICAL":
                    if severity < 3:
                        severity = 3

                # Timestamp
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(e, "published_parsed") and e.published_parsed:
                    ts = datetime(*e.published_parsed[:6]).isoformat()

                # Region inference (still simple, but aligned with SRO view)
                region = "Global"
                t_lower = full_text.lower()
                if any(x in t_lower for x in ["china", "asia", "india", "japan", "australia",
                                              "singapore", "malaysia", "philippines", "korea", "indonesia"]):
                    region = "APJC"
                elif any(x in t_lower for x in ["uk", "europe", "germany", "france", "poland",
                                                "ireland", "italy", "spain", "israel", "gaza",
                                                "middle east", "africa", "russia", "ukraine"]):
                    region = "EMEA"
                elif any(x in t_lower for x in ["usa", "united states", "america", "canada",
                                                "brazil", "mexico", "argentina", "chile", "panama"]):
                    region = "AMER"

                # Build dashboard item
                all_items.append({
                    "title": title,
                    "url": getattr(e, "link", ""),
                    "snippet": snippet,
                    "source": source_host,
                    "time": ts,
                    "region": region,
                    "severity": severity,
                    "type": final_cat,
                    "_key": article_key  # not used on frontend now, but useful for debugging
                })

        except Exception as ex:
            print(f"[ERROR] Feed {url}: {ex}")

    # Sort newest first
    all_items.sort(key=lambda x: x["time"], reverse=True)

    # Write to news.json
    with open(NEWS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_items, f, indent=2, ensure_ascii=False)

    print(f"=== Ingest Complete: {len(all_items)} SRO-relevant items saved ===")

if __name__ == "__main__":
    main()
