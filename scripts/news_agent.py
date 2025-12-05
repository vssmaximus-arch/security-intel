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

# ---------- CONFIG ----------
GEMINI_MODEL = "gemini-1.5-flash"
EARTHQUAKE_MAG_THRESHOLD = 6.0  # still drop small “green” tremors

# ---------- SRO FILTERS (YOUR OPERATIONAL BUCKETS) ----------
# These map to UI types: CRISIS / WEATHER, PHYSICAL SECURITY, SUPPLY CHAIN, CYBER SECURITY, HEALTH / SAFETY

SRO_FILTERS = {
    # Resilience / Crisis Management
    "CRISIS / WEATHER": [
        "crisis", "disaster",
        "flood", "floods", "flooding",
        "earthquake", "aftershock",
        "tsunami",
        "typhoon", "cyclone", "hurricane", "tropical storm",
        "tornado",
        "landslide", "mudslide",
        "power outage", "blackout", "grid failure", "grid collapse",
        "infrastructure failure", "infrastructure collapse",
        "civil unrest", "violent protest", "street clashes",
        "strike", "walkout",
        "protest", "demonstration", "rally",
        "road blockage", "road blocked", "road closure", "highway closed",
        "state of emergency",
        "evacuation order", "evacuate"
    ],

    # Regional Security / Duty of Care
    "PHYSICAL SECURITY": [
        # Personnel safety / duty of care
        "kidnap", "kidnapping", "abduction",
        "violent crime", "armed robbery", "shooting", "gunman",
        "attack on foreigners",
        "health advisory",
        "high-risk location", "high risk location",
        "travel risk", "travel warning", "travel advisory",
        "duty of care", "executive protection",
        # Civil / terror / unrest (overlaps previous)
        "active shooter", "mass shooting",
        "terror", "terrorist", "terror attack",
        "bomb", "bombing", "explosion",
        "hostage",
        "assassination",
        "riot", "looting", "tear gas",
        "curfew",
        "martial law",
        "coup",
        "armed group",
        # Site security / insider risk (Dell + security language picked up separately too)
        "security incident",
        "unauthorized access", "unauthorised access",
        "intrusion", "break-in", "breach of perimeter",
        "video surveillance failure", "cctv failure", "camera failure",
        "badge violation", "access card misuse",
        "insider threat",
        "loss prevention",
        # Compliance & investigations (security-relevant)
        "local law", "regulation change", "regulation changes",
        "security regulation",
        "audit finding",
        "law enforcement action",
        "criminal offense", "criminal offence",
        "corruption investigation", "corruption probe",
        "bribery investigation",
        "internal investigation"
    ],

    # Supply Chain / Asset Protection
    "SUPPLY CHAIN": [
        "supply chain disruption", "supply-chain disruption",
        "supply chain risk",
        "logistics disruption", "logistics delay",
        "port strike", "ports strike", "dockworkers strike",
        "port closure", "port closed",
        "shipping delay", "shipping disruption",
        "container backlog",
        "customs halt", "customs strike", "border closure", "border closed",
        "manufacturing facility", "production plant", "assembly plant",
        "manufacturing stop", "production halt", "factory fire",
        "warehouse fire", "distribution center fire",
        "labor dispute", "labour dispute",
        "truckers strike", "lorry drivers strike",
        "rail strike", "rail shutdown",
        "airport closed", "airport closure",
        "airspace closed", "airspace restriction",
        "cargo theft", "truck hijacking",
        "theft of cargo", "cargo robbery",
        "hva", "high-value asset", "high value asset",
        "smuggling",
        "counterfeit goods", "counterfeit electronics",
        "fraud ring",
        # Dell-relevant locations explicitly – any risk near these is interesting
        "xiamen", "chengdu", "penang", "hyderabad",
        "sriperumbudur", "bangalore", "bengaluru"
    ],

    # Cyber security – major only
    "CYBER SECURITY": [
        "ransomware",
        "data breach", "data leak", "customer data exposed", "credentials leak",
        "cyberattack", "cyber attack", "cyber-attack",
        "scada", "industrial control system",
        "zero-day", "zeroday", "zero day",
        "critical vulnerability",
        "ddos", "denial of service",
        "malware",
        "system failure", "major outage", "service disruption",
        "cloud outage",
        "breach of cloud provider",
        "identity provider outage"
    ],

    # Health / safety
    "HEALTH / SAFETY": [
        "epidemic", "pandemic", "outbreak",
        "infectious disease",
        "quarantine", "lockdown",
        "health advisory",
        "travel ban",
        "radiation leak",
        "chemical spill", "toxic leak", "hazmat incident",
        "contamination", "water contamination", "food contamination"
    ]
}

