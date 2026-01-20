/* app.js - Dell OS INFOHUB
   Full client-side application logic for the INFOHUB dashboard.
   - Handles map init, rendering, normalization
   - Proximity alerts, travel advisories, admin actions, voting
   - Defensive coding: safe parse, region normalization, queueing
*/

/* ===========================
   CONFIG
   =========================== */
const WORKER_URL = "https://osinfohub.vssmaximus.workers.dev";
const AUTO_REFRESH_MS = 60_000;

/* Debug flag: ?debug=1 or localStorage.osinfohub_debug = '1' */
const DEBUG_UI = (new URLSearchParams(location.search).get('debug') === '1') || (localStorage.getItem('osinfohub_debug') === '1');

/* ===========================
   STATE
   =========================== */
let INCIDENTS = [];
let PROXIMITY_INCIDENTS = [];
let FEED_IS_LIVE = false;
let currentRadius = 50; // km
let DISMISSED_ALERT_IDS = new Set();

try {
  const raw = sessionStorage.getItem('dismissed_prox_alert_ids');
  if (raw) {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(v => { try { DISMISSED_ALERT_IDS.add(String(v)); } catch(e){} });
  }
} catch(e){}

let TRAVEL_DATA = [];
let TRAVEL_UPDATED_AT = null;

let map;
let assetsLayer;
let incidentClusterGroup;
let criticalLayerGroup;

let ADMIN_SECRET = '';     // in-memory admin secret; optionally persisted to sessionStorage
let VOTES_LOCAL = {};      // id -> 'up' | 'down'
let VOTE_QUEUE = [];       // queued vote payloads

try {
  const rv = localStorage.getItem('os_v1_votes');
  if (rv) VOTES_LOCAL = JSON.parse(rv) || {};
  const rq = localStorage.getItem('os_v1_vote_queue');
  if (rq) VOTE_QUEUE = JSON.parse(rq) || [];
} catch(e){}

/* ===========================
   GLOBAL HELPERS
   =========================== */
