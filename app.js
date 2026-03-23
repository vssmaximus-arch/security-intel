/* app.js - Dell OS | INFOHUB (FINAL PERFECTED + GPT HARDENED)
   - Restores full CITY_COORDS & COUNTRY_COORDS
   - Restores WORLD_COUNTRIES
   - Restores getRegionByCountry with False Positive Fix
   - Fixes dismissAlertById, updateProximityRadius, manualRefresh robustness
   - FIX: Actually uses correct 'admin-feedback' ID
   - FEATURE: Rich Map Popups & Impact Circles on click (with auto-pan/zoom)
   - HARDENING: Safe IDs, Robust Accessibility, Popup Timing Fallback
*/
 
/* ===========================
   CONFIG
=========================== */
const WORKER_URL = "https://osinfohub.vssmaximus.workers.dev"; 
const AUTO_REFRESH_MS = 300_000; // 5 min — matches SSE retry:300000; incidents ingest is hourly anyway
const DEBUG_UI = (new URLSearchParams(location.search).get('debug') === '1') || (localStorage.getItem('osinfohub_debug') === '1');

/* ===========================
   APP STATE
=========================== */
let INCIDENTS = [];
let PROXIMITY_INCIDENTS = [];
let GLOBAL_DISRUPTIONS = [];
let FEED_IS_LIVE = false;
let FEED_TIME_HOURS = 48; // Default: show last 48h only (0 = All)
let currentRadius = 50;
let DISMISSED_ALERT_IDS = new Set();

try {
  const raw = sessionStorage.getItem('dismissed_prox_alert_ids');
  if (raw) {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(v => DISMISSED_ALERT_IDS.add(String(v)));
  }
} catch(e){}

let TRAVEL_DATA = [];
let TRAVEL_UPDATED_AT = null;

// Map globals
let map, assetsClusterGroup, incidentClusterGroup, criticalLayerGroup;
let mapHighlightLayer  = null; // Stores the active red circle
let _activeMapPopup    = null; // Stores the current open map info popup (clicked marker — stays open)
let _clusterHoverPopup = null; // Stores the transient cluster hover tooltip (separate from clicked popup)

let ADMIN_SECRET = '';
let VOTES_LOCAL = {};
let VOTE_QUEUE = [];

try {
  const rawVotes = localStorage.getItem('os_v1_votes');
  if (rawVotes) VOTES_LOCAL = JSON.parse(rawVotes) || {};
  const rawQueue = localStorage.getItem('os_v1_vote_queue');
  if (rawQueue) VOTE_QUEUE = JSON.parse(rawQueue) || [];
  const ssec = sessionStorage.getItem('admin_secret');
  if (ssec) ADMIN_SECRET = ssec;
} catch(e){}

// AI Relevancy Engine (Initiative 1) — toggle state persisted across sessions
let AI_ENABLED = false;
try { AI_ENABLED = localStorage.getItem('os_ai_enabled') === '1'; } catch(e) {}

// --- Heatmap state ---
let heatLayer = null;
let heatmapEnabled = false;

// --- S2.5 Logistics Drawer state ---
let logisticsDrawerOpen  = false;

// --- S2.5 Logistics Map state ---
let logisticsLayerGroup  = null;  // Leaflet L.layerGroup for logistics markers + hub rings
const LOGISTICS_MARKERS  = new Map(); // id → L.marker for live position updates
let _logisticsPollTimer  = null;  // setInterval handle for 60-second autopoll
let WATCHLIST_CACHE      = [];    // local copy — updated on every render; used for optimistic deletes
let liveTrackState       = { icao24: null, map: null, marker: null, trail: null, trailCoords: [], pollTimer: null };
const _ltmStateCache     = {};  // icao24 → latest state object (avoids JSON-in-HTML-attribute)

// --- Persistent per-browser user identity for dislike personalisation ---
let OSINFO_USER_ID = '';
let DISLIKED_IDS = new Set();

// --- Tier-3 state ---
let supplyChainLayer   = null;
let supplyChainEnabled = false;
let CORRELATION_DATA   = null;
let SENTIMENT_DATA     = null;
let THREAT_INTEL_DATA  = null;
let correlationRefreshTimer = null;
let sentimentRefreshTimer   = null;
let activeThreatTab    = 'cyber'; // Default: operational incidents, not technical KEV

// --- APJC Sub-region state ---
let activeApjcSub = null; // null = "All APJC", otherwise one of the sub-keys below

const APJC_SUB_COUNTRIES = {
  ANZ:          ['AUSTRALIA','NEW ZEALAND','AUS','NZL','AU','NZ','PAPUA NEW GUINEA','FIJI','SOLOMON ISLANDS','VANUATU'],
  GREATER_CHINA:['CHINA','HONG KONG','TAIWAN','MACAU','MACAO','CHN','HKG','TWN','CN','HK','TW'],
  PAN_INDIA:    ['INDIA','IND','IN'],
  JAPAN:        ['JAPAN','JPN','JP'],
  SOUTH_KOREA:  ['SOUTH KOREA','KOREA','KOR','KR','REPUBLIC OF KOREA'],
  MYS_SGP:      ['MALAYSIA','SINGAPORE','MYS','SGP','MY','SG','BRUNEI'],
  SOUTH_ASIA_EM:['BANGLADESH','PAKISTAN','SRI LANKA','NEPAL','MYANMAR','VIETNAM','THAILAND',
                 'PHILIPPINES','INDONESIA','CAMBODIA','LAOS','MONGOLIA','EAST TIMOR','TIMOR-LESTE',
                 'MALDIVES','BHUTAN','BGD','PAK','LKA','NPL','MMR','VNM','THA','PHL','IDN'],
};

function _incidentMatchesApjcSub(incident, sub) {
  if (!sub || sub === 'ALL') return true;
  const countries = APJC_SUB_COUNTRIES[sub];
  if (!countries) return true;
  const c = (incident.country || incident.location || '').toUpperCase().trim();
  return countries.some(alias => c === alias || c.includes(alias) || alias.includes(c));
}

function _setApjcSubNav(visible) {
  const bar = document.getElementById('apjc-subnav');
  if (bar) bar.style.display = visible ? 'flex' : 'none';
  if (!visible) {
    activeApjcSub = null;
    document.querySelectorAll('.apjc-sub-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.sub === 'ALL');
      p.setAttribute('aria-pressed', String(p.dataset.sub === 'ALL'));
    });
  }
}

function toggleApjcSub(sub) {
  activeApjcSub = (sub === 'ALL') ? null : sub;
  document.querySelectorAll('.apjc-sub-pill').forEach(p => {
    const match = (sub === 'ALL') ? (p.dataset.sub === 'ALL') : (p.dataset.sub === sub);
    p.classList.toggle('active', match);
    p.setAttribute('aria-pressed', String(match));
  });
  const active = document.querySelector('.nav-item-custom.active');
  filterNews(active ? active.textContent.trim() : 'APJC');
}

// --- Category Filter state ---
let ACTIVE_CATEGORIES = new Set(); // empty = "All" (no filter active)

/**
 * Maps the Worker-assigned incident category string to one of the 8 canonical
 * filter keys shown in the category bar.  Returns null for unmapped categories
 * (those incidents are hidden when any filter is active).
 */
const CAT_KEY_MAP = {
  DISASTER:       ['NATURAL_DISASTER','EARTHQUAKE','FLOOD','FLOODING','STORM','WILDFIRE',
                   'FIRE','CYCLONE','HURRICANE','TORNADO','WEATHER','TYPHOON',
                   'AVALANCHE','DROUGHT','HEATWAVE','TSUNAMI','LANDSLIDE'],
  SUPPLY_CHAIN:   ['SUPPLY_CHAIN','LOGISTICS','TRADE_DISRUPTION','SHIPPING'],
  PROTESTS:       ['PROTEST','PROTESTS','CIVIL_UNREST','UNREST','DEMONSTRATION',
                   'STRIKE','RIOT','LABOUR_DISPUTE'],
  CYBER:          ['CYBER','CYBERSECURITY','CYBERATTACK','CYBER_ATTACK','RANSOMWARE',
                   'DATA_BREACH'],
  INFRASTRUCTURE: ['INFRASTRUCTURE','OPERATIONAL','FACILITY','POWER','ENERGY_DISRUPTION',
                   'UTILITY','TRANSPORTATION'],
  CONFLICT:       ['CONFLICT','ARMED_CONFLICT','MILITARY','WAR','SECURITY','SHOOTING',
                   'VIOLENCE'],
  TERRORISM:      ['TERRORISM','TERROR','BOMBING','EXPLOSION','ATTACK','IED'],
  POLITICAL:      ['POLITICAL','POLITICAL_INSTABILITY','SANCTIONS','GOVERNMENT',
                   'ELECTION','COUP','DIPLOMATIC'],
};

function getIncidentFilterKey(incidentCategory) {
  const cat = String(incidentCategory || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_').trim();
  if (!cat) return null;
  for (const [key, aliases] of Object.entries(CAT_KEY_MAP)) {
    if (aliases.some(a => cat === a || cat.startsWith(a) || a.startsWith(cat))) return key;
  }
  return null;
}

function filterByCategoryAllowed(incident) {
  if (ACTIVE_CATEGORIES.size === 0) return true; // "All" mode — nothing filtered
  const key = getIncidentFilterKey(incident.category);
  return key ? ACTIVE_CATEGORIES.has(key) : false;
}

function toggleCategoryFilter(cat) {
  if (cat === 'ALL') {
    ACTIVE_CATEGORIES.clear();
  } else {
    if (ACTIVE_CATEGORIES.has(cat)) {
      ACTIVE_CATEGORIES.delete(cat);
    } else {
      ACTIVE_CATEGORIES.add(cat);
    }
  }
  _syncCatPillUI();

  // Re-render the feed with the new filter applied
  const activeEl = document.querySelector('.nav-item-custom.active');
  const region   = activeEl ? activeEl.textContent.trim() : 'Global';
  renderGeneralFeed(region);
  renderProximityAlerts(region);
}

function _syncCatPillUI() {
  document.querySelectorAll('.cat-pill').forEach(pill => {
    const c = pill.dataset.cat;
    const isActive = (c === 'ALL') ? (ACTIVE_CATEGORIES.size === 0) : ACTIVE_CATEGORIES.has(c);
    pill.classList.toggle('active', isActive);
    pill.setAttribute('aria-pressed', String(isActive));
    // Update count badge for non-ALL pills
    if (c && c !== 'ALL') {
      const count = INCIDENTS.filter(i => getIncidentFilterKey(i.category) === c).length;
      let badge = pill.querySelector('.cat-count-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cat-count-badge';
        pill.appendChild(badge);
      }
      badge.textContent = count || '';
      badge.style.display = count ? '' : 'none';
    }
  });
}

function getOrCreateUserId() {
  try {
    let uid = localStorage.getItem('osinfohub_user_id');
    if (!uid) {
      // Generate a random opaque UUID-like token — no PII, no fingerprinting
      uid = 'u_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('osinfohub_user_id', uid);
    }
    return uid;
  } catch(e) { return ''; }
}

try {
  OSINFO_USER_ID = getOrCreateUserId();
  const rawDisliked = localStorage.getItem('osinfohub_disliked_ids');
  if (rawDisliked) {
    const arr = JSON.parse(rawDisliked);
    if (Array.isArray(arr)) arr.forEach(id => DISLIKED_IDS.add(String(id)));
  }
} catch(e) {}

/* Global error handlers */
window.onerror = function(msg, url, line, col, error) {
  console.error("Global Error Caught:", { msg, url, line, col, error });
};
window.addEventListener('unhandledrejection', (ev) => { console.error('Unhandled promise rejection:', ev.reason); });

/* small helpers */
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
let _clusterHoverTimeout = null;

/**
 * Normalize a longitude into [-180, 180).
 * wrapLongitude(190)  === -170
 * wrapLongitude(-190) ===  170
 * wrapLongitude(180)  === -180
 */
function wrapLongitude(lng) {
  const x = ((Number(lng) + 180) % 360 + 360) % 360;
  return x - 180;
}

/* ===========================
   WORLD COUNTRIES (fallback list)
=========================== */
const WORLD_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan",
  "Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi",
  "Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czechia",
  "Denmark","Djibouti","Dominica","Dominican Republic",
  "Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia",
  "Fiji","Finland","France",
  "Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Honduras","Hungary",
  "Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy",
  "Jamaica","Japan","Jordan",
  "Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
  "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
  "Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Macedonia","Norway",
  "Oman",
  "Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal",
  "Qatar",
  "Romania","Russia","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
  "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
  "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan",
  "Vanuatu","Vatican City","Venezuela","Vietnam",
  "Yemen",
  "Zambia","Zimbabwe"
];

/* ===========================
   DELL SITES & ASSETS
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
  { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 },
  { name: "Dell Brisbane", country: "AU", region: "APJC", lat: -27.4698, lon: 153.0251 }
];

const ASSETS = {};
DELL_SITES.forEach(s => { ASSETS[s.name.toLowerCase()] = { name: s.name, lat: Number(s.lat), lng: Number(s.lon), region: s.region, country: s.country }; });

/* ===========================
   CITY_COORDS (common cities; extendable)
   - kept comprehensive (several additional cities).
=========================== */
const CITY_COORDS = {
  "london": {lat:51.5074, lng:-0.1278}, "paris": {lat:48.8566, lng:2.3522},
  "sydney": {lat:-33.8688, lng:151.2093}, "tokyo": {lat:35.6762, lng:139.6503},
  "new york": {lat:40.7128, lng:-74.0060}, "beijing": {lat:39.9042, lng:116.4074},
  "singapore": {lat:1.3521, lng:103.8198}, "dubai": {lat:25.2048, lng:55.2708},
  "mumbai": {lat:19.0760, lng:72.8777}, "delhi": {lat:28.6139, lng:77.2090},
  "bangalore": {lat:12.9716, lng:77.5946}, "moscow": {lat:55.7558, lng:37.6173},
  "kyiv": {lat:50.4501, lng:30.5234}, "shanghai": {lat:31.2304, lng:121.4737},
  "hong kong": {lat:22.3193, lng:114.1694}, "taipei": {lat:25.0330, lng:121.5654},
  "mexico city": {lat:19.4326, lng:-99.1332}, "sao paulo": {lat:-23.5505, lng:-46.6333},
  "jakarta": {lat:-6.2088, lng:106.8456}, "manila": {lat:14.5995, lng:120.9842},
  "bangkok": {lat:13.7563, lng:100.5018}, "seoul": {lat:37.5665, lng:126.9780},
  "kuala lumpur": {lat:3.1390, lng:101.6869}, "brisbane": {lat:-27.4698, lng:153.0251},
  "melbourne": {lat:-37.8136, lng:144.9631}, "auckland": {lat:-36.8485, lng:174.7633},
  "cape town": {lat:-33.9249, lng:18.4241}, "cairo": {lat:30.0444, lng:31.2357},
  "tehran": {lat:35.6892, lng:51.3890}, "riyadh": {lat:24.774265, lng:46.738586},
  "lagos": {lat:6.524379, lng:3.379206}, "nairobi": {lat:-1.2921, lng:36.8219},
  "karachi": {lat:24.8607, lng:67.0011}, "istanbul": {lat:41.0082, lng:28.9784},
  "berlin": {lat:52.52, lng:13.405}, "madrid": {lat:40.4168, lng:-3.7038},
  "rome": {lat:41.9028, lng:12.4964}, "toronto": {lat:43.6532, lng:-79.3832}
  /* extendable */
};

/* ===========================
   COUNTRY_COORDS (restored full list)
   (kept full for robust fallback)
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
   UTILITIES
=========================== */
function escapeHtml(s){ return String(s||'').replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function escapeAttr(s){ return String(s||'').replace(/"/g,"&quot;").replace(/`/g,"&#096;"); }
function safeHref(u){
  try {
    const s = String(u||'').trim();
    if (!s) return "#";
    if (/^(mailto:|tel:)/i.test(s)) return s;
    const url = new URL(s, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return "#";
    return url.href;
  } catch { return "#"; }
}
function shortHost(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch { return "Source"; } }
function safeTime(t){ try { const d=new Date(t); if (isNaN(d.getTime())) return "Recently"; return d.toLocaleString(); } catch { return "Recently"; } }
function parseCoord(v){ const n = (v===null||v===undefined) ? NaN : parseFloat(String(v).trim()); return Number.isFinite(n) ? n : NaN; }

/* ===========================
   REGION HELPERS
=========================== */
const COUNTRY_TO_REGION = (function(){
  const m = {};
  ['us','united states','usa','canada','mx','mexico'].forEach(k => m[k] = 'AMER');
  ['br','brazil','ar','argentina','cl','chile','co','colombia','pe','peru'].forEach(k => m[k] = 'LATAM');
  ['uk','gb','united kingdom','france','de','germany','it','italy','es','spain','nl','netherlands','be','belgium','ie','ireland'].forEach(k => m[k] = 'EMEA');
  ['cn','china','jp','japan','kr','korea','in','india','sg','singapore','au','australia','nz','new zealand','my','malaysia','id','indonesia','ph','philippines','th','thailand','vn','vietnam'].forEach(k => m[k] = 'APJC');
  return m;
})();

function normalizeRegion(raw){
  if (!raw) return 'Global';
  const s = String(raw).trim().toUpperCase();
  if (['GLOBAL','WORLD'].includes(s)) return 'Global';
  if (s.includes('AMER') || s.includes('NORTH AMERICA') || s.includes('UNITED STATES') || s.includes('CANADA')) return 'AMER';
  if (s.includes('LATAM') || s.includes('LATIN')) return 'LATAM';
  if (s.includes('EMEA') || s.includes('EUROPE') || s.includes('AFRICA') || s.includes('MIDDLE EAST')) return 'EMEA';
  if (s.includes('APJC') || s.includes('APAC') || s.includes('ASIA') || s.includes('PACIFIC')) return 'APJC';
  return s;
}

/* ===== RESTORED: getRegionByCountry =====
   Robust inference by country name or code.
*/
function getRegionByCountry(c) {
  if (!c) return null;
  const lower = String(c).toLowerCase().trim();
  if (!lower) return null;

  // direct match
  if (COUNTRY_TO_REGION[lower]) return COUNTRY_TO_REGION[lower];

  // two-letter code fallback (US, IN, CN, etc.)
  const two = lower.length === 2 ? lower : lower.slice(0,2);
  if (COUNTRY_TO_REGION[two]) return COUNTRY_TO_REGION[two];

  // scan keys for substrings (handles "united states of america", "u.s.", etc.)
  for (const k of Object.keys(COUNTRY_TO_REGION)) {
    if (lower.includes(k)) return COUNTRY_TO_REGION[k];
  }

  // try country coords names
  const cut = lower.split(',')[0].trim();
  if (COUNTRY_COORDS[cut]) {
    // heuristics for region mapping
    if (['china','japan','india','australia','singapore','south korea','new zealand','indonesia','philippines','thailand','vietnam','malaysia'].includes(cut)) return 'APJC';
    if (['brazil','argentina','colombia','peru','chile'].includes(cut)) return 'LATAM';
    if (['united states','canada','mexico'].includes(cut)) return 'AMER';
    return 'EMEA';
  }

  return null;
}

/* ===========================
   NORMALISATION
=========================== */
function generateId(item) {
  if (!item) return '';
  if (item.id) return String(item.id);
  const t = String(item.time || item.ts || item.timestamp || "");
  const title = String(item.title || item.link || "");
  // Using stable simpleHash for cleaner IDs, less prone to collisions
  function simpleHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(36);
  }
  return `${simpleHash(title)}_${simpleHash(t)}`;
}

function normaliseWorkerIncident(item) {
  try {
    if (!item || !item.title) return null;
    const title = String(item.title || '').trim();
    if (!title) return null;

    let lat = parseCoord(item.lat);
    let lng = parseCoord(item.lng !== undefined ? item.lng : item.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) {
      const locRaw = String(item.location || item.city || item.country || '').toLowerCase();
      if (locRaw) {
        const key = locRaw.split(',')[0].trim();
        if (key && key.length >= 2 && CITY_COORDS[key]) {
          lat = CITY_COORDS[key].lat; lng = CITY_COORDS[key].lng;
        } else if (key && COUNTRY_COORDS[key]) {
          lat = COUNTRY_COORDS[key].lat; lng = COUNTRY_COORDS[key].lng;
        } else {
          for (const s of DELL_SITES) {
            const sname = s.name.toLowerCase();
            if (sname.includes(key) || key.includes(sname)) {
              lat = Number(s.lat); lng = Number(s.lon); break;
            }
          }
        }
      }
      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && item.country) {
        const cc = String(item.country || '').toLowerCase().split(',')[0].trim();
        if (COUNTRY_COORDS[cc]) { lat = COUNTRY_COORDS[cc].lat; lng = COUNTRY_COORDS[cc].lng; }
      }
    }

    if (!Number.isFinite(lat)) lat = 0;
    if (!Number.isFinite(lng)) lng = 0;

    const severity = Number(item.severity || item.level || 1) || 1;
    let regionCanonical = normalizeRegion(item.region || '');
    if ((!regionCanonical || regionCanonical === 'Global') && item.country) {
      const inferred = getRegionByCountry(item.country);
      if (inferred) regionCanonical = inferred;
    }
    if ((!regionCanonical || regionCanonical === 'Global') && (Number.isFinite(lat) && Number.isFinite(lng))) {
      // rough longitudinal heuristic for APJC
      if (lng >= 60 && lng <= 160) regionCanonical = 'APJC';
    }
    if (!regionCanonical || regionCanonical === '') regionCanonical = 'Global';

    return {
      id: generateId(item),
      title,
      summary: item.summary || item.description || '',
      link: item.link || item.url || '#',
      time: item.time || item.ts || new Date().toISOString(),
      severity,
      severity_label: item.severity_label || (severity >= 5 ? 'CRITICAL' : (severity >= 4 ? 'HIGH' : (severity === 3 ? 'MEDIUM' : 'LOW'))),
      region: regionCanonical,
      country: String(item.country || 'GLOBAL'),
      location: item.location || item.city || '',
      lat: lat,
      lng: lng,
      source: item.source || item.source_name || '',
      distance_km: (item.distance_km != null) ? Number(item.distance_km) : null,
      nearest_site_name: item.nearest_site_name || null,
      country_wide: !!item.country_wide,
      priority: item.priority || null,
      dell_impact: item.dell_impact || null,
      proximity_reason: item.proximity_reason || null,
      prox_category: item.prox_category || null,
      category: String(item.category || item.type || '').toUpperCase()
    };
  } catch(e) {
    console.error('normaliseWorkerIncident error', e, item);
    return null;
  }
}

/* ===========================
   FETCH HELPERS
=========================== */
async function fetchWithTimeout(url, opts = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/* ===========================
   LOAD FROM WORKER
=========================== */
async function loadFromWorker(silent=false) {
  const label = document.getElementById("feed-status-label");
  if (label && !silent) label.textContent = "Refreshing\u2026";
  try {
    const cutoffMs72h = Date.now() - (72 * 3600 * 1000);
    const cutoffMs7d  = Date.now() - (7 * 24 * 3600 * 1000);
    let list;

    if (AI_ENABLED) {
      // AI path: /api/ai/rank returns items pre-sorted by relevance_score desc
      const items = await loadAiRankedFeed({ limit: 50 });
      list = items.map(item => {
        const norm = normaliseWorkerIncident(item);
        if (!norm) return null;
        // Preserve AI scoring fields so renderGeneralFeed can display the badge + brief
        norm.relevance_score   = item.relevance_score;
        norm.canonical_summary = item.canonical_summary || '';
        return norm;
      });
      // AI rank is pre-sorted; do not re-sort by time
    } else {
      // Standard path: /api/incidents sorted by time
      const fetchOpts = OSINFO_USER_ID ? { headers: { 'X-User-Id': OSINFO_USER_ID } } : {};
      const res = await fetchWithTimeout(`${WORKER_URL}/api/incidents`, fetchOpts);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const raw = await res.json();
      list = (Array.isArray(raw) ? raw : []).map(normaliseWorkerIncident);
    }

    const cleanList = list.filter(Boolean).filter(i => !DISLIKED_IDS.has(String(i.id)));

    // Cascading time window: 72h → 7d → all (handles stale but valid KV data)
    let freshList = cleanList.filter(i => {
      try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= cutoffMs72h; } catch { return false; }
    });
    if (freshList.length === 0 && cleanList.length > 0) {
      freshList = cleanList.filter(i => {
        try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= cutoffMs7d; } catch { return false; }
      });
      if (freshList.length === 0) freshList = cleanList;
    }

    // If Worker KV is empty, fall back to news.json (real classified news from GitHub Actions)
    if (freshList.length === 0) {
      try {
        const newsRes = await fetch('public/data/news.json');
        const newsJson = await newsRes.json();
        if (Array.isArray(newsJson) && newsJson.length > 0) {
          freshList = newsJson
            .filter(item => item && item.title)
            .map(item => {
              const rawType = String(item.type || item.category || 'UNKNOWN').toUpperCase();
              let cat = 'SECURITY';
              if (rawType.includes('CYBER')) cat = 'CYBER';
              else if (rawType.includes('NATURAL') || rawType.includes('ENVIRON')) cat = 'NATURAL';
              else if (rawType.includes('SUPPLY') || rawType.includes('LOGISTIC') || rawType.includes('TRANSPORT')) cat = 'TRANSPORT';
              else if (rawType.includes('HEALTH') || rawType.includes('PANDEMIC')) cat = 'HEALTH';
              const sev = Math.min(5, Math.max(1, Number(item.severity) || 3));
              return {
                id: item.url || item.title,
                title: String(item.title).trim(),
                summary: String(item.snippet || item.body || '').slice(0, 300),
                category: cat,
                severity: sev,
                severity_label: sev >= 5 ? 'CRITICAL' : sev >= 4 ? 'HIGH' : sev === 3 ? 'MEDIUM' : 'LOW',
                region: item.region || 'Global',
                country: 'GLOBAL',
                location: 'UNKNOWN',
                link: item.url || '#',
                source: item.source || '',
                time: item.time || new Date().toISOString(),
                lat: 0, lng: 0,
              };
            })
            .filter(i => !DISLIKED_IDS.has(String(i.id)));
          console.log('[Fallback] Loaded', freshList.length, 'items from news.json');
        }
      } catch (_) {}
    }

    INCIDENTS = freshList;
    if (!AI_ENABLED) INCIDENTS.sort((a, b) => new Date(b.time) - new Date(a.time));
    FEED_IS_LIVE = true;
    refreshHeatLayerIfEnabled();
    if (label) label.textContent = `LIVE \u2022 ${INCIDENTS.length} ITEMS`;
  } catch (e) {
    console.error("Worker fetch failed:", e);
    FEED_IS_LIVE = false;
    if (label && !silent) label.textContent = "OFFLINE \u2022 Worker unreachable";
  }
}

async function loadProximityFromWorker(silent=false) {
  try {
    const fetchOpts = OSINFO_USER_ID ? { headers: { 'X-User-Id': OSINFO_USER_ID } } : {};
    const res = await fetchWithTimeout(`${WORKER_URL}/api/proximity`, fetchOpts);
    if (!res.ok) {
      if (!silent) console.warn('Proximity endpoint returned not-ok:', res.status);
      PROXIMITY_INCIDENTS = [];
      return;
    }
    const json = await res.json();
    const list = Array.isArray(json.incidents) ? json.incidents : [];
    const cutoffMs = Date.now() - (48 * 3600 * 1000); // 48h max age for proximity alerts
    // Categories allowed in Proximity: physical/geographic threats only
    const _PROX_ALLOWED_CATS = new Set(['NATURAL_HAZARD','SECURITY','GEOPOLITICAL','SUPPLY_CHAIN','TRANSPORT','INFRASTRUCTURE','PUBLIC_SAFETY','DISRUPTION']);
    PROXIMITY_INCIDENTS = list
      .map(normaliseWorkerIncident)
      .filter(Boolean)
      .filter(i => {
        // 48h hard gate
        try { const t = new Date(i.time).getTime(); if (isNaN(t) || t < cutoffMs) return false; } catch { return false; }
        // Block non-geographic categories — cyber, workforce, unknown are not proximity threats
        const cat = String(i.category || '').toUpperCase();
        if (!_PROX_ALLOWED_CATS.has(cat)) return false;
        return true;
      })
      .filter(i => !DISLIKED_IDS.has(String(i.id))); // client-side dislike guard
    // Global Disruptions (always show — not filtered by radius)
    if (Array.isArray(json.global_disruptions)) {
      GLOBAL_DISRUPTIONS = json.global_disruptions;
    }
    if (!silent) console.log('Loaded proximity items:', PROXIMITY_INCIDENTS.length, '| global disruptions:', GLOBAL_DISRUPTIONS.length);
  } catch(e) {
    console.error('loadProximityFromWorker failed', e);
    PROXIMITY_INCIDENTS = [];
  }
}

/* ===========================
   MAP INIT & CLUSTERING
=========================== */
function getClusterStats(cluster) {
  const children = cluster.getAllChildMarkers ? cluster.getAllChildMarkers() : [];
  let counts = { critical:0, high:0, medium:0, low:0 };
  let maxSeverity = 0;
  children.forEach(m => {
    const s = Number(m.options.severity || 1);
    if (s >= 5) { counts.critical++; maxSeverity = Math.max(maxSeverity, 5); }
    else if (s >= 4) { counts.high++; maxSeverity = Math.max(maxSeverity, 4); }
    else if (s === 3) { counts.medium++; maxSeverity = Math.max(maxSeverity, 3); }
    else { counts.low++; }
  });
  return { counts, maxSeverity, childrenCount: children.length };
}

/* ===========================
   HEATMAP HELPERS (Phase 3)
=========================== */
function SEVERITY_WEIGHT(s) {
  const n = Number(s) || 0;
  return n >= 5 ? 5 : n >= 4 ? 4 : n === 3 ? 2 : 1;
}

function createHeatLayerFromIncidents(list) {
  if (!window.L || !L.heatLayer) return null;
  const points = [];
  for (const i of (list || [])) {
    const lat = Number(i.lat), lng = wrapLongitude(Number(i.lng));
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;
    points.push([lat, lng, SEVERITY_WEIGHT(i.severity)]);
  }
  return L.heatLayer(points, {
    radius: 25, blur: 15, minOpacity: 0.35,
    gradient: { 0.2: '#38761d', 0.4: '#f1c232', 0.6: '#e69138', 0.8: '#cc0000', 1.0: '#9900ff' },
  });
}

function refreshHeatLayerIfEnabled() {
  if (!heatmapEnabled || !map) return;
  if (heatLayer) { try { map.removeLayer(heatLayer); } catch(e){} }
  heatLayer = createHeatLayerFromIncidents(INCIDENTS);
  if (heatLayer) heatLayer.addTo(map);
}

function initMap() {
  if (typeof L === 'undefined') { console.warn('Leaflet not present'); return; }

  const southWest = L.latLng(-85, -179.999);
  const northEast = L.latLng(85, 179.999);
  const bounds = L.latLngBounds(southWest, northEast);

  map = L.map("map", {
    scrollWheelZoom: false,
    zoomControl: false,
    attributionControl: true,
    minZoom: 2,
    maxZoom: 19,
    maxBounds: bounds,
    maxBoundsViscosity: 1.0,
    worldCopyJump: false,
    closePopupOnClick: false   // CRITICAL: default true fires on preclick, closing popup before any guard runs
  }).setView([20, 0], 2);

  L.control.zoom({ position: "topleft" }).addTo(map);

  const esriLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Esri, USGS, NOAA', noWrap: true, bounds: bounds, keepBuffer: 2 }
  );
  const cartoLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { subdomains: "abcd", maxZoom: 19, noWrap: true, bounds: bounds, attribution: '&copy; OpenStreetMap &copy; CARTO', keepBuffer: 2 }
  );

  let esriErrors = 0;
  const ERROR_THRESHOLD = 12;
  esriLayer.on('tileerror', () => {
    esriErrors++;
    if (esriErrors >= ERROR_THRESHOLD && map.hasLayer(esriLayer)) {
      map.removeLayer(esriLayer);
      cartoLayer.addTo(map);
      console.warn('Switched to CartoDB basemap due to Esri errors.');
    }
  });

  esriLayer.addTo(map);

  assetsClusterGroup = L.layerGroup();
  map.addLayer(assetsClusterGroup);

  incidentClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    disableClusteringAtZoom: 13,
    maxClusterRadius: 50,
    zoomToBoundsOnClick: !isTouch,
    zIndexOffset: 1000, // clusters always above Dell site markers (zIndexOffset=0, max zIndex~260)
    iconCreateFunction: function(cluster) {
      const { counts, maxSeverity, childrenCount } = getClusterStats(cluster);
      let cls = 'cluster-blue';
      if (counts.critical + counts.high > 0) cls = (counts.critical > 0) ? 'cluster-red' : 'cluster-amber';
      if (maxSeverity >= 4) cls = 'cluster-red'; else if (maxSeverity === 3) cls = 'cluster-amber';

      const ariaLabel = escapeAttr(`Cluster of ${childrenCount} incidents. ${counts.critical} Critical, ${counts.high} High.`);
      const html = `<div class="cluster-icon ${cls}" tabindex="0" role="button" aria-label="${ariaLabel}" title="${ariaLabel}" style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;"><div class="cluster-count" aria-hidden="true" tabindex="-1">${childrenCount}</div></div>`;
      return L.divIcon({ html, className: '', iconSize: [40,40], iconAnchor: [20,20] });
    }
  });

  incidentClusterGroup.on('clustermouseover', (e) => {
    clearTimeout(_clusterHoverTimeout);
    _clusterHoverTimeout = setTimeout(() => {
      const { counts, childrenCount } = getClusterStats(e.layer);
      const summary = `<b>Cluster: ${childrenCount} Incidents</b><br/>` +
                      (counts.critical ? `<span style="color:#d93025">Critical: ${counts.critical}</span><br/>` : '') +
                      (counts.high ? `<span style="color:#d93025">High: ${counts.high}</span><br/>` : '') +
                      (counts.medium ? `<span style="color:#f9ab00">Medium: ${counts.medium}</span><br/>` : '') +
                      (counts.low ? `<span style="color:#1a73e8">Low: ${counts.low}</span>` : '');
      // Track hover tooltip separately — use addTo() NOT openOn() so it never replaces _activeMapPopup
      // openOn() goes through map.openPopup() which visually replaces the existing popup
      // addTo() adds as an independent layer, both can coexist
      if (_clusterHoverPopup) { try { _clusterHoverPopup.remove(); } catch(_){} _clusterHoverPopup = null; }
      _clusterHoverPopup = L.popup({ closeButton: false, offset: [0, -10], className: 'map-tooltip', autoClose: false })
        .setLatLng(e.layer.getLatLng())
        .setContent(summary)
        .addTo(map);
    }, 80);
  });

  incidentClusterGroup.on('clustermouseout', (e) => {
    clearTimeout(_clusterHoverTimeout);
    // Close ONLY the transient hover tooltip — do NOT call map.closePopup() which would
    // also kill any persistent clicked-marker popup (_activeMapPopup) the user is reading
    if (_clusterHoverPopup) { try { _clusterHoverPopup.remove(); } catch(_){} _clusterHoverPopup = null; }
  });

  incidentClusterGroup.on('clusterclick', (e) => {
    L.DomEvent.stopPropagation(e);
    window._lastMarkerClickMs = Date.now(); // suppress the map click that Leaflet fires after cluster click
    clearTimeout(_clusterHoverTimeout);
    if (_clusterHoverPopup) { try { _clusterHoverPopup.remove(); } catch(_){} _clusterHoverPopup = null; }

    const childMarkers = e.layer.getAllChildMarkers();
    // Large cluster at low zoom → zoom in so user can see individual markers
    if (childMarkers.length > 8 && map.getZoom() < 7) {
      e.layer.zoomToBounds({ padding: [30, 30] });
      return;
    }

    // Build a list popup showing every incident in the cluster.
    // User clicks a row → that incident's full popup opens. No zoom/spiderfy needed.
    const sevColor = (s) => s >= 5 ? '#d93025' : s >= 4 ? '#e37400' : s === 3 ? '#c89f00' : '#1565c0';
    const rows = childMarkers.slice(0, 12).map((m, idx) => {
      const inc = m.options.incidentData;
      if (!inc) return '';
      const sLabel = Number(inc.severity) >= 5 ? 'CRITICAL' : Number(inc.severity) >= 4 ? 'HIGH' : Number(inc.severity) === 3 ? 'MED' : 'LOW';
      const sc = sevColor(Number(inc.severity));
      return `<div style="padding:6px 4px;${idx < Math.min(childMarkers.length,12)-1 ? 'border-bottom:1px solid #eee' : ''};cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background=''" onclick="window.__clusterOpen(${idx})">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;">
          <span style="background:${sc};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;flex-shrink:0">${sLabel}</span>
          <span style="font-size:10px;color:#888;flex-shrink:0">${escapeHtml(String(inc.category||'').replace(/_/g,' '))}</span>
        </div>
        <div style="font-size:12px;font-weight:600;color:#222;line-height:1.3">${escapeHtml((inc.title||'').slice(0,80))}${(inc.title||'').length>80?'…':''}</div>
      </div>`;
    }).join('');
    const moreNote = childMarkers.length > 12 ? `<div style="text-align:center;padding:4px;color:#999;font-size:10px">+${childMarkers.length-12} more — zoom in to see all</div>` : '';

    window.__clusterMarkers = childMarkers;
    window.__clusterOpen = (idx) => {
      // Close list popup and open the individual incident popup
      if (_activeMapPopup) { try { _activeMapPopup.remove(); } catch(_){} _activeMapPopup = null; }
      const m = window.__clusterMarkers[idx];
      if (m) { window._lastMarkerClickMs = Date.now(); m.fire('click'); }
    };

    if (_activeMapPopup) { try { _activeMapPopup.remove(); } catch(_){} _activeMapPopup = null; }
    _activeMapPopup = L.popup({ closeButton: true, autoClose: false, closeOnClick: false, keepInView: true, maxWidth: 350 })
      .setLatLng(e.layer.getLatLng())
      .setContent(`<div style="font-family:'Inter',sans-serif;"><div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#222">📍 ${childMarkers.length} Incidents — click to open</div>${rows}${moreNote}</div>`)
      .openOn(map);
  });

  // Red circle removed on map click only (not on popupclose — that fires during programmatic pan)


  // Click empty map → close popup + remove red circle
  // Guard: Leaflet fires map 'click' even after marker click despite stopPropagation (known bug).
  // Ignore map click if a marker was clicked within the last 500ms.
  map.on('click', () => {
    if (window._lastMarkerClickMs && (Date.now() - window._lastMarkerClickMs) < 500) return;
    map.closePopup();
    if (_activeMapPopup) { try { _activeMapPopup.remove(); } catch(_){} _activeMapPopup = null; }
    if (mapHighlightLayer) { map.removeLayer(mapHighlightLayer); mapHighlightLayer = null; }
  });

  map.addLayer(incidentClusterGroup);
  criticalLayerGroup = L.layerGroup();
  map.addLayer(criticalLayerGroup);

  // S2.5: draw hub geofence rings + init logistics marker layer
  initLogisticsLayer();
}

/* ===========================
   DEBUG OVERLAY
=========================== */
function createAssetsDebugOverlay(){ let d = document.getElementById('assets-debug'); if(!d){ d = document.createElement('div'); d.id = 'assets-debug'; d.className = 'assets-debug'; d.setAttribute('role','status'); d.setAttribute('aria-live','polite'); d.style.display = 'none'; document.body.appendChild(d); } return d; }
function updateAssetsDebugOverlay(info){ if (!DEBUG_UI) return; try{ const d = createAssetsDebugOverlay(); d.style.display = 'block'; d.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Map asset diagnostics</div><div><strong>DELL_SITES:</strong> ${info.dellSites}</div><div><strong>ASSETS keys:</strong> ${info.assetsKeys}</div><div><strong>assets.length:</strong> ${info.assetsLen}</div><div><strong>filtered:</strong> ${info.filteredLen}</div><div style="margin-top:6px;font-weight:700">Sample entries</div><pre>${info.sample}</pre>`; }catch(e){ console.log('updateAssetsDebugOverlay error', e); } }

/* ===========================
   RENDERERS
=========================== */
function renderAssetsOnMap(region) {
  if (!assetsClusterGroup || !map) return;
  assetsClusterGroup.clearLayers();

  const assets = Object.values(ASSETS);
  const filtered = (region === "Global") ? assets : assets.filter(a => a.region === region);

  const sampleText = filtered.slice(0, 8).map(a => `${a.name} -> lat:${String(a.lat)} lng:${String(a.lng)} region:${a.region}`).join('\n');
  updateAssetsDebugOverlay({
    dellSites: DELL_SITES.length,
    assetsKeys: Object.keys(ASSETS).length,
    assetsLen: assets.length,
    filteredLen: filtered.length,
    sample: sampleText || '(no entries)'
  });

  filtered.forEach(a => {
    try {
      const m = L.marker([Number(a.lat), Number(a.lng)], {
        icon: L.divIcon({
          className: 'custom-pin',
          html: '<div class="marker-pin-dell"><i class="fas fa-building" aria-hidden="true"></i></div>',
          iconSize:[30,42],
          iconAnchor:[15,42]
        })
      });
      m.bindTooltip(escapeHtml(a.name), { className: 'map-tooltip', direction: 'top' });
      assetsClusterGroup.addLayer(m);
    } catch(e) {}
  });
}

function renderIncidentsOnMap(region, list) {
  if (!incidentClusterGroup || !criticalLayerGroup || !map) return;
  incidentClusterGroup.clearLayers();
  criticalLayerGroup.clearLayers();

  // Clear any existing highlight circle when switching regions
  if (mapHighlightLayer) {
    map.removeLayer(mapHighlightLayer);
    mapHighlightLayer = null;
  }

  // 48h hard cutoff — never show markers older than 48 hours on the map
  const _map48hCutoff = Date.now() - (48 * 3600 * 1000);
  // Region filter: show region-specific items AND GLOBAL-tagged items (global events affect all RSM regions)
  const data = ((region === "Global") ? list : list.filter(i => i.region === region || i.region === 'GLOBAL' || i.region === 'Global'))
    .filter(i => { try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= _map48hCutoff; } catch(e) { return false; } });
  const proxIds = new Set(PROXIMITY_INCIDENTS.map(i => String(i.id)));

  data.forEach(i => {
    try {
      const sev = Number(i.severity || 1);
      const isProx = proxIds.has(String(i.id));

      // Filter: Only show High/Critical OR Proximity items on the map
      if (sev < 4 && !isProx) return;

      let lat = Number(i.lat), lng = wrapLongitude(Number(i.lng));
      // Fallback coords logic
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) {
        const c = getCoordsForIncident(i);
        if (!c) return;
        lat = c.lat; lng = wrapLongitude(c.lng);
      }

      // Marker Color
      const color = (sev >= 5) ? '#d93025' : (sev >= 4 ? '#d93025' : (sev === 3 ? '#f9ab00' : '#1a73e8'));

      const marker = L.marker([lat, lng], {
        severity: sev,
        incidentData: i,  // stored so cluster popup can list contents on click
        zIndexOffset: 800, // render above Dell site markers (default zIndexOffset=0) so dots are always clickable
        icon: L.divIcon({
          html: `<div class="incident-dot" style="background:${color}; box-shadow: 0 0 6px ${color}; width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,255,255,0.8); cursor:pointer;"></div>`,
          className: '',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      });

      // Accessibility: Ensure markers are keyboard navigable (Fix applied here)
      marker.on('add', () => {
         const el = marker.getElement();
         if (el) {
             el.setAttribute('tabindex', '0');
             el.setAttribute('role', 'button');
             el.setAttribute('aria-label', `Incident: ${i.title}`);
             el.addEventListener('keydown', (ev) => {
                 if (ev.key === 'Enter' || ev.key === ' ') {
                     ev.preventDefault();
                     marker.fire('click');
                 }
             });
         }
      });

      // --- Interaction: click → red circle + standalone popup at coords ---
      // Standalone popup (not bound to marker) is immune to cluster recalculation.
      // Priority label + color — matches proximity alert panel exactly
      const _prioCfg = { P1:{ lbl:'P1 CRITICAL', clr:'#d93025' }, P2:{ lbl:'P2 HIGH', clr:'#e37400' }, P3:{ lbl:'P3 MONITOR', clr:'#c89f00' }, P4:{ lbl:'P4 AWARENESS', clr:'#1565c0' } };
      const _pc = _prioCfg[i.priority] || null;
      const _prioHtml = _pc
        ? `<span style="background:${_pc.clr};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:6px;">${_pc.lbl}</span>`
        : `<span style="color:${color};font-weight:600;font-size:11px;">${escapeHtml(i.severity_label||'')}</span>`;
      // Decode HTML entities in summary before escaping (GDACS/USGS feeds embed &deg; etc.)
      const _decodeEntities = (s) => (s||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&deg;/g,'°').replace(/&nbsp;/g,' ');
      const _cleanSummary = escapeHtml(_decodeEntities(i.summary||'').slice(0,220) + ((i.summary||'').length>220?'…':'')) || 'No details available.';
      const _cleanTitle = escapeHtml((i.title||'').replace(/\.\s*Population\s+affected\b[^.]*\.?\s*$/i,'').trim());
      const popupHtml = `
        <div style="font-family:'Inter',sans-serif;min-width:260px;max-width:310px;">
          <div style="border-left:4px solid ${_pc ? _pc.clr : color};padding-left:8px;margin-bottom:8px;">
            <div style="font-weight:700;color:#333;font-size:14px;line-height:1.3;">${_cleanTitle}</div>
            <div style="margin-top:5px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
              ${_prioHtml}
              <span style="color:#999;font-size:10px;">${escapeHtml(safeTime(i.time))}</span>
            </div>
          </div>
          <div style="background:#f9f9f9;padding:8px;border-radius:4px;font-size:12px;color:#444;line-height:1.4;margin-bottom:8px;">
            ${_cleanSummary}
          </div>
          ${i.nearest_site_name ? `<div style="font-size:11px;margin-bottom:8px;color:#d93025;"><i class="fas fa-bullseye"></i> <strong>${Math.round(i.distance_km||0)}km</strong> to ${escapeHtml(i.nearest_site_name)}</div>` : ''}
          <div style="text-align:right;">
            <a href="${escapeAttr(safeHref(i.link))}" target="_blank" style="background:#0076ce;color:white;padding:4px 10px;border-radius:3px;text-decoration:none;font-size:11px;font-weight:500;">
              Read Source <i class="fas fa-external-link-alt" style="margin-left:3px;"></i>
            </a>
          </div>
        </div>`;

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e); // prevent map click handler from firing
        window._lastMarkerClickMs = Date.now(); // time-guard: suppress map click that Leaflet fires anyway
        // Remove old highlight circle
        if (mapHighlightLayer) { map.removeLayer(mapHighlightLayer); mapHighlightLayer = null; }
        // Draw proximity circle
        let radiusMeters = i.country_wide ? 500000 : (i.distance_km > 0 ? i.distance_km * 1000 : 50000);
        radiusMeters = Math.max(2000, Math.min(radiusMeters, 500000));
        mapHighlightLayer = L.circle([lat, wrapLongitude(lng)], {
          color: '#d93025', fillColor: '#d93025', fillOpacity: 0.15, weight: 1, radius: radiusMeters
        }).addTo(map);
        // Close any existing popup before opening new one
        if (_activeMapPopup) { try { _activeMapPopup.remove(); } catch(_){} _activeMapPopup = null; }
        // Open standalone popup at geographic position — immune to cluster state
        _activeMapPopup = L.popup({ closeButton: true, autoClose: false, closeOnClick: false, keepInView: true, maxWidth: 320 })
          .setLatLng([lat, wrapLongitude(lng)])
          .setContent(popupHtml)
          .openOn(map);
      });
      // ------------------------------------------

      if (sev >= 4) criticalLayerGroup.addLayer(marker);
      else incidentClusterGroup.addLayer(marker);

    } catch (e) { console.error('Marker error', e); }
  });

  try { criticalLayerGroup.bringToFront(); } catch (e) {}
}

/* ===========================
   GENERAL FEED
=========================== */

/**
 * Feed quality gate — returns false for items that should NOT appear in the main feed:
 *  • CISA generic advisories (no Dell / direct-impact relevance)
 *  • Minor natural disasters (severity < 3, no major impact keywords)
 */
// Sources that belong exclusively to the Insider & Leaks tab — exclude from Intelligence feed
const INSIDER_SOURCES = [
  // Direct insider/workforce sites
  'thelayoff.com','glassdoor.com','blind','theladders','levels.fyi','teamblind',
  // Reddit layoff/workforce subreddits — full URL fragment match
  'reddit.com/r/layoffs','reddit.com/r/antiwork','reddit.com/r/cscareerquestions',
  'reddit.com/r/jobs/search','reddit.com/r/dell',
  // Google News layoff/workforce search feeds
  'news.google.com/rss/search?q=dell+layoff','news.google.com/rss/search?q=dell+workforce',
  'news.google.com/rss/search?q=dell+headcount','news.google.com/rss/search?q=dell+breach',
  'news.google.com/rss/search?q=dell+hack','news.google.com/rss/search?q=dell+data+leak',
  'news.google.com/rss/search?q=dell+insider','news.google.com/rss/search?q=%22dell%22+layoff',
  // Google News article redirect URLs — all news.google.com/rss/articles/* links are Dell-insider sourced
  'news.google.com/rss/articles',
];
// Categories assigned by Worker to insider/workforce intel
const INSIDER_CATEGORIES = ['INSIDER','LEAK','WORKFORCE','BRAND_MONITORING','LAYOFF'];
// Workforce/insider keywords — ANY article matching these goes to Insider & Leaks only
// NOTE: \b at end intentionally omitted so plurals (layoffs, reorgs) are caught too
const INSIDER_TITLE_RE = /\b(layoffs?|lay[\s\-]?offs?|laid[\s\-]?off|reorg|headcount|workforce reduction|employees.*volunteer|getting leaner|shrink its|cuts.*jobs?|job cuts?|slash.*jobs?|jobs?.*cut|position.*eliminat|insiders?.*say|whistle.?blow|volunteer.*layoff|plunging.*sales|private cloud portfolio|dell.*cuts|dell.*jobs?|dell.*workforce|dell.*headcount|dell.*layoff|dell.*reorg|dell.*shrink|quietly shrink|shrink.*workforce|10,?000 workers|6,?650 jobs?|13,?000 workers?|latest tech company to slash)\b/i;
// Keywords that qualify as TRULY breaking security/geopolitical news for the breaking bar
const BREAKING_NEWS_RE = /\b(killed|dead|deaths?|casualties|wounded|explosion|bomb(?:ing)?|terror(?:ist|ism)?|attacks?|war|invasion|invad|missile|airstrike|coup|earthquake|tsunami|hurricane|tropical storm|state of emergency|emergency declared|evacuated?|crash(?:ed)?|hijack|shooting|hostage|kidnap|cyber.?attack|data breach|ransomware|critical infrastructure|nuclear|chemical weapon|biological|sanctions|troops|military|warship|fighter.?jet|conflict|blockade|seized|maritime|sabotage|pipeline|cable|port closed|no-fly zone|airspace closed|assassination|assassinat|diplomatic|expelled|detained|arrested|strait|disruption|threat|imminent|escalat|intercept|deployed|naval|submarine|chaos|crisis|alert|shutdown|strikes?|riot|clashes?|gunfire|shelling|drone|intelligence|spy|espionage|hack(?:ed|ers?)?)\b/i;

// Shared financial-article detector used by both the Intel feed and the Breaking ticker
const _FINANCIAL_ONLY_RE = /\b(soaring (memory |chip |nand |dram |stock )?prices?|how the stocks? (can |will )?(handle|fare|react)|stock(s)? (outlook|analysis|forecast|rally|drop)|earnings (beat|miss|report|guidance|preview)|share price (rise|fall|surge|drop|climb)|analyst (target|rating|upgrade|downgrade|price target)|wall street (expects?|sees?|says?)|trading at \$|P\/E ratio|market cap|quarterly (results|earnings|revenue)|memory (chip )?shortage|DRAM prices?|NAND prices?|soaring.*prices?.*stocks?|stocks?.*handle.*threat)\b/i;
function isFinancialOnlyTitle(title) { return _FINANCIAL_ONLY_RE.test(String(title || '')); }

function _feedIncidentFilter(inc) {
  const title = String(inc.title || '');
  const t     = title.toLowerCase();
  const summary = String(inc.summary || '').toLowerCase();
  const srcUrl  = String(inc.source || inc.link || '').toLowerCase();

  // ── Credibility gate — exclude items with no identifiable source or category ──
  const hasRealSource = srcUrl && srcUrl !== 'unknown' && srcUrl.length > 4 && !/^(unknown|n\/a|none|null)$/i.test(srcUrl.trim());
  const cat = String(inc.category || '').toUpperCase();
  const hasRealCategory = cat && cat !== 'UNKNOWN' && cat.length > 1;
  if (!hasRealSource && !hasRealCategory) return false; // no source AND no category = skip
  // UNKNOWN = Worker could not classify into any SRO-relevant category → never show in Intel feed
  if (cat === 'UNKNOWN' || cat === '') return false;

  // ── Insider & Leaks exclusion gate — keep these items only in the Insider & Leaks tab ──
  const isInsiderSource = INSIDER_SOURCES.some(s => srcUrl.includes(s));
  if (isInsiderSource) return false;
  // Reddit is NEVER credible enough for the Intel feed — forum/rumour source
  if (srcUrl.includes('reddit.com') || srcUrl.includes('redd.it')) return false;
  if (INSIDER_CATEGORIES.includes(cat)) return false;
  // ANY workforce/layoff headline → Insider & Leaks only (not just Dell-specific)
  // Covers: "Dell Says Job Cuts Will Continue", "Dell staff not surprised about layoffs", etc.
  if (INSIDER_TITLE_RE.test(title) || INSIDER_TITLE_RE.test(summary)) return false;

  // ── Dell PR / marketing filter — partnership announcements belong in Insider, not Intel feed ──
  // Catches: "Dell joins forces with X", "Dell partners with Y", "Dell unveils new product", etc.
  // EXCEPTION: kept if title also contains a genuine security threat keyword
  const hasThreatKeyword = /\b(breach|hack|attack|ransom|vuln|exploit|threat|crisis|outage|disrupt|leak|sanction|shutdown|critical|incident|fraud|espionage|intrusion|zero.?day)\b/i.test(title);
  if (!hasThreatKeyword && /\bdell\b/i.test(title) && /\b(joins?\s+forces|partnership|partners?\s+with|collaborat|unveils?|launches?|announces?|new\s+(product|service|solution|offering|partner)|expands?\s+(into|its|presence)|strengthens?|strategic\s+alliance|concludes?|innovate|pioneer|leverag)\b/i.test(title)) return false;

  // ── CISA strict gate ────────────────────────────────────────────────────────
  // CISA content is only relevant when it directly names Dell (the company or its
  // products) OR describes a confirmed active nation-state / ransomware attack on
  // critical infrastructure that Dell operates within.
  // Everything else (patch advisories, KEV entries, generic ICS/OT alerts,
  // supply-chain-generic, "critical infrastructure" boilerplate) is filtered out.
  const isCisaContent = /\bcisa\b/i.test(title) || /cisa\.gov/i.test(srcUrl);
  if (isCisaContent) {
    // What we DO want: explicit Dell mention or confirmed active attack with ops impact
    const DELL_NAMED   = /\bdell(\s+(technologies|emc|secureworks|boomi))?|poweredge|powerstore|isilon|avamar|data domain\b/i;
    const ACTIVE_ATTACK = /\b(actively exploited|exploitation detected|exploited in the wild|under active attack|confirmed breach|systems (down|disrupted|offline)|ransomware (attack|group|gang) (targeting|hit|struck|compromised))\b/i;
    const dellHit = DELL_NAMED.test(title) || DELL_NAMED.test(summary);
    const activeHit = ACTIVE_ATTACK.test(title) || ACTIVE_ATTACK.test(summary);
    if (!dellHit && !activeHit) return false;
  }
  // ── /CISA strict gate ───────────────────────────────────────────────────────
  // ── Financial/market-only articles — belong in Markets widget, NOT Intel feed ──
  // Catches: stock price analysis, earnings reports, memory price articles, analyst ratings
  if (isFinancialOnlyTitle(title)) return false;

  // ── Sports / entertainment filter — block regardless of GEOPOLITICAL tag ──
  // Catches sports stories that slip through as GEOPOLITICAL (asylum at Asian Cup etc.)
  const _SPORTS_RE = /\b(asian cup|women's cup|world cup|fifa|football team|soccer|cricket|rugby|tennis|golf|olympic|paralympic|nba|nfl|nhl|formula.?1|f1 race|grand prix|tour de france|wimbledon|champions league|premier league|bundesliga|serie a|la liga|transfer (window|fee)|match(day)?|hat.?trick|goal.?scorer|penalty shootout|athlete|sportsman|sportswoman|player (feted|celebrated|honored|kicked off))\b/i;
  if (_SPORTS_RE.test(title)) return false;

  // Minor natural / weather events — skip unless severity ≥ 3 or major casualties/impact
  const isNat = /\b(earthquake|tremor|flood|hurricane|typhoon|cyclone|tornado|tsunami|eruption|volcano|wildfire|forest fire|bushfire|landslide|avalanche|storm|drought|fire notification|blizzard|mudslide)\b/i.test(title);
  if (isNat && Number(inc.severity || 1) < 3 &&
      !/\b(kill(ed)?|dead|deaths?|casualties|casualty|wounded|devastating|evacuat|state of emergency|disaster declaration|emergency declared)\b/i.test(t)) {
    return false;
  }
  return true;
}

function mapSeverityToLabel(s) {
  const n = Number(s || 1);
  if (n >= 5) return { label: "CRITICAL", badgeClass: "ftag-crit", barClass: "status-bar-crit" };
  if (n >= 4) return { label: "HIGH", badgeClass: "ftag-crit", barClass: "status-bar-crit" };
  if (n === 3) return { label: "MEDIUM", badgeClass: "ftag-warn", barClass: "status-bar-warn" };
  return { label: "LOW", badgeClass: "ftag-info", barClass: "status-bar-info" };
}

function renderGeneralFeed(region) {
  const container = document.getElementById("general-news-feed");
  if (!container) return;
  // Include GLOBAL-tagged incidents in every region view — global events affect all RSM regions
  let rawData = (region === "Global") ? INCIDENTS : INCIDENTS.filter(i => i.region === region || i.region === 'GLOBAL' || i.region === 'Global');
  // APJC sub-region drill-down
  if (region === 'APJC' && activeApjcSub) {
    rawData = rawData.filter(i => _incidentMatchesApjcSub(i, activeApjcSub));
  }
  // Apply time window filter (default 48h — blocks old KV-cached articles)
  const _cutoffMs = FEED_TIME_HOURS > 0 ? Date.now() - FEED_TIME_HOURS * 3600 * 1000 : 0;
  // Apply quality gate, time filter, category filter, then deduplicate by title
  const _seen = new Set();
  const data = rawData
    .filter(inc => {
      if (_cutoffMs === 0) return true;
      try { return new Date(inc.time).getTime() >= _cutoffMs; } catch { return false; }
    })
    .filter(_feedIncidentFilter)
    .filter(filterByCategoryAllowed)
    .filter(inc => {
      const key = String(inc.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (!key || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()); // newest first
  if (!data || data.length === 0) {
    const msg = ACTIVE_CATEGORIES.size > 0
      ? `No incidents match the selected categories for this region.`
      : `No incidents for this region.`;
    container.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">${msg}</div>`;
    return;
  }

  let html = '';
  data.forEach(i => {
    const sevMeta = mapSeverityToLabel(i.severity);
    const id = generateId(i);
    const localVote = VOTES_LOCAL[id] || null;

    // Phase 5: Credibility badge (always shown)
    const credBadge = (typeof window._credBadgeHtml === 'function')
      ? window._credBadgeHtml(i, data)
      : '';

    // AI badge: shown when AI mode is ON and relevance_score is present
    const aiBadge = (AI_ENABLED && i.relevance_score !== undefined)
      ? `<span class="ai-badge" title="AI relevance score"><i class="fas fa-brain" aria-hidden="true"></i> ${Math.round(i.relevance_score * 100)}%</span>`
      : '';

    // AI brief: shown when canonical_summary meaningfully differs from the displayed summary
    // (in tfidf mode they match; in hybrid/llm mode the LLM summary will differ)
    const canonNorm = (i.canonical_summary || '').trim().slice(0, 200);
    const summNorm  = (i.summary || '').trim().slice(0, 200);
    const aiBrief   = (AI_ENABLED && canonNorm && canonNorm !== summNorm)
      ? `<div class="ai-brief">${escapeHtml(canonNorm)}</div>`
      : '';

    html += `
      <div class="feed-card" role="article" data-link="${escapeAttr(safeHref(i.link))}" tabindex="0">
        <div class="feed-status-bar ${sevMeta.barClass}"></div>
        <div class="feed-content">
          <div class="feed-tags">
            <span class="ftag ${sevMeta.badgeClass}">${escapeHtml(sevMeta.label)}</span>
            <span class="ftag ftag-loc" data-action="country-risk" data-country="${escapeAttr(i.country||'GLOBAL')}" title="AI Country Risk" style="cursor:pointer;" role="button" tabindex="0">${escapeHtml((i.country||"GLOBAL").toUpperCase())}</span>
            ${(i.category && i.category.toUpperCase() !== 'UNKNOWN') ? `<span class="ftag ftag-type">${escapeHtml(i.category)}</span>` : ''}
            <span class="feed-region">${escapeHtml(i.region || 'Global')}</span>
            ${credBadge}
            ${aiBadge}
          </div>

          <div class="feed-title">
            <a href="${escapeAttr(safeHref(i.link))}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
              ${escapeHtml(i.title)}
            </a>
          </div>

          <div class="feed-meta">${escapeHtml(safeTime(i.time))} • ${escapeHtml(shortHost(i.source))}</div>
          <div class="feed-desc">${escapeHtml(i.summary || '')}</div>
          ${aiBrief}

          <div class="vote-row" aria-label="Vote buttons" data-ack-id="${escapeAttr(id)}">
            <button type="button" class="btn-vote ${localVote === 'up' ? 'voted-up' : ''}" data-action="vote" data-vote="up" data-id="${escapeAttr(id)}" aria-label="Vote up" title="Helpful">
              <i class="fas fa-thumbs-up" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn-vote ${localVote === 'down' ? 'voted-down' : ''}" data-action="vote" data-vote="down" data-id="${escapeAttr(id)}" aria-label="Vote down" title="Not relevant">
              <i class="fas fa-thumbs-down" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn-ack" data-action="ack-incident" data-id="${escapeAttr(id)}" aria-label="Acknowledge incident" title="Acknowledge this incident">
              <i class="fas fa-check" aria-hidden="true"></i> ACK
            </button>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

/* ===========================
   PROXIMITY / DISMISS
=========================== */
function updateProximityRadius() {
  const el = document.getElementById("proxRadius");
  if (el) currentRadius = parseFloat(el.value) || 50;
  const active = document.querySelector('.nav-item-custom.active');
  const region = active ? active.textContent.trim() : "Global";
  renderProximityAlerts(region);
  // re-render map to reflect radius change
  renderIncidentsOnMap(region, INCIDENTS);
}

function dismissAlertById(id) {
  try {
    const k = String(id || '').trim();
    if (!k) return;
    DISMISSED_ALERT_IDS.add(k);
    sessionStorage.setItem('dismissed_prox_alert_ids', JSON.stringify(Array.from(DISMISSED_ALERT_IDS).slice(0,500)));
    // remove rows from DOM that match this id
    document.querySelectorAll(`[data-id="${escapeAttr(k)}"]`).forEach(btn => {
      const row = btn.closest('.alert-row'); if (row) row.remove();
    });
    // refresh proximity container
    const active = document.querySelector('.nav-item-custom.active');
    renderProximityAlerts(active ? active.textContent.trim() : "Global");
  } catch(e) { console.error('dismissAlertById', e); }
}

function _proxTimeAgo(isoStr) {
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    if (isNaN(diff) || diff < 0) return '';
    const m = Math.floor(diff / 60000);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  } catch(e) { return ''; }
}

function _proxImpactBar(score) {
  if (!score || score <= 0) return '';
  const pct = Math.min(100, Math.max(0, Number(score)));
  const filled = Math.round(pct / 10);
  const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
  const col = pct >= 70 ? '#c5221f' : pct >= 40 ? '#e37400' : '#80868b';
  return `<span style="font-family:monospace;font-size:.68rem;color:${col};letter-spacing:1px;" title="Impact score ${Math.round(pct)}/100">${bar} ${Math.round(pct)}</span>`;
}

function _proxAction(sev, dist, opImpact) {
  if ((sev >= 4 && dist < 30) || (opImpact && dist < 20))
    return { label: '🔴 Alert Security Team', color: '#d93025', bg: 'rgba(211,48,37,.13)' };
  if (sev >= 4 && dist < 100)
    return { label: '🟠 Notify Regional Lead', color: '#f9ab00', bg: 'rgba(249,171,0,.1)' };
  if (sev >= 3 && dist < 50)
    return { label: '🟡 Monitor Closely', color: '#fbbc04', bg: 'rgba(251,188,4,.08)' };
  return { label: '⚪ Awareness Only', color: '#5f6368', bg: 'rgba(95,99,104,.08)' };
}

function _proxCategoryLabel(cat) {
  const map = {
    EARTHQUAKE: '🌍 Earthquake', FLOOD: '🌊 Flood', FIRE: '🔥 Fire',
    STORM: '🌀 Storm', SECURITY: '🛡 Security', TERRORISM: '💥 Terrorism',
    UNREST: '✊ Civil Unrest', PROTEST: '✊ Protest', SHOOTING: '🚨 Shooting',
    CONFLICT: '⚔ Armed Conflict', ACCIDENT: '⚠ Accident', HEALTH: '🏥 Health',
    POLITICAL: '🏛 Political', CYBER: '💻 Cyber', OPERATIONAL: '⚙ Operational',
    HAZMAT: '☣ HAZMAT', SUPPLY: '📦 Supply Chain', NATURAL: '🌍 Natural Hazard',
  };
  const k = String(cat || '').toUpperCase().trim();
  for (const [key, label] of Object.entries(map)) { if (k.includes(key)) return label; }
  return '';
}

/* Smart location extractor — tries location field, country, then parses title/summary */
function _smartLocation(inc) {
  const bad = /^(unknown|global|worldwide|-|)$/i;
  if (inc.location && !bad.test(inc.location.trim())) return inc.location.trim();
  if (inc.country && !bad.test(inc.country.trim())) return inc.country.trim();
  // Try "in [the] [Place]" from title then summary
  for (const src of [inc.title || '', inc.summary || '']) {
    const m = src.match(/\bin\s+(?:the\s+)?([A-Z][A-Za-z'\-\s]+?)(?:\s*[,.|]|\s+(?:after|as|when|where|amid|follow)|$)/);
    if (m) { const loc = m[1].trim().replace(/\s+/g, ' '); if (loc.length > 2 && loc.length < 40) return loc; }
  }
  return null;
}

/* Smart category — falls back to keyword inference when raw category is blank/UNKNOWN */
function _smartCategory(inc) {
  const explicit = _proxCategoryLabel(inc.category);
  if (explicit) return explicit;
  const t = ((inc.title || '') + ' ' + (inc.summary || '')).toLowerCase();
  if (/kill|attack|bomb|shoot|explo|terror|militant|hostage|airstrike|war|conflict/.test(t)) return '⚔ Armed Conflict';
  if (/protest|demonstrat|riot|unrest|civil\s+unrest/.test(t))  return '✊ Civil Unrest';
  if (/earthquake|flood|storm|hurricane|cyclone|wildfire|tsunami|eruption/.test(t)) return '🌍 Natural Hazard';
  if (/hack|cyber|ransom|malware|breach|ddos/.test(t))          return '💻 Cyber';
  if (/supply.chain|logistic|port\s+clos|cargo|freight|sanction/.test(t)) return '📦 Supply Chain';
  if (/fire|blaze|hazmat|chemical/.test(t))                     return '🔥 Fire / HAZMAT';
  return '🛡 Security Incident';
}

function renderProximityAlerts(region) {
  const container = document.getElementById("proximity-alerts-container");
  if (!container) return;

  // Proximity: physical/geographic threats only — block cyber/workforce/unknown categories
  const _PROX_GEO_CATS = new Set(['NATURAL_HAZARD','SECURITY','GEOPOLITICAL','SUPPLY_CHAIN','TRANSPORT','INFRASTRUCTURE','PUBLIC_SAFETY','DISRUPTION']);
  const _prox48hCutoff = Date.now() - (48 * 3600 * 1000);

  let regionFiltered = (region === "Global") ? PROXIMITY_INCIDENTS : PROXIMITY_INCIDENTS.filter(i => i.region === region);
  if (region === 'APJC' && activeApjcSub) {
    regionFiltered = regionFiltered.filter(i => _incidentMatchesApjcSub(i, activeApjcSub));
  }
  // Hard gates: 48h age limit + geographic categories only
  regionFiltered = regionFiltered.filter(i => {
    const cat = String(i.category || '').toUpperCase();
    if (!_PROX_GEO_CATS.has(cat)) return false;
    try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= _prox48hCutoff; } catch { return false; }
  });
  const data = regionFiltered.filter(filterByCategoryAllowed);
  const alerts = [];

  data.forEach(inc => {
    try {
      const key = generateId(inc);
      if (DISMISSED_ALERT_IDS.has(String(key))) return;

      // Resolve nearest Dell site for display
      const coords = (Number.isFinite(Number(inc.lat)) && Number.isFinite(Number(inc.lng)))
        ? { lat: Number(inc.lat), lng: Number(inc.lng) } : getCoordsForIncident(inc);

      const siteDists = coords ? DELL_SITES.map(s => ({
        name: s.name,
        dist: haversineKm(coords.lat, coords.lng, Number(s.lat), Number(s.lon))
      })).sort((a, b) => a.dist - b.dist) : [];

      const nearest = {
        name: inc.nearest_site_name || (siteDists[0] && siteDists[0].name) || 'Unknown Site',
        dist: (inc.distance_km != null) ? Number(inc.distance_km) : (siteDists[0] ? siteDists[0].dist : 9999)
      };

      // TRUST WORKER: Worker uses tiered radii (Natural=500km, Security=100km, Supply Chain=250km).
      // If the Worker assigned a priority, the incident already passed tiered screening — show it.
      // For unscreened incidents (no priority), fall back to the frontend radius slider.
      const workerApproved = !!inc.priority;
      if (!inc.country_wide && !workerApproved && nearest.dist > currentRadius) return;

      alerts.push({ inc, nearest, key });
    } catch(e) {}
  });

  // Sort by priority (P1 first), then distance
  const _prioRank = { P1: 0, P2: 1, P3: 2, P4: 3 };
  alerts.sort((a, b) => {
    const pa = _prioRank[a.inc.priority] ?? 4;
    const pb = _prioRank[b.inc.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return (a.nearest.dist || 0) - (b.nearest.dist || 0);
  });

  if (!alerts.length) {
    container.innerHTML = `<div style="padding:18px 14px;text-align:center;color:#999;font-size:0.78rem;">No active threats within proximity of Dell sites.</div>`;
    renderGlobalDisruptions();
    return;
  }

  const dark    = document.body.classList.contains('dark-mode');
  const bodyBg  = dark ? '#1e2029' : '#ffffff';
  const bodyTxt = dark ? '#c9d1d9' : '#3c4043';
  const divClr  = dark ? '#2a2d35' : '#f0f0f0';
  const lblClr  = dark ? '#e8eaed' : '#202124';
  const metaTxt = dark ? '#9aa0a6' : '#5f6368';

  // Priority config — Everbridge-grade colour coding
  const PRIORITY_CFG = {
    P1: { color: '#d93025', bg: 'rgba(217,48,37,0.13)',  border: '#d93025', label: 'P1 CRITICAL' },
    P2: { color: '#e37400', bg: 'rgba(227,116,0,0.13)',  border: '#e37400', label: 'P2 HIGH'     },
    P3: { color: '#c89f00', bg: 'rgba(249,168,37,0.11)', border: '#c89f00', label: 'P3 MEDIUM'   },
    P4: { color: '#1565c0', bg: 'rgba(21,101,192,0.10)', border: '#4285f4', label: 'P4 LOW'      },
  };

  // Threat category config
  const CAT_CFG = {
    NATURAL_HAZARD: { icon: '🌪️', label: 'Natural Hazard',   color: '#b05e00' },
    SECURITY:       { icon: '⚠️',  label: 'Security',         color: '#c62828' },
    GEOPOLITICAL:   { icon: '🌐',  label: 'Geopolitical',     color: '#6a1b9a' },
    SUPPLY_CHAIN:   { icon: '⚓',  label: 'Supply Chain',     color: '#1565c0' },
    CYBER_SECURITY: { icon: '💻',  label: 'Cyber Security',   color: '#00695c' },
    WORKFORCE:      { icon: '👥',  label: 'Workforce',         color: '#4a148c' },
    UNKNOWN:        { icon: '❓',  label: 'Intelligence Alert',color: '#5f6368' },
  };

  // RSM recommended actions by priority — category-aware
  const _rmAction = (priority, category) => {
    const isHazard = category === 'NATURAL_HAZARD';
    if (priority === 'P1') return isHazard
      ? { label: '🔴 IMMEDIATE — Notify RSM, verify personnel safety in affected region, monitor updates',  color: '#d93025', bg: 'rgba(217,48,37,0.07)'   }
      : { label: '🔴 IMMEDIATE — Brief RSM now, activate BCP review, confirm personnel safety',             color: '#d93025', bg: 'rgba(217,48,37,0.07)'   };
    if (priority === 'P2') return isHazard
      ? { label: '🟠 ELEVATED — Notify RSM, check travel advisories for affected region',                  color: '#e37400', bg: 'rgba(227,116,0,0.07)'   }
      : { label: '🟠 HIGH PRIORITY — Notify RSM, assess personnel & asset exposure within 2h',             color: '#e37400', bg: 'rgba(227,116,0,0.07)'   };
    if (priority === 'P3') return { label: '🟡 MONITOR — Track development, brief RSM at next scheduled cycle',  color: '#c89f00', bg: 'rgba(249,168,37,0.07)'  };
    return                        { label: '🔵 AWARENESS — Log for record, no immediate RSM action required',     color: '#1565c0', bg: 'rgba(21,101,192,0.06)'  };
  };

  container.innerHTML = alerts.slice(0, 25).map(a => {
    const i       = a.inc;
    const sev     = Number(i.severity || 1);
    const isAcked = !!ACK_CACHE[a.key];
    const prio    = i.priority || (sev >= 4 ? 'P2' : sev >= 3 ? 'P3' : 'P4');
    const pcfg    = PRIORITY_CFG[prio] || PRIORITY_CFG.P4;
    const cat     = String(i.category || 'UNKNOWN').toUpperCase();
    const ccfg    = CAT_CFG[cat] || CAT_CFG.UNKNOWN;
    const action  = _rmAction(isAcked ? 'P4' : prio, cat);
    const timeAgo = _proxTimeAgo(i.time);
    const nearStr = i.country_wide ? 'Country-wide' : (a.nearest.dist > 0 ? `${Math.round(a.nearest.dist)} km` : 'Regional');
    const location = _smartLocation(i) || (i.region && i.region !== 'Global' ? i.region : '—');
    // Dell Impact: prefer Groq AI assessment, fall back to article summary
    const dellImpact = i.dell_impact || i.summary || '';
    const firstLink  = (i.link && i.link !== '#') ? (i.link.split(/\s+/).find(u => /^https?:\/\//.test(u)) || '') : '';
    const borderColor = isAcked ? '#2d6a3f' : pcfg.border;
    const ackedBadge  = isAcked
      ? `<span style="font-size:0.67rem;font-weight:800;color:#4caf50;letter-spacing:0.05em;background:rgba(76,175,80,0.15);border:1px solid #4caf50;border-radius:3px;padding:1px 7px;">✓ ACKNOWLEDGED</span>`
      : `<span style="font-size:0.67rem;font-weight:800;color:${pcfg.color};letter-spacing:0.05em;background:${pcfg.bg};border:1px solid ${pcfg.color};border-radius:3px;padding:1px 7px;">${escapeHtml(pcfg.label)}</span>`;

    return `
      <div class="alert-row" style="border:1px solid ${borderColor};border-left:4px solid ${isAcked ? '#4caf50' : pcfg.color};border-radius:6px;margin-bottom:12px;overflow:hidden;background:${bodyBg};box-shadow:0 1px 4px rgba(0,0,0,0.10);${isAcked ? 'opacity:0.78;' : ''}">

        <!-- Priority + Category Header -->
        <div style="padding:7px 12px;display:flex;align-items:center;gap:8px;background:${isAcked ? 'rgba(76,175,80,0.07)' : pcfg.bg};border-bottom:1px solid ${dark ? '#2a2d35' : '#e8eaed'};">
          ${ackedBadge}
          <span style="font-size:0.73rem;color:${ccfg.color};font-weight:600;">${ccfg.icon}&nbsp;${escapeHtml(ccfg.label)}</span>
          ${timeAgo ? `<span style="margin-left:auto;font-size:0.68rem;color:${metaTxt};">🕐 ${escapeHtml(timeAgo)}</span>` : ''}
        </div>

        <!-- Headline -->
        <div style="padding:9px 12px 5px;font-weight:700;font-size:0.82rem;color:${lblClr};line-height:1.4;">
          ${escapeHtml((i.title || '').replace(/\.\s*Population\s+affected\b[^.]*\.?\s*$/i, '').trim())}
        </div>

        <!-- Body -->
        <div style="padding:0 12px 10px;font-size:0.77rem;color:${bodyTxt};line-height:1.65;">

          <!-- Location + Nearest site row -->
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;font-size:0.73rem;color:${metaTxt};padding-bottom:7px;border-bottom:1px solid ${divClr};">
            <span>📍 <strong style="color:${lblClr};">${escapeHtml(location)}</strong></span>
            <span style="color:#9aa0a6;">|</span>
            <span>📌 Nearest Dell site:&nbsp;<strong style="color:${lblClr};">${escapeHtml(a.nearest.name)}</strong>&nbsp;<strong style="color:${prio === 'P1' ? '#d93025' : prio === 'P2' ? '#e37400' : metaTxt};">${escapeHtml(nearStr)}</strong></span>
          </div>

          <!-- Dell Impact Assessment -->
          ${dellImpact ? `
          <div style="background:${dark ? '#161820' : '#f8f9fa'};border-left:3px solid ${isAcked ? '#4caf50' : pcfg.color};border-radius:3px;padding:6px 10px;margin-bottom:8px;font-size:0.75rem;color:${bodyTxt};line-height:1.55;">
            <span style="font-size:0.66rem;font-weight:700;color:${isAcked ? '#4caf50' : pcfg.color};text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:2px;">Dell Impact Assessment</span>
            ${escapeHtml(String(dellImpact).slice(0, 260))}${dellImpact.length > 260 ? '…' : ''}
          </div>` : ''}

          <!-- RSM Recommended Action -->
          <div style="background:${action.bg};border:1px solid ${action.color}33;border-radius:4px;padding:4px 10px;margin-bottom:8px;font-size:0.71rem;color:${action.color};font-weight:700;">
            ${escapeHtml(action.label)}
          </div>

          ${firstLink ? `<div style="margin-bottom:7px;font-size:0.71rem;"><a href="${escapeAttr(firstLink)}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;">🔗 View Source</a></div>` : ''}

          <!-- ACK / Dismiss -->
          <div style="display:flex;gap:8px;padding-top:6px;border-top:1px solid ${divClr};" data-ack-id="${escapeAttr(a.key)}">
            <button type="button" class="btn-ack" data-action="ack-incident"
              data-id="${escapeAttr(a.key)}" aria-label="Acknowledge this alert">
              <i class="fas fa-check" aria-hidden="true"></i> ACK
            </button>
            <button type="button" class="btn-dismiss" data-action="dismiss-alert"
              data-id="${escapeAttr(a.key)}" aria-label="Dismiss this alert">Dismiss</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Always render global disruptions panel below proximity alerts
  renderGlobalDisruptions();
}

/* ===========================
   GLOBAL DISRUPTIONS PANEL
   Shows critical world-impact events from Worker's runGlobalDisruptionScan():
   - Major earthquakes ≥ M6.0 (anywhere — supply chain / personnel risk)
   - Cat 3+ cyclones / super typhoons
   - Strategic strait / chokepoint blockades
   - Tech supply chain escalations (Taiwan, Malaysia, Korea)
=========================== */
function renderGlobalDisruptions() {
  const el = document.getElementById('global-disruptions-container');
  if (!el) return;

  const dark = document.body.classList.contains('dark-mode');
  const bodyBg = dark ? '#1e2029' : '#ffffff';
  const bodyTxt = dark ? '#c9d1d9' : '#3c4043';
  const divClr = dark ? '#2a2d35' : '#eceef2';
  const lblClr = dark ? '#e8eaed' : '#202124';
  const metaTxt = dark ? '#9aa0a6' : '#5f6368';
  const hdrBg = dark ? '#1a1d27' : '#f1f3f4';
  const borderClr = dark ? '#3a3d45' : '#dadce0';

  if (!GLOBAL_DISRUPTIONS || GLOBAL_DISRUPTIONS.length === 0) {
    el.innerHTML = `<div style="padding:10px 0 4px;font-size:0.74rem;color:${metaTxt};text-align:center;">No critical global disruptions detected in the last 48h.</div>`;
    return;
  }

  const TYPE_CONFIG = {
    MAJOR_EARTHQUAKE:       { color: '#b05e00', bg: 'rgba(176,94,0,0.12)', icon: '🌍', label: 'Major Earthquake' },
    MAJOR_CYCLONE:          { color: '#1565c0', bg: 'rgba(21,101,192,0.12)', icon: '🌀', label: 'Major Cyclone / Hurricane' },
    SUPPLY_CHAIN_CHOKEPOINT:{ color: '#6a1b9a', bg: 'rgba(106,27,154,0.12)', icon: '⚓', label: 'Chokepoint / Strait Alert' },
    TECH_SUPPLY_RISK:       { color: '#c62828', bg: 'rgba(198,40,40,0.12)', icon: '💾', label: 'Tech Supply Chain Risk' },
  };

  el.innerHTML = GLOBAL_DISRUPTIONS.slice(0, 8).map(d => {
    const cfg = TYPE_CONFIG[d.type] || { color: '#5f6368', bg: 'rgba(95,99,104,0.1)', icon: '⚠', label: d.type || 'Alert' };
    const sev = Number(d.severity || 3);
    const sevWord = sev >= 5 ? 'CRITICAL' : sev >= 4 ? 'HIGH' : 'MEDIUM';
    const sevColor = sev >= 5 ? '#d93025' : sev >= 4 ? '#e37400' : '#5f6368';
    const magStr = d.magnitude ? ` M${Number(d.magnitude).toFixed(1)}` : '';
    const timeAgo = _proxTimeAgo(d.time);
    const firstLink = (d.link && d.link !== '#') ? (d.link.split(/\s+/).find(u => /^https?:\/\//.test(u)) || '') : '';

    return `
    <div style="border:1px solid ${borderClr};border-left:3px solid ${cfg.color};border-radius:5px;margin-bottom:8px;overflow:hidden;background:${bodyBg};">
      <div style="background:${cfg.bg};padding:7px 11px;display:flex;align-items:center;gap:7px;">
        <span style="font-size:1rem;">${cfg.icon}</span>
        <span style="font-size:0.72rem;font-weight:700;color:${cfg.color};text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(cfg.label)}${magStr}</span>
        <span style="margin-left:auto;font-size:0.68rem;font-weight:700;color:${sevColor};background:rgba(0,0,0,0.06);padding:1px 6px;border-radius:3px;">${sevWord}</span>
      </div>
      <div style="padding:8px 11px;font-size:0.77rem;color:${bodyTxt};line-height:1.5;">
        <div style="font-weight:600;color:${lblClr};margin-bottom:3px;">${escapeHtml(d.title || '')}</div>
        ${d.summary ? `<div style="color:${metaTxt};font-size:0.73rem;margin-bottom:5px;">${escapeHtml(String(d.summary).slice(0, 160))}${d.summary.length > 160 ? '…' : ''}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.7rem;color:${metaTxt};">
          ${d.location ? `<span>📍 ${escapeHtml(d.location)}</span>` : ''}
          ${timeAgo ? `<span>🕐 ${timeAgo}</span>` : ''}
          ${firstLink ? `<a href="${escapeAttr(firstLink)}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;text-decoration:none;">🔗 Source</a>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ===========================
   TRAVEL ADVISORY + NEWS
=========================== */
async function loadTravelAdvisories() {
  const sel = document.getElementById('countrySelect');
  if (!sel) return;
  sel.innerHTML = `<option selected disabled>Loading advisories...</option>`;
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/traveladvisories/live`, {}, 12000);
    if (res && res.ok) {
      const data = await res.json();
      // Worker returns { advisories: [...], updated_at: "..." } — unpack the array
      TRAVEL_DATA = Array.isArray(data.advisories) ? data.advisories : (Array.isArray(data) ? data : []);
      TRAVEL_UPDATED_AT = (data && data.updated_at) ? data.updated_at : new Date().toISOString();
    }
  } catch(e){
    console.warn('worker traveladvisories/live failed', e);
  }

  // populate with WORLD_COUNTRIES
  sel.innerHTML = `<option selected disabled>Select Country...</option>` + WORLD_COUNTRIES.map(c => `<option value="${escapeAttr(c.toLowerCase())}">${escapeHtml(c)}</option>`).join('');
}

function getTravelNewsForCountry(country, limit=5) {
  if (!country) return [];
  const c = String(country || '').toLowerCase();
  // Client-side 72h guard — matches worker PROXIMITY_WINDOW_HOURS
  const cutoffMs = Date.now() - (72 * 3600 * 1000);
  const matches = INCIDENTS
    .filter(i => {
      try {
        const tMs = new Date(i.time).getTime();
        if (isNaN(tMs) || tMs < cutoffMs) return false;
      } catch (e) { return false; }
      const incCountry = (typeof i.country === 'string' ? i.country : '').toLowerCase();
      const loc = (typeof i.location === 'string' ? i.location : '').toLowerCase();
      const title = (typeof i.title === 'string' ? i.title : '').toLowerCase();
      return incCountry.includes(c) || loc.includes(c) || title.includes(c);
    })
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, limit);
  return matches.map(i => ({ title: i.title, summary: i.summary, time: i.time, severity: i.severity, link: i.link }));
}

async function filterTravel() {
  const country = document.getElementById('countrySelect')?.value || '';
  const cont = document.getElementById('travel-advisories');
  const newsCont = document.getElementById('travel-news');
  if (cont) cont.innerHTML = "Loading…";
  if (newsCont) newsCont.innerHTML = "";
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/traveladvisories?country=${encodeURIComponent(country)}`, {}, 12000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const adv = data.advisory || data || {};
    const level = Number(adv.level || adv.risk_level || 1);
    // Color mapping: Level 1 = green, 2 = blue, 3 = amber, 4+ = red
    const badgeColor = (level >= 4) ? '#d93025' : (level === 3 ? '#f9ab00' : (level === 2 ? '#1a73e8' : '#137333'));
    const bgColor = (level === 1) ? '#e6f4ea' : (level >= 4 ? '#fce8e6' : (level === 3 ? '#fff4e5' : '#eef7ff'));
    if (cont) cont.innerHTML = `
      <div class="advisory-box" style="background:${bgColor}; border-color:${badgeColor};">
        <div class="advisory-header">
          <div class="advisory-label">OFFICIAL US/AU GOVT ADVISORY</div>
          <div class="advisory-level-badge" style="background:${badgeColor};">LEVEL ${escapeHtml(String(level))}</div>
        </div>
        <div class="advisory-text">${escapeHtml(adv.text || adv.advice || adv.summary || 'No major advisory.')}</div>
        <div class="advisory-updated">Updated: ${escapeHtml(adv.updated || TRAVEL_UPDATED_AT || 'Unknown')}</div>
      </div>
    `;
    const news = getTravelNewsForCountry(country, 5);
    if (newsCont) {
      if (!news || news.length === 0) {
        newsCont.innerHTML = `<div class="safe-box"><i class="fas fa-check-circle safe-icon" aria-hidden="true"></i><div class="safe-text">No specific active incidents logged for ${escapeHtml(country || 'this country')} in the last 72h.</div></div>`;
      } else {
        newsCont.innerHTML = `<div class="news-box-alert"><div class="news-box-header">RECENT INCIDENTS (72h)</div>${news.map(n => `<div class="news-box-item"><div class="news-box-title">${escapeHtml(n.title || '')}</div><div class="news-box-summary">${escapeHtml(n.summary || '')}</div><div style="font-size:11px;color:#6b6b6b;margin-top:4px;">${escapeHtml(safeTime(n.time))}</div></div>`).join('')}</div>`;
      }
    }
  } catch(e) {
    console.error('filterTravel error:', e?.message || e);
    // Try client-side fallback from TRAVEL_DATA (populated by loadTravelAdvisories)
    const cq = (country || '').toLowerCase();
    const fallbackAdv = (TRAVEL_DATA.length && cq)
      ? TRAVEL_DATA.find(a => a && typeof a.country === 'string' && a.country.toLowerCase().includes(cq)) || null
      : null;
    const fLvl = Number((fallbackAdv && fallbackAdv.level) || 1);
    const fBadge = (fLvl >= 4) ? '#d93025' : (fLvl === 3 ? '#f9ab00' : (fLvl === 2 ? '#1a73e8' : '#137333'));
    const fBg = (fLvl === 1) ? '#e6f4ea' : (fLvl >= 4 ? '#fce8e6' : (fLvl === 3 ? '#fff4e5' : '#eef7ff'));
    if (cont) cont.innerHTML = `
      <div class="advisory-box" style="background:${fBg}; border-color:${fBadge};">
        <div class="advisory-header">
          <div class="advisory-label">OFFICIAL US/AU GOVT ADVISORY${fallbackAdv ? ' (CACHED)' : ' — SERVICE DEGRADED'}</div>
          <div class="advisory-level-badge" style="background:${fBadge};">LEVEL ${fLvl}</div>
        </div>
        <div class="advisory-text">${escapeHtml((fallbackAdv && fallbackAdv.text) || 'Advisory service temporarily unreachable. Exercise normal precautions and check official government sources.')}</div>
        <div class="advisory-updated" style="color:#c5221f;font-size:0.72rem;">⚠ Live data unavailable — ${escapeHtml(e?.message || 'network error')}</div>
      </div>
    `;
    if (newsCont) newsCont.innerHTML = '';
  }
}

/* ===========================
   COORD HELPERS
=========================== */
function getCoordsForIncident(i) {
  try {
    if (!i) return null;
    const lat = parseCoord(i.lat);
    const lng = parseCoord(i.lng !== undefined ? i.lng : i.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.0001 && Math.abs(lng) > 0.0001) {
      return { lat, lng };
    }
    const locRaw = String(i.location || i.city || '').trim().toLowerCase();
    if (locRaw && locRaw !== 'unknown') {
      const locKey = locRaw.split(',')[0].trim();
      if (locKey.length >= 3) {
        if (CITY_COORDS[locKey]) return { lat: CITY_COORDS[locKey].lat, lng: CITY_COORDS[locKey].lng };
        for (const k of Object.keys(CITY_COORDS)) {
          if (k.length < 3) continue;
          if (locKey.includes(k) || k.includes(locKey)) return { lat: CITY_COORDS[k].lat, lng: CITY_COORDS[k].lng };
        }
        for (const s of DELL_SITES) {
          const sname = s.name.toLowerCase();
          if (sname.includes(locKey) || locKey.includes(sname)) return { lat: s.lat, lng: s.lon };
        }
      }
    }
    const countryRaw = String(i.country || '').trim().toLowerCase();
    if (countryRaw) {
      const cut = countryRaw.split(',')[0].trim();
      for (const [k, v] of Object.entries(COUNTRY_COORDS || {})) {
        if (k === cut || k === countryRaw) return { lat: v.lat, lng: v.lng };
      }
      const cc = countryRaw.slice(0,2).toLowerCase();
      for (const s of DELL_SITES) {
        const sCode = String(s.country || '').toLowerCase();
        if (sCode === countryRaw || (sCode === cc && countryRaw.length >= 2)) return { lat: s.lat, lng: s.lon };
      }
    }
    return null;
  } catch(e) { return null; }
}

/* haversine */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180) *
            Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ===========================
   VOTING
=========================== */
function persistVotes() {
  try { localStorage.setItem('os_v1_votes', JSON.stringify(VOTES_LOCAL)); } catch(e){}
}
function persistVoteQueue() {
  try { localStorage.setItem('os_v1_vote_queue', JSON.stringify(VOTE_QUEUE)); } catch(e){}
}
function persistDislikedIds() {
  try { localStorage.setItem('osinfohub_disliked_ids', JSON.stringify([...DISLIKED_IDS])); } catch(e){}
}

function applyVoteUIForId(id, vote) {
  try {
    document.querySelectorAll(`.btn-vote[data-id="${escapeAttr(id)}"]`).forEach(btn => {
      btn.classList.remove('voted-up','voted-down');
      btn.disabled = false;
    });
    if (!vote) return;
    const selector = `.btn-vote[data-id="${escapeAttr(id)}"][data-vote="${vote}"]`;
    document.querySelectorAll(selector).forEach(b => {
      if (vote === 'up') b.classList.add('voted-up');
      if (vote === 'down') b.classList.add('voted-down');
    });
  } catch(e) {}
}

function markVoteAcceptedLocally(id, vote) {
  try {
    if (!id) return;
    VOTES_LOCAL[id] = vote;
    persistVotes();
    applyVoteUIForId(id, vote);
  } catch(e) {}
}
function removeLocalVote(id) {
  try {
    delete VOTES_LOCAL[id];
    persistVotes();
    applyVoteUIForId(id, null);
  } catch(e){}
}

async function sendVoteToServer(payload) {
  if (!payload || !payload.id) return { ok:false, err:'invalid' };
  const tryEndpoints = [
    `${WORKER_URL}/api/thumb/public`,
    `${WORKER_URL}/api/thumb`
  ];

  for (let i = 0; i < tryEndpoints.length; i++) {
    const url = tryEndpoints[i];
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (OSINFO_USER_ID) headers['X-User-Id'] = OSINFO_USER_ID;
      if (i === 1 && adminGetSecret()) headers.secret = adminGetSecret();
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: payload.id, vote: payload.vote, ts: payload.ts || new Date().toISOString() })
      });
      if (res.ok) {
        // Parse JSON to detect hide:true signal on dislike
        try {
          const json = await res.clone().json();
          return { ok:true, status: res.status, hide: !!json.hide };
        } catch(e) { return { ok:true, status: res.status }; }
      } else {
        if (res.status === 403 && ADMIN_SECRET) {
          try {
            const res2 = await fetch(`${WORKER_URL}/api/thumb`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'secret': ADMIN_SECRET, ...(OSINFO_USER_ID ? {'X-User-Id': OSINFO_USER_ID} : {}) },
              body: JSON.stringify({ id: payload.id, vote: payload.vote, ts: payload.ts || new Date().toISOString() })
            });
            if (res2.ok) {
              try { const j2 = await res2.clone().json(); return { ok:true, status: res2.status, hide: !!j2.hide }; } catch(e) { return { ok:true, status: res2.status }; }
            }
            else return { ok:false, status: res2.status, text: (await res2.text().catch(()=>'')) };
          } catch(e2) { return { ok:false, err:e2 }; }
        }
        const txt = await res.text().catch(()=>'');
        return { ok:false, status: res.status, text: txt };
      }
    } catch (e) {
      if (i === tryEndpoints.length - 1) {
        return { ok:false, err:e };
      } else {
        continue;
      }
    }
  }
  return { ok:false, err:'no-endpoints' };
}

/* ===========================
   AI RANK CLIENT HOOKS (Initiative 1 — Relevancy Engine)
   =========================== */

/**
 * Fetch AI-ranked incidents from GET /api/ai/rank.
 * Falls back to the existing INCIDENTS array if the endpoint is unavailable.
 * @param {object} [opts] - { region, country, limit }
 * @returns {Promise<Array>} - sorted incidents array with relevance_score fields
 */
async function loadAiRankedFeed(opts = {}) {
  try {
    const params = new URLSearchParams();
    if (opts.region)  params.set('region',  opts.region);
    if (opts.country) params.set('country', opts.country);
    if (opts.limit)   params.set('limit',   String(opts.limit));
    const url = `${WORKER_URL}/api/ai/rank${params.toString() ? '?' + params.toString() : ''}`;
    const headers = {};
    if (typeof OSINFO_USER_ID !== 'undefined' && OSINFO_USER_ID) headers['X-User-Id'] = OSINFO_USER_ID;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  } catch (e) {
    console.warn('[AI] loadAiRankedFeed fallback:', e?.message || e);
    return [];
  }
}

/**
 * Send AI feedback (up/down/hide) to POST /api/ai/feedback.
 * @param {string} id     - incident id
 * @param {'up'|'down'|'hide'} action
 * @returns {Promise<{ok:boolean}>}
 */
async function sendAiFeedback(id, action) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (typeof OSINFO_USER_ID !== 'undefined' && OSINFO_USER_ID) headers['X-User-Id'] = OSINFO_USER_ID;
    const res = await fetch(`${WORKER_URL}/api/ai/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: String(id), user_id: (typeof OSINFO_USER_ID !== 'undefined' ? OSINFO_USER_ID : null), action }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return await res.json();
  } catch (e) {
    console.warn('[AI] sendAiFeedback error:', e?.message || e);
    return { ok: false, err: String(e?.message || e) };
  }
}

async function enqueueVote(payload) {
  try {
    VOTE_QUEUE.push(payload);
    persistVoteQueue();
  } catch(e) {}
}

async function flushVoteQueue() {
  if (!VOTE_QUEUE || !VOTE_QUEUE.length) return;
  const queueCopy = VOTE_QUEUE.slice();
  for (let i=0;i<queueCopy.length;i++){
    const p = queueCopy[i];
    try {
      const r = await sendVoteToServer(p);
      if (r.ok) {
        const idx = VOTE_QUEUE.findIndex(q => q.id === p.id && q.ts === p.ts && q.vote === p.vote);
        if (idx >= 0) VOTE_QUEUE.splice(idx,1);
        persistVoteQueue();
      } else {
        console.warn('Queued vote not accepted yet', p, r);
      }
    } catch(e) {
      console.warn('flushVoteQueue error', e);
    }
  }
}

async function voteThumb(id, vote) {
  if (!id || !vote) return;
  markVoteAcceptedLocally(id, vote);

  const payload = { id: String(id), vote: vote, ts: new Date().toISOString() };

  try {
    const res = await sendVoteToServer(payload);
    if (res.ok) {
      // If the server flagged this article as hidden (dislike), remove it immediately
      if (vote === 'down' && res.hide) {
        hideDislikedArticle(String(id));
      }
      // Train the AI relevancy model in the background when AI mode is active
      if (AI_ENABLED) {
        sendAiFeedback(String(id), vote === 'up' ? 'up' : 'down').catch(() => {});
      }
      try { flushVoteQueue(); } catch(e){}
      return;
    } else {
      await enqueueVote(payload);
      adminSetFeedback('Vote queued (will retry).', false);
    }
  } catch(e) {
    await enqueueVote(payload);
    adminSetFeedback('Vote queued (network).', false);
  }
}

/**
 * Immediately hide an article card from the feed UI and persist the dislike
 * in localStorage so it stays hidden after a page reload (before SSE data arrives).
 */
function hideDislikedArticle(id) {
  try {
    // Add to in-memory set + persist
    DISLIKED_IDS.add(String(id));
    persistDislikedIds();
    // Remove from INCIDENTS so it won't re-render on next filterNews() call
    INCIDENTS = INCIDENTS.filter(i => String(i.id) !== id);
    PROXIMITY_INCIDENTS = PROXIMITY_INCIDENTS.filter(i => String(i.id) !== id);
    // Remove the DOM card immediately without a full re-render
    document.querySelectorAll(`[data-incident-id="${CSS.escape(id)}"]`).forEach(el => {
      el.remove();
    });
    // Also remove by data-id on vote buttons (captures card wrappers that use data-id)
    const card = document.querySelector(`.news-card[data-id="${CSS.escape(id)}"]`);
    if (card) card.remove();
  } catch(e) { console.warn('hideDislikedArticle error', e); }
}

setInterval(() => {
  try { flushVoteQueue(); } catch(e) {}
}, 30_000);

/* ===========================
   ADMIN HELPERS
=========================== */
function adminGetSecret() {
  try {
    const session = (typeof sessionStorage !== 'undefined') ? (sessionStorage.getItem('admin_secret') || '') : '';
    return ADMIN_SECRET || session || '';
  } catch(e) { return ADMIN_SECRET || ''; }
}

function adminSetFeedback(msg, isError=false) {
  // FIXED: Changed from 'adminFeedback' to 'admin-feedback' to match HTML
  const fb = document.getElementById('admin-feedback');
  if (!fb) return;
  fb.style.display = 'block';
  fb.className = isError ? 'alert alert-danger mt-3' : 'alert alert-success mt-3';
  fb.textContent = String(msg || '');
}

function adminSaveSecret() {
  try {
    const el = document.getElementById('adminSecret');
    const remember = document.getElementById('adminRememberSession');
    const val = el ? String(el.value || '').trim() : '';
    if (remember && remember.checked) {
      try { sessionStorage.setItem('admin_secret', val); } catch(e){}
    } else {
      try { sessionStorage.removeItem('admin_secret'); } catch(e){}
    }
    ADMIN_SECRET = val;
    adminSetFeedback('Admin secret saved in memory' + (remember && remember.checked ? ' and session.' : '.'));
  } catch(e) { adminSetFeedback('Failed to save admin secret', true); }
}

function adminClearSecret() {
  try { sessionStorage.removeItem('admin_secret'); } catch(e){}
  ADMIN_SECRET = '';
  const fld = document.getElementById('adminSecret'); if (fld) fld.value = '';
  adminSetFeedback('Admin secret cleared.', false);
}

async function adminTriggerIngest() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Triggering ingestion…');
  try {
    const res = await fetch(`${WORKER_URL}/api/admin/ingest`, { method:'POST', headers:{ 'secret': sec } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Ingest failed (HTTP ${res.status}). ${txt}`.trim(), true); return; }
    adminSetFeedback(txt || 'Ingestion triggered.');
  } catch(e) { adminSetFeedback('Ingest failed (network).', true); console.error(e); }
}

async function adminWipeIncidents() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  if (!confirm('⚠️ This will clear ALL incidents from KV and reset the feed. Continue?')) return;
  adminSetFeedback('Wiping incidents KV…');
  try {
    const res = await fetch(`${WORKER_URL}/api/admin/wipe-incidents`, { method:'POST', headers:{ 'secret': sec } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Wipe failed (HTTP ${res.status}): ${txt}`.trim(), true); return; }
    adminSetFeedback('✅ KV wiped: ' + txt + ' — Now click Trigger Ingestion to repopulate.');
  } catch(e) { adminSetFeedback('Wipe failed (network).', true); console.error(e); }
}

async function adminUnlock() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Requesting unblock…');
  try {
    const res = await fetch(`${WORKER_URL}/api/thumb/unblock`, { method:'POST', headers: { 'Content-Type':'application/json', 'secret': sec }, body: JSON.stringify({ unblock: true }) });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Unblock failed (HTTP ${res.status}). ${txt}`.trim(), true); return; }
    adminSetFeedback(txt || 'Unblock requested.');
  } catch(e) { adminSetFeedback('Unblock failed (network).', true); console.error(e); }
}

async function adminThumbsStatus() {
  const sec = adminGetSecret();
  adminSetFeedback('Loading thumbs status…');
  try {
    const res = await fetch(`${WORKER_URL}/api/thumbs/status`, { method:'GET', headers: { ...(sec ? {'secret': sec} : {}) } });
    const data = await res.json().catch(()=>null);
    if (!res.ok) { adminSetFeedback(`Status failed (HTTP ${res.status}).`, true); console.log('thumbs status raw', data); return; }
    adminSetFeedback('Thumbs status loaded. Check console.');
    console.log('Thumbs status:', data);
  } catch(e) { adminSetFeedback('Status failed (network).', true); console.error(e); }
}

async function adminForceRefreshTravel() {
  const sec = adminGetSecret();
  adminSetFeedback('Refreshing travel cache…');
  try {
    const res = await fetch(`${WORKER_URL}/api/traveladvisories/refresh`, { method:'POST', headers: { ...(sec ? {'secret': sec} : {}) } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Travel refresh failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Travel refresh triggered.');
    try { await loadTravelAdvisories(); } catch(e){}
  } catch(e) { adminSetFeedback('Travel refresh failed (network).', true); console.error(e); }
}

async function adminGenerateBrief() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  const regionEl = document.getElementById('reportRegion');
  const dateEl = document.getElementById('reportDate');
  const region = regionEl ? String(regionEl.value || 'Global') : 'Global';
  const date = dateEl ? String(dateEl.value || '') : '';
  adminSetFeedback('Generating brief on server…');
  try {
    const url = `${WORKER_URL}/api/dailybrief/generate?region=${encodeURIComponent(region)}${date ? `&date=${encodeURIComponent(date)}` : ''}`;
    const res = await fetch(url, { method:'POST', headers: { 'secret': sec } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Generate failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Brief generation requested.');
  } catch(e) { adminSetFeedback('Generate failed (network).', true); console.error(e); }
}

async function adminListBriefs() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Listing stored briefs…');
  try {
    const res = await fetch(`${WORKER_URL}/api/dailybrief/list`, { headers: { 'secret': sec } });
    const data = await res.json().catch(()=>null);
    if (!res.ok) { adminSetFeedback(`List failed (HTTP ${res.status}).`, true); console.log('brief list raw', data); return; }
    adminSetFeedback('Brief list loaded. Check console.');
    console.log('Stored briefs:', data);
  } catch(e) { adminSetFeedback('List failed (network).', true); console.error(e); }
}

/* ===========================
   REPORTS / HISTORY
=========================== */

/* Build SITREP HTML document from Worker sitrep object */
function _buildSitrepHtml(s) {
  function sevBadge(maxSev) {
    if (maxSev >= 4) return `<span class="sitrep-sev-badge sitrep-sev-crit">CRITICAL</span>`;
    if (maxSev === 3) return `<span class="sitrep-sev-badge sitrep-sev-high">HIGH</span>`;
    if (maxSev === 2) return `<span class="sitrep-sev-badge sitrep-sev-med">MEDIUM</span>`;
    return `<span class="sitrep-sev-badge sitrep-sev-low">LOW</span>`;
  }
  function outlookCls(esc) {
    const u = String(esc).toUpperCase();
    if (u.startsWith('HIGH'))          return 'sitrep-escalation-high';
    if (u.startsWith('MODERATE-HIGH')) return 'sitrep-escalation-mod';
    return 'sitrep-escalation-low';
  }

  const kt = (s.keyTakeaways || []).map(t => `
    <div class="sitrep-country-block">
      <div class="sitrep-country-header">
        <span class="sitrep-country-name">${escapeHtml(t.location)}</span>
        ${sevBadge(t.maxSev)}
        <span style="font-size:0.68rem;color:#666;font-family:Arial,sans-serif;">(${t.count} incident${t.count !== 1 ? 's' : ''})</span>
      </div>
      ${(t.summary || []).map(b => `<div class="sitrep-bullet">${escapeHtml(b)}</div>`).join('')}
    </div>`).join('');

  const esc = (s.escalations || []).map(e => `
    <div class="sitrep-domain-block">
      <div class="sitrep-domain-title">${escapeHtml(e.domain)}</div>
      ${(e.bullets || []).map(b => `<div class="sitrep-bullet">${escapeHtml(b)}</div>`).join('')}
    </div>`).join('');

  const dell = s.dellExposure || {};
  const dellCountries = (dell.affectedCountries || []).join(', ') || 'None identified';
  const dellSites     = (dell.siteNames || []).join(', ') || 'N/A';
  const outlook       = s.outlook || {};
  const priorities    = (outlook.priorities || [])
    .map(p => `<span class="sitrep-priority-chip">${escapeHtml(p)}</span>`).join('');
  const stats = s.stats || {};

  return `<div class="sitrep-doc">
    <div class="sitrep-doc-class-bar">UNCLASSIFIED // FOR OFFICIAL USE ONLY</div>
    <div class="sitrep-doc-header">
      <div class="sitrep-doc-title">${escapeHtml(s.title || 'Situation Report')}</div>
      <div class="sitrep-doc-issueline">Issue ${escapeHtml(String(s.issue || 1))} &nbsp;|&nbsp; ${escapeHtml(s.date || '')} &nbsp;|&nbsp; ${escapeHtml(s.topRegion || 'Global')}</div>
      <div class="sitrep-doc-orgline">${escapeHtml(s.org || '')}</div>
    </div>
    <div class="sitrep-doc-stats-bar">
      <div class="sitrep-doc-stat">
        <div class="sitrep-doc-stat-val">${stats.total || 0}</div>
        <div class="sitrep-doc-stat-lbl">Total Incidents</div>
      </div>
      <div class="sitrep-doc-stat">
        <div class="sitrep-doc-stat-val" style="color:#f28b82;">${stats.critical || 0}</div>
        <div class="sitrep-doc-stat-lbl">Critical</div>
      </div>
      <div class="sitrep-doc-stat">
        <div class="sitrep-doc-stat-val" style="color:#ffb74d;">${stats.high || 0}</div>
        <div class="sitrep-doc-stat-lbl">High</div>
      </div>
      <div class="sitrep-doc-stat">
        <div class="sitrep-doc-stat-val">${stats.countries || 0}</div>
        <div class="sitrep-doc-stat-lbl">Countries</div>
      </div>
      <div class="sitrep-doc-stat">
        <div class="sitrep-doc-stat-val">${stats.regions || 0}</div>
        <div class="sitrep-doc-stat-lbl">Regions</div>
      </div>
    </div>
    <div class="sitrep-doc-theme">${escapeHtml(s.theme || '')}</div>
    <div class="sitrep-doc-body">
      ${kt ? `<div class="sitrep-doc-section">
        <div class="sitrep-doc-section-title">Key Takeaways</div>
        ${kt}
      </div>` : ''}
      ${esc ? `<div class="sitrep-doc-section">
        <div class="sitrep-doc-section-title">Recent Escalations</div>
        ${esc}
      </div>` : ''}
      <div class="sitrep-doc-section">
        <div class="sitrep-doc-section-title">Dell Personnel &amp; Assets</div>
        <div class="sitrep-dell-box">
          <div class="sitrep-dell-box-title">Dell Technologies Global Footprint — Affected Locations</div>
          <div class="sitrep-dell-stat"><strong>Countries Affected:</strong> ${escapeHtml(dellCountries)}</div>
          <div class="sitrep-dell-stat"><strong>Sites (${dell.sitesAffected || 0}):</strong> ${escapeHtml(dellSites)}</div>
          <div class="sitrep-dell-stat" style="font-size:0.76rem;color:#555;margin-top:6px;">
            Monitor travel advisories and ensure Business Continuity Plans are activated for all affected locations.
          </div>
        </div>
      </div>
      <div class="sitrep-doc-section">
        <div class="sitrep-doc-section-title">Outlook</div>
        <div class="sitrep-outlook-escalation ${outlookCls(outlook.escalation || '')}">
          Escalation Probability: ${escapeHtml(outlook.escalation || '')}
        </div>
        <div class="sitrep-outlook-risk">${escapeHtml(outlook.risk || '')}</div>
        ${priorities ? `<div style="margin-top:8px;font-family:Arial,sans-serif;font-size:0.72rem;font-weight:700;color:#555;margin-bottom:4px;">PRIORITY MONITORING</div>
        <div class="sitrep-priorities-row">${priorities}</div>` : ''}
      </div>
    </div>
    <div class="sitrep-doc-class-bar" style="margin-top:16px;">UNCLASSIFIED // FOR OFFICIAL USE ONLY</div>
  </div>`;
}

/**
 * Build a structured SITREP object from raw incidents (client-side fallback).
 * Used when the Worker returns incidents but no pre-generated AI sitrep.
 */
function _buildSitrepFromIncidents(incidents, region, dateStr) {
  if (!incidents || !incidents.length) return null;

  const sorted = [...incidents].sort((a, b) => {
    const sd = (Number(b.severity) || 1) - (Number(a.severity) || 1);
    return sd !== 0 ? sd : new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime();
  });

  const total    = sorted.length;
  const critical = sorted.filter(i => Number(i.severity) >= 4).length;
  const high     = sorted.filter(i => Number(i.severity) === 3).length;
  const countries = new Set(sorted.map(i => (i.country || i.location || '')).filter(Boolean)).size;
  const regionSet = new Set(sorted.map(i => i.region || '').filter(Boolean));

  // Top region (for header)
  const regionCounts = {};
  sorted.forEach(i => { const r = i.region || 'Unknown'; regionCounts[r] = (regionCounts[r] || 0) + 1; });
  const topRegion = (region && region !== 'Global')
    ? region
    : Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Global';

  // Key takeaways — group by country, top 8 by severity
  const byCountry = {};
  sorted.forEach(i => {
    const key = (i.country || i.location || 'Unknown').toUpperCase();
    if (!byCountry[key]) byCountry[key] = { maxSev: 0, items: [] };
    byCountry[key].items.push(i);
    byCountry[key].maxSev = Math.max(byCountry[key].maxSev, Number(i.severity) || 1);
  });
  const keyTakeaways = Object.entries(byCountry)
    .sort((a, b) => b[1].maxSev - a[1].maxSev || b[1].items.length - a[1].items.length)
    .slice(0, 8)
    .map(([location, d]) => ({
      location,
      maxSev: d.maxSev,
      count: d.items.length,
      summary: d.items.slice(0, 3).map(i => i.summary || i.title || '').filter(Boolean),
    }));

  // Escalations — group by category
  const byCat = {};
  sorted.forEach(i => {
    const cat = (i.category || 'UNKNOWN').toUpperCase();
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(i);
  });
  const escalations = Object.entries(byCat)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .filter(([, items]) => items.length >= 2 || (items[0] && Number(items[0].severity) >= 3))
    .map(([domain, items]) => ({
      domain,
      bullets: items.slice(0, 4).map(i => `${i.country ? i.country + ': ' : ''}${i.title || ''}`.trim()),
    }));

  // Dell exposure — high-sev affected countries + any known ASSETS in those countries
  const affectedCountries = [...new Set(
    sorted.filter(i => Number(i.severity) >= 3).map(i => i.country || '').filter(Boolean)
  )];
  const dellSiteNames = [];
  try {
    if (typeof ASSETS !== 'undefined') {
      Object.values(ASSETS).forEach(asset => {
        if (affectedCountries.some(c =>
          (asset.country || asset.name || '').toUpperCase().includes(c.toUpperCase()) ||
          c.toUpperCase().includes((asset.country || '').toUpperCase())
        )) { dellSiteNames.push(asset.name); }
      });
    }
  } catch (_) {}

  // Outlook
  const maxSev = sorted[0] ? Number(sorted[0].severity) || 1 : 1;
  const escalation = maxSev >= 4 ? 'HIGH — Immediate attention required'
                   : maxSev >= 3 ? 'MODERATE-HIGH — Enhanced monitoring advised'
                   : 'LOW-MODERATE — Standard monitoring posture';
  const risk = `${total} incident${total !== 1 ? 's' : ''} across ${countries} countr${countries !== 1 ? 'ies' : 'y'}.`
    + (critical > 0 ? ` ${critical} critical-severity event${critical !== 1 ? 's' : ''} require immediate attention.` : '')
    + (high > 0     ? ` ${high} high-severity event${high !== 1 ? 's' : ''} under monitoring.` : '');
  const priorities = Object.entries(byCountry)
    .filter(([, d]) => d.maxSev >= 3)
    .sort((a, b) => b[1].maxSev - a[1].maxSev || b[1].items.length - a[1].items.length)
    .slice(0, 4).map(([c]) => c);

  const topCat = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)[0];
  const theme  = topCat
    ? `Dominant threat category: ${topCat[0]} (${topCat[1].length} incidents).${critical > 0 ? ' Multiple critical-severity events require leadership attention.' : ''}`
    : '';

  return {
    title:     `Dell Technologies OS | INFOHUB — ${region || 'Global'} Situation Report`,
    issue:     1,
    date:      dateStr || new Date().toISOString().slice(0, 10),
    topRegion,
    org:       'Dell Technologies — Global Security Operations',
    theme,
    stats:     { total, critical, high, countries, regions: regionSet.size },
    keyTakeaways,
    escalations,
    dellExposure: { affectedCountries, siteNames: dellSiteNames, sitesAffected: dellSiteNames.length },
    outlook:   { escalation, risk, priorities },
  };
}

async function previewBriefing() {
  const region  = document.getElementById('reportRegion')?.value || 'Global';
  const dateEl  = document.getElementById('reportDate');
  // Default to today if user hasn't picked a date
  const today   = new Date().toISOString().slice(0, 10);
  const date    = dateEl?.value || today;
  if (dateEl && !dateEl.value) dateEl.value = today; // fill the input so user sees it

  const fb      = document.getElementById('preview-feedback');
  const cont    = document.getElementById('briefing-preview');
  const pdfBtn  = document.getElementById('download-brief-pdf');
  if (fb)   { fb.style.display = 'block'; fb.textContent = 'Generating SITREP…'; }
  if (cont) { cont.innerHTML = ''; }

  // Always include date — Worker returns [] when date is omitted
  const url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}&date=${encodeURIComponent(date)}`;
  try {
    const res  = await fetchWithTimeout(url, {}, 25000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();

    // Worker returns { incidents: [...] } for archived/live data,
    // or { sitrep: {...}, incidents: [...] } for admin-generated briefs.
    const rawIncidents = Array.isArray(json.incidents) ? json.incidents
                       : Array.isArray(json)           ? json
                       : [];
    let sitrep = json.sitrep || null;

    // Build sitrep client-side when not pre-generated
    if (!sitrep && rawIncidents.length) {
      sitrep = _buildSitrepFromIncidents(rawIncidents, region, date);
    }

    if (!sitrep) {
      if (cont) cont.innerHTML = `<div class="safe-box"><i class="fas fa-info-circle safe-icon" aria-hidden="true"></i><div class="safe-text">No incidents found for ${date}${region !== 'Global' ? ' — ' + region : ''}.</div></div>`;
      if (pdfBtn) pdfBtn.style.display = 'none';
    } else {
      if (cont) cont.innerHTML = _buildSitrepHtml(sitrep);
      if (pdfBtn) pdfBtn.style.display = 'inline-flex';
    }
    if (fb) fb.style.display = 'none';
  } catch(e) {
    if (cont) cont.innerHTML = '';
    if (pdfBtn) pdfBtn.style.display = 'none';
    if (fb) { fb.style.display = 'block'; fb.textContent = `Error: ${e.message}`; }
  }
}

async function downloadReport() {
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
  let url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}&download=true`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  window.open(url, '_blank', 'noopener');
}

async function downloadBriefAsPDF(date) {
  const fb = document.getElementById('preview-feedback');
  if (fb) { fb.style.display = 'block'; fb.textContent = 'Building SITREP PDF…'; }
  try {
    if (!window.html2canvas || !window.jspdf) throw new Error('PDF libraries not loaded yet.');
    const region = document.getElementById('reportRegion')?.value || 'Global';
    const res = await fetchWithTimeout(
      `${WORKER_URL}/api/dailybrief?date=${encodeURIComponent(date)}&region=${encodeURIComponent(region)}`,
      {}, 20000
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json   = await res.json();
    const sitrep = json.sitrep;
    if (!sitrep) throw new Error('No SITREP data for this date.');

    /* Inline CSS required — html2canvas only reads computed styles already applied */
    const inlineCSS = `
      .sitrep-doc{background:#fff;color:#111;font-family:'Times New Roman',Times,serif;width:860px;}
      .sitrep-doc-class-bar{background:#1b1b2e;color:#bbb;text-align:center;font-size:9px;font-weight:700;letter-spacing:2px;padding:4px 8px;font-family:Arial,sans-serif;}
      .sitrep-doc-header{background:#0d1b2a;color:#fff;padding:20px 28px 16px;}
      .sitrep-doc-title{font-size:18px;font-weight:700;margin:0 0 4px;font-family:Arial,sans-serif;}
      .sitrep-doc-issueline{font-size:11px;color:#9ab0c8;font-family:Arial,sans-serif;margin:0;}
      .sitrep-doc-orgline{font-size:10px;color:#7090a8;font-family:Arial,sans-serif;margin-top:6px;}
      .sitrep-doc-stats-bar{background:#1a3a5c;display:flex;border-top:2px solid #e8b800;}
      .sitrep-doc-stat{flex:1;text-align:center;padding:8px 4px;border-right:1px solid #2a4a6c;font-family:Arial,sans-serif;}
      .sitrep-doc-stat:last-child{border-right:none;}
      .sitrep-doc-stat-val{font-size:16px;font-weight:800;color:#fff;line-height:1;}
      .sitrep-doc-stat-lbl{font-size:8px;color:#9ab0c8;text-transform:uppercase;letter-spacing:1px;}
      .sitrep-doc-theme{background:#f4f6f8;border-left:4px solid #e8b800;margin:20px 28px 8px;padding:10px 14px;font-style:italic;font-size:12px;color:#333;}
      .sitrep-doc-body{padding:8px 28px 24px;}
      .sitrep-doc-section{margin-top:20px;}
      .sitrep-doc-section-title{font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#fff;background:#0d1b2a;padding:5px 12px;margin:0 -28px 12px;border-left:4px solid #e8b800;}
      .sitrep-country-block{margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e8eaed;}
      .sitrep-country-block:last-child{border-bottom:none;}
      .sitrep-country-header{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
      .sitrep-country-name{font-family:Arial,sans-serif;font-weight:700;font-size:12px;color:#0d1b2a;}
      .sitrep-sev-badge{font-size:8px;font-weight:700;padding:1px 6px;border-radius:10px;font-family:Arial,sans-serif;text-transform:uppercase;}
      .sitrep-sev-crit{background:#f28b82;color:#410002;}
      .sitrep-sev-high{background:#ffb74d;color:#4a2000;}
      .sitrep-sev-med{background:#fdd663;color:#3a2800;}
      .sitrep-sev-low{background:#ccff90;color:#1a3600;}
      .sitrep-bullet{font-size:11px;color:#222;margin-bottom:4px;padding-left:12px;position:relative;line-height:1.45;}
      .sitrep-domain-block{margin-bottom:14px;}
      .sitrep-domain-title{font-family:Arial,sans-serif;font-weight:700;font-size:10px;color:#0d1b2a;text-transform:uppercase;border-bottom:1px solid #c5cae9;padding-bottom:3px;margin-bottom:6px;}
      .sitrep-dell-box{background:#f0f4ff;border:1px solid #c5cae9;border-radius:4px;padding:12px 16px;margin:4px 0;}
      .sitrep-dell-box-title{font-family:Arial,sans-serif;font-weight:700;font-size:10px;color:#0d1b2a;margin-bottom:6px;}
      .sitrep-dell-stat{font-size:11px;color:#333;margin-bottom:3px;}
      .sitrep-outlook-escalation{font-family:Arial,sans-serif;font-size:11px;font-weight:700;margin-bottom:6px;}
      .sitrep-escalation-high{color:#c62828;}
      .sitrep-escalation-mod{color:#c45000;}
      .sitrep-escalation-low{color:#137333;}
      .sitrep-outlook-risk{font-size:11px;color:#333;margin-bottom:8px;}
      .sitrep-priorities-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
      .sitrep-priority-chip{background:#0d1b2a;color:#e8b800;font-family:Arial,sans-serif;font-size:9px;font-weight:700;padding:3px 10px;border-radius:12px;}
    `;

    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-9999px;top:0;width:860px;background:#fff;';
    el.innerHTML = `<style>${inlineCSS}</style>` + _buildSitrepHtml(sitrep);
    document.body.appendChild(el);

    const canvas = await window.html2canvas(el, {
      scale: 1.5, useCORS: true, logging: false, backgroundColor: '#ffffff'
    });
    document.body.removeChild(el);

    const { jsPDF } = window.jspdf;
    const pdf   = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const imgData = canvas.toDataURL('image/jpeg', 0.88);
    const pdfW  = pdf.internal.pageSize.getWidth();
    const pdfH  = (canvas.height * pdfW) / canvas.width;
    const pageH = pdf.internal.pageSize.getHeight();

    /* Multi-page support */
    if (pdfH <= pageH) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
    } else {
      let yOff = 0;
      while (yOff < pdfH) {
        pdf.addImage(imgData, 'JPEG', 0, -yOff, pdfW, pdfH);
        yOff += pageH;
        if (yOff < pdfH) pdf.addPage();
      }
    }
    pdf.save(`sitrep-${date}.pdf`);
    if (fb) fb.style.display = 'none';
  } catch(e) {
    if (fb) { fb.style.display = 'block'; fb.textContent = `PDF error: ${e.message}`; }
  }
}

async function loadHistory(dateStr) {
  const status = document.getElementById('history-status');
  if (status) status.textContent = "Loading archive…";
  try {
    const res = await fetch(`${WORKER_URL}/api/archive?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    if (!status) return;
    if (!arr || !arr.length) {
      status.textContent = "No archived incidents found.";
      return;
    }
    status.innerHTML = `<div style="max-height:300px;overflow:auto;margin-top:10px;">` +
      arr.map(i => {
        const href = safeHref(i.link);
        const titleHtml = href !== '#'
          ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" style="color:#0076ce;text-decoration:none;font-weight:700;">${escapeHtml(i.title)}</a>`
          : `<strong>${escapeHtml(i.title)}</strong> <span style="font-size:0.72rem;color:#999;">(Source unavailable)</span>`;
        return `<div style="margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px;">${titleHtml}<br><span style="font-size:0.8rem;color:#666;">${escapeHtml(i.country || '')}</span></div>`;
      }).join('') +
      `</div>`;
  } catch(e) {
    if (status) status.textContent = `Archive error: ${e.message}`;
  }
}

/* ===========================
   manualRefresh - robust
=========================== */
async function manualRefresh() {
  const btn = document.getElementById("btn-refresh");
  const originalText = btn ? btn.innerHTML : 'Refresh';

  if (btn) {
    btn.style.opacity = "0.7";
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    btn.style.pointerEvents = "none";
  }

  try {
    await Promise.allSettled([
      loadFromWorker(false),
      loadProximityFromWorker(false),
      loadTravelAdvisories()
    ]);

    const active = document.querySelector('.nav-item-custom.active');
    const region = active ? active.textContent.trim() : "Global";
    filterNews(region);
  } catch (e) {
    console.error('manualRefresh error', e);
  } finally {
    if (btn) {
      btn.style.opacity = "1";
      btn.innerHTML = originalText;
      btn.style.pointerEvents = "auto";
    }
  }
}

/* ===========================
   CLOCKS
=========================== */
function startClock() {
  const container = document.getElementById("multi-clock-container");
  const zones = [
    { label: "Austin", z: "America/Chicago" },
    { label: "Ireland", z: "Europe/Dublin" },
    { label: "India", z: "Asia/Kolkata" },
    { label: "Singapore", z: "Asia/Singapore" },
    { label: "Tokyo", z: "Asia/Tokyo" },
    { label: "Sydney", z: "Australia/Sydney" }
  ];

  if (container && !container.innerHTML) {
    container.innerHTML = zones.map(z => `
      <div class="clock-box">
        <div class="clock-label">${escapeHtml(z.label)}</div>
        <div class="clock-val" id="clk-${escapeAttr(z.label)}">--:--</div>
      </div>`).join('');
  }

  setInterval(() => {
    const now = new Date();
    zones.forEach(z => {
      const el = document.getElementById(`clk-${z.label}`);
      if (el) el.textContent = now.toLocaleTimeString("en-US", { timeZone: z.z, hour12: false, hour:'2-digit', minute:'2-digit' });
    });
  }, 1000);
}

/* ===========================
   Filter news (main entry)
=========================== */
// Region bounding boxes [southLat, westLng, northLat, eastLng]
const _REGION_BOUNDS = {
  'Global': null,
  'AMER':   [[-60, -170],  [75,  -30]],
  'EMEA':   [[-35,  -25],  [72,   65]],
  'APJC':   [[-50,   60],  [55,  180]],
  'LATAM':  [[-60, -120],  [35,  -30]],
};

// Explicit center+zoom per region — tested live to confirm they work on wide screens.
// fitBounds/flyToBounds fails on wide maps (map wider than world at zoom 2) so we use
// setView with zoom 5 where the world (8192px) exceeds any container and panning is free.
const _REGION_VIEW = {
  'Global': { center: [20,   0  ], zoom: 2 },
  'AMER':   { center: [20,  -95 ], zoom: 5 },
  'EMEA':   { center: [40,   20 ], zoom: 5 },
  'APJC':   { center: [15,  100 ], zoom: 5 },
  'LATAM':  { center: [-10, -70 ], zoom: 5 },
};

function _zoomMapToRegion(region) {
  if (!map) return;
  const v = _REGION_VIEW[region] || _REGION_VIEW['Global'];
  try {
    map.setView(v.center, v.zoom, { animate: true, duration: 0.6 });
  } catch(e) {}
}

function filterNews(region) {
  currentRegion = region || 'GLOBAL';
  _syncCatPillUI();           // refresh category badge counts + active states
  renderAssetsOnMap(region);
  renderIncidentsOnMap(region, INCIDENTS);
  renderGeneralFeed(region);
  updateHeadline(region);
  renderProximityAlerts(region);
  renderCriticalAlertsTicker();
  _refreshMapOverlays();      // re-clip heatmap + nature events to the active region
  // NOTE: map zoom is NOT here — it's only in _zoomMapToRegion() called by explicit tab clicks
  // This prevents the SSE stream from moving the map every time data refreshes
}

// Re-renders heatmap and nature events overlays clipped to the current region
function _refreshMapOverlays() {
  if (heatmapEnabled) {
    if (heatLayer) { try { map.removeLayer(heatLayer); } catch(e){} heatLayer = null; }
    const filtered = INCIDENTS.filter(i => {
      const lat = Number(i.lat), lng = Number(i.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && _eventInRegion(lat, lng, currentRegion);
    });
    heatLayer = createHeatLayerFromIncidents(filtered);
    if (heatLayer) heatLayer.addTo(map);
  }
  if (weatherEnabled) {
    renderWeatherLayer();
  }
}

/* ===========================
   Update headline
=========================== */
function updateHeadline(region) {
  let pool = (region === "Global") ? INCIDENTS : INCIDENTS.filter(i => i.region === region);
  // Apply same quality gate as Intel feed — never show Insider/Workforce/Unknown in headline
  pool = pool.filter(i => {
    const cat = String(i.category || '').toUpperCase();
    if (cat === 'UNKNOWN' || cat === '') return false;
    if (INSIDER_CATEGORIES && INSIDER_CATEGORIES.includes(cat)) return false;
    const src = String(i.source || i.link || '').toLowerCase();
    if (INSIDER_SOURCES && INSIDER_SOURCES.some(s => src.includes(s))) return false;
    return true;
  });
  const el = document.getElementById("headline-alert");
  const tags = document.getElementById("headline-tags");
  if (!el || !tags) return;
  if (pool.length) {
    el.textContent = pool[0].title || "Headline";
    const sev = mapSeverityToLabel(pool[0].severity);
    tags.innerHTML = `
      <span class="tag tag-crit" style="background:${(Number(pool[0].severity||1) >= 4) ? '#d93025' : '#5f6368'}">${escapeHtml(sev.label)}</span>
      <span class="tag tag-cat">${escapeHtml(pool[0].category || 'CATEGORY')}</span>
      <span class="tag tag-reg">${escapeHtml(pool[0].region || 'REGION')}</span>
    `;
  } else {
    el.textContent = "No critical alerts.";
    tags.innerHTML = "";
  }
}

/* ===========================
   SSE REAL-TIME BRIDGE
=========================== */
let _sseRetryCount = 0;
let _lastSSEDataMs = 0; // timestamp of last successful incidents/proximity event
const SSE_MAX_RETRY_DELAY_MS = 30_000;
const SSE_RECENT_DATA_MS = 30_000; // suppress OFFLINE label if data arrived within this window

/**
 * Connect to /api/stream via EventSource for near-real-time updates.
 * Falls back to the original AUTO_REFRESH_MS setInterval when EventSource
 * is unavailable (e.g., older Safari, some enterprise proxies).
 * Reconnects automatically with exponential back-off on failure.
 */
function connectSSE() {
  if (typeof EventSource === 'undefined') {
    // Fallback: legacy polling
    setInterval(async () => {
      if (FEED_IS_LIVE) {
        await loadFromWorker(true);
        await loadProximityFromWorker(true);
        const active = document.querySelector('.nav-item-custom.active');
        filterNews(active ? active.textContent.trim() : 'Global');
      }
    }, AUTO_REFRESH_MS);
    return;
  }

  const es = new EventSource(`${WORKER_URL}/api/stream`);

  es.addEventListener('incidents', (ev) => {
    try {
      const raw = JSON.parse(ev.data);
      const cutoff72h = Date.now() - 72 * 3600 * 1000;
      const cutoff7d  = Date.now() - 7 * 24 * 3600 * 1000;
      const cleanRaw = (Array.isArray(raw) ? raw : [])
        .map(normaliseWorkerIncident).filter(Boolean)
        .filter(i => !DISLIKED_IDS.has(String(i.id)));
      let fresh = cleanRaw.filter(i => { try { return new Date(i.time).getTime() >= cutoff72h; } catch { return false; } });
      if (fresh.length === 0 && cleanRaw.length > 0) {
        fresh = cleanRaw.filter(i => { try { return new Date(i.time).getTime() >= cutoff7d; } catch { return false; } });
        if (fresh.length === 0) fresh = cleanRaw;
      }
      // If Worker stream delivers empty, fall back to news.json
      if (fresh.length === 0) {
        fetch('public/data/news.json').then(r => r.json()).then(newsJson => {
          if (!Array.isArray(newsJson) || newsJson.length === 0) return;
          INCIDENTS = newsJson.filter(item => item && item.title).map(item => {
            const rawType = String(item.type || item.category || 'UNKNOWN').toUpperCase();
            let cat = 'SECURITY';
            if (rawType.includes('CYBER')) cat = 'CYBER';
            else if (rawType.includes('NATURAL') || rawType.includes('ENVIRON')) cat = 'NATURAL';
            else if (rawType.includes('SUPPLY') || rawType.includes('TRANSPORT')) cat = 'TRANSPORT';
            else if (rawType.includes('HEALTH')) cat = 'HEALTH';
            const sev = Math.min(5, Math.max(1, Number(item.severity) || 3));
            return { id: item.url || item.title, title: String(item.title).trim(),
              summary: String(item.snippet || item.body || '').slice(0, 300), category: cat,
              severity: sev, severity_label: sev >= 5 ? 'CRITICAL' : sev >= 4 ? 'HIGH' : sev === 3 ? 'MEDIUM' : 'LOW',
              region: item.region || 'Global', country: 'GLOBAL', location: 'UNKNOWN',
              link: item.url || '#', source: item.source || '', time: item.time || new Date().toISOString(),
              lat: 0, lng: 0 };
          }).filter(i => !DISLIKED_IDS.has(String(i.id)));
          INCIDENTS.sort((a, b) => new Date(b.time) - new Date(a.time));
          FEED_IS_LIVE = true;
          refreshHeatLayerIfEnabled();
          const label = document.getElementById('feed-status-label');
          if (label) label.textContent = `LIVE \u2022 ${INCIDENTS.length} ITEMS`;
          const active = document.querySelector('.nav-item-custom.active');
          filterNews(active ? active.textContent.trim() : 'Global');
          if (typeof window.updateMainTicker === 'function') window.updateMainTicker();
        }).catch(() => {});
        return;
      }
      INCIDENTS = fresh;
      INCIDENTS.sort((a, b) => new Date(b.time) - new Date(a.time));
      FEED_IS_LIVE = true;
      refreshHeatLayerIfEnabled();
      _lastSSEDataMs = Date.now(); // record last successful data receipt
      const label = document.getElementById('feed-status-label');
      if (label) label.textContent = `LIVE \u2022 ${INCIDENTS.length} ITEMS`;
      const active = document.querySelector('.nav-item-custom.active');
      filterNews(active ? active.textContent.trim() : 'Global');
      if (typeof window.updateMainTicker === 'function') window.updateMainTicker();
      _sseRetryCount = 0;
    } catch (e) { console.error('SSE incidents parse error', e); }
  });

  es.addEventListener('proximity', (ev) => {
    try {
      const json = JSON.parse(ev.data);
      const cutoffMs = Date.now() - 72 * 3600 * 1000;
      PROXIMITY_INCIDENTS = (Array.isArray(json.incidents) ? json.incidents : [])
        .map(normaliseWorkerIncident).filter(Boolean)
        .filter(i => { try { return new Date(i.time).getTime() >= cutoffMs; } catch { return false; } })
        .filter(i => !DISLIKED_IDS.has(String(i.id))); // suppress previously-disliked items
      if (Array.isArray(json.global_disruptions)) {
        GLOBAL_DISRUPTIONS = json.global_disruptions;
      }
    } catch (e) { console.error('SSE proximity parse error', e); }
  });

  es.onerror = () => {
    FEED_IS_LIVE = false;
    const label = document.getElementById('feed-status-label');
    // Suppress "OFFLINE" if incidents were received within the last SSE_RECENT_DATA_MS —
    // the worker closes the stream after each snapshot, so this is a normal reconnect cycle.
    const recentData = (Date.now() - _lastSSEDataMs) < SSE_RECENT_DATA_MS;
    if (label) {
      if (recentData && _sseRetryCount === 0) {
        // Keep the LIVE label; silently reconnect in background
        label.textContent = `LIVE \u2022 ${INCIDENTS.length} ITEMS`;
      } else {
        label.textContent = 'OFFLINE \u2022 Reconnecting\u2026';
      }
    }
    es.close();
    // Use minimal delay (1 s) when data was recently received — this is just a stream flush
    const delay = recentData ? 1000 : Math.min(1000 * Math.pow(2, _sseRetryCount), SSE_MAX_RETRY_DELAY_MS);
    _sseRetryCount++;
    setTimeout(connectSSE, delay);
  };
}

/* ===========================
   S2.5 LOGISTICS MAP LAYER
=========================== */

// Dell hub coordinates (client-side mirror of worker constants)
const LOGISTICS_HUB_DEFS = [
  { code: 'PEN', name: 'Dell Penang',       lat:  5.2971, lon: 100.2769, radiusKm: 50 },
  { code: 'SIN', name: 'Dell Singapore',    lat:  1.3521, lon: 103.8198, radiusKm: 50 },
  { code: 'ROT', name: 'Dell Rotterdam',    lat: 51.9225, lon:   4.4792, radiusKm: 50 },
  { code: 'SNN', name: 'Dell Shannon',      lat: 52.7019, lon:  -8.9248, radiusKm: 50 },
  { code: 'AUS', name: 'Dell Austin',       lat: 30.1944, lon: -97.6700, radiusKm: 50 },
  { code: 'BNA', name: 'Dell Nashville',    lat: 36.1263, lon: -86.6774, radiusKm: 50 },
  { code: 'POA', name: 'Dell Porto Alegre', lat:-29.9953, lon: -51.3142, radiusKm: 50 },
];

function makeLogisticsIcon(type, alerting = false) {
  const emoji = type === 'vessel' ? '🚢' : '✈️';
  const cls   = alerting ? 'logistics-marker logistics-marker-alert' : 'logistics-marker';
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" role="img" aria-label="${type === 'vessel' ? 'Vessel' : 'Aircraft'} marker">${emoji}</div>`,
    iconSize:   [36, 36],
    iconAnchor: [18, 18],
    popupAnchor:[0, -20],
  });
}

function buildLogisticsPopup(id, type, data) {
  const brief = data.scheduleBrief ? `<br><em>${escapeHtml(data.scheduleBrief)}</em>` : '';
  const route = (data.estDepartureAirport && data.estArrivalAirport)
    ? `<br><span style="color:#8ab4f8;">Origin ➔ Dest: <strong>${escapeHtml(data.estDepartureAirport)} → ${escapeHtml(data.estArrivalAirport)}</strong></span>` : '';
  const callsign = data.callsign ? `<br>Callsign: ${escapeHtml(data.callsign)}` : '';
  const pos = (data.lat != null && data.lon != null)
    ? `<br><small style="color:#9aa0a6;">Pos: ${Number(data.lat).toFixed(4)}, ${Number(data.lon).toFixed(4)}</small>` : '';
  return `<div style="min-width:170px;font-size:0.78rem;">
    <strong>${type === 'vessel' ? '🚢' : '✈️'} ${escapeHtml(id.toUpperCase())}</strong>
    ${brief}${route}${callsign}${pos}
  </div>`;
}

function isInsideHub(lat, lon) {
  for (const hub of LOGISTICS_HUB_DEFS) {
    const dx = (lon - hub.lon) * Math.cos(lat * Math.PI / 180) * 111.32;
    const dy = (lat - hub.lat) * 111.32;
    if (Math.sqrt(dx * dx + dy * dy) <= hub.radiusKm) return hub;
  }
  return null;
}

function initLogisticsLayer() {
  if (!map || !window.L) return;
  if (logisticsLayerGroup) return; // already initialised
  logisticsLayerGroup = L.layerGroup().addTo(map);
  // Draw hub markers + 50 km geofence rings around each Dell hub
  for (const hub of LOGISTICS_HUB_DEFS) {
    const popupHtml = `<strong>${escapeHtml(hub.name)}</strong> (${escapeHtml(hub.code)})<br>${hub.radiusKm} km logistics geofence`;
    // Pixel-size dot — always visible at any zoom level
    L.circleMarker([hub.lat, hub.lon], {
      radius: 7,
      color: '#1a73e8',
      fillColor: '#1a73e8',
      fillOpacity: 0.85,
      weight: 2,
    }).bindPopup(popupHtml)
      .bindTooltip(escapeHtml(hub.code), { permanent: true, direction: 'right', className: 'hub-label' })
      .addTo(logisticsLayerGroup);
    // Real-world 50 km ring — visible when zoomed in to hub area
    L.circle([hub.lat, hub.lon], {
      radius: hub.radiusKm * 1000,
      color: '#1a73e8',
      fillColor: '#1a73e8',
      fillOpacity: 0.06,
      weight: 2,
      dashArray: '8 5',
      interactive: true,
    }).bindPopup(popupHtml)
      .addTo(logisticsLayerGroup);
  }
  console.log('[logistics] initLogisticsLayer: drew', LOGISTICS_HUB_DEFS.length, 'hub markers + rings');
  typeof debug === 'function' && debug('logisticsLayer: initialized', LOGISTICS_HUB_DEFS.length, 'hub rings');
}

function placeLogisticsMarker(id, type, lat, lon, data) {
  if (!map || !window.L || !logisticsLayerGroup) return;
  const hub      = isInsideHub(lat, lon);
  const alerting = !!hub;
  const icon     = makeLogisticsIcon(type, alerting);
  const popup    = buildLogisticsPopup(id, type, { ...data, lat, lon });
  if (LOGISTICS_MARKERS.has(id)) {
    const m = LOGISTICS_MARKERS.get(id);
    m.setLatLng([lat, lon]);
    m.setIcon(icon);
    m.setPopupContent(popup);
    if (alerting) {
      typeof debug === 'function' && debug('logisticsMarker: inside hub', hub.code, id);
    }
  } else {
    const m = L.marker([lat, lon], { icon })
      .bindPopup(popup)
      .addTo(logisticsLayerGroup);
    LOGISTICS_MARKERS.set(id, m);
  }
}

function removeLogisticsMarker(id) {
  if (LOGISTICS_MARKERS.has(id)) {
    try { logisticsLayerGroup && logisticsLayerGroup.removeLayer(LOGISTICS_MARKERS.get(id)); } catch(e) {}
    LOGISTICS_MARKERS.delete(id);
  }
}

async function pollLogisticsWatchlist() {
  if (!OSINFO_USER_ID) return;
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/logistics/watch`, {
      headers: { 'X-User-Id': OSINFO_USER_ID },
    });
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist : [];
    for (const item of watchlist) {
      const id   = typeof item === 'string' ? item : (item.id   || '');
      const type = typeof item === 'object'  ? (item.type || 'flight') : 'flight';
      if (!id) continue;
      try {
        const tr   = await fetchWithTimeout(
          `${WORKER_URL}/api/logistics/track?icao24=${encodeURIComponent(id)}`,
          { headers: { 'X-User-Id': OSINFO_USER_ID } }
        );
        const data = await tr.json().catch(() => ({}));
        if (data.ok && data.status === 'LIVE' && Array.isArray(data.states) && data.states.length > 0) {
          const s = data.states[0];
          if (s.latitude != null && s.longitude != null) {
            placeLogisticsMarker(id, type, s.latitude, s.longitude, {
              scheduleBrief:       data.scheduleBrief || null,
              estDepartureAirport: data.estDepartureAirport || null,
              estArrivalAirport:   data.estArrivalAirport   || null,
              callsign:            s.callsign || null,
            });
          }
        }
      } catch(e) {
        typeof debug === 'function' && debug('logisticsPoll:item error', id, e?.message || e);
      }
    }
    typeof debug === 'function' && debug('logisticsPoll: polled', watchlist.length, 'items');
  } catch(e) {
    typeof debug === 'function' && debug('logisticsPoll error', e?.message || e);
  }
}

function startLogisticsPoll() {
  if (_logisticsPollTimer) return;
  pollLogisticsWatchlist();                                // immediate first poll
  _logisticsPollTimer = setInterval(pollLogisticsWatchlist, 60 * 1000);
  typeof debug === 'function' && debug('logisticsPoll: started (60 s interval)');
}

function stopLogisticsPoll() {
  if (_logisticsPollTimer) {
    clearInterval(_logisticsPollTimer);
    _logisticsPollTimer = null;
    typeof debug === 'function' && debug('logisticsPoll: stopped');
  }
}

/* ===========================
   S2.5 LOGISTICS DRAWER
=========================== */

function openLogisticsDrawer() {
  logisticsDrawerOpen = true;
  const drawer = document.getElementById('logistics-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  renderLogisticsAssets();
  loadLogisticsWatchlist();
}

function closeLogisticsDrawer() {
  logisticsDrawerOpen = false;
  const drawer = document.getElementById('logistics-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

function switchLogisticsTab(tabName) {
  document.querySelectorAll('.drawer-tab').forEach(btn => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.drawer-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

function renderLogisticsAssets() {
  const container = document.getElementById('logistics-assets-list');
  if (!container) return;
  // Pull incidents that overlap a logistics hub radius
  const hubs = [
    { code: 'PEN', name: 'Penang',       lat:  5.4164, lon: 100.3327, radiusKm:  50 },
    { code: 'SIN', name: 'Singapore',    lat:  1.3521, lon: 103.8198, radiusKm:  50 },
    { code: 'ROT', name: 'Rotterdam',    lat: 51.9244, lon:   4.4777, radiusKm:  60 },
    { code: 'SNN', name: 'Shannon',      lat: 52.7019, lon:  -8.9205, radiusKm:  60 },
    { code: 'AUS', name: 'Austin',       lat: 30.2672, lon: -97.7431, radiusKm:  60 },
    { code: 'BNA', name: 'Nashville',    lat: 36.1627, lon: -86.7816, radiusKm:  60 },
    { code: 'POA', name: 'Porto Alegre', lat:-30.0346, lon: -51.2177, radiusKm:  60 },
  ];
  const cards = hubs.map(hub => {
    const nearby = INCIDENTS.filter(inc => {
      if (!inc.lat || !inc.lon) return false;
      const dx = (inc.lon - hub.lon) * Math.cos(hub.lat * Math.PI / 180) * 111.32;
      const dy = (inc.lat - hub.lat) * 111.32;
      return Math.sqrt(dx * dx + dy * dy) <= hub.radiusKm;
    });
    const badgeClass = nearby.length > 0 ? 'style="color:#f28b82;font-weight:700;"' : 'style="color:#81c995;"';
    return `<div class="drawer-hub-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;">${escapeHtml(hub.code)} — ${escapeHtml(hub.name)}</span>
        <span ${badgeClass}>${nearby.length} incident${nearby.length !== 1 ? 's' : ''}</span>
      </div>
      <div style="font-size:0.75rem;color:#9aa0a6;margin-top:4px;">${hub.radiusKm} km radius</div>
      <button class="radar-btn mt-1" data-action="logistics-radar" data-hub="${escapeAttr(hub.code)}"
        data-lat="${hub.lat}" data-lon="${hub.lon}"
        aria-label="Live radar for ${escapeHtml(hub.code)}">
        <i class="fas fa-satellite-dish me-1" aria-hidden="true"></i>Live Radar
      </button>
      <div class="drawer-radar-result" id="radar-result-${escapeAttr(hub.code)}"></div>
    </div>`;
  }).join('');
  container.innerHTML = cards || '<div class="drawer-empty">No hub data.</div>';
}

function renderWatchlistFromData(watchlist) {
  const container = document.getElementById('logistics-watchlist-list');
  if (!container) return;
  // Keep local cache in sync so optimistic deletes work across KV eventual-consistency lag
  WATCHLIST_CACHE = Array.isArray(watchlist) ? watchlist.map(i => typeof i === 'string' ? { id: i, type: 'flight', label: i } : i) : [];
  if (!Array.isArray(watchlist) || watchlist.length === 0) {
    container.innerHTML = '<div class="drawer-empty">No items in watchlist.</div>';
    return;
  }
  container.innerHTML = watchlist.map(item => {
    // Normalise: old entries may be plain strings, new ones are objects
    const id    = typeof item === 'string' ? item : (item.id || '');
    const type  = typeof item === 'object' && item.type === 'vessel' ? 'vessel' : 'flight';
    const label = typeof item === 'object' && item.label ? item.label : id.toUpperCase();
    const isVessel = type === 'vessel';
    const safeId    = escapeAttr(id);
    const safeLabel = escapeHtml(label);
    const typeIcon  = isVessel ? '<i class="fas fa-ship me-1" aria-hidden="true"></i>' : '<i class="fas fa-plane me-1" aria-hidden="true"></i>';
    const actionBtn = isVessel
      ? `<button class="radar-btn mt-1" data-action="logistics-track" data-icao="${safeId}" data-type="vessel" aria-label="Track ${safeLabel} via AIS">
           <i class="fas fa-anchor me-1" aria-hidden="true"></i>Live AIS
         </button>
         <div class="drawer-radar-result" id="track-result-${safeId}"></div>`
      : `<button class="radar-btn mt-1" data-action="logistics-track" data-icao="${safeId}" data-type="${type}" aria-label="Track ${safeLabel}">
           <i class="fas fa-satellite-dish me-1" aria-hidden="true"></i>Live Radar
         </button>
         <div class="drawer-radar-result" id="track-result-${safeId}"></div>`;
    return `<div class="drawer-watch-card" id="watch-card-${safeId}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;font-family:monospace;">${typeIcon}${safeLabel}</span>
        <button class="remove-btn" data-action="logistics-remove-watch" data-id="${safeId}"
          aria-label="Remove ${safeLabel} from watchlist">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      ${actionBtn}
    </div>`;
  }).join('');
}

async function loadLogisticsWatchlist() {
  const container = document.getElementById('logistics-watchlist-list');
  if (!container) return;
  container.innerHTML = '<div class="drawer-empty">Loading…</div>';
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/logistics/watch`, {
      headers: { 'X-User-Id': OSINFO_USER_ID },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    // Worker returns { watchlist: [{id, type, label, added_at}] }
    const watchlist = Array.isArray(data.watchlist) ? data.watchlist : (Array.isArray(data) ? data : []);
    renderWatchlistFromData(watchlist);
  } catch (e) {
    container.innerHTML = `<div class="drawer-empty">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function trackFlight(icao24, resultElId, type = 'flight') {
  const el = document.getElementById(resultElId);
  if (!el) return;
  el.textContent = 'Fetching…';
  try {
    const res = await fetchWithTimeout(
      `${WORKER_URL}/api/logistics/track?icao24=${encodeURIComponent(icao24)}`,
      { headers: { 'X-User-Id': OSINFO_USER_ID } },
      50000  // OpenSky OAuth2 + states (20 s) + flights (20 s) sequential
    );
    const data = await res.json().catch(() => ({}));
    console.log('[logistics] track result', icao24, res.status, data.ok, data.status || data.reason || data.error || '', 'wv:', data._wv || 'OLD');

    // ── Structured error responses ───────────────────────────────────────────
    if (data.ok === false || (!res.ok && !data.status)) {
      const reason = data.reason || data.error || '';
      if (reason === 'opensky_timeout') {
        const fr24 = data.deep_link || `https://www.flightradar24.com/search?query=${encodeURIComponent(icao24)}`;
        el.innerHTML = `<span class="status-badge status-UNKNOWN">TIMEOUT</span> OpenSky slow — <a href="${escapeAttr(fr24)}" target="_blank" rel="noopener noreferrer" style="color:#8ab4f8;">Track on FlightRadar24 ↗</a> or click Live Radar to retry.`;
        return;
      }
      if (reason === 'opensky_not_configured') {
        el.innerHTML = `<span class="status-badge status-UNKNOWN">UNKNOWN</span> OpenSky not configured. <a href="${escapeAttr(data.deep_link || 'https://opensky-network.org/')}" target="_blank" rel="noopener noreferrer" style="color:#8ab4f8;">Open OpenSky ↗</a>`;
        return;
      }
      if (reason === 'no_schedule_found') {
        const fr24 = data.deep_link || `https://www.flightradar24.com/search?query=${encodeURIComponent(icao24)}`;
        el.innerHTML = `<span class="status-badge status-UNKNOWN">NOT FOUND</span> Not airborne or wrong ID. <a href="${escapeAttr(fr24)}" target="_blank" rel="noopener noreferrer" style="color:#8ab4f8;">Find on FlightRadar24 ↗</a><div style="font-size:0.68rem;color:#9aa0a6;margin-top:2px;">Tip: on FR24 click the aircraft → copy its hex code (e.g. a0001e) and use that instead.</div>`;
        return;
      }
      el.textContent = reason || `Error: HTTP ${res.status}`;
      return;
    }

    // ── LIVE ─────────────────────────────────────────────────────────────────
    if (data.status === 'LIVE' && Array.isArray(data.states) && data.states.length > 0) {
      const s   = data.states[0];
      const ftAlt = s.baro_altitude != null ? (s.baro_altitude / 0.3048).toFixed(0) + ' ft' : 'N/A';
      const kt    = s.velocity      != null ? (s.velocity / 0.514444).toFixed(0) + ' kt'    : 'N/A';
      const hdg   = s.true_track    != null ? s.true_track.toFixed(0) + '°'                 : '';
      const label = (s.callsign || icao24).toUpperCase();
      // Place / move marker on main map if position is known
      if (s.latitude != null && s.longitude != null) {
        placeLogisticsMarker(icao24, type, s.latitude, s.longitude, {
          scheduleBrief: null, callsign: s.callsign || null,
        });
      }
      // Cache state object so the button handler can retrieve it without JSON-in-attribute
      _ltmStateCache[icao24] = s;
      el.innerHTML = `
        <span class="status-badge status-LIVE">LIVE</span>
        <div style="margin-top:3px;">
          <strong>${escapeHtml(label)}</strong> &nbsp;|&nbsp;
          ${escapeHtml(ftAlt)} &nbsp;|&nbsp; ${escapeHtml(kt)} ${hdg ? '&nbsp;|&nbsp; ' + escapeHtml(hdg) : ''}
        </div>
        <div style="margin-top:4px;">
          <button class="live-track-open-btn" data-action="open-live-track"
            data-icao="${escapeAttr(icao24)}" data-callsign="${escapeAttr(label)}"
            aria-label="Open live tracker for ${escapeAttr(label)}">
            &#128225; Open Live Tracker
          </button>
        </div>`;
      return;
    }

    // ── SCHEDULED / DEPARTED / ARRIVED ───────────────────────────────────────
    if (['SCHEDULED', 'DEPARTED', 'ARRIVED'].includes(data.status)) {
      const depArrow = (data.estDepartureAirport && data.estArrivalAirport)
        ? `<div style="font-size:0.72rem;color:#9aa0a6;margin-top:2px;">Origin ➔ Destination: <strong>${escapeHtml(data.estDepartureAirport)} → ${escapeHtml(data.estArrivalAirport)}</strong></div>` : '';
      const lastLine = data.lastSeen
        ? `<div style="font-size:0.72rem;color:#9aa0a6;">Last detected: ${escapeHtml(new Date(data.lastSeen).toLocaleString())}</div>` : '';
      el.innerHTML = `
        <span class="status-badge status-${escapeHtml(data.status)}">${escapeHtml(data.status)}</span>
        <div style="margin-top:3px;">${escapeHtml(data.scheduleBrief || '')}</div>
        ${depArrow}${lastLine}
        ${data._cached ? '<div style="font-size:0.65rem;color:#5f6368;">(cached)</div>' : ''}`;
      return;
    }

    // ── VESSEL: any vessel status → show Vessel Tracker button ───────────────
    if (['IN-PORT', 'STATIONARY', 'UNKNOWN', 'VESSEL_TRACK', 'VESSEL_LIVE'].includes(data.status)) {
      const mmsi   = data.mmsi || icao24;
      const vsName = data.states && data.states[0]?.vessel_name ? data.states[0].vessel_name : '';
      const vsDest = data.states && data.states[0]?.destination  ? data.states[0].destination  : '';
      const vsSOG  = data.states && data.states[0]?.velocity     != null
        ? (data.states[0].velocity / 0.514444).toFixed(1) + ' kt' : null;
      const hubLine = data.lastHubName
        ? `<div style="font-size:0.72rem;color:#9aa0a6;margin-top:2px;">Last hub: <strong>${escapeHtml(data.lastHubName)}</strong></div>` : '';
      // Cache embed URL + live state for the modal stats bar
      if (data.embed_url) _ltmStateCache['vessel_' + mmsi] = { embed_url: data.embed_url, deepLink: data.deepLink };
      if (data.states && data.states[0]) _ltmStateCache[mmsi] = data.states[0]; // SOG/heading/dest for stats bar
      el.innerHTML = `
        <span class="status-badge" style="background:#1a3a5c;color:#4fc3f7;border-radius:4px;padding:2px 7px;font-size:.72rem;font-weight:700;">⚓ VESSEL</span>
        ${vsName ? `<div style="margin-top:2px;font-weight:700;font-family:monospace;">${escapeHtml(vsName)}</div>` : ''}
        ${vsSOG  ? `<div style="font-size:0.72rem;color:#9aa0a6;">SOG: ${escapeHtml(vsSOG)}${vsDest ? ' &nbsp;→&nbsp; ' + escapeHtml(vsDest) : ''}</div>` : ''}
        ${hubLine}
        <div style="margin-top:5px;">
          <button class="live-track-open-btn" data-action="open-vessel-track"
            data-mmsi="${escapeAttr(mmsi)}"
            aria-label="Open vessel tracker for MMSI ${escapeAttr(mmsi)}">
            &#x1F6A2; Open Vessel Tracker
          </button>
        </div>`;
      return;
    }

    // ── Final fallback (legacy not_in_range or unexpected shape) ────────────
    if (data.not_in_range || !data.states || (Array.isArray(data.states) && data.states.length === 0)) {
      el.textContent = 'Flight not currently in range.';
      return;
    }
    el.textContent = 'Unexpected response format.';
  } catch (e) {
    el.textContent = `Error: ${escapeHtml(e.message)}`;
  }
}

async function addToWatchlist(id, type) {
  const listEl = document.getElementById('logistics-watchlist-list');
  if (!id || id.length < 2 || id.length > 12 || !/^[a-z0-9]+$/i.test(id)) {
    if (listEl) listEl.innerHTML = `<div class="drawer-empty" style="color:#f28b82;">⚠ Enter a flight callsign (e.g. EJM618), ICAO24 hex (e.g. a0001e), or vessel MMSI (digits).</div>`;
    return;
  }
  const normId   = id.toLowerCase();
  const itemType = type === 'vessel' ? 'vessel' : 'flight';
  // 1. Update local cache immediately — skip if already present
  if (!WATCHLIST_CACHE.some(w => (typeof w === 'string' ? w : w.id) === normId)) {
    WATCHLIST_CACHE.push({ id: normId, type: itemType, label: normId, added_at: new Date().toISOString() });
  }
  // 2. Render from local cache — do NOT use server response (it reads stale KV and re-adds deleted items)
  renderWatchlistFromData(WATCHLIST_CACHE);
  const input = document.getElementById('watch-icao-input');
  if (input) input.value = '';
  // 3. Persist entire cache to server via action:'set' — no KV read on server side, no race condition
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/logistics/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': OSINFO_USER_ID },
      body: JSON.stringify({ action: 'set', watchlist: WATCHLIST_CACHE }),
    });
    const resData = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(resData.error || `HTTP ${res.status}`);
    console.log('[watchlist] add persisted, server items:', resData.items);
  } catch (e) {
    console.error('[watchlist] add server sync failed:', e.message);
    if (listEl) listEl.innerHTML = `<div class="drawer-empty" style="color:#f28b82;">⚠ Save failed: ${escapeHtml(e.message)}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   LIVE TRACK MODAL  (S2.5 — popup aircraft tracker)
═══════════════════════════════════════════════════════ */
function _ltmEl(id) { return document.getElementById(id); }

// Creates modal HTML + CSS dynamically — no index.html dependency
function _ensureLiveTrackModal() {
  if (_ltmEl('live-track-modal')) return; // already in DOM (from index.html)
  // Inject styles
  if (!_ltmEl('ltm-injected-styles')) {
    const st = document.createElement('style');
    st.id = 'ltm-injected-styles';
    st.textContent = [
      '.live-track-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:5999;display:none;cursor:pointer}',
      '.live-track-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:1120px;height:84vh;background:#1a1b1e;color:#e8eaed;z-index:6000;border-radius:12px;box-shadow:0 8px 48px rgba(0,0,0,.85);display:none;flex-direction:column;font-family:Inter,sans-serif;overflow:hidden}',
      '.live-track-modal.open{display:flex}',
      '.ltm-topbar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#292a2d;border-bottom:1px solid #3c4043;flex-shrink:0;flex-wrap:wrap}',
      '.ltm-badge{background:#1e4620;color:#81c995;font-size:.7rem;font-weight:700;border-radius:4px;padding:2px 8px;letter-spacing:1px;animation:ltmPulse 2s infinite}',
      '@keyframes ltmPulse{0%,100%{opacity:1}50%{opacity:.5}}',
      '.ltm-callsign{font-size:1.05rem;font-weight:800;font-family:monospace;color:#4fc3f7;letter-spacing:1px}',
      '.ltm-stat{background:#3c4043;border-radius:6px;padding:3px 9px;font-size:.77rem;color:#e8eaed;font-family:monospace;line-height:1.5}',
      '.ltm-stat em{color:#9aa0a6;font-style:normal;font-size:.65rem;display:block}',
      '.ltm-close{margin-left:auto;background:#5f2120;color:#f28b82;border:none;border-radius:6px;padding:5px 14px;font-size:.82rem;font-weight:700;cursor:pointer}',
      '.ltm-close:hover{background:#8b3a38}',
      '.ltm-mapwrap{flex:1;position:relative;min-height:0}',
      '#live-track-map{width:100%;height:100%}',
      '.ltm-footer{padding:5px 14px;background:#202124;font-size:.7rem;color:#5f6368;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
      '.ltm-footer a{color:#8ab4f8;text-decoration:none}',
      '.live-track-open-btn{background:#1a3a5c;color:#4fc3f7;border:1px solid #2a5a8c;border-radius:5px;padding:3px 10px;font-size:.74rem;font-weight:700;cursor:pointer;margin-top:4px;display:inline-flex;align-items:center;gap:5px}',
      '.live-track-open-btn:hover{background:#244a7a}',
    ].join('');
    document.head.appendChild(st);
  }
  // Create overlay
  const ov = document.createElement('div');
  ov.id = 'live-track-overlay';
  ov.className = 'live-track-overlay';
  ov.addEventListener('click', closeLiveTrackModal);
  document.body.appendChild(ov);
  // Create modal
  const mo = document.createElement('div');
  mo.id = 'live-track-modal';
  mo.className = 'live-track-modal';
  mo.setAttribute('role', 'dialog');
  mo.setAttribute('aria-modal', 'true');
  mo.innerHTML =
    '<div class="ltm-topbar">' +
      '<span class="ltm-badge">&#9679; LIVE</span>' +
      '<span class="ltm-callsign" id="ltm-callsign">---</span>' +
      '<div class="ltm-stat"><em>ALTITUDE</em><span id="ltm-alt">---</span></div>' +
      '<div class="ltm-stat"><em>SPEED</em><span id="ltm-vel">---</span></div>' +
      '<div class="ltm-stat"><em>HEADING</em><span id="ltm-hdg">---</span></div>' +
      '<div class="ltm-stat"><em>VERT RATE</em><span id="ltm-vr">---</span></div>' +
      '<div class="ltm-stat"><em>COUNTRY</em><span id="ltm-country">---</span></div>' +
      '<button class="ltm-close" data-action="close-live-track" aria-label="Close">&#x2715; Close</button>' +
    '</div>' +
    '<div class="ltm-mapwrap"><div id="live-track-map"></div></div>' +
    '<div class="ltm-footer">' +
      '<span id="ltm-status">Connecting&hellip;</span>' +
      '<a id="ltm-fr24-link" href="#" target="_blank" rel="noopener noreferrer">Open on FlightRadar24 &#8599;</a>' +
    '</div>';
  document.body.appendChild(mo);
}

function _ltmUpdateStats(s) {
  const ftAlt  = s.baro_altitude != null ? (s.baro_altitude / 0.3048).toFixed(0) + ' ft'  : 'N/A';
  const mAlt   = s.baro_altitude != null ? s.baro_altitude.toFixed(0) + ' m'               : '';
  const ktVel  = s.velocity      != null ? (s.velocity / 0.514444).toFixed(0) + ' kt'     : 'N/A';
  const msVel  = s.velocity      != null ? s.velocity.toFixed(0) + ' m/s'                  : '';
  const hdg    = s.true_track    != null ? s.true_track.toFixed(0) + '°'                   : 'N/A';
  const vrRaw  = s.vertical_rate;
  const vr     = vrRaw != null ? (vrRaw > 0 ? '▲ ' : vrRaw < 0 ? '▼ ' : '→ ') + Math.abs((vrRaw / 0.00508).toFixed(0)) + ' ft/min' : 'N/A';
  if (_ltmEl('ltm-alt'))     _ltmEl('ltm-alt').textContent     = ftAlt + (mAlt ? ' / ' + mAlt : '');
  if (_ltmEl('ltm-vel'))     _ltmEl('ltm-vel').textContent     = ktVel + (msVel ? ' / ' + msVel : '');
  if (_ltmEl('ltm-hdg'))     _ltmEl('ltm-hdg').textContent     = hdg;
  if (_ltmEl('ltm-vr'))      _ltmEl('ltm-vr').textContent      = vr;
  if (_ltmEl('ltm-country')) _ltmEl('ltm-country').textContent = s.origin_country || '---';
}

function _ltmPlotPosition(s) {
  const lt = s.latitude, ln = s.longitude, tr = s.true_track || 0;
  if (lt == null || ln == null) return;
  liveTrackState.trailCoords.push([lt, ln]);
  // Rotating aircraft icon using CSS transform
  const iconHtml = `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
    <svg style="transform:rotate(${tr}deg);width:28px;height:28px;" viewBox="0 0 24 24" fill="#4fc3f7">
      <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>
    </svg></div>`;
  const icon = L.divIcon({ html: iconHtml, iconSize: [32,32], iconAnchor: [16,16], className: '' });
  const lmap = liveTrackState.map;
  if (!lmap) return;
  if (liveTrackState.marker) {
    liveTrackState.marker.setLatLng([lt, ln]);
    liveTrackState.marker.setIcon(icon);
  } else {
    liveTrackState.marker = L.marker([lt, ln], { icon, zIndexOffset: 1000 }).addTo(lmap);
  }
  if (liveTrackState.trail) {
    liveTrackState.trail.setLatLngs(liveTrackState.trailCoords);
  } else {
    liveTrackState.trail = L.polyline(liveTrackState.trailCoords, { color:'#4fc3f7', weight:2, opacity:0.55, dashArray:'6 4' }).addTo(lmap);
  }
  // Only fly to aircraft on first plot or if it drifted far from view
  if (liveTrackState.trailCoords.length <= 1) {
    lmap.setView([lt, ln], 7);
  }
}

function openLiveTrackModal(icao24, callsign, initialState) {
  _ensureLiveTrackModal(); // create modal HTML+CSS dynamically if not already in DOM
  liveTrackState.icao24 = icao24;
  // Stop any previous poll
  if (liveTrackState.pollTimer) { clearInterval(liveTrackState.pollTimer); liveTrackState.pollTimer = null; }
  // Show overlay + modal
  const overlay = _ltmEl('live-track-overlay');
  const modal   = _ltmEl('live-track-modal');
  if (!overlay || !modal) return;
  overlay.style.display = 'block';
  modal.classList.add('open');
  // Header
  const label = (callsign || icao24 || '---').toUpperCase();
  if (_ltmEl('ltm-callsign')) _ltmEl('ltm-callsign').textContent = label;
  const fr24 = `https://www.flightradar24.com/search?query=${encodeURIComponent(label)}`;
  const fr24link = _ltmEl('ltm-fr24-link');
  if (fr24link) { fr24link.href = fr24; }
  // Init Leaflet map once
  if (!liveTrackState.map) {
    liveTrackState.map = L.map('live-track-map', { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 18,
    }).addTo(liveTrackState.map);
    L.control.attribution({ prefix: '© CartoDB · OpenStreetMap' }).addTo(liveTrackState.map);
  } else {
    // Clear previous aircraft
    if (liveTrackState.marker) { liveTrackState.map.removeLayer(liveTrackState.marker); liveTrackState.marker = null; }
    if (liveTrackState.trail)  { liveTrackState.map.removeLayer(liveTrackState.trail);  liveTrackState.trail  = null; }
    liveTrackState.trailCoords = [];
  }
  // Must invalidate AFTER modal is visible
  setTimeout(() => { if (liveTrackState.map) liveTrackState.map.invalidateSize(); }, 120);
  // Plot initial state
  if (initialState) { _ltmUpdateStats(initialState); _ltmPlotPosition(initialState); }
  if (_ltmEl('ltm-status')) _ltmEl('ltm-status').textContent = 'Live — auto-refreshing every 30 s';
  // Start 30-second poll
  liveTrackState.pollTimer = setInterval(_ltmPoll, 30000);
}

async function _ltmPoll() {
  const icao24 = liveTrackState.icao24;
  if (!icao24 || !_ltmEl('live-track-modal')?.classList.contains('open')) return;
  try {
    const res  = await fetchWithTimeout(`${WORKER_URL}/api/logistics/track?icao24=${encodeURIComponent(icao24)}`, { headers: { 'X-User-Id': OSINFO_USER_ID } }, 15000);
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.status === 'LIVE' && Array.isArray(data.states) && data.states.length > 0) {
      const s = data.states[0];
      _ltmUpdateStats(s);
      _ltmPlotPosition(s);
      const ts = new Date().toLocaleTimeString();
      if (_ltmEl('ltm-status')) _ltmEl('ltm-status').textContent = `Last updated ${ts} — refreshing every 30 s`;
    } else {
      if (_ltmEl('ltm-status')) _ltmEl('ltm-status').textContent = `No signal — aircraft may have landed`;
    }
  } catch(e) {
    if (_ltmEl('ltm-status')) _ltmEl('ltm-status').textContent = `Poll error: ${e.message}`;
  }
}

function closeLiveTrackModal() {
  if (liveTrackState.pollTimer) { clearInterval(liveTrackState.pollTimer); liveTrackState.pollTimer = null; }
  const overlay = _ltmEl('live-track-overlay');
  const modal   = _ltmEl('live-track-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.classList.remove('open');
}

/* ═══════════════════════════════════════════════════════
   VESSEL TRACK MODAL  (S2.5 — three-path: Leaflet LIVE | VF iframe MMSI | IMO guidance)
   Path A — VESSEL_LIVE (aisstream returned coords)  → Leaflet dark map + rotating ship icon
   Path B — VESSEL_TRACK with 9-digit MMSI           → VesselFinder iframe (centers on MMSI)
   Path C — 7-digit IMO entered                      → guidance overlay (enter MMSI instead)
═══════════════════════════════════════════════════════ */
let _vtmMap = null;
let _vtmMarker = null;
let _vtmTrail = null;
let _vtmTrailCoords = [];

function _ensureVesselTrackModal() {
  if (_ltmEl('vessel-track-modal')) return;
  if (!_ltmEl('vtm-injected-styles')) {
    const st = document.createElement('style');
    st.id = 'vtm-injected-styles';
    st.textContent = [
      '.vtm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:5999;display:none;cursor:pointer}',
      '.vessel-track-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:1200px;height:86vh;background:#1a1b1e;color:#e8eaed;z-index:6000;border-radius:12px;box-shadow:0 8px 48px rgba(0,0,0,.85);display:none;flex-direction:column;font-family:Inter,sans-serif;overflow:hidden}',
      '.vessel-track-modal.open{display:flex}',
      '.vtm-topbar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1a2744;border-bottom:1px solid #2a3a6c;flex-shrink:0;flex-wrap:wrap}',
      '.vtm-badge{background:#1a3a5c;color:#4fc3f7;font-size:.7rem;font-weight:700;border-radius:4px;padding:2px 8px;letter-spacing:1px;animation:vtmPulse 3s infinite}',
      '@keyframes vtmPulse{0%,100%{opacity:1}50%{opacity:.55}}',
      '.vtm-mmsi{font-size:1rem;font-weight:800;font-family:monospace;color:#81d4fa;letter-spacing:1px}',
      '.vtm-name{font-size:.9rem;color:#e8eaed;font-weight:600}',
      '.vtm-stat{background:#243050;border-radius:6px;padding:3px 9px;font-size:.77rem;color:#e8eaed;font-family:monospace;line-height:1.5}',
      '.vtm-stat em{color:#8ab4f8;font-style:normal;font-size:.65rem;display:block}',
      '.vtm-close{margin-left:auto;background:#5f2120;color:#f28b82;border:none;border-radius:6px;padding:5px 14px;font-size:.82rem;font-weight:700;cursor:pointer}',
      '.vtm-close:hover{background:#8b3a38}',
      '.vtm-mapwrap{flex:1;position:relative;min-height:0;background:#111827}',
      '#vtm-map{position:absolute;inset:0;width:100%;height:100%;display:none}',
      '#vtm-iframe{position:absolute;inset:0;width:100%;height:100%;border:none;display:none}',
      '.vtm-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#111827;color:#5f6368;font-size:.88rem;z-index:5;pointer-events:none}',
      '.vtm-nofix{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,16,28,.97);color:#9aa0a6;font-size:.9rem;gap:14px;z-index:9999;text-align:center;padding:28px}',
      '.vtm-nofix a{color:#8ab4f8;text-decoration:none;font-weight:600}',
      '.vtm-footer{padding:5px 14px;background:#111827;font-size:.7rem;color:#5f6368;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px}',
      '.vtm-footer a{color:#8ab4f8;text-decoration:none}',
    ].join('');
    document.head.appendChild(st);
  }
  const ov = document.createElement('div');
  ov.id = 'vtm-overlay';
  ov.className = 'vtm-overlay';
  ov.addEventListener('click', closeVesselTrackModal);
  document.body.appendChild(ov);
  const mo = document.createElement('div');
  mo.id = 'vessel-track-modal';
  mo.className = 'vessel-track-modal';
  mo.setAttribute('role', 'dialog');
  mo.setAttribute('aria-modal', 'true');
  mo.innerHTML =
    '<div class="vtm-topbar">' +
      '<span class="vtm-badge">&#x2693; VESSEL AIS</span>' +
      '<span class="vtm-name" id="vtm-name"></span>' +
      '<span class="vtm-mmsi" id="vtm-mmsi"></span>' +
      '<div class="vtm-stat"><em>SOG</em><span id="vtm-sog">---</span></div>' +
      '<div class="vtm-stat"><em>HEADING</em><span id="vtm-hdg">---</span></div>' +
      '<div class="vtm-stat"><em>DESTINATION</em><span id="vtm-dest">---</span></div>' +
      '<button class="vtm-close" data-action="close-vessel-track" aria-label="Close">&#x2715; Close</button>' +
    '</div>' +
    '<div class="vtm-mapwrap">' +
      /* Path A — Leaflet map (VESSEL_LIVE only) */
      '<div id="vtm-map"></div>' +
      /* Path B — VesselFinder iframe (9-digit MMSI, no live data) */
      '<div class="vtm-loading" id="vtm-loading" style="display:none">Loading AIS map&hellip;</div>' +
      '<iframe id="vtm-iframe" src="about:blank" title="Live vessel AIS map" loading="lazy"></iframe>' +
      /* Path C — IMO guidance overlay */
      '<div class="vtm-nofix" id="vtm-nofix" style="display:none">' +
        '<span style="font-size:2.2rem;">&#x26A0;</span>' +
        '<span style="font-size:1.05rem;color:#e8eaed;font-weight:700;">No live AIS position found</span>' +
        '<span id="vtm-nofix-reason" style="font-size:.82rem;color:#9aa0a6;max-width:460px;line-height:1.75;"></span>' +
        '<div style="display:flex;gap:18px;margin-top:4px;">' +
          '<a id="vtm-nofix-mt" href="#" target="_blank" rel="noopener noreferrer">&#128279; MarineTraffic</a>' +
          '<a id="vtm-nofix-vf" href="#" target="_blank" rel="noopener noreferrer">&#128279; VesselFinder</a>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="vtm-footer">' +
      '<span id="vtm-footer-label">&#x1F6A2; Live AIS tracking</span>' +
      '<div style="display:flex;gap:12px;">' +
        '<a id="vtm-mt-link" href="#" target="_blank" rel="noopener noreferrer">MarineTraffic &#8599;</a>' +
        '<a id="vtm-vf-link" href="#" target="_blank" rel="noopener noreferrer">VesselFinder &#8599;</a>' +
      '</div>' +
    '</div>';
  // Hide loading spinner when iframe loads
  const iframe = mo.querySelector('#vtm-iframe');
  const loading = mo.querySelector('#vtm-loading');
  if (iframe && loading) iframe.addEventListener('load', () => { loading.style.display = 'none'; });
  document.body.appendChild(mo);
}

function _vtmShowOnly(which) {
  // which: 'map' | 'iframe' | 'nofix'
  const mapEl    = _ltmEl('vtm-map');
  const iframeEl = _ltmEl('vtm-iframe');
  const nofixEl  = _ltmEl('vtm-nofix');
  const loadEl   = _ltmEl('vtm-loading');
  if (mapEl)    mapEl.style.display    = which === 'map'    ? 'block' : 'none';
  if (iframeEl) iframeEl.style.display = which === 'iframe' ? 'block' : 'none';
  if (nofixEl)  nofixEl.style.display  = which === 'nofix'  ? 'flex'  : 'none';
  if (loadEl)   loadEl.style.display   = which === 'iframe' ? 'flex'  : 'none';
}

function _vtmPlotVessel(s) {
  if (!_vtmMap || s.latitude == null || s.longitude == null) return;
  const cog = s.true_track != null ? s.true_track : 0;
  const shipSvg =
    `<svg width="30" height="30" viewBox="0 0 30 30" style="transform:rotate(${cog}deg);transform-origin:center;" xmlns="http://www.w3.org/2000/svg">` +
      `<polygon points="15,2 22,26 15,21 8,26" fill="#4fc3f7" stroke="#0a1628" stroke-width="1.5"/>` +
    `</svg>`;
  const icon = L.divIcon({ className: '', html: shipSvg, iconSize: [30, 30], iconAnchor: [15, 15] });
  if (_vtmMarker) { _vtmMarker.setLatLng([s.latitude, s.longitude]); _vtmMarker.setIcon(icon); }
  else { _vtmMarker = L.marker([s.latitude, s.longitude], { icon, zIndexOffset: 1000 }).addTo(_vtmMap); }
  _vtmTrailCoords.push([s.latitude, s.longitude]);
  if (_vtmTrailCoords.length > 120) _vtmTrailCoords.shift();
  if (_vtmTrail) { _vtmTrail.setLatLngs(_vtmTrailCoords); }
  else { _vtmTrail = L.polyline(_vtmTrailCoords, { color: '#4fc3f7', weight: 2, dashArray: '5,7', opacity: 0.65 }).addTo(_vtmMap); }
  _vtmMap.setView([s.latitude, s.longitude], _vtmMap.getZoom() || 8);
}

function openVesselTrackModal(mmsi) {
  _ensureVesselTrackModal();
  const cached  = _ltmStateCache['vessel_' + mmsi] || {};
  const liveS   = _ltmStateCache[mmsi] || null;
  const isMmsi9 = /^\d{9}$/.test(mmsi);
  const isIMO7  = /^\d{7}$/.test(mmsi);
  // Stats bar
  if (_ltmEl('vtm-mmsi')) _ltmEl('vtm-mmsi').textContent = mmsi;
  if (_ltmEl('vtm-name')) _ltmEl('vtm-name').textContent = liveS?.vessel_name || cached.vessel_name || '';
  if (_ltmEl('vtm-sog'))  _ltmEl('vtm-sog').textContent  = liveS?.velocity   != null ? (liveS.velocity / 0.514444).toFixed(1) + ' kt' : '---';
  if (_ltmEl('vtm-hdg'))  _ltmEl('vtm-hdg').textContent  = liveS?.true_track != null ? liveS.true_track.toFixed(0) + '°' : '---';
  if (_ltmEl('vtm-dest')) _ltmEl('vtm-dest').textContent = liveS?.destination || cached.destination || '---';
  // External links
  const mtLink = cached.deepLink || (isIMO7
    ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${mmsi}`
    : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`);
  const vfLink = cached.vessel_finder_link || (isIMO7
    ? `https://www.vesselfinder.com/vessels?name=&imo=${mmsi}`
    : `https://www.vesselfinder.com/vessels?mmsi=${mmsi}`);
  ['vtm-mt-link','vtm-nofix-mt'].forEach(id => { const el = _ltmEl(id); if (el) el.href = mtLink; });
  ['vtm-vf-link','vtm-nofix-vf'].forEach(id => { const el = _ltmEl(id); if (el) el.href = vfLink; });
  // Show modal (must be visible before Leaflet or iframe init)
  const ov = _ltmEl('vtm-overlay');
  const mo = _ltmEl('vessel-track-modal');
  if (ov) ov.style.display = 'block';
  if (mo) mo.classList.add('open');
  // Clean up previous Leaflet instance
  if (_vtmMap) { try { _vtmMap.remove(); } catch(e){} _vtmMap = null; _vtmMarker = null; _vtmTrail = null; _vtmTrailCoords = []; }

  /* ── PATH A: live aisstream coordinates → Leaflet map ── */
  if (liveS && liveS.latitude != null && liveS.longitude != null) {
    _vtmShowOnly('map');
    if (_ltmEl('vtm-footer-label')) _ltmEl('vtm-footer-label').textContent = '🚢 Live AIS position — aisstream.io';
    const mapEl = _ltmEl('vtm-map');
    if (mapEl) {
      _vtmMap = L.map(mapEl, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(_vtmMap);
      _vtmPlotVessel(liveS);
    }
    return;
  }

  /* ── PATH B: 9-digit MMSI, no live data → VesselFinder iframe ── */
  if (isMmsi9) {
    _vtmShowOnly('iframe');
    if (_ltmEl('vtm-footer-label')) _ltmEl('vtm-footer-label').textContent = '🚢 AIS map via VesselFinder — live vessel position';
    const embedUrl = `https://www.vesselfinder.com/aismap?zoom=9&mmsi=${mmsi}&width=100%25&height=100%25&names=true&remember=false&clicktoact=false`;
    const iframeEl = _ltmEl('vtm-iframe');
    if (iframeEl) iframeEl.src = embedUrl;
    return;
  }

  /* ── PATH C: 7-digit IMO (or other) → guidance overlay ── */
  _vtmShowOnly('nofix');
  const reasonEl = _ltmEl('vtm-nofix-reason');
  if (reasonEl) {
    reasonEl.innerHTML = isIMO7
      ? '<strong style="color:#f28b82;">You entered a 7-digit IMO number.</strong><br>' +
        'Live AIS tracking requires the <strong style="color:#4fc3f7;">9-digit MMSI</strong>.<br><br>' +
        '1. Click "MarineTraffic" below &rarr; search this vessel &rarr; copy its MMSI<br>' +
        '2. Remove this entry from the watchlist<br>' +
        '3. Re-add using the 9-digit MMSI &mdash; the map will load correctly.'
      : 'Could not determine vessel type from ID <strong>' + mmsi + '</strong>.<br>' +
        'Please enter a valid <strong style="color:#4fc3f7;">9-digit MMSI</strong>.';
  }
}

function closeVesselTrackModal() {
  const ov = _ltmEl('vtm-overlay');
  const mo = _ltmEl('vessel-track-modal');
  if (ov) ov.style.display = 'none';
  if (mo) mo.classList.remove('open');
  const iframeEl = _ltmEl('vtm-iframe');
  if (iframeEl) iframeEl.src = 'about:blank'; // stop live feed
  if (_vtmMap) { try { _vtmMap.remove(); } catch(e){} _vtmMap = null; _vtmMarker = null; _vtmTrail = null; _vtmTrailCoords = []; }
}

/* ═══════════════════════════════════════════════════════
   LIVE NEWS MODAL  (S2.5 — Global Intelligence Feed)
   Aggregates Reuters, Al Jazeera, BBC, USGS, GDACS via
   Worker /api/live-news endpoint. Auto-refreshes every 5 min.
   Source filter pills let user focus on one feed.
═══════════════════════════════════════════════════════ */
let _lnmTimer       = null;       // 5-min auto-refresh interval
let _lnmFilter      = 'all';     // active source filter
let _lnmItems       = [];        // latest items from Worker
let _lnmActiveTab   = 'headlines'; // 'headlines' | 'tv'
let _lnmActiveChannel = 'aljazeera'; // active TV channel key

// Live TV channel definitions
// hlsUrl = direct broadcast CDN stream (no ads) — YouTube ytId used as fallback on HLS failure
// Sources: iptv-org/iptv verified streams + official broadcaster CDNs (Akamai, getaj, france24, nhk, cgtn)
let _lnmHls = null; // active hls.js instance — destroyed on channel switch and modal close
const LNM_TV_CHANNELS = [
  // ── Direct HLS — no ads (Akamai / official CDNs) ─────────────────────────────
  { key: 'dw',        label: 'DW News',     color: '#1b5e20', ytId: 'LuKwFajn37U',
    hlsUrl: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/stream01/streamPlaylist.m3u8' }, // Akamai
  { key: 'skynews',   label: 'Sky News',    color: '#1565c0', ytId: 'uvviIF4725I',
    hlsUrl: 'https://linear417-gb-hls1-prd-ak.cdn.skycdp.com/100e/Content/HLS_001_1080_30/Live/channel(skynews)/index_1080-30.m3u8' }, // Sky News UK official CDN 2026
  { key: 'france24',  label: 'France 24',   color: '#880e4f', ytId: 'Ap-UM1O9RBU',
    hlsUrl: 'https://live.france24.com/hls/live/2037218-b/F24_EN_HI_HLS/master_2300.m3u8' }, // France24 official
  { key: 'aljazeera', label: 'Al Jazeera',  color: '#1976d2', ytId: 'gCNeDWCI0vo',
    hlsUrl: 'https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8' },                        // Al Jazeera CDN (alt subdomain)
  { key: 'bbc',       label: 'BBC World',   color: '#bb0000', ytId: 'bjgQzJzCZKs',
    hlsUrl: 'https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/t=3840/v=pv14/b=5070016/main.m3u8' }, // BBC Akamai WW
  { key: 'cgtn',      label: 'CGTN',        color: '#4a148c', ytId: '8bCBmjPa_jY',
    hlsUrl: 'https://english-livebkali.cgtn.com/live/encgtn.m3u8' },                          // CGTN official CDN
];

// Source badge colors — keyed by source_key from Worker
const LNM_SOURCE_COLORS = {
  // Global news
  reuters:      { bg: '#c62828', text: '#fff' }, apnews:       { bg: '#bf360c', text: '#fff' },
  bbc:          { bg: '#bb0000', text: '#fff' }, aljazeera:    { bg: '#1565c0', text: '#fff' },
  cnn:          { bg: '#cc0000', text: '#fff' }, dw:           { bg: '#1b5e20', text: '#fff' },
  guardian:     { bg: '#005689', text: '#fff' }, france24:     { bg: '#880e4f', text: '#fff' },
  // Logistics
  freightwaves: { bg: '#e65100', text: '#fff' }, gcaptain:     { bg: '#006064', text: '#fff' },
  maritime:     { bg: '#01579b', text: '#fff' }, loadstar:     { bg: '#37474f', text: '#fff' },
  splash247:    { bg: '#1565c0', text: '#fff' }, scdive:       { bg: '#0277bd', text: '#fff' },
  // Security / gov
  fbi:          { bg: '#b71c1c', text: '#fff' }, cisa:         { bg: '#1a237e', text: '#fff' },
  ustravel:     { bg: '#1565c0', text: '#fff' }, ukfcdo:       { bg: '#003078', text: '#fff' },
  reliefweb:    { bg: '#6a1b9a', text: '#fff' }, europol:      { bg: '#283593', text: '#fff' },
  // Hazards
  usgs:         { bg: '#6d4c41', text: '#fff' }, gdacs:        { bg: '#f57c00', text: '#fff' },
  emsc:         { bg: '#d84315', text: '#fff' },
  // Cyber
  darkreading:  { bg: '#212121', text: '#fff' }, hackernews:   { bg: '#ff6d00', text: '#fff' },
  cisacyber:    { bg: '#283593', text: '#fff' },
};

function _ensureLiveNewsModal() {
  if (_ltmEl('live-news-modal')) return;
  if (!_ltmEl('lnm-injected-styles')) {
    const st = document.createElement('style');
    st.id = 'lnm-injected-styles';
    st.textContent = [
      /* === Modal shell === */
      '.lnm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:6099;display:none;cursor:pointer}',
      '.live-news-modal{position:fixed;top:96px;left:50%;transform:translateX(-50%);width:94vw;max-width:1360px;height:calc(100vh - 106px);background:#131416;color:#e8eaed;z-index:6100;border-radius:12px;box-shadow:0 8px 56px rgba(0,0,0,.9);display:none;flex-direction:column;font-family:Inter,sans-serif;overflow:hidden}',
      '.live-news-modal.open{display:flex}',
      /* === Top bar === */
      '.lnm-topbar{display:flex;align-items:center;gap:8px;padding:9px 14px;background:#0d1117;border-bottom:1px solid #2a2d31;flex-shrink:0;flex-wrap:wrap}',
      '.lnm-badge{background:#1a3a5c;color:#4fc3f7;font-size:.7rem;font-weight:800;border-radius:4px;padding:2px 9px;letter-spacing:1px;white-space:nowrap}',
      /* Tab buttons */
      '.lnm-tabs{display:flex;gap:3px;margin-left:6px}',
      '.lnm-tab-btn{font-size:.72rem;font-weight:700;padding:4px 13px;border-radius:6px;border:1px solid #3c4043;background:transparent;color:#9aa0a6;cursor:pointer;transition:all .15s;white-space:nowrap}',
      '.lnm-tab-btn.active{background:#1a3a5c;color:#4fc3f7;border-color:#4fc3f7}',
      '.lnm-tab-btn:hover:not(.active){color:#e8eaed;border-color:#5f6368}',
      /* Source filter pills */
      '.lnm-src-pills{display:flex;gap:4px;flex-wrap:wrap}',
      '.lnm-pill{font-size:.68rem;font-weight:700;padding:3px 10px;border-radius:12px;border:1px solid #3c4043;background:transparent;color:#9aa0a6;cursor:pointer;transition:all .15s}',
      '.lnm-pill.active,.lnm-pill:hover{background:#243050;color:#e8eaed;border-color:#4fc3f7}',
      '.lnm-ts{font-size:.68rem;color:#5f6368;margin-left:auto;white-space:nowrap}',
      '.lnm-close{background:#5f2120;color:#f28b82;border:none;border-radius:6px;padding:5px 14px;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap}',
      '.lnm-close:hover{background:#8b3a38}',
      /* === Headlines panel === */
      '.lnm-feed{flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:5px}',
      '.lnm-item{display:flex;gap:10px;padding:9px 10px;background:#202124;border-radius:6px;border-left:3px solid transparent;transition:background .15s}',
      '.lnm-item:hover{background:#262a2e}',
      '.lnm-src{flex-shrink:0;width:90px;display:flex;align-items:flex-start;padding-top:1px}',
      '.lnm-src-badge{font-size:.6rem;font-weight:800;padding:2px 6px;border-radius:3px;letter-spacing:.3px;white-space:nowrap}',
      '.lnm-body{flex:1;min-width:0}',
      '.lnm-title a{color:#e8eaed;font-size:.82rem;font-weight:600;text-decoration:none;line-height:1.4}',
      '.lnm-title a:hover{color:#8ab4f8}',
      '.lnm-meta{font-size:.68rem;color:#5f6368;margin-top:2px}',
      '.lnm-summary{font-size:.73rem;color:#9aa0a6;margin-top:3px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.lnm-empty{padding:40px;text-align:center;color:#5f6368;font-size:.85rem}',
      '.lnm-loading{padding:40px;text-align:center;color:#5f6368;font-size:.85rem}',
      /* === Live TV panel === */
      '.lnm-tv-panel{flex:1;display:none;flex-direction:column;background:#000;overflow:hidden}',
      '.lnm-tv-panel.visible{display:flex}',
      '.lnm-ch-bar{display:flex;align-items:center;gap:6px;padding:7px 14px;background:#0d1117;border-bottom:1px solid #2a2d31;flex-wrap:wrap;flex-shrink:0}',
      '.lnm-ch-label{font-size:.66rem;color:#5f6368;font-weight:700;letter-spacing:.5px;white-space:nowrap;margin-right:4px}',
      '.lnm-ch-btn{font-size:.68rem;font-weight:700;padding:3px 12px;border-radius:10px;border:1px solid #3c4043;background:transparent;color:#9aa0a6;cursor:pointer;transition:all .15s;white-space:nowrap}',
      '.lnm-ch-btn.active{background:#1a3a5c;color:#4fc3f7;border-color:#4fc3f7}',
      '.lnm-ch-btn:hover:not(.active){color:#e8eaed;border-color:#5f6368}',
      '.lnm-tv-frame{flex:1;border:none;width:100%;display:block;background:#000;min-height:0}',
      '.lnm-tv-video{flex:1;width:100%;display:none;background:#000;min-height:0;outline:none}',
      '.lnm-tv-notice{text-align:center;padding:7px 14px;font-size:.66rem;color:#5f6368;background:#0d1117;flex-shrink:0;border-top:1px solid #1a1d21;display:flex;align-items:center;justify-content:center;gap:8px}',
      '.lnm-stream-badge{font-size:.6rem;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.3px}',
      /* === Footer === */
      '.lnm-footer{padding:6px 14px;background:#0d1117;font-size:.68rem;color:#5f6368;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px;border-top:1px solid #2a2d31}',
      '.lnm-refresh-btn{background:#1a3a5c;color:#4fc3f7;border:none;border-radius:4px;padding:3px 10px;font-size:.7rem;font-weight:700;cursor:pointer}',
      '.lnm-refresh-btn:hover{background:#243050}',
    ].join('');
    document.head.appendChild(st);
  }

  const ov = document.createElement('div');
  ov.id = 'lnm-overlay';
  ov.className = 'lnm-overlay';
  ov.addEventListener('click', closeLiveNewsModal);
  document.body.appendChild(ov);

  // Build channel selector buttons
  const chButtons = LNM_TV_CHANNELS.map((ch, i) =>
    `<button class="lnm-ch-btn${i === 0 ? ' active' : ''}" data-action="lnm-channel" data-ch="${ch.key}">${ch.label}</button>`
  ).join('');

  const mo = document.createElement('div');
  mo.id = 'live-news-modal';
  mo.className = 'live-news-modal';
  mo.setAttribute('role', 'dialog');
  mo.setAttribute('aria-modal', 'true');
  mo.innerHTML =
    /* ── Top bar ── */
    '<div class="lnm-topbar">' +
      '<span class="lnm-badge">&#128225; GLOBAL INTELLIGENCE FEED</span>' +
      /* Tab switcher */
      '<div class="lnm-tabs">' +
        '<button class="lnm-tab-btn active" data-action="lnm-tab" data-tab="headlines">&#128240; Headlines</button>' +
        '<button class="lnm-tab-btn" data-action="lnm-tab" data-tab="tv">&#128250; Live TV</button>' +
      '</div>' +
      /* Category filter pills — hidden when TV tab active */
      '<div class="lnm-src-pills" id="lnm-src-pills">' +
        '<button class="lnm-pill active" data-action="lnm-filter" data-src="all">All (26)</button>' +
        '<button class="lnm-pill" data-action="lnm-filter" data-src="news">📰 News</button>' +
        '<button class="lnm-pill" data-action="lnm-filter" data-src="logistics">🚢 Logistics</button>' +
        '<button class="lnm-pill" data-action="lnm-filter" data-src="security">🛡 Security</button>' +
        '<button class="lnm-pill" data-action="lnm-filter" data-src="hazards">⚠ Hazards</button>' +
        '<button class="lnm-pill" data-action="lnm-filter" data-src="cyber">💻 Cyber</button>' +
      '</div>' +
      '<span class="lnm-ts" id="lnm-ts">Loading&hellip;</span>' +
      '<button class="lnm-close" data-action="close-live-news" aria-label="Close">&#x2715; Close</button>' +
    '</div>' +
    /* ── Headlines panel ── */
    '<div class="lnm-feed" id="lnm-feed"><div class="lnm-loading">Fetching global intelligence feed&hellip;</div></div>' +
    /* ── Live TV panel ── */
    '<div class="lnm-tv-panel" id="lnm-tv-panel">' +
      '<div class="lnm-ch-bar"><span class="lnm-ch-label">&#128250; SELECT CHANNEL</span>' + chButtons + '</div>' +
      '<video class="lnm-tv-video" id="lnm-tv-video" autoplay muted playsinline controls></video>' +
      '<iframe class="lnm-tv-frame" id="lnm-tv-frame" src="" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>' +
      '<div class="lnm-tv-notice">Select a channel above &middot; <span id="lnm-stream-badge" class="lnm-stream-badge" style="background:#1a3a5c;color:#4fc3f7">&#128225; Ready</span> &middot; Direct stream where available, YouTube fallback otherwise</div>' +
    '</div>' +
    /* ── Footer ── */
    '<div class="lnm-footer" id="lnm-footer">' +
      '<span>&#128240; 26 sources &middot; 📰 News &middot; 🚢 Logistics &middot; 🛡 Security &middot; ⚠ Hazards (geo-filtered) &middot; 💻 Cyber</span>' +
      '<button class="lnm-refresh-btn" data-action="lnm-refresh-now">&#8635; Refresh Headlines</button>' +
    '</div>';
  document.body.appendChild(mo);
}

/* Switch between Headlines and Live TV tabs */
function _lnmSwitchTab(tab) {
  _lnmActiveTab = tab;
  const mo = _ltmEl('live-news-modal');
  if (!mo) return;
  // Tab button highlight
  mo.querySelectorAll('.lnm-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Show/hide source pills (headlines only)
  const pills = _ltmEl('lnm-src-pills');
  if (pills) pills.style.display = (tab === 'headlines') ? 'flex' : 'none';
  // Show/hide panels
  const headlinesPanel = _ltmEl('lnm-feed');
  const tvPanel        = _ltmEl('lnm-tv-panel');
  const footer         = _ltmEl('lnm-footer');
  if (headlinesPanel) headlinesPanel.style.display = (tab === 'headlines') ? '' : 'none';
  if (footer)         footer.style.display         = (tab === 'headlines') ? '' : 'none';
  if (tvPanel) {
    if (tab === 'tv') {
      tvPanel.classList.add('visible');
      // Auto-load channel on first open — use getAttribute (video.src resolves to page URL when unset)
      const frame = _ltmEl('lnm-tv-frame');
      const video = _ltmEl('lnm-tv-video');
      const noStream = !_lnmHls && (!frame || !frame.getAttribute('src')) && (!video || !video.getAttribute('src'));
      if (noStream) setTimeout(() => _lnmSwitchChannel(_lnmActiveChannel), 80);
    } else {
      tvPanel.classList.remove('visible');
    }
  }
}

/* Load a live TV channel — HLS direct stream preferred; YouTube iframe as fallback */
function _lnmSwitchChannel(key) {
  _lnmActiveChannel = key;
  const ch = LNM_TV_CHANNELS.find(c => c.key === key);
  if (!ch) return;

  // Update channel button highlight
  const tvPanel = _ltmEl('lnm-tv-panel');
  if (tvPanel) tvPanel.querySelectorAll('.lnm-ch-btn').forEach(b => b.classList.toggle('active', b.dataset.ch === key));

  // Destroy any running HLS instance before switching
  if (_lnmHls) { try { _lnmHls.destroy(); } catch (_) {} _lnmHls = null; }

  const video = _ltmEl('lnm-tv-video');
  const frame = _ltmEl('lnm-tv-frame');
  const badge = _ltmEl('lnm-stream-badge');

  /* Helper: no direct stream — show clean error screen, NO YouTube fallback */
  function _showNoStream() {
    if (video) { video.style.display = 'none'; video.src = ''; }
    if (frame) {
      frame.style.display = 'block'; frame.src = '';
      frame.srcdoc = `<html><body style="margin:0;background:#090909;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#555;font-family:sans-serif;text-align:center;gap:10px"><div style="font-size:3em;opacity:.35">📡</div><div style="font-size:15px;color:#777;font-weight:600">${ch.label}</div><div style="font-size:12px;color:#555">Direct stream unavailable</div><div style="font-size:10px;color:#333;margin-top:6px">HLS connection failed &mdash; no YouTube fallback</div></body></html>`;
    }
    if (badge) { badge.textContent = '\u26a1 No Signal'; badge.style.background = '#1a1a1a'; badge.style.color = '#666'; }
  }

  if (ch.hlsUrl) {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      // hls.js path (Chrome, Firefox, Edge)
      if (frame) { frame.style.display = 'none'; frame.src = ''; }
      if (video) { video.style.display = 'block'; }
      if (badge) { badge.textContent = '\ud83d\udce1 Direct Stream'; badge.style.background = '#1b5e20'; badge.style.color = '#81c995'; }
      _lnmHls = new Hls({ autoStartLoad: true, enableWorker: true, lowLatencyMode: true });
      _lnmHls.loadSource(ch.hlsUrl);
      _lnmHls.attachMedia(video);
      _lnmHls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      _lnmHls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          try { _lnmHls.destroy(); } catch (_) {}
          _lnmHls = null;
          _showNoStream(); // fatal stream error → no signal (no YouTube)
        }
      });
    } else if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      if (frame) { frame.style.display = 'none'; frame.src = ''; }
      if (video) { video.style.display = 'block'; video.src = ch.hlsUrl; video.play().catch(() => {}); }
      if (badge) { badge.textContent = '\ud83d\udce1 Direct Stream'; badge.style.background = '#1b5e20'; badge.style.color = '#81c995'; }
    } else {
      _showNoStream(); // browser has no HLS support → no signal
    }
  } else {
    _showNoStream(); // no hlsUrl defined → no direct stream available
  }
}

function _lnmTimeAgo(isoStr) {
  try {
    const d = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (isNaN(d) || d < 0) return '';
    if (d < 60) return d + 'm ago';
    if (d < 1440) return Math.floor(d / 60) + 'h ago';
    return Math.floor(d / 1440) + 'd ago';
  } catch(e) { return ''; }
}

function _lnmRender() {
  const feed = _ltmEl('lnm-feed');
  if (!feed) return;
  // Block WORKFORCE/INSIDER/LAYOFF/UNKNOWN — those belong in Insider & Leaks only
  const _LNM_BLOCKED = new Set(['WORKFORCE','INSIDER','LAYOFF','LEAK','INSIDER_THREAT','BRAND_MONITORING','DISCARD','UNKNOWN']);
  const cleanItems = (_lnmItems || []).filter(it => !_LNM_BLOCKED.has(String(it.category || '').toUpperCase()));
  // Filter by category (matches source_category field from Worker) or exact source key
  const visible = _lnmFilter === 'all'
    ? cleanItems
    : cleanItems.filter(it => (it.source_category || 'news') === _lnmFilter || it.source_key === _lnmFilter);
  if (!visible.length) {
    feed.innerHTML = `<div class="lnm-empty">No items from this source yet.</div>`;
    return;
  }
  feed.innerHTML = visible.map(it => {
    const sc = LNM_SOURCE_COLORS[it.source_key] || { bg: '#3c4043', text: '#e8eaed' };
    const ta = _lnmTimeAgo(it.time);
    const hasGeo = it.lat != null && it.lng != null;
    const geoTag = hasGeo ? `<span style="color:#81d4fa;margin-left:6px;">📍 ${Number(it.lat).toFixed(1)}°, ${Number(it.lng).toFixed(1)}°</span>` : '';
    const safeTitle   = escapeHtml(it.title   || '(no title)');
    const safeSummary = escapeHtml(it.summary || '');
    const safeLink    = escapeAttr(it.link && it.link !== '#' ? it.link : '#');
    return `<div class="lnm-item" style="border-left-color:${sc.bg}">
      <div class="lnm-src">
        <span class="lnm-src-badge" style="background:${sc.bg};color:${sc.text};">${escapeHtml(it.source_label || it.source_key)}</span>
      </div>
      <div class="lnm-body">
        <div class="lnm-title"><a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></div>
        <div class="lnm-meta">${ta}${geoTag}</div>
        ${safeSummary ? `<div class="lnm-summary">${safeSummary}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function _lnmFetch() {
  try {
    const res  = await fetchWithTimeout(`${WORKER_URL}/api/live-news`, { headers: { 'X-User-Id': OSINFO_USER_ID } }, 15000);
    const data = await res.json().catch(() => ({}));
    if (data.ok && Array.isArray(data.items)) {
      _lnmItems = data.items;
      _lnmRender();
      const ts = _ltmEl('lnm-ts');
      if (ts) {
        const cached = data._cached ? ' (cached)' : '';
        ts.textContent = '🔄 Updated ' + new Date().toLocaleTimeString() + cached;
      }
    }
  } catch(e) {
    const feed = _ltmEl('lnm-feed');
    if (feed && !_lnmItems.length) feed.innerHTML = `<div class="lnm-empty">Failed to load feed. Check connection.</div>`;
  }
}

function openLiveNewsModal() {
  _ensureLiveNewsModal();
  const ov = _ltmEl('lnm-overlay');
  const mo = _ltmEl('live-news-modal');
  if (ov) ov.style.display = 'block';
  if (mo) mo.classList.add('open');
  // Always start on Headlines tab
  _lnmSwitchTab('headlines');
  // Reset source filter pills to 'all'
  _lnmFilter = 'all';
  if (mo) mo.querySelectorAll('.lnm-pill').forEach(p => p.classList.toggle('active', p.dataset.src === 'all'));
  // Fetch headlines immediately, then every 5 min
  _lnmFetch();
  if (_lnmTimer) clearInterval(_lnmTimer);
  _lnmTimer = setInterval(_lnmFetch, 5 * 60 * 1000);
}

function closeLiveNewsModal() {
  const ov = _ltmEl('lnm-overlay');
  const mo = _ltmEl('live-news-modal');
  if (ov) ov.style.display = 'none';
  if (mo) mo.classList.remove('open');
  // Stop HLS stream and release resources
  if (_lnmHls) { try { _lnmHls.destroy(); } catch (_) {} _lnmHls = null; }
  const video = _ltmEl('lnm-tv-video');
  if (video) { video.pause(); video.src = ''; video.style.display = 'none'; }
  // Stop YouTube iframe to prevent background audio
  const frame = _ltmEl('lnm-tv-frame');
  if (frame) frame.src = '';
  if (_lnmTimer) { clearInterval(_lnmTimer); _lnmTimer = null; }
}

/* ─────────────────────────────────────────────────────────────────
   LIVE NEWS TAB  (view-switcher panel — shares data with modal)
   Uses same _lnmItems state and LNM_* constants as the modal.
   Separate HLS instance (_lnTabHls) so streams don't conflict.
   ───────────────────────────────────────────────────────────────── */
let _lnTabHls           = null;
let _lnTabFilter        = 'all';
let _lnTabActiveChannel = (LNM_TV_CHANNELS[0] || {}).key || 'dw';
let _lnTabInitDone      = false;

function _lnTabInit() {
  if (_lnTabInitDone) return;
  _lnTabInitDone = true;
  /* Inject shared lnm CSS (idempotent — also creates hidden modal) */
  _ensureLiveNewsModal();
  /* Build TV channel buttons in the tab panel's channel bar */
  const bar = document.getElementById('ln-ch-bar');
  if (bar) {
    bar.innerHTML = '<span class="lnm-ch-label">&#128250; SELECT CHANNEL</span>' +
      LNM_TV_CHANNELS.map((ch, i) =>
        '<button class="lnm-ch-btn' + (i === 0 ? ' active' : '') +
        '" data-action="ln-channel" data-ch="' + ch.key + '">' + ch.label + '</button>'
      ).join('');
  }
}

function _lnTabRender() {
  const feed = document.getElementById('ln-feed');
  if (!feed) return;
  // Block WORKFORCE/INSIDER/LAYOFF/UNKNOWN from Live News — those belong in Insider & Leaks only
  const _LN_BLOCKED_CATS = new Set(['WORKFORCE','INSIDER','LAYOFF','LEAK','INSIDER_THREAT','BRAND_MONITORING','DISCARD','UNKNOWN']);
  const _LN_BLOCKED_CAT_RE = /^(workforce|insider|layoff|leak|insider.?threat|brand.?monitoring|discard|unknown)$/i;
  const items = (_lnmItems || []).filter(i => {
    const cat = String(i.category || '').toUpperCase();
    if (_LN_BLOCKED_CATS.has(cat)) return false;
    if (_LN_BLOCKED_CAT_RE.test(String(i.category || ''))) return false;
    return true;
  });
  const filtered = (_lnTabFilter === 'all')
    ? items
    : items.filter(i => (i.category || i.source_category || 'news') === _lnTabFilter);
  if (!filtered.length) {
    feed.innerHTML = '<div class="lnm-empty">' +
      (items.length ? 'No items for this filter.' : 'Loading global intelligence feed…') + '</div>';
    return;
  }
  feed.innerHTML = filtered.map(function(item) {
    const sc      = LNM_SOURCE_COLORS[item.source_key] || { bg: '#37474f', text: '#fff' };
    const ageStr  = _lnmTimeAgo(item.published || item.time || '');
    const summary = (item.summary || '').slice(0, 200);
    return '<div class="lnm-item" style="border-left-color:' + sc.bg + '">' +
      '<div class="lnm-src"><span class="lnm-src-badge" style="background:' + sc.bg +
      ';color:' + sc.text + '">' +
      (item.source_label || item.source_key || '?').toUpperCase().slice(0, 10) + '</span></div>' +
      '<div class="lnm-body">' +
      '<div class="lnm-title"><a href="' + (item.link || '#') +
      '" target="_blank" rel="noopener noreferrer">' + (item.title || '') + '</a></div>' +
      '<div class="lnm-meta">' + (item.region || '') + (ageStr ? ' &middot; ' + ageStr : '') + '</div>' +
      (summary ? '<div class="lnm-summary">' + summary + '</div>' : '') +
      '</div></div>';
  }).join('');
}

async function _lnTabFetch() {
  try {
    const res  = await fetchWithTimeout(WORKER_URL + '/api/live-news',
      { headers: { 'X-User-Id': OSINFO_USER_ID } }, 15000);
    const data = await res.json().catch(() => ({}));
    if (data.ok && Array.isArray(data.items)) {
      _lnmItems = data.items;                           // update shared state
      _lnTabRender();
      const ts = document.getElementById('ln-ts');
      if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } else {
      _lnTabRender();
    }
  } catch (_) {
    _lnTabRender();
  }
}

function _lnTabSwitchTab(tab) {
  const container = document.getElementById('view-live-news');
  if (!container) return;
  container.querySelectorAll('.lnm-tab-btn').forEach(
    b => b.classList.toggle('active', b.dataset.tab === tab));
  const pills   = document.getElementById('ln-src-pills');
  const feed    = document.getElementById('ln-feed');
  const tvPanel = document.getElementById('ln-tv-panel');
  const footer  = document.getElementById('ln-tab-footer');
  if (pills)  pills.style.display  = (tab === 'headlines') ? 'flex' : 'none';
  if (feed)   feed.style.display   = (tab === 'headlines') ? ''     : 'none';
  if (footer) footer.style.display = (tab === 'headlines') ? ''     : 'none';
  if (tvPanel) {
    if (tab === 'tv') {
      tvPanel.classList.add('visible');
      const frame = document.getElementById('ln-tv-frame');
      const video = document.getElementById('ln-tv-video');
      const noStream = !_lnTabHls &&
        (!frame || !frame.getAttribute('src')) &&
        (!video || !video.getAttribute('src'));
      if (noStream) setTimeout(() => _lnTabSwitchChannel(_lnTabActiveChannel), 80);
    } else {
      tvPanel.classList.remove('visible');
    }
  }
}

function _lnTabSwitchChannel(key) {
  _lnTabActiveChannel = key;
  const ch = LNM_TV_CHANNELS.find(c => c.key === key);
  if (!ch) return;
  /* Update channel button highlight */
  const container = document.getElementById('view-live-news');
  if (container) container.querySelectorAll('.lnm-ch-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.ch === key));
  /* Destroy previous HLS instance */
  if (_lnTabHls) { try { _lnTabHls.destroy(); } catch (_) {} _lnTabHls = null; }
  const video = document.getElementById('ln-tv-video');
  const frame = document.getElementById('ln-tv-frame');
  const badge = document.getElementById('ln-stream-badge');
  function _noSig() {
    if (video) { video.style.display = 'none'; video.src = ''; }
    if (frame) {
      frame.style.display = 'block'; frame.src = '';
      frame.srcdoc = '<html><body style="margin:0;background:#090909;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;height:100vh;' +
        'color:#555;font-family:sans-serif;text-align:center;gap:10px">' +
        '<div style="font-size:3em;opacity:.35">&#128225;</div>' +
        '<div style="font-size:15px;color:#777;font-weight:600">' + ch.label + '</div>' +
        '<div style="font-size:12px;color:#555">Direct stream unavailable</div></body></html>';
    }
    if (badge) { badge.textContent = '\u26a1 No Signal'; badge.style.background = '#1a1a1a'; badge.style.color = '#666'; }
  }
  if (ch.hlsUrl) {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (frame) { frame.style.display = 'none'; frame.src = ''; }
      if (video) { video.style.display = 'block'; }
      if (badge) { badge.textContent = '\ud83d\udce1 Direct Stream'; badge.style.background = '#1b5e20'; badge.style.color = '#81c995'; }
      _lnTabHls = new Hls({ autoStartLoad: true, enableWorker: true, lowLatencyMode: true });
      _lnTabHls.loadSource(ch.hlsUrl);
      _lnTabHls.attachMedia(video);
      _lnTabHls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      _lnTabHls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { try { _lnTabHls.destroy(); } catch (_) {} _lnTabHls = null; _noSig(); }
      });
    } else if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
      if (frame) { frame.style.display = 'none'; frame.src = ''; }
      if (video) { video.style.display = 'block'; video.src = ch.hlsUrl; video.play().catch(() => {}); }
      if (badge) { badge.textContent = '\ud83d\udce1 Direct Stream'; badge.style.background = '#1b5e20'; badge.style.color = '#81c995'; }
    } else {
      _noSig();
    }
  } else {
    _noSig();
  }
}

/* ============================================================
   PHASE 2 — GDELT OSINT INTEL PANEL
   5-tab modal: Military · Cyber · Nuclear · Maritime · Sanctions
   GDELT DOC API v2 (public, CORS-enabled, no auth required)
   Client-side 5-min cache per tab; full sanitisation on all output
   ============================================================ */

const GIM_TABS = [
  {
    key: 'military',  label: '\u2694\ufe0f Military',
    query: 'theme:ARMEDCONFLICT',
    kvCat: ['CONFLICT','SECURITY','PHYSICAL_SECURITY','CRITICAL'],
    keywords: ['military','airstrike','missile','troop','army','conflict','attack','strike','soldier','war','combat','operation','forces','bomb','rocket','offensive','hostage','terror','shooting','explosion','massacre'],
  },
  {
    key: 'cyber',     label: '\ud83d\udcbb Cyber',
    query: 'theme:CYBER_ATTACK',
    kvCat: ['CYBER','SECURITY','CRITICAL'],
    keywords: ['cyber','hack','ransomware','malware','breach','exploit','vulnerability','apt','phishing','ddos','intrusion','zero-day','spyware','botnet','data leak'],
  },
  {
    key: 'nuclear',   label: '\u2622\ufe0f Nuclear',
    query: 'theme:WNS',
    kvCat: ['CONFLICT','SECURITY','CRITICAL'],
    keywords: ['nuclear','iaea','uranium','enrichment','missile','proliferation','reactor','warhead','north korea','iran','plutonium','radiolog','wmd','ballistic','intercontinental'],
  },
  {
    key: 'maritime',  label: '\u2693 Maritime',
    query: 'theme:MARITIME',
    kvCat: ['TRANSPORT','SUPPLY_CHAIN','DISRUPTION','SECURITY'],
    keywords: ['naval','ship','maritime','piracy','strait','fleet','vessel','port','blockade','sea','coast guard','tanker','carrier','submarine','red sea','hormuz','suez'],
  },
  {
    key: 'sanctions', label: '\ud83d\udd12 Sanctions',
    query: 'theme:ECON_SANCTIONS',
    kvCat: ['SUPPLY_CHAIN','DISRUPTION','GENERAL'],
    keywords: ['sanction','embargo','tariff','trade war','export control','freeze','blacklist','ban','restriction','levy','fine','penalty','asset freeze'],
  },
];
const GIM_CACHE_TTL = 5 * 60 * 1000;
const _gimCache     = {};
let   _gimActiveTab = 'military';

function _gimEl(id) { return document.getElementById(id); }

/* Parse GDELT seendate "20260303T120000Z" → relative time string */
function _gimTimeAgo(sd) {
  try {
    const s = (sd || '').replace('T','').replace('Z','');
    const d = new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10)||0, +s.slice(10,12)||0);
    const ms = Date.now() - d.getTime();
    if (ms < 3600000)  return Math.floor(ms/60000)  + 'm ago';
    if (ms < 86400000) return Math.floor(ms/3600000) + 'h ago';
    return Math.floor(ms/86400000) + 'd ago';
  } catch { return ''; }
}

/* Tone badge — negative tone = crisis/threat language in article */
function _gimToneBadge(tone) {
  const t = parseFloat(tone);
  if (isNaN(t)) return '';
  if (t <= -5)  return '<span style="color:#f28b82;font-size:.62rem;font-weight:700">\u25bc Crisis</span>';
  if (t <= -2)  return '<span style="color:#ff8f00;font-size:.62rem;font-weight:700">\u25bc Negative</span>';
  if (t >=  3)  return '<span style="color:#81c995;font-size:.62rem;font-weight:700">\u25b2 Positive</span>';
  return '<span style="color:#9aa0a6;font-size:.62rem">\u2014 Neutral</span>';
}

/* Source domain coloured badge — reuses LNM_SOURCE_COLORS for known outlets */
function _gimDomainBadge(domain) {
  const raw = (domain || '').replace(/^www\./,'');
  const key = raw.split('.')[0];
  const sc  = LNM_SOURCE_COLORS[key];
  const bg  = sc ? sc.bg  : '#3c4043';
  const col = sc ? sc.text : '#e8eaed';
  const lbl = raw.length > 18 ? raw.slice(0,16) + '\u2026' : (raw || 'source');
  return `<span style="background:${bg};color:${col};font-size:.58rem;font-weight:800;padding:2px 6px;border-radius:3px;letter-spacing:.3px;white-space:nowrap;display:inline-block">${escapeHtml(lbl)}</span>`;
}

/* Validate URL — only allow http/https to prevent JS injection */
function _gimSafeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '#';
  } catch { return '#'; }
}

/* Build fallback articles from live KV incidents matching the tab's categories or keywords */
async function _gimKvFallback(tab) {
  try {
    const res  = await fetchWithTimeout(`${WORKER_URL}/api/live-news`, { headers: { 'X-User-Id': OSINFO_USER_ID } }, 12000);
    if (!res.ok) return [];
    const data  = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return [];

    const cats  = new Set((tab.kvCat || []).map(c => c.toUpperCase()));
    const words = (tab.keywords || []);

    /* Pass 1: category match */
    let matched = items.filter(i => cats.has(String(i.category || '').toUpperCase()));

    /* Pass 2: if category match empty, keyword search on title+summary */
    if (!matched.length && words.length) {
      matched = items.filter(i => {
        const text = ((i.title || '') + ' ' + (i.summary || '')).toLowerCase();
        return words.some(w => text.includes(w));
      });
    }

    /* Pass 3: absolute fallback — return most recent 10 incidents so panel never blanks */
    if (!matched.length) matched = items.slice(0, 10);

    return matched.slice(0, 20).map(i => ({
      url:           i.link  || '#',
      title:         i.title || '',
      domain:        i.source_label || shortHost(i.source || ''),
      seendate:      i.time  || '',
      sourcecountry: i.country || '',
      tone:          '',
      _fromKv:       true,
    }));
  } catch (_) { return []; }
}

/* Client-side relevance filter — removes articles whose title contains none of the tab keywords */
function _gimFilter(articles, tab) {
  const words = tab.keywords || [];
  if (!words.length || !articles.length) return articles;
  const filtered = articles.filter(a => {
    const text = ((a.title || '') + ' ' + (a.domain || '')).toLowerCase();
    return words.some(w => text.includes(w));
  });
  // If filtering removes everything, return original (avoid blank panel)
  return filtered.length > 0 ? filtered : articles;
}

/* Fetch GDELT articles for tab key; KV incidents as fallback if GDELT fails */
async function _gimFetch(key) {
  const cached = _gimCache[key];
  if (cached && (Date.now() - cached.ts) < GIM_CACHE_TTL) return cached.articles;
  const tab = GIM_TABS.find(t => t.key === key);
  if (!tab) return [];

  // Route through Worker proxy — api.gdeltproject.org is blocked on corporate network
  const proxyUrl = `${WORKER_URL}/api/gdelt-proxy?query=${encodeURIComponent(tab.query)}&timespan=1d&maxrecords=20`;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res   = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw      = (data.articles || []).filter(a => a.language === 'English');
    const articles = _gimFilter(raw, tab);
    if (articles.length > 0) {
      _gimCache[key] = { ts: Date.now(), articles, source: 'gdelt' };
      return articles;
    }
    // GDELT returned 0 relevant English articles — fall through to KV fallback
    throw new Error('empty');
  } catch (e) {
    // Serve stale cache if available
    if (_gimCache[key] && _gimCache[key].articles.length > 0) return _gimCache[key].articles;
    // KV incidents fallback so the panel is never blank
    const fallback = await _gimKvFallback(tab);
    if (fallback.length > 0) {
      _gimCache[key] = { ts: Date.now(), articles: fallback, source: 'kv' };
      return fallback;
    }
    throw new Error('GDELT unavailable — no cached data');
  }
}

/* Load articles for key into #gim-feed */
async function _gimLoadTab(key) {
  _gimActiveTab = key;
  const mo = _gimEl('gdelt-intel-modal');
  if (mo) mo.querySelectorAll('.gim-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  const feed = _gimEl('gim-feed');
  if (!feed) return;
  feed.innerHTML = '<div style="padding:32px;text-align:center;color:#5f6368;font-size:.85rem">\u231b Querying GDELT global news database\u2026</div>';

  let articles;
  try {
    articles = await _gimFetch(key);
  } catch (e) {
    feed.innerHTML = '<div style="padding:32px;text-align:center;color:#f28b82;font-size:.82rem">\u26a0\ufe0f OSINT feed unavailable<br><span style="color:#5f6368;font-size:.75rem">GDELT unreachable and no live incidents in Worker KV yet.<br>Try refreshing in a few minutes or wait for next ingestion cycle.</span></div>';
    return;
  }

  if (!articles.length) {
    feed.innerHTML = '<div style="padding:32px;text-align:center;color:#5f6368;font-size:.82rem">No articles found in the last 24\u00a0hours for this category.</div>';
    return;
  }

  const isKv = (_gimCache[key] && _gimCache[key].source === 'kv');

  const rows = articles.map(a => {
    const url    = _gimSafeUrl(a.url || a.link || '');
    const title  = escapeHtml(a.title || 'Untitled');
    const domain = _gimDomainBadge(a.domain || a.source_label || shortHost(a.url || a.link || ''));
    const time   = a._fromKv ? _lnmTimeAgo(a.seendate) : _gimTimeAgo(a.seendate || '');
    const tone   = a._fromKv ? '' : _gimToneBadge(a.tone);
    const ctry   = a.sourcecountry ? '<span style="color:#5f6368;font-size:.62rem">\u2022\u00a0' + escapeHtml(a.sourcecountry) + '</span>' : '';
    return '<div style="display:flex;gap:10px;padding:9px 10px;background:#202124;border-radius:6px;border-left:3px solid #2a2d31;margin-bottom:5px" onmouseover="this.style.background=\'#262a2e\'" onmouseout="this.style.background=\'#202124\'">' +
      '<div style="flex-shrink:0;width:110px;display:flex;align-items:flex-start;padding-top:1px;flex-direction:column;gap:3px">' + domain + ctry + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div><a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#e8eaed;font-size:.82rem;font-weight:600;text-decoration:none;line-height:1.4" onmouseover="this.style.color=\'#8ab4f8\'" onmouseout="this.style.color=\'#e8eaed\'">' + title + '</a></div>' +
        '<div style="font-size:.68rem;color:#5f6368;margin-top:3px;display:flex;align-items:center;gap:8px">' + time + ' ' + tone + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const tab  = GIM_TABS.find(t => t.key === key);
  const lbl  = tab ? tab.label : key;
  const age  = _gimCache[key] ? Math.floor((Date.now() - _gimCache[key].ts) / 60000) : 0;
  const src  = isKv ? '\u26a0\ufe0f Live incidents (GDELT unavailable)' : 'GDELT v2';
  feed.innerHTML = '<div style="padding:6px 10px;font-size:.68rem;color:#5f6368;border-bottom:1px solid #2a2d31;margin-bottom:4px">' +
    articles.length + ' items \u00b7 ' + lbl + ' \u00b7 ' + (age === 0 ? 'just fetched' : age + 'm old') + ' \u00b7 ' + src + '</div>' + rows;
}

/* Build modal DOM (once) */
function _ensureGdeltIntelModal() {
  if (_gimEl('gdelt-intel-modal')) return;

  const st = document.createElement('style');
  st.id = 'gim-styles';
  st.textContent = [
    '.gim-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:6099;display:none;cursor:pointer}',
    '.gdelt-intel-modal{position:fixed;top:96px;left:50%;transform:translateX(-50%);width:94vw;max-width:1360px;height:calc(100vh - 106px);background:#131416;color:#e8eaed;z-index:6100;border-radius:12px;box-shadow:0 8px 56px rgba(0,0,0,.9);display:none;flex-direction:column;font-family:Inter,sans-serif;overflow:hidden}',
    '.gdelt-intel-modal.open{display:flex}',
    '.gim-topbar{display:flex;align-items:center;gap:8px;padding:9px 14px;background:#0d1117;border-bottom:1px solid #2a2d31;flex-shrink:0;flex-wrap:wrap}',
    '.gim-badge{background:#1a1a3a;color:#9fa8da;font-size:.7rem;font-weight:800;border-radius:4px;padding:2px 9px;letter-spacing:1px;white-space:nowrap}',
    '.gim-tabs{display:flex;gap:3px;flex-wrap:wrap}',
    '.gim-tab-btn{font-size:.72rem;font-weight:700;padding:4px 13px;border-radius:6px;border:1px solid #3c4043;background:transparent;color:#9aa0a6;cursor:pointer;transition:all .15s;white-space:nowrap}',
    '.gim-tab-btn.active{background:#1a1a3a;color:#9fa8da;border-color:#9fa8da}',
    '.gim-tab-btn:hover:not(.active){color:#e8eaed;border-color:#5f6368}',
    '.gim-close{background:#5f2120;color:#f28b82;border:none;border-radius:6px;padding:5px 14px;font-size:.82rem;font-weight:700;cursor:pointer;margin-left:auto;white-space:nowrap}',
    '.gim-close:hover{background:#8b3a38}',
    '.gim-refresh-btn{background:#1a1a3a;color:#9fa8da;border:none;border-radius:4px;padding:3px 10px;font-size:.7rem;font-weight:700;cursor:pointer;white-space:nowrap}',
    '.gim-refresh-btn:hover{background:#252550}',
    '#gim-feed{flex:1;overflow-y:auto;padding:8px 12px}',
    '.gim-footer{padding:6px 14px;background:#0d1117;font-size:.68rem;color:#5f6368;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px;border-top:1px solid #2a2d31}',
  ].join('');
  document.head.appendChild(st);

  const ov = document.createElement('div');
  ov.id = 'gim-overlay';
  ov.className = 'gim-overlay';
  ov.addEventListener('click', closeGdeltIntelModal);
  document.body.appendChild(ov);

  const tabBtns = GIM_TABS.map((t, i) =>
    '<button class="gim-tab-btn' + (i === 0 ? ' active' : '') + '" data-action="gim-tab" data-tab="' + t.key + '">' + t.label + '</button>'
  ).join('');

  const mo = document.createElement('div');
  mo.id = 'gdelt-intel-modal';
  mo.className = 'gdelt-intel-modal';
  mo.setAttribute('role', 'dialog');
  mo.setAttribute('aria-modal', 'true');
  mo.innerHTML =
    '<div class="gim-topbar">' +
      '<span class="gim-badge">\ud83d\udee1\ufe0f OSINT INTELLIGENCE</span>' +
      '<div class="gim-tabs">' + tabBtns + '</div>' +
      '<button class="gim-close" data-action="close-gdelt-intel" aria-label="Close">\u2715 Close</button>' +
    '</div>' +
    '<div style="padding:4px 14px 2px;font-size:.68rem;color:#5f6368;background:#0d1117;border-bottom:1px solid #1e2029;">' +
      '\u2694\ufe0f Military: active strikes/deployments \u00a0|\u00a0 ' +
      '\ud83d\udcbb Cyber: attacks, breaches, APTs \u00a0|\u00a0 ' +
      '\u2622\ufe0f Nuclear: IAEA, missile tests, proliferation \u00a0|\u00a0 ' +
      '\u2693 Maritime: piracy, naval, shipping lanes \u00a0|\u00a0 ' +
      '\ud83d\udd12 Sanctions: new measures, embargoes, trade wars' +
    '</div>' +
    '<div id="gim-feed" role="feed" aria-live="polite" style="flex:1;overflow-y:auto;padding:8px 12px">' +
      '<div style="padding:40px;text-align:center;color:#5f6368;font-size:.85rem">Select a category above to load OSINT intelligence\u2026</div>' +
    '</div>' +
    '<div class="gim-footer">' +
      '<span>\ud83c\udf10 GDELT 20,000+ sources \u00b7 English \u00b7 24h window \u00b7 Falls back to live KV incidents if GDELT unavailable</span>' +
      '<button class="gim-refresh-btn" data-action="gim-refresh">\u21bb Refresh</button>' +
    '</div>';
  document.body.appendChild(mo);
}

function openGdeltIntelModal() {
  _ensureGdeltIntelModal();
  const ov = _gimEl('gim-overlay');
  const mo = _gimEl('gdelt-intel-modal');
  if (ov) ov.style.display = 'block';
  if (mo) mo.classList.add('open');
  _gimLoadTab(_gimActiveTab);
}

function closeGdeltIntelModal() {
  const ov = _gimEl('gim-overlay');
  const mo = _gimEl('gdelt-intel-modal');
  if (ov) ov.style.display = 'none';
  if (mo) mo.classList.remove('open');
}

async function removeFromWatchlist(id) {
  const normId = id.toLowerCase();
  // 1. Remove card from DOM immediately — no server wait
  const card = document.getElementById('watch-card-' + normId);
  if (card) card.remove();
  // Show empty state if no cards remain
  const container = document.getElementById('logistics-watchlist-list');
  if (container && container.querySelectorAll('.drawer-watch-card').length === 0) {
    container.innerHTML = '<div class="drawer-empty">No items in watchlist.</div>';
  }
  // 2. Update local cache — remove the item
  WATCHLIST_CACHE = WATCHLIST_CACHE.filter(w => (typeof w === 'string' ? w : w.id) !== normId);
  // 3. Persist via action:'set' — sends the COMPLETE desired list so Worker never reads stale KV
  //    This bypasses the KV read-modify-write race that caused deleted items to reappear
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/logistics/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': OSINFO_USER_ID },
      body: JSON.stringify({ action: 'set', watchlist: WATCHLIST_CACHE }),
    });
    const resData = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(resData.error || `HTTP ${res.status}`);
  } catch (e) {
    console.error('[watchlist] remove server sync failed:', e);
  }
}

async function sendTestAlert() {
  const btn = document.querySelector('[data-action="logistics-test-alert"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const secret = typeof getAdminSecret === 'function' ? getAdminSecret() : '';
    const res = await fetchWithTimeout(`${WORKER_URL}/api/logistics/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': OSINFO_USER_ID, ...(secret ? { secret } : {}) },
      body: JSON.stringify({ action: 'test-alert' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      alert(`Test alert sent: ${data.message || 'Check your inbox.'}`);
    } else {
      alert(`Failed: ${data.error || res.status}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bell me-1" aria-hidden="true"></i> Test Alert'; }
  }
}

/* ===========================
   SIGNAL CONVERGENCE ALERTS — Phase 4
   Polls /api/convergence every 15 min; renders alert strip above feed
=========================== */
(function () {
  'use strict';

  let _convData      = [];
  let _convDismissed = new Set();
  let _convCollapsed = false;
  let _convTimer     = null;

  /* Load dismissed set from localStorage */
  try {
    const raw = localStorage.getItem('conv_dismissed');
    if (raw) _convDismissed = new Set(JSON.parse(raw));
  } catch (_) {}

  function _saveDismissed() {
    try { localStorage.setItem('conv_dismissed', JSON.stringify([..._convDismissed])); } catch (_) {}
  }

  function _alertKey(a) {
    return `${a.country}_${a.level}`;
  }

  function _timeAgo(iso) {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 2)    return 'just now';
    if (m < 60)   return `${m}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  }

  function _render() {
    const strip = document.getElementById('convergence-strip');
    const body  = document.getElementById('conv-alerts-body');
    const meta  = document.getElementById('conv-meta');
    if (!strip || !body) return;

    const visible = _convData.filter(a => !_convDismissed.has(_alertKey(a)));

    if (!visible.length) {
      strip.style.display = 'none';
      return;
    }

    strip.style.display = 'block';
    body.style.display  = _convCollapsed ? 'none' : 'block';

    if (!_convCollapsed) {
      body.innerHTML = visible.map(a => {
        const capName  = String(a.country || '').replace(/\b\w/g, c => c.toUpperCase());
        const cats     = (a.categories || []).join(' · ');
        const srcList  = (a.sources || []).join(', ');
        const key      = _alertKey(a);
        return `
          <div class="conv-alert-row" data-conv-key="${escapeAttr(key)}">
            <span class="conv-level conv-level-${a.level}">${(()=>{const c={CRITICAL:'#e53e3e',HIGH:'#ed8936',ELEVATED:'#ecc94b',NORMAL:'#48bb78',LOW:'#a0aec0'}[String(a.level||'').toUpperCase()]||'#718096';return`<i class="fas fa-circle" style="color:${c};font-size:0.6em;vertical-align:middle" aria-hidden="true"></i>`;})()}&nbsp;${a.level}</span>
            <div class="conv-body">
              <div class="conv-country">${escapeHtml(capName)}</div>
              <div class="conv-sub">
                <b>${a.sourceCount}</b> sources · <b>${a.incidentCount}</b> reports · ${a.spanHrs}h window
              </div>
              <div class="conv-sub">${escapeHtml(cats)}</div>
              <div class="conv-snippet" title="${escapeAttr(a.latestTitle)}">${escapeHtml(a.latestTitle || '')}</div>
            </div>
            <button class="conv-dismiss" data-conv-dismiss="${escapeAttr(key)}" title="Dismiss" aria-label="Dismiss convergence alert for ${escapeAttr(capName)}">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>`;
      }).join('');
    }

    if (meta) meta.textContent = `${visible.length} active convergence${visible.length !== 1 ? 's' : ''} · Updated ${_timeAgo(_convData[0]?.latestTime)}`;
  }

  async function _fetch() {
    try {
      const res  = await fetchWithTimeout(
        `${WORKER_URL}/api/convergence`,
        { headers: { 'X-User-Id': OSINFO_USER_ID } },
        12000
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _convData  = Array.isArray(data.alerts) ? data.alerts : [];
      _render();
    } catch (e) {
      console.warn('[Convergence] fetch error', e);
    }
  }

  function _init() {
    /* Collapse toggle */
    const colBtn = document.getElementById('conv-collapse-btn');
    if (colBtn) {
      colBtn.addEventListener('click', () => {
        _convCollapsed = !_convCollapsed;
        const chev = document.getElementById('conv-chevron');
        if (chev) chev.className = _convCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        _render();
      });
    }

    /* Dismiss clicks (delegated) */
    document.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-conv-dismiss]');
      if (!btn) return;
      const key = btn.dataset.convDismiss;
      if (key) {
        _convDismissed.add(key);
        _saveDismissed();
        _render();
      }
    });

    /* Initial fetch + 15-min autopoll */
    _fetch();
    if (_convTimer) clearInterval(_convTimer);
    _convTimer = setInterval(_fetch, 15 * 60 * 1000);
  }

  window._convInit  = _init;
  window._convFetch = _fetch;
})();

/* ===========================
   VERIFICATION CHECKLIST — Phase 5
   Client-side credibility scorer for each incident card (1–5 stars)
   Factors: source tier, corroboration, recency, geolocation
=========================== */
(function () {
  'use strict';

  /* Tier 1 = highest-credibility sources */
  const TIER1 = new Set(['reuters', 'apnews', 'bbc', 'france24']);
  const TIER2 = new Set(['aljazeera', 'dw', 'cna', 'ustravel', 'ukfcdo', 'cisa', 'gdacs', 'usgs']);

  /*
   * Score an incident 0–100.
   * allIncidents = full INCIDENTS array (for corroboration check).
   */
  function credScore(incident, allIncidents) {
    let pts = 0;

    /* 1. Source tier (max 35 pts) */
    const src = String(incident.source || '').toLowerCase();
    if (TIER1.has(src) || TIER1.has(shortHost(incident.source || ''))) {
      pts += 35;
    } else if (TIER2.has(src) || TIER2.has(shortHost(incident.source || ''))) {
      pts += 20;
    } else {
      pts += 5;
    }

    /* 2. Corroboration — other incidents from same country in last 6h (max 30 pts) */
    if (Array.isArray(allIncidents) && allIncidents.length > 0) {
      const cut6h    = Date.now() - 6 * 60 * 60 * 1000;
      const country  = String(incident.country || '').toLowerCase();
      const siblings = allIncidents.filter(x =>
        x !== incident &&
        String(x.country || '').toLowerCase() === country &&
        new Date(x.time || 0).getTime() > cut6h
      ).length;
      pts += Math.min(30, siblings * 6);
    }

    /* 3. Recency (max 25 pts) */
    const ageMs = Date.now() - new Date(incident.time || 0).getTime();
    const ageH  = ageMs / 3600000;
    if      (ageH < 1)  pts += 25;
    else if (ageH < 3)  pts += 20;
    else if (ageH < 6)  pts += 14;
    else if (ageH < 12) pts += 8;
    else if (ageH < 24) pts += 3;

    /* 4. Geolocation present (max 10 pts) */
    if (incident.lat && incident.lng && incident.lat !== 0 && incident.lng !== 0) pts += 10;

    return Math.min(100, pts);
  }

  /* Map 0–100 → 1–5 stars */
  function credStars(score) {
    if (score >= 80) return 5;
    if (score >= 60) return 4;
    if (score >= 40) return 3;
    if (score >= 20) return 2;
    return 1;
  }

  /* Build tooltip text */
  function credTooltip(incident, score, allIncidents) {
    const stars  = credStars(score);
    const src    = shortHost(incident.source || '');
    const ageH   = Math.round((Date.now() - new Date(incident.time || 0).getTime()) / 360000) / 10;
    const hasGeo = !!(incident.lat && incident.lng);
    let tip = `Credibility: ${stars}/5 stars (${score}/100)\n`;
    tip += `Source: ${src}\n`;
    tip += `Age: ${ageH}h\n`;
    tip += `Geolocated: ${hasGeo ? '✓' : '✗'}\n`;
    if (Array.isArray(allIncidents)) {
      const cut6h   = Date.now() - 6 * 60 * 60 * 1000;
      const country = String(incident.country || '').toLowerCase();
      const corr    = allIncidents.filter(x =>
        x !== incident &&
        String(x.country || '').toLowerCase() === country &&
        new Date(x.time || 0).getTime() > cut6h
      ).length;
      tip += `Corroboration: ${corr} other reports (6h)`;
    }
    return tip;
  }

  /* Render badge HTML */
  function credBadgeHtml(incident, allIncidents) {
    const score  = credScore(incident, allIncidents);
    const stars  = credStars(score);
    const filled = '★'.repeat(stars);
    const empty  = '☆'.repeat(5 - stars);
    const tip    = credTooltip(incident, score, allIncidents);
    return `<span class="cred-badge cred-${stars}" title="${escapeAttr(tip)}" aria-label="Credibility ${stars} of 5 stars">
      <span class="cred-stars">${filled}${empty}</span>
    </span>`;
  }

  /* Expose */
  window._credScore    = credScore;
  window._credStars    = credStars;
  window._credBadgeHtml = credBadgeHtml;
})();

/* ===========================
   MARKETS WIDGET — Google Finance style
   Fetches /api/markets?cat=global|australia|currencies|commodities
   Renders tile row + intraday SVG area chart.
=========================== */
(function () {
  'use strict';

  var REFRESH_MS   = 5 * 60 * 1000;
  var _timer       = null;
  var _cat         = 'global';
  var _tiles       = [];
  var _selIdx      = 0;

  /* ── Formatting helpers ────────────────────────────────────── */
  function _fmtPrice(price, sym) {
    if (price == null) return '—';
    // Currencies: 4 decimal places; indices/commodities: localised 2dp
    if (sym && (sym.indexOf('=X') !== -1)) return price.toFixed(4);
    if (price < 10)  return price.toFixed(3);
    if (price < 100) return price.toFixed(2);
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function _fmtChg(chg, pct) {
    if (chg == null || pct == null) return '';
    var sign = chg >= 0 ? '+' : '';
    return sign + chg.toFixed(2) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
  }
  function _cls(pct) { return pct == null ? 'neu' : pct > 0 ? 'pos' : pct < 0 ? 'neg' : 'neu'; }

  /* ── Render tile row ───────────────────────────────────────── */
  function _renderTiles() {
    var el = document.getElementById('mkt-tiles-row');
    if (!el) return;
    if (!_tiles.length) {
      el.innerHTML = '<div style="padding:10px;color:#9aa0a6;font-size:.75rem;">No data — Worker not deployed or Yahoo unavailable</div>';
      return;
    }
    el.innerHTML = _tiles.map(function(t, i) {
      var price = _fmtPrice(t.price, t.symbol);
      var chg   = _fmtChg(t.change, t.changePct);
      var cc    = _cls(t.changePct);
      return '<div class="mkt-tile' + (i === _selIdx ? ' sel' : '') + '" data-idx="' + i + '">' +
        '<div class="mkt-tile-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="mkt-tile-price">' + price + '</div>' +
        '<div class="mkt-tile-chg ' + cc + '">' + escapeHtml(chg) + '</div>' +
        '</div>';
    }).join('');
    // Bind tile clicks
    el.querySelectorAll('.mkt-tile').forEach(function(tile) {
      tile.addEventListener('click', function() {
        _selIdx = parseInt(tile.getAttribute('data-idx'), 10);
        el.querySelectorAll('.mkt-tile').forEach(function(t2){ t2.classList.remove('sel'); });
        tile.classList.add('sel');
        _renderChart();
      });
    });
  }

  /* ── Render intraday SVG area chart ─────────────────────────── */
  function _renderChart() {
    var svgEl  = document.getElementById('mkt-chart-svg');
    var labEl  = document.getElementById('mkt-chart-labels');
    var titEl  = document.getElementById('mkt-chart-title');
    if (!svgEl) return;

    var tile = _tiles[_selIdx];
    if (!tile || !tile.points || tile.points.length < 2) {
      svgEl.innerHTML = '';
      if (labEl)  labEl.innerHTML = '';
      if (titEl)  titEl.textContent = '';
      return;
    }

    var pts    = tile.points.filter(function(p){ return p.v != null; });
    if (pts.length < 2) { svgEl.innerHTML = ''; return; }

    var W = 400, H = 88, PX = 2, PY = 5;
    var times  = pts.map(function(p){ return p.t; });
    var vals   = pts.map(function(p){ return p.v; });
    var tMin   = Math.min.apply(null, times);
    var tMax   = Math.max.apply(null, times);
    var vMin   = Math.min.apply(null, tile.prev != null ? vals.concat([tile.prev]) : vals);
    var vMax   = Math.max.apply(null, tile.prev != null ? vals.concat([tile.prev]) : vals);
    var vPad   = (vMax - vMin) * 0.05 || 0.0001;
    vMin -= vPad; vMax += vPad;
    var vRng   = vMax - vMin;
    var tRng   = tMax - tMin || 1;

    function toX(t) { return PX + ((t - tMin) / tRng) * (W - PX * 2); }
    function toY(v) { return H - PY - ((v - vMin) / vRng) * (H - PY * 2); }

    var isNeg   = tile.changePct != null ? tile.changePct < 0 : false;
    var lineClr = isNeg ? '#ea4335' : '#34a853';
    var fillId  = 'mktg' + Date.now();

    var linePoints = pts.map(function(p){ return toX(p.t).toFixed(1) + ',' + toY(p.v).toFixed(1); }).join(' ');
    var firstX = toX(pts[0].t), lastX = toX(pts[pts.length-1].t);
    var areaPath = 'M ' + firstX.toFixed(1) + ',' + toY(pts[0].v).toFixed(1) + ' ' +
      pts.slice(1).map(function(p){ return 'L ' + toX(p.t).toFixed(1) + ',' + toY(p.v).toFixed(1); }).join(' ') +
      ' L ' + lastX.toFixed(1) + ',' + H + ' L ' + firstX.toFixed(1) + ',' + H + ' Z';

    var prevLine = '';
    if (tile.prev != null) {
      var py = toY(tile.prev).toFixed(1);
      prevLine = '<line x1="' + PX + '" y1="' + py + '" x2="' + (W-PX) + '" y2="' + py +
        '" stroke="#6c7280" stroke-width="0.7" stroke-dasharray="3,2" opacity="0.7"/>';
    }

    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svgEl.innerHTML = '<defs><linearGradient id="' + fillId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + lineClr + '" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="' + lineClr + '" stop-opacity="0"/></linearGradient></defs>' +
      prevLine +
      '<path d="' + areaPath + '" fill="url(#' + fillId + ')" stroke="none"/>' +
      '<polyline points="' + linePoints + '" fill="none" stroke="' + lineClr + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';

    // Time labels
    if (labEl) {
      var labelCount = 5;
      var labels = [];
      for (var i = 0; i < labelCount; i++) {
        var t = tMin + (tRng * i / (labelCount - 1));
        var d = new Date(t * 1000);
        var h = d.getHours(), m = d.getMinutes();
        var ampm = h >= 12 ? 'pm' : 'am';
        var h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
        labels.push('<span>' + h12 + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ampm + '</span>');
      }
      labEl.innerHTML = labels.join('');
    }

    // Chart title
    if (titEl) {
      var chgTxt = tile.changePct != null ? ' ' + (tile.changePct >= 0 ? '▲' : '▼') + ' ' + Math.abs(tile.changePct).toFixed(2) + '%' : '';
      titEl.textContent = tile.name + chgTxt + ' — Today';
    }
  }

  /* ── Fetch from Worker ─────────────────────────────────────── */
  async function _fetch() {
    try {
      var res = await fetchWithTimeout(WORKER_URL + '/api/markets?cat=' + _cat, {}, 14000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();
      if (json.ok && Array.isArray(json.tiles)) {
        _tiles = json.tiles;
        if (_selIdx >= _tiles.length) _selIdx = 0;
        _renderTiles();
        _renderChart();
        var upEl = document.getElementById('mkt-updated');
        if (upEl) upEl.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
        // Feed market data into the main LIVE ticker
        window._mktTickerItems = _tiles.filter(function(t){ return t.price != null; }).map(function(t) {
          return { name: t.name, price: _fmtPrice(t.price, t.symbol), changePct: t.changePct };
        });
        if (typeof window.updateMainTicker === 'function') window.updateMainTicker();
      }
    } catch (e) {
      console.warn('[Markets] fetch error', e);
      var el = document.getElementById('mkt-tiles-row');
      if (el) el.innerHTML = '<div style="padding:8px;color:#ea4335;font-size:.72rem;"><i class="fas fa-exclamation-triangle"></i> ' + escapeHtml(String(e.message || e)) + '</div>';
    }
  }

  /* ── Initialise ────────────────────────────────────────────── */
  function _init() {
    // Tab pill clicks
    var tabsEl = document.getElementById('mkt-tabs');
    if (tabsEl) {
      tabsEl.addEventListener('click', function(ev) {
        var btn = ev.target.closest('.mkt-tab-pill');
        if (!btn) return;
        tabsEl.querySelectorAll('.mkt-tab-pill').forEach(function(b){
          b.classList.remove('active'); b.setAttribute('aria-selected','false');
        });
        btn.classList.add('active'); btn.setAttribute('aria-selected','true');
        _cat    = btn.getAttribute('data-mcat') || 'global';
        _selIdx = 0;
        _tiles  = [];
        var tr = document.getElementById('mkt-tiles-row');
        if (tr) tr.innerHTML = '<div style="padding:10px;color:#9aa0a6;font-size:.75rem;"><i class="fas fa-spinner fa-spin"></i> Loading&hellip;</div>';
        var sv = document.getElementById('mkt-chart-svg');
        if (sv) sv.innerHTML = '';
        _fetch();
      });
    }

    // Initial fetch + auto-refresh
    _fetch();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(_fetch, REFRESH_MS);

    // Fetch ALL categories once so the LIVE ticker shows Shares, Currencies & Commodities too
    _fetchAllForTicker();
    setInterval(_fetchAllForTicker, REFRESH_MS);
  }

  async function _fetchAllForTicker() {
    try {
      var allTiles = [];
      var cats = ['global', 'shares', 'currencies', 'commodities'];
      for (var i = 0; i < cats.length; i++) {
        try {
          var r = await fetch(WORKER_URL + '/api/markets?cat=' + cats[i]);
          var j = await r.json();
          if (j.ok && Array.isArray(j.tiles)) allTiles = allTiles.concat(j.tiles);
        } catch(e) { /* skip failed category */ }
      }
      if (allTiles.length) {
        window._mktTickerItems = allTiles.filter(function(t){ return t.price != null; }).map(function(t) {
          return { name: t.name, price: _fmtPrice(t.price, t.symbol), changePct: t.changePct };
        });
        if (typeof window.updateMainTicker === 'function') window.updateMainTicker();
      }
    } catch(e) { /* ignore */ }
  }

  window._marketsInit  = _init;
  window._marketsFetch = _fetch;
})();

/* ===========================
   COUNTRY INSTABILITY INDEX (CII) — Phase 3
   Fetches /api/cii, renders sidebar card with level/trend/bar
=========================== */
(function () {
  'use strict';

  let _ciiTab    = 'global';
  let _ciiTimer  = null;
  let _ciiData   = [];

  /* Emoji flag from country name (best-effort via Unicode regional indicator) */
  const COUNTRY_FLAGS = {
    'ukraine':'🇺🇦','russia':'🇷🇺','china':'🇨🇳','united states':'🇺🇸',
    'north korea':'🇰🇵','myanmar':'🇲🇲','iran':'🇮🇷','syria':'🇸🇾',
    'afghanistan':'🇦🇫','yemen':'🇾🇪','somalia':'🇸🇴','mali':'🇲🇱',
    'sudan':'🇸🇩','south sudan':'🇸🇸','nigeria':'🇳🇬','ethiopia':'🇪🇹',
    'haiti':'🇭🇹','iraq':'🇮🇶','libya':'🇱🇾','venezuela':'🇻🇪',
    'pakistan':'🇵🇰','israel':'🇮🇱','taiwan':'🇹🇼','lebanon':'🇱🇧',
    'burkina faso':'🇧🇫','niger':'🇳🇪','chad':'🇹🇩',
    'central african republic':'🇨🇫','mozambique':'🇲🇿',
    'democratic republic of the congo':'🇨🇩','egypt':'🇪🇬',
    'turkey':'🇹🇷','saudi arabia':'🇸🇦','india':'🇮🇳',
    'brazil':'🇧🇷','mexico':'🇲🇽','south africa':'🇿🇦',
    'indonesia':'🇮🇩','philippines':'🇵🇭','malaysia':'🇲🇾',
    'thailand':'🇹🇭','bangladesh':'🇧🇩','colombia':'🇨🇴',
    'singapore':'🇸🇬','germany':'🇩🇪','france':'🇫🇷',
    'united kingdom':'🇬🇧','japan':'🇯🇵','australia':'🇦🇺',
    'canada':'🇨🇦','netherlands':'🇳🇱','ireland':'🇮🇪',
    'poland':'🇵🇱','hungary':'🇭🇺','czechia':'🇨🇿',
    'south korea':'🇰🇷','morocco':'🇲🇦','algeria':'🇩🇿',
    'kenya':'🇰🇪','ghana':'🇬🇭','georgia':'🇬🇪',
    'armenia':'🇦🇲','azerbaijan':'🇦🇿','belarus':'🇧🇾',
    'serbia':'🇷🇸','vietnam':'🇻🇳','cambodia':'🇰🇭',
    'united arab emirates':'🇦🇪','qatar':'🇶🇦','jordan':'🇯🇴',
  };

  function _flag(country) {
    return COUNTRY_FLAGS[String(country || '').toLowerCase()] || '🌐';
  }

  function _timeAgo(iso) {
    if (!iso) return '';
    const d = Math.round((Date.now() - new Date(iso)) / 60000);
    if (d < 2)   return 'just now';
    if (d < 60)  return `${d}m ago`;
    if (d < 1440)return `${Math.round(d/60)}h ago`;
    return `${Math.round(d/1440)}d ago`;
  }

  /* Client-side level dot — avoids UTF-8 mojibake from Worker JSON emoji */
  const _LEVEL_COLORS = { CRITICAL:'#e53e3e', HIGH:'#ed8936', ELEVATED:'#ecc94b', NORMAL:'#48bb78', LOW:'#a0aec0' };
  function _levelDot(level) {
    const col = _LEVEL_COLORS[String(level || '').toUpperCase()] || '#718096';
    return `<i class="fas fa-circle" style="color:${col};font-size:0.6em;vertical-align:middle" aria-hidden="true"></i>`;
  }
  /* Client-side trend arrow — HTML entity, no emoji encoding issues */
  function _trendArrow(trendCls) {
    if (trendCls === 'cii-rising')  return '&uarr;';
    if (trendCls === 'cii-falling') return '&darr;';
    return '&rarr;';
  }

  function _render() {
    const list = document.getElementById('cii-list');
    if (!list) return;
    if (!_ciiData.length) {
      list.innerHTML = '<div class="cii-empty">No data for this view.</div>';
      return;
    }

    list.innerHTML = _ciiData.map((item, i) => {
      const flag     = _flag(item.country);
      const capName  = String(item.country || '').replace(/\b\w/g, c => c.toUpperCase());
      const barPct   = Math.min(100, item.score);
      const compStr  = `U:${item.components?.unrest ?? '?'} C:${item.components?.conflict ?? '?'} S:${item.components?.security ?? '?'} I:${item.components?.info ?? '?'}`;

      return `
        <div class="cii-row ${item.levelCls || ''}" title="${capName} — ${item.level} (${item.score}/100)&#10;Components: ${compStr}&#10;Events (7d): ${item.eventCount}">
          <span class="cii-rank">${i + 1}</span>
          <span class="cii-flag">${flag}</span>
          <span class="cii-name">${capName}</span>
          <span class="cii-bar-wrap">
            <div class="cii-bar-bg"><div class="cii-bar-fill" style="width:${barPct}%"></div></div>
          </span>
          <div class="cii-score-wrap">
            <span class="cii-score">${item.score}</span>
            <span class="cii-level-badge">${_levelDot(item.level)} ${item.level}</span>
          </div>
          <span class="cii-trend ${item.trendCls || ''}">${_trendArrow(item.trendCls)}</span>
        </div>`;
    }).join('');
  }

  async function _fetch(tab) {
    tab = tab || _ciiTab;
    const list = document.getElementById('cii-list');
    if (list) list.innerHTML = '<div class="cii-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

    try {
      const res  = await fetchWithTimeout(
        `${WORKER_URL}/api/cii?tab=${encodeURIComponent(tab)}&limit=25`,
        { headers: { 'X-User-Id': OSINFO_USER_ID } },
        15000
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _ciiData   = Array.isArray(data.items) ? data.items : [];
      _render();

      const upEl = document.getElementById('cii-updated');
      if (upEl) upEl.textContent = `Updated ${_timeAgo(data.generatedAt)} · ${_ciiData.length} countries`;
    } catch (e) {
      _ciiData = [];
      if (list) list.innerHTML = `<div class="cii-empty">Failed to load: ${e.message}</div>`;
      console.warn('[CII] fetch error', e);
    }
  }

  function _switchTab(tab) {
    _ciiTab = tab;
    document.querySelectorAll('.cii-tab').forEach(btn => {
      const active = btn.dataset.ciiTab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    _fetch(tab);
  }

  function _init() {
    /* Tab clicks */
    document.querySelectorAll('.cii-tab').forEach(btn => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.ciiTab || 'global'));
    });

    /* Refresh link */
    const ref = document.getElementById('cii-refresh');
    if (ref) {
      ref.addEventListener('click', ev => {
        ev.preventDefault();
        _fetch(_ciiTab);
      });
    }

    /* Initial fetch */
    _fetch('global');

    /* Auto-refresh every 10 minutes */
    if (_ciiTimer) clearInterval(_ciiTimer);
    _ciiTimer = setInterval(() => _fetch(_ciiTab), 10 * 60 * 1000);
  }

  /* Expose for external use */
  window._ciiInit   = _init;
  window._ciiFetch  = _fetch;
  window._ciiSwitch = _switchTab;
})();

/* ===========================
   BOOTSTRAP / EVENT BINDING
=========================== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // preload admin secret from sessionStorage
    try {
      const s = sessionStorage.getItem('admin_secret') || '';
      if (s) { ADMIN_SECRET = s; try { document.getElementById('adminSecret').value = s; document.getElementById('adminRememberSession').checked = true; } catch(e){} }
    } catch(e){}

    initMap();
    startClock();

    // Restore AI toggle button visual state from persisted preference
    (() => {
      const aiBtn = document.getElementById('btn-ai-toggle');
      const aiLbl = document.getElementById('ai-toggle-label');
      if (aiBtn) { aiBtn.classList.toggle('ai-on', AI_ENABLED); aiBtn.setAttribute('aria-pressed', String(AI_ENABLED)); }
      if (aiLbl) aiLbl.textContent = AI_ENABLED ? 'AI: ON' : 'AI: OFF';
    })();

    // ── Dark / Light mode toggle ─────────────────────────────────────────────
    (() => {
      const btn   = document.getElementById('btn-theme-toggle');
      const icon  = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      const PREF_KEY = 'infohub_theme';

      function applyTheme(dark) {
        document.body.classList.toggle('dark-mode',  dark);
        document.body.classList.toggle('light-mode', !dark); // needed so body.light-mode CSS rules fire
        if (icon)  { icon.className  = dark ? 'fas fa-sun' : 'fas fa-moon'; }
        if (label) { label.textContent = dark ? 'Light' : 'Dark'; }
        if (btn)   { btn.setAttribute('aria-pressed', String(dark)); btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; }
        /* Notify other modules (e.g. VW map tile swap) */
        document.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
      }

      // Restore saved preference (default = dark)
      const saved = localStorage.getItem(PREF_KEY);
      applyTheme(saved !== 'light');   // default dark unless user previously chose light

      if (btn) {
        btn.addEventListener('click', () => {
          const nowDark = !document.body.classList.contains('dark-mode');
          applyTheme(nowDark);
          try { localStorage.setItem(PREF_KEY, nowDark ? 'dark' : 'light'); } catch(e){}
        });
      }
    })();
    // ────────────────────────────────────────────────────────────────────────

    // delegated click actions
    document.addEventListener('click', async (ev) => {
      const t = ev.target.closest('[data-action]');
      if (!t) return;
      if (t.tagName === 'A' && (t.getAttribute('href') === '#' || t.getAttribute('href') === '')) ev.preventDefault();
      const action = String(t.dataset.action || '').trim();
      if (!action) return;

      if (action === 'go-home') {
        // Switch to Intelligence tab by clicking it directly (switchView is scoped in index.html IIFE)
        const intTab = document.querySelector('.view-tab[data-view="intelligence"]');
        if (intTab) intTab.click();
        // Activate Global region tab
        document.querySelectorAll('[data-action="filter-region"]').forEach(el => {
          el.classList.toggle('active', el.dataset.region === 'Global');
        });
        _setApjcSubNav(false);
        filterNews('Global');
        _zoomMapToRegion('Global');
        // Scroll to top
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) {}
        return;
      }

      if (action === 'filter-region') {
        document.querySelectorAll('[data-action="filter-region"]').forEach(el => el.classList.remove('active'));
        t.classList.add('active');
        const region = t.dataset.region || t.textContent.trim();
        // Show APJC sub-nav only when APJC is selected
        _setApjcSubNav(region === 'APJC');
        filterNews(region);
        // Zoom map to the clicked region — ONLY here, never in filterNews (SSE would spam it)
        _zoomMapToRegion(region);
        return;
      }
      if (action === 'filter-apjc-sub') {
        const sub = t.dataset.sub;
        if (sub) toggleApjcSub(sub);
        return;
      }
      if (action === 'filter-cat') {
        const cat = t.dataset.cat;
        if (cat) toggleCategoryFilter(cat);
        return;
      }
      if (action === 'refresh') { manualRefresh(); return; }
      if (action === 'toggle-ai') {
        AI_ENABLED = !AI_ENABLED;
        try { localStorage.setItem('os_ai_enabled', AI_ENABLED ? '1' : '0'); } catch(e) {}
        const aiBtn = document.getElementById('btn-ai-toggle');
        const aiLbl = document.getElementById('ai-toggle-label');
        if (aiBtn) { aiBtn.classList.toggle('ai-on', AI_ENABLED); aiBtn.setAttribute('aria-pressed', String(AI_ENABLED)); }
        if (aiLbl) aiLbl.textContent = AI_ENABLED ? 'AI: ON' : 'AI: OFF';
        await loadFromWorker(false);
        const active = document.querySelector('.nav-item-custom.active');
        filterNews(active ? (active.dataset.region || 'Global') : 'Global');
        return;
      }
      if (action === 'preview-brief') { previewBriefing(); return; }
      if (action === 'download-brief') { downloadReport(); return; }
      if (action === 'download-brief-pdf') {
        const dateEl = document.getElementById('reportDate');
        const d = dateEl ? dateEl.value : '';
        if (!d) {
          const fb = document.getElementById('preview-feedback');
          if (fb) { fb.style.display = 'block'; fb.textContent = 'Select a date first.'; }
          return;
        }
        await downloadBriefAsPDF(d);
        return;
      }
      /* --- Tier-2 actions --- */
      if (action === 'toggle-weather') { toggleWeatherOverlay(); return; }
      if (action === 'toggle-sigmet')  { hideSigmetTicker(); return; }
      if (action === 'generate-brief') { handleGenerateBriefClick(); return; }
      if (action === 'country-risk') {
        const country = t.dataset.country || t.textContent.trim();
        if (country && country !== 'GLOBAL') openCRP(country);
        return;
      }
      if (action === 'close-crp') { closeCRP(); return; }
      if (action === 'toggle-chat')  { toggleChat(); return; }
      if (action === 'close-chat')   { closeChat(); return; }
      if (action === 'chat-send')    { handleChatSend(); return; }
      if (action === 'ack-incident') {
        const id = t.dataset.id;
        if (id) showAckForm(id, t);
        return;
      }
      /* --- /Tier-2 actions --- */

      /* --- Tier-3 actions --- */
      if (action === 'toggle-supply-chain')  { toggleSupplyChainLayer(); return; }
      if (action === 'generate-exec-report') { generateExecReport(); return; }
      if (action === 'download-exec-pdf')    { downloadExecReportPDF(); return; }
      if (action === 'open-threat-intel')    { openThreatIntelPanel(); return; }
      if (action === 'close-threat-intel')   { closeThreatIntelPanel(); return; }
      if (action === 'refresh-correlate')    { loadCorrelationSignals(true); return; }
      /* --- /Tier-3 actions --- */

      if (action === 'toggle-heatmap') {
        heatmapEnabled = !heatmapEnabled;
        typeof debug === 'function' && debug('heatmap:toggle', heatmapEnabled);
        const btn = document.getElementById('heatmap-toggle');
        const legend = document.getElementById('heatmap-legend');
        if (btn) { btn.classList.toggle('active', heatmapEnabled); btn.setAttribute('aria-pressed', String(heatmapEnabled)); }
        if (legend) legend.style.display = heatmapEnabled ? 'block' : 'none';
        if (heatmapEnabled) {
          const heatFiltered = INCIDENTS.filter(i => {
            const lat = Number(i.lat), lng = Number(i.lng);
            return Number.isFinite(lat) && Number.isFinite(lng) && _eventInRegion(lat, lng, currentRegion);
          });
          heatLayer = createHeatLayerFromIncidents(heatFiltered);
          if (heatLayer) heatLayer.addTo(map);
        } else {
          if (heatLayer) { try { map.removeLayer(heatLayer); } catch(e){} heatLayer = null; }
        }
        return;
      }
      if (action === 'vote') {
        ev.preventDefault(); ev.stopPropagation();
        const id = t.getAttribute('data-id'); const v = t.getAttribute('data-vote');
        await voteThumb(id, v);
        return;
      }
      if (action === 'dismiss-alert') {
        ev.preventDefault(); ev.stopPropagation();
        const id = t.getAttribute('data-id');
        if (id) dismissAlertById(id);
        return;
      }
      if (action === 'admin-save-secret') { adminSaveSecret(); return; }
      if (action === 'admin-clear-secret') { adminClearSecret(); return; }
      if (action === 'admin-trigger-ingest') { adminTriggerIngest(); return; }
      if (action === 'admin-wipe-incidents') { adminWipeIncidents(); return; }
      if (action === 'admin-unlock') { adminUnlock(); return; }
      if (action === 'admin-thumbs-status') { adminThumbsStatus(); return; }
      if (action === 'admin-force-refresh-travel') { adminForceRefreshTravel(); return; }
      if (action === 'admin-generate-brief') { adminGenerateBrief(); return; }
      if (action === 'admin-list-briefs') { adminListBriefs(); return; }

      // S2.5 — Live News Modal actions
      if (action === 'open-live-news')  { openLiveNewsModal(); return; }
      if (action === 'close-live-news') { closeLiveNewsModal(); return; }
      if (action === 'lnm-refresh-now') { _lnmFetch(); return; }
      if (action === 'lnm-tab') { _lnmSwitchTab(t.dataset.tab || 'headlines'); return; }
      if (action === 'lnm-channel') { _lnmSwitchChannel(t.dataset.ch || 'aljazeera'); return; }
      if (action === 'lnm-filter') {
        const src = (t.dataset.src || 'all');
        _lnmFilter = src;
        const mo = _ltmEl('live-news-modal');
        if (mo) mo.querySelectorAll('.lnm-pill').forEach(p => p.classList.toggle('active', p.dataset.src === src));
        _lnmRender();
        return;
      }

      // Live News Tab actions (view panel)
      if (action === 'ln-refresh-now') { _lnTabFetch(); return; }
      if (action === 'ln-tab')         { _lnTabSwitchTab(t.dataset.tab || 'headlines'); return; }
      if (action === 'ln-channel')     { _lnTabSwitchChannel(t.dataset.ch || _lnTabActiveChannel); return; }
      if (action === 'ln-filter') {
        _lnTabFilter = t.dataset.src || 'all';
        const cont = document.getElementById('view-live-news');
        if (cont) cont.querySelectorAll('.lnm-pill')
          .forEach(p => p.classList.toggle('active', p.dataset.src === _lnTabFilter));
        _lnTabRender();
        return;
      }

      // Phase 2 — GDELT OSINT Intel Panel actions
      if (action === 'open-gdelt-intel')  { openGdeltIntelModal(); return; }
      if (action === 'close-gdelt-intel') { closeGdeltIntelModal(); return; }
      if (action === 'gim-tab')     { _gimLoadTab(t.dataset.tab || 'military'); return; }
      if (action === 'gim-refresh') { delete _gimCache[_gimActiveTab]; _gimLoadTab(_gimActiveTab); return; }

      // S2.5 — Logistics Drawer actions
      if (action === 'open-logistics') { openLogisticsDrawer(); return; }
      if (action === 'close-logistics') { closeLogisticsDrawer(); return; }
      if (action === 'close-live-track')    { closeLiveTrackModal(); return; }
      if (action === 'close-vessel-track')  { closeVesselTrackModal(); return; }
      if (action === 'open-vessel-track') {
        const mmsi = (t.dataset.mmsi || '').trim();
        if (mmsi) openVesselTrackModal(mmsi);
        return;
      }
      if (action === 'open-live-track') {
        const icao = (t.dataset.icao || '').toLowerCase();
        const cs   = t.dataset.callsign || icao.toUpperCase();
        // Read state from JS cache — no JSON-in-attribute risk
        const st   = _ltmStateCache[icao] || null;
        openLiveTrackModal(icao, cs, st);
        return;
      }
      if (action === 'logistics-tab') {
        const tab = t.dataset.tab;
        if (tab) {
          switchLogisticsTab(tab);
          if (tab === 'watchlist') loadLogisticsWatchlist(); // always fresh on tab visit
        }
        return;
      }
      if (action === 'watch-type-toggle') {
        const type = t.dataset.type;
        document.querySelectorAll('.watch-type-btn').forEach(btn => {
          const active = btn.dataset.type === type;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-pressed', String(active));
        });
        // Update placeholder text to guide user
        const input = document.getElementById('watch-icao-input');
        if (input) {
          input.placeholder = type === 'vessel'
            ? '9-digit MMSI for live tracking (e.g. 566123456)'
            : 'ICAO24 hex (e.g. a12bc3)';
        }
        return;
      }
      if (action === 'logistics-add-watch') {
        const input = document.getElementById('watch-icao-input');
        const id = (input ? input.value : '').trim().toLowerCase();
        // Detect selected type from toggle — read aria-pressed (spec-correct) with .active fallback
        const vesselBtn = document.getElementById('watch-type-vessel');
        const type = (vesselBtn && vesselBtn.getAttribute('aria-pressed') === 'true') ? 'vessel' : 'flight';
        await addToWatchlist(id, type);
        return;
      }
      if (action === 'logistics-remove-watch') {
        // Use data-id (updated) with data-icao fallback for legacy cards
        const id = (t.dataset.id || t.dataset.icao || '').trim().toLowerCase();
        if (id) await removeFromWatchlist(id);
        return;
      }
      if (action === 'logistics-track') {
        const icao = (t.dataset.icao || t.dataset.id || '').trim().toLowerCase();
        const type = t.dataset.type || 'flight';
        if (icao) await trackFlight(icao, `track-result-${icao}`, type);
        return;
      }
      if (action === 'logistics-radar') {
        const hub = (t.dataset.hub || '').trim();
        if (!hub) return;
        // Live Radar for a hub shows surrounding flights via bbox query
        const lat = parseFloat(t.dataset.lat);
        const lon = parseFloat(t.dataset.lon);
        const el = document.getElementById(`radar-result-${hub}`);
        if (el) el.textContent = 'Fetching radar…';
        try {
          const delta = 0.5; // ~55 km box
          const url = `${WORKER_URL}/api/logistics/track?lamin=${(lat - delta).toFixed(4)}&lamax=${(lat + delta).toFixed(4)}&lomin=${(lon - delta).toFixed(4)}&lomax=${(lon + delta).toFixed(4)}`;
          const res = await fetchWithTimeout(url, { headers: { 'X-User-Id': OSINFO_USER_ID } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json().catch(() => ({}));
          // Worker returns { states: [...], source, fetched_at }
          const count = Array.isArray(data.states) ? data.states.length : 0;
          const cached = data._cached ? ' <em style="color:#5f6368;">(cached)</em>' : '';
          const unavail = data.source === 'unavailable';
          if (el) el.innerHTML = unavail
            ? `<span style="color:#f9ab00;">No live coverage for this region — <a href="https://globe.adsbexchange.com/?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&zoom=9" target="_blank" rel="noopener" style="color:#8ab4f8;">Open ADSB Exchange ↗</a></span>`
            : `<span style="color:#81c995;">${count} aircraft in airspace${cached}</span>`;
        } catch (e) {
          if (el) el.textContent = `Error: ${escapeHtml(e.message)}`;
        }
        return;
      }
      if (action === 'logistics-test-alert') { await sendTestAlert(); return; }
    });

    // clicking live-track overlay closes modal
    document.getElementById('live-track-overlay')?.addEventListener('click', closeLiveTrackModal);

    // clicking on feed-card opens link (except when clicking inner buttons/links)
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.feed-card[data-link]');
      if (!card) return;
      if (e.target.closest('a')) return;
      if (e.target.closest('[data-action]')) return;
      const href = card.getAttribute('data-link');
      if (!href) return;
      try { window.open(href, '_blank', 'noopener'); } catch(e) {}
    });

    // inputs wiring
    const historyPicker = document.getElementById('history-picker');
    if (historyPicker) historyPicker.addEventListener('change', (ev) => loadHistory(ev.target.value));

    // Always init flatpickr immediately so the picker opens on first click
    // (archived dates are applied asynchronously as restrictions afterwards)
    let _fpInstance = null;
    if (typeof flatpickr !== 'undefined' && historyPicker) {
      try {
        historyPicker.type = 'text';
        historyPicker.value = '';
        historyPicker.removeAttribute('min');
        historyPicker.removeAttribute('max');
        historyPicker.removeAttribute('list');
        _fpInstance = flatpickr(historyPicker, {
          dateFormat: 'Y-m-d',
          maxDate: 'today',
          allowInput: false,
          disableMobile: true,
          static: true,             // render inline in DOM (no absolute body positioning)
          onClose(selectedDates, dateStr) { if (dateStr) loadHistory(dateStr); },
        });
      } catch (fe) { typeof debug === 'function' && debug('flatpickr init', fe?.message || fe); }
    }

    // Asynchronously fetch archive dates and restrict the picker to only those dates
    (async function populateArchiveDates() {
      try {
        const res = await fetchWithTimeout(`${WORKER_URL}/api/archive`);
        if (!res.ok) return;
        const dates = await res.json();
        if (!Array.isArray(dates) || !dates.length) return;
        dates.sort((a, b) => b.localeCompare(a)); // newest first
        if (_fpInstance) {
          _fpInstance.set('enable', dates);
          _fpInstance.set('minDate', dates[dates.length - 1]);
          _fpInstance.set('maxDate', dates[0]);
        }
      } catch (e) { typeof debug === 'function' && debug('populateArchiveDates', e?.message || e); }
    })();
    const countrySel = document.getElementById('countrySelect'); if (countrySel) countrySel.addEventListener('change', filterTravel);
    const proxRad = document.getElementById('proxRadius'); if (proxRad) proxRad.addEventListener('change', updateProximityRadius);

    // Time window filter buttons for Intelligence feed
    document.getElementById('feed-time-filter')?.addEventListener('click', e => {
      const btn = e.target.closest('.feed-time-btn');
      if (!btn) return;
      document.querySelectorAll('.feed-time-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed','true');
      FEED_TIME_HOURS = parseInt(btn.dataset.hours, 10) || 0;
      const active = document.querySelector('.nav-item-custom.active');
      filterNews(active ? active.textContent.trim() : 'Global');
    });

    // initial load
    await loadFromWorker();
    await loadProximityFromWorker();
    filterNews("Global");
    await loadTravelAdvisories();

    // apply stored votes UI
    Object.keys(VOTES_LOCAL).forEach(k => applyVoteUIForId(k, VOTES_LOCAL[k]));

    // Real-time bridge: SSE (EventSource) with polling fallback
    connectSSE();

    // Phase 4: Signal Convergence Alerts strip
    try { if (typeof window._convInit === 'function') window._convInit(); } catch(e) { console.warn('[Convergence] init error', e); }

    // Phase 3: Country Instability Index sidebar card
    try { if (typeof window._ciiInit === 'function') window._ciiInit(); } catch(e) { console.warn('[CII] init error', e); }

    // Markets & Commodities widget
    try { if (typeof window._marketsInit === 'function') window._marketsInit(); } catch(e) { console.warn('[Markets] init error', e); }

    // S2.5: start 60-second logistics autopoll (updates map markers for watched assets)
    startLogisticsPoll();

    // Render critical alerts ticker (populated once incidents load)
    try { renderCriticalAlertsTicker(); } catch(e) { console.warn('[ALERTS] ticker init error', e); }

    // Tier-3: start correlation signals + sentiment drift auto-refresh
    setTimeout(() => {
      // Intel Signals widget removed — startCorrelationRefresh() disabled
    }, 2000);
    // Sentiment Drift removed — startSentimentRefresh() disabled

    // Tier-2: load initial acknowledgment state for visible incidents
    setTimeout(() => {
      try { loadAcknowledgments(INCIDENTS.map(i => i.id)); } catch(e) { console.warn('[ACK] init error', e); }
    }, 1500);

    // try flush queue on load
    setTimeout(() => { try { flushVoteQueue(); } catch(e){} }, 1000);

    // S2.5 — close logistics drawer on backdrop click
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    if (drawerBackdrop) {
      drawerBackdrop.addEventListener('click', () => closeLogisticsDrawer());
    }
  } catch(e) {
    console.error('Initialization error', e);
    const feed = document.getElementById('general-news-feed');
    if (feed) feed.innerHTML = `<div style="padding:20px;color:#b00;">Application failed to initialize. See console for details.</div>`;
  }
});

/* ===========================
   Expose functions for debugging/legacy
=========================== */
window.loadTravelAdvisories = loadTravelAdvisories;
window.filterTravel = filterTravel;
window.loadHistory = loadHistory;
window.voteThumb = voteThumb;
window.flushVoteQueue = flushVoteQueue;
window.updateProximityRadius = updateProximityRadius;
window.dismissAlertById = dismissAlertById;
window.manualRefresh = manualRefresh;
window.filterNews = filterNews;
window.adminGetSecret = adminGetSecret;

/* --- wrapLongitude unit tests (run once at load, no framework) --- */
(function _testWrapLongitude() {
  const cases = [
    [190,    -170],
    [-190,    170],
    [180,    -180],
    [-180,   -180],
    [0,         0],
    [360,       0],
    [-360,      0],
    [179.9,  179.9],
    [-179.9,-179.9],
  ];
  let pass = 0, fail = 0;
  cases.forEach(([input, expected]) => {
    const got = wrapLongitude(input);
    const ok = Math.abs(got - expected) < 1e-9;
    if (ok) { pass++; }
    else { fail++; console.error(`wrapLongitude(${input}) expected ${expected} got ${got}`); }
  });
  if (fail === 0) console.log(`[wrapLongitude] All ${pass} unit tests passed.`);
  else            console.error(`[wrapLongitude] ${fail} test(s) FAILED.`);
})();

/* ============================================================
   TIER-2 FEATURES
   ============================================================ */

/* ---------- STATE ---------- */
let weatherLayerGroup = null;
let weatherEnabled = false;
let WEATHER_EVENTS = [];
let currentRegion = 'GLOBAL';  // tracks the active region tab for overlay filtering

// Lat/lng bounding boxes per region — used to clip heatmap and nature events
const REGION_BOUNDS = {
  GLOBAL: null,   // null = no filter, show all
  AMER:   { latMin: -60, latMax: 75,  lngMin: -170, lngMax: -25 },
  LATAM:  { latMin: -60, latMax:  25, lngMin: -120, lngMax: -30 },
  EMEA:   { latMin: -40, latMax:  72, lngMin:  -25, lngMax:  65 },
  APJC:   { latMin: -50, latMax:  55, lngMin:   60, lngMax: 180 },
};
function _eventInRegion(lat, lng, region) {
  const b = REGION_BOUNDS[region];
  if (!b) return true;  // GLOBAL — show all
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}
let CHAT_MESSAGES = [];       // [{role, content}]  — session memory
// (SIGMET_REFRESH_TIMER removed — replaced by renderCriticalAlertsTicker)
let ACK_CACHE = {};           // { incidentId: {user_name, note, timestamp} }

// Restore chat session from sessionStorage
try {
  const saved = sessionStorage.getItem('infohub_chat_v1');
  if (saved) CHAT_MESSAGES = JSON.parse(saved);
} catch(e) {}

/* ============================================================
   WEATHER / DISASTER OVERLAY
   ============================================================ */

const WEATHER_ICONS = {
  earthquake: { icon: 'fa-house-crack',          bg: '#c62828', border: '#ef5350', label: 'EQ' },
  cyclone:    { icon: 'fa-tornado',              bg: '#6a1b9a', border: '#ab47bc', label: 'TC' },
  hurricane:  { icon: 'fa-wind',                bg: '#4527a0', border: '#7e57c2', label: 'HU' },
  flood:      { icon: 'fa-water',               bg: '#0d47a1', border: '#42a5f5', label: 'FL' },
  volcano:    { icon: 'fa-volcano',             bg: '#bf360c', border: '#ff7043', label: 'VO' },
  tsunami:    { icon: 'fa-water',               bg: '#01579b', border: '#29b6f6', label: 'TS' },
  wildfire:   { icon: 'fa-fire',                bg: '#b71c1c', border: '#ef5350', label: 'WF' },
  fire:       { icon: 'fa-fire',                bg: '#b71c1c', border: '#ef5350', label: 'FI' },
  landslide:  { icon: 'fa-hill-rockslide',      bg: '#4e342e', border: '#8d6e63', label: 'LS' },
  drought:    { icon: 'fa-sun',                 bg: '#e65100', border: '#ffa726', label: 'DR' },
  storm:      { icon: 'fa-cloud-bolt',          bg: '#263238', border: '#78909c', label: 'ST' },
  snow:       { icon: 'fa-snowflake',           bg: '#01579b', border: '#4fc3f7', label: 'SN' },
  meteor:     { icon: 'fa-meteor',              bg: '#37474f', border: '#90a4ae', label: 'ME' },
  disaster:   { icon: 'fa-triangle-exclamation', bg: '#e65100', border: '#ffb74d', label: '!!' },
};

async function loadWeatherDisasters() {
  try {
    const res = await fetch(`${WORKER_URL}/api/weather/disasters`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    WEATHER_EVENTS = Array.isArray(data.events) ? data.events : [];
    return WEATHER_EVENTS;
  } catch(e) {
    console.warn('[Weather] load failed:', e.message);
    return [];
  }
}

function renderWeatherLayer() {
  if (weatherLayerGroup) {
    try { map.removeLayer(weatherLayerGroup); } catch(e) {}
    weatherLayerGroup = null;
  }
  if (!WEATHER_EVENTS.length) return;

  const markers = [];
  for (const ev of WEATHER_EVENTS) {
    const lat = Number(ev.lat), lng = Number(ev.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!_eventInRegion(lat, lng, currentRegion)) continue;
    const meta = WEATHER_ICONS[ev.type] || WEATHER_ICONS.disaster;
    const popupContent = `
      <div style="font-size:0.82rem;min-width:180px;">
        <div style="font-weight:700;color:${meta.border};margin-bottom:4px;display:flex;align-items:center;gap:6px;"><span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:${meta.bg};align-items:center;justify-content:center;"><i class="fas ${meta.icon}" style="color:#fff;font-size:10px;"></i></span>${escapeHtml(ev.type.toUpperCase())}</div>
        <div style="font-weight:600;margin-bottom:3px;">${escapeHtml(ev.title)}</div>
        ${ev.magnitude ? `<div style="font-size:0.75rem;color:#666;">Magnitude: ${ev.magnitude}</div>` : ''}
        <div style="font-size:0.72rem;color:#888;margin-top:4px;">${escapeHtml(ev.source || '')} · ${escapeHtml((ev.time || '').slice(0,10))}</div>
        ${ev.link && ev.link !== '#' ? `<a href="${escapeAttr(ev.link)}" target="_blank" rel="noopener" style="font-size:0.72rem;color:#1a73e8;">View ↗</a>` : ''}
      </div>`;

    const iconHtml = `<div title="${escapeAttr(ev.title)}" style="width:34px;height:34px;border-radius:50%;background:${meta.bg};border:2.5px solid ${meta.border};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.65);"><i class="fas ${meta.icon}" style="color:#fff;font-size:15px;text-shadow:0 1px 3px rgba(0,0,0,0.5);"></i></div>`;
    const icon = L.divIcon({
      className: 'weather-div-icon',
      html: iconHtml,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    const marker = L.marker([lat, wrapLongitude(lng)], { icon });
    marker.bindPopup(popupContent);
    markers.push(marker);
  }

  if (markers.length) {
    weatherLayerGroup = L.layerGroup(markers);
    weatherLayerGroup.addTo(map);
  }
}

async function toggleWeatherOverlay() {
  const btn = document.getElementById('weather-toggle');
  weatherEnabled = !weatherEnabled;
  if (btn) { btn.classList.toggle('active', weatherEnabled); btn.setAttribute('aria-pressed', String(weatherEnabled)); }

  if (weatherEnabled) {
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Nature Events';
    await loadWeatherDisasters();
    renderWeatherLayer();
    const visibleCount = WEATHER_EVENTS.filter(ev => _eventInRegion(Number(ev.lat), Number(ev.lng), currentRegion)).length;
    if (btn) btn.innerHTML = `<i class="fas fa-earth-americas" aria-hidden="true"></i> Nature Events <span style="font-size:0.65em;opacity:0.8;">(${visibleCount})</span>`;
  } else {
    if (weatherLayerGroup) { try { map.removeLayer(weatherLayerGroup); } catch(e){} weatherLayerGroup = null; }
    if (btn) btn.innerHTML = '<i class="fas fa-earth-americas" aria-hidden="true"></i> Nature Events';
  }
}

/* ============================================================
   CRITICAL SECURITY ALERTS TICKER
   ============================================================ */

/* ============================================================
   MAIN LIVE TICKER — populates #ticker-track with market data
   + security incidents. Called after markets load OR incidents update.
   ============================================================ */
// Keywords that identify financial/market-relevant news for the LIVE ticker
var FINANCIAL_TICKER_RE = /\b(layoff|lay.off|job cuts|earnings|quarterly|revenue|profit|loss|stock|shares|ipo|acquisition|merger|acquisition|valuation|market cap|billion|million|dell|nvidia|intel|amd|microsoft|apple|s&p|nasdaq|dow|ftse|nikkei|bitcoin|crypto|rate hike|rate cut|fed|inflation|gdp|interest rate|oil price|gold price|bond yield|dividend|buyback|guidance|forecast|analyst|upgrade|downgrade|beats estimates|misses estimates|fiscal)\b/i;

function updateMainTicker() {
  var track = document.getElementById('ticker-track');
  if (!track) return;

  var html = '';

  // ── Section 1: Market prices (from markets widget fetch)
  var mktItems = window._mktTickerItems || [];
  if (mktItems.length) {
    html += '<span class="ticker-item" style="color:#1a73e8;font-weight:800;letter-spacing:.5px;padding:0 14px;border-right:2px solid #1a73e8;flex-shrink:0;">MARKETS</span>';
    html += mktItems.map(function(m) {
      var dir = m.changePct == null ? 'flat' : m.changePct > 0 ? 'up' : 'down';
      var arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
      var chgStr = m.changePct != null ? ' ' + arrow + ' ' + Math.abs(m.changePct).toFixed(2) + '%' : '';
      return '<span class="ticker-item ticker-stock ticker-' + dir + '">' +
        '<strong style="margin-right:4px;">' + escapeHtml(m.name) + '</strong>' +
        escapeHtml(m.price) +
        '<span class="ticker-chg" style="margin-left:4px;">' + escapeHtml(chgStr) + '</span>' +
        '</span>';
    }).join('');
  }

  // ── Section 2: Key financial/market news only — no security intel, no insider/leaks
  var inc = (typeof INCIDENTS !== 'undefined' && Array.isArray(INCIDENTS)) ? INCIDENTS : [];
  var finNews = inc.filter(function(i) {
    var src = String(i.source || i.link || '').toLowerCase();
    // Exclude Insider & Leaks sources
    if (INSIDER_SOURCES && INSIDER_SOURCES.some(function(s){ return src.includes(s); })) return false;
    // Only include if title matches financial keywords
    return FINANCIAL_TICKER_RE.test(String(i.title || ''));
  }).slice(0, 20);

  if (finNews.length) {
    html += '<span class="ticker-item" style="color:#fbbc04;font-weight:800;letter-spacing:.5px;padding:0 14px;border-right:2px solid #fbbc04;flex-shrink:0;">FINANCIAL NEWS</span>';
    html += finNews.map(function(i) {
      var title = String(i.title || '');
      if (title.length > 100) title = title.slice(0, 97) + '…';
      var src = i.source ? ' · ' + String(i.source).replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '';
      return '<span class="ticker-item ticker-stock">' + escapeHtml(title + src) + '</span>';
    }).join('');
  }

  if (!html) {
    track.innerHTML = '<span class="ticker-item ticker-loading"><i class="fas fa-circle-notch fa-spin"></i> Loading market data — deploy Worker to activate</span>';
    return;
  }

  // Duplicate for seamless infinite scroll — slow enough to read comfortably
  var totalItems = mktItems.length + finNews.length + 2;
  track.innerHTML = html + html;
  track.style.animationDuration = Math.max(120, totalItems * 9) + 's';
}
window.updateMainTicker = updateMainTicker;

function renderCriticalAlertsTicker() {
  const strip = document.getElementById('sigmet-ticker-strip');
  const inner = document.getElementById('sigmet-inner');
  if (!strip || !inner) return;

  // BREAKING NEWS rules:
  //   severity 5 (CRITICAL) → always show (no keyword check)
  //   severity 3-4 (MEDIUM/HIGH) → only if title matches BREAKING_NEWS_RE keywords
  //   severity 1-2 → never
  //   Insider & Leaks sources/categories → never
  //   Dell workforce/insider headlines → never
  const _tickerSeen = new Set();
  const alerts = INCIDENTS.filter(i => {
    const sev   = Number(i.severity || 1);
    if (sev < 3) return false;
    const src   = String(i.source || i.link || '').toLowerCase();
    const title = String(i.title || '');
    const cat   = String(i.category || '').toUpperCase();
    if (INSIDER_SOURCES && INSIDER_SOURCES.some(s => src.includes(s))) return false;
    if (INSIDER_CATEGORIES && INSIDER_CATEGORIES.includes(cat)) return false;
    if (cat === 'UNKNOWN' || cat === '') return false;
    if (/\bdell\b/i.test(title) && INSIDER_TITLE_RE && INSIDER_TITLE_RE.test(title)) return false;
    // Block financial/market articles from the breaking ticker
    if (isFinancialOnlyTitle(title)) return false;
    // CRITICAL always qualifies; MEDIUM/HIGH must match keywords
    if (sev < 5 && BREAKING_NEWS_RE && !BREAKING_NEWS_RE.test(title)) return false;
    // Deduplicate by title
    const tKey = title.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,60);
    if (_tickerSeen.has(tKey)) return false;
    _tickerSeen.add(tKey);
    return true;
  });

  // Bar is ALWAYS visible — show placeholder when no qualifying alerts yet
  strip.style.display = 'flex';

  if (!alerts.length) {
    inner.textContent = '⚡ Monitoring global feeds for breaking security and geopolitical events…   ✦   No critical alerts at this time';
    inner.style.animationDuration = '60s';
    return;
  }

  const items = alerts.slice(0, 25).map(i => {
    const parts = [];
    if (i.category && i.category.toUpperCase() !== 'UNKNOWN') parts.push(i.category.toUpperCase());
    const title = (i.title || '').length > 90 ? i.title.slice(0, 87) + '…' : i.title;
    if (title) parts.push(title);
    const loc = i.country || i.region || '';
    if (loc && loc !== 'Global' && loc !== 'GLOBAL') parts.push(loc);
    return parts.join(' · ');
  }).filter(Boolean);

  if (!items.length) {
    inner.textContent = '⚡ Monitoring global feeds for breaking security and geopolitical events…';
    inner.style.animationDuration = '60s';
    return;
  }

  const text = items.join('   ✦   ');
  inner.textContent = `${text}   ✦   ${text}`;
  const breakingSpeed = Math.max(120, items.length * 18) + 's';
  inner.style.animationDuration = breakingSpeed;
  strip.style.display = 'flex';
}

function hideSigmetTicker() {
  const strip = document.getElementById('sigmet-ticker-strip');
  if (strip) strip.style.display = 'none';
}

/* ============================================================
   AI SHIFT BRIEFING
   ============================================================ */

async function handleGenerateBriefClick() {
  const windowEl = document.getElementById('brief-window-select');
  const regionEl = document.getElementById('brief-region-select');
  const bodyEl   = document.getElementById('shift-brief-body');
  const metaEl   = document.getElementById('brief-meta-text');
  if (!bodyEl) return;

  const windowH = windowEl ? windowEl.value : '8';
  const region  = regionEl ? regionEl.value : '';

  bodyEl.innerHTML = `<div style="text-align:center;padding:40px 0;color:#4a90d9;">
    <i class="fas fa-spinner fa-spin fa-2x d-block mb-3"></i>
    Generating ${windowH}-hour briefing${region ? ` for ${region}` : ' (Global)'}…
  </div>`;
  if (metaEl) metaEl.textContent = '';

  try {
    const url = `${WORKER_URL}/api/ai/briefing?window=${encodeURIComponent(windowH)}&region=${encodeURIComponent(region)}`;
    const res = await fetchWithTimeout(url, {});
    const data = await res.json();

    if (data.error && !data.briefing) {
      bodyEl.innerHTML = `<div style="color:#e57373;padding:20px;">${escapeHtml(data.error)}</div>`;
      return;
    }

    // Render briefing text: convert ## headings and - bullets to basic HTML
    const formatted = escapeHtml(data.briefing || '')
      .replace(/^## (.+)$/gm, '<h6 style="color:#64b5f6;font-weight:700;margin:16px 0 6px;font-size:0.85rem;letter-spacing:0.04em;">$1</h6>')
      .replace(/^- (.+)$/gm, '<div style="padding-left:12px;">• $1</div>')
      .replace(/\n/g, '<br>');

    bodyEl.innerHTML = `<div style="padding:4px 0;">${formatted}</div>`;
    if (metaEl) {
      metaEl.textContent = `${data.incident_count} incidents · ${data.region} · ${data.window_h}h · Model: ${data.model || 'AI'} · ${(data.generated_at || '').slice(0,19).replace('T',' ')} UTC`;
    }
  } catch(e) {
    bodyEl.innerHTML = `<div style="color:#e57373;padding:20px;">Failed to generate briefing: ${escapeHtml(e.message)}</div>`;
  }
}

/* ============================================================
   COUNTRY RISK PANEL (CRP)
   ============================================================ */

function openCRP(country) {
  const panel = document.getElementById('crp-panel');
  const nameEl = document.getElementById('crp-country-name');
  const badgeEl = document.getElementById('crp-risk-badge');
  const bodyEl  = document.getElementById('crp-body');
  if (!panel) return;

  if (nameEl) nameEl.textContent = country;
  if (badgeEl) { badgeEl.textContent = '…'; badgeEl.className = 'crp-risk-badge'; }
  if (bodyEl) bodyEl.innerHTML = '<div class="text-center py-3" style="color:#4a90d9;"><i class="fas fa-spinner fa-spin"></i> Analysing…</div>';

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  loadCountryRisk(country);
  loadEscalationScore(country); // Tier-3: append escalation section async
}

function closeCRP() {
  const panel = document.getElementById('crp-panel');
  if (panel) panel.style.display = 'none';
}

async function loadCountryRisk(country) {
  const badgeEl = document.getElementById('crp-risk-badge');
  const bodyEl  = document.getElementById('crp-body');
  if (!bodyEl) return;

  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/ai/country-risk?country=${encodeURIComponent(country)}`, {});
    const data = await res.json();

    const level = (data.risk_level || 'UNKNOWN').toUpperCase();
    const score = Number(data.risk_score || 0);
    const travel = (data.travel_advisory || 'EXERCISE_CAUTION').toUpperCase();
    const bullets = Array.isArray(data.bullets) ? data.bullets : [];
    const threats = Array.isArray(data.key_threats) ? data.key_threats : [];

    if (badgeEl) {
      badgeEl.textContent = `${level} ${score > 0 ? score : ''}`.trim();
      badgeEl.className = `crp-risk-badge crp-risk-${level}`;
    }

    bodyEl.innerHTML = `
      ${bullets.length ? `<ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
      ${data.dell_impact ? `<div class="crp-dell-impact"><strong>Dell Impact:</strong> ${escapeHtml(data.dell_impact)}</div>` : ''}
      ${threats.length ? `<div style="font-size:0.77rem;color:#777;margin-top:8px;"><strong>Key threats:</strong> ${threats.map(escapeHtml).join(' · ')}</div>` : ''}
      <div class="crp-meta-row">
        <span>${data.incident_count || 0} incidents (72h)</span>
        <span>Travel: <span class="crp-travel-badge crp-travel-${travel}">${travel.replace('_', ' ')}</span></span>
        <span>${(data.generated_at || '').slice(11,16)} UTC</span>
      </div>`;
  } catch(e) {
    if (bodyEl) bodyEl.innerHTML = `<div style="color:#e57373;font-size:0.8rem;padding:8px;">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

/* ============================================================
   ASK THE HUB — AI CHAT
   ============================================================ */

function toggleChat() {
  const drawer = document.getElementById('chat-drawer');
  const fab    = document.getElementById('chat-fab');
  if (!drawer) return;
  const isOpen = drawer.classList.contains('open');
  if (isOpen) closeChat(); else openChat();
}

function openChat() {
  const drawer  = document.getElementById('chat-drawer');
  const overlay = document.getElementById('chat-overlay');
  const fab     = document.getElementById('chat-fab');
  if (drawer)  { drawer.classList.add('open');  drawer.setAttribute('aria-hidden', 'false'); }
  if (overlay) { overlay.style.display = 'block'; }
  if (fab)     { fab.classList.add('open'); }
  setTimeout(() => {
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const inp = document.getElementById('chat-input');
    if (inp) inp.focus();
  }, 220);
}

function closeChat() {
  const drawer  = document.getElementById('chat-drawer');
  const overlay = document.getElementById('chat-overlay');
  const fab     = document.getElementById('chat-fab');
  if (drawer)  { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
  if (overlay) { overlay.style.display = 'none'; }
  if (fab)     { fab.classList.remove('open'); }
}

function appendChatMessage(role, content, typing = false) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  const el = document.createElement('div');
  el.className = `chat-msg chat-msg-${role}${typing ? ' chat-typing' : ''}`;
  el.innerHTML = `
    <div class="chat-msg-avatar">
      <i class="fas fa-${role === 'ai' ? 'robot' : 'user'}" aria-hidden="true"></i>
    </div>
    <div class="chat-msg-content">${typing ? '<i class="fas fa-ellipsis-h"></i>' : escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

async function handleChatSend() {
  const input  = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  appendChatMessage('user', text);
  CHAT_MESSAGES.push({ role: 'user', content: text });

  if (sendBtn) sendBtn.disabled = true;
  const typingEl = appendChatMessage('ai', '', true);

  try {
    const res = await fetch(`${WORKER_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: CHAT_MESSAGES }),
    });
    const data = await res.json();
    const reply = data.reply || 'No response received.';

    if (typingEl) {
      typingEl.classList.remove('chat-typing');
      typingEl.querySelector('.chat-msg-content').innerHTML = escapeHtml(reply).replace(/\n/g, '<br>');
    }

    CHAT_MESSAGES.push({ role: 'assistant', content: reply });
    // Keep only last 20 messages in memory to avoid token overflow
    if (CHAT_MESSAGES.length > 20) CHAT_MESSAGES = CHAT_MESSAGES.slice(-20);
    try { sessionStorage.setItem('infohub_chat_v1', JSON.stringify(CHAT_MESSAGES)); } catch(e) {}
  } catch(e) {
    if (typingEl) {
      typingEl.classList.remove('chat-typing');
      typingEl.querySelector('.chat-msg-content').innerHTML = `<span style="color:#e57373;">Error: ${escapeHtml(e.message)}</span>`;
    }
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
}

// Wire up Enter key in chat textarea (Shift+Enter = newline)
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'chat-input') {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  }
});

// Close chat on overlay click
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'chat-overlay') closeChat();
});

/* ============================================================
   INCIDENT ACKNOWLEDGMENT
   ============================================================ */

async function loadAcknowledgments(ids) {
  if (!ids || !ids.length) return;
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
  // chunk into groups of 50
  const chunks = [];
  for (let i = 0; i < uniqueIds.length; i += 50) chunks.push(uniqueIds.slice(i, i + 50));

  try {
    await Promise.all(chunks.map(async chunk => {
      const res = await fetch(`${WORKER_URL}/api/acknowledge?ids=${encodeURIComponent(chunk.join(','))}`);
      if (!res.ok) return;
      const data = await res.json();
      Object.assign(ACK_CACHE, data);
    }));
    applyAckBadges();
  } catch(e) {
    console.warn('[ACK] loadAcknowledgments failed:', e.message);
  }
}

function applyAckBadges() {
  document.querySelectorAll('[data-ack-id]').forEach(el => {
    const id = el.dataset.ackId;
    if (!id || !ACK_CACHE[id]) return;
    const ack = ACK_CACHE[id];
    // Remove existing ACK button for this id and replace with badge
    const ackBtn = el.querySelector(`.btn-ack[data-id="${CSS.escape(id)}"]`);
    if (ackBtn) {
      const badge = document.createElement('span');
      badge.className = 'ack-badge';
      badge.innerHTML = `<i class="fas fa-check-circle" aria-hidden="true"></i> ${escapeHtml(ack.user_name)}`;
      badge.title = ack.note ? `Note: ${ack.note}\n${ack.timestamp}` : ack.timestamp;
      ackBtn.replaceWith(badge);
    }
  });
}

function showAckForm(incidentId, triggerEl) {
  // If already ACK'd, just show info
  if (ACK_CACHE[incidentId]) {
    const ack = ACK_CACHE[incidentId];
    alert(`Acknowledged by: ${ack.user_name}\nNote: ${ack.note || '(none)'}\nTime: ${ack.timestamp}`);
    return;
  }
  // Check if form already open for this ID
  const existing = document.querySelector(`.ack-form-inline[data-ack-form-id="${CSS.escape(incidentId)}"]`);
  if (existing) { existing.remove(); return; }

  const form = document.createElement('div');
  form.className = 'ack-form-inline';
  form.dataset.ackFormId = incidentId;
  form.innerHTML = `
    <input type="text" placeholder="Your name (required)" class="ack-name-input" maxlength="100" aria-label="Your name">
    <textarea rows="2" placeholder="Optional note…" class="ack-note-input" maxlength="500" aria-label="Acknowledgment note"></textarea>
    <div class="ack-form-btns">
      <button type="button" class="btn-ack-submit">✓ Submit ACK</button>
      <button type="button" class="btn-ack-cancel">Cancel</button>
    </div>`;

  // Insert after trigger element
  triggerEl.insertAdjacentElement('afterend', form);

  const nameInput = form.querySelector('.ack-name-input');
  if (nameInput) nameInput.focus();

  form.querySelector('.btn-ack-submit').addEventListener('click', async () => {
    const name = (form.querySelector('.ack-name-input')?.value || '').trim();
    const note = (form.querySelector('.ack-note-input')?.value || '').trim();
    if (!name) { alert('Please enter your name.'); return; }
    await submitAcknowledgment(incidentId, name, note, form);
  });

  form.querySelector('.btn-ack-cancel').addEventListener('click', () => form.remove());
}

async function submitAcknowledgment(id, user_name, note, formEl) {
  try {
    const res = await fetch(`${WORKER_URL}/api/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, user_name, note }),
    });
    const data = await res.json();
    if (data.ok && data.ack) {
      ACK_CACHE[id] = data.ack;
      if (formEl) formEl.remove();
      applyAckBadges();
    } else {
      alert(`ACK failed: ${data.error || 'Unknown error'}`);
    }
  } catch(e) {
    alert(`ACK failed: ${e.message}`);
  }
}

/* ============================================================
   /TIER-2 FEATURES
   ============================================================ */

/* ============================================================
   TIER-3 FEATURES
   ============================================================ */

/* ----------------------------------------------------------
   SUPPLY CHAIN DISRUPTION MAP LAYER
   Filters existing INCIDENTS where category === 'SUPPLY_CHAIN'
   and renders them as orange Leaflet markers (no new Worker route).
   ---------------------------------------------------------- */
function toggleSupplyChainLayer() {
  const btn = document.getElementById('supply-chain-toggle');
  supplyChainEnabled = !supplyChainEnabled;
  if (btn) btn.setAttribute('aria-pressed', String(supplyChainEnabled));
  if (btn) btn.classList.toggle('active', supplyChainEnabled);

  if (supplyChainEnabled) {
    renderSupplyChainLayer();
  } else {
    if (supplyChainLayer) {
      try { map.removeLayer(supplyChainLayer); } catch(e) {}
      supplyChainLayer = null;
    }
  }
}

function renderSupplyChainLayer() {
  if (!map) return;
  if (supplyChainLayer) {
    try { map.removeLayer(supplyChainLayer); } catch(e) {}
    supplyChainLayer = null;
  }
  const scInc = INCIDENTS.filter(i => {
    const cat = (i.category || '').toUpperCase();
    return (cat === 'SUPPLY_CHAIN' || cat === 'SUPPLY' || cat === 'LOGISTICS' || cat === 'TRADE') && i.lat && i.lng;
  });
  if (scInc.length === 0) {
    console.log('[SUPPLY] No supply chain incidents with coordinates to render');
    return;
  }
  const supplyIcon = L.divIcon({
    className: 'supply-marker',
    html: '<i class="fas fa-boxes-stacked"></i>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12]
  });
  supplyChainLayer = L.layerGroup();
  for (const inc of scInc) {
    const marker = L.marker([inc.lat, inc.lng], { icon: supplyIcon });
    const sevLabel = inc.severity_label || (['', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][inc.severity] || 'MEDIUM');
    marker.bindPopup(`
      <div style="min-width:200px">
        <div style="font-weight:700;font-size:0.85rem;margin-bottom:4px">${escapeHtml(inc.title || 'Supply Chain Event')}</div>
        <div style="font-size:0.75rem;color:#aaa;">${escapeHtml(inc.country || inc.region || '')} &bull; ${sevLabel}</div>
        ${inc.link ? `<a href="${escapeHtml(inc.link)}" target="_blank" rel="noopener" style="font-size:0.75rem">→ Source</a>` : ''}
      </div>
    `);
    supplyChainLayer.addLayer(marker);
  }
  supplyChainLayer.addTo(map);
  console.log(`[SUPPLY] Rendered ${scInc.length} supply chain markers`);
}

/* ----------------------------------------------------------
   AI THREAT CORRELATION ENGINE
   Fetches clustered signals from Worker, renders in sidebar panel.
   ---------------------------------------------------------- */
async function loadCorrelationSignals(force = false) {
  const bodyEl = document.getElementById('correlate-body');
  const countEl = document.getElementById('correlate-count');
  const panel = document.getElementById('correlate-panel');

  if (!panel) return;
  if (bodyEl) bodyEl.innerHTML = '<div class="text-center text-secondary py-3"><i class="fas fa-spinner fa-spin"></i> Analyzing…</div>';
  panel.style.display = ''; /* clear any inline override — let CSS flex rule apply */

  try {
    const url = `${WORKER_URL}/api/ai/correlate${force ? '?force=1' : ''}`;
    const res = await fetchWithTimeout(url, {});
    const data = await res.json();
    CORRELATION_DATA = data;

    const signals = Array.isArray(data.signals) ? data.signals : [];
    if (countEl) countEl.textContent = String(signals.length);

    if (signals.length === 0) {
      if (bodyEl) bodyEl.innerHTML = '<div class="text-center text-secondary py-3" style="font-size:0.8rem;">No correlated signal clusters detected in the last 48h.</div>';
      return;
    }
    renderCorrelationSignals(signals);
    console.log(`[CORRELATE] ${signals.length} signals loaded, ${data.incident_count} incidents analysed`);
  } catch(e) {
    console.warn('[CORRELATE] load failed:', e.message);
    if (bodyEl) bodyEl.innerHTML = `<div class="text-center text-secondary py-3" style="font-size:0.78rem;color:#e57373;">Failed to load signals.<br><small>${escapeHtml(e.message)}</small></div>`;
  }
}

function renderCorrelationSignals(signals) {
  const bodyEl = document.getElementById('correlate-body');
  if (!bodyEl) return;

  const sevColor = { CRITICAL: '#f44336', HIGH: '#ff9800', MEDIUM: '#ffc107' };

  bodyEl.innerHTML = signals.map(s => {
    const countries = (s.countries || []).slice(0, 4).join(', ');
    const sev = (s.severity || 'MEDIUM').toUpperCase();
    const col = sevColor[sev] || '#ffc107';
    return `
      <div class="signal-card signal-sev-${sev}">
        <div class="signal-title">
          ${escapeHtml(s.category || s.title || 'Security Cluster')}
          <span class="signal-count">${s.count} incidents</span>
        </div>
        ${countries ? `<div class="signal-countries">${escapeHtml(countries)}</div>` : ''}
        ${s.signal_text ? `<div class="signal-text">${escapeHtml(s.signal_text)}</div>` : ''}
      </div>`;
  }).join('');
}

function startCorrelationRefresh() {
  loadCorrelationSignals();
  if (correlationRefreshTimer) clearInterval(correlationRefreshTimer);
  correlationRefreshTimer = setInterval(() => loadCorrelationSignals(), 30 * 60 * 1000);
}

/* ----------------------------------------------------------
   AI PREDICTIVE ESCALATION SCORE
   Appended to the CRP panel body after loadCountryRisk resolves.
   Called by the patched openCRP() above.
   ---------------------------------------------------------- */
async function loadEscalationScore(country) {
  const bodyEl = document.getElementById('crp-body');
  if (!bodyEl) return;

  // Create/find escalation section placeholder
  let escSection = document.getElementById('crp-escalation');
  if (!escSection) {
    escSection = document.createElement('div');
    escSection.id = 'crp-escalation';
    escSection.className = 'esc-section';
    escSection.innerHTML = '<div class="esc-header">Escalation Score</div><div style="color:#4a90d9;font-size:0.8rem;"><i class="fas fa-spinner fa-spin"></i> Computing…</div>';
    bodyEl.appendChild(escSection);
  } else {
    escSection.innerHTML = '<div class="esc-header">Escalation Score</div><div style="color:#4a90d9;font-size:0.8rem;"><i class="fas fa-spinner fa-spin"></i> Computing…</div>';
  }

  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/ai/escalation?country=${encodeURIComponent(country)}`, {});
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    const dir = (data.direction || 'stable').toLowerCase();
    const arrow = dir === 'rising' ? '↑' : dir === 'declining' ? '↓' : '→';
    const scoreClass = `esc-score esc-${dir}`;
    const dirClass = `esc-direction esc-${dir}`;
    const conf = data.confidence ? ` <span style="font-size:0.65rem;color:#607d8b;">(${data.confidence} confidence)</span>` : '';

    // Re-find the section (DOM may have been rebuilt by loadCountryRisk)
    let sect = document.getElementById('crp-escalation');
    if (!sect) {
      sect = document.createElement('div');
      sect.id = 'crp-escalation';
      sect.className = 'esc-section';
      const b = document.getElementById('crp-body');
      if (b) b.appendChild(sect);
    }

    sect.innerHTML = `
      <div class="esc-header">Escalation Score${conf}</div>
      <div class="esc-score-row">
        <span class="${scoreClass}">${data.escalation_score}</span>
        <span class="${dirClass}" title="${dir}">${arrow}</span>
        <span style="font-size:0.7rem;color:#78909c;">${data.period_24h}h now / ${data.period_prev48h} prev 48h</span>
      </div>
      ${data.narrative ? `<div class="esc-narrative">${escapeHtml(data.narrative)}</div>` : ''}
    `;
  } catch(e) {
    console.warn('[ESCALATION] load failed:', e.message);
    const sect = document.getElementById('crp-escalation');
    if (sect) sect.innerHTML = ''; // Silently hide on failure
  }
}

/* ----------------------------------------------------------
   AI EXECUTIVE REPORT + PDF EXPORT
   ---------------------------------------------------------- */
async function generateExecReport() {
  const contentEl = document.getElementById('exec-report-content');
  const kpisEl = document.getElementById('exec-report-kpis');
  const metaEl = document.getElementById('exec-report-meta');
  const pdfBtn = document.getElementById('exec-pdf-btn');
  const footerEl = document.getElementById('exec-report-footer');

  if (contentEl) contentEl.innerHTML = '<div class="text-center py-5"><i class="fas fa-robot fa-2x mb-3 d-block" style="color:#81c784;"></i><span style="color:#90a4ae;font-size:0.9rem;">Generating AI executive briefing…</span></div>';
  if (kpisEl) kpisEl.innerHTML = '';
  if (pdfBtn) pdfBtn.style.display = 'none';

  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/ai/exec-report`, {});
    const data = await res.json();

    renderExecReport(data);
    console.log('[EXEC-REPORT] Generated successfully');
  } catch(e) {
    console.error('[EXEC-REPORT] failed:', e.message);
    if (contentEl) contentEl.innerHTML = `<div style="color:#e57373;padding:20px;">Failed to generate report: ${escapeHtml(e.message)}</div>`;
  }
}

function renderExecReport(data) {
  const contentEl = document.getElementById('exec-report-content');
  const kpisEl = document.getElementById('exec-report-kpis');
  const metaEl = document.getElementById('exec-report-meta');
  const pdfBtn = document.getElementById('exec-pdf-btn');
  const footerEl = document.getElementById('exec-report-footer');

  // Render KPI tiles
  const kpis = data.kpis || {};
  if (kpisEl) {
    const regions = kpis.regions || {};
    kpisEl.innerHTML = `
      <div class="exec-kpi-card">
        <div class="exec-kpi-val">${kpis.total || 0}</div>
        <div class="exec-kpi-label">Total (24h)</div>
      </div>
      <div class="exec-kpi-card">
        <div class="exec-kpi-val kpi-critical">${kpis.critical || 0}</div>
        <div class="exec-kpi-label">Critical</div>
      </div>
      <div class="exec-kpi-card">
        <div class="exec-kpi-val kpi-high">${kpis.high || 0}</div>
        <div class="exec-kpi-label">High</div>
      </div>
      <div class="exec-kpi-card">
        <div class="exec-kpi-val" style="font-size:0.75rem;line-height:1.5;padding-top:4px;">
          AMER:${regions.AMER||0} EMEA:${regions.EMEA||0}<br>APJC:${regions.APJC||0} LATAM:${regions.LATAM||0}
        </div>
        <div class="exec-kpi-label">Regions</div>
      </div>
    `;
  }

  // Parse and render report text with markdown-lite formatting
  if (contentEl && data.report_text) {
    const html = data.report_text
      .replace(/^## (.+)$/gm, '<h5 class="exec-section-head">$1</h5>')
      .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
      .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, match => `<ul class="mb-2">${match}</ul>`)
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    contentEl.innerHTML = `<p>${html}</p>`;
  }

  // Show PDF button + metadata
  if (pdfBtn) pdfBtn.style.display = 'inline-block';
  const genAt = data.generated_at ? new Date(data.generated_at).toLocaleTimeString() : '—';
  if (metaEl) metaEl.textContent = `${data.incident_count || 0} incidents analysed • Generated ${genAt}`;
  if (footerEl) footerEl.textContent = `${data.incident_count || 0} incidents analysed • Generated ${genAt}`;
}

async function downloadExecReportPDF() {
  const el = document.getElementById('exec-report-content');
  if (!el) return;
  const pdfBtn = document.getElementById('exec-pdf-btn');

  try {
    if (pdfBtn) { pdfBtn.disabled = true; pdfBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rendering…'; }

    const canvas = await html2canvas(el, {
      backgroundColor: '#0d1117',
      scale: 2,
      useCORS: true,
      logging: false
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgW = 210;
    const imgH = (canvas.height * imgW) / canvas.width;

    // Add header
    pdf.setFillColor(13, 17, 23);
    pdf.rect(0, 0, 210, 297, 'F');
    pdf.setTextColor(129, 199, 132);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text('DELL OS INFOHUB — Executive Security Report', 105, 10, { align: 'center' });
    pdf.setTextColor(150, 150, 150);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, 105, 16, { align: 'center' });

    // Add report image
    const yOffset = 20;
    const maxH = 297 - yOffset - 5;
    const finalH = Math.min(imgH, maxH);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, yOffset, imgW, finalH);

    const filename = `Dell_ExecReport_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(filename);
    console.log('[EXEC-REPORT] PDF saved:', filename);
  } catch(e) {
    console.error('[EXEC-REPORT] PDF failed:', e.message);
    alert('PDF export failed: ' + e.message);
  } finally {
    if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.innerHTML = '<i class="fas fa-file-pdf"></i> Download PDF'; }
  }
}

/* ----------------------------------------------------------
   SENTIMENT DRIFT MONITOR
   Region-level severity-weighted bars + AI narrative.
   ---------------------------------------------------------- */
async function loadSentimentDrift() {
  const bodyEl = document.getElementById('sentiment-body');
  const updatedEl = document.getElementById('sentiment-updated');
  const panel = document.getElementById('sentiment-panel');

  if (!panel) return;

  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/ai/sentiment`, {});
    const data = await res.json();
    SENTIMENT_DATA = data;

    if (data.regions) {
      renderSentimentDrift(data.regions);
      panel.style.display = ''; /* clear any inline override — let CSS flex rule apply */
      if (updatedEl) updatedEl.textContent = data.generated_at ? new Date(data.generated_at).toLocaleTimeString() : '—';
      console.log('[SENTIMENT] Drift data loaded');
    }
  } catch(e) {
    console.warn('[SENTIMENT] load failed:', e.message);
    if (bodyEl) bodyEl.innerHTML = `<div class="text-center text-secondary py-2" style="font-size:0.76rem;">Unavailable</div>`;
    if (panel) panel.style.display = ''; /* clear any inline override — let CSS flex rule apply */
  }
}

function renderSentimentDrift(regions) {
  const bodyEl = document.getElementById('sentiment-body');
  if (!bodyEl || !regions) return;

  const REGION_LABELS = {
    AMER: 'Americas',
    EMEA: 'Europe / ME / Africa',
    APJC: 'Asia-Pacific / Japan',
    LATAM: 'Latin America'
  };

  const rows = Object.entries(regions).map(([key, v]) => {
    const label = (v.label || 'STABLE').toUpperCase();
    const score = Math.min(100, Math.max(0, v.score || 0));
    const trend = v.trend || 'stable';
    const trendIcon = trend === 'rising' ? '↑' : trend === 'declining' ? '↓' : '→';

    return `
      <div class="sentiment-row">
        <div class="sentiment-region">${REGION_LABELS[key] || key} <span style="color:#607d8b;font-weight:400;">${trendIcon}</span></div>
        <div class="sentiment-bar-wrap">
          <div class="sentiment-bar sentiment-label-${label}" style="--bar-pct:${score}%"></div>
        </div>
        <div class="sentiment-row-meta">
          <span class="sentiment-lbl sentiment-label-${label}">${label}</span>
          <span style="font-size:0.68rem;color:#607d8b;margin-left:auto;">${v.count || 0} inc.</span>
        </div>
        ${v.narrative ? `<div class="sentiment-narrative">${escapeHtml(v.narrative)}</div>` : ''}
      </div>`;
  });

  bodyEl.innerHTML = rows.join('');
}

function startSentimentRefresh() {
  loadSentimentDrift();
  if (sentimentRefreshTimer) clearInterval(sentimentRefreshTimer);
  sentimentRefreshTimer = setInterval(loadSentimentDrift, 30 * 60 * 1000);
}

/* ----------------------------------------------------------
   CYBER THREAT INTEL PANEL
   CISA KEV + CVE CIRCL + optional OTX (if Worker has OTX_API_KEY).
   ---------------------------------------------------------- */
function openThreatIntelPanel() {
  const drawer = document.getElementById('threat-drawer');
  const overlay = document.getElementById('threat-overlay');
  if (!drawer) return;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) { overlay.classList.add('open'); overlay.style.display = 'block'; }

  // Lazy load on first open
  if (!THREAT_INTEL_DATA) {
    loadThreatIntel();
  } else {
    renderThreatIntel(THREAT_INTEL_DATA, activeThreatTab);
  }

  // Wire tab clicks (once)
  if (!drawer._tabsWired) {
    drawer._tabsWired = true;
    drawer.addEventListener('click', (ev) => {
      const tabEl = ev.target.closest('.threat-tab');
      if (tabEl && tabEl.dataset.threatTab) {
        if (THREAT_INTEL_DATA) renderThreatIntel(THREAT_INTEL_DATA, tabEl.dataset.threatTab);
        else activeThreatTab = tabEl.dataset.threatTab;
      }
      // Overlay click closes panel
      if (ev.target.id === 'threat-overlay') closeThreatIntelPanel();
    });
  }
}

function closeThreatIntelPanel() {
  const drawer = document.getElementById('threat-drawer');
  const overlay = document.getElementById('threat-overlay');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
}

async function loadThreatIntel() {
  const bodyEl = document.getElementById('threat-body');
  if (bodyEl) bodyEl.innerHTML = '<div class="text-center text-secondary py-4"><i class="fas fa-spinner fa-spin"></i> Loading threat intelligence…</div>';

  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/threat-intel`, {});
    const data = await res.json();
    THREAT_INTEL_DATA = data;

    const ok = (data.sources_ok || []).join(', ') || '—';
    const failed = (data.sources_failed || []).join(', ');
    console.log(`[THREAT-INTEL] sources ok: ${ok}${failed ? ` | failed: ${failed}` : ''}`);

    renderThreatIntel(data, activeThreatTab);
  } catch(e) {
    console.warn('[THREAT-INTEL] load failed:', e.message);
    if (bodyEl) bodyEl.innerHTML = `<div class="text-center text-secondary py-4" style="font-size:0.8rem;">Failed to load threat intel.<br><small>${escapeHtml(e.message)}</small></div>`;
  }
}

function renderThreatIntel(data, tab) {
  activeThreatTab = tab || 'cyber';
  const bodyEl = document.getElementById('threat-body');
  if (!bodyEl) return;

  // Update tab active states
  document.querySelectorAll('.threat-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.threatTab === activeThreatTab);
    el.setAttribute('aria-selected', String(el.dataset.threatTab === activeThreatTab));
  });

  // ── Cyber Events tab (PRIMARY — operational manager intelligence) ──────────
  if (activeThreatTab === 'cyber') {
    const cyberEvents = Array.isArray(data.cyber_events) ? data.cyber_events : [];
    if (cyberEvents.length === 0) {
      bodyEl.innerHTML = `
        <div class="text-center text-secondary py-4" style="font-size:0.8rem;">
          <i class="fas fa-shield-virus mb-2 d-block" style="font-size:1.5rem;color:#607d8b;"></i>
          No major operational cyber events in the last 72 hours.<br>
          <small style="color:#455a64;">Sources: GDELT global news aggregator</small>
        </div>`;
      return;
    }
    const tagColors = {
      RANSOMWARE: { bg: '#4a1a1a', border: '#f44336', text: '#ef9a9a' },
      BREACH:     { bg: '#2a1a3a', border: '#9c27b0', text: '#ce93d8' },
      APT:        { bg: '#1a2a1a', border: '#e65100', text: '#ffb74d' },
      DISRUPTION: { bg: '#1a2a3a', border: '#1565c0', text: '#90caf9' },
      CYBER:      { bg: '#1a2530', border: '#546e7a', text: '#90a4ae' }
    };
    bodyEl.innerHTML = `
      <div style="font-size:0.7rem;color:#546e7a;padding:8px 12px 4px;border-bottom:1px solid #1e2530;">
        <i class="fas fa-satellite-dish me-1"></i>Major cyber incidents — last 72h · Source: global news
      </div>
      ${cyberEvents.map(e => {
        const tc = tagColors[e.tag] || tagColors.CYBER;
        const dateStr = e.date || '';
        const domain = e.domain ? `<span style="color:#455a64;font-size:0.68rem;">${escapeHtml(e.domain)}</span>` : '';
        return `
          <div class="cyber-event-card" style="border-left:3px solid ${tc.border};background:${tc.bg};">
            <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:3px;">
              <span class="cyber-event-tag" style="background:${tc.border};color:#fff;font-size:0.65rem;font-weight:700;border-radius:5px;padding:1px 7px;white-space:nowrap;flex-shrink:0;">${escapeHtml(e.tag)}</span>
              <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener"
                style="color:${tc.text};font-size:0.8rem;font-weight:600;line-height:1.3;text-decoration:none;"
                onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
                ${escapeHtml(e.title)}
              </a>
            </div>
            <div style="display:flex;gap:10px;padding-left:2px;">${domain}${dateStr ? `<span style="color:#37474f;font-size:0.68rem;">${escapeHtml(dateStr)}</span>` : ''}</div>
          </div>`;
      }).join('')}
    `;
    return;
  }

  if (activeThreatTab === 'kev') {
    const kev = Array.isArray(data.kev) ? data.kev : [];
    if (kev.length === 0) {
      bodyEl.innerHTML = '<div class="text-center text-secondary py-4" style="font-size:0.8rem;">No CISA KEV data available.</div>';
      return;
    }
    bodyEl.innerHTML = kev.map(v => `
      <div class="kev-card">
        <div class="threat-card-id">${escapeHtml(v.cveID || 'N/A')}</div>
        <div class="threat-card-meta">
          ${escapeHtml(v.vendorProject || '')} — ${escapeHtml(v.product || '')}
          &bull; Added: <strong>${escapeHtml(v.dateAdded || '—')}</strong>
        </div>
        <div class="threat-card-desc">${escapeHtml(v.vulnerabilityName || v.shortDescription || '—')}</div>
        ${v.shortDescription && v.vulnerabilityName ? `<div class="threat-card-desc mt-1" style="color:#78909c;font-size:0.71rem;">${escapeHtml(v.shortDescription)}</div>` : ''}
      </div>`).join('');

  } else if (activeThreatTab === 'cves') {
    const cves = Array.isArray(data.cves) ? data.cves : [];
    if (cves.length === 0) {
      bodyEl.innerHTML = '<div class="text-center text-secondary py-4" style="font-size:0.8rem;">No CVE data available.</div>';
      return;
    }
    bodyEl.innerHTML = cves.map(v => {
      const cvss = parseFloat(v.cvss || 0);
      let cvssClass = 'cvss-low';
      if (cvss >= 9) cvssClass = 'cvss-critical';
      else if (cvss >= 7) cvssClass = 'cvss-high';
      else if (cvss >= 4) cvssClass = 'cvss-medium';
      const cvssHtml = cvss > 0 ? `<span class="threat-cvss-badge ${cvssClass}">CVSS ${cvss.toFixed(1)}</span>` : '';
      const pub = v.Published ? new Date(v.Published).toLocaleDateString() : '—';
      return `
        <div class="cve-card">
          <div class="threat-card-id">${escapeHtml(v.id || 'N/A')}${cvssHtml}</div>
          <div class="threat-card-meta">Published: ${pub}</div>
          <div class="threat-card-desc">${escapeHtml(v.summary || '—')}</div>
          ${v.reference ? `<a href="${escapeHtml(v.reference)}" target="_blank" rel="noopener" style="font-size:0.7rem;color:#90caf9;">→ Reference</a>` : ''}
        </div>`;
    }).join('');

  } else if (activeThreatTab === 'otx') {
    const otx = Array.isArray(data.otx) ? data.otx : [];
    if (otx.length === 0) {
      bodyEl.innerHTML = `
        <div class="text-center text-secondary py-4" style="font-size:0.8rem;">
          <i class="fas fa-key mb-2 d-block" style="font-size:1.5rem;color:#607d8b;"></i>
          OTX feed not configured.<br>
          <small>Add <code>OTX_API_KEY</code> to your Cloudflare Worker environment to enable AlienVault OTX threat pulses.</small>
        </div>`;
      return;
    }
    bodyEl.innerHTML = otx.map(p => {
      const tags = (p.tags || []).slice(0, 4).map(t => `<span style="background:#2a1a3a;color:#ce93d8;font-size:0.65rem;border-radius:6px;padding:1px 6px;margin:1px;">${escapeHtml(t)}</span>`).join('');
      const created = p.created ? new Date(p.created).toLocaleDateString() : '—';
      return `
        <div class="otx-card">
          <div class="threat-card-id">${escapeHtml(p.name || 'Untitled Pulse')}</div>
          <div class="threat-card-meta">TLP: ${escapeHtml(p.tlp || 'white').toUpperCase()} &bull; ${created}</div>
          <div class="threat-card-desc">${escapeHtml(p.description || '—')}</div>
          ${tags ? `<div class="mt-1">${tags}</div>` : ''}
        </div>`;
    }).join('');
  }
}

/* Wire threat overlay click to close (separate from drawer click — overlay is outside drawer) */
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('threat-overlay');
  if (overlay) overlay.addEventListener('click', closeThreatIntelPanel);
});

/* ============================================================
   /TIER-3 FEATURES
   ============================================================ */

/* ============================================================
   INSIDER INTEL — loadThreatsLeaks / renderThreatsLeaks
   ============================================================ */
let THREATS_LEAKS_DATA = null;
let _tlInitDone = false;

function _tlInit() {
  if (_tlInitDone) return;
  _tlInitDone = true;
  // Filter change listeners
  document.querySelectorAll('[data-action="tl-filter"]').forEach(function(el) {
    el.addEventListener('change', function() { if (THREATS_LEAKS_DATA) _tlRender(THREATS_LEAKS_DATA); });
  });
  // Refresh button
  const btn = document.querySelector('[data-action="tl-refresh"]');
  if (btn) btn.addEventListener('click', function() { loadThreatsLeaks(true); });
}

async function loadThreatsLeaks(force) {
  const feed = document.getElementById('tl-feed');
  if (feed) feed.innerHTML = '<div class="tl-loading"><i class="fas fa-spinner fa-spin"></i> Loading Insider &amp; Leaks…</div>';
  const url = WORKER_URL + '/api/threats-leaks' + (force ? '?refresh=1&bust=' + Date.now() : '');
  // Worker endpoint is slow (~20s) — use 50s timeout with one auto-retry
  for (var _attempt = 0; _attempt < 2; _attempt++) {
    try {
      if (_attempt > 0 && feed) feed.innerHTML = '<div class="tl-loading"><i class="fas fa-spinner fa-spin"></i> Retrying Insider &amp; Leaks…</div>';
      const res = await fetchWithTimeout(url, {}, 50000);
      const data = await res.json();
      THREATS_LEAKS_DATA = data;
      _tlRender(data);
      return;
    } catch (e) {
      console.error('[TL] loadThreatsLeaks attempt ' + (_attempt+1) + ' failed:', e);
      if (_attempt < 1) continue;
      if (feed) feed.innerHTML = '<div class="tl-loading" style="color:#e57373;">Failed to load — check Worker connection. <button onclick="loadThreatsLeaks(true)" style="margin-left:8px;padding:2px 10px;border:1px solid #e57373;background:transparent;color:#e57373;border-radius:4px;cursor:pointer;">Retry</button></div>';
    }
  }
}

function _tlRender(data) {
  const cases = Array.isArray(data.cases) ? data.cases : [];

  // Stats
  const eltCount = cases.filter(function(c){ return c.target === 'ELT'; }).length;
  const el = function(id, v){ const e = document.getElementById(id); if(e) e.textContent = v; };
  el('tl-stat-high',  (data.stats && data.stats.high  != null) ? data.stats.high  : cases.filter(function(c){ return c.severity === 'High'; }).length);
  el('tl-stat-leaks', (data.stats && data.stats.leaks != null) ? data.stats.leaks : cases.filter(function(c){ return c.category === 'Leak'; }).length);
  el('tl-stat-elt',   eltCount);
  el('tl-stat-cases', cases.length);

  // Updated timestamp
  const upd = document.getElementById('tl-updated-at');
  if (upd && data.updated_at) upd.textContent = 'Updated ' + new Date(data.updated_at).toLocaleString();

  // Source strip
  const strip = document.getElementById('tl-source-strip');
  if (strip) {
    const srcs = Array.isArray(data.sources) ? data.sources : [];
    strip.innerHTML = srcs.length ? srcs.map(function(s){ var d; try { d = new URL(s.indexOf('://') < 0 ? 'https://'+s : s).hostname.replace(/^www\./,''); } catch(_) { d = s; } return '<span class="tl-source-badge">' + escapeHtml(d) + '</span>'; }).join('') : '';
  }

  // Apply filters
  const cat  = (document.getElementById('tl-filter-category')   || {}).value || 'all';
  const sev  = (document.getElementById('tl-filter-severity')   || {}).value || 'all';
  const tgt  = (document.getElementById('tl-filter-target')     || {}).value || 'all';
  const conf = (document.getElementById('tl-filter-confidence') || {}).value || 'all';
  const win  = (document.getElementById('tl-filter-window')     || {}).value || 'all';

  const winMsMap = { '72h': 259200000, '7d': 604800000, '14d': 1209600000, '30d': 2592000000, '90d': 7776000000, '365d': 31536000000 };
  // Default: 72h — only recent intel on the dashboard, older stored but hidden
  const winMs  = winMsMap[win] != null ? winMsMap[win] : 259200000;
  const cutoff = winMs ? Date.now() - winMs : 0;

  // Blocklist for Insider & Leaks — these categories don't belong here (marketing/PR/general news)
  const _TL_BLOCKED_CAT_RE = /^(general|geopolitical|cyber.?security|natural.?hazard|supply.?chain|transport|infrastructure|public.?safety|disruption|security|unknown)$/i;

  // Block historical retrospective articles — Google News recirculates old "past year" summaries as new
  const _TL_RETROSPECTIVE_RE = /\b(over\s+the\s+past\s+(year|few\s+years?|months?|quarters?)|in\s+fiscal\s+(year\s+)?20(1\d|2[0-4])|fiscal\s+20(1\d|2[0-4])|fiscal\s+year\s+20(1\d|2[0-4])|past\s+fiscal\s+year|in\s+past\s+fiscal|third\s+year\s+in\s+a\s+row|for\s+the\s+(second|third|fourth)\s+(straight\s+)?year|since\s+20(1\d|2[0-4])|year.over.year|cut.*\d+%.*workforce|shrank.*workforce.*10%|shrunk.*workforce.*1[01]%|laid.off.*1[0-9],000|job\s+cuts\s+will\s+continue.*margins|margins\s+under\s+pressure.*job\s+cuts|calls\s+stolen\s+data\s+.fake|stolen\s+data\s+.fake|world\s*leaks.*dell|dell.*world\s*leaks)/i;

  // Block summary/description content that explicitly references pre-2026 dates (Google News recirculation)
  // e.g. "reported in March 2024", "as of Q3 2023", "announced in 2022"
  const _TL_OLD_YEAR_IN_SUMMARY_RE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+20(1\d|2[0-4])\b|\bas\s+of\s+20(1\d|2[0-4])\b|\bin\s+(q[1-4]\s+)?20(1\d|2[0-4])\b/i;

  // Block known regional-roundup sources that aggregate stale news (not breaking)
  const _TL_ROUNDUP_TITLE_RE = /^austin\s+inno\s*[-–]/i;

  const _tlTitleSeen = new Set();
  let filtered = cases.filter(function(c) {
    // Block non-insider categories (General, Geopolitical, Cyber, etc. belong in Intel feed)
    const itemCat = String(c.category || '');
    if (itemCat && _TL_BLOCKED_CAT_RE.test(itemCat)) return false;
    // Block external APT / CVE / zero-day Breach articles — these are cyber threat intel, not insider risk.
    // Insider & Leaks = employee threats, internal data leaks, workforce intel, forum posts about Dell.
    const _titleStr = String(c.title || '');
    const _summaryStr2 = String(c.summary || '');
    if (itemCat === 'Breach' && /zero.?day|CVE-\d|nation.?state|chinese\s+hack|china.?link|cyberespionage|\bAPT\b|grimbolt|recover.?point|exploit.*month|hack.*month/i.test(_titleStr + ' ' + _summaryStr2)) return false;
    if (_TL_RETROSPECTIVE_RE.test(_titleStr)) return false;
    // Block known regional-roundup sources (Austin Inno = Austin Business Journal weekly roundup)
    if (_TL_ROUNDUP_TITLE_RE.test(_titleStr)) return false;
    // HARD OLD-YEAR GATE on TITLE — if title contains any pre-2026 year (2000–2025) with no 2026
    // anchor, it is old content recirculated by Google News with a fake today-timestamp.
    // e.g. "Dell's 2013 scandal", "layoffs since 2005", "FY2024 results" → all blocked.
    const _titleHas2026 = /\b2026\b/.test(_titleStr);
    if (/\b(20(0\d|1\d|2[0-5])|199\d)\b/.test(_titleStr) && !_titleHas2026) return false;
    // Block articles whose summary explicitly mentions a pre-2026 date (old content surfaced by Google News)
    const _summaryStr = String(c.summary || '');
    if (_TL_OLD_YEAR_IN_SUMMARY_RE.test(_summaryStr) && !/\b2026\b/.test(_summaryStr)) return false;
    // Extended: block if summary contains ANY standalone pre-2026 year with no 2026 reference
    if (/\b(20(0\d|1\d|2[0-5])|199\d)\b/.test(_summaryStr) && !/\b2026\b/.test(_summaryStr) && !_titleHas2026) return false;
    if (cat  !== 'all' && c.category   !== cat)  return false;
    if (sev  !== 'all' && c.severity   !== sev)  return false;
    if (tgt  !== 'all' && c.target     !== tgt)  return false;
    if (conf !== 'all' && c.confidence !== conf) return false;
    // HARD YEAR GATE — never show pre-2026 content in Insider & Leaks
    const _cTs = new Date(c.last_seen || c.first_seen || 0);
    if (_cTs.getFullYear() > 0 && _cTs.getFullYear() < 2026) return false;
    // Block Reddit / HN from display (forum noise, unreliable timestamps)
    const firstLink = String((c.source_links || [])[0] || '');
    const _urlYr = firstLink.match(/\/(20\d{2})[\/\-]/);
    if (_urlYr && parseInt(_urlYr[1], 10) < 2026) return false;
    if (/reddit\.com|redd\.it|hnrss\.org|news\.ycombinator/.test(firstLink)) return false;
    // Deduplicate by title
    const tKey = String(c.title || '').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,60);
    if (tKey && _tlTitleSeen.has(tKey)) return false;
    if (tKey) _tlTitleSeen.add(tKey);
    // Always enforce time cutoff — default 72h, override via dropdown
    if (cutoff) {
      const ts = new Date(c.last_seen || c.first_seen || 0).getTime();
      if (!ts || ts < cutoff) return false;
    }
    return true;
  });
  // Sort newest first
  filtered.sort(function(a, b) {
    return new Date(b.last_seen || b.first_seen || 0).getTime() - new Date(a.last_seen || a.first_seen || 0).getTime();
  });

  const feed = document.getElementById('tl-feed');
  if (!feed) return;

  if (!filtered.length) {
    feed.innerHTML = '<div style="padding:32px;text-align:center;color:#6c757d;font-size:0.9rem;">No cases match the current filters.</div>';
    return;
  }

  const catColors = { 'Layoff / Reorg': '#e67e22', 'Leadership Risk': '#9b59b6', 'Leak': '#e74c3c', 'Threat': '#c0392b', 'Other': '#607d8b' };
  const sevColors = { 'High': '#e74c3c', 'Medium': '#f39c12', 'Low': '#27ae60' };

  feed.innerHTML = filtered.map(function(c) {
    const catColor = catColors[c.category] || '#607d8b';
    const sevColor = sevColors[c.severity] || '#607d8b';
    const dateStr  = c.last_seen ? new Date(c.last_seen).toLocaleDateString() : '';
    const links    = Array.isArray(c.source_links) ? c.source_links : [];
    const firstLink = links[0] || '';
    const title    = c.title ? escapeHtml(c.title) : '(no title)';

    return '<div class="tl-case-card">' +
      '<div class="tl-case-header">' +
        '<span class="tl-cat-badge" style="background:' + catColor + '">' + escapeHtml(c.category || 'Other') + '</span>' +
        '<span class="tl-sev-badge" style="background:' + sevColor + '">' + escapeHtml(c.severity || 'Medium') + '</span>' +
        (c.confidence === 'High' ? '<span class="tl-conf-badge">CONFIRMED</span>' : '') +
        '<span class="tl-case-date">' + escapeHtml(dateStr) + '</span>' +
      '</div>' +
      '<div class="tl-case-title">' +
        (firstLink ? '<a href="' + escapeHtml(firstLink) + '" target="_blank" rel="noopener">' + title + '</a>' : title) +
      '</div>' +
      (c.summary ? '<div class="tl-case-summary">' + escapeHtml((function(s){ var d=document.createElement('div'); d.innerHTML=s; var t=d.textContent||d.innerText||''; d.innerHTML=t; return (d.textContent||d.innerText||'').slice(0,200); })(c.summary)) + '</div>' : '') +
      '<div class="tl-case-meta">' +
        (c.related_mentions > 1 ? '<span class="tl-mentions"><i class="fas fa-link"></i> ' + c.related_mentions + ' mentions</span>' : '') +
        (c.target ? '<span class="tl-target">Target: ' + escapeHtml(c.target) + '</span>' : '') +
        (links.length > 1 ? '<span class="tl-src-count">' + links.length + ' sources</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

/* ============================================================
   VESSEL WATCH — Executive Maritime Exposure Layer
   Layer 1: public intel  Layer 2: vessel tracking (Datalastic free / mock)
   Layer 3: geospatial risk engine  Layer 4: sanitized monitored-vessel registry
   CONSTRAINT: No Dell cargo/customer/SKU/shipment/financial data displayed.
   ============================================================ */

var _vwInitDone   = false;
var _vwMap        = null;
var _vwTileLayer  = null;
var _vwMarkers    = [];
var _vwZoneLayers = [];
var _vwData       = null;

var VW_STATUS_CLASS = { 'Review Required':'vw-badge-review', 'Elevated':'vw-badge-elevated', 'Watch':'vw-badge-watch', 'Normal':'vw-badge-normal' };
var VW_ACTION_CLASS = { 'Escalate':'vw-action-escalate', 'Review':'vw-action-review', 'Monitor':'vw-action-monitor', 'None':'vw-action-none' };
var VW_DOT_COLOR    = { 'Review Required':'#f28b82', 'Elevated':'#f4a742', 'Watch':'#fbbc04', 'Normal':'#81c995' };
var VW_POSTURE_CLS  = { 'Action Required':'vw-posture-critical', 'Elevated':'vw-posture-elevated', 'Watch':'vw-posture-watch', 'Stable':'vw-posture-stable', 'Unknown':'vw-posture-stable' };

function initVesselWatch() {
  if (!_vwInitDone) {
    _vwInitDone = true;
    _vwBindSearch();
    _vwBindRefresh();
  }
  loadVesselWatch(false);
}

function loadVesselWatch(force) {
  if (!force && _vwData && _vwData._ts && (Date.now() - _vwData._ts) < 3 * 60 * 1000) {
    _vwRender(_vwData); return;
  }
  var monEl = document.getElementById('vw-monitored-table');
  if (monEl) monEl.innerHTML = '<div class="vw-loading"><i class="fas fa-spinner fa-spin"></i> Loading fleet status\u2026</div>';
  fetchWithTimeout(WORKER_URL + '/api/vessel/monitored', {}, 30000)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      data._ts = Date.now();
      _vwData  = data;
      _vwRender(data);
    })
    .catch(function(e) {
      console.error('[VW] loadVesselWatch failed:', e);
      var el = document.getElementById('vw-monitored-table');
      if (el) el.innerHTML = '<div class="vw-loading" style="color:#f28b82;"><i class="fas fa-exclamation-circle"></i> Failed to load \u2014 check Worker connection. <button onclick="loadVesselWatch(true)" style="margin-left:8px;padding:2px 10px;border:1px solid #e57373;background:transparent;color:#e57373;border-radius:4px;cursor:pointer;">Retry</button></div>';
    });
}

function _vwRender(data) {
  var vessels = Array.isArray(data.vessels) ? data.vessels : [];
  _vwRenderPosture(data.posture || {});
  _vwRenderMonitoredTable(vessels);
  _vwRenderMap(vessels, data.riskZones || []);
  /* _vwRenderChokepoints and _vwLoadIncidents now handled by port disruption section */
  /* _vwRenderChokepoints(vessels); */
  /* _vwLoadIncidents(vessels); */
  var countEl = document.getElementById('vw-fleet-count');
  if (countEl) countEl.textContent = vessels.length ? vessels.length + ' vessel' + (vessels.length !== 1 ? 's' : '') : '';
}

function _vwRenderPosture(posture) {
  var banner = document.getElementById('vw-posture-banner');
  var levelEl = document.getElementById('vw-posture-level');
  var sumEl   = document.getElementById('vw-posture-summary');
  var cntEl   = document.getElementById('vw-posture-counts');
  if (!banner) return;
  ['vw-posture-stable','vw-posture-watch','vw-posture-elevated','vw-posture-critical'].forEach(function(c){ banner.classList.remove(c); });
  banner.classList.add(VW_POSTURE_CLS[posture.level] || 'vw-posture-stable');
  if (levelEl) levelEl.textContent = posture.level || 'Unknown';
  if (sumEl)   sumEl.textContent   = posture.summary || '';
  if (cntEl && posture.counts) {
    var c = posture.counts;
    cntEl.textContent = (c['Review Required']||0) + ' Review \u00b7 ' + (c['Elevated']||0) + ' Elevated \u00b7 ' + (c['Watch']||0) + ' Watch \u00b7 ' + (c['Normal']||0) + ' Normal';
  }
}

function _vwRenderMonitoredTable(vessels) {
  var el = document.getElementById('vw-monitored-table');
  if (!el) return;
  if (!vessels.length) { el.innerHTML = '<div class="vw-loading">No monitored vessels found.</div>'; return; }
  var sorted = vessels.slice().sort(function(a,b){
    var ord = {'Review Required':0,'Elevated':1,'Watch':2,'Normal':3};
    return (ord[a.status]||9) - (ord[b.status]||9);
  });
  var rows = sorted.map(function(v) {
    var sc  = VW_STATUS_CLASS[v.status]  || 'vw-badge-normal';
    var ac  = VW_ACTION_CLASS[v.recommendedAction] || 'vw-action-none';
    var lat = v.lat != null ? v.lat.toFixed(2) : '\u2014';
    var lon = v.lon != null ? v.lon.toFixed(2) : '\u2014';
    var mockTag = v._mock ? ' <span class="vw-badge vw-badge-mock" title="Illustrative position">MOCK</span>' : '';
    return '<tr title="' + escapeHtml(v.reason||'') + '">' +
      '<td><strong style="color:#e8eaed;">' + escapeHtml(v.vesselName) + '</strong>' + mockTag +
        '<div style="font-size:.65rem;color:#5f6368;">IMO ' + escapeHtml(v.imo||'\u2014') + '</div></td>' +
      '<td style="font-size:.68rem;color:#9aa0a6;">' + lat + '\u00b0, ' + lon + '\u00b0<br>' +
        '<span style="color:#5f6368;">' + escapeHtml(v.nearestChokepoint||'') + (v.nearestCpDistNm?' '+v.nearestCpDistNm+'nm':'') + '</span></td>' +
      '<td style="font-size:.72rem;">' + escapeHtml(v.destination||'\u2014') + '</td>' +
      '<td style="font-size:.72rem;">' + escapeHtml(v.riskZone||'Open Waters') + '</td>' +
      '<td><span class="vw-badge ' + sc + '">' + escapeHtml(v.status) + '</span></td>' +
      '<td><span class="vw-badge ' + ac + '">' + escapeHtml(v.recommendedAction) + '</span></td>' +
      '</tr>';
  }).join('');
  el.innerHTML = '<table class="vw-mv-table"><thead><tr>' +
    '<th>Vessel</th><th>Position</th><th>Destination</th><th>Risk Zone</th><th>Status</th><th>Action</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function _vwRenderMap(vessels, riskZones) {
  if (typeof L === 'undefined') return;
  var mapEl = document.getElementById('vw-map');
  if (!mapEl) return;
  if (!_vwMap) {
    var bounds = L.latLngBounds(L.latLng(-85,-180), L.latLng(85,180));
    _vwMap = L.map('vw-map', { center:[15,60], zoom:2, zoomControl:true, attributionControl:false, maxBounds:bounds, maxBoundsViscosity:1.0, worldCopyJump:false });
    window.vwMap = _vwMap; /* expose globally so initVwGrid GridStack script can call invalidateSize() */
    var _vwIsLight = document.body.classList.contains('light-mode');
    var _vwTileUrl = _vwIsLight
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    _vwTileLayer = L.tileLayer(_vwTileUrl, { subdomains:'abcd', maxZoom:18, noWrap:true, bounds:bounds }).addTo(_vwMap);
    /* Swap tiles when theme toggle fires */
    document.addEventListener('themechange', function() {
      var light = document.body.classList.contains('light-mode');
      var url   = light ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
                        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      if (_vwTileLayer) { _vwTileLayer.setUrl(url); }
    });
  }
  _vwMarkers.forEach(function(m){ m.remove(); }); _vwMarkers = [];
  _vwZoneLayers.forEach(function(l){ l.remove(); }); _vwZoneLayers = [];

  riskZones.forEach(function(zone) {
    if (!zone.polygon || !zone.polygon.length) return;
    var latLngs = zone.polygon.map(function(p){ return [p[1], p[0]]; });
    var sev = zone.severity;
    var fillColor = sev==='CRITICAL'?'#f28b82':sev==='HIGH'?'#f4a742':'#fbbc04';
    var poly = L.polygon(latLngs, { color:fillColor, fillColor:fillColor, fillOpacity:0.12, weight:1.5, dashArray:'6,4' });
    poly.bindTooltip('<strong>' + zone.name + '</strong><br><span style="font-size:.75rem">' + (zone.threat||'') + '</span>', { sticky:true });
    poly.addTo(_vwMap);
    _vwZoneLayers.push(poly);
  });

  vessels.forEach(function(v) {
    if (!v.lat || !v.lon || (v.lat===0 && v.lon===0)) return;
    var color = VW_DOT_COLOR[v.status] || '#81c995';
    var marker = L.circleMarker([v.lat, v.lon], { radius:7, fillColor:color, color:'#fff', weight:1.5, fillOpacity:0.9 });
    var mockNote = v._mock ? '<br><em style="color:#5f6368;font-size:.68rem;">Illustrative position</em>' : '';
    marker.bindPopup(
      '<strong>' + escapeHtml(v.vesselName) + '</strong><br>' +
      'IMO: ' + escapeHtml(v.imo||'\u2014') + ' \u00b7 MMSI: ' + escapeHtml(v.mmsi||'\u2014') + '<br>' +
      'Speed: ' + (v.speed||0) + 'kn \u00b7 Hdg: ' + (v.heading||0) + '\u00b0<br>' +
      'Dest: <strong>' + escapeHtml(v.destination||'\u2014') + '</strong><br>' +
      'Zone: ' + escapeHtml(v.riskZone) + '<br>' +
      'Status: <strong style="color:' + color + '">' + escapeHtml(v.status) + '</strong><br>' +
      '<em style="font-size:.72rem">' + escapeHtml(v.reason||'') + '</em>' + mockNote
    );
    marker.addTo(_vwMap);
    _vwMarkers.push(marker);
  });
  setTimeout(function(){ if (_vwMap) _vwMap.invalidateSize(); }, 120);

  /* Expose port disruption marker helper for renderPortTab() in index.html */
  window._vwAddPortMarkers = function(disruptions) {
    if (!_vwMap) return;
    if (window._vwPortMarkerLayer) { window._vwPortMarkerLayer.clearLayers(); }
    else { window._vwPortMarkerLayer = L.layerGroup().addTo(_vwMap); }
    (disruptions || []).forEach(function(d) {
      if (!d.lat || !d.lng) return;
      var color = d.severity === 'HIGH' ? '#f44336' : d.severity === 'MEDIUM' ? '#ff9800' : '#ffc107';
      var marker = L.circleMarker([d.lat, d.lng], {
        radius: 7, fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.75,
        className: 'vw-port-disruption-marker',
      });
      marker.bindPopup(
        '<b style="color:' + color + ';">' + (d.port_name || 'Maritime Disruption') + '</b>' +
        '<br><span style="font-size:.78rem;">' + (d.summary || d.cause_type || '') + '</span>' +
        (d.source_url ? '<br><a href="' + d.source_url + '" target="_blank" rel="noopener" style="color:#8ab4f8;font-size:.75rem;">Source ↗</a>' : '')
      );
      window._vwPortMarkerLayer.addLayer(marker);
    });
  };
}

var VW_CHOKEPOINTS_STATIC = [
  { id:'bab_el_mandeb',   name:'Bab-el-Mandeb',     trend:-52, status:'Severely Disrupted', severity:'CRITICAL' },
  { id:'red_sea',         name:'Red Sea Corridor',   trend:-45, status:'Severely Disrupted', severity:'CRITICAL' },
  { id:'suez',            name:'Suez Canal',         trend:-38, status:'Severely Disrupted', severity:'HIGH'     },
  { id:'hormuz',          name:'Strait of Hormuz',   trend:-8,  status:'Reduced',            severity:'ELEVATED' },
  { id:'taiwan_strait',   name:'Taiwan Strait',      trend:-5,  status:'Reduced',            severity:'ELEVATED' },
  { id:'malacca',         name:'Strait of Malacca',  trend:2,   status:'Normal',             severity:'NORMAL'   },
  { id:'panama',          name:'Panama Canal',       trend:-18, status:'Reduced',            severity:'ELEVATED' },
  { id:'bosphorus',       name:'Bosphorus Strait',   trend:-12, status:'Reduced',            severity:'ELEVATED' },
  { id:'south_china_sea', name:'South China Sea',    trend:-3,  status:'Normal',             severity:'NORMAL'   },
  { id:'singapore',       name:'Port of Singapore',  trend:1,   status:'Normal',             severity:'NORMAL'   },
];

function _vwRenderChokepoints(vessels) {
  var el = document.getElementById('vw-chokepoint-list');
  if (!el) return;
  var nearby = {};
  vessels.forEach(function(v){ if (v.nearestChokepoint) nearby[v.nearestChokepoint] = (nearby[v.nearestChokepoint]||0)+1; });
  el.innerHTML = VW_CHOKEPOINTS_STATIC.map(function(cp) {
    var trendStr = (cp.trend > 0 ? '+' : '') + cp.trend + '%';
    var cls = cp.trend <= -25 ? 'down' : (cp.trend < 0 ? 'flat' : 'up');
    var sevColor = cp.severity==='CRITICAL'?'#f28b82':cp.severity==='HIGH'?'#f4a742':cp.severity==='ELEVATED'?'#fbbc04':'#81c995';
    var nearbyCount = nearby[cp.name] || 0;
    return '<div class="vw-choke-row">' +
      '<div><div class="vw-choke-name">' + escapeHtml(cp.name) + '</div>' +
      '<div style="font-size:.65rem;color:' + sevColor + ';">' + escapeHtml(cp.status) + '</div></div>' +
      '<div style="text-align:right"><div class="vw-choke-trend ' + cls + '">' + trendStr + '</div>' +
      (nearbyCount ? '<div class="vw-choke-vessels">' + nearbyCount + ' vessel' + (nearbyCount>1?'s':'') + ' nearby</div>' : '') +
      '</div></div>';
  }).join('');
}

function _vwLoadIncidents(vessels) {
  var el = document.getElementById('vw-incident-list');
  if (!el) return;
  fetchWithTimeout(WORKER_URL + '/api/port-disruptions', {}, 20000)
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var disrs = Array.isArray(data.disruptions) ? data.disruptions : [];
      if (!disrs.length) { el.innerHTML = '<div class="vw-loading">No maritime incidents in current feed.</div>'; return; }
      el.innerHTML = disrs.slice(0,12).map(function(d, i) {
        var sevColor = d.severity==='HIGH'?'#f28b82':d.severity==='MEDIUM'?'#fbbc04':'#81c995';
        var nearVessels = vessels.filter(function(v) {
          if (!v.lat||!v.lon||!d.lat||!d.lng) return false;
          var dLat = (v.lat-d.lat)*Math.PI/180;
          var dLon = (v.lon-d.lng)*Math.PI/180;
          var a = Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(v.lat*Math.PI/180)*Math.cos(d.lat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
          return 6371*2*Math.asin(Math.sqrt(a)) < 1500;
        });
        var vesselStr = nearVessels.length ? nearVessels.map(function(v){ return '<strong>'+escapeHtml(v.vesselName)+'</strong>'; }).join(', ') : 'No monitored vessels in vicinity';
        var sc = d.severity==='HIGH'?'vw-badge-review':d.severity==='MEDIUM'?'vw-badge-watch':'vw-badge-normal';
        return '<div class="vw-incident-item" id="vw-inc-'+i+'" onclick="_vwToggleIncident('+i+')">' +
          '<div class="vw-incident-sev" style="background:'+sevColor+';"></div>' +
          '<div class="vw-incident-body">' +
            '<div class="vw-incident-title">'+escapeHtml(d.port_name||'Maritime Incident')+' \u2014 '+escapeHtml(d.summary||d.cause_type||'')+'</div>' +
            '<div class="vw-incident-meta">'+(d.date?new Date(d.date).toLocaleDateString():'')+' \u00b7 '+escapeHtml(d.source||'')+' \u00b7 <span class="vw-badge '+sc+'">'+escapeHtml(d.severity||'')+'</span></div>' +
            '<div class="vw-incident-vessels" id="vw-inc-v-'+i+'">Nearby monitored vessels: '+vesselStr+'</div>' +
          '</div></div>';
      }).join('');
    })
    .catch(function(){ el.innerHTML = '<div class="vw-loading" style="color:#9aa0a6;">Incidents unavailable</div>'; });
}

function _vwToggleIncident(i) {
  var item = document.getElementById('vw-inc-' + i);
  if (item) item.classList.toggle('expanded');
}

function _vwBindSearch() {
  var btn   = document.getElementById('vw-search-btn');
  var input = document.getElementById('vw-search-input');
  if (btn)   btn.addEventListener('click', _vwDoSearch);
  if (input) input.addEventListener('keydown', function(e){ if (e.key==='Enter') _vwDoSearch(); });
}

function _vwBindRefresh() {
  var btn = document.getElementById('vw-refresh-btn');
  if (btn) btn.addEventListener('click', function(){ loadVesselWatch(true); });
}

function _vwDoSearch() {
  var input = document.getElementById('vw-search-input');
  var res   = document.getElementById('vw-search-result');
  if (!input || !res) return;
  var q = input.value.trim();
  if (!q) return;
  res.innerHTML = '<div class="vw-loading"><i class="fas fa-spinner fa-spin"></i> Looking up vessel\u2026</div>';
  var isImo  = /^\d{7}$/.test(q);
  var isMmsi = /^\d{9}$/.test(q);
  var param  = isImo ? 'imo='+encodeURIComponent(q) : isMmsi ? 'mmsi='+encodeURIComponent(q) : 'name='+encodeURIComponent(q);
  fetchWithTimeout(WORKER_URL + '/api/vessel/lookup?' + param, {}, 15000)
    .then(function(r){ return r.json(); })
    .then(function(d) {
      if (!d.ok || !d.vessel) { res.innerHTML = '<div class="vw-loading" style="color:#f28b82;">Vessel not found. Try exact IMO (7 digits), MMSI (9 digits), or vessel name.</div>'; return; }
      res.innerHTML = _vwBuildVesselCard(d.vessel, d.risk, d.isMonitored);
    })
    .catch(function(){ res.innerHTML = '<div class="vw-loading" style="color:#f28b82;">Lookup failed \u2014 check Worker connection.</div>'; });
}

function _vwBuildVesselCard(vessel, risk, isMonitored) {
  if (!vessel || vessel._notFound) return '<div class="vw-loading" style="color:#f28b82;">Vessel not found in AIS feed.</div>';
  var sc    = VW_STATUS_CLASS[risk.status] || 'vw-badge-normal';
  var ac    = VW_ACTION_CLASS[risk.recommendedAction] || 'vw-action-none';
  var color = VW_DOT_COLOR[risk.status] || '#81c995';
  var mockNote  = vessel._mock ? ' <span class="vw-badge vw-badge-mock" title="Illustrative position \u2014 live AIS feed via aisstream.io">MOCK POSITION</span>' : '';
  var monBadge  = isMonitored ? ' <span class="vw-badge" style="background:#1c2a18;color:#81c995;">MONITORED</span>' : '';
  var lat = risk.lat != null ? risk.lat.toFixed(3) : '\u2014';
  var lon = risk.lon != null ? risk.lon.toFixed(3) : '\u2014';
  return '<div class="vw-vessel-card">' +
    '<div class="vw-vessel-name">'+escapeHtml(vessel.name||risk.vesselName)+mockNote+monBadge+'</div>' +
    '<div class="vw-vessel-meta">IMO: '+escapeHtml(risk.imo||'\u2014')+' \u00b7 MMSI: '+escapeHtml(risk.mmsi||'\u2014')+' \u00b7 Flag: '+escapeHtml(vessel.flag||risk.flag||'\u2014')+' \u00b7 '+escapeHtml(vessel.type||risk.vesselType||'')+'</div>' +
    '<div class="vw-vessel-grid">' +
      '<div class="vw-vessel-field"><label>Position</label><span>'+lat+'\u00b0, '+lon+'\u00b0</span></div>' +
      '<div class="vw-vessel-field"><label>Speed</label><span>'+(risk.speed||0)+' kn</span></div>' +
      '<div class="vw-vessel-field"><label>Heading</label><span>'+(risk.heading||0)+'\u00b0</span></div>' +
      '<div class="vw-vessel-field"><label>Nav Status</label><span>'+escapeHtml(risk.navStatus||'\u2014')+'</span></div>' +
      '<div class="vw-vessel-field"><label>Destination</label><span>'+escapeHtml(risk.destination||'\u2014')+'</span></div>' +
      '<div class="vw-vessel-field"><label>ETA</label><span>'+(risk.eta?new Date(risk.eta).toLocaleDateString():'\u2014')+'</span></div>' +
      '<div class="vw-vessel-field"><label>Nearest Chokepoint</label><span>'+escapeHtml(risk.nearestChokepoint||'\u2014')+(risk.nearestCpDistNm?' ('+risk.nearestCpDistNm+'nm)':'')+'</span></div>' +
      '<div class="vw-vessel-field"><label>Last AIS Report</label><span style="'+(risk.aisStale?'color:#f28b82;':'')+'">'+(risk.lastReported?new Date(risk.lastReported).toLocaleString():'\u2014')+(risk.aisStale?' \u26a0 STALE':'')+'</span></div>' +
    '</div>' +
    '<div class="vw-risk-row"><span style="font-size:.72rem;color:#9aa0a6;">Risk Zone:</span>'+
      '<span style="font-size:.78rem;color:'+color+';">'+escapeHtml(risk.riskZone)+'</span>'+
      '<span class="vw-badge '+sc+'">'+escapeHtml(risk.status)+'</span>'+
      '<span class="vw-badge '+ac+'">Action: '+escapeHtml(risk.recommendedAction)+'</span></div>'+
    (risk.reason?'<div style="font-size:.72rem;color:#9aa0a6;margin-top:6px;"><i class="fas fa-info-circle" style="margin-right:4px;"></i>'+escapeHtml(risk.reason)+'</div>':'')+
    (risk.notesSanitized?'<div style="font-size:.72rem;color:#5f6368;margin-top:4px;border-top:1px solid #1a1d23;padding-top:4px;">'+escapeHtml(risk.notesSanitized)+'</div>':'')+
  '</div>';
}
/* ── END VESSEL WATCH ────────────────────────────────────────────────────── */