# ---------- NOISE BLOCKLIST ----------
# These kill items outright (soft stories, memorials, junk).
BLOCKLIST = [
    # Sports / entertainment
    " sport ", "football", "soccer", "cricket", "rugby", "tennis", "golf",
    "league", "cup", "tournament", "olympics", "world cup", "championship",
    "celebrity", "entertainment", "movie", "film", "star", "concert",
    "music festival", "grammy", "oscars",

    # Soft / aftermath / memorial stories
    "long road to recovery",
    "road to recovery",
    "rebuilding efforts",
    "reconstruction begins",
    "cleanup begins",
    "recovery continues",
    "aftermath of",
    "triggers memories",
    "memories of",
    "survivors recall",
    "looking back",
    "anniversary of",
    "years after",
    "years since",
    "decades after",
    "commemorating",
    "commemoration",
    "remembering",

    # Non-operational junk
    "lottery", "horoscope", "royal family", "gossip", "lifestyle", "fashion",
    "opinion:", "editorial:", "review:",
    "cultivation", "poppy", "drug trade", "opium",
    "estate dispute",
    "mh370",
]

# ---------- FULL FEED LIST ----------
# This is the large, global, high-credibility set you were using (no reduction)
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
    "https://www.ifrc.org/feeds/all.xml",
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
    "https://alerts.weather.gov/cap/us.php?x=0",
    "https://www.jma.go.jp/bosai/feed/rss/eqvol.xml",
    "https://www.jma.go.jp/bosai/feed/rss/warn.xml",
    "https://www.metoffice.gov.uk/public/data/PWSCache/FeedsRSSAll?format=xml",
    "https://feeds.meteoalarm.org/RSS",
    "https://www.emsc-csem.org/service/rss/rss.php?typ=emsc",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.atom",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.atom",
    "https://www.gdacs.org/xml/rss.xml",
    "https://travel.state.gov/_res/rss/TAs.xml",
    "https://www.gov.uk/foreign-travel-advice.rss",
    "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    "https://www.cisa.gov/cybersecurity-advisories/all.atom",
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
    "https://www.wmo.int/rss",
    "https://www.weather.gov/rss_page.php",
    "https://www.emergencyemail.org/rss.aspx",
    "https://www.ifrc.org/feeds/all.xml",
    "https://english.alarabiya.net/.mrss/en.xml",
    "https://www.africanews.com/feed/xml",
    "https://www.latinnews.com/index.php?format=feed&type=rss",
    "https://www.channelnewsasia.com/api/v1/rss-outbound-feed"
]

# ---------- HELPERS ----------

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)


def clean_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)


def earthquake_too_small(text_lower: str) -> bool:
    """Drop green / low-magnitude quakes."""
    if "earthquake" not in text_lower:
        return False

    # Kill GDACS-style "green earthquake" alerts outright
    if "green earthquake" in text_lower:
        return True

    m = re.search(r"magnitude[^0-9]*([0-9]+(?:\.[0-9]+)?)", text_lower)
    if m:
        try:
            mag = float(m.group(1))
            if mag < EARTHQUAKE_MAG_THRESHOLD:
                return True
        except ValueError:
            pass
    return False


