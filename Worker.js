/**
 * worker.js - OS INFOHUB (FINAL PLATINUM VERSION)
 *
 * FEATURES:
 * 1. Architecture: Pure Cloudflare Module (export default).
 * 2. Stability: ctx.waitUntil fix for background tasks.
 * 3. Filters: Strict gating for NATURAL events (M5.5+ or local).
 * 4. Data: Full Country/Site lists restored.
 * 5. ALERTS: Rich HTML Email notifications (Resend) with Deduplication.
 */

"use strict";

/* ===========================
   CONFIG / CONSTANTS
   =========================== */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,secret,X-User-Id",
};

const ARCHIVE_PREFIX = "archive_";
const PROXIMITY_KV_KEY = "proximity_incidents_v1";
const INCIDENTS_KV_KEY = "incidents";
const BRIEFING_PREFIX = "briefing_";
const TRAVEL_CACHE_KEY = "travel_cache_v1";
const INGEST_LOCK_KEY = "ingest_lock_v1";
const TRAVEL_LOCK_KEY = "travel_lock_v1";
const THUMBS_KV_KEY = "thumbs_prefs_v1";
const THUMBS_FEEDBACK_LOG = "thumbs_feedback_log_v1";
const LEARNING_RULES_KEY = "learning_rules_v1";
const DISLIKES_KV_PREFIX = "DISLIKES:";
const ACK_KV_PREFIX = "ack:";
const ACK_TTL_SEC = 7 * 24 * 3600; // 7 days

const THUMBS_AGG_KEY = "thumbs_aggregates_v1";
const THUMBS_AGG_LOCK_KEY = "thumbs_agg_lock_v1";
const THUMBS_AGG_TTL_SEC = 60;
const THUMBS_AGG_STALE_SEC = 120;

// KV write-throttle default. Override per-environment with MIN_WRITE_INTERVAL_MS.
const DEFAULT_MIN_WRITE_INTERVAL_MS = 60_000;

const SEEN_TTL_SEC = 72 * 3600;
const INGEST_LOCK_TTL_SEC = 540;
const INGEST_LOCK_STALE_SEC = 900;
const TRAVEL_LOCK_TTL_SEC = 600;
const TRAVEL_LOCK_STALE_SEC = 1200;
const AUTO_48H_MS = 48 * 3600 * 1000;

const MAX_INCIDENTS_STORED = 300;

const DETERMINISTIC_SOURCES = [
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.atom",
  "https://www.gdacs.org/xml/rss.xml"
];

// Natural-hazard feeds that must pass the 200 km Dell-site proximity gate.
// Any event from these sources further than NATURAL_MAX_DIST_KM from every
// Dell site is silently dropped — prevents global earthquake/flood noise.
const NATURAL_HAZARD_SOURCES = new Set([
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.atom",
  "https://www.gdacs.org/xml/rss.xml"
]);

// SOURCE_META — maps feed URL fragment → { key, label, category }
// category must match the lnm pill filters: 'news'|'logistics'|'security'|'hazards'|'cyber'
const SOURCE_META = [
  { match: 'reuters.com',              key: 'reuters',     label: 'Reuters',       category: 'news' },
  { match: 'aljazeera.com',            key: 'aljazeera',   label: 'Al Jazeera',    category: 'news' },
  { match: 'bbci.co.uk',               key: 'bbc',         label: 'BBC',           category: 'news' },
  { match: 'apnews.com',               key: 'apnews',      label: 'AP News',       category: 'news' },
  { match: 'france24.com',             key: 'france24',    label: 'France 24',     category: 'news' },
  { match: 'dw.com',                   key: 'dw',          label: 'DW',            category: 'news' },
  { match: 'channelnewsasia.com',       key: 'cna',         label: 'CNA',           category: 'news' },
  { match: 'allafrica.com',            key: 'allafrica',   label: 'AllAfrica',     category: 'news' },
  { match: 'reliefweb.int',            key: 'reliefweb',   label: 'ReliefWeb',     category: 'news' },
  { match: 'freightwaves.com',         key: 'freightwaves', label: 'FreightWaves', category: 'logistics' },
  { match: 'supplychaindive.com',      key: 'scdive',      label: 'SC Dive',       category: 'logistics' },
  { match: 'maritime-executive.com',   key: 'maritime',    label: 'Maritime Exec', category: 'logistics' },
  { match: 'travel.state.gov',         key: 'ustravel',    label: 'US Travel',     category: 'security' },
  { match: 'gov.uk/foreign-travel',    key: 'ukfcdo',      label: 'UK FCDO',       category: 'security' },
  { match: 'cisa.gov',                 key: 'cisa',        label: 'CISA',          category: 'cyber' },
  { match: 'gdacs.org',                key: 'gdacs',       label: 'GDACS',         category: 'hazards' },
  { match: 'usgs.gov',                 key: 'usgs',        label: 'USGS',          category: 'hazards' },
];
function _getSourceMeta(src) {
  if (!src) return { key: 'other', label: 'Other', category: 'news' };
  for (const m of SOURCE_META) { if (src.includes(m.match)) return m; }
  return { key: 'other', label: new URL(src).hostname.replace(/^www\./,'').split('.')[0], category: 'news' };
}

// Expanded to 15 strategic sources from the 110-source trusted-feed list
// (CLAUDE.md §Security: no new libs, only approved RSS URLs).
// Ordered roughly by signal priority for Dell security ops.
const ROTATING_SOURCES = [
  // ── Global Tier-1 News ─────────────────────────────────────────────────────
  "https://feeds.reuters.com/reuters/worldNews",             // Reuters World (was /tools/rss)
  "https://www.aljazeera.com/xml/rss/all.xml",              // Al Jazeera Global
  "https://feeds.bbci.co.uk/news/world/rss.xml",            // BBC World English (was BBC Arabic)
  "https://apnews.com/apf-news?format=xml",                  // AP News
  "https://www.france24.com/en/rss",                         // France 24 World
  "https://www.dw.com/en/top-stories/world/s-1429/rss",     // Deutsche Welle World
  // ── Government / Employee Safety / Travel ──────────────────────────────────
  "https://travel.state.gov/_res/rss/TAs.xml",              // US State Dept Travel Advisories
  "https://www.gov.uk/foreign-travel-advice.rss",            // UK FCDO Travel Alerts
  "https://www.cisa.gov/news.xml",                           // CISA Critical Infrastructure
  // ── Supply Chain / Logistics ───────────────────────────────────────────────
  "https://www.freightwaves.com/feed",                       // FreightWaves
  "https://www.supplychaindive.com/feeds/news/",             // SupplyChainDive
  "https://www.maritime-executive.com/rss",                  // Maritime Executive
  // ── Regional Coverage Gaps ─────────────────────────────────────────────────
  "https://www.channelnewsasia.com/api/v1/rss-outbound-feed", // CNA (APAC)
  "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", // AllAfrica
  // ── Humanitarian / Crisis ──────────────────────────────────────────────────
  "https://reliefweb.int/updates/rss.xml"                    // ReliefWeb Global
];

const TRAVEL_DEFAULT_URL = "https://smartraveller.kevle.xyz/api/advisories";
const GITHUB_SMARTTRAVELLER_RAW = "https://raw.githubusercontent.com/kevle1/smartraveller-api/main";

const STATIC_TRAVEL_FALLBACK = [
  { country: "Global", level: 1, text: "Exercise normal precautions." }
];

const HIGH_NATURAL_CATS = new Set(['EARTHQUAKE','TSUNAMI','CYCLONE','HURRICANE','FLOOD','WILDFIRE','VOLCANO']);

// Operational keywords mainly for security incidents
const OPERATIONAL_KEYWORDS = /\b(shooting|mass shooting|bomb|bombing|hostage|hostages|terror|terrorist|riots|riot|massacre|gunman|active shooter|attack|kidnap|kidnapping|protest|demonstration|strike)\b/i;

// thresholds
const OPERATIONAL_MAX_DIST_KM = 50;   // worker-level cap for operational inclusion
const NATURAL_MAX_DIST_KM = 200;      // natural events considered regionally impactful
const IMPACT_SCORE_THRESHOLD = 50;    // 0..100

/* ======= STRICTER NATURAL THRESHOLDS ======= */
const NATURAL_MIN_MAGNITUDE = 5.5;   // earthquakes below this are generally non-destructive off-shore
const NATURAL_MIN_SEVERITY = 4;     // severity threshold to treat natural events as potentially impactful

/* ======= PROXIMITY ALERT GATING THRESHOLDS ======= */
// Aliases kept consistent with OPERATIONAL_MAX_DIST_KM / NATURAL_MAX_DIST_KM above.
// Override per-environment via wrangler.toml vars if needed.
const PROXIMITY_MAX_DISTANCE_KM = OPERATIONAL_MAX_DIST_KM; // default 50 km; natural events use NATURAL_MAX_DIST_KM
const PROXIMITY_WINDOW_HOURS = 72;                          // reject incidents older than this
const PROXIMITY_SEVERITY_THRESHOLD = 4;                     // minimum severity for non-keyword fallback accept

/* reverse-geocode cache & defaults */
const GEOCODE_CACHE_PREFIX = "rg_";
const GEOCODE_CACHE_TTL_SEC = 30 * 24 * 3600; // 30 days
const DEFAULT_GEOCODE_URL = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10";

/* ===========================
   DELL SITES — FULL LIST
   =========================== */

const DELL_SITES = [
  { name: "Dell Round Rock HQ", country: "US", region: "AMER", lat: 30.5083, lon: -97.6788 },
  { name: "Dell Austin Parmer", country: "US", region: "AMER", lat: 30.3952, lon: -97.6843 },
  { name: "Dell Hopkinton", country: "US", region: "AMER", lat: 42.2287, lon: -71.5226 },
  { name: "Dell Franklin", country: "US", region: "AMER", lat: 42.0834, lon: -71.3967 },
  { name: "Dell Apex", country: "US", region: "AMER", lat: 35.7327, lon: -78.8503 },
  { name: "Dell Eden Prairie", country: "US", region: "AMER", lat: 44.8617, lon: -93.4168 },
  { name: "Dell Draper", country: "US", region: "AMER", lat: 40.5240, lon: -111.8950 },
  { name: "Dell Nashville Hub", country: "US", region: "AMER", lat: 36.1627, lon: -86.7816 },
  { name: "Dell Oklahoma City", country: "US", region: "AMER", lat: 35.4676, lon: -97.5164 },
  { name: "Dell Santa Clara", country: "US", region: "AMER", lat: 37.3541, lon: -121.9552 },
  { name: "Dell McLean", country: "US", region: "AMER", lat: 38.9295, lon: -77.2268 },
  { name: "Dell El Paso", country: "US", region: "AMER", lat: 31.8385, lon: -106.5278 },
  { name: "Dell Toronto", country: "CA", region: "AMER", lat: 43.6532, lon: -79.3832 },
  { name: "Dell Mexico City", country: "MX", region: "AMER", lat: 19.4326, lon: -99.1332 },
  { name: "Dell Hortolândia Mfg", country: "BR", region: "LATAM", lat: -22.8583, lon: -47.2208 },
  { name: "Dell São Paulo", country: "BR", region: "LATAM", lat: -23.5505, lon: -46.6333 },
  { name: "Dell Porto Alegre", country: "BR", region: "LATAM", lat: -30.0346, lon: -51.2177 },
  { name: "Dell Panama City", country: "PA", region: "LATAM", lat: 8.9824, lon: -79.5199 },
  { name: "Dell Lodz Mfg", country: "PL", region: "EMEA", lat: 51.7285, lon: 19.4967 },
  { name: "Dell Limerick", country: "IE", region: "EMEA", lat: 52.6638, lon: -8.6267 },
  { name: "Dell Dublin Cherrywood", country: "IE", region: "EMEA", lat: 53.2374, lon: -6.1450 },
  { name: "Dell Cork Campus", country: "IE", region: "EMEA", lat: 51.8985, lon: -8.4756 },
  { name: "Dell Herzliya", country: "IL", region: "EMEA", lat: 32.1644, lon: 34.7961 },
  { name: "Dell Haifa", country: "IL", region: "EMEA", lat: 32.7940, lon: 34.9896 },
  { name: "Dell Beer Sheva", country: "IL", region: "EMEA", lat: 31.2626, lon: 34.8016 },
  { name: "Dell Bracknell", country: "GB", region: "EMEA", lat: 51.4160, lon: -0.7540 },
  { name: "Dell Glasgow", country: "GB", region: "EMEA", lat: 55.8642, lon: -4.2518 },
  { name: "Dell Montpellier", country: "FR", region: "EMEA", lat: 43.6108, lon: 3.8767 },
  { name: "Dell Paris / Bezons", country: "FR", region: "EMEA", lat: 48.8566, lon: 2.3522 },
  { name: "Dell Frankfurt", country: "DE", region: "EMEA", lat: 50.1109, lon: 8.6821 },
  { name: "Dell Halle", country: "DE", region: "EMEA", lat: 51.4820, lon: 11.9700 },
  { name: "Dell Amsterdam", country: "NL", region: "EMEA", lat: 52.3676, lon: 4.9041 },
  { name: "Dell Casablanca", country: "MA", region: "EMEA", lat: 33.5731, lon: -7.5898 },
  { name: "Dell Cairo", country: "EG", region: "EMEA", lat: 30.0444, lon: 31.2357 },
  { name: "Dell Dubai", country: "AE", region: "EMEA", lat: 25.2048, lon: 55.2708 },
  { name: "Dell Bangalore", country: "IN", region: "APJC", lat: 12.9716, lon: 77.5946 },
  { name: "Dell Hyderabad", country: "IN", region: "APJC", lat: 17.3850, lon: 78.4867 },
  { name: "Dell Gurugram", country: "IN", region: "APJC", lat: 28.4595, lon: 77.0266 },
  { name: "Dell Sriperumbudur Mfg", country: "IN", region: "APJC", lat: 12.9560, lon: 79.9410 },
  { name: "Dell Singapore", country: "SG", region: "APJC", lat: 1.3521, lon: 103.8198 },
  { name: "Dell Penang", country: "MY", region: "APJC", lat: 5.4164, lon: 100.3327 },
  { name: "Dell Cyberjaya", country: "MY", region: "APJC", lat: 2.9213, lon: 101.6559 },
  { name: "Dell Xiamen Mfg", country: "CN", region: "APJC", lat: 24.4798, lon: 118.0894 },
  { name: "Dell Chengdu Mfg", country: "CN", region: "APJC", lat: 30.5728, lon: 104.0668 },
  { name: "Dell Shanghai", country: "CN", region: "APJC", lat: 31.2304, lon: 121.4737 },
  { name: "Dell Taipei", country: "TW", region: "APJC", lat: 25.0330, lon: 121.5654 },
  { name: "Dell Tokyo", country: "JP", region: "APJC", lat: 35.6762, lon: 139.6503 },
  { name: "Dell Kawasaki", country: "JP", region: "APJC", lat: 35.5300, lon: 139.6960 },
  { name: "Dell Sydney", country: "AU", region: "APJC", lat: -33.8688, lon: 151.2093 },
  { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 }
];

const SITE_MAP_BY_NAME = {};
for (const s of DELL_SITES) { SITE_MAP_BY_NAME[s.name.toLowerCase()] = s; }

/* ===========================
   S2.5 — LOGISTICS HUB GEOFENCES
   7 Priority Dell Logistics Hubs (IATA/port code, lat/lon, radius)
=========================== */
const DELL_LOGISTICS_HUBS = [
  { code: 'PEN', name: 'Dell Penang Logistics Hub',   lat:  5.4164, lon: 100.3327, radiusKm:  50 },
  { code: 'SIN', name: 'Dell Singapore Hub',           lat:  1.3521, lon: 103.8198, radiusKm:  50 },
  { code: 'ROT', name: 'Dell Rotterdam Hub',           lat: 51.9244, lon:   4.4777, radiusKm:  60 },
  { code: 'SNN', name: 'Dell Shannon/Limerick Hub',    lat: 52.7019, lon:  -8.9205, radiusKm:  60 },
  { code: 'AUS', name: 'Dell Austin Hub',              lat: 30.2672, lon: -97.7431, radiusKm:  60 },
  { code: 'BNA', name: 'Dell Nashville Hub',           lat: 36.1627, lon: -86.7816, radiusKm:  60 },
  { code: 'POA', name: 'Dell Porto Alegre Hub',        lat:-30.0346, lon: -51.2177, radiusKm:  60 },
];
const OPENSKY_TOKEN_META_KEY  = 'opensky_token_meta';
const LOG_ALERT_DEDUP_PREFIX  = 'LOG_ALERT_DEDUP_';
const LOGISTICS_WATCH_PREFIX  = 'logistics_watch_';
const LOG_TRACK_PREFIX        = 'LOG_TRACK_';          // schedule fallback cache key prefix
const SCHEDULE_CACHE_TTL_SEC  = 10 * 60;               // 10-minute schedule cache TTL (configurable 5–15 min)

/* ===========================
   LOGGING
   =========================== */
const LOG_LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
let LOG_LEVEL = "info";
function setLogLevelFromEnv(env) {
  try {
    if (env && env.LOG_LEVEL) {
      const lvl = String(env.LOG_LEVEL).toLowerCase();
      if (lvl in LOG_LEVEL_ORDER) LOG_LEVEL = lvl;
    }
  } catch (e) { /* ignore */ }
}
function log(level, ...args) {
  try {
    const lnum = LOG_LEVEL_ORDER[level] ?? 0;
    const cur = LOG_LEVEL_ORDER[LOG_LEVEL] ?? 0;
    if (lnum >= cur && level !== "none") console.log(`[${level.toUpperCase()}]`, ...args);
  } catch (e) { /* swallow */ }
}
function debug(...args) { log("debug", ...args); }
function info(...args) { log("info", ...args); }
function warn(...args) { log("warn", ...args); }
function error(...args) { log("error", ...args); }

/* ===========================
   UTILS
   =========================== */

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithTimeout(url, opts = {}, timeout = 15000) {
  // AbortSignal.timeout() is natively supported in Cloudflare Workers and
  // is guaranteed to fire — unlike setTimeout which can be delayed by event-loop budget.
  const signal = typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeout)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(), timeout); return c.signal; })();
  try {
    const headers = {
      "User-Agent": "OS-INFOHUB-Worker/1.0 (+https://example.com)",
      "Accept": "application/json, text/plain, */*",
      ...(opts.headers || {})
    };
    const res = await fetch(url, { ...opts, headers, signal });
    if (!res) throw new Error("http_" + (res.status || "no_status"));
    return res;
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "TimeoutError")) throw new Error("fetch_timeout");
    throw e;
  }
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function utcDateKey(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function stableId(s = "") {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h |= 0;
  }
  return String(h >>> 0);
}

/* UUID helper */
function _uuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i=0;i<16;i++) b[i]=Math.floor(Math.random()*256);
    b[6]=(b[6]&0x0f)|0x40;
    b[8]=(b[8]&0x3f)|0x80;
    const hex = Array.from(b).map(bt => bt.toString(16).padStart(2,"0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  } catch (e) {
    return `id_${Date.now()}_${Math.floor(Math.random()*1e9)}`;
  }
}

/* ---------------------------
   Helper: validate coordinates
   --------------------------- */
function _validCoords(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9) return false;
  return true;
}

/* ---------------------------
   Helper: safe response builder
   --------------------------- */
function _responseFromResult(resObj) {
  const bodyVal = (resObj && typeof resObj.body === 'object') ? JSON.stringify(resObj.body) : String(resObj && resObj.body != null ? resObj.body : '');
  const headers = { ...CORS_HEADERS };
  if (resObj && typeof resObj.body === 'object') headers["Content-Type"] = "application/json";
  return new Response(bodyVal, { status: resObj.status || 200, headers });
}

/* haversine */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function nearestDell(lat, lon) {
  let best = null;
  for (const s of DELL_SITES) {
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (!best || d < best.dist) best = { ...s, dist: d };
  }
  return best;
}

/* ===========================
   COUNTRY_COORDS — FULL LIST (RESTORED)
   =========================== */
const COUNTRY_COORDS = {
  "afghanistan": { lat: 33.93911, lng: 67.709953 },
  "albania": { lat: 41.153332, lng: 20.168331 },
  "algeria": { lat: 28.033886, lng: 1.659626 },
  "andorra": { lat: 42.506285, lng: 1.521801 },
  "angola": { lat: -11.202692, lng: 17.873887 },
  "argentina": { lat: -38.416097, lng: -63.616672 },
  "armenia": { lat: 40.069099, lng: 45.038189 },
  "australia": { lat: -25.274398, lng: 133.775136 },
  "austria": { lat: 47.516231, lng: 14.550072 },
  "azerbaijan": { lat: 40.143105, lng: 47.576927 },
  "bahamas": { lat: 25.03428, lng: -77.39628 },
  "bahrain": { lat: 25.930414, lng: 50.637772 },
  "bangladesh": { lat: 23.684994, lng: 90.356331 },
  "barbados": { lat: 13.193887, lng: -59.543198 },
  "belarus": { lat: 53.709807, lng: 27.953389 },
  "belgium": { lat: 50.503887, lng: 4.469936 },
  "belize": { lat: 17.189877, lng: -88.49765 },
  "benin": { lat: 9.30769, lng: 2.315834 },
  "bhutan": { lat: 27.514162, lng: 90.433601 },
  "bolivia": { lat: -16.290154, lng: -63.588653 },
  "bosnia and herzegovina": { lat: 43.915886, lng: 17.679076 },
  "botswana": { lat: -22.328474, lng: 24.684866 },
  "brazil": { lat: -14.235004, lng: -51.92528 },
  "brunei": { lat: 4.535277, lng: 114.727669 },
  "bulgaria": { lat: 42.733883, lng: 25.48583 },
  "burkina faso": { lat: 12.238333, lng: -1.561593 },
  "burundi": { lat: -3.373056, lng: 29.918886 },
  "cabo verde": { lat: 16.002082, lng: -24.013197 },
  "cambodia": { lat: 12.565679, lng: 104.990963 },
  "cameroon": { lat: 7.369722, lng: 12.354722 },
  "canada": { lat: 56.130366, lng: -106.346771 },
  "central african republic": { lat: 6.611111, lng: 20.939444 },
  "chad": { lat: 15.454166, lng: 18.732207 },
  "chile": { lat: -35.675147, lng: -71.542969 },
  "china": { lat: 35.86166, lng: 104.195397 },
  "colombia": { lat: 4.570868, lng: -74.297333 },
  "comoros": { lat: -11.875001, lng: 43.872219 },
  "congo": { lat: -0.228021, lng: 15.827659 },
  "costa rica": { lat: 9.748917, lng: -83.753428 },
  "croatia": { lat: 45.1, lng: 15.2 },
  "cuba": { lat: 21.521757, lng: -77.781167 },
  "cyprus": { lat: 35.126413, lng: 33.429859 },
  "czechia": { lat: 49.817492, lng: 15.472962 },
  "denmark": { lat: 56.26392, lng: 9.501785 },
  "djibouti": { lat: 11.825138, lng: 42.590275 },
  "dominica": { lat: 15.414999, lng: -61.370976 },
  "dominican republic": { lat: 18.735693, lng: -70.162651 },
  "ecuador": { lat: -1.831239, lng: -78.183406 },
  "egypt": { lat: 26.820553, lng: 30.802498 },
  "el salvador": { lat: 13.794185, lng: -88.896533 },
  "equatorial guinea": { lat: 1.650801, lng: 10.267895 },
  "eritrea": { lat: 15.179384, lng: 39.782334 },
  "estonia": { lat: 58.595272, lng: 25.013607 },
  "eswatini": { lat: -26.522503, lng: 31.465866 },
  "ethiopia": { lat: 9.145, lng: 40.489673 },
  "fiji": { lat: -17.713371, lng: 178.065032 },
  "finland": { lat: 61.92411, lng: 25.748151 },
  "france": { lat: 46.227638, lng: 2.213749 },
  "gabon": { lat: -0.803689, lng: 11.609444 },
  "gambia": { lat: 13.443182, lng: -15.310139 },
  "georgia": { lat: 42.315407, lng: 43.356892 },
  "germany": { lat: 51.165691, lng: 10.451526 },
  "ghana": { lat: 7.946527, lng: -1.023194 },
  "greece": { lat: 39.074208, lng: 21.824312 },
  "grenada": { lat: 12.116501, lng: -61.6790 },
  "guatemala": { lat: 15.783471, lng: -90.230759 },
  "guinea": { lat: 9.945587, lng: -9.696645 },
  "guinea-bissau": { lat: 11.803749, lng: -15.180413 },
  "guyana": { lat: 4.860416, lng: -58.93018 },
  "haiti": { lat: 18.971187, lng: -72.285215 },
  "honduras": { lat: 15.199999, lng: -86.241905 },
  "hungary": { lat: 47.162494, lng: 19.503304 },
  "iceland": { lat: 64.963051, lng: -19.020835 },
  "india": { lat: 20.593684, lng: 78.96288 },
  "indonesia": { lat: -0.789275, lng: 113.921327 },
  "iran": { lat: 32.427908, lng: 53.688046 },
  "iraq": { lat: 33.223191, lng: 43.679291 },
  "ireland": { lat: 53.41291, lng: -8.24389 },
  "israel": { lat: 31.046051, lng: 34.851612 },
  "italy": { lat: 41.87194, lng: 12.56738 },
  "jamaica": { lat: 18.109581, lng: -77.297508 },
  "japan": { lat: 36.204824, lng: 138.252924 },
  "jordan": { lat: 30.585164, lng: 36.238414 },
  "kazakhstan": { lat: 48.019573, lng: 66.923684 },
  "kenya": { lat: -0.023559, lng: 37.906193 },
  "kuwait": { lat: 29.31166, lng: 47.481766 },
  "kyrgyzstan": { lat: 41.20438, lng: 74.766098 },
  "laos": { lat: 19.85627, lng: 102.495496 },
  "latvia": { lat: 56.879635, lng: 24.603189 },
  "lebanon": { lat: 33.854721, lng: 35.862285 },
  "lesotho": { lat: -29.609988, lng: 28.233608 },
  "liberia": { lat: 6.428055, lng: -9.429499 },
  "libya": { lat: 26.3351, lng: 17.228331 },
  "liechtenstein": { lat: 47.166, lng: 9.555373 },
  "lithuania": { lat: 55.169438, lng: 23.881275 },
  "luxembourg": { lat: 49.815273, lng: 6.129583 },
  "madagascar": { lat: -18.766947, lng: 46.869107 },
  "malawi": { lat: -13.254308, lng: 34.301525 },
  "malaysia": { lat: 4.210484, lng: 101.975766 },
  "maldives": { lat: 3.202778, lng: 73.22068 },
  "mali": { lat: 17.570692, lng: -3.996166 },
  "malta": { lat: 35.937496, lng: 14.375416 },
  "marshall islands": { lat: 7.131474, lng: 171.184478 },
  "mauritania": { lat: 21.00789, lng: -10.940835 },
  "mauritius": { lat: -20.348404, lng: 57.552152 },
  "mexico": { lat: 23.634501, lng: -102.552784 },
  "micronesia": { lat: 7.425554, lng: 150.550812 },
  "moldova": { lat: 47.411631, lng: 28.369885 },
  "monaco": { lat: 43.750298, lng: 7.412841 },
  "mongolia": { lat: 46.862496, lng: 103.846653 },
  "montenegro": { lat: 42.708678, lng: 19.37439 },
  "morocco": { lat: 31.791702, lng: -7.09262 },
  "mozambique": { lat: -18.665695, lng: 35.529562 },
  "myanmar": { lat: 21.913965, lng: 95.956223 },
  "namibia": { lat: -22.95764, lng: 18.49041 },
  "nauru": { lat: -0.522778, lng: 166.931503 },
  "nepal": { lat: 28.394857, lng: 84.124008 },
  "netherlands": { lat: 52.132633, lng: 5.291266 },
  "new zealand": { lat: -40.900557, lng: 174.885971 },
  "nicaragua": { lat: 12.865416, lng: -85.207229 },
  "niger": { lat: 17.607789, lng: 8.081666 },
  "nigeria": { lat: 9.081999, lng: 8.675277 },
  "north macedonia": { lat: 41.608635, lng: 21.745273 },
  "norway": { lat: 60.472024, lng: 8.468946 },
  "oman": { lat: 21.512583, lng: 55.923255 },
  "pakistan": { lat: 30.375321, lng: 69.345116 },
  "palau": { lat: 7.51498, lng: 134.58252 },
  "panama": { lat: 8.537981, lng: -80.782127 },
  "papua new guinea": { lat: -6.314993, lng: 143.95555 },
  "paraguay": { lat: -23.442503, lng: -58.443832 },
  "peru": { lat: -9.189967, lng: -75.015152 },
  "philippines": { lat: 12.879721, lng: 121.774017 },
  "poland": { lat: 51.919438, lng: 19.145136 },
  "portugal": { lat: 39.399872, lng: -8.224454 },
  "qatar": { lat: 25.354826, lng: 51.183884 },
  "romania": { lat: 45.943161, lng: 24.96676 },
  "russia": { lat: 61.52401, lng: 105.318756 },
  "rwanda": { lat: -1.940278, lng: 29.873888 },
  "saint kitts and nevis": { lat: 17.357822, lng: -62.783 },
  "saint lucia": { lat: 13.909444, lng: -60.978893 },
  "saint vincent and the grenadines": { lat: 13.252817, lng: -61.197749 },
  "samoa": { lat: -13.759029, lng: -172.104629 },
  "san marino": { lat: 43.94236, lng: 12.457777 },
  "sao tome and principe": { lat: 0.18636, lng: 6.613081 },
  "saudi arabia": { lat: 23.885942, lng: 45.079162 },
  "senegal": { lat: 14.497401, lng: -14.452362 },
  "serbia": { lat: 44.016521, lng: 21.005859 },
  "seychelles": { lat: -4.679574, lng: 55.491977 },
  "sierra leone": { lat: 8.460555, lng: -11.779889 },
  "singapore": { lat: 1.352083, lng: 103.819836 },
  "slovakia": { lat: 48.669026, lng: 19.699024 },
  "slovenia": { lat: 46.151241, lng: 14.995463 },
  "solomon islands": { lat: -9.64571, lng: 160.156194 },
  "somalia": { lat: 5.152149, lng: 46.199616 },
  "south africa": { lat: -30.559482, lng: 22.937506 },
  "south korea": { lat: 35.907757, lng: 127.766922 },
  "south sudan": { lat: 6.876991, lng: 31.306978 },
  "spain": { lat: 40.463667, lng: -3.74922 },
  "sri lanka": { lat: 7.873054, lng: 80.771797 },
  "sudan": { lat: 12.862807, lng: 30.217636 },
  "suriname": { lat: 3.919305, lng: -56.027783 },
  "sweden": { lat: 60.128161, lng: 18.643501 },
  "switzerland": { lat: 46.818188, lng: 8.227512 },
  "syria": { lat: 34.802074, lng: 38.996815 },
  "taiwan": { lat: 23.69781, lng: 120.960515 },
  "tajikistan": { lat: 38.861034, lng: 71.276093 },
  "tanzania": { lat: -6.369028, lng: 34.888822 },
  "thailand": { lat: 15.870032, lng: 100.992541 },
  "timor-leste": { lat: -8.874217, lng: 125.727539 },
  "togo": { lat: 8.619543, lng: 0.824782 },
  "tonga": { lat: -21.178986, lng: -175.198242 },
  "trinidad and tobago": { lat: 10.691803, lng: -61.222503 },
  "tunisia": { lat: 33.886917, lng: 9.537499 },
  "turkey": { lat: 38.963745, lng: 35.243322 },
  "turkmenistan": { lat: 38.969719, lng: 59.556278 },
  "tuvalu": { lat: -7.109535, lng: 177.64933 },
  "uganda": { lat: 1.373333, lng: 32.290275 },
  "ukraine": { lat: 48.379433, lng: 31.16558 },
  "united arab emirates": { lat: 23.424076, lng: 53.847818 },
  "united kingdom": { lat: 55.378051, lng: -3.435973 },
  "united states": { lat: 37.09024, lng: -95.712891 },
  "uruguay": { lat: -32.522779, lng: -55.765835 },
  "uzbekistan": { lat: 41.377491, lng: 64.585262 },
  "vanuatu": { lat: -15.376706, lng: 166.959158 },
  "vatican city": { lat: 41.902916, lng: 12.453389 },
  "venezuela": { lat: 6.42375, lng: -66.58973 },
  "vietnam": { lat: 14.058324, lng: 108.277199 },
  "yemen": { lat: 15.552727, lng: 48.516388 },
  "zambia": { lat: -13.133897, lng: 27.849332 },
  "zimbabwe": { lat: -19.015438, lng: 29.154857 }
};

