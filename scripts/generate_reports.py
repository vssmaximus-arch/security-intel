import json
import os
import re
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
from typing import List, Dict, Any, Optional

from json import JSONDecodeError

try:
    import google.generativeai as genai
except Exception:
    genai = None

# ── AI config — Gemini primary, Groq fallback ────────────────────────────────
GEMINI_API_KEY    = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL      = "gemini-2.0-flash"
GEMINI_API_BASE   = "https://generativelanguage.googleapis.com/v1beta/models"

GROQ_API_KEY      = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL        = "llama-3.1-8b-instant"
GROQ_ENDPOINT     = "https://api.groq.com/openai/v1/chat/completions"

MAX_AI_BRIEFS     = 25    # cap AI calls per run
GROQ_DELAY_S      = 2.0   # stay under 30 RPM free limit
GEMINI_DELAY_S    = 5.0   # stay under 15 RPM free limit

# ── Site context — tells AI exactly what each site does ──────────────────────
# This is what makes the assessment specific rather than generic
SITE_CONTEXT: Dict[str, str] = {
    "Dell Round Rock HQ":      "Global corporate HQ, executive leadership, legal, finance, ~13,000 on-site staff",
    "Dell Austin Parmer":      "Major R&D and engineering campus, product development teams",
    "Dell Hopkinton":          "EMC/data storage division HQ, critical enterprise infrastructure teams",
    "Dell Durham":             "Technology and cloud division campus",
    "Dell Santa Clara":        "Silicon Valley engineering and partnerships hub",
    "Dell Nashville Hub":      "US regional business hub",
    "Dell Oklahoma City":      "US operations and support center",
    "Dell Toronto":            "Canada HQ, sales and support for Canadian market",
    "Dell Mexico City":        "LATAM regional headquarters, sales and professional services",
    "Dell Hortolândia":        "Primary LATAM manufacturing plant, hardware assembly and production",
    "Dell São Paulo":          "Brazil commercial HQ, largest LATAM office by headcount",
    "Dell Porto Alegre":       "Brazil technology center",
    "Dell Bogotá":             "Colombia and Andean region office",
    "Dell Santiago":           "Chile regional office",
    "Dell Buenos Aires":       "Argentina regional office",
    "Dell Cork Campus":        "Largest Dell campus outside USA, EMEA manufacturing + global customer support, ~3,000 staff",
    "Dell Limerick":           "Ireland manufacturing and logistics facility",
    "Dell Dublin":             "Ireland commercial office",
    "Dell Bracknell":          "UK and Northern Europe regional HQ, sales and support",
    "Dell Brentford":          "UK London-area office, financial services vertical",
    "Dell Glasgow":            "UK technology center, customer support operations",
    "Dell Paris / Bezons":     "France and Southern Europe HQ, enterprise sales",
    "Dell Montpellier":        "France technology and support center",
    "Dell Frankfurt":          "Germany and DACH region HQ, financial sector accounts",
    "Dell Munich":             "Germany technology and engineering hub",
    "Dell Amsterdam":          "Netherlands and Benelux HQ",
    "Dell Copenhagen":         "Nordic region office",
    "Dell Stockholm":          "Sweden and Nordic technology center",
    "Dell Madrid":             "Spain and Iberia regional HQ",
    "Dell Rome":               "Italy regional office",
    "Dell Prague":             "Central and Eastern Europe hub, support operations",
    "Dell Warsaw":             "Poland office, growing technology center",
    "Dell Dubai":              "Middle East and Africa (MEA) regional HQ, executive presence, key supply chain node for Gulf region",
    "Dell Riyadh":             "Saudi Arabia office, major government and enterprise accounts",
    "Dell Johannesburg":       "Sub-Saharan Africa HQ, South Africa commercial center",
    "Dell Bangalore":          "Largest India campus, ~30,000+ staff, global IT/software development, shared services, critical to global operations",
    "Dell Hyderabad":          "India technology center, software engineering and support",
    "Dell Gurgaon":            "India NCR office, enterprise sales and professional services",
    "Dell Cyberjaya":          "Malaysia APJC shared services center, finance and HR operations",
    "Dell Penang":             "APJC key manufacturing facility, hardware production and logistics",
    "Dell Singapore":          "APJC regional HQ, executive leadership for Asia-Pacific, supply chain coordination",
    "Dell Xiamen Mfg":         "Primary China manufacturing plant, high-volume hardware assembly, critical to global supply chain",
    "Dell Chengdu":            "China technology center",
    "Dell Shanghai":           "China commercial HQ, enterprise accounts",
    "Dell Beijing":            "China government and public sector accounts",
    "Dell Hong Kong":          "Hong Kong commercial office, financial sector",
    "Dell Taipei":             "Taiwan office, semiconductor and ODM partner relationships",
    "Dell Tokyo":              "Japan HQ, enterprise and public sector accounts",
    "Dell Osaka":              "Japan regional office",
    "Dell Seoul":              "Korea HQ, enterprise and government accounts",
    "Dell Sydney":             "Australia and New Zealand HQ, commercial and government accounts",
    "Dell Melbourne":          "Australia technology center and commercial office",
    "Dell Manila":             "Philippines office, growing technology services hub",
    "Dell Bangkok":            "Thailand regional office",
}