def get_sro_category(text: str):
    """
    Fast lexical classification into one of the 5 SRO buckets or None.
    """
    t = f" {text.lower()} "

    # 1) kill obvious junk / aftermath / memorial
    for phrase in BLOCKLIST:
        if phrase in t:
            return None

    # 2) kill low-impact earthquakes
    if earthquake_too_small(t):
        return None

    # 3) positive category match
    for category, keywords in SRO_FILTERS.items():
        for kw in keywords:
            if kw in t:
                return category

    # 4) Dell-site specific insider/site incidents:
    if "dell" in t and any(k in t for k in [
        "security incident", "unauthorized access", "intrusion",
        "badge violation", "insider threat", "loss prevention"
    ]):
        return "PHYSICAL SECURITY"

    return None


def infer_region(text: str) -> str:
    """
    Coarse region mapping for your tabs: Global / AMER / EMEA / APJC / LATAM
    """
    t = text.lower()

    # APJC
    if any(x in t for x in [
        "china", "beijing", "shanghai",
        "india", "delhi", "mumbai", "bangalore", "bengaluru", "hyderabad",
        "japan", "tokyo", "osaka",
        "australia", "sydney", "melbourne",
        "thailand", "vietnam", "indonesia",
        "malaysia", "singapore",
        "korea", "south korea", "north korea",
        "taiwan", "philippines",
        "new zealand",
        "bangladesh", "pakistan",
        "sri lanka", "myanmar",
        "cambodia", "laos",
        "nepal", "fiji"
    ]):
        return "APJC"

    # LATAM
    if any(x in t for x in [
        "brazil", "mexico", "colombia", "argentina",
        "chile", "peru", "panama", "ecuador",
        "uruguay", "paraguay", "venezuela", "bolivia",
        "central america", "latin america"
    ]):
        return "LATAM"

    # AMER
    if any(x in t for x in [
        "united states", "u.s.", "usa",
        "america",
        "canada", "toronto", "vancouver", "montreal",
        "texas", "california", "new york"
    ]):
        return "AMER"

    # EMEA
    if any(x in t for x in [
        "uk", "united kingdom", "britain", "england",
        "europe", "european union", "eu",
        "germany", "france", "poland", "ireland",
        "israel", "gaza",
        "russia", "ukraine",
        "middle east", "africa",
        "netherlands", "sweden", "spain", "italy",
        "saudi arabia", "uae", "dubai",
        "egypt", "south africa", "nigeria", "kenya"
    ]):
        return "EMEA"

    return "Global"


def ai_process(model, title: str, summary: str, category: str):
    """
    Optional Gemini refinement pass.
    - Decides keep/drop based on operational impact.
    - Sets severity (1–3) and a short impact one-liner.
    """
    if not model:
        snippet = (summary or title)[:220]
        return True, 2, snippet, category

    prompt = f"""
Role: Security News Analyst for Dell SRO.

You classify items into 5 operational buckets:
- "CRISIS / WEATHER": natural disasters, civil unrest, infrastructure failures impacting operations.
- "PHYSICAL SECURITY": personnel safety, duty of care, kidnapping, violent crime, site security, insider risk, security-related legal actions.
- "SUPPLY CHAIN": threats to manufacturing, logistics, ports, airports, cargo, high-value assets (HVA), fraud/smuggling affecting goods.
- "CYBER SECURITY": major cyber incidents or outages that could impact operations, partners, or core providers.
- "HEALTH / SAFETY": epidemics, outbreaks, health advisories, chemical/radiation incidents.

Hard rules:
- REJECT (keep=false):
  * Sports, celebrity, lifestyle, opinion pieces.
  * Memorial / human-interest / anniversary stories (e.g. "triggers memories", "long road to recovery").
  * Pure politics or general crime with no clear operational or security impact.
  * Post-event cleanup/recovery when the acute threat has passed and there is no ongoing disruption.
- KEEP (keep=true):
  * Clear or credible threats to operations, staff safety, Dell sites, Dell manufacturing, supply chain routes, key partners, or major IT/cyber platforms.

Severity scale:
- 3 = Life safety / major operational impact (war, major terror, port closure, crippling cyber outage, large active natural disaster).
- 2 = Significant disruption / credible risk (large protests, regional storm, notable cyber hit, major local disruption).
- 1 = Awareness / monitoring (might escalate, or relevant mainly for forward planning).

INPUT:
Title: "{title}"
Summary: "{summary}"
Preliminary category: {category}

Return ONLY valid JSON:
{{
  "keep": true or false,
  "severity": 1 to 3,
  "one_liner": "Impact-focused summary in one short sentence.",
  "category": "{category}"
}}
"""
    try:
        resp = model.generate_content(prompt)
        text = resp.text or ""
        clean = text.strip().replace("```json", "").replace("```", "")
        data = json.loads(clean)

        keep = bool(data.get("keep", False))
        severity = int(data.get("severity", 2))
        one_liner = data.get("one_liner") or summary or title
        final_cat = data.get("category") or category

        if severity < 1 or severity > 3:
            severity = 2

        return keep, severity, one_liner[:300], final_cat
    except Exception as exc:
        print(f"[AI ERROR] {exc}")
        snippet = (summary or title)[:220]
        return True, 2, snippet, category