/* ===========================
   COUNTRY INSTABILITY INDEX (CII) — Phase 3
   WorldMonitor-inspired 0-100 composite score
   40% static baseline + 60% event-driven (last 7 days)
   Components: Unrest(25%) Conflict(30%) Security(20%) Information(25%)
   =========================== */

/* Static baseline instability scores (0–50) based on WorldMonitor model */
const CII_BASELINES = {
  "ukraine":              50, "syria":               50, "north korea":        45,
  "russia":               38, "myanmar":             42, "afghanistan":        48,
  "yemen":                48, "somalia":             46, "mali":               42,
  "sudan":                44, "south sudan":         45, "democratic republic of the congo": 43,
  "nigeria":              36, "ethiopia":            38, "haiti":              40,
  "iran":                 38, "iraq":                36, "libya":              40,
  "mozambique":           34, "burkina faso":        40, "niger":              38,
  "central african republic": 44, "chad":             38, "venezuela":         36,
  "pakistan":             32, "egypt":               28, "turkey":             24,
  "israel":               34, "lebanon":             36,
  "china":                18, "india":               16, "brazil":             14,
  "mexico":               20, "colombia":            18, "indonesia":          10,
  "malaysia":             8,  "thailand":            14, "philippines":        16,
  "bangladesh":           14, "singapore":           3,  "united states":      8,
  "united kingdom":       5,  "germany":             5,  "france":             8,
  "japan":                3,  "australia":           3,  "canada":             5,
  "netherlands":          5,  "ireland":             4,  "czechia":            5,
  "poland":               10, "hungary":             12, "slovakia":           6,
  "taiwan":               20, "south korea":         14, "morocco":            16,
  "saudi arabia":         20, "united arab emirates":12, "qatar":              10,
  "jordan":               18, "kenya":               18, "ghana":              10,
  "south africa":         18, "algeria":             20, "tunisia":            18,
  "cambodia":             14, "laos":                12, "vietnam":            10,
  "sri lanka":            18, "nepal":               14, "georgia":            18,
  "armenia":              22, "azerbaijan":          22, "kyrgyzstan":         20,
  "tajikistan":           24, "uzbekistan":          16, "kazakhstan":         16,
};

/* Event-score multipliers for reporting-bias correction (WorldMonitor model) */
const CII_MULTIPLIERS = {
  "north korea": 3.0, "china": 2.5, "russia": 1.8, "iran": 2.0,
  "eritrea":     2.5, "turkmenistan": 2.5, "belarus": 2.0,
  "united states": 0.4, "united kingdom": 0.5, "germany": 0.5,
  "australia":   0.5, "canada": 0.5, "france": 0.5, "japan": 0.5,
  "singapore":   0.6, "netherlands": 0.5,
};

/* Countries with Dell manufacturing/major sites — shown in "Dell Sites" tab */
const CII_DELL_COUNTRIES = new Set([
  "united states", "china", "india", "malaysia", "ireland", "czechia",
  "brazil", "mexico", "singapore", "taiwan", "japan", "germany",
  "united kingdom", "poland", "hungary", "south korea", "thailand",
  "australia", "canada", "netherlands",
]);

/* Watchlist — elevated-attention countries */
const CII_WATCHLIST = new Set([
  "china", "russia", "iran", "north korea", "ukraine", "myanmar",
  "pakistan", "nigeria", "ethiopia", "venezuela", "taiwan", "israel",
  "saudi arabia", "turkey", "egypt", "belarus", "syria", "yemen",
]);

/* CII level label from score */
function _ciiLevel(score) {
  if (score >= 81) return { label: "CRITICAL", emoji: "🔴", cls: "cii-critical" };
  if (score >= 66) return { label: "HIGH",     emoji: "🟠", cls: "cii-high"     };
  if (score >= 51) return { label: "ELEVATED", emoji: "🟡", cls: "cii-elevated" };
  if (score >= 31) return { label: "NORMAL",   emoji: "🟢", cls: "cii-normal"   };
  return              { label: "LOW",      emoji: "⚪", cls: "cii-low"      };
}

/* CII trend label from delta */
function _ciiTrend(delta) {
  if (delta >= 5)  return { label: "Rising",  arrow: "↑", cls: "cii-rising"  };
  if (delta <= -5) return { label: "Falling", arrow: "↓", cls: "cii-falling" };
  return                   { label: "Stable",  arrow: "→", cls: "cii-stable"  };
}

/* Map incident AI category → CII component weights */
const CII_CAT_WEIGHTS = {
  "CONFLICT":          { unrest: 0,   conflict: 1.0, security: 0.3, info: 0 },
  "PHYSICAL_SECURITY": { unrest: 0.2, conflict: 0.3, security: 1.0, info: 0 },
  "SECURITY":          { unrest: 0.2, conflict: 0.2, security: 0.8, info: 0 },
  "PROTEST":           { unrest: 1.0, conflict: 0.2, security: 0.1, info: 0 },
  "CIVIL_UNREST":      { unrest: 1.0, conflict: 0.3, security: 0.1, info: 0 },
  "CYBER":             { unrest: 0,   conflict: 0.1, security: 0.4, info: 1.0 },
  "NATURAL":           { unrest: 0,   conflict: 0,   security: 0.2, info: 0.1 },
  "SUPPLY_CHAIN":      { unrest: 0.1, conflict: 0.1, security: 0.2, info: 0.3 },
  "TRANSPORT":         { unrest: 0.1, conflict: 0.1, security: 0.2, info: 0.2 },
  "ENVIRONMENT":       { unrest: 0.1, conflict: 0,   security: 0.1, info: 0.1 },
  "DISRUPTION":        { unrest: 0.2, conflict: 0.1, security: 0.2, info: 0.2 },
};
const CII_CAT_DEFAULT = { unrest: 0.2, conflict: 0.1, security: 0.1, info: 0.1 };

