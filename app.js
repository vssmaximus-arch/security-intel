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
const AUTO_REFRESH_MS = 60_000;
const DEBUG_UI = (new URLSearchParams(location.search).get('debug') === '1') || (localStorage.getItem('osinfohub_debug') === '1');

/* ===========================
   APP STATE
=========================== */
let INCIDENTS = [];
let PROXIMITY_INCIDENTS = [];
let FEED_IS_LIVE = false;
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
let mapHighlightLayer = null; // Stores the active red circle

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
  { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 }
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
    const cutoffMs = Date.now() - (72 * 3600 * 1000); // match worker PROXIMITY_WINDOW_HOURS
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

    INCIDENTS = list
      .filter(Boolean)
      .filter(i => {
        try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= cutoffMs; } catch { return false; }
      })
      .filter(i => !DISLIKED_IDS.has(String(i.id))); // client-side dislike guard

    if (!AI_ENABLED) INCIDENTS.sort((a, b) => new Date(b.time) - new Date(a.time));
    FEED_IS_LIVE = true;
    refreshHeatLayerIfEnabled();
    if (label) label.textContent = `${AI_ENABLED ? 'AI \u2022' : 'LIVE \u2022'} ${INCIDENTS.length} ITEMS`;
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
    const cutoffMs = Date.now() - (72 * 3600 * 1000); // match worker PROXIMITY_WINDOW_HOURS
    PROXIMITY_INCIDENTS = list
      .map(normaliseWorkerIncident)
      .filter(Boolean)
      .filter(i => {
        try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= cutoffMs; } catch { return false; }
      })
      .filter(i => !DISLIKED_IDS.has(String(i.id))); // client-side dislike guard
    if (!silent) console.log('Loaded proximity items:', PROXIMITY_INCIDENTS.length);
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
    worldCopyJump: false
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
      L.popup({ closeButton: false, offset: [0, -10], className: 'map-tooltip' })
        .setLatLng(e.layer.getLatLng())
        .setContent(summary)
        .openOn(map);
    }, 80);
  });

  incidentClusterGroup.on('clustermouseout', (e) => {
    clearTimeout(_clusterHoverTimeout);
    map.closePopup();
  });

  incidentClusterGroup.on('clusterclick', (e) => {
    if (incidentClusterGroup.options.zoomToBoundsOnClick) return;
    map.closePopup();
  });

  // --- NEW: Remove red circle when popup is closed ---
  map.on('popupclose', () => {
    if (mapHighlightLayer) {
      map.removeLayer(mapHighlightLayer);
      mapHighlightLayer = null;
    }
  });

  // --- NEW: Remove red circle when clicking empty map ---
  map.on('click', () => {
    if (mapHighlightLayer) {
      map.removeLayer(mapHighlightLayer);
      mapHighlightLayer = null;
    }
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

  const data = (region === "Global") ? list : list.filter(i => i.region === region);
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
        icon: L.divIcon({
          html: `<div class="incident-dot" style="background:${color}; box-shadow: 0 0 5px ${color};"></div>`,
          className: '',
          iconSize: [14, 14], 
          iconAnchor: [7, 7]
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

      // --- NEW: Interaction Logic (Click -> Red Circle + FlyTo + Open Popup) ---
      marker.on('click', () => {
        // 1. Remove old circle
        if (mapHighlightLayer) map.removeLayer(mapHighlightLayer);

        // 2. Determine Radius with Clamping (Min 2km, Max 500km)
        let radiusMeters = 50000; // Default 50km
        if (i.country_wide) radiusMeters = 500000;
        else if (i.distance_km && i.distance_km > 0) radiusMeters = i.distance_km * 1000;
        
        // Clamp radius to sane limits
        radiusMeters = Math.max(2000, Math.min(radiusMeters, 500000));

        // 3. Draw Red Circle
        mapHighlightLayer = L.circle([lat, wrapLongitude(lng)], {
          color: '#d93025',       // Red border
          fillColor: '#d93025',   // Red fill
          fillOpacity: 0.15,      // Light transparency
          weight: 1,
          radius: radiusMeters
        }).addTo(map);

        // 4. Fit Bounds / FlyTo & RE-OPEN POPUP after move
        // This ensures the popup isn't closed by the map movement
        try {
          const bounds = mapHighlightLayer.getBounds();
          map.fitBounds(bounds, { padding: [100, 100], maxZoom: 12 }); 
          // Fix: Ensure popup re-opens after move completes
          map.once('moveend', () => marker.openPopup());
          // Fallback timer just in case moveend doesn't fire
          setTimeout(() => { try { marker.openPopup(); } catch(e){} }, 700); 
        } catch (e) {
          map.flyTo([lat, lng], Math.min(11, Math.max(map.getZoom(), 8)));
          map.once('moveend', () => marker.openPopup());
          setTimeout(() => { try { marker.openPopup(); } catch(e){} }, 700);
        }
      });

      // --- NEW: Rich Info Popup (The "Information Underneath") ---
      const popupHtml = `
        <div style="font-family: 'Inter', sans-serif; min-width: 260px; max-width: 300px;">
          <div style="border-left: 4px solid ${color}; padding-left: 8px; margin-bottom: 8px;">
            <div style="font-weight: 700; color: #333; font-size: 14px; line-height: 1.3;">${escapeHtml(i.title)}</div>
            <div style="color: #666; font-size: 11px; margin-top: 4px;">
              ${escapeHtml(safeTime(i.time))} • <span style="color:${color}; font-weight:600;">${escapeHtml(i.severity_label)}</span>
            </div>
          </div>
          
          <div style="background: #f9f9f9; padding: 8px; border-radius: 4px; font-size: 12px; color: #444; line-height: 1.4; margin-bottom: 8px;">
            ${escapeHtml(i.summary ? i.summary.slice(0, 200) + (i.summary.length > 200 ? "..." : "") : "No details available.")}
          </div>

          ${i.nearest_site_name ? `
            <div style="font-size: 11px; margin-bottom: 8px; color: #d93025; display: flex; align-items: center; gap: 4px;">
              <i class="fas fa-bullseye"></i> 
              <strong>${Math.round(i.distance_km)}km</strong> to ${escapeHtml(i.nearest_site_name)}
            </div>` : ''}

          <div style="text-align: right;">
            <a href="${escapeAttr(safeHref(i.link))}" target="_blank" style="background: #0076ce; color: white; padding: 4px 10px; border-radius: 3px; text-decoration: none; font-size: 11px; font-weight: 500;">
              Read Source <i class="fas fa-external-link-alt" style="margin-left:3px;"></i>
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { autoPan: false }); // Disable autoPan here as we handle it manually
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
  const data = (region === "Global") ? INCIDENTS : INCIDENTS.filter(i => i.region === region);
  if (!data || data.length === 0) {
    container.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">No incidents for this region.</div>`;
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
            <span class="ftag ftag-loc">${escapeHtml((i.country||"GLOBAL").toUpperCase())}</span>
            <span class="ftag ftag-type">${escapeHtml(i.category || 'UNKNOWN')}</span>
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

          <div class="vote-row" aria-label="Vote buttons">
            <button type="button" class="btn-vote ${localVote === 'up' ? 'voted-up' : ''}" data-action="vote" data-vote="up" data-id="${escapeAttr(id)}" aria-label="Vote up" title="Helpful">
              <i class="fas fa-thumbs-up" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn-vote ${localVote === 'down' ? 'voted-down' : ''}" data-action="vote" data-vote="down" data-id="${escapeAttr(id)}" aria-label="Vote down" title="Not relevant">
              <i class="fas fa-thumbs-down" aria-hidden="true"></i>
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
    EARTHQUAKE: '🌍 EARTHQUAKE', FLOOD: '🌊 FLOOD', FIRE: '🔥 FIRE',
    STORM: '🌀 STORM', SECURITY: '🛡 SECURITY', TERRORISM: '💥 TERRORISM',
    UNREST: '✊ CIVIL UNREST', PROTEST: '✊ PROTEST', SHOOTING: '🚨 SHOOTING',
    CONFLICT: '⚔ CONFLICT', ACCIDENT: '⚠ ACCIDENT', HEALTH: '🏥 HEALTH',
    POLITICAL: '🏛 POLITICAL', CYBER: '💻 CYBER', OPERATIONAL: '⚙ OPERATIONAL',
  };
  const k = String(cat || '').toUpperCase().trim();
  for (const [key, label] of Object.entries(map)) { if (k.includes(key)) return label; }
  return k || '● INCIDENT';
}

function renderProximityAlerts(region) {
  const container = document.getElementById("proximity-alerts-container");
  if (!container) return;
  const data = (region === "Global") ? PROXIMITY_INCIDENTS : PROXIMITY_INCIDENTS.filter(i => i.region === region);
  const alerts = [];
  data.forEach(inc => {
    try {
      const coords = (Number.isFinite(Number(inc.lat)) && Number.isFinite(Number(inc.lng)))
        ? { lat: Number(inc.lat), lng: Number(inc.lng) } : getCoordsForIncident(inc);
      if (!coords) return;
      const key = generateId(inc);
      if (DISMISSED_ALERT_IDS.has(String(key))) return;
      let nearest = null;
      if (inc.distance_km != null && inc.nearest_site_name) {
        nearest = { dist: Number(inc.distance_km), name: inc.nearest_site_name };
      } else {
        for (const asset of Object.values(ASSETS)) {
          const d = haversineKm(coords.lat, coords.lng, asset.lat, asset.lng);
          if (!nearest || d < nearest.dist) nearest = { dist: d, name: asset.name };
        }
      }
      if (!nearest) return;
      if (inc.country_wide || nearest.dist <= currentRadius) alerts.push({ inc, nearest, key });
    } catch(e) {}
  });

  alerts.sort((a, b) => a.nearest.dist - b.nearest.dist);
  if (!alerts.length) {
    container.innerHTML = `<div style="padding:15px;text-align:center;color:#999;">No threats within ${currentRadius}km of Dell sites.</div>`;
    return;
  }

  container.innerHTML = alerts.slice(0, 25).map(a => {
    const i = a.inc;
    const sev      = Number(i.severity || 1);
    const dist     = i.country_wide ? 0 : Math.round(a.nearest.dist);
    const distStr  = i.country_wide ? 'Country-wide' : `${dist} km`;
    const opImpact = !!i.operational_impact;
    const score    = Number(i.impact_score || 0);
    const timeAgo  = _proxTimeAgo(i.time);
    const action   = _proxAction(sev, dist, opImpact);
    const catLabel = _proxCategoryLabel(i.category);
    const impactBar = _proxImpactBar(score);

    // Severity pill colour
    const sevColor = sev >= 4 ? '#d93025' : sev === 3 ? '#f9ab00' : '#1a73e8';
    const sevLabel = sev >= 4 ? 'CRITICAL' : sev === 3 ? 'HIGH' : sev === 2 ? 'MEDIUM' : 'LOW';
    const sevBg    = sev >= 4 ? 'rgba(211,48,37,.18)' : sev === 3 ? 'rgba(249,171,0,.15)' : 'rgba(26,115,232,.12)';

    const sourceLink = (i.link && i.link !== '#')
      ? `<a href="${escapeAttr(i.link)}" target="_blank" rel="noopener noreferrer"
           style="font-size:.72rem;color:#1a73e8;text-decoration:none;font-weight:600;">View Source ↗</a>`
      : '';

    return `
      <div class="alert-row" style="border-left:4px solid ${sevColor};margin-bottom:8px;padding:10px 12px;background:#fff;border-top:1px solid #e8eaed;border-right:1px solid #e8eaed;border-bottom:1px solid #e8eaed;border-radius:0 8px 8px 0;box-shadow:0 1px 4px rgba(0,0,0,0.07);">
        <!-- Row 1: Severity pill + Category + Impact bar + Time -->
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:5px;">
          <span style="background:${sevBg};color:${sevColor};font-size:.62rem;font-weight:800;padding:1px 7px;border-radius:3px;letter-spacing:.5px;">${sevLabel}</span>
          <span style="font-size:.62rem;color:#5f6368;font-weight:600;background:#f1f3f4;padding:1px 6px;border-radius:3px;">${escapeHtml(catLabel)}</span>
          ${impactBar ? `<span style="margin-left:2px;">${impactBar}</span>` : ''}
          ${opImpact ? `<span style="font-size:.6rem;color:#e65100;font-weight:700;background:rgba(230,81,0,.1);padding:1px 5px;border-radius:3px;border:1px solid rgba(230,81,0,.25);">⚙ OPS IMPACT</span>` : ''}
          ${timeAgo ? `<span style="margin-left:auto;font-size:.65rem;color:#9aa0a6;">${escapeHtml(timeAgo)}</span>` : ''}
        </div>
        <!-- Row 2: Title -->
        <div style="font-size:.82rem;font-weight:700;color:#202124;line-height:1.4;margin-bottom:4px;">
          ${escapeHtml(i.title)}
        </div>
        <!-- Row 3: Site + distance -->
        <div style="font-size:.72rem;color:#5f6368;margin-bottom:5px;">
          📍 Dell <strong style="color:#3c4043;">${escapeHtml(a.nearest.name)}</strong>
          <span style="color:${sevColor};font-weight:700;margin-left:4px;">${escapeHtml(distStr)}</span>
        </div>
        <!-- Row 4: Recommended action chip -->
        <div style="display:inline-flex;align-items:center;gap:4px;background:${action.bg};border:1px solid ${action.color}44;border-radius:4px;padding:2px 9px;margin-bottom:6px;">
          <span style="font-size:.68rem;color:${action.color};font-weight:700;">${escapeHtml(action.label)}</span>
        </div>
        <!-- Row 5: Summary -->
        <div style="font-size:.74rem;color:#5f6368;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:7px;">
          ${escapeHtml(i.summary)}
        </div>
        <!-- Row 6: Source link + Dismiss -->
        <div style="display:flex;align-items:center;justify-content:space-between;">
          ${sourceLink}
          <button type="button" class="btn-dismiss" data-action="dismiss-alert"
            data-id="${escapeAttr(a.key)}" aria-label="Dismiss this alert"
            style="margin-left:auto;">Dismiss</button>
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
          <div class="advisory-label">OFFICIAL ADVISORY</div>
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
          <div class="advisory-label">OFFICIAL ADVISORY${fallbackAdv ? ' (CACHED)' : ' — SERVICE DEGRADED'}</div>
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
    const res = await fetch(`${WORKER_URL}/api/ingest`, { method:'POST', headers:{ 'secret': sec } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Ingest failed (HTTP ${res.status}). ${txt}`.trim(), true); return; }
    adminSetFeedback(txt || 'Ingestion triggered.');
  } catch(e) { adminSetFeedback('Ingest failed (network).', true); console.error(e); }
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
async function previewBriefing() {
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
  const fb = document.getElementById('preview-feedback');
  const cont = document.getElementById('briefing-preview');
  if (fb) { fb.style.display = 'block'; fb.textContent = 'Generating preview…'; }
  if (cont) cont.innerHTML = '';
  let url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  try {
    const res = await fetchWithTimeout(url, {}, 20000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const incidents = json.incidents || [];
    if (!incidents.length) {
      cont.innerHTML = `<div class="safe-box"><i class="fas fa-check-circle safe-icon" aria-hidden="true"></i><div class="safe-text">No incidents found for this period.</div></div>`;
    } else {
      cont.innerHTML = incidents.slice(0,50).map(i => `
        <div style="border-bottom:1px solid #eee; padding:8px 0;">
          <div style="font-weight:700;font-size:0.95rem">${escapeHtml(i.title)}</div>
          <div style="font-size:0.8rem;color:#666">${escapeHtml(i.country || '')} • ${escapeHtml(safeTime(i.time))}</div>
          <div style="font-size:0.85rem;color:#333;margin-top:4px;">${escapeHtml(i.summary || '')}</div>
        </div>
      `).join('');
    }
    const pdfBtn = document.getElementById('download-brief-pdf');
    if (pdfBtn) pdfBtn.style.display = incidents.length ? 'block' : 'none';
    if (fb) fb.style.display = 'none';
  } catch(e) {
    const pdfBtn = document.getElementById('download-brief-pdf');
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
  if (fb) { fb.style.display = 'block'; fb.textContent = 'Building PDF…'; }
  try {
    if (!window.html2canvas || !window.jspdf) throw new Error('PDF libraries not loaded yet.');
    const res = await fetchWithTimeout(`${WORKER_URL}/api/dailybrief?date=${encodeURIComponent(date)}`, {}, 15000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const incidents = json.incidents || json.items || [];
    if (!incidents.length) throw new Error('No incidents for this date.');
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#fff;color:#000;font-family:Arial,sans-serif;padding:24px;font-size:12px;';
    el.innerHTML = `<h2 style="font-size:16px;margin:0 0 16px;">Daily Intelligence Brief — ${escapeHtml(date)}</h2>` +
      incidents.slice(0, 100).map(i => {
        const href = safeHref(i.link);
        const titleEl = href !== '#'
          ? `<a href="${escapeAttr(href)}" style="color:#0076ce;text-decoration:none;font-weight:700;">${escapeHtml(i.title)}</a>`
          : `<strong>${escapeHtml(i.title)}</strong>`;
        return `<div style="margin-bottom:10px;border-bottom:1px solid #ddd;padding-bottom:8px;">
          <div>${titleEl}</div>
          <div style="color:#555;font-size:10px;">${escapeHtml(i.country||'')} &bull; ${escapeHtml(safeTime(i.time||''))}</div>
          <div style="margin-top:4px;">${escapeHtml(i.summary||'')}</div>
        </div>`;
      }).join('');
    document.body.appendChild(el);
    const canvas = await window.html2canvas(el, { scale: 1.5, useCORS: true, logging: false });
    document.body.removeChild(el);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
    pdf.save(`brief-${date}.pdf`);
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
function filterNews(region) {
  renderAssetsOnMap(region);
  renderIncidentsOnMap(region, INCIDENTS);
  renderGeneralFeed(region);
  updateHeadline(region);
  renderProximityAlerts(region);
}

/* ===========================
   Update headline
=========================== */
function updateHeadline(region) {
  const data = (region === "Global") ? INCIDENTS : INCIDENTS.filter(i => i.region === region);
  const el = document.getElementById("headline-alert");
  const tags = document.getElementById("headline-tags");
  if (!el || !tags) return;
  if (data.length) {
    el.textContent = data[0].title || "Headline";
    const sev = mapSeverityToLabel(data[0].severity);
    tags.innerHTML = `
      <span class="tag tag-crit" style="background:${(Number(data[0].severity||1) >= 4) ? '#d93025' : '#5f6368'}">${escapeHtml(sev.label)}</span>
      <span class="tag tag-cat">${escapeHtml(data[0].category || 'CATEGORY')}</span>
      <span class="tag tag-reg">${escapeHtml(data[0].region || 'REGION')}</span>
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
      const cutoffMs = Date.now() - 72 * 3600 * 1000;
      INCIDENTS = (Array.isArray(raw) ? raw : [])
        .map(normaliseWorkerIncident).filter(Boolean)
        .filter(i => { try { return new Date(i.time).getTime() >= cutoffMs; } catch { return false; } })
        .filter(i => !DISLIKED_IDS.has(String(i.id))); // suppress previously-disliked items
      INCIDENTS.sort((a, b) => new Date(b.time) - new Date(a.time));
      FEED_IS_LIVE = true;
      refreshHeatLayerIfEnabled();
      _lastSSEDataMs = Date.now(); // record last successful data receipt
      const label = document.getElementById('feed-status-label');
      if (label) label.textContent = `LIVE \u2022 ${INCIDENTS.length} ITEMS`;
      const active = document.querySelector('.nav-item-custom.active');
      filterNews(active ? active.textContent.trim() : 'Global');
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
      '.live-news-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:94vw;max-width:1360px;height:90vh;background:#131416;color:#e8eaed;z-index:6100;border-radius:12px;box-shadow:0 8px 56px rgba(0,0,0,.9);display:none;flex-direction:column;font-family:Inter,sans-serif;overflow:hidden}',
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
      // Auto-load default channel on first open (neither HLS nor iframe loaded yet)
      const frame = _ltmEl('lnm-tv-frame');
      const video = _ltmEl('lnm-tv-video');
      if (!_lnmHls && frame && !frame.src && (!video || !video.src)) _lnmSwitchChannel(_lnmActiveChannel);
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
  // Filter by category (matches source_category field from Worker) or exact source key
  const visible = _lnmFilter === 'all'
    ? _lnmItems
    : _lnmItems.filter(it => (it.source_category || 'news') === _lnmFilter || it.source_key === _lnmFilter);
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

/* ============================================================
   PHASE 2 — GDELT OSINT INTEL PANEL
   5-tab modal: Military · Cyber · Nuclear · Maritime · Sanctions
   GDELT DOC API v2 (public, CORS-enabled, no auth required)
   Client-side 5-min cache per tab; full sanitisation on all output
   ============================================================ */

const GIM_TABS = [
  { key: 'military',  label: '\u2694\ufe0f Military',  query: 'military operation airstrike',   kvCat: ['CONFLICT','SECURITY','PHYSICAL_SECURITY'] },
  { key: 'cyber',     label: '\ud83d\udcbb Cyber',     query: 'cyberattack ransomware hacking',  kvCat: ['CYBER'] },
  { key: 'nuclear',   label: '\u2622\ufe0f Nuclear',   query: 'nuclear missile proliferation',   kvCat: ['CONFLICT'] },
  { key: 'maritime',  label: '\u2693 Maritime',        query: 'naval piracy shipping blockade',  kvCat: ['TRANSPORT','SUPPLY_CHAIN','DISRUPTION'] },
  { key: 'sanctions', label: '\ud83d\udd12 Sanctions', query: 'sanctions embargo trade tariff',  kvCat: ['SUPPLY_CHAIN','DISRUPTION'] },
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

/* Build fallback articles from live KV incidents matching the tab's categories */
async function _gimKvFallback(tab) {
  try {
    const res  = await fetchWithTimeout(`${WORKER_URL}/api/live-news`, { headers: { 'X-User-Id': OSINFO_USER_ID } }, 12000);
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const cats  = new Set((tab.kvCat || []).map(c => c.toUpperCase()));
    return items
      .filter(i => cats.has(String(i.category || '').toUpperCase()))
      .slice(0, 20)
      .map(i => ({
        url:        i.link || '#',
        title:      i.title || '',
        domain:     i.source_label || '',
        seendate:   i.time ? i.time.replace(/[-:T]/g,'').slice(0,12) + 'Z' : '',
        sourcecountry: i.country || '',
        tone:       '',
        _fromKv:    true,
      }));
  } catch (_) { return []; }
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
    const articles = (data.articles || []).filter(a => a.language === 'English');
    if (articles.length > 0) {
      _gimCache[key] = { ts: Date.now(), articles, source: 'gdelt' };
      return articles;
    }
    // GDELT returned 0 English articles — fall through to KV fallback
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
    feed.innerHTML = '<div style="padding:32px;text-align:center;color:#f28b82;font-size:.82rem">\u26a0\ufe0f OSINT feed unavailable<br><span style="color:#5f6368;font-size:.75rem">GDELT is temporarily unreachable. KV incident fallback also empty.<br>Try refreshing in a few minutes.</span></div>';
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
    '.gdelt-intel-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:94vw;max-width:1360px;height:90vh;background:#131416;color:#e8eaed;z-index:6100;border-radius:12px;box-shadow:0 8px 56px rgba(0,0,0,.9);display:none;flex-direction:column;font-family:Inter,sans-serif;overflow:hidden}',
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
    '<div id="gim-feed" role="feed" aria-live="polite" style="flex:1;overflow-y:auto;padding:8px 12px">' +
      '<div style="padding:40px;text-align:center;color:#5f6368;font-size:.85rem">Select a category above to load intelligence\u2026</div>' +
    '</div>' +
    '<div class="gim-footer">' +
      '<span>\ud83c\udf10 GDELT Global News Database \u00b7 20,000+ sources \u00b7 100+ languages \u00b7 English articles \u00b7 Last 24\u00a0hours \u00b7 5-min cache</span>' +
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
            <span class="conv-level conv-level-${a.level}">${a.levelEmoji || ''} ${a.level}</span>
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
            <span class="cii-level-badge">${item.levelEmoji} ${item.level}</span>
          </div>
          <span class="cii-trend ${item.trendCls || ''}">${item.trendArrow}</span>
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
        document.body.classList.toggle('dark-mode', dark);
        if (icon)  { icon.className  = dark ? 'fas fa-sun' : 'fas fa-moon'; }
        if (label) { label.textContent = dark ? 'Light' : 'Dark'; }
        if (btn)   { btn.setAttribute('aria-pressed', String(dark)); btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; }
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

      if (action === 'filter-region') {
        document.querySelectorAll('[data-action="filter-region"]').forEach(el => el.classList.remove('active'));
        t.classList.add('active');
        filterNews(t.dataset.region || t.textContent.trim());
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
      if (action === 'toggle-heatmap') {
        heatmapEnabled = !heatmapEnabled;
        typeof debug === 'function' && debug('heatmap:toggle', heatmapEnabled);
        const btn = document.getElementById('heatmap-toggle');
        const legend = document.getElementById('heatmap-legend');
        if (btn) { btn.classList.toggle('active', heatmapEnabled); btn.setAttribute('aria-pressed', String(heatmapEnabled)); }
        if (legend) legend.style.display = heatmapEnabled ? 'block' : 'none';
        if (heatmapEnabled) {
          heatLayer = createHeatLayerFromIncidents(INCIDENTS);
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
          // Worker returns { states: [...], not_in_range, fetched_at }
          const count = Array.isArray(data.states) ? data.states.length : 0;
          const cached = data._cached ? ' <em style="color:#5f6368;">(cached)</em>' : '';
          if (el) el.innerHTML = `<span style="color:#81c995;">${count} aircraft in airspace${cached}</span>`;
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
    // Populate date-picker with available archive dates from worker
    (async function populateArchiveDates() {
      try {
        const res = await fetchWithTimeout(`${WORKER_URL}/api/archive`);
        if (!res.ok) return;
        const dates = await res.json();
        if (!Array.isArray(dates) || dates.length === 0) return;
        const dl = document.getElementById('archive-dates') || (() => {
          const d = document.createElement('datalist');
          d.id = 'archive-dates';
          document.body.appendChild(d);
          return d;
        })();
        dl.innerHTML = '';
        dates.sort((a, b) => b.localeCompare(a)); // newest first
        for (const dt of dates) {
          const opt = document.createElement('option');
          opt.value = dt;
          dl.appendChild(opt);
        }
        const picker = document.getElementById('history-picker');
        if (picker) {
          picker.setAttribute('list', 'archive-dates');
          picker.setAttribute('min', dates[dates.length - 1]);
          picker.setAttribute('max', dates[0]);
          // Init flatpickr if loaded — disables non-archive dates in the calendar
          if (typeof flatpickr !== 'undefined') {
            try {
              try { picker.blur(); } catch(e){} // close any open native picker first
              picker.type = 'text';             // must precede flatpickr to suppress native calendar
              picker.value = '';                // clear Edge's stale 'D' day-slot placeholder value
              picker.removeAttribute('min');    // flatpickr manages range constraints via enable:[]
              picker.removeAttribute('max');
              picker.removeAttribute('list');   // detach datalist — its dropdown conflicts with flatpickr
              flatpickr(picker, {
                enable: dates,
                dateFormat: 'Y-m-d',
                allowInput: true,
                placeholder: 'Select archive date…',
                onClose(selectedDates, dateStr) { if (dateStr) loadHistory(dateStr); },
              });
            } catch (fe) { typeof debug === 'function' && debug('flatpickr init', fe?.message || fe); }
          }
        }
      } catch (e) { typeof debug === 'function' && debug('populateArchiveDates', e?.message || e); }
    })();
    const countrySel = document.getElementById('countrySelect'); if (countrySel) countrySel.addEventListener('change', filterTravel);
    const proxRad = document.getElementById('proxRadius'); if (proxRad) proxRad.addEventListener('change', updateProximityRadius);

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

    // S2.5: start 60-second logistics autopoll (updates map markers for watched assets)
    startLogisticsPoll();

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