function safeStr(v){ return (v === null || v === undefined) ? '' : String(v); }
function escapeHtml(s){
  return safeStr(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}
function escapeAttr(s){
  return safeStr(s).replace(/"/g,"&quot;").replace(/`/g,"&#096;");
}
function safeHref(u){
  try {
    const s = safeStr(u).trim();
    if (!s) return "#";
    if (/^(mailto:|tel:)/i.test(s)) return s;
    const url = new URL(s, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return "#";
    return url.href;
  } catch { return "#"; }
}
function safeTime(t){
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return "Recently";
    return d.toLocaleString();
  } catch { return "Recently"; }
}
function parseCoord(v){
  if (v === null || v === undefined) return NaN;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

/* ===========================
   REGION NORMALIZATION
   Ensures worker region strings map to canonical codes:
   'Global', 'AMER', 'EMEA', 'APJC', 'LATAM'
   =========================== */
function normalizeRegion(raw) {
  try {
    if (!raw) return 'Global';
    const s = String(raw).trim().toUpperCase();
    if (['GLOBAL','WORLD','ALL'].includes(s)) return 'Global';

    // AMER matching
    const amerKeywords = ['AMER','AMERICAS','AMERICA','NORTH AMERICA','SOUTH AMERICA','USA','US','UNITED STATES','CANADA','MX','MEXICO','BR','BRAZIL','CA'];
    for (const k of amerKeywords) if (s.includes(k)) return 'AMER';

    // LATAM
    const latamKeywords = ['LATAM','LATIN','ARG','BRAZIL','CHILE','COLOMBIA','PERU','PANAMA','URUGUAY','PARAGUAY'];
    for (const k of latamKeywords) if (s.includes(k)) return 'LATAM';

    // EMEA
    const emeaKeywords = ['EMEA','EUROPE','EU','UK','UNITED KINGDOM','FRANCE','GERMANY','NIGERIA','SOUTH AFRICA','MIDDLE EAST','AFRICA','DE','GB','IE'];
    for (const k of emeaKeywords) if (s.includes(k)) return 'EMEA';

    // APJC matching
    const apjcKeywords = ['APJC','APAC','ASIA','PACIFIC','JAPAN','CHINA','INDIA','SINGAPORE','AUSTRALIA','NZ','AU'];
    for (const k of apjcKeywords) if (s.includes(k)) return 'APJC';

    // fallback: if it looks like short code
    if (['AMER','EMEA','APJC','LATAM'].includes(s)) return s;
    return s; // return as-is (UI may treat unknown region differently)
  } catch(e) { return 'Global'; }
}

/* ===========================
   ID generator (single source of truth)
   =========================== */
function generateId(item) {
  try {
    if (!item) return '';
    if (item.id) return String(item.id);
    // stable fallback: title + time
    const title = safeStr(item.title || item.link || item.summary).trim();
    const t = safeStr(item.time || item.ts || item.timestamp || '').trim();
    return `${title}|${t}`;
  } catch(e) { return safeStr(item && item.id) || ''; }
}

/* ===========================
   COUNTRY CENTERS (sample & extended)
   - This is a useful fallback for country-level incidents.
   - I've included a broad set of countries. Add more as desired.
   =========================== */
const COUNTRY_COORDS = {
  "afghanistan": { lat: 33.93911, lng: 67.709953 },
  "albania": { lat: 41.153332, lng: 20.168331 },
  "algeria": { lat: 28.033886, lng: 1.659626 },
  "andorra": { lat: 42.506287, lng: 1.521801 },
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
  "cambodia": { lat: 12.565679, lng: 104.990963 },
  "cameroon": { lat: 7.369722, lng: 12.354722 },
  "canada": { lat: 56.130366, lng: -106.346771 },
  "cape verde": { lat: 16.002082, lng: -24.013197 },
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
  "czech republic": { lat: 49.817492, lng: 15.472962 },
  "denmark": { lat: 56.26392, lng: 9.501785 },
  "djibouti": { lat: 11.825138, lng: 42.590275 },
  "dominica": { lat: 15.414999, lng: -61.370976 },
  "dominican republic": { lat: 18.735693, lng: -70.162651 },
  "ecuador": { lat: -1.831239, lng: -78.183406 },
  "egypt": { lat: 26.820553, lng: 30.802498 },
  "elsalvador": { lat: 13.794185, lng: -88.89653 },
  "equatorial guinea": { lat: 1.650801, lng: 10.267895 },
  "eritrea": { lat: 15.179384, lng: 39.782334 },
  "estonia": { lat: 58.595272, lng: 25.013607 },
  "eswatini": { lat: -26.522503, lng: 31.465866 },
  "ethiopia": { lat: 9.145, lng: 40.489673 },
  "fiji": { lat: -16.578193, lng: 179.414413 },
  "finland": { lat: 61.92411, lng: 25.748151 },
  "france": { lat: 46.227638, lng: 2.213749 },
  "gabon": { lat: -0.803689, lng: 11.609444 },
  "gambia": { lat: 13.443182, lng: -15.310139 },
  "georgia": { lat: 42.315407, lng: 43.356892 },
  "germany": { lat: 51.165691, lng: 10.451526 },
  "ghana": { lat: 7.946527, lng: -1.023194 },
  "greece": { lat: 39.074208, lng: 21.824312 },
  "grenada": { lat: 12.1165, lng: -61.6790 },
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
  "kiribati": { lat: -3.370417, lng: -168.734039 },
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
  "mongolia": { lat: 46.862496, lng: 103.846656 },
  "montenegro": { lat: 42.708678, lng: 19.37439 },
  "morocco": { lat: 31.791702, lng: -7.09262 },
  "mozambique": { lat: -18.665695, lng: 35.529562 },
  "myanmar": { lat: 21.916221, lng: 95.955974 },
  "namibia": { lat: -22.957636, lng: 18.49041 },
  "nauru": { lat: -0.522778, lng: 166.931503 },
  "nepal": { lat: 28.394857, lng: 84.124008 },
  "netherlands": { lat: 52.132633, lng: 5.291266 },
  "new zealand": { lat: -40.900557, lng: 174.885971 },
  "nicaragua": { lat: 12.865416, lng: -85.207229 },
  "niger": { lat: 17.607789, lng: 8.081666 },
  "nigeria": { lat: 9.081999, lng: 8.675277 },
  "north macedonia": { lat: 41.608635, lng: 21.745275 },
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
  "saint vincent and the grenadines": { lat: 12.984305, lng: -61.287228 },
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
  "syria": { lat: 34.802075, lng: 38.996815 },
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
   CITY COORDS (common city fallbacks)
   - Expand as needed; includes capitals & major cities
   =========================== */
const CITY_COORDS = {
  "london": {lat:51.507351, lng:-0.127758},
  "paris": {lat:48.856614, lng:2.352222},
  "sydney": {lat:-33.868820, lng:151.209296},
  "melbourne": {lat:-37.813629, lng:144.963058},
  "brisbane": {lat:-27.469770, lng:153.025131},
  "tokyo": {lat:35.689487, lng:139.691711},
  "osaka": {lat:34.693737, lng:135.502167},
  "beijing": {lat:39.904202, lng:116.407394},
  "shanghai": {lat:31.230391, lng:121.473701},
  "hong kong": {lat:22.319303, lng:114.169361},
  "taipei": {lat:25.032969, lng:121.565418},
  "singapore": {lat:1.352083, lng:103.819836},
  "dubai": {lat:25.204849, lng:55.270782},
  "mumbai": {lat:19.076090, lng:72.877426},
  "delhi": {lat:28.704060, lng:77.102493},
  "bangalore": {lat:12.971599, lng:77.594566},
  "new york": {lat:40.712776, lng:-74.005974},
  "los angeles": {lat:34.052235, lng:-118.243683},
  "chicago": {lat:41.878113, lng:-87.629799},
  "toronto": {lat:43.653225, lng:-79.383186},
  "mexico city": {lat:19.432608, lng:-99.133209},
  "sao paulo": {lat:-23.550520, lng:-46.633308},
  "rio de janeiro": {lat:-22.906847, lng:-43.172896},
  "cape town": {lat:-33.924869, lng:18.424055},
  "johannesburg": {lat:-26.204103, lng:28.047305},
  "moscow": {lat:55.755825, lng:37.617298},
  "kyiv": {lat:50.450100, lng:30.523400},
  "istanbul": {lat:41.008237, lng:28.97836},
  "madrid": {lat:40.416775, lng:-3.703790},
  "rome": {lat:41.902782, lng:12.496366},
  "berlin": {lat:52.520008, lng:13.404954},
  "amsterdam": {lat:52.367573, lng:4.904139},
  "zurich": {lat:47.376887, lng:8.541694},
  "dublin": {lat:53.349805, lng:-6.26031},
  "lisbon": {lat:38.722252, lng:-9.139337},
  "athens": {lat:37.98381, lng:23.727539},
  "bangkok": {lat:13.756331, lng:100.501762},
  "manila": {lat:14.599512, lng:120.984222},
  "ho chi minh city": {lat:10.823099, lng:106.629662},
  "tehran": {lat:35.689197, lng:51.388974},
  "riyadh": {lat:24.713552, lng:46.675297},
  "tel aviv": {lat:32.085300, lng:34.781768},
  "jerusalem": {lat:31.768319, lng:35.21371},
  "taipei": {lat:25.033964, lng:121.564468},
  "auckland": {lat:-36.84846, lng:174.763332},
  "wellington": {lat:-41.286461, lng:174.776230},
  "honolulu": {lat:21.306944, lng:-157.858337},
  "anchorage": {lat:61.218056, lng:-149.900284},
  "helsinki": {lat:60.1699, lng:24.9384}
};

/* ===========================
   Error handlers
   =========================== */
window.onerror = function(msg, url, line, col, err) {
  console.error("Global error:", { msg, url, line, col, err });
};
window.addEventListener('unhandledrejection', ev => {
  console.error('Unhandled promise rejection', ev.reason);
});

/* ===========================
   CLUSTER STATS HELPER
   =========================== */
function getClusterStats(cluster) {
  const children = cluster.getAllChildMarkers ? cluster.getAllChildMarkers() : [];
  const counts = { critical:0, high:0, medium:0, low:0 };
  let maxSeverity = 0;
  children.forEach(m => {
    const s = Number(m.options && m.options.severity ? m.options.severity : (m.severity || 1));
    if (s >= 5) { counts.critical++; maxSeverity = Math.max(maxSeverity, 5); }
    else if (s >= 4) { counts.high++; maxSeverity = Math.max(maxSeverity, 4); }
    else if (s === 3) { counts.medium++; maxSeverity = Math.max(maxSeverity, 3); }
    else { counts.low++; maxSeverity = Math.max(maxSeverity, 1); }
  });
  return { counts, maxSeverity, childrenCount: children.length };
}

/* ===========================
   PERSISTENCE HELPERS
   =========================== */
function persistVotes() {
  try { localStorage.setItem('os_v1_votes', JSON.stringify(VOTES_LOCAL)); } catch(e){}
}
function persistVoteQueue(){ try { localStorage.setItem('os_v1_vote_queue', JSON.stringify(VOTE_QUEUE)); } catch(e){} }

/* ===========================
   ADMIN SECRET HELPER
   =========================== */
function adminGetSecret() {
  try {
    const session = (typeof sessionStorage !== 'undefined') ? (sessionStorage.getItem('admin_secret') || '') : '';
    return ADMIN_SECRET || session || '';
  } catch(e) { return ADMIN_SECRET || ''; }
}

/* ===========================
   VOTING (optimistic + queue)
   =========================== */
async function sendVoteToServer(payload) {
  // Try public endpoint first, then authenticated endpoint
  try {
    const endpoints = [
      `${WORKER_URL}/api/thumb/public`,
      `${WORKER_URL}/api/thumb`
    ];
    for (let i=0;i<endpoints.length;i++){
      const url = endpoints[i];
      try {
        const headers = { 'Content-Type':'application/json' };
        const body = JSON.stringify({ id: payload.id, vote: payload.vote, ts: payload.ts || new Date().toISOString() });
        const res = await fetch(url, { method: 'POST', headers, body });
        if (res.ok) return { ok:true, status: res.status };
        // If 403 and we have ADMIN secret, try authenticated
        if (res.status === 403) {
          const secret = adminGetSecret();
          if (secret) {
            const res2 = await fetch(`${WORKER_URL}/api/thumb`, { method:'POST', headers: { 'Content-Type':'application/json', 'secret': secret }, body });
            if (res2.ok) return { ok:true, status: res2.status };
            else return { ok:false, status: res2.status, text: await res2.text().catch(()=>'') };
          }
        }
        // For other status codes, return not ok
        const t = await res.text().catch(()=>'');
        return { ok:false, status: res.status, text:t };
      } catch(sendErr) {
        // network error, try next endpoint or queue
        if (i === endpoints.length - 1) return { ok:false, err: sendErr };
        else continue;
      }
    }
    return { ok:false, err:'no-endpoints' };
  } catch(e) { return { ok:false, err:e }; }
}

async function enqueueVote(payload) {
  try {
    VOTE_QUEUE.push(payload);
    persistVoteQueue();
  } catch(e){}
}

async function flushVoteQueue() {
  if (!VOTE_QUEUE || !VOTE_QUEUE.length) return;
  const copy = VOTE_QUEUE.slice();
  for (let i=0;i<copy.length;i++){
    const p = copy[i];
    try {
      const r = await sendVoteToServer(p);
      if (r.ok) {
        // remove first match
        const idx = VOTE_QUEUE.findIndex(q => q.id === p.id && q.ts === p.ts && q.vote === p.vote);
        if (idx >= 0) VOTE_QUEUE.splice(idx, 1);
        persistVoteQueue();
      } else {
        // keep queued
        console.warn('Queued vote still not accepted', p, r);
      }
    } catch(e) {
      console.warn('flushVoteQueue error', e);
    }
  }
}

function applyVoteUIForId(id, vote) {
  try {
    const sel = `[data-id="${escapeAttr(id)}"]`;
    document.querySelectorAll(sel).forEach(btn => {
      btn.classList.remove('voted-up','voted-down');
      if (vote === 'up' && btn.getAttribute('data-vote') === 'up') btn.classList.add('voted-up');
      if (vote === 'down' && btn.getAttribute('data-vote') === 'down') btn.classList.add('voted-down');
    });
  } catch(e){}
}

function markVoteAcceptedLocally(id, vote) {
  try {
    VOTES_LOCAL[id] = vote;
    persistVotes();
    applyVoteUIForId(id, vote);
  } catch(e){}
}

async function voteThumb(id, vote) {
  if (!id || !vote) return;
  markVoteAcceptedLocally(id, vote);
  const payload = { id: String(id), vote: vote, ts: new Date().toISOString() };
  try {
    const res = await sendVoteToServer(payload);
    if (res.ok) {
      // fine, flush queue
      setTimeout(() => { flushVoteQueue(); }, 2500);
      return;
    } else {
      await enqueueVote(payload);
      adminSetFeedback('Vote queued (will retry).', false);
    }
  } catch(e) {
    await enqueueVote(payload);
    adminSetFeedback('Vote queued (network).', true);
  }
}

/* periodic flush attempt */
setInterval(() => { try { flushVoteQueue(); } catch(e){} }, 30_000);

/* ===========================
   MAP INITIALISATION
   =========================== */
function initMap() {
  if (typeof L === 'undefined') {
    console.warn('Leaflet not loaded');
    return;
  }

  const southWest = L.latLng(-85, -179.999);
  const northEast = L.latLng(85, 179.999);
  const bounds = L.latLngBounds(southWest, northEast);

  map = L.map('map', {
    scrollWheelZoom: false,
    zoomControl: false,
    attributionControl: true,
    minZoom: 2,
    maxZoom: 19,
    maxBounds: bounds,
    maxBoundsViscosity: 1.0,
    worldCopyJump: false
  }).setView([20,0], 2);

  L.control.zoom({ position: 'topleft' }).addTo(map);

  const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles © Esri — Esri, USGS, NOAA', noWrap:true, bounds, keepBuffer:2
  });
  const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    subdomains:'abcd', maxZoom:19, noWrap:true, bounds, attribution: '&copy; OpenStreetMap &copy; CARTO', keepBuffer:2
  });

  let esriErrors = 0, ERROR_THRESHOLD = 12;
  esriLayer.on('tileerror', () => {
    esriErrors++;
    if (esriErrors >= ERROR_THRESHOLD && map.hasLayer(esriLayer)) {
      map.removeLayer(esriLayer);
      cartoLayer.addTo(map);
      console.warn('Switched to Carto basemap due to Esri errors.');
    }
  });
  esriLayer.addTo(map);

  assetsLayer = L.layerGroup(); map.addLayer(assetsLayer);

  incidentClusterGroup = L.markerClusterGroup({
    chunkedLoading:true,
    spiderfyOnMaxZoom:true,
    showCoverageOnHover:false,
    disableClusteringAtZoom: 13,
    maxClusterRadius: 50,
    zoomToBoundsOnClick: !('ontouchstart' in window)
  });

  incidentClusterGroup.options.iconCreateFunction = function(cluster) {
    const { counts, maxSeverity, childrenCount } = getClusterStats(cluster);
    let cls = 'cluster-blue';
    if (counts.critical + counts.high > 0) cls = counts.critical > 0 ? 'cluster-red' : 'cluster-amber';
    if (maxSeverity >= 4) cls = 'cluster-red';
    else if (maxSeverity === 3) cls = 'cluster-amber';
    const ariaLabel = escapeAttr(`Cluster of ${childrenCount} incidents. ${counts.critical} Critical, ${counts.high} High.`);
    const html = `<div class="cluster-icon ${cls}" tabindex="0" role="button" aria-label="${ariaLabel}"><div class="cluster-count">${childrenCount}</div></div>`;
    return L.divIcon({ html, className:'', iconSize:[40,40], iconAnchor:[20,20] });
  };

  incidentClusterGroup.on('clustermouseover', (e) => {
    clearTimeout(window._clusterHoverTimeout);
    window._clusterHoverTimeout = setTimeout(() => {
      const { counts, childrenCount } = getClusterStats(e.layer);
      const summary = `<b>Cluster: ${childrenCount} Incidents</b><br/>` +
        (counts.critical ? `<span style="color:#d93025">Critical: ${counts.critical}</span><br/>` : '') +
        (counts.high ? `<span style="color:#d93025">High: ${counts.high}</span><br/>` : '') +
        (counts.medium ? `<span style="color:#f9ab00">Medium: ${counts.medium}</span><br/>` : '') +
        (counts.low ? `<span style="color:#1a73e8">Low: ${counts.low}</span>` : '');
      L.popup({ closeButton:false, offset:[0,-10], className:'map-tooltip' })
        .setLatLng(e.layer.getLatLng())
        .setContent(summary)
        .openOn(map);
    }, 80);
  });
  incidentClusterGroup.on('clustermouseout', () => { clearTimeout(window._clusterHoverTimeout); map.closePopup(); });

  map.addLayer(incidentClusterGroup);

  criticalLayerGroup = L.layerGroup(); map.addLayer(criticalLayerGroup);
}