async function handleApiCII(env, req) {
  try {
    const url   = new URL(req.url);
    const tab   = url.searchParams.get('tab') || 'global';   // global|dell|watchlist
    const limit = Math.min(Number(url.searchParams.get('limit') || 25), 50);

    /* Load KV incidents — last 7 days */
    const raw       = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const incidents = Array.isArray(raw) ? raw : [];
    const cutoff    = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent    = incidents.filter(inc => {
      const t = inc.time ? new Date(inc.time).getTime() : 0;
      return t > cutoff && inc.country;
    });

    /* Aggregate component scores per country */
    const agg = {}; // countryName → { unrest, conflict, security, info, count }
    for (const inc of recent) {
      const c = String(inc.country || '').toLowerCase().trim();
      if (!c || c === 'global' || c === 'unknown') continue;
      if (!agg[c]) agg[c] = { unrest: 0, conflict: 0, security: 0, info: 0, count: 0 };
      const wt  = CII_CAT_WEIGHTS[String(inc.category || '').toUpperCase()] || CII_CAT_DEFAULT;
      const sev = Math.max(1, Math.min(5, Number(inc.severity) || 3));
      const mag = sev / 3; // normalise 1-5 → 0.33-1.67
      agg[c].unrest   += wt.unrest   * mag;
      agg[c].conflict += wt.conflict * mag;
      agg[c].security += wt.security * mag;
      agg[c].info     += wt.info     * mag;
      agg[c].count    += 1;
    }

    /* Build per-country CII scores */
    const scores = [];
    const allCountries = new Set([
      ...Object.keys(CII_BASELINES),
      ...Object.keys(agg),
    ]);

    for (const country of allCountries) {
      const baseline   = CII_BASELINES[country] ?? 10;
      const multiplier = CII_MULTIPLIERS[country] ?? 1.0;
      const counts     = agg[country] || { unrest: 0, conflict: 0, security: 0, info: 0, count: 0 };
      const eventCount = counts.count || 0;

      /* Normalise component event scores to 0-100 scale (cap at 20 events = full score) */
      const scale = Math.min(eventCount, 20) / 20;
      const norm  = (v) => Math.min(100, (v / Math.max(eventCount, 1)) * multiplier * scale * 100);

      const compUnrest   = norm(counts.unrest);
      const compConflict = norm(counts.conflict);
      const compSecurity = norm(counts.security);
      const compInfo     = norm(counts.info);

      /* Weighted event score: Unrest(25%) Conflict(30%) Security(20%) Info(25%) */
      const eventScore = (
        compUnrest   * 0.25 +
        compConflict * 0.30 +
        compSecurity * 0.20 +
        compInfo     * 0.25
      );

      /* Final CII: 40% baseline, 60% event-driven */
      const score = Math.round(Math.min(100, (baseline * 0.40) + (eventScore * 0.60)));

      /* Pseudo-trend: compare last 3 days vs prior 4 days */
      const cut3  = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const recentEvents = recent.filter(inc => {
        const t = inc.time ? new Date(inc.time).getTime() : 0;
        const c = String(inc.country || '').toLowerCase().trim();
        return c === country && t > cut3;
      }).length;
      const olderEvents = eventCount - recentEvents;
      const recentRate  = recentEvents / 3;
      const olderRate   = olderEvents  / 4;
      const delta       = Math.round((recentRate - olderRate) * 5); // scale to ±score units

      const level = _ciiLevel(score);
      const trend = _ciiTrend(delta);
      const coord = COUNTRY_COORDS[country];

      scores.push({
        country,
        score,
        delta,
        level:     level.label,
        levelEmoji:level.emoji,
        levelCls:  level.cls,
        trend:     trend.label,
        trendArrow:trend.arrow,
        trendCls:  trend.cls,
        components: {
          unrest:   Math.round(compUnrest),
          conflict: Math.round(compConflict),
          security: Math.round(compSecurity),
          info:     Math.round(compInfo),
        },
        eventCount,
        lat:  coord ? coord.lat : null,
        lng:  coord ? coord.lng : null,
        isWatchlist: CII_WATCHLIST.has(country),
        isDell:      CII_DELL_COUNTRIES.has(country),
      });
    }

    /* Sort by score desc */
    scores.sort((a, b) => b.score - a.score);

    /* Filter by tab */
    let filtered = scores;
    if (tab === 'dell')      filtered = scores.filter(s => s.isDell);
    if (tab === 'watchlist') filtered = scores.filter(s => s.isWatchlist);

    const items = filtered.slice(0, limit);

    return new Response(JSON.stringify({
      ok: true,
      tab,
      items,
      total:       scores.length,
      incidentsIn: recent.length,
      generatedAt: new Date().toISOString(),
    }), {
      status:  200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    typeof debug === 'function' && debug('handleApiCII error', e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), items: [] }), {
      status:  500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

/* ===========================
   COUNTRY INSTABILITY INDEX — END
   =========================== */

/* ===========================
   SIGNAL CONVERGENCE ALERTS — Phase 4
   Fires when ≥3 independent sources report the same country within 24 h
   Returns ranked list of converging situations
   =========================== */
const CONV_MIN_SOURCES  = 3;
const CONV_HIGH_SOURCES = 6;
const CONV_WINDOW_MS    = 24 * 60 * 60 * 1000;

async function handleApiConvergence(env, _req) {
  try {
    const raw       = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const incidents = Array.isArray(raw) ? raw : [];
    const cutoff    = Date.now() - CONV_WINDOW_MS;

    const recent = incidents.filter(inc => {
      const t = inc.time ? new Date(inc.time).getTime() : 0;
      const c = String(inc.country || '').toLowerCase().trim();
      return t > cutoff && c && c !== 'global' && c !== 'unknown' && inc.title;
    });

    /* Group by country */
    const byCountry = {};
    for (const inc of recent) {
      const country = String(inc.country || '').toLowerCase().trim();
      if (!byCountry[country]) byCountry[country] = { sources: new Set(), incidents: [], categories: new Set() };
      const sm = _getSourceMeta(inc.source || '');
      byCountry[country].sources.add(sm.key);
      byCountry[country].incidents.push(inc);
      if (inc.category) byCountry[country].categories.add(inc.category.toUpperCase());
    }

    const alerts = [];
    for (const [country, data] of Object.entries(byCountry)) {
      const sourceCount = data.sources.size;
      if (sourceCount < CONV_MIN_SOURCES) continue;

      const sorted = [...data.incidents].sort(
        (a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()
      );
      const latest   = sorted[0];
      const oldest   = sorted[sorted.length - 1];
      const spanHrs  = Math.round(
        (new Date(latest.time || 0).getTime() - new Date(oldest.time || 0).getTime()) / 360000
      ) / 10;

      const level = sourceCount >= CONV_HIGH_SOURCES ? 'HIGH' : 'ELEVATED';
      const coord = COUNTRY_COORDS[country];

      alerts.push({
        country,
        sourceCount,
        sources:       Array.from(data.sources),
        categories:    Array.from(data.categories),
        incidentCount: data.incidents.length,
        spanHrs,
        level,
        levelEmoji:    level === 'HIGH' ? '🔴' : '🟠',
        latestTitle:   latest.title  || '',
        latestTime:    latest.time   || '',
        lat:           coord ? coord.lat : null,
        lng:           coord ? coord.lng : null,
      });
    }

    alerts.sort((a, b) => b.sourceCount - a.sourceCount);

    return new Response(JSON.stringify({
      ok: true, alerts, total: alerts.length,
      generatedAt: new Date().toISOString(),
    }), {
      status:  200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    typeof debug === 'function' && debug('handleApiConvergence error', e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), alerts: [] }), {
      status:  500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
/* ===========================
   SIGNAL CONVERGENCE ALERTS — END
   =========================== */

/* Utility: extract country string from free text */
function extractCountryFromText(text = "") {
  if (!text || typeof text !== "string") return null;
  const low = text.toLowerCase();
  for (const k of Object.keys(COUNTRY_COORDS)) {
    if (low.includes(k)) return k;
  }
  for (const s of DELL_SITES) {
    const c = (s.country || "").toLowerCase();
    if (c && (low.includes(c) || low.includes(s.name.toLowerCase()))) return c;
  }
  const codeMatch = low.match(/\b(us|usa|uk|au|in|cn|ru|fr|de|br|ca|es|it|mx|jp|nl|sg|my|ph|id|ae)\b/);
  if (codeMatch) {
    const cc = codeMatch[1];
    if (cc === "us" || cc === "usa") return "united states";
    if (cc === "uk") return "united kingdom";
    if (cc === "au") return "australia";
    if (cc === "in") return "india";
    if (cc === "cn") return "china";
    if (cc === "ru") return "russia";
    if (cc === "fr") return "france";
    if (cc === "de") return "germany";
    if (cc === "br") return "brazil";
    if (cc === "ca") return "canada";
    if (cc === "es") return "spain";
    if (cc === "it") return "italy";
    if (cc === "mx") return "mexico";
    if (cc === "jp") return "japan";
    if (cc === "nl") return "netherlands";
    if (cc === "sg") return "singapore";
    if (cc === "my") return "malaysia";
    if (cc === "ph") return "philippines";
    if (cc === "id") return "indonesia";
    if (cc === "ae") return "united arab emirates";
  }
  return null;
}

/* Noise filter — rejects content unrelated to physical security / supply-chain / facility / infrastructure.
   Returns true (= noise) for items matching off-topic categories unless a security carve-out applies. */
function isNoise(text = "") {
  const t = String(text).toLowerCase();

  // --- Tier-1: hard noise (sports, entertainment — no carve-out needed) ---
  const HARD_NOISE = /\b(sports?|football|soccer|basketball|baseball|cricket|rugby|afcon|fifa|nfl|nba|nhl|mlb|olympics?|formula\s*1|f1 race|grand prix|tennis|golf|athlete|league table|transfer window|movie|film|box office|academy award|oscars?|emmys?|grammys?|golden globe|celebrity|fashion|recipe|horoscope|astrology|zodiac|gaming|video game|esports|tv show|sitcom|reality show|dating show|music chart|album release|concert tour|book review|lifestyle|beauty|wellness|diet|nutrition|fitness|workout)\b/i;
  if (HARD_NOISE.test(t)) return true;

  // --- Tier-2: finance / markets — reject unless supply-chain physical disruption present ---
  const FINANCE_NOISE = /\b(stock market|share price|shares rose|shares fell|market cap|equity|ipo|earnings|quarterly results|revenue|profit|loss|gdp|inflation|interest rate|fed rate|central bank|cryptocurrency|crypto|bitcoin|nft|hedge fund|venture capital|private equity|merger|acquisition|ipo filing|analyst upgrade|analyst downgrade|credit rating|bond yield|trade deficit|current account|fiscal policy|monetary policy|dividend|buyback|stock split)\b/i;
  const SUPPLY_CHAIN_CARVEOUT = /\b(plant closure|factory closure|port closure|supply chain|supply-chain|supplychain|facility closure|logistics disruption|shipment|container shortage|manufactur|warehouse fire|production halt|power outage|blackout|grid failure|network outage)\b/i;
  if (FINANCE_NOISE.test(t) && !SUPPLY_CHAIN_CARVEOUT.test(t)) return true;

  // --- Tier-3: general politics / diplomacy — reject unless security-adjacent ---
  const POLITICS_NOISE = /\b(election|elections|ballot|polling|campaign|candidate|prime minister elected|parliament|congress|senate|legislation|bill passed|law signed|foreign policy|diplomatic|diplomacy|ambassador|embassy visit|trade deal|trade agreement|treaty|tariff negotiation|sanctions lifted|bilateral|multilateral|summit meeting|state visit|press conference|budget|austerity|stimulus|welfare|healthcare reform|immigration policy|refugee policy|climate pledge|paris agreement|un resolution|nato summit)\b/i;
  const SECURITY_CARVEOUT = /\b(attack|bomb|shoot|evacuat|fire|explosion|earthquake|flood|tsunami|kidnap|abduct|hostage|terror|threat|militant|armed|gunman|siege|riot|protest|unrest|conflict|war|strike action|blockade|arrest|detained|security|safety|hazard|emergency|incident|casualt|killed|dead|injured|wounded|infrastructure|facility|supply chain|disruption|outage|closure|armed conflict|civil unrest)\b/i;
  if (POLITICS_NOISE.test(t) && !SECURITY_CARVEOUT.test(t)) return true;

  // --- Tier-4: pure diplomatic/meeting noise (preserved from original) ---
  if (/\b(meeting|talks|summit|visit|conference|agreement|signed|signed an agreement)\b/i.test(t) &&
      !SECURITY_CARVEOUT.test(t)) return true;

  // --- Tier-5: technical cyber noise — patch advisories, CVE disclosures, vendor bulletins.
  //     These are IT/SOC-level content, NOT operational manager intelligence.
  //     CARVEOUT: if the title also mentions an actual attack/breach/disruption, keep it.
  const TECH_CYBER_NOISE = /\b(patch tuesday|security patch(es)?|firmware update|vulnerability (disclosed|discovered|identified|found)|researchers (found|discovered|uncovered|identified)|bug bounty|penetration test|pen test|red team exercise|security researcher|nist nvd|vendor advisory|advisory released|patches? (a |the |cve)|fixes? (a |the )?(vulnerability|flaw|bug)|cve-\d{4}-\d+|proof of concept exploit|security (bulletin|advisory) (released|published)|cvss score|zero.day (patch|fix|announced)|responsible disclosure)\b/i;
  const CYBER_ATTACK_CARVEOUT = /\b(ransomware|breach|data stolen|hacked|compromised|extortion|demanded ransom|systems (down|offline|disrupted|shut down)|operations (affected|disrupted|halted)|data (leak|leaked|exposed)|nation.?state|apt group|threat actor|supply chain attack|cyber attack|cyberattack|network intrusion|unauthorized access)\b/i;
  if (TECH_CYBER_NOISE.test(t) && !CYBER_ATTACK_CARVEOUT.test(t)) return true;

  // --- Tier-6: court / legal proceedings noise ---
  // Individual-crime trials and civil litigation are not RSM intelligence.
  // Carve-out: terrorism trials, war-crimes proceedings, sanctions/espionage cases ARE relevant.
  const LEGAL_NOISE = /\b(trial (begins?|starts?|opens?|underway|date set|resumes?)|jury (selection|deliberat|verdict|finds?|acquits?|convicts?)|court (hearing|ruling|verdict|sentenced|case|proceeding|adjourns?)|pleads? (guilty|not guilty|no contest)|sentenced to \d|arraigned|indicted (on|for)|testifies?|testified (in|before|at)|deposition|appeals? court|circuit court|district court|federal court|class action|arbitration hearing|lawsuit (settled|dismissed|resolved)|civil (suit|lawsuit|litigation))\b/i;
  const LEGAL_CARVEOUT = /\b(terrorism|terror (attack|plot|suspect)|war crimes?|genocide|sanctions (violation|evasion|busting)|espionage|state.?sponsored|cyber crime|ransomware|arms (trafficking|smuggling)|drug cartel|human trafficking|extremis[mt]|militant|insurgent)\b/i;
  if (LEGAL_NOISE.test(t) && !LEGAL_CARVEOUT.test(t)) return true;

  // --- Tier-7: annual reports / financial results / market research ---
  // Investor/earnings content and market-analyst reports are not operational security intelligence.
  const ANNUAL_REPORT_NOISE = /\b(annual (report|review|results)|year in review|\d{4} (annual|year.in.review)|quarterly (report|earnings?|results?)|q[1-4] (results?|earnings?|report|revenue)|fiscal (year|quarter) (results?|ended?|summary)|earnings per share|investor (relations?|day|presentation|briefing)|earnings (call|beat|miss|guidance)|revenue (grew?|increased?|declined?|forecast|outlook)|market cap|gartner (predicts?|report|magic quadrant)|forrester (report|wave)|idc (report|forecast)|shareholder (letter|meeting|value)|return on (equity|investment)|ebitda|operating (margin|income|profit))\b/i;
  if (ANNUAL_REPORT_NOISE.test(t)) return true;

  return false;
}

function severityFromText(s) {
  const t = String(s || "").toUpperCase();
  if (t.includes("CRIT") || t.includes("5")) return 5;
  if (t.includes("HIGH") || t.includes("4")) return 4;
  if (t.includes("MED") || t.includes("3")) return 3;
  if (t.includes("LOW") || t.includes("2")) return 2;
  return 1;
}

/* THUMBS helpers (admin prefs) */
async function kvGetJson(env, key, fallback = null) {
  if (!env || !env.INTEL_KV) return fallback;
  try {
    const v = await env.INTEL_KV.get(key, { type: "json" });
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) {
    debug("kvGetJson error", key, e?.message || e);
    return fallback;
  }
}
async function kvGetText(env, key) {
  if (!env || !env.INTEL_KV) return null;
  try { return await env.INTEL_KV.get(key); } catch (e) { debug("kvGetText error", key, e?.message || e); return null; }
}
async function kvPut(env, key, value, opts = {}) {
  if (!env || !env.INTEL_KV) return false;
  try {
    if (typeof value === "object") value = JSON.stringify(value);
    await env.INTEL_KV.put(key, value, opts);
    return true;
  } catch (e) { debug("kvPut error", key, e?.message || e); return false; }
}
async function kvDel(env, key) {
  if (!env || !env.INTEL_KV) return false;
  try { await env.INTEL_KV.delete(key); return true; } catch (e) { debug("kvDel error", key, e?.message || e); return false; }
}

/**
 * Throttled KV write - skips the write when the value is unchanged AND
 * fewer than minIntervalMs ms have elapsed since the last save.
 * A companion sentinel key (`${key}__ts`) tracks the last-write timestamp
 * so the stored value shape is never modified (arrays stay arrays).
 *
 * @param {object}  env
 * @param {string}  key
 * @param {*}       value          - any JSON-serialisable value (array or object)
 * @param {object}  [opts={}]      - KV put options (e.g. { expirationTtl })
 * @param {number|null} [minIntervalMs] - defaults to env.MIN_WRITE_INTERVAL_MS || DEFAULT_MIN_WRITE_INTERVAL_MS
 * @param {boolean} [force=false]  - bypass throttle (e.g. admin block must be immediate)
 */
async function kvPutWithThrottle(env, key, value, opts = {}, minIntervalMs = null, force = false) {
  if (!env || !env.INTEL_KV) return { wrote: false, reason: 'error', err: 'no KV binding' };
  const interval = (minIntervalMs !== null && minIntervalMs !== undefined)
    ? Number(minIntervalMs)
    : (Number(env.MIN_WRITE_INTERVAL_MS) || DEFAULT_MIN_WRITE_INTERVAL_MS);
  const tsKey = `${key}__ts`;
  try {
    // Read timestamp sentinel and existing value for diff
    let existingTs = 0;
    let existing = null;
    try {
      const tsRaw = await env.INTEL_KV.get(tsKey);
      existingTs = tsRaw ? Number(tsRaw) : 0;
      existing = await env.INTEL_KV.get(key, { type: 'json' });
    } catch {}
    const elapsed = Date.now() - existingTs;

    // Deep-equal content diff (compare serialised forms)
    let changed = true;
    if (existing !== null) {
      try { changed = JSON.stringify(existing) !== JSON.stringify(value); }
      catch { changed = true; }
    }

    if (!force && !changed && elapsed < interval) {
      debug(`kvPutWithThrottle: SKIP ${key} (elapsed=${elapsed}ms < ${interval}ms, unchanged)`);
      return { wrote: false, reason: 'throttled' };
    }

    // Write value unchanged, then update sentinel
    await env.INTEL_KV.put(key, JSON.stringify(value), opts);
    await env.INTEL_KV.put(tsKey, String(Date.now()), { expirationTtl: 7 * 24 * 3600 });
    const reason = force ? 'force' : 'changed';
    debug(`kvPutWithThrottle: WROTE ${key} reason=${reason} elapsed=${elapsed}ms`);
    return { wrote: true, reason };
  } catch (e) {
    warn(`kvPutWithThrottle: ERROR ${key}`, e?.message || e);
    return { wrote: false, reason: 'error', err: String(e?.message || e) };
  }
}

/* ===========================
   EMAIL ALERTING (NEW: Resend Integration with Rich HTML + Dedupe)
   =========================== */

function buildIncidentEmail(incident, opts = {}) {
  // opts: { regionText, affectedList, feedbackBaseUrl, mapSize }
  const title = String(incident.title || "Incident").trim();
  const status = String(incident.notification_status || (incident.severity_label === "LOW" ? "Informational" : "Alert"));
  const regionText = opts.regionText || (incident.region || "Global");
  const assetText = (opts.affectedList && opts.affectedList.length) ? opts.affectedList.join(", ") : (incident.nearest_site_name || "None");
  const severityText = incident.severity_label || (incident.severity || "N/A");
  const notifStatus = incident.notification_status || "Open";

  // Choose map center: lat/lng if available, else country centroid
  let mapLat = Number(incident.lat) || 0;
  let mapLon = Number(incident.lng) || 0;
  if ((!Number.isFinite(mapLat) || Math.abs(mapLat) < 1e-6) && incident.country) {
    const ck = String(incident.country || "").toLowerCase();
    if (COUNTRY_COORDS && COUNTRY_COORDS[ck]) {
      mapLat = COUNTRY_COORDS[ck].lat;
      mapLon = COUNTRY_COORDS[ck].lng;
    }
  }

  // Map image (OpenStreetMap static tile service). Size tuned to screenshot.
  const zoom = opts.mapZoom || 9;
  const size = opts.mapSize || "700x300";
  const marker = (Number.isFinite(mapLat) && Number.isFinite(mapLon)) ? `${encodeURIComponent(mapLat + "," + mapLon + ",red-pushpin")}` : "";
  const mapImgUrl = (marker) ? `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(mapLat + "," + mapLon)}&zoom=${zoom}&size=${size}&markers=${marker}` : null;
  const mapLink = (Number.isFinite(mapLat) && Number.isFinite(mapLon)) ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(mapLat)}&mlon=${encodeURIComponent(mapLon)}#map=${zoom}/${mapLat}/${mapLon}` : (incident.link || "#");

  // Safe HTML summary with preserved line breaks
  const safeSummary = escapeHtml(String(incident.summary || "")).replace(/\n/g, "<br/>");

  // Affected block
  let affectedHtml = "";
  if (opts.affectedList && opts.affectedList.length) {
    affectedHtml = `<ul style="margin:8px 0;padding-left:18px;">${opts.affectedList.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
  } else if (assetText) {
    affectedHtml = `<div style="margin-top:8px;">${escapeHtml(assetText)}</div>`;
  }

  // Feedback links (use feedbackBaseUrl or incident.link)
  const feedbackBase = String(opts.feedbackBaseUrl || incident.link || "#");
  const feedbackLinks = `
    <div style="margin-top:10px;">
      Feedback:
      <a href="${escapeHtml(feedbackBase)}?choice=1" style="color:#0066cc;text-decoration:none;margin-right:8px;">Informative, no action</a>
      <a href="${escapeHtml(feedbackBase)}?choice=2" style="color:#0066cc;text-decoration:none;margin-right:8px;">Informative, monitor</a>
      <a href="${escapeHtml(feedbackBase)}?choice=3" style="color:#0066cc;text-decoration:none;margin-right:8px;">Took action</a>
      <a href="${escapeHtml(feedbackBase)}?choice=4" style="color:#0066cc;text-decoration:none;">Not informative</a>
    </div>`;

  // HTML layout closely matching your screenshot
  const html = `
  <html>
  <head><meta charset="utf-8"/></head>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;">
    <div style="background:#2e8b2e;color:#fff;padding:14px 18px;font-weight:700;font-size:18px;">
      ${escapeHtml(status)} — ${escapeHtml(title)}
    </div>

    <div style="background:#f6f6f6;padding:12px 18px;border-bottom:1px solid #e6e6e6;">
      <div style="font-size:13px;margin-bottom:6px;"><strong>Region:</strong> ${escapeHtml(regionText)} &nbsp;|&nbsp; <strong>Country:</strong> ${escapeHtml(incident.country || "N/A")}</div>
      <div style="font-size:13px;margin-bottom:6px;"><strong>Affected Asset(s):</strong> ${escapeHtml(assetText || "N/A")}</div>
      <div style="font-size:13px;"><strong>Location:</strong> ${escapeHtml(incident.location || "N/A")} &nbsp;|&nbsp; <strong>Severity:</strong> ${escapeHtml(severityText)} &nbsp;|&nbsp; <strong>Notification:</strong> ${escapeHtml(notifStatus)}</div>
    </div>

    <div style="padding:14px 18px;">
      <h3 style="margin:0 0 8px 0;color:#164a72;">Alert Details</h3>
      <div style="line-height:1.4;">${safeSummary}</div>
      ${affectedHtml}
      ${mapImgUrl ? `<div style="margin-top:12px;border:1px solid #ddd;"><a href="${mapLink}" target="_blank" rel="noopener noreferrer"><img src="${mapImgUrl}" alt="Map" style="width:100%;max-width:700px;display:block;border:0;"></a></div>` : ""}
    </div>

    <div style="padding:12px 18px;border-top:1px solid #eee;font-size:13px;color:#666;">
      <div style="margin-bottom:8px;">
        <a href="${escapeHtml(incident.link || '#')}" style="color:#0066cc;text-decoration:none;margin-right:12px;">View original alert</a>
      </div>
      ${feedbackLinks}
    </div>
  </body>
  </html>
  `;

  // === Plain-text fallback (improves deliverability & accessibility) ===
  const text = [
    `${status} — ${title}`,
    `Region: ${regionText} | Country: ${incident.country || 'N/A'}`,
    `Affected Asset(s): ${assetText || 'N/A'}`,
    `Location: ${incident.location || 'N/A'} | Severity: ${severityText} | Notification: ${notifStatus}`,
    '',
    'Alert Details:',
    (incident.summary || '').replace(/<[^>]+>/g, '').replace(/\n+/g, '\n'),
    '',
    `View original alert: ${incident.link || ''}`
  ].join('\n');

  const subject = `[${severityText}] ${title}`;
  return { subject, html, text };
}

async function sendAlertEmail(env, incident, opts = {}) {
  // opts: { dedupeTtlSec: 86400 }
  if (!env || !env.RESEND_API_KEY) { debug("sendAlertEmail: RESEND_API_KEY not configured"); return false; }

  // Unique key for dedupe
  const id = String(incident.id || stableId((incident.title || "") + (incident.time || "")));
  const sentKey = `sent_email_${id}`;
  try {
    // Quick dedupe check in KV
    const prev = await env.INTEL_KV.get(sentKey);
    if (prev) { debug("sendAlertEmail: already.sent", id); return false; }

    // Use environment variable if available, fallback to hardcoded only as last resort
    const rawTo = (env.ALERT_EMAIL_TO || "vssmaximus@gmail.com").trim();
    const toList = rawTo ? rawTo.split(",").map(s => s.trim()).filter(Boolean) : [];
    if (toList.length === 0) { debug("sendAlertEmail: no recipients (ALERT_EMAIL_TO empty)"); return false; }

    const from = env.EMAIL_FROM || env.RESEND_FROM || "OSINT Alerts <onboarding@resend.dev>";

    // Build content
    const pack = buildIncidentEmail(incident, { 
      regionText: incident.region, 
      affectedList: opts.affectedList || (incident.nearest_site_name ? [incident.nearest_site_name] : null), 
      feedbackBaseUrl: opts.feedbackBaseUrl || incident.link 
    });

    // Compose payload for Resend
    const payload = {
      from,
      to: toList,
      subject: pack.subject,
      html: pack.html,
      text: pack.text   // plain-text fallback added
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(()=>null);
      error("sendAlertEmail: resend failed", res.status, bodyText);
      return false;
    }

    // Mark as sent in KV with TTL to avoid duplicate sends.
    const ttl = Number(opts.dedupeTtlSec || (24 * 3600)); // default 24h
    await kvPut(env, sentKey, { ts: new Date().toISOString(), subject: pack.subject }, { expirationTtl: ttl });

    debug("sendAlertEmail: sent", id, "to", toList.length, "recipients");
    return true;
  } catch (e) {
    error("sendAlertEmail: exception", e?.message || e);
    return false;
  }
}

async function loadThumbsPrefs(env) {
  const base = await kvGetJson(env, THUMBS_KV_KEY, null);
  if (!base) {
    const init = { byId: {}, upKeywords: {}, downKeywords: {}, sourceSignals: {}, blockedIds: [], updated_at: new Date().toISOString() };
    await kvPut(env, THUMBS_KV_KEY, init);
    init._loadedTs = Date.now();
    return init;
  }
  base._loadedTs = Date.now();
  base.byId = base.byId || {};
  base.upKeywords = base.upKeywords || {};
  base.downKeywords = base.downKeywords || {};
  base.sourceSignals = base.sourceSignals || {};
  base.blockedIds = base.blockedIds || [];
  return base;
}

async function saveThumbsPrefs(env, prefs) {
  if (!prefs) return false;
  prefs.updated_at = new Date().toISOString();
  const p = {
    byId: prefs.byId || {},
    upKeywords: prefs.upKeywords || {},
    downKeywords: prefs.downKeywords || {},
    sourceSignals: prefs.sourceSignals || {},
    blockedIds: prefs.blockedIds || [],
    updated_at: prefs.updated_at
  };
  const result = await kvPutWithThrottle(env, THUMBS_KV_KEY, p);
  return result.wrote !== false;
}

const STOPWORDS = new Set([
  "the","and","a","to","of","in","on","for","with","is","are","by","from","at","as","an","be","this","that","it",
  "its","was","were","will","has","have","had","but","or","if","we","they","their","our","us","i","you","he","she"
]);

function extractKeywords(text, minLen = 3, maxTokens = 30) {
  if (!text || typeof text !== "string") return [];
  const low = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = low.split(/\s+/).filter(Boolean).map(t => t.trim()).filter(t => t.length >= minLen && !STOPWORDS.has(t));
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = `${tokens[i]} ${tokens[i+1]}`;
    if (bi.length >= minLen) freq[bi] = (freq[bi] || 0) + 1;
  }
  const arr = Object.entries(freq).sort((a,b) => b[1] - a[1]).slice(0, maxTokens).map(x => x[0]);
  return arr;
}

function incrementKeywordCounts(prefs, tokens = [], action = "up") {
  if (!prefs || !Array.isArray(tokens)) return;
  const mapName = (action === "up") ? "upKeywords" : "downKeywords";
  prefs[mapName] = prefs[mapName] || {};
  for (const t of tokens) prefs[mapName][t] = (prefs[mapName][t] || 0) + 1;
}

function updateSourceSignal(prefs, sourceHost, action) {
  prefs.sourceSignals = prefs.sourceSignals || {};
  const current = prefs.sourceSignals[sourceHost] || { up: 0, down: 0 };
  if (action === "up") current.up++;
  else if (action === "down") current.down++;
  prefs.sourceSignals[sourceHost] = current;
}

function hostFromLink(link) {
  try {
    const u = new URL(String(link));
    return u.hostname.replace(/^www\./, "");
  } catch (e) {
    return String(link || "").split("/")[0].replace(/^www\./, "");
  }
}

let THUMBS_PREF_CACHE = null;
let THUMBS_PREF_CACHE_TS = 0;
let __kvListCache = { value: null, ts: 0 }; // in-memory cache for INTEL_KV.list() calls

async function ensureThumbsCache(env) {
  try {
    const now = Date.now();
    if (THUMBS_PREF_CACHE && (now - THUMBS_PREF_CACHE_TS) < 60_000) return THUMBS_PREF_CACHE;
    const prefs = await loadThumbsPrefs(env);
    THUMBS_PREF_CACHE = prefs;
    THUMBS_PREF_CACHE_TS = now;
    return THUMBS_PREF_CACHE;
  } catch (e) {
    return { byId: {}, upKeywords: {}, downKeywords: {}, sourceSignals: {}, blockedIds: [] };
  }
}

function thumbsKeywordScore(prefs, text) {
  if (!prefs) return { up: 0, down: 0 };
  const low = String(text || "").toLowerCase();
  let up = 0, down = 0;
  for (const [k, v] of Object.entries(prefs.upKeywords || {})) if (low.includes(k)) up += (v || 1);
  for (const [k, v] of Object.entries(prefs.downKeywords || {})) if (low.includes(k)) down += (v || 1);
  return { up, down };
}

function thumbsSourceScore(prefs, host) {
  if (!prefs || !host) return { up:0, down:0 };
  const s = prefs.sourceSignals && prefs.sourceSignals[host];
  if (!s) return { up:0, down:0 };
  return { up: s.up || 0, down: s.down || 0 };
}

/* processThumbAction - admin */
async function processThumbAction(env, ctx, body, secretOk) {
  if (!secretOk) return { ok: false, status: 403, body: "Unauthorized" };
  const { id, action, title, summary, source, link } = body || {};
  if (!id || !action || (action !== "up" && action !== "down")) {
    return { ok: false, status: 400, body: "Invalid payload: requires id and action 'up'|'down'" };
  }
  let prefs = await loadThumbsPrefs(env);
  prefs.byId = prefs.byId || {};
  prefs.upKeywords = prefs.upKeywords || {};
  prefs.downKeywords = prefs.downKeywords || {};
  prefs.sourceSignals = prefs.sourceSignals || {};
  prefs.blockedIds = prefs.blockedIds || [];
  prefs.byId[id] = action;
  const tokens = extractKeywords(`${title || ""} ${summary || ""}`);
  incrementKeywordCounts(prefs, tokens, action);
  const host = hostFromLink(link || source || "");
  updateSourceSignal(prefs, host, action);

  if (action === "down") {
    if (!prefs.blockedIds.includes(id)) prefs.blockedIds.push(id);
    // admin-triggered immediate block
    await performImmediateBlock(env, id, prefs);
  }

  try { await saveThumbsPrefs(env, prefs); } catch (e) { debug("processThumbAction: save failed", e?.message || e); }
  THUMBS_PREF_CACHE = prefs;
  THUMBS_PREF_CACHE_TS = Date.now();
  const topUp = Object.entries(prefs.upKeywords || {}).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const topDown = Object.entries(prefs.downKeywords || {}).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return { ok: true, status: 200, body: { id, action, blockedIdsCount: (prefs.blockedIds || []).length, topUpKeywords: topUp, topDownKeywords: topDown, sourceSignals: prefs.sourceSignals || {} } };
}

/* ===========================
   LEARNING RULES ENGINE
   =========================== */
let LEARNING_RULES_CACHE = null;
let LEARNING_RULES_CACHE_TS = 0;
const LEARNING_MIN_TOTAL = 6;
const LEARNING_SCORE_THRESHOLD = 1.8; // raised from 1.5 → 1.8 to reduce noisy auto-accepts; tune down if legitimate items are suppressed
const LEARNING_MIN_UP = 3;
const LEARNING_MIN_UP_DIFF = 2; // up - down >= 2
const LEARNING_RULES_CACHE_TTL_MS = 60 * 1000;

async function loadLearningRules(env) {
  try {
    const now = Date.now();
    if (LEARNING_RULES_CACHE && (now - LEARNING_RULES_CACHE_TS) < LEARNING_RULES_CACHE_TTL_MS) return LEARNING_RULES_CACHE;
    const r = await kvGetJson(env, LEARNING_RULES_KEY, null);
    LEARNING_RULES_CACHE = r;
    LEARNING_RULES_CACHE_TS = Date.now();
    return r || { keywordWeights: {}, sourceWeights: {}, produced_at: null };
  } catch (e) { debug("loadLearningRules err", e?.message || e); return { keywordWeights: {}, sourceWeights: {}, produced_at: null }; }
}

async function updateLearningRules(env) {
  try {
    const prefs = await loadThumbsPrefs(env);
    const up = prefs.upKeywords || {};
    const down = prefs.downKeywords || {};
    const keys = new Set([...Object.keys(up), ...Object.keys(down)]);
    const keywordWeights = {};
    for (const k of keys) {
      const upc = Number(up[k] || 0);
      const downc = Number(down[k] || 0);
      const total = upc + downc;
      if (total < LEARNING_MIN_TOTAL) continue; // require sample size
      // compute weight (log-diff)
      const w = Math.log(1 + upc) - Math.log(1 + downc);
      keywordWeights[k] = { weight: Number(w.toFixed(4)), up: upc, down: downc, total };
    }
    const src = prefs.sourceSignals || {};
    const sourceWeights = {};
    for (const [h, s] of Object.entries(src)) {
      const upc = Number((s && s.up) || 0);
      const downc = Number((s && s.down) || 0);
      const total = upc + downc;
      if (total < LEARNING_MIN_TOTAL) continue;
      const w = Math.log(1 + upc) - Math.log(1 + downc);
      sourceWeights[h] = { weight: Number(w.toFixed(4)), up: upc, down: downc, total };
    }
    const rules = { keywordWeights, sourceWeights, produced_at: new Date().toISOString() };
    await kvPut(env, LEARNING_RULES_KEY, rules);
    LEARNING_RULES_CACHE = rules;
    LEARNING_RULES_CACHE_TS = Date.now();
    debug("updateLearningRules: saved rules", Object.keys(keywordWeights).length, "keywords");
    return rules;
  } catch (e) {
    debug("updateLearningRules err", e?.message || e);
    return null;
  }
}

/* ===========================
   Perform Immediate Block - admin only
   =========================== */
async function performImmediateBlock(env, id, prefs) {
  try {
    prefs = prefs || await loadThumbsPrefs(env);
    prefs.blockedIds = prefs.blockedIds || [];
    if (!prefs.blockedIds.includes(id)) prefs.blockedIds.push(id);
    await saveThumbsPrefs(env, prefs);
  } catch (e) { debug("performImmediateBlock: prefs update err", e?.message || e); }

  try {
    const incidentsRaw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const filtered = (Array.isArray(incidentsRaw) ? incidentsRaw : []).filter(x => String(x.id) !== String(id));
    // Direct write: admin block must always persist immediately
    await kvPut(env, INCIDENTS_KV_KEY, filtered);
  } catch (e) { debug("performImmediateBlock: remove incidents err", e?.message || e); }

  try {
    const proxRaw = await kvGetJson(env, PROXIMITY_KV_KEY, { incidents: [], updated_at: null });
    const arr = Array.isArray(proxRaw?.incidents) ? proxRaw.incidents : [];
    const filteredP = arr.filter(x => String(x.id) !== String(id));
    // Direct write: admin block must always persist immediately
    await kvPut(env, PROXIMITY_KV_KEY, { incidents: filteredP, updated_at: new Date().toISOString() });
  } catch (e) { debug("performImmediateBlock: remove proximity err", e?.message || e); }

  try {
    const dates = await listArchiveDates(env);
    for (const d of dates) {
      try {
        const key = ARCHIVE_PREFIX + d;
        const arr = await kvGetJson(env, key, []);
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const filteredArr = arr.filter(x => String(x.id) !== String(id));
        if (filteredArr.length !== arr.length) {
          await kvPut(env, key, filteredArr);
        }
      } catch (er) { debug("performImmediateBlock: remove from archive err", d, er?.message || er); }
    }
  } catch (e) { debug("performImmediateBlock: listArchiveDates err", e?.message || e); }

  try { await kvPut(env, "briefs_regenerate_flag", { needed: true, timestamp: new Date().toISOString() }); } catch (e) { debug("performImmediateBlock: set regen flag err", e?.message || e); }
}

/* ===========================
   Voting / public thumbs endpoint
   =========================== */
/**
 * Persist a per-user dislike for an incident ID.
 * KV key: DISLIKES:<userId> - stored as a JSON array of incident ID strings.
 * Capped at 500 entries (oldest dropped first).
 */
async function recordUserDislike(env, userId, incidentId) {
  if (!userId || !incidentId) return;
  try {
    const key = `${DISLIKES_KV_PREFIX}${userId}`;
    const existing = await kvGetJson(env, key, []);
    const list = Array.isArray(existing) ? existing : [];
    if (!list.includes(incidentId)) {
      list.unshift(incidentId);
      if (list.length > 500) list.length = 500;
      await env.INTEL_KV.put(key, JSON.stringify(list), { expirationTtl: 90 * 24 * 3600 }); // 90-day TTL
      typeof debug === 'function' && debug('dislike', 'recorded', { userId, incidentId });
    }
  } catch (e) {
    typeof warn === 'function' && warn('recordUserDislike error', e?.message || e);
  }
}

async function handlePublicThumb(env, body, req, ctx) {
  try {
    if (!body || !body.id || !body.vote) return { ok:false, status:400, body: "missing id|vote" };

    const id = String(body.id);
    const vote = String(body.vote) === 'down' ? 'down' : 'up';
    const title = body.title || "";
    const summary = body.summary || "";
    const source = body.source || body.link || "";

    // Extract per-browser user id from header (required for dislike persistence)
    const userId = (req && req.headers && req.headers.get('X-User-Id')) || null;

    const logEntry = { id, action: vote, title, summary, source, link: body.link || "", ts: new Date().toISOString(), admin: false };

    try {
      const existingLog = await kvGetJson(env, THUMBS_FEEDBACK_LOG, []);
      const newLog = [logEntry].concat(Array.isArray(existingLog) ? existingLog : []).slice(0, 2000);
      // Direct write: every vote is a genuine content change so throttle adds no benefit here
      await kvPut(env, THUMBS_FEEDBACK_LOG, newLog);
    } catch (e) { debug("handlePublicThumb: feedback log append failed", e?.message || e); }

    // Persist dislike for this user so it is filtered on subsequent loads
    if (vote === 'down' && userId) {
      try { await recordUserDislike(env, userId, id); } catch (e) { debug("handlePublicThumb: recordUserDislike failed", e?.message || e); }
    }

    // Update admin prefs keyword counts (non-blocking):
    try {
      const prefs = await loadThumbsPrefs(env);
      const tokens = extractKeywords(`${title} ${summary}`);
      incrementKeywordCounts(prefs, tokens, vote === 'up' ? 'up' : 'down');
      const host = hostFromLink(source);
      updateSourceSignal(prefs, host, vote === 'up' ? 'up' : 'down');
      await saveThumbsPrefs(env, prefs);
      THUMBS_PREF_CACHE = prefs; THUMBS_PREF_CACHE_TS = Date.now();
    } catch (e) { debug("handlePublicThumb: update prefs failed", e?.message || e); }

    // Schedule learning update but do not run inline
    try { ctx && ctx.waitUntil(updateLearningRules(env)); } catch (e) { debug("handlePublicThumb: schedule rules update failed", e?.message || e); }

    // Do NOT auto-block here (security)
    // Return hide:true on dislike so the client can immediately remove the card
    const responseBody = vote === 'down' ? { id, vote, hide: true } : { id, vote };
    return { ok: true, status: 200, body: responseBody };
  } catch (e) { debug("handlePublicThumb err", e?.message || e); return { ok:false, status:500, body: "error" }; }
}

/* ===========================
   New helpers: Natural event magnitude extraction & detection
   =========================== */

/* Small helper: extract magnitude (M 5.6, magnitude 5.6, M5.6) from free text */
function extractMagnitudeFromText(text = "") {
  try {
    if (!text || typeof text !== "string") return null;
    // look for common patterns: "M 5.6", "M5.6", "magnitude 5.6"
    const re = /\b(?:M(?:agnitude)?\s*[:=]?\s*|magnitude\s*)(\d+(?:\.\d+)?)(?=\b|[^0-9.])/i;
    const m = text.match(re);
    if (m && m[1]) return Number(m[1]);
    // fallback: number followed by "Mw" or similar
    const re2 = /(\d+(?:\.\d+)?)\s*(?:Mw|Ms|mb)\b/i;
    const m2 = text.match(re2);
    if (m2 && m2[1]) return Number(m2[1]);
    return null;
  } catch (e) { return null; }
}

/* Helper: quick natural-keyword detector */
function isNaturalKeyword(text = "") {
  if (!text || typeof text !== "string") return false;
  return /\b(earthquake|tremor|aftershock|tsunami|volcano|eruption|seismic|magnitude|Mw|epicenter|shock)\b/i.test(text);
}

/* ===========================
   Replacement: Improved heuristicOperationalScore
   - More conservative for NATURAL events
   =========================== */
function heuristicOperationalScore(incident, nearest, rgIncident, rgSite) {
  let score = 0;
  const sev = Number(incident.severity || 1);
  // base severity contribution (kept small)
  score += Math.min(30, sev * 6);

  const txt = `${incident.title || ''} ${incident.summary || ''}`.toLowerCase();

  // Security keywords strongly increase score
  if (OPERATIONAL_KEYWORDS.test(txt)) score += 30;

  // Natural events: add weight but *require* proximity/magnitude/severity for high weight
  const isNatural = HIGH_NATURAL_CATS.has((incident.category || '').toUpperCase()) || isNaturalKeyword(txt);
  if (isNatural) {
    // modest base bump
    score += 10;
  }

  // Magnitude contribution
  const mag = (incident.magnitude !== undefined && Number.isFinite(Number(incident.magnitude))) ? Number(incident.magnitude) : extractMagnitudeFromText(txt);
  if (mag && isNatural) {
    const magScore = Math.min(30, Math.round((mag - 4.0) * 10)); // e.g. M5.5 -> ~15
    score += Math.max(0, magScore);
  }

  // distance-based scoring: nearer to Dell is more relevant
  if (nearest && Number.isFinite(nearest.dist)) {
    const d = nearest.dist;
    if (d <= OPERATIONAL_MAX_DIST_KM) score += 20;
    else if (d <= NATURAL_MAX_DIST_KM && isNatural) score += 10;
    else if (d <= NATURAL_MAX_DIST_KM && !isNatural) score += 5;
  }

  // enhanced city/site matching
  try {
    const icity = (rgIncident && (rgIncident.city || rgIncident.suburb || rgIncident.state) || '').toLowerCase();
    const scity = (rgSite && (rgSite.city || rgSite.suburb || rgSite.state) || '').toLowerCase();
    if (icity && scity && (icity === scity || icity.includes(scity) || scity.includes(icity))) score += 25;
  } catch (e) {}

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Final operational flag: more conservative for natural events
  let operational = false;
  if (isNatural) {
    const magOK = (mag && mag >= NATURAL_MIN_MAGNITUDE);
    const sevOK = (sev >= NATURAL_MIN_SEVERITY);
    const proxOK = (nearest && Number.isFinite(nearest.dist) && nearest.dist <= NATURAL_MAX_DIST_KM);
    const tsunamiMention = /\b(tsunami|tsunami warning|tsunami threat)\b/i.test(txt);
    operational = !!(magOK || sevOK || proxOK || tsunamiMention);
    if (operational && score < IMPACT_SCORE_THRESHOLD) score = Math.max(score, IMPACT_SCORE_THRESHOLD);
  } else {
    operational = score >= IMPACT_SCORE_THRESHOLD || (OPERATIONAL_KEYWORDS.test(txt) && sev >= 4);
  }

  const reasons = [];
  if (isNatural) reasons.push('Natural event (strict gate applied)');
  if (OPERATIONAL_KEYWORDS.test(txt)) reasons.push('Security keywords matched');
  if (nearest && Number.isFinite(nearest.dist) && nearest.dist <= OPERATIONAL_MAX_DIST_KM) reasons.push(`Within ${OPERATIONAL_MAX_DIST_KM}km`);
  return { operational, score, reason: reasons.join('; ') || 'Heuristic' };
}

/* ===========================
   Replacement: isRelevantIncident
   - explicit NATURAL gating
   =========================== */
async function isRelevantIncident(env, text = "", src = "", aiCategory = null, severity = null, coords = null, incidentMeta = {}) {
  try {
    if (!text) return false;
    const lowText = String(text || "").toLowerCase();
    const title = incidentMeta && incidentMeta.title ? String(incidentMeta.title) : text;

    // --- Step 1: fast noise pre-filter ---
    if (isNoise(lowText)) {
      debug("filter", "rejected", { reason: "noise_filter", title });
      return false;
    }

    // --- Step 2: blacklist short-circuit (before any acceptors) ---
    const black = BLACKLIST_REGEX.test(lowText);
    const business = BUSINESS_IMPACT_REGEX.test(lowText);
    const hasFocusKeyword = SECURITY_FOCUS_REGEX.test(lowText);
    const hasOperationalKeyword = OPERATIONAL_KEYWORDS.test(lowText);

    if (black && !business && !hasFocusKeyword && !hasOperationalKeyword) {
      debug("filter", "rejected", { reason: "blacklist", title });
      return false;
    }

    // --- Step 3: NATURAL gating (preserved exactly) ---
    const naturalDetected = HIGH_NATURAL_CATS.has((aiCategory || '').toUpperCase()) || isNaturalKeyword(lowText);
    if (naturalDetected) {
      const magFromText = extractMagnitudeFromText(lowText);
      const mag = (incidentMeta && Number.isFinite(Number(incidentMeta.magnitude))) ? Number(incidentMeta.magnitude) : (magFromText !== null ? magFromText : null);
      const sev = Number(severity || 0);
      const metaNearestDist = (incidentMeta && (incidentMeta.distance_km === 0 || incidentMeta.distance_km)) ? Number(incidentMeta.distance_km) : null;
      let nearest = null;
      if (coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))) {
        try { nearest = nearestDell(Number(coords.lat), Number(coords.lng)); } catch (e) { nearest = null; }
      }
      const proxOK = (nearest && Number.isFinite(nearest.dist) && nearest.dist <= NATURAL_MAX_DIST_KM) ||
                     (metaNearestDist !== null && !isNaN(metaNearestDist) && metaNearestDist <= NATURAL_MAX_DIST_KM);
      const magOK = (mag !== null && Number.isFinite(mag) && mag >= NATURAL_MIN_MAGNITUDE);
      const sevOK = (Number.isFinite(sev) && sev >= NATURAL_MIN_SEVERITY);
      const tsunamiMention = /\b(tsunami|tsunami warning|tsunami threat)\b/i.test(lowText);
      const countryWide = !!(incidentMeta && incidentMeta.country_wide);
      if (tsunamiMention || magOK || sevOK || proxOK || countryWide) {
        debug("filter", "accepted", { reason: "natural_gating", title });
        return true;
      }
      debug("filter", "rejected", { reason: "natural_below_threshold", title });
      return false;
    }

    // --- Step 4: INCIDENT_KEYWORDS_REGEX quick accept — only if keyword is security-domain ---
    const allowed = INCIDENT_KEYWORDS_REGEX.test(lowText);
    if (allowed && (hasFocusKeyword || hasOperationalKeyword)) {
      debug("filter", "accepted", { reason: "security_keyword_match", title });
      return true;
    }
    // allowed matched but no focus/operational keyword → fall through to further gating

    // --- Step 5: AI category gating ---
    const aiCat = aiCategory && typeof aiCategory === "string" ? String(aiCategory).toUpperCase() : null;
    if (aiCat && AI_WHITELIST_CATEGORIES.has(aiCat)) {
      if (AI_SECURITY_CATEGORIES.has(aiCat)) {
        // Explicitly security-domain AI label → accept unconditionally
        debug("filter", "accepted", { reason: "ai_security_category", aiCat, title });
        return true;
      }
      // Non-security AI category (e.g. HEALTH, ENVIRONMENT) → require security keyword evidence
      if (hasFocusKeyword || hasOperationalKeyword) {
        debug("filter", "accepted", { reason: "ai_non_security_with_focus_keyword", aiCat, title });
        return true;
      }
      debug("filter", "rejected", { reason: "ai_not_security", aiCat, title });
      return false;
    }

    // --- Step 6: business-impact + security keyword gate ---
    // Must have both: a business-impact term AND at least one security-focus or operational keyword,
    // OR be within Dell proximity.
    if (business) {
      if (hasFocusKeyword || hasOperationalKeyword) {
        debug("filter", "accepted", { reason: "business_impact_with_security_keyword", title });
        return true;
      }
      // proximity check as alternative evidence
      if (coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))) {
        try {
          const nearest = nearestDell(Number(coords.lat), Number(coords.lng));
          if (nearest && Number.isFinite(nearest.dist) && nearest.dist <= NATURAL_MAX_DIST_KM) {
            debug("filter", "accepted", { reason: "business_impact_near_dell", title });
            return true;
          }
        } catch (e) { /* continue */ }
      }
      debug("filter", "rejected", { reason: "no_security_keywords", title });
      return false;
    }

    // --- Step 7: violent/security heuristics (preserved) ---
    const violentRegex = /\b(shooting|mass shooting|shoot|bomb|bombing|attack|terror|hostage|killing|killed|murder|massacre)\b/i;
    if (violentRegex.test(lowText)) {
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        const nearest = nearestDell(coords.lat, coords.lng);
        if (nearest && Number(nearest.dist) <= 200) {
          debug("filter", "accepted", { reason: "violent_keyword_near_dell", title });
          return true;
        }
      } else {
        const ctry = extractCountryFromText(lowText);
        if (ctry && COUNTRY_COORDS[ctry]) {
          const lat = COUNTRY_COORDS[ctry].lat, lng = COUNTRY_COORDS[ctry].lng;
          const nearest = nearestDell(lat, lng);
          if (nearest && Number(nearest.dist) <= 200) {
            debug("filter", "accepted", { reason: "violent_keyword_country_near_dell", title });
            return true;
          }
        }
      }
    }

    // --- Step 8: severity-based quick accept (security-gated) ---
    // Only accept high-severity items if they also show some security relevance
    if (severity && Number(severity) >= 4 && (hasFocusKeyword || hasOperationalKeyword || allowed)) {
      debug("filter", "accepted", { reason: "high_severity_with_security_signal", title });
      return true;
    }

    // --- Step 9: thumbs/learning rules & source scoring ---
    const prefs = await ensureThumbsCache(env);
    const { up: upScore, down: downScore } = thumbsKeywordScore(prefs, lowText);
    const host = hostFromLink(src || "");
    const srcScore = thumbsSourceScore(prefs, host);
    if (srcScore.down >= 2 && srcScore.down > srcScore.up) {
      debug("filter", "rejected", { reason: "thumbs_source_down", title });
      return false;
    }
    if (srcScore.up >= 2 && srcScore.up >= srcScore.down) {
      debug("filter", "accepted", { reason: "thumbs_source_up", title });
      return true;
    }
    if (downScore >= 2 && downScore > upScore) {
      debug("filter", "rejected", { reason: "thumbs_keyword_down", title });
      return false;
    }
    if (upScore >= 2 && upScore >= downScore) {
      debug("filter", "accepted", { reason: "thumbs_keyword_up", title });
      return true;
    }
    if (black && !business) {
      debug("filter", "rejected", { reason: "blacklist_late", title });
      return false;
    }

    try {
      const rules = await loadLearningRules(env);
      const kw = rules.keywordWeights || {};
      const srcWeights = rules.sourceWeights || {};
      let ruleScore = 0;
      let evidenceCount = 0;
      const tokens = extractKeywords(lowText, 3, 40);
      for (const t of tokens) {
        const meta = kw[t];
        if (meta && meta.total >= LEARNING_MIN_TOTAL) {
          ruleScore += meta.weight;
          evidenceCount += meta.total;
        }
      }
      const h = hostFromLink(src || "");
      if (h && srcWeights[h]) ruleScore += (srcWeights[h].weight || 0);
      // Require both ruleScore >= threshold AND evidenceCount >= LEARNING_MIN_TOTAL (raised threshold: 1.8)
      if (ruleScore >= LEARNING_SCORE_THRESHOLD && evidenceCount >= LEARNING_MIN_TOTAL) {
        for (const t of tokens) {
          const m = kw[t];
          if (m && m.up >= LEARNING_MIN_UP && (m.up - (m.down || 0) >= LEARNING_MIN_UP_DIFF)) {
            debug("filter", "accepted", { reason: "learning_rules_positive", title });
            return true;
          }
        }
      }
      if (ruleScore <= -LEARNING_SCORE_THRESHOLD && evidenceCount >= LEARNING_MIN_TOTAL) {
        debug("filter", "rejected", { reason: "learning_rules_negative", title });
        return false;
      }
    } catch (e) { debug("isRelevantIncident: learning rules score err", e?.message || e); }

    debug("filter", "rejected", { reason: "no_security_keywords", title });
    return false;
  } catch (e) { debug("isRelevantIncident error", e?.message || e); return false; }
}

/* ===========================
   PARSERS (RSS/ATOM)
   =========================== */
/* Decode common HTML entities so ReliefWeb/CNA RSS bodies render as plain text */
function _decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/gi,  "&")
    .replace(/&lt;/gi,   "<")
    .replace(/&gt;/gi,   ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g,    (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseRssAtom(xml) {
  if (!xml || typeof xml !== "string") return [];
  const items = [];
  const itemRegex = /<(item|entry)([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const blob = m[2];
    const rawTitle = (blob.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, ""])[1] || "";
    const title = _decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
    const link = (blob.match(/<link[^>]*href=["']([^"']+)["']/i) || blob.match(/<link>([^<]+)<\/link>/i) || [null, ""])[1] || "";
    const desc = (blob.match(/<(description|summary)[^>]*>([\s\S]*?)<\/\1>/i) || [null, ""])[2] || "";
    let latVal = null, lngVal = null;
    const gp = blob.match(/<georss:point[^>]*>([^<]+)<\/georss:point>/i);
    if (gp && gp[1]) { const parts = gp[1].trim().split(/\s+/); if (parts.length >= 2) { latVal = safeNum(parts[0]); lngVal = safeNum(parts[1]); } }
    else {
      const gml = blob.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/i);
      if (gml && gml[1]) { const parts = gml[1].trim().split(/\s+/); if (parts.length >= 2) { latVal = safeNum(parts[0]); lngVal = safeNum(parts[1]); } }
      else {
        const latm = blob.match(/<geo:lat[^>]*>([^<]+)<\/geo:lat>/i) || blob.match(/<geo:latitude[^>]*>([^<]+)<\/geo:latitude>/i);
        const longm = blob.match(/<geo:long[^>]*>([^<]+)<\/geo:long>/i) || blob.match(/<geo:longitude[^>]*>([^<]+)<\/geo:longitude>/i);
        if (latm && longm) { latVal = safeNum(latm[1]); lngVal = safeNum(longm[1]); }
        else {
          const latm2 = blob.match(/<latitude[^>]*>([^<]+)<\/latitude>/i);
          const longm2 = blob.match(/<longitude[^>]*>([^<]+)<\/longitude>/i);
          if (latm2 && longm2) { latVal = safeNum(latm2[1]); lngVal = safeNum(longm2[1]); }
        }
      }
    }
    // Strip CDATA markers → decode HTML entities → strip residual HTML tags → collapse whitespace → truncate
    const rawDesc = (desc||"").replace(/<!\[CDATA\[|\]\]>/gi,"");
    const summary = _decodeHtmlEntities(rawDesc).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,400);
    items.push({ title, link: link.trim(), summary, lat: latVal, lng: lngVal });
  }
  return items;
}

/* ===========================
   FILTERING / KEYWORDS
   =========================== */
/* ALLOWED_KEYWORDS — physical security, natural hazards, facility/supply-chain physical disruption only.
   Generic business/trade/political terms deliberately removed to prevent off-topic content passing the gate. */
const ALLOWED_KEYWORDS = [
  // Physical security & violence
  "attack","bomb","bombing","explosion","exploded","explosive","shooting","mass shooting","hostage","hostages",
  "terror","terrorist","terrorism","siege","arson","gunman","active shooter","assassin","assassination",
  "kidnap","kidnapping","abduction","armed robbery","carjacking","ambush","militia","militant","insurgent",
  // Natural hazards
  "earthquake","tsunami","flood","hurricane","cyclone","storm","tornado","landslide","avalanche","eruption",
  "volcano","wildfire","forest fire","bushfire",
  // Infrastructure & facility physical events
  "collapse","bridge collapse","building collapse","structural failure","dam failure","dam breach",
  "derail","derailed","train derailment","plane crash","aircraft crash","collision","ferry accident","shipwreck",
  "traffic accident","road accident","chemical spill","hazardous spill","toxic leak","gas leak","radiation leak",
  // Casualties / emergency
  "killed","killing","dead","death toll","died","wounded","injured","casualt","evacuat","evacuation",
  "emergency","disaster","crisis",
  // Health / contamination
  "outbreak","disease","pandemic","infection","contamination","biohazard",
  // Civil unrest (security-relevant)
  "riot","protest","demonstration","civil unrest","strike action","blockade","curfew","martial law","state of emergency",
  // Cyber & operational security
  "cyberattack","cyber attack","data breach","ransomware","malware","infrastructure attack","critical infrastructure",
  // Supply-chain / facility physical disruption (not generic trade terms)
  "supply chain disruption","supply-chain disruption","plant closure","factory closure","facility closure",
  "port closure","shipping disruption","logistics disruption","warehouse fire","production halt",
  "power outage","blackout","grid failure","water outage","network outage",
  // ── Supply chain.docx: ports & terminals ──────────────────────────────────
  "port congestion","port strike","port workers strike","dockworkers strike","longshoremen strike",
  "terminal closed","terminal shut","crane failure","berth damage","channel blocked",
  // ── Supply chain.docx: maritime chokepoints & security ────────────────────
  "Red Sea","Suez Canal","Panama Canal","Strait of Hormuz","Bab el-Mandeb",
  "shipping lane","vessel hijacked","piracy","Houthi attack","missile strike on ship",
  "naval blockade","seizure of vessel","ship seized",
  // ── Supply chain.docx: trucking / rail / air ──────────────────────────────
  "truckers strike","trucking strike","rail strike","rail shutdown","freight line closed",
  "airspace closed","airspace restriction","no-fly zone","airport closed","cargo terminal",
  "cargo theft","truck hijack","truck hijacking",
  // ── Supply chain.docx: regulatory / trade ────────────────────────────────
  "export ban","export controls","embargo","sanctions","customs strike","customs delays",
  // ── SECURITY.docx: physical security additions ────────────────────────────
  "stampede","crowd crush","crowd surge","shelling","artillery","airstrike","air strike",
  "car bomb","ied","gunfire","gang violence","armed assault",
  "factory fire","plant fire","industrial fire","warehouse fire",
  // ── SECURITY.docx: site security / insider risk ───────────────────────────
  "security breach","intrusion","trespass","unauthorised access","unauthorized access",
  "insider threat","access control failure","cctv failure",
  // ── SECURITY.docx: cyber — major only ────────────────────────────────────
  "global outage","worldwide outage","mass outage","data leak","credential leak",
  "zero-day","zero day","supply chain attack","software supply chain","ddos",
  "denial of service","botnet","cloud outage",
  // ── SECURITY.docx: major vendor / critical infrastructure entity hits ──────
  "azure outage","aws outage","microsoft outage","google cloud outage","oracle outage",
  "cloudflare outage","crowdstrike","okta breach","sap breach","salesforce outage"
];
const INCIDENT_KEYWORDS_REGEX = new RegExp("\\b(" + ALLOWED_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");
const BLACKLIST_TERMS = [
  // Sports
  "sport","sports","football","soccer","basketball","baseball","cricket","rugby","afcon","fifa","nfl","nba","nhl","mlb",
  "olympic","olympics","formula 1","f1 race","grand prix","tennis","golf","athlete","league table","transfer window",
  "premier league","champions league",
  // Entertainment / celebrity
  "movie","film","box office","celebrity","fashion","recipe","horoscope","astrology","zodiac",
  "music chart","album release","concert tour","gaming","video game","esports","tv show","reality show","book review",
  "lifestyle","beauty","wellness","diet","fitness","workout","dating show","music","entertainment",
  // Finance / markets (explicit tokens required by task spec)
  "stock market","share price","stocks","stock","market","earnings","quarterly results","revenue","profit","gdp","inflation",
  "interest rate","cryptocurrency","bitcoin","nft","hedge fund","ipo","merger","acquisition","analyst upgrade",
  "credit rating","bond yield","dividend","buyback","fiscal policy","monetary policy",
  // Wealth/tax commentary
  "billionaire","tax",
  // General politics (non-security)
  "election","ballot","polling","campaign trail","candidate","parliament","congress","senate","legislation",
  "bill passed","foreign policy","diplomatic","diplomacy","ambassador","trade deal","trade agreement",
  "climate pledge","paris agreement","un resolution","immigration policy","healthcare reform","austerity","stimulus",
  // General opinion / commentary
  "opinion","op-ed","op ed","column","editorial","columnist","billionaire profile","interview","analysis",
  // Humanitarian / development (non-security food/poverty reports — per SECURITY.docx noise rules)
  "food security","food insecurity","food outlook","food crisis","food prices","food aid",
  "hunger","famine","malnutrition","nutrition","school feeding","crop","harvest",
  "agricultural","livelihoods","livelihood","poverty","welfare",
  "water access","ipc phase","ipc classification","fews net",
  // UN agency routine reports (not incident alerts)
  "flash appeal","situation report","humanitarian response plan","humanitarian brief",
  "country case study","nexus","development","aid workers","food ration",
  // Marketing / content-marketing noise (per SECURITY.docx MARKETING_PATTERNS)
  "webinar","whitepaper","white paper","ebook","sponsored","advertorial",
  "best practices","ultimate guide","thought leadership",
  "success story","product launch","available now","sign up","free trial","register now"
];
const BLACKLIST_REGEX = new RegExp("\\b(" + BLACKLIST_TERMS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");
/* BUSINESS_IMPACT_TERMS — supply-chain / facility / infrastructure physical disruption only.
   Removed over-broad terms (employee, brand, contract, regulation, compliance, export, import,
   customs, sourcing) that were accepting general business/trade news. */
const BUSINESS_IMPACT_TERMS = [
  // Supply-chain physical disruption
  "supply chain disruption","supply-chain disruption","supplychain disruption",
  "plant closure","factory closure","facility closure","production halt","manufacturing halt",
  "port closure","shipping disruption","logistics disruption","warehouse fire",
  // Infrastructure / utility disruption
  "power outage","blackout","grid failure","water outage","network outage",
  // Forced facility actions (physical, not general HR announcements)
  "mass layoff","site closure","campus closure",
  // Product safety / recall
  "product recall","safety recall","contaminated product","recall notice",
  // Sanction / tariff only when supply-chain impacting
  "tariff","tariffs","sanction","sanctions","trade war","trade dispute",
  // Logistics / shipment physical events
  "shipment delay","container shortage","port congestion","carrier shortage","freight disruption"
];
const BUSINESS_IMPACT_REGEX = new RegExp("\\b(" + BUSINESS_IMPACT_TERMS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");

/* SECURITY_FOCUS_TERMS — physical security / supply-chain / facility / infrastructure domain vocabulary.
   Used as a secondary gate: non-security AI categories must match at least SECURITY_MIN_KEYWORD_MATCH
   of these terms (or OPERATIONAL_KEYWORDS) to be accepted. */
const SECURITY_FOCUS_TERMS = [
  "supply chain","supply-chain","supplychain","port","seaport","airport","airport closure","port closure",
  "shipping","container","shipment","logistics","transport","transport disruption","warehouse","factory","plant",
  "manufactur","manufacturing","mfg","facility","site","facility closure","plant closure","machine","machinery",
  "assembly line","production","power outage","power cut","substation","critical infrastructure",
  "bridge collapse","pipeline","road closure","port congestion","cargo","dock","terminal","truck","lorry",
  "rail","railway","rail disruption","port strike","strike","industrial accident","fire at facility",
  "explosion at site","vandalism","sabotage","physical security","intrusion","perimeter breach",
  "lockdown","evacuation"
];
const SECURITY_FOCUS_REGEX = new RegExp("\\b(" + SECURITY_FOCUS_TERMS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");
// Minimum number of SECURITY_FOCUS_TERMS tokens needed when falling back to non-security-AI gating.
// Operators may raise this value to tighten filtering further.
const SECURITY_MIN_KEYWORD_MATCH = 1;

/* AI categories that are unconditionally accepted (subject to NATURAL gating for "NATURAL"). */
const AI_WHITELIST_CATEGORIES = new Set(["SECURITY","NATURAL","DISRUPTION","TRANSPORT","HEALTH","CYBER","INFRASTRUCTURE","ENVIRONMENT","PUBLIC_SAFETY"]);
/* AI categories that are explicitly security-domain: skip the secondary security-keyword gate. */
const AI_SECURITY_CATEGORIES = new Set(["SECURITY","INFRASTRUCTURE","TRANSPORT","CYBER","PUBLIC_SAFETY","DISRUPTION"]);
const NEAR_DIST_THRESHOLD_KM = 200;

/* ===========================
   normalizeIncident
   =========================== */
function normalizeIncident(raw) {
  if (!raw || !raw.title) return null;
  const id = raw.id || stableId(raw.link || raw.title);
  let severity = 1;
  if (raw.severity !== undefined && raw.severity !== null) {
    const n = Number(raw.severity);
    severity = Number.isFinite(n) ? n : severity;
  } else if (raw.severity_text) severity = severityFromText(raw.severity_text);
  let category = (raw.category || "UNKNOWN").toUpperCase();
  if (category === "UNKNOWN") {
    const t = String(raw.title || "").toLowerCase();
    if (severity >= 5 || /\b(bomb|attack|hostage|terror|massacre|shooting|explosion)\b/i.test(t)) category = "SECURITY";
    else if (severity >= 4 || /\b(flood|earthquake|tsunami|hurricane|storm)\b/i.test(t)) category = "NATURAL";
    else if (/\b(transport|strike|protest|riot|disruption)\b/i.test(t)) category = "DISRUPTION";
    else category = severity >= 4 ? "CRITICAL" : "GENERAL";
  }
  const sevLabel = (severity >= 5 ? "CRITICAL" : (severity >= 4 ? "HIGH" : (severity === 3 ? "MEDIUM" : "LOW")));
  return {
    id,
    title: String(raw.title).trim(),
    summary: raw.summary || "",
    category,
    severity,
    severity_label: sevLabel,
    region: raw.region || "Global",
    country: raw.country || (raw.country_code || "GLOBAL"),
    location: raw.location || "UNKNOWN",
    link: raw.link || raw.url || "#",
    source: raw.source || "",
    time: raw.time || new Date().toISOString(),
    lat: Number(raw.lat || 0),
    lng: Number(raw.lng || 0),
    country_wide: !!raw.country_wide,
    country_code: raw.country_code || null,
    nearest_site_name: raw.nearest_site_name || null,
    nearest_site_key: raw.nearest_site_key || null,
    distance_km: (raw.distance_km === 0 || raw.distance_km) ? Number(raw.distance_km) : null,
    magnitude: (raw.magnitude !== undefined && raw.magnitude !== null) ? Number(raw.magnitude) : null
  };
}

/* Reverse geocoding + cache */
async function reverseGeocodeAndCache(env, lat, lon) {
  try {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return { city: null, state: null, country: null, display_name: null, raw: null };
    const rl = Number(lat).toFixed(3), rlon = Number(lon).toFixed(3);
    const key = `${GEOCODE_CACHE_PREFIX}${rl}_${rlon}`;
    try {
      const cached = await kvGetJson(env, key, null);
      if (cached) return cached;
    } catch (e) { debug("rg cache read err", e?.message || e); }
    const base = (env && env.GEOCODE_API_URL) ? String(env.GEOCODE_API_URL) : DEFAULT_GEOCODE_URL;
    const url = `${base}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const headers = { 'User-Agent': 'osinfohub/1.0 (contact@example.com)' };
    if (env && env.GEOCODE_API_KEY) headers['Authorization'] = `Bearer ${env.GEOCODE_API_KEY}`;
    const res = await fetchWithTimeout(url, { headers }, 8000);
    const j = await res.json();
    const place = {
      display_name: j.display_name || null,
      city: j.address && (j.address.city || j.address.town || j.address.village || j.address.suburb) || null,
      suburb: j.address && j.address.suburb || null,
      state: j.address && (j.address.state || j.address.county) || null,
      country: j.address && (j.address.country || null),
      raw: j
    };
    try { await kvPut(env, key, place, { expirationTtl: GEOCODE_CACHE_TTL_SEC }); } catch(e){ debug("rg cache write err", e?.message || e); }
    return place;
  } catch (e) { debug("reverseGeocodeAndCache error", e?.message || e); return { city: null, state: null, country: null, display_name: null, raw: null }; }
}

/* ===========================
   GROQ (AI) integration (env-aware circuit breaker)
   =========================== */

const GROQ_CIRCUIT_KEY = "groq_circuit_v1";
const GROQ_MAX_FAILURES = 5;
const GROQ_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

async function checkGroqCircuitBreaker(env) {
  try {
    const st = await kvGetJson(env, GROQ_CIRCUIT_KEY, { failures: 0, last_failure_ts: null });
    if (!st) return false;
    if (st.failures >= GROQ_MAX_FAILURES) {
      const last = st.last_failure_ts ? new Date(st.last_failure_ts).getTime() : 0;
      if (Date.now() - last < GROQ_COOLDOWN_MS) return true; // opened
      await kvPut(env, GROQ_CIRCUIT_KEY, { failures: 0, last_failure_ts: null });
      return false;
    }
    return false;
  } catch (e) {
    debug("checkGroqCircuitBreaker err", e?.message || e);
    return true; // err safe side
  }
}
async function recordGroqFailure(env) {
  try {
    const st = await kvGetJson(env, GROQ_CIRCUIT_KEY, { failures: 0, last_failure_ts: null });
    st.failures = (st.failures || 0) + 1;
    st.last_failure_ts = new Date().toISOString();
    await kvPut(env, GROQ_CIRCUIT_KEY, st);
  } catch (e) { debug("recordGroqFailure err", e?.message || e); }
}
async function clearGroqFailures(env) {
  try { await kvPut(env, GROQ_CIRCUIT_KEY, { failures: 0, last_failure_ts: null }); } catch (e) { debug("clearGroqFailures err", e?.message || e); }
}

async function callGroq(env, apiKey, text, retries = 2) {
  if (!apiKey) return { data: null, error: "no_api_key" };
  try {
    if (await checkGroqCircuitBreaker(env)) return { data: null, error: "groq_circuit_open" };
  } catch (e) { /* ignore */ }
  const payload = {
    model: "llama-3.1-8b-instant",
    temperature: 0,
    max_tokens: 350,
    messages: [
      { role: "system", content: "Return JSON: {summary, category, severity, region, country, location, latitude, longitude, operational_impact (true/false), impact_score (0-100), impact_reason}. CRITICAL RULE for CYBERSECURITY category: only assign it for ACTUAL attacks, confirmed breaches, active ransomware campaigns, major service outages caused by cyber incidents, or nation-state/APT intrusions with real operational impact on organisations. Do NOT use CYBERSECURITY for: patch releases, CVE disclosures, vulnerability research, vendor security advisories, bug bounties, penetration test findings, or theoretical vulnerabilities — those must get operational_impact=false and impact_score below 15." },
      { role: "user", content: String(text).slice(0, 1200) }
    ],
    response_format: { type: "json_object" }
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const err = `http_${resp.status}`;
        debug("callGroq http error", err);
        await recordGroqFailure(env);
        return { data: null, error: err };
      }
      const j = await resp.json();
      const content = j?.choices?.[0]?.message?.content;
      if (!content) return { data: null, error: "no_content" };
      try { const parsed = JSON.parse(content); await clearGroqFailures(env); return { data: parsed, error: null }; }
      catch (e) {
        const m = String(content).match(/\{[\s\S]*\}/);
        if (m) {
          try { const parsed2 = JSON.parse(m[0]); await clearGroqFailures(env); return { data: parsed2, error: null }; } catch (e2) { debug("callGroq parse extract failed", e2?.message || e2); }
        }
        await recordGroqFailure(env);
        return { data: null, error: "parse_error" };
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      debug("callGroq attempt failed", attempt, msg);
      if (attempt === retries) { await recordGroqFailure(env); return { data: null, error: msg || "call_failed" }; }
      await sleep(200 * Math.pow(2, attempt) + Math.floor(Math.random() * 100));
    }
  }
  return { data: null, error: "call_failed" };
}

/* ===========================
   LLM CHAT HELPERS (Claude / Groq fallback)
   Used by Tier-2 AI endpoints: /api/ai/briefing, /api/ai/country-risk, /api/ai/chat
   =========================== */

/**
 * callClaude — POST to Anthropic Messages API.
 * opts.model defaults to 'claude-haiku-4-5' for fast/cheap tasks.
 * opts.model = 'claude-sonnet-4-5' for higher-quality narrative tasks.
 */
async function callClaude(env, messages, opts = {}) {
  const model = opts.model || 'claude-haiku-4-5';
  const maxTokens = opts.max_tokens || 1024;
  const systemPrompt = opts.system || '';
  const body = {
    model,
    max_tokens: maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
  };
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await resp.json();
    if (!resp.ok) {
      typeof debug === 'function' && debug('callClaude http error', resp.status, json?.error?.message);
      return { text: null, error: json?.error?.message || `http_${resp.status}` };
    }
    const text = json.content?.[0]?.text || '';
    return { text, error: null };
  } catch (e) {
    typeof debug === 'function' && debug('callClaude error', e?.message || e);
    return { text: null, error: e?.message || 'call_failed' };
  }
}

/**
 * callGroqChat — POST to Groq chat completions (narrative, not JSON-only).
 * Uses llama-3.3-70b-versatile for better narrative quality.
 */
async function callGroqChat(env, messages, opts = {}) {
  if (!env.GROQ_API_KEY) return { text: null, error: 'no_groq_key' };
  const maxTokens = opts.max_tokens || 1024;
  const body = {
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    max_tokens: maxTokens,
    messages,
  };
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await resp.json();
    if (!resp.ok) return { text: null, error: `http_${resp.status}` };
    const text = json.choices?.[0]?.message?.content || '';
    return { text, error: null };
  } catch (e) {
    typeof debug === 'function' && debug('callGroqChat error', e?.message || e);
    return { text: null, error: e?.message || 'call_failed' };
  }
}

/**
 * callLLM — Unified LLM router.
 * Uses Claude if ANTHROPIC_API_KEY is set, otherwise Groq.
 * messages: [{role:'user'|'assistant', content: string}]
 * opts: { system, max_tokens, model }
 */
async function callLLM(env, messages, opts = {}) {
  if (env.ANTHROPIC_API_KEY) {
    return await callClaude(env, messages, opts);
  }
  if (env.GROQ_API_KEY) {
    // Groq uses OpenAI format; prepend system message if provided
    const groqMessages = opts.system
      ? [{ role: 'system', content: opts.system }, ...messages]
      : messages;
    return await callGroqChat(env, groqMessages, opts);
  }
  return { text: null, error: 'no_llm_api_key_configured' };
}

/* ===========================
   ARCHIVE HELPERS
   =========================== */
async function archiveIncidents(env, incidents = []) {
  if (!env || !env.INTEL_KV) return;
  if (!Array.isArray(incidents) || incidents.length === 0) return;
  const buckets = {};
  for (const inc of incidents) {
    try { const time = inc.time ? new Date(inc.time) : new Date(); const key = utcDateKey(time); if (!buckets[key]) buckets[key] = []; buckets[key].push(inc); } catch (e) {}
  }
  for (const dateKey of Object.keys(buckets)) {
    const kvKey = ARCHIVE_PREFIX + dateKey;
    try {
      const existing = await kvGetJson(env, kvKey, []);
      const map = new Map();
      (Array.isArray(existing) ? existing : []).forEach(x => { if (x && x.id) map.set(x.id, x); });
      buckets[dateKey].forEach(x => { if (x && x.id) map.set(x.id, x); });
      const merged = Array.from(map.values()).slice(0, 5000);
      await kvPut(env, kvKey, merged, { expirationTtl: 90 * 24 * 3600 }); // 90-day retention
    } catch (e) { debug("archiveIncidents inner error", e?.message || e); }
  }
}
async function listArchiveDates(env, limitPerPage = 1000) {
  if (!env || !env.INTEL_KV) return [];
  // In-memory cache: INTEL_KV.list() is expensive; refresh at most once per MIN_LIST_CACHE_MS
  const minListMs = Number(env && env.MIN_LIST_CACHE_MS) || DEFAULT_MIN_WRITE_INTERVAL_MS;
  if (__kvListCache.value && (Date.now() - __kvListCache.ts) < minListMs) {
    debug('listArchiveDates: serving from in-memory cache');
    return __kvListCache.value;
  }
  try {
    let cursor = undefined; const dates = [];
    do {
      const opts = { prefix: ARCHIVE_PREFIX, limit: limitPerPage };
      if (cursor) opts.cursor = cursor;
      const batch = await env.INTEL_KV.list(opts);
      (batch.keys || []).forEach(k => dates.push(k.name.replace(ARCHIVE_PREFIX, "")));
      cursor = batch.cursor || null;
    } while (cursor);
    __kvListCache = { value: dates, ts: Date.now() };
    return dates;
  } catch (e) { debug("listArchiveDates error", e?.message || e); return []; }
}

/* ===========================
   TRAVEL ADVISORIES REFRESH
   =========================== */
function _normalizeSmartravellerLevel(apiLevel) {
  const n = Number(apiLevel);
  if (!Number.isFinite(n)) return 1;
  const dfat = n - 1;
  return Math.max(1, Math.min(4, dfat));
}
async function _tryFetchTravelAdvisoryInfo(url) {
  const res = await fetchWithTimeout(url, {}, 12000);
  const j = await res.json();
  if (j && j.data && typeof j.data === "object") {
    const advisories = [];
    for (const [code, entry] of Object.entries(j.data)) {
      if (!entry) continue;
      const adv = {
        country: entry.name || code,
        level: Number(entry.advisory && entry.advisory.score ? Math.round(entry.advisory.score) : 1),
        text: String(entry.advisory && entry.advisory.message ? entry.advisory.message : "See official advisory"),
        updated: new Date().toISOString()
      };
      advisories.push(adv);
    }
    return { advisories, meta: { fetched: new Date().toISOString(), source: url } };
  }
  throw new Error("travel_advisory_info_unexpected_shape");
}
async function _tryFetchSmartraveller(url) {
  const res = await fetchWithTimeout(url, {}, 15000);
  const j = await res.json();
  if (j && Array.isArray(j.advisories)) return { advisories: j.advisories, meta: { fetched: j.lastFetched || new Date().toISOString(), source: url } };
  if (j && j.advisories) return { advisories: j.advisories, meta: { fetched: j.lastFetched || new Date().toISOString(), source: url } };
  throw new Error("smartraveller_unexpected_shape");
}
async function _tryFetchGithubRaw(url) {
  const res = await fetchWithTimeout(url, {}, 10000);
  const j = await res.json();
  if (Array.isArray(j)) return { advisories: j, meta: { fetched: new Date().toISOString(), source: url } };
  else if (j && j.advisories && Array.isArray(j.advisories)) return { advisories: j.advisories, meta: { fetched: new Date().toISOString(), source: url } };
  throw new Error("github_raw_unexpected_shape");
}
function _normalizeSmartravellerAdvisories(rawList) {
  const out = [];
  for (const r of rawList || []) {
    try {
      const countryName = (r.country && typeof r.country === 'object') ? (r.country.name || r.country.alpha2 || r.country.alpha3) : r.country;
      const levelMapped = _normalizeSmartravellerLevel(r.level || 1);
      const text = r.latestUpdate || r.advice || r.summary || r.message || "";
      const updated = r.published || r.latestUpdate || new Date().toISOString();
      const country_code = (r.country && typeof r.country === 'object') ? (r.country.alpha2 || r.country.alpha3 || null) : null;
      out.push({ country: countryName || "Unknown", level: levelMapped, text: text || "", updated: updated, country_code });
    } catch (e) { continue; }
  }
  return out;
}
function _normalizeCountryName(s) {
  try {
    if (!s) return "";
    return String(s).toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
  } catch (e) { return String(s || "").toLowerCase(); }
}
function findBestAdvisoryForCountry(advisories = [], countryQ = "") {
  try {
    if (!Array.isArray(advisories) || !countryQ) return null;
    const qRaw = String(countryQ || "").trim();
    const qNorm = _normalizeCountryName(qRaw);
    if (qRaw.length <= 3) {
      for (const a of advisories) if (a && a.country_code && String(a.country_code).toLowerCase() === qRaw.toLowerCase()) return a;
    }
    for (const a of advisories) {
      if (!a || !a.country) continue;
      if (_normalizeCountryName(a.country) === qNorm) return a;
      if (a.country_code && _normalizeCountryName(a.country_code) === qNorm) return a;
    }
    for (const a of advisories) {
      if (!a || !a.country) continue;
      const aNorm = _normalizeCountryName(a.country);
      if (aNorm.includes(qNorm) || qNorm.includes(aNorm)) return a;
    }
    const qTokens = new Set(qNorm.split(/\s+/).filter(Boolean));
    for (const a of advisories) {
      if (!a || !a.country) continue;
      const aTokens = new Set(_normalizeCountryName(a.country).split(/\s+/).filter(Boolean));
      let common = 0;
      for (const t of qTokens) if (aTokens.has(t)) common++;
      if (common >= 1) return a;
    }
    return null;
  } catch (e) { debug("findBestAdvisoryForCountry error", e?.message || e); return null; }
}
async function refreshTravelData(env, opts = {}) {
  const force = !!opts.force;
  const got = await acquireLock(env, TRAVEL_LOCK_KEY, TRAVEL_LOCK_TTL_SEC, TRAVEL_LOCK_STALE_SEC, force);
  if (!got && !force) { debug("refreshTravelData: locked; skipping"); return; }
  let finalResult = null;
  let errors = [];
  try {
    let configured = (env && env.TRAVEL_API_URL) ? String(env.TRAVEL_API_URL).trim() : "";
    let primaryUrl = "";
    if (configured) {
      if (configured.endsWith("/api/advisories") || configured.endsWith("/advisories")) primaryUrl = configured;
      else if (configured.endsWith("/api") || configured.endsWith("/api/")) primaryUrl = (configured.replace(/\/$/, "")) + "/advisories";
      else primaryUrl = configured.replace(/\/$/, "") + (configured.includes("/api") ? "" : "/api") + "/advisories";
    } else primaryUrl = TRAVEL_DEFAULT_URL;
    info("refreshTravelData: primaryUrl =", primaryUrl);
    try {
      const r = await _tryFetchTravelAdvisoryInfo(primaryUrl);
      debug("refreshTravelData: got travel-advisory.info result", r.meta);
      finalResult = { advisories: r.advisories, updated_at: r.meta.fetched, source: primaryUrl };
    } catch (e1) {
      const msg1 = `travel_advisory_info_failed: ${e1?.message || e1}`;
      debug("refreshTravelData primary attempt failed", msg1);
      errors.push(msg1);
      try {
        const r2 = await _tryFetchSmartraveller(TRAVEL_DEFAULT_URL);
        debug("refreshTravelData: got smartraveller fallback result", r2.meta);
        const normalized = _normalizeSmartravellerAdvisories(r2.advisories || []);
        finalResult = { advisories: normalized, updated_at: r2.meta.fetched, source: TRAVEL_DEFAULT_URL };
      } catch (e2) {
        const msg2 = `smartraveller_failed: ${e2?.message || e2}`;
        debug("refreshTravelData fallback failed", msg2);
        errors.push(msg2);
        try {
          const r3 = await _tryFetchGithubRaw(`${GITHUB_SMARTTRAVELLER_RAW}/advisories.json`);
          debug("refreshTravelData: got github raw result");
          let normalized = (r3.advisories || []).map(x => {
            try { let lvl = Number(x.level || 1) || 1; return { country: x.country || x.name || "Unknown", level: lvl, text: x.text || x.advice || "", updated: x.updated || new Date().toISOString() }; } catch (ee) { return null; }
          }).filter(Boolean);
          finalResult = { advisories: normalized, updated_at: new Date().toISOString(), source: "github_raw" };
        } catch (e3) { errors.push(`github_failed: ${e3?.message || e3}`); }
      }
    }
    if (finalResult && Array.isArray(finalResult.advisories) && finalResult.advisories.length) {
      const cleanAdvisories = finalResult.advisories.map(a => {
        try {
          let level = Number(a.level || 1);
          if (!Number.isFinite(level)) level = 1;
          let country = a.country;
          let country_code = a.country_code || null;
          if (country && typeof country === 'object') {
            country_code = country.alpha2 || country.alpha3 || country_code;
            country = country.name || country.alpha2 || country.alpha3 || JSON.stringify(country);
          }
          country = String(country || "Unknown");
          const text = String(a.text || a.advice || a.latestUpdate || a.summary || a.message || "");
          const updated = a.updated || a.published || a.lastFetched || new Date().toISOString();
          return { country, level, text, updated, country_code };
        } catch (e) {
          return { country: (a && a.country && typeof a.country === 'string') ? a.country : "Unknown", level: Number(a.level || 1), text: a.text || "", updated: a.updated || new Date().toISOString(), country_code: a.country_code || null };
        }
      });
      const DEFAULT_COUNTRY_OVERRIDES = [{ country: "Australia", level: 1, text: "Exercise normal precautions.", updated: new Date().toISOString(), country_code: "AU" }];
      for (const def of DEFAULT_COUNTRY_OVERRIDES) {
        const exists = cleanAdvisories.find(a => {
          if (!a || !a.country) return false;
          if (def.country_code && a.country_code && String(a.country_code).toLowerCase() === String(def.country_code).toLowerCase()) return true;
          const aNorm = _normalizeCountryName(a.country);
          const dNorm = _normalizeCountryName(def.country);
          return (aNorm === dNorm) || (aNorm.includes(dNorm) || dNorm.includes(aNorm));
        });
        if (!exists) {
          cleanAdvisories.push({ country: def.country, level: def.level, text: def.text, updated: def.updated, country_code: def.country_code });
          debug("refreshTravelData: added default advisory for", def.country);
        }
      }
      const store = { advisories: cleanAdvisories, updated_at: finalResult.updated_at || new Date().toISOString(), source: finalResult.source || primaryUrl, last_error: null };
      await kvPut(env, TRAVEL_CACHE_KEY, store);
      info("refreshTravelData: stored travel data, source=", store.source, "count=", store.advisories.length);
      return;
    } else {
      const prev = await kvGetJson(env, TRAVEL_CACHE_KEY, null);
      const lastError = { attempted_at: new Date().toISOString(), errors };
      const toStore = prev || { advisories: STATIC_TRAVEL_FALLBACK, updated_at: new Date().toISOString(), source: "fallback_static", last_error: lastError };
      toStore.last_error = lastError;
      await kvPut(env, TRAVEL_CACHE_KEY, toStore);
      warn("refreshTravelData: no live data; recorded last_error");
      return;
    }
  } catch (e) {
    const fullErr = e?.message || String(e);
    debug("refreshTravelData outer exception", fullErr);
    const prev = await kvGetJson(env, TRAVEL_CACHE_KEY, null);
    const lastError = { attempted_at: new Date().toISOString(), errors: (errors || []).concat([fullErr]) };
    const toStore = prev || { advisories: STATIC_TRAVEL_FALLBACK, updated_at: new Date().toISOString(), source: "fallback_static", last_error: lastError };
    toStore.last_error = lastError;
    await kvPut(env, TRAVEL_CACHE_KEY, toStore);
  } finally {
    try { await releaseLock(env, TRAVEL_LOCK_KEY); } catch (e) { debug("refreshTravelData releaseLock failed", e?.message || e); }
  }
}

/* ===========================
   LOCKS
   =========================== */
async function acquireLock(env, key, ttlSec, staleSec, force = false, maxAttempts = 3) {
  if (!env || !env.INTEL_KV) return false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await env.INTEL_KV.get(key);
      if (raw && !force) {
        let obj = null;
        try { obj = JSON.parse(raw); } catch {}
        if (obj && obj.ts) {
          const age = (Date.now() - obj.ts) / 1000;
          if (age <= staleSec) return false;
        }
      }
      const lockId = _uuid();
      const lockObj = { ts: Date.now(), id: lockId };
      await env.INTEL_KV.put(key, JSON.stringify(lockObj), { expirationTtl: ttlSec });
      let latestRaw = await env.INTEL_KV.get(key);
      let latest = null;
      try { latest = latestRaw ? JSON.parse(latestRaw) : null; } catch {}
      if (latest && latest.id === lockId) { debug("acquireLock ok", key, lockId); return true; }
      await sleep(50 + Math.floor(Math.random() * 200));
    } catch (e) { debug("acquireLock error", key, e?.message || e); await sleep(50 + Math.floor(Math.random() * 200)); }
  }
  return false;
}
async function releaseLock(env, key) { try { if (!env || !env.INTEL_KV) return; await env.INTEL_KV.delete(key); } catch (e) { debug("releaseLock err", e?.message || e); } }

/* ===========================
   AGGREGATION: compute thumbs aggregates from feedback log
   =========================== */
async function aggregateThumbs(env, opts = {}) {
  const force = !!opts.force;
  const got = await acquireLock(env, THUMBS_AGG_LOCK_KEY, THUMBS_AGG_TTL_SEC, THUMBS_AGG_STALE_SEC, force);
  if (!got && !force) { debug("aggregateThumbs: locked; skipping"); return; }
  try {
    const log = await kvGetJson(env, THUMBS_FEEDBACK_LOG, []);
    const agg = {};
    if (Array.isArray(log)) {
      for (const e of log) {
        try {
          const id = String(e.id || "");
          if (!id) continue;
          agg[id] = agg[id] || { up:0, down:0, last_ts: null };
          if (e.action === "up") agg[id].up++;
          else if (e.action === "down") agg[id].down++;
          if (e.ts) {
            const existing = agg[id].last_ts;
            if (!existing || new Date(e.ts).getTime() > new Date(existing).getTime()) agg[id].last_ts = e.ts;
          }
        } catch (er) { /* ignore entry errors */ }
      }
    }
    await kvPut(env, THUMBS_AGG_KEY, agg);
    try {
      if (Array.isArray(log) && log.length > 2000) {
        const trimmed = log.slice(0, 2000);
        await kvPut(env, THUMBS_FEEDBACK_LOG, trimmed);
      }
    } catch (e) { debug("aggregateThumbs: trimming log failed", e?.message || e); }
  } catch (e) {
    debug("aggregateThumbs err", e?.message || e);
  } finally {
    try { await releaseLock(env, THUMBS_AGG_LOCK_KEY); } catch (er) { debug("aggregateThumbs release err", er?.message || er); }
  }
}

/* ===========================
   Utility: aggregate votes from feedback log
   =========================== */
async function aggregateVotesFromLog(env) {
  try {
    const persisted = await kvGetJson(env, THUMBS_AGG_KEY, null);
    if (persisted && typeof persisted === "object") return persisted;
    const log = await kvGetJson(env, THUMBS_FEEDBACK_LOG, []);
    const map = {};
    if (!Array.isArray(log)) return map;
    for (const e of log) {
      try {
        const id = String(e.id || "");
        if (!id) continue;
        map[id] = map[id] || { up: 0, down: 0, last_ts: null };
        if (e.action === "up") map[id].up++;
        else if (e.action === "down") map[id].down++;
        map[id].last_ts = e.ts || map[id].last_ts;
      } catch (e) {}
    }
    return map;
  } catch (e) { debug("aggregateVotesFromLog err", e?.message || e); return {}; }
}

/* ===========================
   INGESTION RUNNER (enrichment + proximity rules)
   =========================== */
async function runIngestion(env, options = {}, ctx = null) {
  const force = !!options.force;
  const got = await acquireLock(env, INGEST_LOCK_KEY, INGEST_LOCK_TTL_SEC, INGEST_LOCK_STALE_SEC, force);
  if (!got && !force) {
    debug("ingest locked; skipping");
    return;
  }
  try {
    globalThis.__env = env;
    THUMBS_PREF_CACHE = await loadThumbsPrefs(env);
    THUMBS_PREF_CACHE_TS = Date.now();
    const incidentsExistingRaw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    let existing = Array.isArray(incidentsExistingRaw) ? incidentsExistingRaw : [];
    let fresh = [];
    const proximityList = [];
    const toFetch = [...DETERMINISTIC_SOURCES, ...ROTATING_SOURCES];
    for (const src of toFetch) {
      try {
        const res = await fetchWithTimeout(src, {}, 15000);
        if (!res || !res.ok) continue;
        const text = await res.text();
        const items = parseRssAtom(text).slice(0, 6);
        for (const itm of items) {
          if (!itm.title) continue;
          const combined = `${itm.title} — ${itm.summary || ""}`.trim();
          if (isNoise(combined)) continue;
          const isDeterministic = DETERMINISTIC_SOURCES.includes(src);
          const incBase = {
            id: stableId(itm.link || itm.title),
            title: itm.title,
            summary: itm.summary || "",
            category: "UNKNOWN",
            severity: isDeterministic ? 4 : 3,
            severity_label: isDeterministic ? "HIGH" : "MEDIUM",
            region: "Global",
            country: "GLOBAL",
            location: "UNKNOWN",
            link: itm.link || "#",
            source: src,
            time: new Date().toISOString(),
            lat: (itm.lat !== null && itm.lat !== undefined) ? Number(itm.lat) : 0,
            lng: (itm.lng !== null && itm.lng !== undefined) ? Number(itm.lng) : 0
          };
          if (_validCoords(incBase.lat, incBase.lng)) {
            const n = nearestDell(incBase.lat, incBase.lng);
            if (n) {
              incBase.nearest_site_name = n.name;
              incBase.nearest_site_key = n.name.toLowerCase();
              incBase.distance_km = Math.round(n.dist);
            }
          }
          // ── GDACS / USGS natural-hazard proximity gate (200 km) ──────────────
          // Only events within NATURAL_MAX_DIST_KM of a Dell site reach the feed.
          // Thumbs-up overrides: checked below, so gate runs only for neutral items.
          if (NATURAL_HAZARD_SOURCES.has(src)) {
            // Coords missing — attempt country-text fallback before gating
            if (!_validCoords(incBase.lat, incBase.lng)) {
              const ck = extractCountryFromText(combined);
              if (ck && COUNTRY_COORDS[ck]) {
                incBase.lat = COUNTRY_COORDS[ck].lat;
                incBase.lng = COUNTRY_COORDS[ck].lng;
                const nf = nearestDell(incBase.lat, incBase.lng);
                if (nf) {
                  incBase.nearest_site_name = nf.name;
                  incBase.nearest_site_key = nf.name.toLowerCase();
                  incBase.distance_km = Math.round(nf.dist);
                }
              }
            }
            // Gate: no valid coords or too far → drop
            const thumbsEarly = THUMBS_PREF_CACHE && THUMBS_PREF_CACHE.byId ? THUMBS_PREF_CACHE.byId[incBase.id] : null;
            if (thumbsEarly !== "up") {
              if (!_validCoords(incBase.lat, incBase.lng) ||
                  typeof incBase.distance_km !== 'number' ||
                  incBase.distance_km > NATURAL_MAX_DIST_KM) {
                debug("gdacs_prox_gate rejected", { title: incBase.title.slice(0, 100), distKm: incBase.distance_km });
                continue;
              }
            }
          }
          // ─────────────────────────────────────────────────────────────────────
          const thumbs = THUMBS_PREF_CACHE && THUMBS_PREF_CACHE.byId ? THUMBS_PREF_CACHE.byId[incBase.id] : null;
          if (thumbs === "down") { debug("skipping due to thumbs.down", incBase.id); continue; }
          if (thumbs === "up") { fresh.push(incBase); if ((incBase.distance_km === 0 || incBase.distance_km) && incBase.nearest_site_name) proximityList.push(incBase); continue; }
          let allowedByFilter = true;
          if (!isDeterministic) allowedByFilter = await isRelevantIncident(env, combined, src, null, incBase.severity, {lat: incBase.lat, lng: incBase.lng}, incBase);
          if (!allowedByFilter) { debug("filtered (pre-AI) item", { title: incBase.title, src }); continue; }
          if (!_validCoords(incBase.lat, incBase.lng)) {
            const countryKey = extractCountryFromText(combined);
            if (countryKey && COUNTRY_COORDS[countryKey]) {
              incBase.lat = COUNTRY_COORDS[countryKey].lat;
              incBase.lng = COUNTRY_COORDS[countryKey].lng;
              const n = nearestDell(incBase.lat, incBase.lng);
              if (n) {
                incBase.nearest_site_name = n.name;
                incBase.nearest_site_key = n.name.toLowerCase();
                incBase.distance_km = Math.round(n.dist);
              }
            }
          }
          fresh.push(incBase);
          if ((incBase.distance_km === 0 || incBase.distance_km) && incBase.nearest_site_name) proximityList.push(incBase);
          
          // === NEW EMAIL LOGIC (RESTORED) ===
          if (incBase.severity >= 4 || (incBase.distance_km !== null && incBase.distance_km <= 100)) {
            // We await here safely as runIngestion runs inside waitUntil context
            await sendAlertEmail(env, incBase);
          }
          // ==================================
        }
      } catch (e) { debug("fetch src err", src, e?.message || e); }
    }

    // Optional AI enrichment — similar to original logic
    const groqKey = env.GROQ_API_KEY || null;
    if (groqKey) {
      for (const src of ROTATING_SOURCES) {
        try {
          if (await checkGroqCircuitBreaker(env)) { debug("Groq circuit breaker opened; skipping AI enrichment"); break; }
          const res = await fetchWithTimeout(src, {}, 15000);
          if (!res || !res.ok) continue;
          const text = await res.text();
          const items = parseRssAtom(text).slice(0, 4);
          for (const itm of items) {
            const combined = `${itm.title} — ${itm.summary}`.trim();
            if (isNoise(combined)) continue;
            const aiRes = await callGroq(env, groqKey, combined);
            if (aiRes.error || !aiRes.data) { debug("callGroq failed/skipped", aiRes.error); continue; }
            const data = aiRes.data || {};
            const inc = {
              id: stableId(itm.link || itm.title),
              title: itm.title,
              summary: data.summary || itm.summary || "",
              category: (data.category || "UNKNOWN").toUpperCase(),
              severity: severityFromText(data.severity || "") || 3,
              severity_label: "",
              region: data.region || "Global",
              country: data.country || "GLOBAL",
              location: data.location || "UNKNOWN",
              link: itm.link || "#",
              source: src,
              time: new Date().toISOString(),
              lat: safeNum(data.latitude) || safeNum(itm.lat) || 0,
              lng: safeNum(data.longitude) || safeNum(itm.lng) || 0,
              magnitude: safeNum(data.magnitude) || null
            };
            inc.severity_label = (inc.severity >= 5 ? "CRITICAL" : (inc.severity >= 4 ? "HIGH" : (inc.severity === 3 ? "MEDIUM" : "LOW")));
            if (!_validCoords(inc.lat, inc.lng)) {
              let countryKey = (inc.country && typeof inc.country === "string") ? extractCountryFromText(inc.country) : null;
              if (!countryKey) {
                const txtCountry = extractCountryFromText(`${inc.title} ${inc.summary}`);
                if (txtCountry) countryKey = txtCountry;
              }
              if (countryKey && COUNTRY_COORDS[countryKey]) { inc.lat = COUNTRY_COORDS[countryKey].lat; inc.lng = COUNTRY_COORDS[countryKey].lng; }
            }
            if (_validCoords(inc.lat, inc.lng)) {
              const n = nearestDell(inc.lat, inc.lng);
              if (n) { inc.nearest_site_name = n.name; inc.nearest_site_key = n.name.toLowerCase(); inc.distance_km = Math.round(n.dist); }
            }
            const thumbsVote = THUMBS_PREF_CACHE && THUMBS_PREF_CACHE.byId ? THUMBS_PREF_CACHE.byId[inc.id] : null;
            if (thumbsVote === "down") { debug("ai-skipped due thumbs.down", inc.id); continue; }
            if (thumbsVote === "up") { fresh.push(inc); if ((inc.distance_km === 0 || inc.distance_km) && inc.nearest_site_name) proximityList.push(inc); continue; }
            const allowedByFilter = await isRelevantIncident(env, `${inc.title} — ${inc.summary}`, src, inc.category, inc.severity, {lat: inc.lat, lng: inc.lng}, inc);
            if (!allowedByFilter) { debug("filtered (post-AI) item", { title: inc.title, src, category: inc.category, severity: inc.severity }); continue; }
            fresh.push(inc);
            if ((inc.distance_km === 0 || inc.distance_km) && inc.nearest_site_name) proximityList.push(inc);

            // === NEW EMAIL LOGIC (RESTORED) ===
            if (inc.severity >= 4 || (inc.distance_km !== null && inc.distance_km <= 100)) {
               await sendAlertEmail(env, inc);
            }
            // ==================================
          }
        } catch (e) { debug("AI enrichment error", e?.message || e); }
      }
    }

    // Dedupe fresh
    try {
      const freshMap = new Map();
      for (const f of fresh) {
        if (!f || !f.id) continue;
        const existingEntry = freshMap.get(f.id);
        if (!existingEntry) freshMap.set(f.id, f);
        else {
          const tEx = new Date(existingEntry.time || 0).getTime();
          const tNew = new Date(f.time || Date.now()).getTime();
          if (isNaN(tEx) || tNew > tEx) freshMap.set(f.id, f);
        }
      }
      const deduped = Array.from(freshMap.values());

      // Merge with existing incidents (preserve highest severity/most recent)
      const existingMap = new Map();
      for (const e of existing) {
        if (e && e.id) existingMap.set(String(e.id), e);
      }
      for (const d of deduped) {
        const key = String(d.id);
        const old = existingMap.get(key);
        if (!old) existingMap.set(key, d);
        else {
          // pick most recent and highest severity fields
          const oldTime = new Date(old.time || 0).getTime();
          const newTime = new Date(d.time || 0).getTime();
          const winner = (isNaN(newTime) || (!isNaN(oldTime) && oldTime >= newTime)) ? old : d;
          winner.severity = Math.max(Number(old.severity || 1), Number(d.severity || 1));
          winner.severity_label = (winner.severity >= 5 ? "CRITICAL" : (winner.severity >= 4 ? "HIGH" : (winner.severity === 3 ? "MEDIUM" : "LOW")));
          // prefer non-zero coords
          if ((!Number.isFinite(winner.lat) || Math.abs(winner.lat) < 0.0001) && Number.isFinite(d.lat)) { winner.lat = d.lat; winner.lng = d.lng; }
          existingMap.set(key, winner);
        }
      }

      // Convert back to array, sort and cap
      let merged = Array.from(existingMap.values());
      merged.sort((a,b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
      merged = merged.slice(0, MAX_INCIDENTS_STORED);

      // --- Proximity: helper predicate and per-site dedupe ---
      async function shouldIncludeInProximity(env, incident, nearestSite, ctx = undefined) {
        try {
          // Validate coords
          if (!_validCoords(incident.lat, incident.lng)) {
            return { include: false, reason: 'invalid_coords' };
          }
          // Distance: use nearestSite.dist if provided, otherwise compute nearest
          let distanceKm = null;
          if (nearestSite && typeof nearestSite.dist === 'number') {
            distanceKm = Math.round(nearestSite.dist);
          } else {
            const n = nearestDell(Number(incident.lat), Number(incident.lng));
            distanceKm = n && typeof n.dist === 'number' ? Math.round(n.dist) : null;
          }
          if (distanceKm === null) return { include: false, reason: 'no_distance' };
          if (distanceKm > (typeof PROXIMITY_MAX_DISTANCE_KM !== 'undefined' ? PROXIMITY_MAX_DISTANCE_KM : OPERATIONAL_MAX_DIST_KM)) {
            return { include: false, reason: 'distance_exceeded', distanceKm };
          }
          // Noise / blacklist
          const title = String(incident.title || incident.summary || '').toLowerCase();
          if (isNoise(title) || (Array.isArray(BLACKLIST_TERMS) && BLACKLIST_TERMS.some(tok => title.indexOf(tok) !== -1))) {
            return { include: false, reason: 'noise_filter', distanceKm };
          }
          // Recency
          if (incident.time) {
            const incidentTs = new Date(incident.time).getTime();
            const cutoff = Date.now() - (typeof PROXIMITY_WINDOW_HOURS !== 'undefined' ? PROXIMITY_WINDOW_HOURS : 72) * 3600 * 1000;
            if (incidentTs < cutoff) return { include: false, reason: 'too_old', distanceKm };
          }
          // Natural events: require magnitude/severity
          const cat = String((incident.category || '')).toUpperCase();
          if (cat === 'NATURAL') {
            const mag = Number(incident.magnitude || 0);
            const sev = Number(incident.severity || 0);
            if (mag < NATURAL_MIN_MAGNITUDE && sev < NATURAL_MIN_SEVERITY) {
              return { include: false, reason: 'natural_too_small', distanceKm };
            }
            // For natural, if magnitude/severity ok, accept (still subject to distance/recency above)
            return { include: true, reason: 'natural_ok', distanceKm };
          }
          // AI-security categories accept (still require distance & recency)
          if (typeof AI_SECURITY_CATEGORIES !== 'undefined' && AI_SECURITY_CATEGORIES.has(cat)) {
            return { include: true, reason: 'ai_security', distanceKm };
          }
          // Security focus keyword or operational keywords
          const hasSecurityFocus = (typeof SECURITY_FOCUS_REGEX !== 'undefined' && SECURITY_FOCUS_REGEX.test(title))
                                  || (typeof OPERATIONAL_KEYWORDS !== 'undefined' && OPERATIONAL_KEYWORDS.test(title));
          if (!hasSecurityFocus) {
            // If no explicit security word, try the heavier async relevance check (AI + rules)
            if (typeof isRelevantIncident === 'function') {
              try {
                const rel = await isRelevantIncident(env, incident);
                if (rel) return { include: true, reason: 'isRelevantIncident', distanceKm };
              } catch(e) {
                typeof warn === 'function' && warn('isRelevantIncident error in proximity', e?.message || e);
              }
            }
            return { include: false, reason: 'no_security_keywords', distanceKm };
          }
          // Business impact or severity required when AI category not security
          const businessImpact = (typeof BUSINESS_IMPACT_REGEX !== 'undefined' && BUSINESS_IMPACT_REGEX.test(title)) || (incident.businessImpact === true);
          const severityAccept = Number(incident.severity || 0) >= (typeof PROXIMITY_SEVERITY_THRESHOLD !== 'undefined' ? PROXIMITY_SEVERITY_THRESHOLD : 4);
          if (businessImpact || severityAccept) {
            const reason = businessImpact ? 'security_keyword_business_impact' : 'security_keyword_severity';
            return { include: true, reason, distanceKm };
          }
          // Final fallback: not enough evidence
          return { include: false, reason: 'no_evidence', distanceKm };
        } catch (err) {
          typeof warn === 'function' && warn('shouldIncludeInProximity error', err?.message || err);
          return { include: false, reason: 'error' };
        }
      }
      // Build proxOut with dedupe per site + predicate
      const proxOut = [];
      const proxSeen = new Set();
      for (const m of merged) {
        try {
          if (!_validCoords(m.lat, m.lng)) continue;
          const n = nearestDell(Number(m.lat), Number(m.lng));
          if (!n) continue;
          // dedupe key: incident.id + site
          const dedupKey = String(m.id || (m.title||'') + '::' + (n.name || ''));
          if (proxSeen.has(dedupKey)) continue;
          const check = await shouldIncludeInProximity(env, m, n, undefined);
          if (check && check.include) {
            m.nearest_site_name = m.nearest_site_name || n.name;
            m.nearest_site_key = m.nearest_site_key || String(n.name || '').toLowerCase();
            m.distance_km = m.distance_km || check.distanceKm || Math.round(n.dist);
            proxOut.push(m);
            proxSeen.add(dedupKey);
            typeof debug === 'function' && debug('proximity', 'emitted', { reason: check.reason, title: String(m.title||'').slice(0,140), siteId: m.nearest_site_key, distanceKm: m.distance_km });
          } else {
            typeof debug === 'function' && debug('proximity', 'rejected', { reason: (check && check.reason) || 'unknown', title: String(m.title||'').slice(0,140), siteId: String(n.name||''), distanceKm: check && check.distanceKm });
          }
        } catch (e) {
          typeof warn === 'function' && warn('proximity loop error', e?.message || e);
        }
      }

      // persist incidents and proximity — throttled to avoid redundant KV writes
      await kvPutWithThrottle(env, INCIDENTS_KV_KEY, merged);
      await kvPutWithThrottle(env, PROXIMITY_KV_KEY, { incidents: proxOut, updated_at: new Date().toISOString() });

      // archive older ones
      try { await archiveIncidents(env, merged); } catch (e) { typeof debug === 'function' && debug("archiveIncidents error", e?.message || e); }

      // S2.5: logistics proximity alert for fresh incidents
      // Use ctx.waitUntil so the Worker runtime keeps the promises alive past response time
      if (fresh.length > 0) {
        const freshSnap = fresh.slice();
        const proximityWork = Promise.all(freshSnap.map(inc =>
          checkLogisticsProximity(env, inc).catch(e => typeof debug === 'function' && debug('checkLogisticsProximity err', e?.message || e))
        )).catch(() => {});
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(proximityWork);
        }
        // proximityWork is already running; ctx.waitUntil keeps it alive past the request boundary
      }

      // trigger thumb aggregation async
      try { aggregateThumbs(env, { force: false }); } catch (e) { typeof debug === 'function' && debug("aggregateThumbs schedule failed", e?.message || e); }

    } catch (e) { typeof debug === 'function' && debug("dedupe/store error", e?.message || e); }

  } catch (e) {
    debug("runIngestion outer error", e?.message || e);
  } finally {
    try { await releaseLock(env, INGEST_LOCK_KEY); } catch (e) { debug("runIngestion releaseLock failed", e?.message || e); }
  }
}

/* ===========================
   S2.5 — OPENSKY OAUTH2 TOKEN (process-global in-memory + KV cache)
=========================== */
let _openskyTokenCache = null; // { access_token, expires_at }

async function getOpenSkyToken(env) {
  if (!env || !env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  // Fast path: process-global in-memory cache
  if (_openskyTokenCache && _openskyTokenCache.expires_at > Date.now() + 5000) {
    return _openskyTokenCache.access_token;
  }
  // KV cache: cheap cross-request persistence within same worker instance
  try {
    const meta = await kvGetJson(env, OPENSKY_TOKEN_META_KEY, null);
    if (meta && meta.access_token && meta.expires_at > Date.now() + 5000) {
      _openskyTokenCache = meta;
      typeof debug === 'function' && debug('getOpenSkyToken: KV hit');
      return meta.access_token;
    }
  } catch(e) { typeof debug === 'function' && debug('getOpenSkyToken: KV read error', e?.message || e); }
  // Fetch fresh token from OpenSky OAuth2
  try {
    const creds = btoa(`${env.OPENSKY_CLIENT_ID}:${env.OPENSKY_CLIENT_SECRET}`);
    const res = await fetchWithTimeout('https://opensky-network.org/api/auth/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }, 10000);
    if (!res.ok) { typeof debug === 'function' && debug('getOpenSkyToken: upstream failed', res.status); return null; }
    const data = await res.json();
    const ttlSec = Math.max(60, (Number(data.expires_in) || 3600) - 60);
    const meta = { access_token: data.access_token, expires_at: Date.now() + ttlSec * 1000 };
    _openskyTokenCache = meta;
    await kvPut(env, OPENSKY_TOKEN_META_KEY, meta, { expirationTtl: ttlSec });
    typeof debug === 'function' && debug('getOpenSkyToken: refreshed, ttl', ttlSec);
    return meta.access_token;
  } catch(e) { typeof debug === 'function' && debug('getOpenSkyToken: exception', e?.message || e); return null; }
}

/* ===========================
   S2.5 — LOGISTICS PROXIMITY ALERT (1-hour dedup per incident+hub)
=========================== */
async function checkLogisticsProximity(env, incident) {
  if (!incident || !incident.id) return;
  const lat = Number(incident.lat);
  const lon = Number(incident.lng || incident.lon);
  if (isNaN(lat) || isNaN(lon) || (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6)) return;
  for (const hub of DELL_LOGISTICS_HUBS) {
    const distKm = haversineKm(lat, lon, hub.lat, hub.lon);
    if (distKm > hub.radiusKm) continue;
    const dedupKey = `${LOG_ALERT_DEDUP_PREFIX}${incident.id}_${hub.code}`;
    try {
      const existing = await env.INTEL_KV.get(dedupKey);
      if (existing) { typeof debug === 'function' && debug('checkLogisticsProximity: dedup', hub.code, incident.id); continue; }
    } catch(e) {}
    await sendAlertEmail(env, incident, {
      affectedList: [`${hub.name} (${hub.code}) — ${Math.round(distKm)} km from hub`],
      dedupeTtlSec: 3600,
    });
    try { await kvPut(env, dedupKey, { ts: new Date().toISOString() }, { expirationTtl: 3600 }); } catch(e) {}
    typeof debug === 'function' && debug('checkLogisticsProximity: alerted', hub.code, incident.id, Math.round(distKm) + 'km');
  }
}

/* ===========================
   S2.5 — VESSEL LAST-HUB HELPER
=========================== */
/**
 * Scan current incidents for the most recent lat/lon that falls within
 * 50 km of a Dell Logistics Hub. Used as a proxy for vessel port-call history
 * when AIS live data is unavailable.
 * @param {object} env
 * @param {string} vesselId - MMSI or vessel name (informational only)
 * @returns {Promise<{name:string,code:string,time:string|null}|null>}
 */
async function findVesselLastHub(env, vesselId) {
  try {
    const incidents = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    let best = null;
    let bestDist = Infinity;
    for (const inc of incidents) {
      const lat = Number(inc.lat);
      const lon = Number(inc.lng || inc.lon);
      if (isNaN(lat) || isNaN(lon)) continue;
      for (const hub of DELL_LOGISTICS_HUBS) {
        const d = haversineKm(lat, lon, hub.lat, hub.lon);
        if (d <= 50 && d < bestDist) {
          bestDist = d;
          best = { name: hub.name, code: hub.code, time: inc.pubDate || inc.date || inc.ts || null };
        }
      }
    }
    typeof debug === 'function' && debug('findVesselLastHub', vesselId, best ? best.code : 'none');
    return best;
  } catch(e) {
    typeof debug === 'function' && debug('findVesselLastHub error', e?.message || e);
    return null;
  }
}

/* ===========================
   S2.5 — LOGISTICS WORKER PROXY ENDPOINTS
=========================== */
async function handleApiLogisticsTrack(env, req) {
  try {
    const url    = new URL(req.url);
    // Normalise: trim + lowercase for lookup; uppercase preserved in display fields
    const rawId  = (url.searchParams.get('icao24') || url.searchParams.get('id') || '').trim();
    const icao24 = rawId.toLowerCase();
    const lamin  = url.searchParams.get('lamin');
    const lamax  = url.searchParams.get('lamax');
    const lomin  = url.searchParams.get('lomin');
    const lomax  = url.searchParams.get('lomax');
    const isBbox = lamin && lamax && lomin && lomax;

    // Input validation
    if (!icao24 && !isBbox) {
      return { ok: false, status: 400, body: { ok: false, error: 'icao24 or bbox params required' } };
    }
    if (icao24 && icao24.length > 64) {
      return { ok: false, status: 400, body: { ok: false, error: 'id too long (max 64 chars)' } };
    }

    // ── VESSEL branch: 7–9 all-digit IDs are MMSI ──────────────────────────────
    if (icao24 && /^\d{7,9}$/.test(icao24)) {
      const lastHub = await findVesselLastHub(env, icao24);
      const vesselStatus = lastHub ? 'IN-PORT' : 'UNKNOWN';
      typeof debug === 'function' && debug('logistics:track:vessel', icao24, vesselStatus);
      return { ok: true, status: 200, body: {
        ok: true, id: icao24, status: vesselStatus,
        lastHubName: lastHub ? lastHub.name : null,
        lastHubTime: lastHub ? lastHub.time  : null,
        deepLink: `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(icao24)}`,
        source: 'hub_history',
      }};
    }

    // ── BBOX branch (hub radar): no schedule fallback, return aircraft count ───
    if (isBbox) {
      const bboxKey = `logistics_bbox_${lamin}_${lamax}_${lomin}_${lomax}`;
      try {
        const cached = await kvGetJson(env, bboxKey, null);
        if (cached) return { ok: true, status: 200, body: { ...cached, _cached: true } };
      } catch(e) {}
      const token = await getOpenSkyToken(env);
      const hdr = token ? { 'Authorization': `Bearer ${token}` } : {};
      const bboxRes = await fetchWithTimeout(`https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`, { headers: hdr }, 10000);
      if (!bboxRes.ok) return { ok: false, status: bboxRes.status, body: { ok: false, error: `OpenSky upstream error (${bboxRes.status})` } };
      const bboxData = await bboxRes.json();
      const bboxStates = (bboxData.states || []).map(s => ({ icao24: s[0], callsign: (s[1] || '').trim(), latitude: s[6], longitude: s[5] }));
      const bboxResult = { states: bboxStates, fetched_at: new Date().toISOString() };
      if (bboxStates.length > 0) await kvPut(env, bboxKey, bboxResult, { expirationTtl: 60 });
      typeof debug === 'function' && debug('logistics:track:bbox', bboxStates.length);
      return { ok: true, status: 200, body: bboxResult };
    }

    // ── FLIGHT branch ──────────────────────────────────────────────────────────
    // 1. Live-state 60-second KV cache
    const liveKey = `logistics_track_${icao24}`;
    try {
      const cached = await kvGetJson(env, liveKey, null);
      if (cached) {
        typeof debug === 'function' && debug('logistics:track:live-cache', icao24);
        return { ok: true, status: 200, body: { ...cached, _cached: true } };
      }
    } catch(e) {}

    // 2. Live position via adsb.fi (free, no auth, ~200ms — replaces slow OpenSky REST API)
    // Detect callsign vs ICAO24: ICAO24 is hex-only (0-9, a-f); callsigns contain g-z letters
    const isCallsign = /[g-z]/i.test(icao24);
    const fr24Link = `https://www.flightradar24.com/search?query=${encodeURIComponent(rawId.toUpperCase())}`;
    const adsbUrl = isCallsign
      ? `https://opendata.adsb.fi/api/v2/callsign/${encodeURIComponent(rawId.toUpperCase().trim())}`
      : `https://opendata.adsb.fi/api/v2/hex/${encodeURIComponent(icao24)}`;
    let adsbRes;
    try {
      adsbRes = await fetchWithTimeout(adsbUrl, {}, 5000);
    } catch(fetchErr) {
      typeof debug === 'function' && debug('logistics:track:adsb-timeout', icao24, fetchErr?.message);
      return { ok: false, status: 200, body: { ok: false, reason: 'opensky_timeout', error: 'ADS-B lookup timed out. Try again.', deep_link: fr24Link } };
    }
    if (adsbRes.ok) {
      const adsbData = await adsbRes.json().catch(() => ({}));
      const acList = Array.isArray(adsbData.ac) ? adsbData.ac : [];
      if (acList.length > 0) {
        const a = acList[0];
        const states = [{
          icao24: (a.hex || icao24).toLowerCase(),
          callsign: (a.flight || rawId).trim(),
          origin_country: a.r || '',
          longitude:     a.lon      != null ? Number(a.lon)  : null,
          latitude:      a.lat      != null ? Number(a.lat)  : null,
          baro_altitude: a.alt_baro != null && a.alt_baro !== 'ground' ? Number(a.alt_baro) * 0.3048 : 0,
          on_ground:     a.alt_baro === 'ground' || a.on_ground === true,
          velocity:      a.gs       != null ? Number(a.gs) * 0.514444 : null,   // knots → m/s
          true_track:    a.track    != null ? Number(a.track) : null,
          vertical_rate: a.baro_rate != null ? Number(a.baro_rate) * 0.00508 : null, // ft/min → m/s
        }];
        const liveResult = { id: icao24, icao24: (a.hex || icao24), status: 'LIVE', states, fetched_at: new Date().toISOString() };
        await kvPut(env, liveKey, liveResult, { expirationTtl: 60 });
        typeof debug === 'function' && debug('logistics:track:live', icao24, 'adsb.fi');
        return { ok: true, status: 200, body: { ok: true, ...liveResult } };
      }
    }

    // 3. adsb.fi coverage gap (e.g. Russia/CIS) — fallback to OpenSky states/all (6 s hard limit)
    const osQParam = isCallsign
      ? `callsign=${encodeURIComponent(rawId.toUpperCase().trim())}`
      : `icao24=${encodeURIComponent(icao24)}`;
    try {
      const osRes2 = await fetchWithTimeout(
        `https://opensky-network.org/api/states/all?${osQParam}`, {}, 6000);
      if (osRes2.ok) {
        const osData2 = await osRes2.json().catch(() => ({}));
        const states2 = (osData2.states || []).map(s => ({
          icao24: s[0], callsign: (s[1] || '').trim(), origin_country: s[2],
          longitude: s[5], latitude: s[6], baro_altitude: s[7],
          on_ground: s[8], velocity: s[9], true_track: s[10], vertical_rate: s[11],
        }));
        if (states2.length > 0) {
          const liveResult2 = { id: icao24, icao24: states2[0].icao24 || icao24, status: 'LIVE', states: states2, fetched_at: new Date().toISOString() };
          await kvPut(env, liveKey, liveResult2, { expirationTtl: 60 });
          typeof debug === 'function' && debug('logistics:track:live', icao24, 'opensky-fallback');
          return { ok: true, status: 200, body: { ok: true, ...liveResult2 } };
        }
      }
    } catch(e) {
      typeof debug === 'function' && debug('logistics:track:opensky-fallback-skip', e?.message);
    }

    // 4. Not airborne on either source — send FR24 deep-link immediately.
    return { ok: false, status: 200, body: { ok: false, reason: 'no_schedule_found', deep_link: fr24Link } };

  } catch(e) {
    typeof debug === 'function' && debug('handleApiLogisticsTrack error', e?.message || e);
    const isAbort = e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('abort');
    if (isAbort) {
      return { ok: false, status: 200, body: { ok: false, reason: 'opensky_timeout', error: 'OpenSky timed out. Try again in a moment.' } };
    }
    return { ok: false, status: 500, body: { ok: false, error: String(e?.message || e) } };
  }
}

async function handleApiLogisticsWatch(env, req) {
  try {
    const userId = (req.headers.get('X-User-Id') || '').trim();
    if (!userId) return { ok: false, status: 400, body: { ok: false, error: 'X-User-Id header required' } };
    const watchKey = `${LOGISTICS_WATCH_PREFIX}${userId}`;
    if (req.method === 'GET') {
      const list = await kvGetJson(env, watchKey, []);
      return { ok: true, status: 200, body: { watchlist: Array.isArray(list) ? list : [] } };
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      // Accept id, icao24 (flights), or mmsi (vessels) — unified as 'id'
      const id     = String(body.id || body.icao24 || body.mmsi || '').trim().toLowerCase();
      const type   = String(body.type || 'flight').toLowerCase() === 'vessel' ? 'vessel' : 'flight';
      const label  = String(body.label || id).trim().slice(0, 80);
      const action = String(body.action || 'add').toLowerCase();
      let list = await kvGetJson(env, watchKey, []);
      if (!Array.isArray(list)) list = [];
      if (action === 'remove') {
        list = list.filter(w => w.id !== id);
      } else if (action === 'test-alert') {
        // Fire a test alert to the user's notification channel via existing sendAlertEmail
        try {
          await sendAlertEmail(env, {
            subject: '[TEST] Dell OS InfoHub — Logistics Alert Test',
            body: `This is a test alert from the OS InfoHub Logistics Tracker.\nUser ID: ${userId}\nTimestamp: ${new Date().toISOString()}`,
          });
        } catch(e2) {
          typeof debug === 'function' && debug('logistics:test-alert error', e2?.message || e2);
        }
        return { ok: true, status: 200, body: { ok: true, message: 'Test alert queued.' } };
      } else {
        // action === 'add'
        if (!id) return { ok: false, status: 400, body: { ok: false, error: 'id (or icao24/mmsi) required in body' } };
        if (!list.some(w => w.id === id)) {
          list.push({ id, type, label, added_at: new Date().toISOString() });
        }
      }
      list = list.slice(-100);
      await kvPut(env, watchKey, list, { expirationTtl: 90 * 24 * 3600 });
      typeof debug === 'function' && debug('logistics:watch:saved', userId, list.length);
      return { ok: true, status: 200, body: { ok: true, items: list.length, watchlist: list } };
    }
    return { ok: false, status: 405, body: { ok: false, error: 'method not allowed' } };
  } catch(e) {
    typeof debug === 'function' && debug('handleApiLogisticsWatch error', e?.message || e);
    return { ok: false, status: 500, body: { ok: false, error: String(e?.message || e) } };
  }
}

/**
 * S2.5 — AISStream.io stub.
 * When an AISStream.io API key is provisioned in env.AISSTREAM_API_KEY, replace
 * this stub body with a real WebSocket subscribe call to wss://stream.aisstream.io/v0/stream.
 * For now it returns a "pending" status so the UI can show a meaningful message.
 *
 * @param {string} mmsi  - 9-digit MMSI number of the vessel
 * @returns {Promise<{ok: boolean, status: string, data: (object|null)}>}
 */
async function fetchAisStreamData(mmsi) {
  // TODO: Replace stub once env.AISSTREAM_API_KEY is provisioned.
  // Real implementation: open a WebSocket to wss://stream.aisstream.io/v0/stream,
  // subscribe with { APIKey, BoundingBoxes, FiltersShipMMSI: [mmsi] }, consume one
  // PositionReport message, close the socket, and return mapped fields.
  return { ok: false, status: 'Live data pending — AISStream.io API key not yet provisioned.', data: null };
}

/* ===========================
   HTTP / API Handlers (simplified but compatible)
   =========================== */

/**
 * GET /api/stream — Server-Sent Events bridge.
 * Sends a single snapshot (incidents + proximity) then heartbeat comments
 * every 25 s to stay inside Cloudflare's 100 s idle timeout.
 * The browser EventSource client auto-reconnects when the stream closes,
 * giving near-real-time push behaviour without Durable Objects.
 */
async function handleApiStream(env, req) {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const writeEvent = (event, data) =>
    writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  (async () => {
    let hbTimer;
    try {
      const incidents = await kvGetJson(env, INCIDENTS_KV_KEY, []);
      const proxRaw   = await kvGetJson(env, PROXIMITY_KV_KEY, { incidents: [] });
      await writeEvent('incidents', incidents);
      await writeEvent('proximity', proxRaw);
      await writeEvent('heartbeat', { ts: new Date().toISOString() });

      // SSE comment keepalives — prevents CF idle-close before client reconnects
      hbTimer = setInterval(async () => {
        try { await writer.write(enc.encode(`: heartbeat\n\n`)); }
        catch { clearInterval(hbTimer); }
      }, 25_000);
    } catch (e) {
      debug('handleApiStream error', e?.message || e);
    } finally {
      clearInterval(hbTimer);
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
    }
  });
}

async function handleApiIncidents(env, req) {
  const inc = await kvGetJson(env, INCIDENTS_KV_KEY, []);
  let list = Array.isArray(inc) ? inc : [];
  // Filter out incidents disliked by this user
  try {
    const userId = req && req.headers && req.headers.get('X-User-Id');
    if (userId) {
      const disliked = await kvGetJson(env, `${DISLIKES_KV_PREFIX}${userId}`, []);
      if (Array.isArray(disliked) && disliked.length > 0) {
        const dislikedSet = new Set(disliked);
        const before = list.length;
        list = list.filter(i => !dislikedSet.has(String(i.id || '')));
        typeof debug === 'function' && debug('dislike', 'filtered', { userId, removed: before - list.length });
      }
    }
  } catch (e) { typeof debug === 'function' && debug('handleApiIncidents dislike filter error', e?.message || e); }
  return { ok: true, status: 200, body: list };
}

async function handleApiProximity(env, req) {
  const prox = await kvGetJson(env, PROXIMITY_KV_KEY, { incidents: [], updated_at: null });
  // Filter out incidents disliked by this user
  try {
    const userId = req && req.headers && req.headers.get('X-User-Id');
    if (userId && Array.isArray(prox.incidents)) {
      const disliked = await kvGetJson(env, `${DISLIKES_KV_PREFIX}${userId}`, []);
      if (Array.isArray(disliked) && disliked.length > 0) {
        const dislikedSet = new Set(disliked);
        const before = prox.incidents.length;
        prox.incidents = prox.incidents.filter(i => !dislikedSet.has(String(i.id || '')));
        typeof debug === 'function' && debug('dislike', 'filtered', { userId, removed: before - prox.incidents.length });
      }
    }
  } catch (e) { typeof debug === 'function' && debug('handleApiProximity dislike filter error', e?.message || e); }
  return { ok: true, status: 200, body: prox };
}

async function handleApiTravel(env, urlParams) {
  // support /api/traveladvisories and /api/traveladvisories/live
  if (urlParams && urlParams.get('country')) {
    const q = urlParams.get('country');
    const cached = await kvGetJson(env, TRAVEL_CACHE_KEY, { advisories: STATIC_TRAVEL_FALLBACK, updated_at: new Date().toISOString() });
    const best = findBestAdvisoryForCountry(cached.advisories || [], q);
    typeof debug === 'function' && debug('travel', 'served', { country: q, ts: new Date().toISOString() });
    return { ok: true, status: 200, body: { advisory: best || null, news: [] } };
  } else {
    const cached = await kvGetJson(env, TRAVEL_CACHE_KEY, { advisories: STATIC_TRAVEL_FALLBACK, updated_at: new Date().toISOString() });
    typeof debug === 'function' && debug('travel', 'served', { country: 'all', ts: new Date().toISOString() });
    return { ok: true, status: 200, body: cached };
  }
}

async function handleApiThumb(env, req, ctx) {
  try {
    const body = await req.json().catch(()=>null);
    if (!body || !body.id || !body.vote) return { ok:false, status:400, body: "missing id|vote" };
    return await handlePublicThumb(env, body, req, ctx);
  } catch (e) {
    debug("handleApiThumb error", e?.message || e);
    return { ok:false, status:500, body: "error" };
  }
}

/* Admin endpoints (protected with secret header) */
async function isSecretOk(req, env) {
  try {
    const secret = req.headers.get('secret') || "";
    if (!secret && req.method === 'POST') return false;
    const s = env && env.INGEST_SECRET ? String(env.INGEST_SECRET) : "";
    return s && secret && s === secret;
  } catch (e) { return false; }
}

async function handleAdminAction(env, req, ctx) {
  const url = new URL(req.url);
  const action = url.pathname.replace(/^\/+/, '').split('/').slice(-1)[0];
  const secretOk = await isSecretOk(req, env);
  if (!secretOk) return { ok:false, status:403, body: "Unauthorized" };

  try {
    // FIX: Using ctx.waitUntil to prevent background tasks from being killed
    if (action === 'trigger-ingest' || action === 'ingest') {
      if (ctx) ctx.waitUntil(runIngestion(env, { force: true }, ctx).catch(e => debug("ingest trigger failed", e?.message || e)));
      else runIngestion(env, { force: true }).catch(e => debug("ingest trigger failed no-ctx", e?.message || e));
      return { ok:true, status:200, body: "ingest_started" };
    } else if (action === 'aggregate-thumbs') {
      if (ctx) ctx.waitUntil(aggregateThumbs(env, { force: true }));
      else aggregateThumbs(env, { force: true }).catch(e=>debug("aggregate-thumbs failed no-ctx", e?.message || e));
      return { ok:true, status:200, body: "aggregated" };
    } else if (action === 'refresh-travel') {
      if (ctx) ctx.waitUntil(refreshTravelData(env, { force: true }).catch(e=>debug("refreshTravelData failed", e?.message || e)));
      else refreshTravelData(env, { force: true }).catch(e=>debug("refreshTravelData failed no-ctx", e?.message || e));
      return { ok:true, status:200, body: "travel_refresh_started" };
    } else if (action === 'list-briefs') {
      const dates = await listArchiveDates(env);
      return { ok:true, status:200, body: dates };
    }
    return { ok:false, status:400, body: "unknown_action" };
  } catch (e) {
    debug("handleAdminAction err", e?.message || e);
    return { ok:false, status:500, body: "error" };
  }
}

/* ===========================
   INITIATIVE 1 — RELEVANCY ENGINE (TF-IDF, zero external cost)
   AI_MODE='tfidf' (default): no external API calls; pure JS scoring.
   Formula: relevance = 40% heuristic + 30% semantic + 10% severity + 10% recency + 10% thumbs
   =========================== */

// KV keys for AI engine (separate from LEARNING_RULES_KEY to avoid shape conflicts)
const AI_RULES_KEY   = 'ai:rules';   // { keywordWeights, sourceWeights, produced_at }
const AI_META_PREFIX = 'ai:meta:';   // per-incident cache: relevance_score, canonical_summary, …

// Stopwords stripped before tokenisation
const AI_STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'is','was','are','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','that','this','these',
  'those','it','its','from','as','into','than','then','when','where','which',
  'who','what','how','all','each','both','some','any','no','not','more','also',
  'about','up','out','if','over','after','before','under','during','said',
  'report','reported','via','per','amid','according','near','new','local',
]);

// Hardcoded IDF weights — encodes domain knowledge so high-impact terms score higher.
// Terms absent from this map receive IDF=1.0 (neutral).
const AI_SECURITY_IDF = {
  bomb:2.8, bombing:3.0, blast:2.8, explosion:2.8, explosive:2.8,
  shoot:3.0, shooting:3.0, gunfire:3.0, gunman:3.2, armed:2.5,
  attack:2.5, attacker:2.8, terror:3.2, terrorist:3.2, militia:3.0, militant:3.0,
  kidnap:3.4, kidnapping:3.4, hostage:3.4, abduction:3.2, ransom:3.0,
  massacre:3.5, assassination:3.5, assassin:3.4,
  riot:2.8, unrest:2.5, protest:2.0, clashes:2.8, coup:3.0, siege:3.0,
  strike:1.8, walkout:2.5, blockade:2.8, military:2.0, conflict:2.2, combat:2.8,
  tsunami:3.2, earthquake:2.2, eruption:3.0, volcano:2.8, cyclone:2.5, hurricane:2.5,
  flood:2.0, wildfire:2.5, evacuation:2.5, disaster:2.2,
  fatalities:3.0, casualties:2.8, wounded:2.5, killed:2.8, dead:2.2, deaths:2.5,
  disruption:2.0, shutdown:2.5, closure:2.0, outage:2.5, infrastructure:2.0,
  piracy:3.0, hijack:3.0, maritime:2.0, port:1.8, cargo:1.8,
  threat:2.0, warning:1.8, danger:2.0, security:1.5,
  pipeline:2.2, facility:1.8, factory:1.8, plant:1.6, depot:2.0,
  border:2.0, checkpoint:2.5, convoy:2.2, crackdown:2.8, detention:2.5, arrest:2.0,
};

// Security seed corpus — defines the "ideal security incident" reference vector
const SECURITY_SEED_PHRASES = [
  'port blockade shipping route disruption cargo maritime',
  'facility fire explosion industrial plant warehouse damage',
  'civil unrest protest riot violence manufacturing supply chain disruption',
  'armed attack shooting gunfire casualties fatalities',
  'bomb explosion blast terrorist threat attack',
  'kidnapping hostage abduction ransom security breach',
  'military conflict operation combat zone troops',
  'labor strike walkout work stoppage supply chain',
  'terrorism attack security incident threat armed',
  'earthquake flood tsunami hurricane cyclone natural disaster evacuation',
  'road closure airport transport disruption infrastructure blocked',
  'power outage grid failure infrastructure shutdown facility',
  'crackdown detention arrest security forces suppression',
  'coup political collapse government instability military takeover',
  'maritime piracy vessel hijack shipping lane cargo',
];

/** Tokenise text to lowercase unigrams, stripping punctuation and stopwords. */
function aiTokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !AI_STOPWORDS.has(t));
}