def _get_site_context(site_name: str) -> str:
    """Match site name to context string (partial match tolerant)."""
    for key, ctx in SITE_CONTEXT.items():
        if key.lower() in site_name.lower() or site_name.lower() in key.lower():
            return ctx
    return "Regional Dell office"

# ── Site type inference ───────────────────────────────────────────────────────
def _infer_site_type(site_name: str) -> str:
    n = site_name.lower()
    if any(x in n for x in ["mfg", "manufacturing", "factory", "plant", "hortolândia", "penang", "xiamen", "cork", "limerick"]):
        return "Manufacturing / Production Facility"
    if any(x in n for x in ["hq", "headquarters", "campus", "parmer", "round rock", "singapore", "dubai", "bangalore", "sydney"]):
        return "Regional / Corporate HQ"
    return "Commercial Office"

def _build_brief_prompt(article: Dict[str, Any], site_name: str,
                         site_region: str, distance_km: float,
                         match_tier: str) -> str:
    """
    Build the intelligence brief prompt. This is the 'brain' — the quality
    of this prompt determines the quality of every RSM alert.
    """
    site_type    = _infer_site_type(site_name)
    site_context = _get_site_context(site_name)
    category     = article.get("category", "UNKNOWN")
    title        = article.get("title", "")
    snippet      = (article.get("body") or article.get("snippet")
                    or article.get("summary") or "")[:500]
    op_impact    = article.get("operational_impact", "")
    second_ord   = article.get("second_order", "")
    sev_raw      = article.get("severity", 2)
    sev_label    = {1:"LOW",2:"MEDIUM",3:"HIGH",4:"CRITICAL"}.get(int(sev_raw), "MEDIUM")
    pub_time     = article.get("time") or article.get("timestamp", "recent")

    dist_str = f"{round(distance_km, 1)}km" if distance_km else "within city"
    if match_tier == "coordinate":
        dist_note = f"{dist_str} (precise GPS location)"
    else:
        dist_note = f"~{dist_str} estimated (city-level match)"

    # Distance-calibrated threat context
    if distance_km and distance_km <= 15:
        proximity_context = "DIRECT ZONE — the Dell site may be within the immediate incident area."
    elif distance_km and distance_km <= 50:
        proximity_context = "NEARBY — staff commutes, building access, and site perimeter may be affected."
    elif distance_km and distance_km <= 150:
        proximity_context = "REGIONAL — monitor situation; travel, supply chain, or workforce may be disrupted."
    elif distance_km and distance_km <= 300:
        proximity_context = "EXTENDED RANGE — relevant for natural disasters and large-scale events only."
    else:
        proximity_context = "STRATEGIC AWARENESS — relevant due to ballistic/military threat radius."

    return f"""You are generating a PROXIMITY INTELLIGENCE ALERT for a Dell Technologies Regional Security Manager (RSM).
The RSM needs accurate, specific, actionable intelligence — not generic statements.

━━━ EVENT ━━━
Title:     {title}
Category:  {category}
Severity:  {sev_label}
Published: {pub_time}
Context:   {snippet}

━━━ INTEL PIPELINE NOTES ━━━
Operational impact (AI-classified): {op_impact or 'not available'}
Second-order effects (AI-classified): {second_ord or 'not available'}

━━━ DELL SITE ━━━
Site:     {site_name}
Type:     {site_type}
Context:  {site_context}
Region:   {site_region}

━━━ PROXIMITY ━━━
Distance: {dist_note}
Assessment: {proximity_context}

━━━ YOUR TASK ━━━
Generate a precise, site-specific intelligence brief. Return ONLY valid JSON:

{{
  "site_impact": "2-3 sentences. Name the site AND the event explicitly. Be precise about what operational aspect is affected (workforce attendance / building access / supply chain / production / executive safety). Calibrate to the actual distance — a 250km storm ≠ immediate evacuation. Never say 'Dell employees and facilities may be affected' — that is too generic.",
  "rsm_action": "Exactly 3 bullet points starting with action verbs. Each must be immediately executable by THIS RSM at THIS site. Example: '1. Contact site security lead to confirm building access status. 2. Activate employee check-in protocol for staff within 10km of incident. 3. Notify APJC Security Director and await further guidance.' Tailor to site type — manufacturing sites → production continuity; HQ → executive safety + comms; office → workforce attendance.",
  "second_order": "One sentence on the most likely cascading effect. For labor actions consider childcare/school closures. For natural disasters consider supply chain and logistics. For civil unrest consider executive travel risk. Empty string if genuinely none."
}}

HARD RULES:
- Reference {site_name} and the actual event by name in site_impact
- RSM actions must match the site type: {site_type}
- If distance > 100km and category is not NATURAL_DISASTER or military, explain WHY this is still relevant
- Do not invent facts — work only from the information provided above"""