/* ===========================
   CLOCKS
   =========================== */
function startClock() {
  const container = document.getElementById('multi-clock-container');
  const zones = [
    { label:'Austin', z:'America/Chicago'},
    { label:'Ireland', z:'Europe/Dublin'},
    { label:'India', z:'Asia/Kolkata'},
    { label:'Singapore', z:'Asia/Singapore'},
    { label:'Tokyo', z:'Asia/Tokyo'},
    { label:'Sydney', z:'Australia/Sydney'}
  ];
  if (container && !container.innerHTML) {
    container.innerHTML = zones.map(z => `<div class="clock-box"><div class="clock-label">${escapeHtml(z.label)}</div><div class="clock-val" id="clk-${escapeAttr(z.label)}">--:--</div></div>`).join('');
  }
  setInterval(() => {
    const now = new Date();
    zones.forEach(z => {
      const el = document.getElementById(`clk-${z.label}`);
      if (el) el.textContent = now.toLocaleTimeString('en-US', { timeZone: z.z, hour12:false, hour:'2-digit', minute:'2-digit' });
    });
  }, 1000);
}

/* ===========================
   NORMALISATION
   =========================== */
function normaliseWorkerIncident(item) {
  try {
    if (!item || !item.title) return null;
    const title = safeStr(item.title || '').trim();
    if (!title) return null;

    let lat = parseCoord(item.lat);
    let lng = parseCoord(item.lng !== undefined ? item.lng : item.lon);

    // Try to resolve coordinates from city/country if lat/lng invalid
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001)) {
      const locRaw = safeStr(item.location || item.city || item.country).toLowerCase();
      if (locRaw) {
        const key = locRaw.split(',')[0].trim();
        if (key && CITY_COORDS[key]) {
          lat = CITY_COORDS[key].lat; lng = CITY_COORDS[key].lng;
        } else if (key && COUNTRY_COORDS[key]) {
          lat = COUNTRY_COORDS[key].lat; lng = COUNTRY_COORDS[key].lng;
        } else {
          // Try to match by contains
          for (const [k,v] of Object.entries(CITY_COORDS)) {
            if (key.includes(k) || k.includes(key)) { lat = v.lat; lng = v.lng; break; }
          }
        }
      }
    }

    if (!Number.isFinite(lat)) lat = 0;
    if (!Number.isFinite(lng)) lng = 0;

    const severity = Math.max(1, Number(item.severity || item.sev || item.level || 1));
    const region = normalizeRegion(item.region || item.region_code || item.region_name || item.area || 'Global');

    return {
      id: generateId(item),
      title,
      summary: safeStr(item.summary || item.description || ''),
      link: safeStr(item.link || item.url || '#'),
      time: safeStr(item.time || item.ts || new Date().toISOString()),
      severity,
      region,
      country: safeStr(item.country || '').toUpperCase(),
      location: safeStr(item.location || item.city || ''),
      lat,
      lng,
      source: safeStr(item.source || item.source_name || ''),
      distance_km: (item.distance_km != null) ? Number(item.distance_km) : null,
      nearest_site_name: item.nearest_site_name || item.nearest_site || null,
      country_wide: !!item.country_wide,
      category: safeStr(item.category || item.type || 'UNKNOWN').toUpperCase()
    };
  } catch(e) {
    console.error('normaliseWorkerIncident error', e, item);
    return null;
  }
}