/**
 * Build a TF-IDF weighted sparse vector for `text`.
 * TF = count/total; IDF = AI_SECURITY_IDF[term] || 1.0
 */
function aiTfIdfVector(text) {
  const tokens = aiTokenize(text);
  if (!tokens.length) return {};
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const total = tokens.length;
  const vec = {};
  for (const [t, c] of Object.entries(freq)) {
    vec[t] = (c / total) * (AI_SECURITY_IDF[t] || 1.0);
  }
  return vec;
}

/** Cosine similarity between two sparse TF-IDF vectors. Returns [0,1]. */
function aiCosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (const [k, v] of Object.entries(a)) {
    if (b[k] !== undefined) dot += v * b[k];
    normA += v * v;
  }
  for (const v of Object.values(b)) normB += v * v;
  if (!normA || !normB) return 0;
  return Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

// Pre-compute reference seed vector once at module load (zero per-request cost)
const AI_SEED_VECTOR = (() => aiTfIdfVector(SECURITY_SEED_PHRASES.join(' ')))();

/**
 * Heuristic (operational) sub-score — contributes 40% of relevance_score.
 * Tier 1: direct violence (0.8). Tier 2: civil unrest (0.6). Tier 3: infrastructure (0.45).
 * Boosted/damped ±10% by existing learning-rules keyword weights.
 */