def _call_gemini_brief(prompt: str) -> Optional[Dict[str, str]]:
    """Call Gemini 2.0 Flash for brief generation (primary — better reasoning)."""
    if not GEMINI_API_KEY:
        return None
    url = f"{GEMINI_API_BASE}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 450,
            "responseMimeType": "application/json"
        }
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload,
                                  headers={"Content-Type": "application/json"},
                                  method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        if "site_impact" in parsed and "rsm_action" in parsed:
            return parsed
    except Exception as e:
        print(f"    Gemini brief failed: {e}")
    return None


def _call_groq_brief(prompt: str) -> Optional[Dict[str, str]]:
    """Call Groq llama as fallback for brief generation."""
    if not GROQ_API_KEY:
        return None
    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 450,
        "response_format": {"type": "json_object"}
    }).encode("utf-8")
    req = urllib.request.Request(
        GROQ_ENDPOINT, data=payload,
        headers={"Authorization": f"Bearer {GROQ_API_KEY}",
                 "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        content = body["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        if "site_impact" in parsed and "rsm_action" in parsed:
            return parsed
    except Exception as e:
        print(f"    Groq brief failed: {e}")
    return None


def generate_site_brief(article: Dict[str, Any], site_name: str,
                         site_region: str, distance_km: float,
                         match_tier: str = "text") -> Optional[Dict[str, str]]:
    """
    Generate AI intelligence brief. Tries Gemini first (better reasoning),
    falls back to Groq if Gemini unavailable or fails.
    """
    prompt = _build_brief_prompt(article, site_name, site_region,
                                  distance_km, match_tier)
    # Try Gemini first
    if GEMINI_API_KEY:
        result = _call_gemini_brief(prompt)
        if result:
            result["ai_model"] = "gemini-2.0-flash"
            return result
    # Fall back to Groq
    result = _call_groq_brief(prompt)
    if result:
        result["ai_model"] = "groq-llama-3.1"
    return result


# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
REPORT_DIR = os.path.join(BASE_DIR, "public", "reports")
CONFIG_DIR = os.path.join(BASE_DIR, "config")

NEWS_PATH = os.path.join(DATA_DIR, "news.json")
PROXIMITY_PATH = os.path.join(DATA_DIR, "proximity.json")
LOCATIONS_PATH = os.path.join(CONFIG_DIR, "locations.json")
PUBLIC_LOCATIONS_PATH = os.path.join(DATA_DIR, "locations.json")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

# ── Proximity radius rules ────────────────────────────────────────────────────
# Default tight radius for physical incidents (crime, unrest, strikes etc.)
RADIUS_DEFAULT_KM  = 50

# Natural disasters spread across wide areas — storm systems, earthquake shaking,
# floods, wildfires can threaten sites hundreds of km from the epicentre
RADIUS_NATURAL_KM  = 300

# Ballistic/military threats: missiles, airstrikes, rocket attacks have wide
# threat envelopes. Iran attacking Doha → Dell Dubai 400km away is at risk.
# North Korea firing over Japan → all Japan/Korea sites are threatened.
RADIUS_BALLISTIC_KM = 500

# Keywords that trigger the ballistic radius regardless of category
_BALLISTIC = re.compile(
    r"\b(missile|rocket.attack|airstrike|air.strike|ballistic|bombing|"
    r"military.strike|shelling|mortar.fire|fired.rockets?|launched.missiles?|"
    r"nuclear.threat|hypersonic|drone.strike|artillery.fire|warhead)\b",
    re.IGNORECASE,
)

# Categories that use the natural-disaster radius
_NATURAL_CATS = {"NATURAL_DISASTER"}

def _event_radius(article: Dict[str, Any]) -> int:
    """Return the correct proximity radius for this article's threat type."""
    category   = article.get("category", "")
    title_body = (article.get("title", "") + " " +
                  (article.get("body") or article.get("snippet") or ""))
    if _BALLISTIC.search(title_body):
        return RADIUS_BALLISTIC_KM
    if category in _NATURAL_CATS:
        return RADIUS_NATURAL_KM
    return RADIUS_DEFAULT_KM

# Report audiences
REPORT_PROFILES = {
    "global": {"label": "Global", "regions": ["Global", "AMER", "EMEA", "APJC", "LATAM"]},
    "amer": {"label": "AMER", "regions": ["AMER"]},
    "emea": {"label": "EMEA", "regions": ["EMEA"]},
    "apjc": {"label": "APJC", "regions": ["APJC"]},
    "latam": {"label": "LATAM", "regions": ["LATAM"]},
}

GEMINI_MODEL = "gemini-1.5-flash"

# Keyword buckets reuse... (kept same as your previous version for robust matching)
SECURITY_KEYWORDS = {
    "resilience_crisis": [
        "earthquake", "flood", "flash flood", "landslide", "hurricane",
        "typhoon", "cyclone", "storm", "wildfire", "bushfire", "tsunami",
        "eruption", "volcano", "heatwave", "power outage", "blackout",
        "grid failure", "infrastructure failure", "dam failure",
        "port closure", "airport closure", "state of emergency",
    ],
    "civil_unrest": [
        "protest", "demonstration", "riot", "unrest", "clashes",
        "looting", "curfew", "martial law", "strike", "walkout",
        "industrial action", "labour dispute", "labor dispute",
    ],
    "duty_of_care": [
        "kidnap", "kidnapping", "abduction", "hostage", "shooting",
        "stabbing", "armed attack", "terror attack", "terrorist",
        "gunfire", "explosion", "bomb", "car bomb", "ied",
        "assassination", "crime wave", "gang violence",
        "sexual assault", "health alert", "health advisory",
        "outbreak", "epidemic", "pandemic", "virus", "infection",
        "covid", "cholera", "dengue",
    ],
    "supply_chain_assets": [
        "supply chain disruption", "supply disruption", "logistics disruption",
        "shipping delay", "shipment delay", "cargo theft", "truck hijack",
        "warehouse fire", "factory fire", "plant fire",
        "port congestion", "port strike", "dock strike", "rail strike",
        "airport strike", "customs strike", "manufacturing halt",
        "production halt", "production stopped", "plant shutdown",
        "factory shutdown", "distribution centre", "distribution center",
    ],
    "site_security_insider": [
        "security breach", "intrusion", "break-in", "break in", "trespass",
        "unauthorised access", "unauthorized access", "badge misuse",
        "access control failure", "cctv failure",
        "insider threat", "employee theft", "loss prevention",
        "armed robbery", "robbery", "burglary",
    ],
    "compliance_investigations": [
        "regulation change", "regulatory change", "new law",
        "security law", "data protection law", "privacy law", "fine",
        "regulator", "regulatory action", "law enforcement", "police raid",
        "investigation", "corruption", "bribery", "fraud",
        "criminal charges", "indicted",
    ],
    "cyber": [
        "ransomware", "data breach", "data leak", "credential leak",
        "cyber attack", "cyberattack", "ddos", "denial of service",
        "malware", "botnet", "vulnerability", "zero-day", "zero day",
        "exploit", "spyware", "backdoor",
    ],
}

ALL_SECURITY_TERMS = [kw.lower() for bucket in SECURITY_KEYWORDS.values() for kw in bucket]


@dataclass
class Location:
    name: str
    country: str
    region: str
    lat: float
    lon: float

def load_news() -> List[Dict[str, Any]]:
    if not os.path.exists(NEWS_PATH):
        print("news.json not found; continuing with zero articles.")
        return []
    try:
        with open(NEWS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except JSONDecodeError:
        return []
    
    if isinstance(data, list):
        return data
    elif isinstance(data, dict) and "articles" in data:
        return data["articles"]
    return []

def load_locations() -> List[Location]:
    if not os.path.exists(LOCATIONS_PATH):
        print("locations.json not found.")
        return []

    with open(LOCATIONS_PATH, "r", encoding="utf-8") as f:
        raw_text = f.read()

    try:
        raw = json.loads(raw_text)
    except JSONDecodeError:
        return []

    locations = []
    for item in raw:
        try:
            locations.append(Location(
                name=item["name"],
                country=item.get("country", ""),
                region=item.get("region", "Global"),
                lat=float(item["lat"]),
                lon=float(item["lon"])
            ))
        except (KeyError, ValueError):
            continue
    return locations

def haversine_km(lat1, lon1, lat2, lon2) -> float:
    rlat1, rlon1, rlat2, rlon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlon = rlon2 - rlon1
    dlat = rlat2 - rlat1
    a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return 6371 * c

def _article_text(article: Dict[str, Any]) -> str:
    """Return combined searchable text from an article (handles both 'snippet' and 'summary' field names)."""
    title = article.get("title", "") or ""
    body = article.get("body") or article.get("snippet") or article.get("summary") or ""
    # Also include AI-extracted geo locations list for text matching
    geo_locs = article.get("locations") or []
    geo_str = " ".join(geo_locs) if isinstance(geo_locs, list) else str(geo_locs)
    return f"{title} {body} {geo_str}".lower()

def _is_security_relevant(article: Dict[str, Any]) -> bool:
    text = _article_text(article)
    if int(article.get("severity", 1)) >= 3:
        return True
    for kw in ALL_SECURITY_TERMS:
        if kw in text:
            return True
    return False

# Country code → common name mapping for text matching
COUNTRY_NAMES = {
    "US": ["united states", "usa", "u.s.", "america"],
    "CA": ["canada", "canadian"],
    "MX": ["mexico", "mexican"],
    "BR": ["brazil", "brazil", "são paulo", "sao paulo", "porto alegre"],
    "CO": ["colombia", "colombian", "bogota", "bogotá"],
    "CL": ["chile", "chilean", "santiago"],
    "AR": ["argentina", "buenos aires"],
    "PA": ["panama"],
    "IE": ["ireland", "irish", "dublin", "cork", "limerick"],
    "GB": ["uk", "britain", "england", "scotland", "wales", "london", "glasgow", "bracknell", "brentford"],
    "FR": ["france", "french", "paris", "montpellier", "bezons"],
    "DE": ["germany", "german", "frankfurt", "munich", "münchen", "halle"],
    "NL": ["netherlands", "dutch", "amsterdam"],
    "PL": ["poland", "polish", "lodz", "łódź"],
    "DK": ["denmark", "danish", "copenhagen"],
    "SE": ["sweden", "swedish", "stockholm"],
    "ES": ["spain", "spanish", "madrid"],
    "IT": ["italy", "italian", "milan"],
    "CH": ["switzerland", "swiss", "zurich"],
    "IL": ["israel", "israeli", "tel aviv", "herzliya", "haifa", "beer sheva", "beer-sheva"],
    "MA": ["morocco", "moroccan", "casablanca"],
    "EG": ["egypt", "egyptian", "cairo"],
    "AE": ["uae", "emirates", "dubai", "abu dhabi"],
    "IN": ["india", "indian", "bangalore", "bengaluru", "hyderabad", "gurugram", "gurgaon", "sriperumbudur", "chennai"],
    "SG": ["singapore"],
    "MY": ["malaysia", "malaysian", "penang", "cyberjaya", "kuala lumpur"],
    "CN": ["china", "chinese", "xiamen", "chengdu", "shanghai", "beijing"],
    "TW": ["taiwan", "taipei"],
    "JP": ["japan", "japanese", "tokyo", "kawasaki", "osaka"],
    "AU": ["australia", "australian", "sydney", "melbourne"],
    "KR": ["korea", "korean", "seoul"],
}

# Approximate country centroids for distance estimation when article has no coordinates
COUNTRY_CENTROIDS: Dict[str, tuple] = {
    "US": (39.5, -98.4), "CA": (56.1, -106.3), "MX": (23.6, -102.5),
    "BR": (-14.2, -51.9), "CO": (4.6, -74.3), "CL": (-35.7, -71.5),
    "AR": (-38.4, -63.6), "GB": (55.4, -3.4), "IE": (53.4, -8.2),
    "FR": (46.2, 2.2), "DE": (51.2, 10.4), "NL": (52.1, 5.3),
    "PL": (51.9, 19.1), "DK": (56.3, 9.5), "SE": (60.1, 18.6),
    "ES": (40.5, -3.7), "IT": (41.9, 12.6), "IL": (31.0, 35.0),
    "AE": (23.4, 53.8), "SA": (23.9, 45.1), "ZA": (-30.6, 22.9),
    "IN": (20.6, 78.9), "SG": (1.4, 103.8), "MY": (4.2, 108.0),
    "CN": (35.9, 104.2), "TW": (23.7, 121.0), "JP": (37.0, 138.0),
    "AU": (-25.3, 133.8), "KR": (36.5, 127.8), "PH": (12.9, 121.8),
    "TH": (15.9, 100.9), "HK": (22.3, 114.2),
}

def _city_terms(loc: Location) -> List[str]:
    """City-level terms only — specific enough to pinpoint the right site."""
    terms = []
    stripped = re.sub(r'^Dell\s+', '', loc.name, flags=re.IGNORECASE)
    stripped = re.sub(r'\s*\([A-Z]{2}\)\s*$', '', stripped).strip()
    city_parts = [p.strip().lower() for p in re.split(r'[/,]', stripped) if p.strip()]
    for part in city_parts:
        clean = re.sub(r'\b(hq|campus|hub|mfg|manufacturing|parmer|regional|office)\b',
                       '', part, flags=re.IGNORECASE).strip()
        if clean and len(clean) > 2:
            terms.append(clean)
    return list(set(terms))

def _country_code_for_loc(loc: Location) -> str:
    """Infer 2-letter country code from location name like 'Dell Sydney (AU)'."""
    m = re.search(r'\(([A-Z]{2})\)\s*$', loc.name)
    return m.group(1) if m else ""

def _location_search_terms(loc: Location) -> List[str]:
    """City terms only — no country-level terms (they cause false matches across vast distances)."""
    return _city_terms(loc)

def _collect_raw_matches(articles: List[Dict[str, Any]], locations: List[Location]) -> List[Dict[str, Any]]:
    """
    Phase 1: Geographic matching — find (article, site, distance) pairs.

    Three tiers, strictest first:
      A) Exact coordinates → haversine, must be within _event_radius()
      B) AI-extracted city names (article.locations) → city text match,
         use country centroid for distance estimate, capped at _event_radius()
      C) Title/body city text match → same cap as B

    Radius rules (per _event_radius):
      - Ballistic/military (missile, airstrike, rocket): 500km
      - Natural disaster (storm, earthquake, flood, cyclone): 300km
      - Everything else (unrest, crime, strike, supply chain): 50km

    Per article: maximum MAX_SITES_PER_ARTICLE nearest sites shown.
    Country-level and region-level matching REMOVED — too broad, wrong sites.
    """
    MAX_SITES_PER_ARTICLE  = 2     # never flood with every site in a country

    matches = []
    seen    = set()

    for article in articles:
        if int(article.get("severity", 1)) < 2:
            continue
        if not _is_security_relevant(article):
            continue

        alat     = article.get("lat")
        alon     = article.get("lon")
        art_url  = article.get("url") or article.get("link", "")
        art_sev  = int(article.get("severity", 1))

        article_hits: List[Dict] = []   # candidates for this article only

        radius = _event_radius(article)   # 50 / 300 / 500 depending on threat type

        # ── Tier A: Exact coordinates ─────────────────────────────────────────
        if alat is not None and alon is not None:
            try:
                alat_f, alon_f = float(alat), float(alon)
                for loc in locations:
                    dist = haversine_km(alat_f, alon_f, loc.lat, loc.lon)
                    if dist <= radius:
                        article_hits.append({"loc": loc, "distance_km": round(dist, 1),
                                             "match_tier": "coordinate"})
            except ValueError:
                pass

        # ── Tier B+C: City-name text matching ─────────────────────────────────
        if not article_hits:
            text     = _article_text(article)
            geo_list = article.get("locations") or []
            # AI-extracted locations like ["Perth, Australia", "Western Australia"]
            geo_norm = set(g.lower().strip() for g in geo_list if g) \
                       if isinstance(geo_list, list) else set()

            for loc in locations:
                city_terms   = _city_terms(loc)     # city only, NOT country
                country_code = _country_code_for_loc(loc)

                # City term found in article body OR AI-extracted locations
                city_matched = any(term in text for term in city_terms if len(term) > 2)
                if not city_matched and geo_norm:
                    city_matched = any(
                        any(t in geo_entry or geo_entry in t for geo_entry in geo_norm)
                        for t in city_terms if len(t) > 2
                    )
                if not city_matched:
                    continue

                # Estimate distance via country centroid — use same event radius
                centroid = COUNTRY_CENTROIDS.get(country_code)
                if centroid:
                    est_dist = haversine_km(centroid[0], centroid[1], loc.lat, loc.lon)
                else:
                    est_dist = 0.0   # unknown → allow through

                if est_dist <= radius:
                    article_hits.append({"loc": loc,
                                         "distance_km": round(est_dist, 1),
                                         "match_tier": "city_text"})

        # ── Deduplicate + cap per article ─────────────────────────────────────
        article_hits.sort(key=lambda h: h["distance_km"])
        for hit in article_hits[:MAX_SITES_PER_ARTICLE]:
            key = (art_url, hit["loc"].name)
            if key not in seen:
                seen.add(key)
                matches.append({"article": article,
                                 "loc": hit["loc"],
                                 "distance_km": hit["distance_km"],
                                 "match_tier": hit["match_tier"]})

    matches.sort(key=lambda m: (-int(m["article"].get("severity", 1)), m["distance_km"]))
    return matches


def build_proximity_alerts(articles: List[Dict[str, Any]], locations: List[Location]) -> List[Dict[str, Any]]:
    """
    Phase 2: AI enrichment — take raw matches and generate site-specific
    operational impact briefs using Groq. This is what makes proximity alerts
    genuinely intelligent instead of just a filtered news feed.
    """
    raw_matches = _collect_raw_matches(articles, locations)
    print(f"  [PROX] {len(raw_matches)} raw matches found → enriching top {MAX_AI_BRIEFS} with AI")

    alerts = []
    ai_calls = 0

    for m in raw_matches:
        article      = m["article"]
        loc          = m["loc"]
        distance_km  = m["distance_km"]

        art_time    = article.get("time") or article.get("timestamp", "")
        art_url     = article.get("url") or article.get("link", "")
        art_snippet = (article.get("body") or article.get("snippet")
                       or article.get("summary") or "")[:300]
        severity    = int(article.get("severity", 1))

        # ── AI site-specific brief (top N only, then fall back to generic) ───
        ai_brief = None
        if ai_calls < MAX_AI_BRIEFS and (GEMINI_API_KEY or GROQ_API_KEY):
            if ai_calls > 0:
                delay = GEMINI_DELAY_S if GEMINI_API_KEY else GROQ_DELAY_S
                time.sleep(delay)
            ai_brief  = generate_site_brief(
                article, loc.name, loc.region, distance_km,
                m.get("match_tier", "text")
            )
            ai_calls += 1
            model_used = ai_brief.get("ai_model", "unknown") if ai_brief else "failed"
            print(f"    Brief [{model_used}]: {loc.name[:35]}")

        if ai_brief:
            site_impact  = ai_brief.get("site_impact", "")
            rsm_action   = ai_brief.get("rsm_action", "")
            second_order = ai_brief.get("second_order", "")
            ai_enriched  = True
        else:
            # Graceful fallback — still useful, just not site-specific
            op_impact    = article.get("operational_impact", "")
            site_impact  = op_impact if op_impact else art_snippet
            rsm_action   = ""
            second_order = article.get("second_order", "")
            ai_enriched  = False

        alerts.append({
            # Event fields
            "article_title":     article.get("title", ""),
            "article_source":    article.get("source", ""),
            "article_timestamp": art_time,
            "article_link":      art_url,
            "category":          article.get("category", "GENERAL"),
            "severity":          severity,
            # Site fields
            "site_name":         loc.name,
            "site_region":       loc.region,
            "site_country":      loc.country,
            "site_type":         _infer_site_type(loc.name),
            "distance_km":       distance_km,
            "lat":               loc.lat,
            "lon":               loc.lon,
            # Intelligence fields (the new layer)
            "site_impact":       site_impact,
            "rsm_action":        rsm_action,
            "second_order":      second_order,
            "ai_enriched":       ai_enriched,
            "ai_model":          ai_brief.get("ai_model", "") if ai_brief else "",
        })

    print(f"  [PROX] {ai_calls} AI briefs generated, {len(alerts)} total alerts")
    return alerts

# --- Reporting Logic ---

def init_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(GEMINI_MODEL)

def summarise_with_gemini(model, profile_label, articles):
    if not model or not articles: return ""
    bullets = [f"- {a.get('title')}" for a in articles[:40]]
    txt = "\n".join(bullets)
    prompt = f"Security Briefing for {profile_label}. Incidents:\n{txt}"
    try:
        resp = model.generate_content(prompt)
        return resp.text
    except:
        return "Summary unavailable."

def simple_text_summary(profile_label, articles):
    if not articles: return f"No major incidents for {profile_label}."
    lines = [f"Daily Briefing: {profile_label}", "-"*30]
    for a in articles[:40]:
        sev = a.get("severity", 1)
        title = a.get("title", "")
        source = a.get("source", "")
        snippet = a.get("snippet") or a.get("summary", "")
        lines.append(f"[sev={sev}] {title} ({source})")
        if snippet:
            lines.append(f"  {snippet[:120]}")
    return "\n".join(lines)

def render_html_report(label, body, date_obj):
    safe_body = body.replace("<", "&lt;")
    return f"""<html>
<head><title>Briefing: {label}</title>
<style>body{{font-family:sans-serif;padding:20px;background:#111;color:#eee}}</style>
</head>
<body><h1>{label} - {date_obj.strftime('%Y-%m-%d')}</h1><pre>{safe_body}</pre></body></html>"""

def main():
    articles = load_news()
    locations = load_locations()
    
    # 1. Export Locations to Public Data (Crucial for Frontend)
    # We convert dataclasses to dicts for JSON serialization
    loc_dicts = [asdict(l) for l in locations]
    with open(PUBLIC_LOCATIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(loc_dicts, f, indent=2)
    print(f"Exported {len(locations)} locations to {PUBLIC_LOCATIONS_PATH}")

    # 2. Proximity Alerts
    proximity_alerts = build_proximity_alerts(articles, locations)
    with open(PROXIMITY_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "radius_km": RADIUS_KM,
            "alerts": proximity_alerts
        }, f, indent=2)
    print(f"Wrote {len(proximity_alerts)} alerts to {PROXIMITY_PATH}")

    # 3. Reports
    model = init_gemini()
    now = datetime.now(timezone.utc)
    
    # We filter only recent articles for reports
    # news_agent.py writes field "time" (not "timestamp")
    cutoff = now - timedelta(hours=24)
    cutoff_iso = cutoff.isoformat()
    recent_articles = [
        a for a in articles
        if (a.get("time") or a.get("timestamp", "")) > cutoff_iso
    ]

    for key, cfg in REPORT_PROFILES.items():
        # simple region filter
        region_arts = [a for a in recent_articles if a.get("region") in cfg["regions"] or "Global" in cfg["regions"]]
        
        if model:
            body = summarise_with_gemini(model, cfg["label"], region_arts)
        else:
            body = simple_text_summary(cfg["label"], region_arts)
            
        html = render_html_report(cfg["label"], body, now)
        with open(os.path.join(REPORT_DIR, f"{key}_latest.html"), "w", encoding="utf-8") as f:
            f.write(html)
            
if __name__ == "__main__":
    main()