/* ===========================
   FETCH HELPERS
   =========================== */
async function fetchWithTimeout(url, opts={}, timeout=15000) {
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally { clearTimeout(id); }
}

/* ===========================
   LOAD DATA FROM WORKER
   =========================== */
async function loadFromWorker(silent=false) {
  const label = document.getElementById('feed-status-label');
  if (label && !silent) label.textContent = 'Refreshing…';
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/incidents`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : [];
    const cutoff = Date.now() - (48 * 3600 * 1000);
    INCIDENTS = arr.map(normaliseWorkerIncident).filter(Boolean).filter(i => {
      try {
        const t = new Date(i.time).getTime();
        return !isNaN(t) && t >= cutoff;
      } catch(e) { return false; }
    });
    INCIDENTS.sort((a,b) => new Date(b.time) - new Date(a.time));
    FEED_IS_LIVE = true;
    if (label) label.textContent = `LIVE • ${INCIDENTS.length} ITEMS`;
  } catch(e) {
    console.error('loadFromWorker failed', e);
    FEED_IS_LIVE = false;
    if (label && !silent) label.textContent = 'OFFLINE • Worker unreachable';
  }
}

async function loadProximityFromWorker(silent=false) {
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/proximity`);
    if (!res.ok) {
      if (!silent) console.warn('Proximity endpoint returned', res.status);
      return;
    }
    const json = await res.json();
    const list = Array.isArray(json.incidents) ? json.incidents : [];
    const cutoff = Date.now() - (48*3600*1000);
    PROXIMITY_INCIDENTS = list.map(normaliseWorkerIncident).filter(Boolean).filter(i => {
      try { const t = new Date(i.time).getTime(); return !isNaN(t) && t >= cutoff; } catch(e) { return false; }
    });
    if (!silent) console.log('Loaded proximity items:', PROXIMITY_INCIDENTS.length);
  } catch(e) {
    console.error('loadProximityFromWorker failed', e);
  }
}