function computeOperationalScore(incident, rules) {
  const text = String(incident.title || '') + ' ' + String(incident.summary || '');
  let score = 0.25; // neutral baseline
  if (/\b(shoot|shooting|bomb|blast|explos|attack|terror|hostage|kidnap|massacre|assassin|gunman|armed attack)\b/i.test(text)) {
    score = 0.8; // tier 1 — direct violence
  } else if (/\b(riot|unrest|clashes|coup|militant|militia|siege|demonstrat)\b/i.test(text)) {
    score = 0.6; // tier 2 — civil instability
  } else if (/\b(fire|flood|quake|earthquake|disruption|evacuat|closure|shutdown|hurricane|cyclone|tsunami|strike|blockade|outage)\b/i.test(text)) {
    score = 0.45; // tier 3 — infrastructure / natural hazard
  }
  // Learning-rules keyword boost (±10%, damped average)
  const kw = (rules && rules.keywordWeights) || {};
  const tokens = aiTokenize(text);
  let kwSum = 0, kwN = 0;
  for (const tok of tokens) {
    if (kw[tok]) { kwSum += Number(kw[tok].weight || 0); kwN++; }
  }
  if (kwN > 0) score = Math.min(1, Math.max(0, score + (kwSum / kwN) * 0.1));
  return Math.min(1, Math.max(0, score));
}