# ---------- MAIN INGEST ----------

def main():
    print(f"[news_agent] Starting ingest from {len(FEEDS)} feeds")
    all_items = []
    seen_titles = set()
    model = init_gemini()

    for url in FEEDS:
        try:
            parsed = feedparser.parse(url)
            print(f"[news_agent] Scanning: {url} ({len(parsed.entries)} entries)")
        except Exception as exc:
            print(f"[news_agent] Feed error for {url}: {exc}")
            continue

        # No artificial per-feed limit – process everything the feed gives
        for entry in parsed.entries:
            try:
                title = (getattr(entry, "title", "") or "").strip()
                if not title:
                    continue

                # de-dup across feeds by normalized title
                norm_title = re.sub(r"\s+", " ", title.lower())
                if norm_title in seen_titles:
                    continue
                seen_titles.add(norm_title)

                raw_summary = clean_html(getattr(entry, "summary", "")) or ""
                full_text = f"{title} {raw_summary}"

                # 1) Strict lexical pre-filter
                category = get_sro_category(full_text)
                if not category:
                    continue

                # 2) Optional Gemini refinement
                keep, severity, snippet, final_cat = ai_process(
                    model, title, raw_summary, category
                )
                if not keep:
                    continue

                # 3) Timestamp
                ts = datetime.now(timezone.utc).isoformat()
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        ts = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                    except Exception:
                        pass

                # 4) Region
                region = infer_region(full_text)

                # 5) Build dashboard item
                item = {
                    "title": title,
                    "url": getattr(entry, "link", ""),
                    "snippet": snippet,
                    "source": urlparse(getattr(entry, "link", "")).netloc.replace("www.", ""),
                    "time": ts,
                    "region": region,            # Global / AMER / EMEA / APJC / LATAM
                    "severity": int(severity),   # 1–3
                    "type": final_cat            # matches your dropdown
                }
                all_items.append(item)
                print(f"[news_agent] [+] {final_cat} | {region} | {title}")

            except Exception as exc:
                print(f"[news_agent] Entry error for {url}: {exc}")
                continue

    # newest first
    all_items.sort(key=lambda x: x["time"], reverse=True)

    try:
        with open(NEWS_PATH, "w", encoding="utf-8") as fh:
            json.dump(all_items, fh, indent=2)
        print(f"[news_agent] Ingest complete – saved {len(all_items)} items to {NEWS_PATH}")
    except Exception as exc:
        print(f"[news_agent] Failed to write {NEWS_PATH}: {exc}")


if __name__ == "__main__":
    main()