/* ===========================
   RENDERING - ASSETS
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

  // LATAM
  { name: "Dell Hortolândia Mfg", country: "BR", region: "LATAM", lat: -22.8583, lon: -47.2208 },
  { name: "Dell São Paulo", country: "BR", region: "LATAM", lat: -23.5505, lon: -46.6333 },
  { name: "Dell Porto Alegre", country: "BR", region: "LATAM", lat: -30.0346, lon: -51.2177 },
  { name: "Dell Panama City", country: "PA", region: "LATAM", lat: 8.9824, lon: -79.5199 },

  // EMEA
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

  // APJC
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
DELL_SITES.forEach(s => ASSETS[s.name.toLowerCase()] = { name: s.name, lat: Number(s.lat), lng: Number(s.lon), region: s.region, country: s.country });

function renderAssetsOnMap(region) {
  if (!assetsLayer || !map) return;
  assetsLayer.clearLayers();
  const assets = Object.values(ASSETS);
  const filtered = (region === 'Global') ? assets : assets.filter(a => a.region === region);
  filtered.forEach(a => {
    try {
      const marker = L.marker([Number(a.lat), Number(a.lng)], {
        icon: L.divIcon({
          className:'custom-pin',
          html: '<div class="marker-pin-dell"><i class="fas fa-building" aria-hidden="true"></i></div>',
          iconSize:[30,42], iconAnchor:[15,42]
        })
      });
      marker.bindTooltip(escapeHtml(a.name), { className:'map-tooltip', direction:'top' });
      assetsLayer.addLayer(marker);
    } catch(e){}
  });

  // debug overlay
  if (DEBUG_UI) {
    const dbg = document.getElementById('assets-debug');
    if (dbg) {
      dbg.style.display = 'block';
      dbg.innerHTML = `<div style="font-weight:700">Map asset diagnostics</div><div>Assets: ${assets.length} (filtered ${filtered.length})</div><pre>${filtered.slice(0,10).map(x => `${x.name} ${x.region} ${x.lat},${x.lng}`).join('\n')}</pre>`;
    }
  }
}

/* ===========================
   MAP: INCIDENTS (only proximity + high/critical)
   =========================== */
function renderIncidentsOnMap(region, list) {
  if (!incidentClusterGroup || !criticalLayerGroup || !map) return;
  incidentClusterGroup.clearLayers();
  criticalLayerGroup.clearLayers();

  // Build map-of-ids we must display:
  //  - All proximity incidents in this region
  //  - All incidents with severity >= 4 in this region
  const mustShow = new Map();

  // add proximity incidents
  (PROXIMITY_INCIDENTS || []).forEach(i => {
    if (!i) return;
    const r = normalizeRegion(i.region);
    if (region === 'Global' || r === region) mustShow.set(generateId(i), i);
  });

  // add critical/high incidents
  (list || []).forEach(i => {
    try {
      if (!i) return;
      const r = normalizeRegion(i.region);
      if (!(region === 'Global' || r === region)) return;
      const sev = Number(i.severity || 1);
      if (sev >= 4) mustShow.set(generateId(i), i);
    } catch(e){}
  });

  // Render each selected incident
  for (const [id, i] of mustShow.entries()) {
    try {
      let coords = null;
      if (Number.isFinite(Number(i.lat)) && Number.isFinite(Number(i.lng)) && Math.abs(Number(i.lat)) > 0.0001 && Math.abs(Number(i.lng)) > 0.0001) {
        coords = { lat: Number(i.lat), lng: Number(i.lng) };
      } else {
        coords = getCoordsForIncident(i);
      }
      if (!coords) continue;
      const sev = Number(i.severity || 1);
      const color = (sev >= 5) ? '#d93025' : (sev >= 4 ? '#d93025' : (sev === 3 ? '#f9ab00' : '#1a73e8'));

      const marker = L.marker([coords.lat, coords.lng], {
        severity: sev,
        icon: L.divIcon({
          html: `<div class="incident-dot" style="background:${color}"></div>`,
          className:'', iconSize:[12,12], iconAnchor:[8,8]
        })
      });

      const popupHtml = `<b>${escapeHtml(i.title)}</b><br>${escapeHtml(safeTime(i.time))}<br/><a href="${escapeAttr(safeHref(i.link))}" target="_blank" rel="noopener noreferrer">Source</a>`;
      marker.bindPopup(popupHtml);

      if (sev >= 4) criticalLayerGroup.addLayer(marker);
      else incidentClusterGroup.addLayer(marker);

    } catch(e) { console.warn('render incident error', e, i); }
  }

  try { criticalLayerGroup.bringToFront(); } catch(e){}
}

/* ===========================
   RENDER FEED (list)
   =========================== */
function mapSeverityToLabel(s) {
  const n = Number(s || 1);
  if (n >= 5) return { label:'CRITICAL', badgeClass:'ftag-crit', barClass:'status-bar-crit' };
  if (n >= 4) return { label:'HIGH', badgeClass:'ftag-crit', barClass:'status-bar-crit' };
  if (n === 3) return { label:'MEDIUM', badgeClass:'ftag-warn', barClass:'status-bar-warn' };
  return { label:'LOW', badgeClass:'ftag-info', barClass:'status-bar-info' };
}