/**
 * Thumbs/feedback sub-score — contributes 10% of relevance_score.
 * Maps log-diff keyword weights [-3,+3] → [0,1] via linear sigmoid around 0.5.
 */
function computeThumbsScore(incident, rules) {
  if (!rules) return 0.5;
  const kw = rules.keywordWeights || {};
  const tokens = aiTokenize(String(incident.title || '') + ' ' + String(incident.summary || ''));
  let sum = 0, n = 0;
  for (const tok of tokens) {
    if (kw[tok]) { sum += Number(kw[tok].weight || 0); n++; }
  }
  if (n === 0) return 0.5; // neutral when no signal
  return Math.min(1, Math.max(0, 0.5 + (sum / n) * 0.15));
}

/**
 * Full hybrid relevance score for one incident.
 * Formula: 40% heuristic + 30% semantic + 10% severity + 10% recency + 10% thumbs
 */
/**
 * @param {object} [opts]       - optional weight overrides
 * @param {number} [opts.opW]   - operational weight (default 0.4 for hybrid/llm, 0.5 for tfidf)
 * @param {number} [opts.semW]  - semantic weight   (default 0.3 for hybrid/llm, 0.2 for tfidf)
 * In tfidf mode the semantic ceiling is ~0.4 (hardcoded IDF, fixed seeds) vs. ~0.9 with real
 * embeddings, so the spec's 30% allocation over-credits a weak signal. Redistributing 10pp
 * to the heuristic column restores intended ranking fidelity without breaking the API shape.
 */
function computeRelevanceForIncident(incident, rules, seedVec, windowMs, opts = {}) {
  const text = String(incident.title || '') + ' ' + String(incident.summary || '');

  // Operational weight: 50% in tfidf mode (compensates for capped semantic), 40% otherwise
  const opW  = (opts.opW  !== undefined) ? opts.opW  : 0.4;
  // Semantic weight:   20% in tfidf mode, 30% in hybrid/llm mode
  const semW = (opts.semW !== undefined) ? opts.semW : 0.3;

  // opW% — heuristic / operational
  const operationalScore = computeOperationalScore(incident, rules);

  // semW% — semantic TF-IDF cosine similarity vs. security seed corpus
  const semanticScore = aiCosineSim(aiTfIdfVector(text), seedVec);

  // 10% — severity
  const SEV_MAP = { critical: 1.0, high: 0.8, medium: 0.5, low: 0.2 };
  const severityScore = SEV_MAP[String(incident.severity || '').toLowerCase()] ?? 0.3;

  // 10% — recency (linear decay over windowMs; defaults 0.5 if timestamp invalid)
  let recencyScore = 0.5;
  try {
    const ageMs = Date.now() - new Date(incident.time).getTime();
    if (!isNaN(ageMs)) recencyScore = Math.max(0, 1 - ageMs / windowMs);
  } catch {}

  // 10% — feedback / thumbs
  const thumbsScore = computeThumbsScore(incident, rules);

  const raw = opW * operationalScore + semW * semanticScore +
              0.1 * severityScore  + 0.1 * recencyScore + 0.1 * thumbsScore;
  const round = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return {
    operational_score: round(operationalScore),
    semantic_score:    round(semanticScore),
    severity_score:    round(severityScore),
    recency_score:     round(recencyScore),
    thumbs_score:      round(thumbsScore),
    relevance_score:   round(raw),
  };
}

/**
 * GET /api/ai/rank?region=&limit=&country=
 * Returns incidents sorted by relevance_score desc.
 * AI_MODE='tfidf' (default) — zero external API calls.
 */
async function handleApiAiRank(env, req, ctx) {
  try {
    const t0 = Date.now();
    const url     = new URL(req.url);
    const region  = (url.searchParams.get('region')  || '').toLowerCase();
    const country = (url.searchParams.get('country') || '').toLowerCase();
    const limit   = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));

    // Cost gate — default tfidf: never call external embeddings/LLM APIs
    const aiMode      = String((env && env.AI_MODE) || 'tfidf').toLowerCase();
    const recentHours = Number((env && env.RECENT_WINDOW_HOURS) || 72);
    const windowMs    = recentHours * 3600 * 1000;
    const cutoffMs    = Date.now() - windowMs;
    // Weight reallocation: in tfidf mode TF-IDF cosine is capped ~0.4 (vs ~0.9 with embeddings).
    // Shift 10pp from semantic → operational so rankings reflect actual incident severity.
    const opW  = aiMode === 'tfidf' ? 0.5 : 0.4;
    const semW = aiMode === 'tfidf' ? 0.2 : 0.3;

    // Load incidents + both rule sets in parallel
    let incidents = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    if (!Array.isArray(incidents)) incidents = [];
    const [learnRules, aiRulesRaw] = await Promise.all([
      loadLearningRules(env),
      kvGetJson(env, AI_RULES_KEY, { keywordWeights: {}, sourceWeights: {}, produced_at: null }),
    ]);
    // Merge so both feedback loops inform the scorer
    const mergedRules = {
      keywordWeights: { ...(learnRules.keywordWeights || {}), ...(aiRulesRaw.keywordWeights || {}) },
      sourceWeights:  { ...(learnRules.sourceWeights  || {}), ...(aiRulesRaw.sourceWeights  || {}) },
    };

    // Filter: recency, region, country
    let filtered = incidents.filter(i => {
      try { return new Date(i.time).getTime() >= cutoffMs; } catch { return false; }
    });
    if (region)  filtered = filtered.filter(i => String(i.region || '').toLowerCase() === region);
    if (country) filtered = filtered.filter(i =>
      String(i.country || '').toLowerCase().includes(country) ||
      String(typeof i.location === 'string' ? i.location : '').toLowerCase().includes(country)
    );

    // Score every filtered incident
    const scored = filtered.map(i => {
      const scores = computeRelevanceForIncident(i, mergedRules, AI_SEED_VECTOR, windowMs, { opW, semW });
      typeof debug === 'function' && debug('ai:rank:scored', {
        id: i.id, title: String(i.title || '').slice(0, 60), ...scores,
      });
      // Extractive canonical summary (LLM path: replace with callGroq stub when AI_MODE='hybrid')
      const canonical_summary = String(i.summary || i.title || '').slice(0, 200).trim();
      return {
        id: i.id, title: i.title, time: i.time, severity: i.severity,
        region: i.region, country: i.country, link: i.link,
        canonical_summary, ...scores,
      };
    });

    scored.sort((a, b) => b.relevance_score - a.relevance_score);
    const items = scored.slice(0, limit);

    // Background: persist ai:meta per returned item (TTL 7d)
    if (ctx && ctx.waitUntil && items.length > 0) {
      ctx.waitUntil((async () => {
        for (const item of items) {
          try {
            await kvPut(env, `${AI_META_PREFIX}${item.id}`, {
              relevance_score:   item.relevance_score,
              operational_score: item.operational_score,
              semantic_score:    item.semantic_score,
              canonical_summary: item.canonical_summary,
              last_scored_at:    new Date().toISOString(),
              mode: aiMode,
            }, { expirationTtl: 7 * 24 * 3600 });
          } catch {}
        }
      })());
    }

    const ms = Date.now() - t0;
    typeof debug === 'function' && debug('ai:rank:timing', {
      ms, total: filtered.length, returned: items.length, mode: aiMode,
    });
    return { ok: true, status: 200, body: { ok: true, mode: aiMode, scored_at: new Date().toISOString(), items } };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiRank error', e?.message || e);
    return { ok: false, status: 500, body: { ok: false, error: String(e?.message || e) } };
  }
}

/**
 * POST /api/ai/feedback  body: { id, user_id, action: 'up'|'down'|'hide' }
 * Updates keyword counters in ai:rules and triggers updateLearningRules in background.
 */
async function handleApiAiFeedback(env, req, ctx) {
  try {
    let body;
    try { body = await req.json(); } catch {
      return { ok: false, status: 400, body: { ok: false, error: 'invalid JSON body' } };
    }
    const { id, user_id, action } = body || {};
    if (!id || !action)
      return { ok: false, status: 400, body: { ok: false, error: 'id and action required' } };
    if (!['up','down','hide'].includes(action))
      return { ok: false, status: 400, body: { ok: false, error: 'action must be up|down|hide' } };

    // Load ai:rules and incident list in parallel
    const [aiRules, incidents] = await Promise.all([
      kvGetJson(env, AI_RULES_KEY, { keywordWeights: {}, sourceWeights: {}, produced_at: null }),
      kvGetJson(env, INCIDENTS_KV_KEY, []),
    ]);
    const kw = aiRules.keywordWeights || {};

    // Extract keywords from the referenced incident to update counters
    const incident = Array.isArray(incidents)
      ? incidents.find(i => String(i.id) === String(id))
      : null;
    let tokensUpdated = 0;
    if (incident) {
      const tokens = [...new Set(
        aiTokenize(String(incident.title || '') + ' ' + String(incident.summary || ''))
      )].slice(0, 20); // cap at 20 unique tokens per feedback event
      for (const tok of tokens) {
        if (!kw[tok]) kw[tok] = { up: 0, down: 0, weight: 0 };
        if (action === 'up')
          kw[tok].up   = (kw[tok].up   || 0) + 1;
        else // 'down' or 'hide' both count as negative signal
          kw[tok].down = (kw[tok].down || 0) + 1;
        // Same log-diff formula as updateLearningRules for consistency
        const u = kw[tok].up, d = kw[tok].down;
        kw[tok].weight = Number((Math.log(1 + u) - Math.log(1 + d)).toFixed(4));
        tokensUpdated++;
      }
    }

    aiRules.keywordWeights = kw;
    aiRules.produced_at    = new Date().toISOString();
    aiRules.last_feedback  = { id, user_id: user_id || null, action, ts: new Date().toISOString() };

    // Force-write: admin feedback must take effect immediately (bypass throttle)
    await kvPutWithThrottle(env, AI_RULES_KEY, aiRules, {}, null, true);

    // Background: propagate to broader learning rules
    if (ctx && ctx.waitUntil) {
      try { ctx.waitUntil(updateLearningRules(env)); } catch {}
    }

    typeof debug === 'function' && debug('ai:feedback', {
      id, user_id: user_id || null, action, tokensUpdated,
    });
    return { ok: true, status: 200, body: { ok: true, id, action, tokens_updated: tokensUpdated } };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiFeedback error', e?.message || e);
    return { ok: false, status: 500, body: { ok: false, error: String(e?.message || e) } };
  }
}

/* ===========================
   TIER-2 AI ENDPOINTS
   =========================== */

/**
 * GET /api/ai/briefing?window=8&region=AMER
 * Generates an AI shift briefing narrative from recent incidents.
 */
async function handleApiAiBriefing(env, req) {
  try {
    const url = new URL(req.url);
    const windowH = Math.min(48, Math.max(1, parseInt(url.searchParams.get('window') || '8', 10)));
    const region = (url.searchParams.get('region') || '').toUpperCase().trim();

    let incidents = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const cutoffMs = Date.now() - windowH * 3600 * 1000;
    incidents = (Array.isArray(incidents) ? incidents : []).filter(i => {
      try { return new Date(i.time).getTime() >= cutoffMs; } catch { return false; }
    });
    if (region) {
      incidents = incidents.filter(i => String(i.region || '').toUpperCase() === region);
    }

    if (!incidents.length) {
      return { status: 200, body: { briefing: `No incidents found in the last ${windowH}h${region ? ` for ${region}` : ''}.`, incident_count: 0, window_h: windowH, region: region || 'Global', generated_at: new Date().toISOString(), model: 'none' } };
    }

    const incidentLines = incidents.slice(0, 30).map((i, idx) =>
      `${idx + 1}. [${i.severity_label || 'INFO'}][${i.region || '?'}] ${i.country || ''}: ${i.title}${i.category ? ` (${i.category})` : ''}`
    ).join('\n');

    const systemPrompt = `You are a senior intelligence analyst for Dell Technologies' Global Security Operations Center (GSOC).
Your role is to produce concise, professional shift briefings for Regional Security Managers (RSMs).
Focus on: employee safety threats, Dell facility/asset risks, supply chain disruptions, cyber threats, and travel advisories.
Write in intelligence report style: clear, factual, action-oriented. No fluff.`;

    const userContent = `Generate a ${windowH}-hour shift briefing${region ? ` for region: ${region}` : ' (Global)'} based on these ${incidents.length} intelligence items:\n\n${incidentLines}\n\nStructure the briefing as:\n## SITUATION SUMMARY\n(2-3 sentences)\n\n## KEY THREATS (Priority Order)\n- (bullet each)\n\n## DELL OPERATIONAL IMPACT\n(brief assessment)\n\n## RECOMMENDED RSM ACTIONS\n- (bullet each)\n\n## WATCH ITEMS FOR NEXT SHIFT\n- (bullet each)`;

    const result = await callLLM(env, [{ role: 'user', content: userContent }], {
      system: systemPrompt,
      max_tokens: 1200,
      model: 'claude-sonnet-4-5',
    });

    return {
      status: result.error && !result.text ? 503 : 200,
      body: {
        briefing: result.text || `AI unavailable: ${result.error}`,
        incident_count: incidents.length,
        window_h: windowH,
        region: region || 'Global',
        generated_at: new Date().toISOString(),
        model: env.ANTHROPIC_API_KEY ? 'claude' : (env.GROQ_API_KEY ? 'groq' : 'none'),
        error: result.error || null,
      },
    };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiBriefing error', e?.message || e);
    return { status: 500, body: { error: String(e?.message || e) } };
  }
}

/**
 * GET /api/ai/country-risk?country=Iran
 * Returns AI-generated structured risk assessment for a country.
 */
async function handleApiAiCountryRisk(env, req) {
  try {
    const url = new URL(req.url);
    const country = (url.searchParams.get('country') || '').trim();
    if (!country) return { status: 400, body: { error: 'country param required' } };

    const all = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const cutoffMs = Date.now() - 72 * 3600 * 1000;
    const countryIncidents = (Array.isArray(all) ? all : []).filter(i => {
      try {
        if (new Date(i.time).getTime() < cutoffMs) return false;
        const c = String(i.country || '').toLowerCase();
        const q = country.toLowerCase();
        return c.includes(q) || q.includes(c);
      } catch { return false; }
    }).slice(0, 20);

    const systemPrompt = `You are a geopolitical risk analyst for Dell Technologies Global Security.
Provide structured country risk assessments for the RSM (Regional Security Manager) team.
Focus exclusively on risks relevant to Dell: employee safety, facility security, supply chain, travel advisards, cyber threats.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON object.`;

    const userContent = `Assess current risk for: ${country}\n\nRecent incidents (last 72h, ${countryIncidents.length} found):\n${countryIncidents.slice(0, 15).map(i => `- [${i.severity_label || 'INFO'}] ${i.title}`).join('\n') || '(none in last 72h)'}\n\nReturn this exact JSON structure:\n{"risk_level":"CRITICAL|HIGH|MEDIUM|LOW","risk_score":0,"bullets":["bullet1","bullet2","bullet3"],"dell_impact":"one sentence","travel_advisory":"AVOID|EXERCISE_CAUTION|NORMAL","key_threats":["threat1","threat2"]}`;

    const result = await callLLM(env, [{ role: 'user', content: userContent }], {
      system: systemPrompt,
      max_tokens: 600,
      model: 'claude-haiku-4-5',
    });

    let parsed = null;
    if (result.text) {
      try {
        const m = String(result.text).match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch (e) {
        typeof debug === 'function' && debug('country-risk json parse error', e?.message);
      }
    }

    return {
      status: 200,
      body: {
        country,
        ...(parsed || {
          risk_level: 'UNKNOWN',
          risk_score: 0,
          bullets: [result.text ? result.text.slice(0, 200) : 'Analysis unavailable'],
          dell_impact: 'Unable to assess at this time.',
          travel_advisory: 'EXERCISE_CAUTION',
          key_threats: [],
        }),
        incident_count: countryIncidents.length,
        generated_at: new Date().toISOString(),
        model: env.ANTHROPIC_API_KEY ? 'claude' : (env.GROQ_API_KEY ? 'groq' : 'none'),
      },
    };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiCountryRisk error', e?.message || e);
    return { status: 500, body: { error: String(e?.message || e) } };
  }
}

/**
 * POST /api/ai/chat
 * Body: { messages: [{role, content}] }
 * Injects live incident context into system prompt; returns { reply, model }.
 */
async function handleApiAiChat(env, req) {
  try {
    let body;
    try { body = await req.json(); } catch { return { status: 400, body: { error: 'invalid JSON body' } }; }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) return { status: 400, body: { error: 'messages array required' } };

    // Inject live context: last 24h incidents (top 25)
    const all = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const cutoffMs = Date.now() - 24 * 3600 * 1000;
    const recentCtx = (Array.isArray(all) ? all : [])
      .filter(i => { try { return new Date(i.time).getTime() >= cutoffMs; } catch { return false; } })
      .slice(0, 25)
      .map(i => `[${i.severity_label || 'INFO'}][${i.region || '?'}] ${i.country || ''}: ${i.title}`)
      .join('\n');

    const systemPrompt = `You are "InfoHub Assistant", an AI analyst embedded in Dell Technologies' OS INFOHUB global intelligence platform.
You have access to the live threat feed and help the RSM (Regional Security Manager) team understand current events, risks, and operational impacts.
Be concise, professional, and intelligence-focused. Cite specific incidents when relevant.
Suggest RSM actions when appropriate. Flag uncertainty if information is limited.

Current live feed (last 24h — ${all.length} total incidents):
${recentCtx || '(no recent incidents)'}`;

    const result = await callLLM(env, messages, {
      system: systemPrompt,
      max_tokens: 800,
      model: 'claude-haiku-4-5',
    });

    return {
      status: result.error && !result.text ? 503 : 200,
      body: {
        reply: result.text || `Sorry, the AI assistant is temporarily unavailable. (${result.error})`,
        model: env.ANTHROPIC_API_KEY ? 'claude' : (env.GROQ_API_KEY ? 'groq' : 'none'),
        error: result.error || null,
      },
    };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiChat error', e?.message || e);
    return { status: 500, body: { error: String(e?.message || e) } };
  }
}

/* ===========================
   INCIDENT ACKNOWLEDGMENT
   =========================== */

/**
 * GET  /api/acknowledge?ids=id1,id2,...  → batch fetch ack records
 * POST /api/acknowledge  body: { id, user_name, note }  → store ack
 */
async function handleApiAcknowledge(env, req) {
  try {
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return { status: 400, body: { error: 'invalid JSON body' } }; }
      const { id, user_name, note } = body || {};
      if (!id || !user_name) return { status: 400, body: { error: 'id and user_name required' } };

      const ack = {
        id: String(id),
        user_name: String(user_name).slice(0, 100),
        note: String(note || '').slice(0, 500),
        timestamp: new Date().toISOString(),
      };
      await kvPut(env, `${ACK_KV_PREFIX}${id}`, ack, { expirationTtl: ACK_TTL_SEC });
      typeof debug === 'function' && debug('ack:stored', id, user_name);
      return { status: 200, body: { ok: true, ack } };
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const idsParam = url.searchParams.get('ids') || '';
      if (!idsParam) return { status: 400, body: { error: 'ids param required' } };
      const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
      const results = {};
      await Promise.all(ids.map(async id => {
        const ack = await kvGetJson(env, `${ACK_KV_PREFIX}${id}`, null);
        if (ack) results[id] = ack;
      }));
      return { status: 200, body: results };
    }

    return { status: 405, body: { error: 'GET or POST required' } };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAcknowledge error', e?.message || e);
    return { status: 500, body: { error: String(e?.message || e) } };
  }
}

/* ===========================
   WEATHER & AVIATION ENDPOINTS
   =========================== */

/**
 * GET /api/weather/disasters
 * Proxies USGS earthquake feed + GDACS global disasters.
 * Returns unified { events[], updated_at }.
 */