function renderGeneralFeed(region) {
  const container = document.getElementById('general-news-feed');
  if (!container) return;
  const data = (region === 'Global') ? INCIDENTS : INCIDENTS.filter(i => normalizeRegion(i.region) === region);
  if (!data || data.length === 0) {
    container.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">No incidents for this region.</div>`;
    return;
  }

  let html = '';
  data.forEach(i => {
    const sev = mapSeverityToLabel(i.severity);
    const id = generateId(i);
    const localVote = VOTES_LOCAL[id] || null;
    html += `
      <div class="feed-card" role="article" data-link="${escapeAttr(safeHref(i.link))}" tabindex="0">
        <div class="feed-status-bar ${sev.barClass}"></div>
        <div class="feed-content">
          <div class="feed-tags">
            <span class="ftag ${sev.badgeClass}">${escapeHtml(sev.label)}</span>
            <span class="ftag ftag-loc">${escapeHtml((i.country||"GLOBAL").toUpperCase())}</span>
            <span class="ftag ftag-type">${escapeHtml(i.category || 'UNKNOWN')}</span>
            <span class="feed-region">${escapeHtml(i.region || 'Global')}</span>
          </div>
          <div class="feed-title"><a href="${escapeAttr(safeHref(i.link))}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">${escapeHtml(i.title)}</a></div>
          <div class="feed-meta">${escapeHtml(safeTime(i.time))} • ${escapeHtml(i.source || 'Source')}</div>
          <div class="feed-desc">${escapeHtml(i.summary || '')}</div>
          <div class="vote-row" aria-label="Vote buttons">
            <button type="button" class="btn-vote ${localVote === 'up' ? 'voted-up' : ''}" data-action="vote" data-vote="up" data-id="${escapeAttr(id)}" aria-label="Vote up" title="Helpful"><i class="fas fa-thumbs-up" aria-hidden="true"></i></button>
            <button type="button" class="btn-vote ${localVote === 'down' ? 'voted-down' : ''}" data-action="vote" data-vote="down" data-id="${escapeAttr(id)}" aria-label="Vote down" title="Not relevant"><i class="fas fa-thumbs-down" aria-hidden="true"></i></button>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

/* ===========================
   PROXIMITY ALERTS
   =========================== */
function updateProximityRadius() {
  const el = document.getElementById('proxRadius');
  if (el) currentRadius = parseFloat(el.value) || 50;
  const active = document.querySelector('.nav-item-custom.active');
  renderProximityAlerts(active ? active.textContent.trim() : 'Global');
}

function renderProximityAlerts(region) {
  const container = document.getElementById('proximity-alerts-container');
  if (!container) return;
  const data = (region === 'Global') ? PROXIMITY_INCIDENTS : PROXIMITY_INCIDENTS.filter(i => normalizeRegion(i.region) === region);

  const alerts = [];
  data.forEach(inc => {
    try {
      const coords = (Number.isFinite(Number(inc.lat)) && Number.isFinite(Number(inc.lng))) ? { lat:Number(inc.lat), lng:Number(inc.lng) } : getCoordsForIncident(inc);
      if (!coords) return;
      const key = generateId(inc);
      if (DISMISSED_ALERT_IDS.has(String(key))) return;

      let nearest = null;
      if ((inc.distance_km != null) && inc.nearest_site_name) {
        nearest = { dist: Number(inc.distance_km), name: inc.nearest_site_name };
      } else {
        for (const asset of Object.values(ASSETS)) {
          const d = haversineKm(coords.lat, coords.lng, asset.lat, asset.lng);
          if (!nearest || d < nearest.dist) nearest = { dist: d, name: asset.name };
        }
      }
      if (!nearest) return;
      if (inc.country_wide || nearest.dist <= currentRadius) alerts.push({ inc, nearest, key });
    } catch(e){}
  });

  alerts.sort((a,b) => a.nearest.dist - b.nearest.dist);

  if (!alerts.length) {
    container.innerHTML = `<div style="padding:15px;text-align:center;color:#999;">No threats within ${currentRadius}km.</div>`;
    return;
  }

  container.innerHTML = alerts.slice(0,25).map(a => {
    const i = a.inc;
    const sev = Number(i.severity || 1);
    const color = sev >= 4 ? '#d93025' : (sev === 3 ? '#f9ab00' : '#1a73e8');
    const distStr = i.country_wide ? `Country-wide` : `${Math.round(a.nearest.dist)}km`;
    return `
      <div class="alert-row">
        <div class="alert-top">
          <div class="alert-type">
            <i class="fas fa-exclamation-circle" style="color:${color};" aria-hidden="true"></i>
            ${escapeHtml(i.title)}
          </div>
          <div class="alert-dist" style="color:${color}">${escapeHtml(distStr)}</div>
        </div>
        <div class="alert-site">Near: <b>${escapeHtml(a.nearest.name)}</b></div>
        <div class="alert-desc">${escapeHtml(i.summary)}</div>
        <div class="alert-actions">
          <button type="button" class="btn-dismiss" data-action="dismiss-alert" data-id="${escapeAttr(a.key)}" aria-label="Dismiss this alert">Dismiss</button>
        </div>
      </div>
    `;
  }).join('');
}

/* ===========================
   HEADLINE UPDATE
   =========================== */
function updateHeadline(region) {
  const data = (region === 'Global') ? INCIDENTS : INCIDENTS.filter(i => normalizeRegion(i.region) === region);
  const el = document.getElementById('headline-alert');
  const tags = document.getElementById('headline-tags');
  if (!el || !tags) return;
  if (data.length) {
    el.textContent = data[0].title || 'Headline';
    const sev = mapSeverityToLabel(data[0].severity);
    tags.innerHTML = `
      <span class="tag tag-crit" style="background:${(Number(data[0].severity||1) >= 4) ? '#d93025' : '#5f6368'}">${escapeHtml(sev.label)}</span>
      <span class="tag tag-cat">${escapeHtml(data[0].category || 'CATEGORY')}</span>
      <span class="tag tag-reg">${escapeHtml(data[0].region || 'REGION')}</span>
    `;
  } else {
    el.textContent = 'No critical alerts.';
    tags.innerHTML = '';
  }
}

/* ===========================
   REPORTING / BRIEFS
   =========================== */
async function previewBriefing() {
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
  const fb = document.getElementById('preview-feedback');
  const cont = document.getElementById('briefing-preview');
  if (fb) { fb.style.display = 'block'; fb.textContent = 'Generating preview…'; }
  if (cont) cont.innerHTML = '';
  try {
    let url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}`;
    if (date) url += `&date=${encodeURIComponent(date)}`;
    const res = await fetchWithTimeout(url, {}, 20000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const incidents = json.incidents || [];
    if (!incidents.length) {
      cont.innerHTML = `<div class="safe-box"><i class="fas fa-check-circle safe-icon" aria-hidden="true"></i><div class="safe-text">No incidents found for this period.</div></div>`;
    } else {
      cont.innerHTML = incidents.slice(0,50).map(i => `
        <div style="border-bottom:1px solid #eee;padding:8px 0;">
          <div style="font-weight:700;font-size:0.95rem">${escapeHtml(i.title)}</div>
          <div style="font-size:0.8rem;color:#666">${escapeHtml(i.country||'')} • ${escapeHtml(safeTime(i.time))}</div>
          <div style="font-size:0.85rem;color:#333;margin-top:4px;">${escapeHtml(i.summary||'')}</div>
        </div>
      `).join('');
    }
    if (fb) fb.style.display = 'none';
  } catch(e) {
    if (fb) { fb.style.display = 'block'; fb.textContent = `Error: ${e.message}`; }
  }
}
function downloadReport() {
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
  let url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}&download=true`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  window.open(url, '_blank', 'noopener');
}

/* ===========================
   HISTORY LOAD
   =========================== */
async function loadHistory(dateStr) {
  const status = document.getElementById('history-status');
  if (status) status.textContent = 'Loading archive…';
  try {
    const res = await fetch(`${WORKER_URL}/api/archive?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.json();
    if (!status) return;
    if (!arr || !arr.length) {
      status.textContent = 'No archived incidents found.';
      return;
    }
    status.innerHTML = `<div style="max-height:300px;overflow:auto;margin-top:10px;">` + arr.map(i => `<div style="margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px;"><strong>${escapeHtml(i.title)}</strong><br><span style="font-size:0.8rem;color:#666">${escapeHtml(i.country||'')}</span></div>`).join('') + `</div>`;
  } catch(e) {
    if (status) status.textContent = `Archive error: ${e.message}`;
  }
}

/* ===========================
   TRAVEL: Load & Filter (with fallback news)
   =========================== */