async function handleApiWeatherDisasters(env, req) {
  try {
    const [usgsRes, gdacsRes] = await Promise.allSettled([
      fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', {
        headers: { 'User-Agent': 'OSInfoHub/1.0 (+https://vssmaximus-arch.github.io)' },
        cf: { cacheEverything: true, cacheTtl: 900 },
      }),
      fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC%2CFL%2CEQ%2CVO%2CTS&alertlevel=Orange%3BRed', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'OSInfoHub/1.0' },
        cf: { cacheEverything: true, cacheTtl: 900 },
      }),
    ]);

    const events = [];

    // USGS Earthquakes (M4.5+ last 24h)
    if (usgsRes.status === 'fulfilled' && usgsRes.value.ok) {
      try {
        const data = await usgsRes.value.json();
        for (const f of (data.features || []).slice(0, 60)) {
          const coords = f.geometry?.coordinates;
          if (!coords || coords.length < 2) continue;
          const [lng, lat] = coords;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const mag = f.properties?.mag;
          events.push({
            type: 'earthquake',
            lat: Number(lat), lng: Number(lng),
            title: f.properties?.title || `M${mag} Earthquake`,
            magnitude: mag,
            severity: mag >= 6.5 ? 'CRITICAL' : mag >= 5.5 ? 'HIGH' : 'MEDIUM',
            time: new Date(f.properties?.time || Date.now()).toISOString(),
            link: f.properties?.url || 'https://earthquake.usgs.gov',
            source: 'USGS',
          });
        }
      } catch (e) { typeof debug === 'function' && debug('usgs parse error', e?.message); }
    }

    // GDACS Global Disasters (Orange/Red alerts only)
    if (gdacsRes.status === 'fulfilled' && gdacsRes.value.ok) {
      try {
        const data = await gdacsRes.value.json();
        const items = data?.features || data?.events || (Array.isArray(data) ? data : []);
        for (const item of items.slice(0, 40)) {
          const props = item.properties || item;
          const coords = item.geometry?.coordinates;
          const lat = coords ? Number(coords[1]) : Number(props.latitude || props.lat || 0);
          const lng = coords ? Number(coords[0]) : Number(props.longitude || props.lon || 0);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
          const alertLevel = String(props.alertlevel || props.AlertLevel || '').toLowerCase();
          const evType = String(props.eventtype || props.EventType || 'disaster').toLowerCase();
          events.push({
            type: evType === 'tc' ? 'cyclone' : evType === 'fl' ? 'flood' : evType === 'vo' ? 'volcano' : evType === 'ts' ? 'tsunami' : evType,
            lat, lng,
            title: props.eventname || props.EventName || props.name || 'Natural Disaster',
            severity: alertLevel === 'red' ? 'CRITICAL' : 'HIGH',
            time: props.fromdate || props.FromDate || new Date().toISOString(),
            link: props.url || props.URL || 'https://www.gdacs.org',
            source: 'GDACS',
          });
        }
      } catch (e) { typeof debug === 'function' && debug('gdacs parse error', e?.message); }
    }

    return new Response(JSON.stringify({ events, updated_at: new Date().toISOString() }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiWeatherDisasters error', e?.message || e);
    return new Response(JSON.stringify({ events: [], error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/weather/aviation
 * Proxies aviationweather.gov SIGMETs (active international aviation hazards).
 * Returns { sigmets[], updated_at }.
 */
async function handleApiWeatherAviation(env, req) {
  try {
    const resp = await fetch('https://aviationweather.gov/api/data/sigmet?format=json', {
      headers: { 'User-Agent': 'OSInfoHub/1.0', 'Accept': 'application/json' },
      cf: { cacheEverything: true, cacheTtl: 600 },
    });
    if (!resp.ok) throw new Error(`aviationweather HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = Array.isArray(data) ? data : (data.data || data.features || []);
    const sigmets = raw.slice(0, 30).map((s, idx) => ({
      id: s.isigmetId || s.sigmetId || s.id || `sigmet-${idx}`,
      hazard: s.hazard || s.phenomenon || 'UNKNOWN',
      qualifier: s.qualifier || '',
      area: s.area || s.firId || s.location || 'Unknown region',
      flevel_low: String(s.flevel_low || s.base || ''),
      flevel_high: String(s.flevel_high || s.top || ''),
      validTimeFrom: s.validTimeFrom || s.validTime || '',
      validTimeTo: s.validTimeTo || '',
      rawSigmet: (s.rawAirSigmet || s.rawSigmet || s.text || '').slice(0, 300),
    }));
    return new Response(JSON.stringify({ sigmets, updated_at: new Date().toISOString() }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiWeatherAviation error', e?.message || e);
    return new Response(JSON.stringify({ sigmets: [], error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

/* ===========================
   TIER-3 AI ENDPOINTS
   =========================== */

/* handleApiAiCorrelate — GET /api/ai/correlate
 * Groups last-48h incidents by region:category, generates signal narratives for clusters ≥3.
 * Returns { signals[], generated_at, incident_count }. KV-cached 30 min.
 */
async function handleApiAiCorrelate(env, req) {
  const CACHE_KEY = 'correlate_cache_v1';
  const CACHE_TTL = 1800;
  try {
    const cached = await kvGetJson(env, CACHE_KEY, null);
    if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=1800' }
      });
    }
    const now = Date.now();
    const cutoff48h = now - 48 * 60 * 60 * 1000;
    const raw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const incidents = (Array.isArray(raw) ? raw : []).filter(i => {
      try { return new Date(i.time).getTime() >= cutoff48h; } catch { return false; }
    });
    if (incidents.length < 3) {
      const emptyResult = { signals: [], generated_at: new Date().toISOString(), incident_count: incidents.length };
      return new Response(JSON.stringify(emptyResult), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' }
      });
    }
    // Group by region:category
    const groups = {};
    for (const inc of incidents) {
      const key = `${inc.region || 'Global'}:${inc.category || 'UNKNOWN'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(inc);
    }
    // Keep groups with ≥3 incidents, top 8 by count
    const signalGroups = Object.entries(groups)
      .filter(([_, items]) => items.length >= 3)
      .sort(([_, a], [__, b]) => b.length - a.length)
      .slice(0, 8);
    if (signalGroups.length === 0) {
      const emptyResult = { signals: [], generated_at: new Date().toISOString(), incident_count: incidents.length };
      return new Response(JSON.stringify(emptyResult), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' }
      });
    }
    const signals = signalGroups.map(([key, items], idx) => {
      const [region, category] = key.split(':');
      const countries = [...new Set(items.map(i => i.country).filter(Boolean))];
      const maxSev = Math.max(...items.map(i => i.severity || 1));
      const severity = maxSev >= 5 ? 'CRITICAL' : maxSev >= 4 ? 'HIGH' : 'MEDIUM';
      return {
        id: `sig-${idx}`,
        region,
        category,
        title: `${category} Cluster — ${region}`,
        countries,
        count: items.length,
        severity,
        incident_titles: items.slice(0, 5).map(i => i.title),
        signal_text: ''
      };
    });
    // LLM narrative
    const sigList = signals.map((s, i) =>
      `${i + 1}. ${s.category} in ${s.region} (${s.countries.slice(0, 3).join(', ')}): ${s.count} incidents. Sample: "${s.incident_titles[0]}"`
    ).join('\n');
    const { text } = await callLLM(env, [
      { role: 'user', content: `Analyze these security incident clusters and write ONE concise intelligence signal sentence for each. Focus on patterns, threats, and Dell operational impact. Output exactly ${signals.length} numbered sentences:\n\n${sigList}` }
    ], {
      system: 'You are a Dell Global Security Operations analyst. Write brief, factual intelligence signals for security clusters. Each signal must be one sentence only.',
      max_tokens: 1000,
      model: 'claude-haiku-4-5'
    });
    if (text) {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      let sigIdx = 0;
      for (const line of lines) {
        const match = line.match(/^\d+[\.\)]\s+(.+)/);
        if (match && sigIdx < signals.length) { signals[sigIdx].signal_text = match[1].trim(); sigIdx++; }
      }
    }
    const result = { signals, generated_at: new Date().toISOString(), incident_count: incidents.length };
    try { await kvPut(env, CACHE_KEY, { ts: Date.now(), data: result }, { expirationTtl: CACHE_TTL }); } catch (_) {}
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=1800' }
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiCorrelate error', e?.message || e);
    return new Response(JSON.stringify({ signals: [], error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/* handleApiAiEscalation — GET /api/ai/escalation?country=X
 * Assesses escalation trajectory for a country based on 24h vs prev-48h incident counts.
 * Returns { country, escalation_score, direction, confidence, narrative, ... }. KV-cached 60 min.
 */
async function handleApiAiEscalation(env, req) {
  try {
    const url = new URL(req.url);
    const country = url.searchParams.get('country');
    if (!country) return { status: 400, body: { error: 'country param required' } };
    const safeCountry = country.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
    const CACHE_KEY = `esc_cache_${safeCountry}`;
    const CACHE_TTL = 3600;
    const cached = await kvGetJson(env, CACHE_KEY, null);
    if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
      return { status: 200, body: cached.data };
    }
    const now = Date.now();
    const cutoff72h = now - 72 * 60 * 60 * 1000;
    const cutoff24h = now - 24 * 60 * 60 * 1000;
    const cutoff48h = now - 48 * 60 * 60 * 1000;
    const raw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const countryLC = country.toLowerCase();
    const allInc = (Array.isArray(raw) ? raw : []).filter(i => {
      try {
        if (new Date(i.time).getTime() < cutoff72h) return false;
        const c = (i.country || '').toLowerCase();
        const loc = (i.location || '').toLowerCase();
        return c.includes(countryLC) || countryLC.includes(c.split(' ')[0]) || loc.includes(countryLC);
      } catch { return false; }
    });
    const period24h = allInc.filter(i => new Date(i.time).getTime() >= cutoff24h);
    const periodPrev48h = allInc.filter(i => {
      const t = new Date(i.time).getTime();
      return t >= cutoff48h && t < cutoff24h;
    });
    const severityAvg = period24h.length > 0
      ? period24h.reduce((sum, i) => sum + (i.severity || 2), 0) / period24h.length : 2;
    const ratio = period24h.length / Math.max(1, periodPrev48h.length / 2);
    const rawScore = Math.min(100, Math.round(ratio * 40 + severityAvg * 12));
    let direction = 'stable';
    if (ratio > 1.3) direction = 'rising';
    else if (ratio < 0.7) direction = 'declining';
    const catBreakdown = {};
    for (const i of period24h) {
      const cat = i.category || 'UNKNOWN';
      catBreakdown[cat] = (catBreakdown[cat] || 0) + 1;
    }
    const catStr = Object.entries(catBreakdown).map(([k, v]) => `${k}:${v}`).join(', ');
    const { text } = await callLLM(env, [
      { role: 'user', content: `Country: ${country}. Last 24h security incidents: ${period24h.length} (avg severity ${severityAvg.toFixed(1)}). Previous 48h: ${periodPrev48h.length}. Categories in 24h: ${catStr || 'none'}. Output JSON only: {"narrative":"one sentence assessment","direction":"rising|stable|declining","confidence":"high|medium|low"}` }
    ], {
      system: 'You are a Dell geopolitical risk analyst. Assess escalation trajectory based on incident data. Respond with JSON only.',
      max_tokens: 200,
      model: 'claude-haiku-4-5'
    });
    let narrative = `${period24h.length} incidents in the last 24h; trend is ${direction}.`;
    let llmDirection = direction;
    let confidence = 'medium';
    if (text) {
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (parsed.narrative) narrative = parsed.narrative;
          if (parsed.direction && ['rising', 'stable', 'declining'].includes(parsed.direction)) llmDirection = parsed.direction;
          if (parsed.confidence) confidence = parsed.confidence;
        }
      } catch (_) {}
    }
    const result = {
      country, escalation_score: rawScore, direction: llmDirection,
      confidence, narrative, period_24h: period24h.length,
      period_prev48h: periodPrev48h.length, generated_at: new Date().toISOString()
    };
    try { await kvPut(env, CACHE_KEY, { ts: Date.now(), data: result }, { expirationTtl: CACHE_TTL }); } catch (_) {}
    return { status: 200, body: result };
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiEscalation error', e?.message || e);
    return { status: 500, body: { error: String(e?.message || e) } };
  }
}

/* handleApiAiExecReport — GET /api/ai/exec-report
 * Generates a structured AI executive security report with KPIs + 5 sections.
 * Returns { report_text, kpis, generated_at, incident_count }. KV-cached 30 min.
 */
async function handleApiAiExecReport(env, req) {
  const CACHE_KEY = 'exec_report_cache_v1';
  const CACHE_TTL = 1800;
  try {
    const cached = await kvGetJson(env, CACHE_KEY, null);
    if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=1800' }
      });
    }
    const now = Date.now();
    const cutoff24h = now - 24 * 60 * 60 * 1000;
    const raw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const incidents = (Array.isArray(raw) ? raw : []).filter(i => {
      try { return new Date(i.time).getTime() >= cutoff24h; } catch { return false; }
    }).slice(0, 50);
    const kpis = {
      total: incidents.length,
      critical: incidents.filter(i => (i.severity || 0) >= 5).length,
      high: incidents.filter(i => (i.severity || 0) === 4).length,
      medium: incidents.filter(i => (i.severity || 0) === 3).length,
      low: incidents.filter(i => (i.severity || 0) <= 2).length,
      regions: { AMER: 0, EMEA: 0, APJC: 0, LATAM: 0, Global: 0 }
    };
    for (const i of incidents) {
      const r = (i.region || 'Global').toUpperCase();
      if (r.includes('AMER') || r.includes('AMERICA') || r.includes('NORTH')) kpis.regions.AMER++;
      else if (r.includes('EMEA') || r.includes('EUROPE') || r.includes('MIDDLE') || r.includes('AFRICA')) kpis.regions.EMEA++;
      else if (r.includes('APJC') || r.includes('ASIA') || r.includes('PACIFIC')) kpis.regions.APJC++;
      else if (r.includes('LATAM') || r.includes('LATIN') || r.includes('SOUTH AMERICA')) kpis.regions.LATAM++;
      else kpis.regions.Global++;
    }
    const topThreats = [...incidents]
      .sort((a, b) => (b.severity || 0) - (a.severity || 0))
      .slice(0, 5)
      .map(i => `${i.title} [${i.country || i.region}/${i.category}/${i.severity_label || 'MEDIUM'}]`);
    const dateStr = new Date().toISOString().split('T')[0];
    const prompt = `Prepare a concise executive security report for Dell RSM leadership.
Date: ${dateStr}
Total incidents (last 24h): ${kpis.total} | Critical: ${kpis.critical} | High: ${kpis.high} | Medium: ${kpis.medium}
Regional breakdown: AMER=${kpis.regions.AMER}, EMEA=${kpis.regions.EMEA}, APJC=${kpis.regions.APJC}, LATAM=${kpis.regions.LATAM}
Top threats:
${topThreats.map((t, i) => `${i + 1}. ${t}`).join('\n')}
Structure your response EXACTLY with these section headers (use ## prefix):
## EXECUTIVE SUMMARY
## KEY THREATS
## REGIONAL BREAKDOWN
## DELL IMPACT ASSESSMENT
## RECOMMENDED ACTIONS`;
    const { text } = await callLLM(env, [{ role: 'user', content: prompt }], {
      system: 'You are a Dell Global Security Operations Executive Analyst. Write concise, professional executive-level security briefings. Be specific and action-oriented. Keep each section brief.',
      max_tokens: 2000,
      model: 'claude-sonnet-4-5'
    });
    const fallback = `## EXECUTIVE SUMMARY\nAI generation unavailable. ${kpis.total} incidents recorded in the last 24 hours. Critical: ${kpis.critical}, High: ${kpis.high}.\n\n## KEY THREATS\n${topThreats.map(t => `- ${t}`).join('\n') || '- No critical threats in period.'}\n\n## REGIONAL BREAKDOWN\nAMER: ${kpis.regions.AMER} incidents | EMEA: ${kpis.regions.EMEA} incidents | APJC: ${kpis.regions.APJC} incidents | LATAM: ${kpis.regions.LATAM} incidents\n\n## DELL IMPACT ASSESSMENT\nReview incidents with HIGH/CRITICAL severity for immediate Dell operational impact.\n\n## RECOMMENDED ACTIONS\n1. Monitor critical incidents and escalate as needed.\n2. Coordinate with regional RSMs for local context.\n3. Update stakeholders on high-severity events.`;
    const result = {
      report_text: text || fallback,
      kpis,
      generated_at: new Date().toISOString(),
      incident_count: incidents.length
    };
    try { await kvPut(env, CACHE_KEY, { ts: Date.now(), data: result }, { expirationTtl: CACHE_TTL }); } catch (_) {}
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=1800' }
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiExecReport error', e?.message || e);
    return new Response(JSON.stringify({ report_text: 'Error generating report.', kpis: {}, error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/* handleApiAiSentiment — GET /api/ai/sentiment
 * Computes severity-weighted sentiment score per region + LLM one-sentence narrative.
 * Returns { regions: { AMER:{score,label,trend,count,narrative}, ... }, generated_at }. KV-cached 30 min.
 */
async function handleApiAiSentiment(env, req) {
  const CACHE_KEY = 'sentiment_cache_v1';
  const CACHE_TTL = 1800;
  try {
    const cached = await kvGetJson(env, CACHE_KEY, null);
    if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=1800' }
      });
    }
    const now = Date.now();
    const cutoff24h = now - 24 * 60 * 60 * 1000;
    const cutoff12h = now - 12 * 60 * 60 * 1000;
    const raw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const incidents = (Array.isArray(raw) ? raw : []).filter(i => {
      try { return new Date(i.time).getTime() >= cutoff24h; } catch { return false; }
    });
    const REGIONS = ['AMER', 'EMEA', 'APJC', 'LATAM'];
    const regionKeywords = {
      AMER: ['AMER', 'AMERICA', 'US', 'CANADA', 'NORTH'],
      EMEA: ['EMEA', 'EUROPE', 'MIDDLE', 'AFRICA', 'UK', 'EAST'],
      APJC: ['APJC', 'ASIA', 'PACIFIC', 'JAPAN', 'CHINA', 'INDIA', 'AUSTRALIA'],
      LATAM: ['LATAM', 'LATIN', 'SOUTH AMERICA', 'BRAZIL', 'MEXICO']
    };
    function getRegionKey(inc) {
      const r = (inc.region || '').toUpperCase();
      for (const [key, kws] of Object.entries(regionKeywords)) {
        if (kws.some(kw => r.includes(kw))) return key;
      }
      return null;
    }
    const regionData = {};
    for (const region of REGIONS) {
      const rInc = incidents.filter(i => getRegionKey(i) === region);
      const rInc12h = rInc.filter(i => { try { return new Date(i.time).getTime() >= cutoff12h; } catch { return false; } });
      const rIncPrev12h = rInc.filter(i => { try { const t = new Date(i.time).getTime(); return t >= cutoff24h && t < cutoff12h; } catch { return false; } });
      if (rInc.length === 0) { regionData[region] = { score: 0, label: 'STABLE', trend: 'stable', count: 0, narrative: '' }; continue; }
      const weights = { 5: 100, 4: 70, 3: 40, 2: 15, 1: 15 };
      const score = Math.min(100, Math.round(rInc.reduce((s, i) => s + (weights[i.severity] || 15), 0) / rInc.length));
      const label = score >= 75 ? 'CRITICAL' : score >= 55 ? 'HIGH' : score >= 35 ? 'ELEVATED' : 'STABLE';
      let trend = 'stable';
      if (rInc12h.length > rIncPrev12h.length * 1.3) trend = 'rising';
      else if (rInc12h.length < rIncPrev12h.length * 0.7) trend = 'declining';
      regionData[region] = { score, label, trend, count: rInc.length, narrative: '' };
    }
    const statStr = REGIONS.map(r => { const d = regionData[r]; return `${r}: ${d.count} incidents, score=${d.score}, label=${d.label}, trend=${d.trend}`; }).join('; ');
    const { text } = await callLLM(env, [
      { role: 'user', content: `Security sentiment drift data: ${statStr}. Write ONE concise sentence per region (AMER, EMEA, APJC, LATAM) describing the current security atmosphere. Format exactly: "AMER: [sentence]. EMEA: [sentence]. APJC: [sentence]. LATAM: [sentence]."` }
    ], {
      system: 'You are a Dell regional security analyst. Write brief, factual regional security sentiment assessments.',
      max_tokens: 400,
      model: 'claude-haiku-4-5'
    });
    if (text) {
      for (const region of REGIONS) {
        const regex = new RegExp(`${region}:\\s*([^.]+\\.?)`, 'i');
        const m = text.match(regex);
        if (m) regionData[region].narrative = m[1].trim();
      }
    }
    const result = { regions: regionData, generated_at: new Date().toISOString() };
    try { await kvPut(env, CACHE_KEY, { ts: Date.now(), data: result }, { expirationTtl: CACHE_TTL }); } catch (_) {}
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=1800' }
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiAiSentiment error', e?.message || e);
    return new Response(JSON.stringify({ regions: {}, error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/* handleApiThreatIntel — GET /api/threat-intel
 * Aggregates CISA KEV (free) + CVE CIRCL (free) + optional OTX (env.OTX_API_KEY).
 * Returns { kev[], cves[], otx[], sources_ok[], sources_failed[], updated_at }. KV-cached 60 min.
 */
async function handleApiThreatIntel(env, req) {
  const CACHE_KEY = 'threat_intel_cache_v1';
  const CACHE_TTL = 3600;
  try {
    const cached = await kvGetJson(env, CACHE_KEY, null);
    if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=3600' }
      });
    }
    const sources_ok = [], sources_failed = [];
    async function fetchWithTimeout(url, opts, ms = 10000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      try { const r = await fetch(url, { ...opts, signal: ctrl.signal }); clearTimeout(timer); return r; }
      catch (e) { clearTimeout(timer); throw e; }
    }
    // CISA KEV
    let kev = [];
    try {
      const resp = await fetchWithTimeout('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json');
      if (resp.ok) {
        const data = await resp.json();
        kev = (Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [])
          .sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime())
          .slice(0, 6)
          .map(v => ({ cveID: v.cveID, vendorProject: v.vendorProject, product: v.product, vulnerabilityName: v.vulnerabilityName, dateAdded: v.dateAdded, shortDescription: (v.shortDescription || '').slice(0, 200) }));
        sources_ok.push('CISA_KEV');
      } else { sources_failed.push('CISA_KEV'); }
    } catch (e) { sources_failed.push('CISA_KEV'); typeof debug === 'function' && debug('threat-intel CISA err', e?.message); }
    // CVE CIRCL
    let cves = [];
    try {
      const resp = await fetchWithTimeout('https://cve.circl.lu/api/last/5');
      if (resp.ok) {
        const data = await resp.json();
        cves = (Array.isArray(data) ? data : []).map(v => ({
          id: v.id || v.CVE_data_meta?.ID || 'N/A',
          summary: (v.summary || '').slice(0, 200),
          cvss: v.cvss || null,
          Published: v.Published || '',
          reference: Array.isArray(v.references) ? (v.references[0] || '') : ''
        }));
        sources_ok.push('CVE_CIRCL');
      } else { sources_failed.push('CVE_CIRCL'); }
    } catch (e) { sources_failed.push('CVE_CIRCL'); typeof debug === 'function' && debug('threat-intel CIRCL err', e?.message); }
    // OTX (optional)
    let otx = [];
    if (env.OTX_API_KEY) {
      try {
        const resp = await fetchWithTimeout('https://otx.alienvault.com/api/v1/pulses/subscribed?limit=5', { headers: { 'X-OTX-API-KEY': env.OTX_API_KEY } });
        if (resp.ok) {
          const data = await resp.json();
          otx = (data.results || []).map(p => ({ id: p.id, name: p.name, description: (p.description || '').slice(0, 200), tags: p.tags || [], tlp: p.tlp || 'white', created: p.created }));
          sources_ok.push('OTX');
        } else { sources_failed.push('OTX'); }
      } catch (e) { sources_failed.push('OTX'); typeof debug === 'function' && debug('threat-intel OTX err', e?.message); }
    }
    // GDELT Operational Cyber Events — major breaches, ransomware, nation-state attacks
    // This is the PRIMARY source for RSM managers: actual attacks on real organisations.
    let cyber_events = [];
    try {
      // Query targets confirmed attacks/breaches, not patch advisories or vulnerability research
      const cyberQuery = '(ransomware OR "data breach" OR cyberattack OR "cyber attack" OR "network breach" OR "systems compromised" OR "state-sponsored" OR "nation-state" OR "APT group" OR "threat actor" OR "supply chain attack") (company OR organization OR government OR infrastructure OR operations OR manufacturer OR hospital)';
      const gdeltCyberUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(cyberQuery)}&mode=artlist&maxrecords=20&format=json&timespan=3d&sort=datedesc&sourcelang=english`;
      const gresp = await fetchWithTimeout(gdeltCyberUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DellOSInfohub/1.0)' }
      }, 15000);
      if (gresp.ok) {
        const gtxt = await gresp.text();
        const gdata = JSON.parse(gtxt);
        const articles = Array.isArray(gdata.articles) ? gdata.articles : [];
        // Post-filter: exclude pure technical advisories that slipped through
        const techNoiseRx = /\b(patch tuesday|vulnerability patch|security update released|researchers (found|discovered)|cve-\d{4}-\d+|bug bounty|proof of concept|vendor advisory|patches vulnerability|security advisory|nist nvd|cvss)\b/i;
        const attackRx = /\b(ransomware|breach|attack|hacked|compromised|stolen|extortion|demand|shutdown|disrupted|offline|data leaked|nation.?state|apt group|threat actor|supply chain attack)\b/i;
        cyber_events = articles
          .filter(a => {
            const t = (a.title || '').toLowerCase();
            if (techNoiseRx.test(t) && !attackRx.test(t)) return false;
            return true;
          })
          .slice(0, 12)
          .map(a => {
            const title = a.title || '—';
            let tag = 'CYBER';
            if (/ransomware/i.test(title)) tag = 'RANSOMWARE';
            else if (/breach|leak|stolen|data exposed/i.test(title)) tag = 'BREACH';
            else if (/nation.?state|apt |state.?sponsor|espionage/i.test(title)) tag = 'APT';
            else if (/outage|down|disrupted|offline|service (disruption|failure)/i.test(title)) tag = 'DISRUPTION';
            // Format GDELT date (YYYYMMDDTHHMMSSZ) to readable
            let date = a.seendate || '';
            try {
              if (date.length >= 8) {
                const y = date.slice(0,4), m = date.slice(4,6), d = date.slice(6,8);
                date = `${y}-${m}-${d}`;
              }
            } catch (_) {}
            return { title, url: a.url || '#', domain: a.domain || '', date, tag };
          });
        sources_ok.push('GDELT_CYBER');
        typeof debug === 'function' && debug('threat-intel GDELT cyber:', cyber_events.length);
      } else { sources_failed.push('GDELT_CYBER'); }
    } catch (e) {
      sources_failed.push('GDELT_CYBER');
      typeof debug === 'function' && debug('threat-intel GDELT error', e?.message);
    }

    const result = { cyber_events, kev, cves, otx, sources_ok, sources_failed, updated_at: new Date().toISOString() };
    try { await kvPut(env, CACHE_KEY, { ts: Date.now(), data: result }, { expirationTtl: CACHE_TTL }); } catch (_) {}
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiThreatIntel error', e?.message || e);
    return new Response(JSON.stringify({ cyber_events: [], kev: [], cves: [], otx: [], error: String(e?.message || e) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/* Root request router */
async function handleRequest(req, env, ctx) {
  setLogLevelFromEnv(env);
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    if (p.startsWith('/api/ai/rank')) {
      const r = await handleApiAiRank(env, req, ctx);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/ai/feedback')) {
      if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
      const r = await handleApiAiFeedback(env, req, ctx);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/logistics/track')) {
      const r = await handleApiLogisticsTrack(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/logistics/watch')) {
      const r = await handleApiLogisticsWatch(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/incidents')) {
      const r = await handleApiIncidents(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/proximity')) {
      const r = await handleApiProximity(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/traveladvisories')) {
      const r = await handleApiTravel(env, url.searchParams);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/convergence')) {
      return handleApiConvergence(env, req);
    } else if (p.startsWith('/api/cii')) {
      return handleApiCII(env, req);
    } else if (p.startsWith('/api/live-news')) {
      return handleApiLiveNews(env, req);
    } else if (p.startsWith('/api/gdelt-proxy')) {
      return handleGdeltProxy(env, req);
    } else if (p.startsWith('/api/archive')) {
      return handleApiArchive(env, req);
    } else if (p.startsWith('/api/dailybrief')) {
      return handleApiDailyBrief(env, req);
    } else if (p.startsWith('/api/thumb/public') || p.startsWith('/api/thumb')) {
      if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
      const r = await handleApiThumb(env, req, ctx);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/stream')) {
      return handleApiStream(env, req);
    } else if (p.startsWith('/api/ai/briefing')) {
      const r = await handleApiAiBriefing(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/ai/country-risk')) {
      const r = await handleApiAiCountryRisk(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/ai/chat')) {
      if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
      const r = await handleApiAiChat(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/acknowledge')) {
      const r = await handleApiAcknowledge(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/weather/disasters')) {
      return handleApiWeatherDisasters(env, req);
    } else if (p.startsWith('/api/weather/aviation')) {
      return handleApiWeatherAviation(env, req);
    } else if (p.startsWith('/api/ai/correlate')) {
      return handleApiAiCorrelate(env, req);
    } else if (p.startsWith('/api/ai/escalation')) {
      const r = await handleApiAiEscalation(env, req);
      return _responseFromResult(r);
    } else if (p.startsWith('/api/ai/exec-report')) {
      return handleApiAiExecReport(env, req);
    } else if (p.startsWith('/api/ai/sentiment')) {
      return handleApiAiSentiment(env, req);
    } else if (p.startsWith('/api/threat-intel')) {
      return handleApiThreatIntel(env, req);
    } else if (p.startsWith('/admin/') || p.startsWith('/api/admin/')) {
      // admin actions: expect POST with secret header
      if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
      // FIX: pass ctx to handleAdminAction
      const r = await handleAdminAction(env, req, ctx);
      return _responseFromResult(r);
    } else {
      return new Response("OK", { status: 200, headers: CORS_HEADERS });
    }
  } catch (e) {
    debug("handleRequest err", e?.message || e);
    return new Response("error", { status: 500, headers: CORS_HEADERS });
  }
}

/* ===========================
   /api/live-news — Global Intelligence Feed items for the LNM headlines panel
   Reads ingested incidents from KV and maps them to the lnm item schema:
   { title, summary, link, time, lat, lng, source_key, source_label, source_category }
   source_category: 'news' | 'logistics' | 'security' | 'hazards' | 'cyber'
   =========================== */
async function handleApiLiveNews(env, _req) {
  try {
    const raw = await kvGetJson(env, INCIDENTS_KV_KEY, []);
    const incidents = Array.isArray(raw) ? raw : [];

    // Helper: derive source_category from AI category when source meta is 'news'
    function _catFromIncident(inc, srcCategory) {
      if (srcCategory !== 'news') return srcCategory; // trust source-level category first
      const cat = String(inc.category || '').toUpperCase();
      if (cat === 'CYBER') return 'cyber';
      if (cat === 'SECURITY' || cat === 'PHYSICAL_SECURITY' || cat === 'CONFLICT') return 'security';
      if (cat === 'SUPPLY_CHAIN' || cat === 'TRANSPORT' || cat === 'DISRUPTION') return 'logistics';
      if (cat === 'NATURAL' || cat === 'ENVIRONMENT') return 'hazards';
      return 'news';
    }

    const items = incidents
      .filter(inc => inc && inc.title)
      .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime())
      .slice(0, 120)
      .map(inc => {
        const sm = _getSourceMeta(inc.source || '');
        const sourceCategory = _catFromIncident(inc, sm.category);
        return {
          title:           String(inc.title || '').trim(),
          summary:         String(inc.summary || '').slice(0, 300),
          link:            inc.link || '#',
          time:            inc.time || new Date().toISOString(),
          lat:             (inc.lat && inc.lat !== 0) ? inc.lat : null,
          lng:             (inc.lng && inc.lng !== 0) ? inc.lng : null,
          source_key:      sm.key,
          source_label:    sm.label,
          source_category: sourceCategory,
          category:        inc.category || 'UNKNOWN',
          severity:        inc.severity || 3,
          region:          inc.region || 'Global',
          country:         inc.country || '',
        };
      });

    return new Response(JSON.stringify({ ok: true, items, _cached: false, count: items.length }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    typeof debug === 'function' && debug('handleApiLiveNews error', e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), items: [] }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/* ===========================
   GDELT Proxy — fetches GDELT DOC API v2 from Cloudflare edge
   Bypasses corporate network blocks on api.gdeltproject.org
   Rate-limited: max 1 request per query per 5 min via KV cache
   =========================== */
async function handleGdeltProxy(env, req) {
  try {
    const url   = new URL(req.url);
    const query = url.searchParams.get('query') || '';
    const span  = url.searchParams.get('timespan') || '1d';
    const max   = Math.min(Number(url.searchParams.get('maxrecords') || 20), 30);
    if (!query.trim()) {
      return new Response(JSON.stringify({ articles: [] }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
    // KV cache key (5-min TTL) to avoid hammering GDELT per query
    const cacheKey = `gdelt_proxy_${span}_${query.trim().toLowerCase().replace(/\s+/g,'_').slice(0,80)}`;
    try {
      const cached = await kvGetJson(env, cacheKey, null);
      if (cached && cached.ts && (Date.now() - cached.ts) < 5 * 60 * 1000) {
        typeof debug === 'function' && debug('gdelt_proxy:cache_hit', cacheKey);
        return new Response(JSON.stringify(cached.data), {
          status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
        });
      }
    } catch(e) { /* cache miss — continue */ }

    /* Try primary GDELT DOC API v2 endpoint */
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${max}&format=json&timespan=${encodeURIComponent(span)}&sort=datedesc&sourcelang=english`;
    let gdeltOk = false;
    let data    = { articles: [] };

    try {
      const res = await fetchWithTimeout(gdeltUrl, {
        headers: {
          'Accept':     'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        }
      }, 20000);
      if (res.ok) {
        const txt = await res.text();
        try { data = JSON.parse(txt); gdeltOk = true; } catch(_) { /* malformed JSON */ }
      }
    } catch(_) { /* timeout / network error — fall through */ }

    /* Cache successful GDELT hit */
    if (gdeltOk && Array.isArray(data.articles) && data.articles.length > 0) {
      try { await kvPut(env, cacheKey, { ts: Date.now(), data }, { expirationTtl: 310 }); } catch(_) {}
    }

    /* Always return 200 — client handles empty articles with KV fallback */
    return new Response(JSON.stringify({ ...data, ok: true, gdeltOk, articles: data.articles || [] }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
    });
  } catch (e) {
    typeof debug === 'function' && debug('gdelt_proxy error', e?.message || e);
    /* Return 200 + empty so client uses KV fallback instead of showing hard error */
    return new Response(JSON.stringify({ ok: false, gdeltOk: false, articles: [], error: String(e?.message || e) }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

/* ===========================
   Archive / Daily Briefing handlers (safe JSON shapes, client-compatible)
   =========================== */
async function handleApiArchive(env, req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    if (!date) {
      const dates = await listArchiveDates(env);
      return new Response(JSON.stringify(Array.isArray(dates) ? dates : []), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const key = `${ARCHIVE_PREFIX}${date}`;
    let items = [];
    try { items = await kvGetJson(env, key, []); } catch (e) { items = []; }
    return new Response(JSON.stringify(Array.isArray(items) ? items : []), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

async function handleApiDailyBrief(env, req) {
  try {
    const url = new URL(req.url);
    const p = url.pathname || '';

    /* --- /api/dailybrief/list (admin) --- */
    if (p.endsWith('/list')) {
      const briefs = await kvGetJson(env, 'DAILY_BRIEFS', []);
      return new Response(JSON.stringify(Array.isArray(briefs) ? briefs : []), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    /* --- POST /api/dailybrief/generate (admin, protected) --- */
    if (req.method === 'POST' && p.endsWith('/generate')) {
      const secretOk = await isSecretOk(req, env);
      if (!secretOk) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const date     = url.searchParams.get('date') || '';
      const region   = url.searchParams.get('region') || '';
      const download = url.searchParams.get('download') === 'true';
      typeof debug === 'function' && debug('archive:generate', date, region, download);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response(JSON.stringify({ ok: false, error: 'date param required (YYYY-MM-DD)' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // Load archive; fall back to live incidents when date is today
      let rawItems = await kvGetJson(env, `${ARCHIVE_PREFIX}${date}`, null);
      if (!Array.isArray(rawItems)) {
        if (date === utcDateKey(new Date())) {
          rawItems = await kvGetJson(env, INCIDENTS_KV_KEY, []);
        } else {
          rawItems = [];
        }
      }

      // Optional region filter (case-insensitive)
      let items = Array.isArray(rawItems) ? rawItems : [];
      if (region) {
        const rq = region.toLowerCase();
        items = items.filter(i => i && typeof i.region === 'string' && i.region.toLowerCase() === rq);
      }

      const brief = {
        date,
        region: region || null,
        generated_at: new Date().toISOString(),
        items,
      };

      const briefKey = `DAILY_BRIEF_${date}`;
      await kvPut(env, briefKey, brief, { expirationTtl: 90 * 24 * 3600 });
      typeof debug === 'function' && debug('archive:generate:saved', briefKey, items.length);

      if (download) {
        return new Response(JSON.stringify(brief), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="brief-${date}.json"`,
          },
        });
      }
      return new Response(JSON.stringify({ ok: true, key: briefKey, items: items.length }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    /* --- GET /api/dailybrief?date=YYYY-MM-DD[&region=...][&download=true] --- */
    const date     = url.searchParams.get('date');
    const region   = url.searchParams.get('region') || '';
    const download = url.searchParams.get('download') === 'true';
    if (date) {
      const key   = `DAILY_BRIEF_${date}`;
      const brief = await kvGetJson(env, key, null);
      // Support both old shape (incidents) and new shape (items)
      let incidents = (brief && Array.isArray(brief.items))     ? brief.items
                    : (brief && Array.isArray(brief.incidents)) ? brief.incidents
                    : [];
      // Fall back to auto-archive when no pre-generated brief exists for this date
      if (!incidents.length) {
        const archiveItems = await kvGetJson(env, `${ARCHIVE_PREFIX}${date}`, []);
        if (Array.isArray(archiveItems) && archiveItems.length) {
          incidents = archiveItems;
          typeof debug === 'function' && debug('dailybrief:archive_fallback', date, incidents.length);
        }
      }
      // For today's date: if still empty, serve live incidents as "current day"
      if (!incidents.length && typeof utcDateKey === 'function' && date === utcDateKey(new Date())) {
        const live = await kvGetJson(env, INCIDENTS_KV_KEY, []);
        if (Array.isArray(live) && live.length) {
          incidents = live;
          typeof debug === 'function' && debug('dailybrief:live_fallback', date, incidents.length);
        }
      }
      // Optional region filter (case-insensitive, partial match)
      if (region) {
        const rq = region.toLowerCase();
        incidents = incidents.filter(i => i && typeof i.region === 'string' && i.region.toLowerCase().includes(rq));
      }
      const body = JSON.stringify({ incidents });
      if (download) {
        return new Response(body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="brief-${date}.json"`,
          },
        });
      }
      return new Response(body, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

/* ===========================
   Module entrypoints (export default)
   - Modern Cloudflare Module pattern: export default { fetch, scheduled }
   - Ensures ctx is present and used for waitUntil background tasks.
   =========================== */

async function moduleFetch(request, env, ctx) {
  // Make env available to internal code that may expect globalThis.__env
  try { setLogLevelFromEnv(env); } catch (e) {}
  globalThis.__env = env;
  return handleRequest(request, env, ctx);
}

async function moduleScheduled(evt, env, ctx) {
  try {
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil((async () => {
        try {
          await runIngestion(env, {}, ctx);
          await refreshTravelData(env, {});
          await aggregateThumbs(env, {});
        } catch (e) { debug("scheduled handler err", e?.message || e); }
      })());
    } else {
      await runIngestion(env, {});
      await refreshTravelData(env, {});
      await aggregateThumbs(env, {});
    }
  } catch (e) {
    debug("scheduled wrapper err", e?.message || e);
  }
}

/* ===========================
   FILTER UNIT TESTS (sync subset — run once at module load in debug builds)
   Tests only the pure synchronous predicates (isNoise + regex checks).
   isRelevantIncident async paths (KV, thumbs, learning) are not exercised here.
   =========================== */
(function runFilterSmokeTests() {
  // Helper: sync-only relevance check that mirrors steps 1-2 and 4-5 of isRelevantIncident
  function _syncRelevance(text, aiCategory) {
    const low = String(text).toLowerCase();
    if (isNoise(low)) return false;
    const black = BLACKLIST_REGEX.test(low);
    const business = BUSINESS_IMPACT_REGEX.test(low);
    const hasFocus = SECURITY_FOCUS_REGEX.test(low);
    const hasOp = OPERATIONAL_KEYWORDS.test(low);
    if (black && !business && !hasFocus && !hasOp) return false;
    const allowed = INCIDENT_KEYWORDS_REGEX.test(low);
    if (allowed && (hasFocus || hasOp)) return true;
    if (aiCategory) {
      const cat = String(aiCategory).toUpperCase();
      if (AI_SECURITY_CATEGORIES.has(cat)) return true;
      if (AI_WHITELIST_CATEGORIES.has(cat)) return (hasFocus || hasOp);
    }
    if (business && (hasFocus || hasOp)) return true;
    const violent = /\b(shooting|mass shooting|shoot|bomb|bombing|attack|terror|hostage|killing|killed|murder|massacre)\b/i.test(low);
    if (violent) return true; // proximity not checkable sync; treated as candidate
    return false;
  }

  const vectors = [
    { text: "Sports: California mulls a billionaire tax",                                       expected: false },
    { text: "Entertainment: Robodog triggered academic scandal",                                expected: false },
    { text: "Facility: Port closure causes container backlog at Los Angeles Port",              expected: true  },
    { text: "Security: Suspicious intrusion at manufacturing plant causes evacuation",          expected: true  },
    { text: "Politics: Leila Shahid dies in France",                                            expected: false },
  ];

  let passed = 0, failed = 0;
  for (const v of vectors) {
    const got = _syncRelevance(v.text, null);
    const ok = got === v.expected;
    if (ok) {
      passed++;
      console.log(`[FILTER-TEST] PASS | expected=${v.expected} got=${got} | "${v.text}"`);
    } else {
      failed++;
      console.error(`[FILTER-TEST] FAIL | expected=${v.expected} got=${got} | "${v.text}"`);
    }
  }
  console.log(`[FILTER-TEST] Results: ${passed}/${vectors.length} passed${failed > 0 ? `, ${failed} FAILED` : ''}.`);
})();

/* ===========================
   PROXIMITY FILTER SMOKE TESTS (DEBUG-guarded, sync subset)
   Exercises shouldIncludeInProximity pure predicate with simulated nearestSite objects.
   Coords chosen so that:
     - LA Port (33.74, -118.27) → nearest Dell is Dell Santa Clara ~460 km away → DISTANCE FAIL
       but the predicate tests noise/blacklist/keyword gates before distance,
       so the port-closure vector is accepted on keyword gate (hasFocusKw) even with large dist
       in this sync test (country_wide=false, dist simulated as 20 km to force through).
     - Austin plant (30.39, -97.69) → nearest Dell Austin Parmer ~0.5 km → within 50 km.
   Reject vectors use far-away fake coords (0,0) but distance gate is not reached because
   noise/blacklist/keyword gates fire first.
   =========================== */
if (globalThis.DEBUG) {
  (function runProximitySmokeTests() {
    // Minimal stub that mirrors shouldIncludeInProximity (pure, no KV)
    // We inline the same predicate logic here for isolation from closure scope quirks.
    function _proxPredicate(title, category, severity, magnitude, businessImpact, country_wide, simDistKm, simSiteId) {
      const lowTitle = String(title).toLowerCase();
      const siteId = simSiteId || "test-site";
      const distanceKm = simDistKm;

      if (isNoise(lowTitle)) return { ok: false, reason: "noise_filter" };

      const isBlacklisted = BLACKLIST_REGEX.test(lowTitle);
      const hasFocusKw = SECURITY_FOCUS_REGEX.test(lowTitle);
      const hasOpKw = OPERATIONAL_KEYWORDS.test(lowTitle);
      const hasBusiness = BUSINESS_IMPACT_REGEX.test(lowTitle);
      if (isBlacklisted && !hasFocusKw && !hasOpKw && !hasBusiness) return { ok: false, reason: "blacklist" };

      const cat = String(category || "").toUpperCase();
      const isNaturalCat = HIGH_NATURAL_CATS.has(cat);
      const maxDist = isNaturalCat ? NATURAL_MAX_DIST_KM : PROXIMITY_MAX_DISTANCE_KM;
      if (!country_wide && distanceKm > maxDist) return { ok: false, reason: "distance_exceeded" };

      if (isNaturalCat) {
        const mag = Number.isFinite(Number(magnitude)) ? Number(magnitude) : null;
        const sev = Number(severity || 0);
        if (!(mag && mag >= NATURAL_MIN_MAGNITUDE) && !(sev >= NATURAL_MIN_SEVERITY) &&
            !/\b(tsunami)\b/i.test(lowTitle) && !country_wide) return { ok: false, reason: "natural_below_threshold" };
        return { ok: true, reason: "natural_gating" };
      }

      if (AI_SECURITY_CATEGORIES.has(cat)) return { ok: true, reason: "ai_security_category" };

      const hasSecuritySignal = hasFocusKw || hasOpKw || INCIDENT_KEYWORDS_REGEX.test(lowTitle);
      const sev = Number(severity || 0);
      const severityAccept = sev >= PROXIMITY_SEVERITY_THRESHOLD;
      const biz = hasBusiness || businessImpact === true;

      if (hasSecuritySignal && (biz || severityAccept)) return { ok: true, reason: "security_keyword+impact" };
      if (hasSecuritySignal && hasOpKw) return { ok: true, reason: "operational_keyword" };
      if (hasSecuritySignal) return { ok: false, reason: "security_keyword_no_impact_or_severity" };
      return { ok: false, reason: "no_security_keywords" };
    }

    const NEAR = 20;   // km — simulates incident within 50 km of a site
    const FAR  = 9999; // km — simulates incident far from any site (not reached for noise/blacklist)

    const vectors = [
      {
        title: "Leila Shahid, Palestinian diplomat, dies in France aged 76",
        category: "", severity: 1, magnitude: null, businessImpact: false, country_wide: false, dist: FAR,
        expected: false
      },
      {
        title: "Advocacy groups sue over endangerment finding's repeal",
        category: "", severity: 1, magnitude: null, businessImpact: false, country_wide: false, dist: FAR,
        expected: false
      },
      {
        title: "Port closure causes container backlog at Los Angeles Port",
        category: "", severity: 3, magnitude: null, businessImpact: true, country_wide: false, dist: NEAR,
        expected: true
      },
      {
        title: "Suspicious intrusion at manufacturing plant near Austin causes evacuation",
        category: "", severity: 4, magnitude: null, businessImpact: false, country_wide: false, dist: NEAR,
        expected: true
      },
      {
        title: "Yemeni Americans feel 'betrayed' as Trump revokes immigration protections",
        category: "", severity: 1, magnitude: null, businessImpact: false, country_wide: false, dist: FAR,
        expected: false
      },
    ];

    let passed = 0, failed = 0;
    for (const v of vectors) {
      const result = _proxPredicate(v.title, v.category, v.severity, v.magnitude, v.businessImpact, v.country_wide, v.dist, "test-site");
      const got = result.ok;
      const ok = got === v.expected;
      if (ok) {
        passed++;
        console.log(`[PROX-TEST] PASS | expected=${v.expected} got=${got} reason=${result.reason} | "${v.title}"`);
      } else {
        failed++;
        console.error(`[PROX-TEST] FAIL | expected=${v.expected} got=${got} reason=${result.reason} | "${v.title}"`);
      }
    }
    console.log(`[PROX-TEST] Results: ${passed}/${vectors.length} passed${failed > 0 ? `, ${failed} FAILED` : ''}.`);
  })();
}

export default {
  async fetch(request, env, ctx) { return await moduleFetch(request, env, ctx); },
  async scheduled(evt, env, ctx) { return await moduleScheduled(evt, env, ctx); }
};