async function loadTravelAdvisories() {
  const sel = document.getElementById('countrySelect');
  if (!sel) return;
  sel.innerHTML = `<option selected disabled>Loading advisories...</option>`;
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/traveladvisories/live`, {}, 12000);
    if (res && res.ok) {
      const data = await res.json();
      TRAVEL_DATA = Array.isArray(data) ? data : [];
      TRAVEL_UPDATED_AT = (data && data.updated_at) ? data.updated_at : new Date().toISOString();
    }
  } catch(e) {
    console.warn('loadTravelAdvisories worker/live failed', e);
  }
  // populate with safe world list (from COUNTRY_COORDS keys)
  const countries = Object.keys(COUNTRY_COORDS).map(c => c.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
  sel.innerHTML = `<option selected disabled>Select Country...</option>` + countries.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
}

/* helper: derive travel news if worker doesn't return news */
function getTravelNewsForCountry(countryName, topn=5) {
  if (!countryName) return [];
  const cn = countryName.toLowerCase();
  // find incidents matching country or city
  const hits = INCIDENTS.filter(i => {
    if (!i) return false;
    const country = safeStr(i.country).toLowerCase();
    const loc = safeStr(i.location).toLowerCase();
    const title = safeStr(i.title).toLowerCase();
    if (country && country.includes(cn)) return true;
    if (loc && loc.includes(cn)) return true;
    if (title && title.includes(cn)) return true;
    return false;
  });
  return hits.slice(0, topn).map(h => ({ title: h.title, summary: h.summary }));
}

async function filterTravel() {
  const country = document.getElementById('countrySelect')?.value || '';
  const cont = document.getElementById('travel-advisories');
  const newsCont = document.getElementById('travel-news');
  if (cont) cont.innerHTML = 'Loading…';
  if (newsCont) newsCont.innerHTML = '';
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/traveladvisories?country=${encodeURIComponent(country)}`, {}, 12000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const adv = data.advisory || data || {};
    const level = Number(adv.level || adv.risk_level || 1);
    const badgeColor = (level >= 4) ? '#d93025' : (level === 3 ? '#f9ab00' : '#1a73e8');
    if (cont) cont.innerHTML = `
      <div class="advisory-box">
        <div class="advisory-header">
          <div class="advisory-label">OFFICIAL ADVISORY</div>
          <div class="advisory-level-badge" style="background:${badgeColor};">LEVEL ${escapeHtml(String(level))}</div>
        </div>
        <div class="advisory-text">${escapeHtml(adv.text || adv.advice || adv.summary || 'No major advisory.')}</div>
        <div class="advisory-updated">Updated: ${escapeHtml(adv.updated || TRAVEL_UPDATED_AT || 'Unknown')}</div>
      </div>
    `;
    // news: worker may return data.news or recent_incidents
    const news = Array.isArray(data.news) ? data.news : (Array.isArray(data.recent_incidents) ? data.recent_incidents : []);
    if ((!news || !news.length)) {
      // fallback to derive from incidents
      const fallback = getTravelNewsForCountry(country, 5);
      if (fallback && fallback.length) {
        newsCont.innerHTML = `<div class="news-box-alert"><div class="news-box-header">RELATED NEWS</div>${fallback.map(n => `<div class="news-box-item"><div class="news-box-title">${escapeHtml(n.title || '')}</div><div class="news-box-summary">${escapeHtml(n.summary || '')}</div></div>`).join('')}</div>`;
      } else {
        newsCont.innerHTML = '';
      }
    } else {
      newsCont.innerHTML = `<div class="news-box-alert"><div class="news-box-header">RELATED NEWS</div>${news.slice(0,5).map(n => `<div class="news-box-item"><div class="news-box-title">${escapeHtml(n.title || '')}</div><div class="news-box-summary">${escapeHtml(n.summary || '')}</div></div>`).join('')}</div>`;
    }
  } catch(e) {
    if (cont) cont.innerHTML = `<div class="safe-box"><i class="fas fa-info-circle safe-icon" aria-hidden="true"></i><div class="safe-text">Advisory unavailable.</div></div>`;
  }
}

/* ===========================
   MAP COORDS FALLBACK
   =========================== */
function getCoordsForIncident(i) {
  try {
    if (!i) return null;
    const lat = parseCoord(i.lat);
    const lng = parseCoord(i.lng !== undefined ? i.lng : i.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.0001 && Math.abs(lng) > 0.0001) return { lat, lng };

    const locRaw = safeStr(i.location || i.city || '').toLowerCase();
    if (locRaw) {
      const key = locRaw.split(',')[0].trim();
      if (key && CITY_COORDS[key]) return { lat: CITY_COORDS[key].lat, lng: CITY_COORDS[key].lng };
      for (const k of Object.keys(CITY_COORDS)) {
        if (key.includes(k) || k.includes(key)) return { lat: CITY_COORDS[k].lat, lng: CITY_COORDS[k].lng };
      }
    }

    const countryRaw = safeStr(i.country || '').toLowerCase();
    if (countryRaw) {
      const cut = countryRaw.split(',')[0].trim();
      if (COUNTRY_COORDS[cut]) return { lat: COUNTRY_COORDS[cut].lat, lng: COUNTRY_COORDS[cut].lng };
      // try two-letter codes
      for (const s of DELL_SITES) {
        if ((s.country || '').toLowerCase() === cut || (s.country || '').toLowerCase() === countryRaw) return { lat: s.lat, lng: s.lon };
      }
    }
    return null;
  } catch(e) { return null; }
}

/* ===========================
   UTIL: haversine for distance (km)
   =========================== */
function haversineKm(lat1,lon1,lat2,lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ===========================
   ADMIN HELPERS & ACTIONS
   =========================== */
function adminSetFeedback(msg, isError=false) {
  const fb = document.getElementById('adminFeedback');
  if (!fb) return;
  fb.style.display = 'block';
  fb.className = isError ? 'alert alert-danger mt-3' : 'alert alert-success mt-3';
  fb.textContent = String(msg || '');
}

function adminGetSecretFromField() {
  try {
    const fld = document.getElementById('adminSecret');
    const remember = document.getElementById('adminRememberSession');
    const val = fld ? String(fld.value || '').trim() : '';
    if (remember && remember.checked) {
      try { sessionStorage.setItem('admin_secret', val); } catch(e){}
    } else {
      try { sessionStorage.removeItem('admin_secret'); } catch(e){}
    }
    ADMIN_SECRET = val;
    return val;
  } catch(e) { return ''; }
}

function adminSaveSecret() {
  const sec = adminGetSecretFromField();
  if (sec) adminSetFeedback('Admin secret saved (in-memory).');
  else adminSetFeedback('Secret cannot be empty.', true);
}

function adminClearSecret() {
  try { sessionStorage.removeItem('admin_secret'); } catch(e){}
  ADMIN_SECRET = '';
  const fld = document.getElementById('adminSecret');
  if (fld) fld.value = '';
  adminSetFeedback('Admin secret cleared.');
}

async function adminTriggerIngest() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Triggering ingestion…');
  try {
    const res = await fetch(`${WORKER_URL}/api/ingest`, { method:'POST', headers: { 'secret': sec } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Ingest failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Ingest triggered.');
  } catch(e) { adminSetFeedback('Ingest failed (network).', true); console.error(e); }
}

async function adminUnlock() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Requesting unblock…');
  try {
    const res = await fetch(`${WORKER_URL}/api/thumb/unblock`, { method:'POST', headers:{ 'Content-Type':'application/json', 'secret': sec }, body: JSON.stringify({ unblock:true }) });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Unblock failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Unblock requested.');
  } catch(e) { adminSetFeedback('Unblock failed (network).', true); console.error(e); }
}

async function adminThumbsStatus() {
  const sec = adminGetSecret();
  adminSetFeedback('Loading thumbs status…');
  try {
    const res = await fetch(`${WORKER_URL}/api/thumbs/status`, { headers: { ...(sec ? { 'secret': sec } : {}) } });
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
    const res = await fetch(`${WORKER_URL}/api/traveladvisories/refresh`, { method:'POST', headers: { ...(sec ? { 'secret': sec } : {}) } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Travel refresh failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Travel refresh triggered.');
    try { await loadTravelAdvisories(); } catch(e){}
  } catch(e) { adminSetFeedback('Travel refresh failed (network).', true); console.error(e); }
}

async function adminGenerateBrief() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
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
   DISMISS ALERT BY ID
   =========================== */
function dismissAlertById(id) {
  try {
    const k = String(id || '').trim();
    if (!k) return;
    DISMISSED_ALERT_IDS.add(k);
    sessionStorage.setItem('dismissed_prox_alert_ids', JSON.stringify(Array.from(DISMISSED_ALERT_IDS).slice(0,500)));
  } catch(e){}
}

/* ===========================
   REFRESH WRAPPER (safe)
   =========================== */
async function manualRefresh() {
  const btn = document.getElementById('btn-refresh');
  const originalText = btn ? btn.innerHTML : 'Refresh';
  if (btn) {
    btn.style.opacity = '0.7';
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    btn.style.pointerEvents = 'none';
  }

  try {
    await Promise.allSettled([
      loadFromWorker(false),
      loadProximityFromWorker(false),
      loadTravelAdvisories()
    ]);
    const active = document.querySelector('.nav-item-custom.active');
    filterNews(active ? active.textContent.trim() : 'Global');
  } catch(e) {
    console.error('manualRefresh error', e);
  } finally {
    if (btn) {
      btn.style.opacity = '1';
      btn.innerHTML = originalText;
      btn.style.pointerEvents = 'auto';
    }
  }
}

/* ===========================
   EVENT DELEGATION & BOOTSTRAP
   =========================== */
document.addEventListener('DOMContentLoaded', async () => {
  // Prefill admin secret from session if present
  try {
    const s = sessionStorage.getItem('admin_secret') || '';
    if (s) {
      ADMIN_SECRET = s;
      const fld = document.getElementById('adminSecret');
      const chk = document.getElementById('adminRememberSession');
      if (fld) fld.value = s;
      if (chk) chk.checked = true;
    }
  } catch(e){}

  // Init map (throw if fails to ensure visible console error)
  initMap();

  // start clocks
  startClock();

  // Delegated click handler for data-action attributes
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const action = String(t.getAttribute('data-action') || '').trim();
    if (!action) return;

    // Prevent anchor navigation for '#'
    if (t.tagName === 'A' && (t.getAttribute('href') === '#' || t.getAttribute('href') === '')) ev.preventDefault();

    // default prevention for actions that stop propagation
    if (['vote','dismiss-alert','admin-save-secret','admin-clear-secret','admin-trigger-ingest','admin-unlock','admin-thumbs-status','admin-force-refresh-travel','admin-generate-brief','admin-list-briefs'].includes(action)) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    switch(action) {
      case 'filter-region':
        document.querySelectorAll('[data-action="filter-region"]').forEach(el => el.classList.remove('active'));
        t.classList.add('active');
        filterNews(t.getAttribute('data-region') || t.textContent.trim());
        break;
      case 'refresh':
        manualRefresh();
        break;
      case 'preview-brief':
        previewBriefing();
        break;
      case 'download-brief':
        downloadReport();
        break;
      case 'vote':
        {
          const id = t.getAttribute('data-id');
          const v = t.getAttribute('data-vote');
          if (id && v) await voteThumb(id, v);
        }
        break;
      case 'dismiss-alert':
        {
          const id = t.getAttribute('data-id');
          if (id) { dismissAlertById(id); }
          const row = t.closest('.alert-row'); if (row) row.remove();
        }
        break;
      // admin actions
      case 'admin-save-secret': adminSaveSecret(); break;
      case 'admin-clear-secret': adminClearSecret(); break;
      case 'admin-trigger-ingest': adminTriggerIngest(); break;
      case 'admin-unlock': adminUnlock(); break;
      case 'admin-thumbs-status': adminThumbsStatus(); break;
      case 'admin-force-refresh-travel': adminForceRefreshTravel(); break;
      case 'admin-generate-brief': adminGenerateBrief(); break;
      case 'admin-list-briefs': adminListBriefs(); break;
      default: break;
    }
  });

  // Clicking feed-card opens link unless clicking an inner control
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.feed-card[data-link]');
    if (!card) return;
    if (e.target.closest('a') || e.target.closest('[data-action]')) return;
    const href = card.getAttribute('data-link');
    if (!href) return;
    try { window.open(href, '_blank', 'noopener'); } catch(e){}
  });

  // wire inputs programmatically (no inline handlers)
  const historyPicker = document.getElementById('history-picker');
  if (historyPicker) historyPicker.addEventListener('change', (ev) => loadHistory(ev.target.value));
  const countrySel = document.getElementById('countrySelect');
  if (countrySel) countrySel.addEventListener('change', filterTravel);
  const proxRad = document.getElementById('proxRadius');
  if (proxRad) proxRad.addEventListener('change', updateProximityRadius);

  // initial loads
  await loadFromWorker();
  await loadProximityFromWorker();
  filterNews('Global');
  await loadTravelAdvisories();

  // apply stored votes from local storage
  Object.keys(VOTES_LOCAL).forEach(k => applyVoteUIForId(k, VOTES_LOCAL[k]));

  // auto refresh interval
  setInterval(async () => {
    if (FEED_IS_LIVE) {
      await loadFromWorker(true);
      await loadProximityFromWorker(true);
      const active = document.querySelector('.nav-item-custom.active');
      filterNews(active ? active.textContent.trim() : 'Global');
    }
  }, AUTO_REFRESH_MS);

  // try flush vote queue soon after load
  setTimeout(() => { try { flushVoteQueue(); } catch(e){} }, 1500);
});

/* ===========================
   FILTER NEWS main entry
   - Ensures canonical region is used
   =========================== */
function filterNews(region) {
  const canonical = normalizeRegion(region);
  try {
    renderAssetsOnMap(canonical);
    renderIncidentsOnMap(canonical, INCIDENTS);
    renderGeneralFeed(canonical);
    updateHeadline(canonical);
    renderProximityAlerts(canonical);
  } catch(e) {
    console.error('filterNews error', e);
  }
}

/* ===========================
   Expose to window for quick debugging
   =========================== */
window.loadTravelAdvisories = loadTravelAdvisories;
window.filterTravel = filterTravel;
window.loadHistory = loadHistory;
window.voteThumb = voteThumb;
window.flushVoteQueue = flushVoteQueue;
window.adminGetSecret = adminGetSecret;
