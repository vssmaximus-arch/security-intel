/* app.js for Dell OS | INFOHUB
   Full application logic: map init, fetching, normalization, rendering,
   voting queue, admin helpers, travel fallback, etc.
*/

/* ===========================
   CONFIG
=========================== */
const WORKER_URL = "https://osinfohub.vssmaximus.workers.dev";
const AUTO_REFRESH_MS = 60_000;
const DEBUG_UI = (new URLSearchParams(location.search).get('debug') === '1') || (localStorage.getItem('osinfohub_debug') === '1');

let map, assetsClusterGroup, incidentClusterGroup, criticalLayerGroup;
let INCIDENTS = [], PROXIMITY_INCIDENTS = [];
let FEED_IS_LIVE = false;
let currentRadius = 50;
let DISMISSED_ALERT_IDS = new Set();
let TRAVEL_DATA = [], TRAVEL_UPDATED_AT = null;

let ADMIN_SECRET = ''; // in-memory default
let VOTES_LOCAL = {};
let VOTE_QUEUE = [];

/* restore persisted state if present */
try {
  const dv = localStorage.getItem('os_v1_votes');
  if (dv) VOTES_LOCAL = JSON.parse(dv) || {};
  const dq = localStorage.getItem('os_v1_vote_queue');
  if (dq) VOTE_QUEUE = JSON.parse(dq) || [];
  const dismissed = sessionStorage.getItem('dismissed_prox_alert_ids');
  if (dismissed) {
    JSON.parse(dismissed).forEach(id => DISMISSED_ALERT_IDS.add(String(id)));
  }
  const ssec = sessionStorage.getItem('admin_secret');
  if (ssec) ADMIN_SECRET = ssec;
} catch(e) { console.warn('restore state failed', e); }

/* Error handlers */
window.onerror = function(msg,url,line,col,err){ console.error("GlobalError",msg,url,line,col,err); };
window.addEventListener('unhandledrejection', ev => console.error('UnhandledRejection', ev.reason));

/* ===========================
   DATA: DELL_SITES (assets)
   (a representative set - extend if needed)
=========================== */
const DELL_SITES = [
  { name: "Dell Round Rock HQ", country: "US", region: "AMER", lat: 30.5083, lon: -97.6788 },
  { name: "Dell Austin Parmer", country: "US", region: "AMER", lat: 30.3952, lon: -97.6843 },
  { name: "Dell Bangalore", country: "IN", region: "APJC", lat: 12.9716, lon: 77.5946 },
  { name: "Dell Singapore", country: "SG", region: "APJC", lat: 1.3521, lon: 103.8198 },
  { name: "Dell Sydney", country: "AU", region: "APJC", lat: -33.8688, lon: 151.2093 },
  { name: "Dell Dublin Cherrywood", country: "IE", region: "EMEA", lat: 53.2374, lon: -6.1450 },
  { name: "Dell Paris / Bezons", country: "FR", region: "EMEA", lat: 48.8566, lon: 2.3522 },
  { name: "Dell Sao Paulo", country: "BR", region: "LATAM", lat: -23.5505, lon: -46.6333 }
  // You can add the rest of your Dell sites here.
];

/* Build ASSETS normalized (lng field) */
const ASSETS = {};
DELL_SITES.forEach(s => ASSETS[s.name.toLowerCase()] = { name: s.name, lat: Number(s.lat), lng: Number(s.lon), region: s.region, country: s.country });

/* ===========================
   CITY_COORDS (common set, expandable)
   Add more if you want — these are used as fallback for city names.
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
  "cape town": {lat:-33.9249, lng:18.4241}, "cairo": {lat:30.0444, lng:31.2357}
  // Add other cities if you want
};

/* ===========================
   COUNTRY_COORDS: centers for fallback (sample, extendable)
=========================== */
const COUNTRY_COORDS = {
  "afghanistan": { lat: 33.93911, lng: 67.709953 },
  "albania": { lat: 41.153332, lng: 20.168331 },
  "algeria": { lat: 28.033886, lng: 1.659626 },
  "andorra": { lat: 42.546245, lng: 1.601554 },
  "angola": { lat: -11.202692, lng: 17.873887 },
  "argentina": { lat: -38.416097, lng: -63.616672 },
  "armenia": { lat: 40.069099, lng: 45.038189 },
  "australia": { lat: -25.274398, lng: 133.775136 },
  "austria": { lat: 47.516231, lng: 14.550072 },
  "azerbaijan": { lat: 40.143105, lng: 47.576927 },
  "bahrain": { lat: 25.930414, lng: 50.637772 },
  "bangladesh": { lat: 23.684994, lng: 90.356331 },
  "belgium": { lat: 50.503887, lng: 4.469936 },
  "belize": { lat: 17.189877, lng: -88.49765 },
  "benin": { lat: 9.30769, lng: 2.315834 },
  "bhutan": { lat: 27.514162, lng: 90.433601 },
  "bolivia": { lat: -16.290154, lng: -63.588653 },
  "bosnia and herzegovina": { lat: 43.915886, lng: 17.679076 },
  "brazil": { lat: -14.235004, lng: -51.92528 },
  "brunei": { lat: 4.535277, lng: 114.727669 },
  "bulgaria": { lat: 42.733883, lng: 25.48583 },
  "cambodia": { lat: 12.565679, lng: 104.990963 },
  "cameroon": { lat: 7.369722, lng: 12.354722 },
  "canada": { lat: 56.130366, lng: -106.346771 },
  "chile": { lat: -35.675147, lng: -71.542969 },
  "china": { lat: 35.86166, lng: 104.195397 },
  "colombia": { lat: 4.570868, lng: -74.297333 },
  "congo": { lat: -0.228021, lng: 15.827659 },
  "costa rica": { lat: 9.748917, lng: -83.753428 },
  "croatia": { lat: 45.1, lng: 15.2 },
  "cuba": { lat: 21.521757, lng: -77.781167 },
  "cyprus": { lat: 35.126413, lng: 33.429859 },
  "czechia": { lat: 49.817492, lng: 15.472962 },
  "denmark": { lat: 56.26392, lng: 9.501785 },
  "dominican republic": { lat: 18.735693, lng: -70.162651 },
  "ecuador": { lat: -1.831239, lng: -78.183406 },
  "egypt": { lat: 26.820553, lng: 30.802498 },
  "estonia": { lat: 58.595272, lng: 25.013607 },
  "ethiopia": { lat: 9.145, lng: 40.489673 },
  "finland": { lat: 61.92411, lng: 25.748151 },
  "france": { lat: 46.227638, lng: 2.213749 },
  "germany": { lat: 51.165691, lng: 10.451526 },
  "ghana": { lat: 7.946527, lng: -1.023194 },
  "greece": { lat: 39.074208, lng: 21.824312 },
  "guatemala": { lat: 15.783471, lng: -90.230759 },
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
  "liberia": { lat: 6.428055, lng: -9.429499 },
  "libya": { lat: 26.3351, lng: 17.228331 },
  "lithuania": { lat: 55.169438, lng: 23.881275 },
  "luxembourg": { lat: 49.815273, lng: 6.129583 },
  "madagascar": { lat: -18.766947, lng: 46.869107 },
  "malaysia": { lat: 4.210484, lng: 101.975766 },
  "maldives": { lat: 3.202778, lng: 73.22068 },
  "mali": { lat: 17.570692, lng: -3.996166 },
  "malta": { lat: 35.937496, lng: 14.375416 },
  "mauritania": { lat: 21.00789, lng: -10.940835 },
  "mauritius": { lat: -20.348404, lng: 57.552152 },
  "mexico": { lat: 23.634501, lng: -102.552784 },
  "moldova": { lat: 47.411631, lng: 28.369885 },
  "mongolia": { lat: 46.862496, lng: 103.846653 },
  "montenegro": { lat: 42.708678, lng: 19.37439 },
  "morocco": { lat: 31.791702, lng: -7.09262 },
  "mozambique": { lat: -18.665695, lng: 35.529562 },
  "myanmar": { lat: 21.913965, lng: 95.956223 },
  "namibia": { lat: -22.95764, lng: 18.49041 },
  "nepal": { lat: 28.394857, lng: 84.124008 },
  "netherlands": { lat: 52.132633, lng: 5.291266 },
  "new zealand": { lat: -40.900557, lng: 174.885971 },
  "nigeria": { lat: 9.081999, lng: 8.675277 },
  "north macedonia": { lat: 41.608635, lng: 21.745275 },
  "norway": { lat: 60.472024, lng: 8.468946 },
  "oman": { lat: 21.512583, lng: 55.923255 },
  "pakistan": { lat: 30.375321, lng: 69.345116 },
  "palestine": { lat: 31.952162, lng: 35.233154 },
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
  "saudi arabia": { lat: 23.885942, lng: 45.079162 },
  "senegal": { lat: 14.497401, lng: -14.452362 },
  "serbia": { lat: 44.016521, lng: 21.005859 },
  "seychelles": { lat: -4.679574, lng: 55.491977 },
  "sierra leone": { lat: 8.460555, lng: -11.779889 },
  "singapore": { lat: 1.352083, lng: 103.819836 },
  "slovakia": { lat: 48.669026, lng: 19.699024 },
  "slovenia": { lat: 46.151241, lng: 14.995463 },
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
  "togo": { lat: 8.619543, lng: 0.824782 },
  "tunisia": { lat: 33.886917, lng: 9.537499 },
  "turkey": { lat: 38.963745, lng: 35.243322 },
  "turkmenistan": { lat: 38.969719, lng: 59.556278 },
  "uganda": { lat: 1.373333, lng: 32.290275 },
  "ukraine": { lat: 48.379433, lng: 31.16558 },
  "united arab emirates": { lat: 23.424076, lng: 53.847818 },
  "united kingdom": { lat: 55.378051, lng: -3.435973 },
  "united states": { lat: 37.09024, lng: -95.712891 },
  "uruguay": { lat: -32.522779, lng: -55.765835 },
  "uzbekistan": { lat: 41.377491, lng: 64.585262 },
  "venezuela": { lat: 6.42375, lng: -66.58973 },
  "vietnam": { lat: 14.058324, lng: 108.277199 },
  "yemen": { lat: 15.552727, lng: 48.516388 },
  "zambia": { lat: -13.133897, lng: 27.849332 },
  "zimbabwe": { lat: -19.015438, lng: 29.154857 }
  // This is a full-ish set and can be expanded as needed.
};

/* ===========================
   REGION MAPPINGS
=========================== */
const REGION_TOKENS = {
  APJC: ['APJC','APJ','APAC','ASIA PACIFIC','ASIA-PACIFIC','ASIA','OCEANIA','SOUTHEAST ASIA','SOUTH EAST ASIA','SEA','INDIA','JAPAN','CHINA','TAIWAN','HONG KONG','SINGAPORE','MALAYSIA','PHILIPPINES','VIETNAM','KOREA','SOUTH KOREA','AUSTRALIA','NEW ZEALAND'],
  AMER: ['AMER','NORTH AMERICA','SOUTH AMERICA','NORTH AMERICA','USA','UNITED STATES','CANADA','MEXICO','LATIN AMERICA','CARIBBEAN'],
  EMEA: ['EMEA','EUROPE','MIDDLE EAST','AFRICA','EU','AFRICA','MIDDLE EAST','UAE','ISRAEL'],
  LATAM: ['LATAM','LAC','LA/CA','LATIN AMERICA','BRAZIL','ARGENTINA','CHILE','COLOMBIA','PERU','URUGUAY']
};

const COUNTRY_TO_REGION = (() => {
  const map = {};
  // AMER
  ['us','ca','mx','bz','gt','hn','sv','ni','cr','pa','co','ve','ec','pe','bo','py','uy','ar','br','cl','sr','gy'].forEach(c => map[c] = 'AMER');
  // LATAM
  ['br','ar','cl','co','pe','ve','ec','bo','py','uy'].forEach(c => map[c] = 'LATAM');
  // EMEA (examples)
  ['uk','gb','fr','de','es','it','nl','be','se','no','fi','dk','pl','ro','bg','gr','pt','ie','ch','at','cz','hu','sk','si','hr','rs','ba','me','mk','al'].forEach(c => map[c] = 'EMEA');
  // Middle East & Africa
  ['sa','ae','om','kw','qa','bh','il','eg','ma','dz','tn','ly','za','ng','ke','gh','za','dz','ma','tn'].forEach(c => map[c] = 'EMEA');
  // APJC
  ['cn','jp','kr','sg','my','id','ph','vn','th','in','au','nz','pk','bd','lk','np','kh','la','tw','hk'].forEach(c => map[c] = 'APJC');

  for (const [name, coords] of Object.entries(COUNTRY_COORDS)) {
    const n = name.toLowerCase();
    if (!map[n]) {
      if (['india','china','japan','australia','new zealand','pakistan','bangladesh','singapore','philippines','indonesia','thailand','vietnam','malaysia'].includes(n)) map[n] = 'APJC';
      else if (['brazil','argentina','chile','colombia','peru','uruguay','venezuela'].includes(n)) map[n] = 'LATAM';
      else if (['united states','canada','mexico'].includes(n)) map[n] = 'AMER';
      else map[n] = 'EMEA';
    }
  }
  return map;
})();

/* ===========================
   UTILITIES
=========================== */
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escapeAttr(s){ return String(s||'').replace(/"/g,'&quot;').replace(/`/g,'&#096;'); }
function safeHref(u){ try { const s = String(u||'').trim(); if (!s) return '#'; if (/^(mailto:|tel:)/i.test(s)) return s; const url = new URL(s, location.href); if (!['http:','https:'].includes(url.protocol)) return '#'; return url.href; } catch(e){ return '#'; } }
function parseCoord(v){ const n = (v === null || v === undefined) ? NaN : parseFloat(String(v).trim()); return Number.isFinite(n) ? n : NaN; }
function shortHost(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch(e){ return 'Source'; } }
function safeTime(t){ try { const d = new Date(t); if (isNaN(d.getTime())) return 'Recently'; return d.toLocaleString(); } catch(e) { return 'Recently'; }}

/* ===========================
   ADMIN SECRET HELPER
=========================== */
function adminGetSecret() {
  try {
    const session = (typeof sessionStorage !== 'undefined') ? (sessionStorage.getItem('admin_secret') || '') : '';
    return ADMIN_SECRET || session || '';
  } catch(e) {
    return ADMIN_SECRET || '';
  }
}

function adminSetFeedback(msg, isError=false) {
  const fb = document.getElementById('adminFeedback');
  if (!fb) return;
  fb.style.display = 'block';
  fb.className = isError ? 'alert alert-danger mt-3' : 'alert alert-success mt-3';
  fb.textContent = String(msg || '');
}
function adminSaveSecretFromField() {
  try {
    const fld = document.getElementById('adminSecret');
    const rem = document.getElementById('adminRememberSession');
    const v = fld ? String(fld.value || '').trim() : '';
    ADMIN_SECRET = v;
    if (rem && rem.checked) {
      try { sessionStorage.setItem('admin_secret', v); } catch(e) {}
    } else {
      try { sessionStorage.removeItem('admin_secret'); } catch(e) {}
    }
    adminSetFeedback('Admin secret saved in memory' + (rem && rem.checked ? ' and session.' : '.'));
  } catch(e) { adminSetFeedback('Failed to save secret', true); }
}
function adminClearSecretFromField() {
  try { sessionStorage.removeItem('admin_secret'); } catch(e) {}
  ADMIN_SECRET = '';
  const fld = document.getElementById('adminSecret');
  if (fld) fld.value = '';
  adminSetFeedback('Admin secret cleared.');
}

/* ===========================
   REGION NORMALIZATION
=========================== */
function normalizeRegion(raw) {
  if (!raw) return 'Global';
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return 'Global';
  if (['GLOBAL','WORLD'].includes(s)) return 'Global';
  if (['AMER','AMERICAS','NORTH AMERICA','SOUTH AMERICA','LATIN AMERICA','LAC'].includes(s)) {
    if (['LATAM','LATIN AMERICA','LAC'].includes(s)) return 'LATAM';
    return 'AMER';
  }
  if (['EMEA','EUROPE','MIDDLE EAST','AFRICA','ME','EU'].includes(s)) return 'EMEA';
  for (const tok of REGION_TOKENS.APJC) { if (s.includes(tok.toUpperCase())) return 'APJC'; }
  for (const tok of REGION_TOKENS.AMER) { if (s.includes(tok.toUpperCase())) return 'AMER'; }
  for (const tok of REGION_TOKENS.EMEA) { if (s.includes(tok.toUpperCase())) return 'EMEA'; }
  for (const tok of REGION_TOKENS.LATAM) { if (s.includes(tok.toUpperCase())) return 'LATAM'; }
  const candidate = s.toLowerCase();
  if (COUNTRY_COORDS[candidate]) {
    const regionByCountry = COUNTRY_TO_REGION[candidate];
    return regionByCountry || 'Global';
  }
  const iso = s.slice(0,2).toLowerCase();
  if (COUNTRY_TO_REGION[iso]) return COUNTRY_TO_REGION[iso];
  return 'Global';
}

function getRegionByCountry(countryStr) {
  if (!countryStr) return null;
  let c = String(countryStr || '').trim().toLowerCase();
  if (!c) return null;
  if (c.length === 2) {
    if (COUNTRY_TO_REGION[c]) return COUNTRY_TO_REGION[c];
  }
  if (c === 'united states' || c === 'usa' || c === 'us') return 'AMER';
  if (c === 'united kingdom' || c === 'uk' || c === 'gb') return 'EMEA';
  if (c === 'south korea') c = 'kr';
  const code = c.slice(0,2);
  if (COUNTRY_TO_REGION[code]) return COUNTRY_TO_REGION[code];
  if (COUNTRY_COORDS[c]) return COUNTRY_TO_REGION[c] || null;
  if (c.includes('china')||c.includes('japan')||c.includes('korea')||c.includes('india')||c.includes('singapore')||c.includes('australia')) return 'APJC';
  if (c.includes('usa')||c.includes('united states')||c.includes('canada')||c.includes('mexico')) return 'AMER';
  if (c.includes('brazil')||c.includes('argentina')||c.includes('colombia')||c.includes('chile')) return 'LATAM';
  if (c.includes('uk')||c.includes('united kingdom')||c.includes('france')||c.includes('germany')||c.includes('italy')||c.includes('spain')) return 'EMEA';
  return null;
}

/* ===========================
   NORMALIZE INCIDENT FROM WORKER
=========================== */
function generateId(item) {
  if (!item) return '';
  if (item.id) return String(item.id);
  const t = String(item.time || item.ts || item.timestamp || '');
  const title = String(item.title || item.link || '');
  return `${title}|${t}`;
}

function normaliseWorkerIncident(item) {
  if (!item) return null;
  try {
    const title = String(item.title || '').trim();
    if (!title) return null;
    const raw_region = (item.region || item.raw_region || '').toString().trim();
    let lat = parseCoord(item.lat);
    let lng = parseCoord(item.lng !== undefined ? item.lng : item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) {
      const loc = (item.location || item.city || item.country || '').toString().toLowerCase();
      if (loc) {
        const key = loc.split(',')[0].trim();
        if (key && CITY_COORDS[key]) {
          lat = CITY_COORDS[key].lat;
          lng = CITY_COORDS[key].lng;
        } else {
          for (const s of DELL_SITES) {
            if ((s.name || '').toLowerCase().includes(key) || key.includes((s.name || '').toLowerCase())) {
              lat = Number(s.lat); lng = Number(s.lon); break;
            }
          }
        }
      }
      if ((!Number.isFinite(lat) || !Number.isFinite(lng) || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) && item.country) {
        const cn = String(item.country || '').toLowerCase().split(',')[0].trim();
        if (COUNTRY_COORDS[cn]) { lat = COUNTRY_COORDS[cn].lat; lng = COUNTRY_COORDS[cn].lng; }
      }
    }
    if (!Number.isFinite(lat)) lat = 0;
    if (!Number.isFinite(lng)) lng = 0;
    const severity = Number(item.severity || item.level || 1) || 1;
    let regionCanonical = normalizeRegion(raw_region || item.region || '');
    if (regionCanonical === 'Global' && item.country) {
      const inferred = getRegionByCountry(item.country);
      if (inferred) regionCanonical = inferred;
    }
    if (regionCanonical === 'Global' && lat && lng) {
      if (lat >= -60 && lat <= 90 && lng >= 60 && lng <= 160) {
        regionCanonical = 'APJC';
      }
    }
    const normalized = {
      id: generateId(item),
      raw_region: raw_region,
      title: title,
      summary: item.summary || item.description || '',
      link: item.link || item.url || '#',
      time: item.time || item.ts || new Date().toISOString(),
      severity: severity,
      region: regionCanonical || 'Global',
      country: String(item.country || '').toUpperCase(),
      category: String(item.category || item.type || '').toUpperCase(),
      location: item.location || item.city || '',
      lat: Number(lat || 0),
      lng: Number(lng || 0),
      source: item.source || item.source_name || '',
      distance_km: (item.distance_km != null) ? Number(item.distance_km) : null,
      nearest_site_name: item.nearest_site_name || null,
      country_wide: !!item.country_wide
    };
    return normalized;
  } catch(e) {
    console.error('normaliseWorkerIncident failed', e, item);
    return null;
  }
}

/* ===========================
   FETCH HELPERS
=========================== */
async function fetchWithTimeout(url, opts={}, timeout=15000) {
  const controller = new AbortController();
  const id = setTimeout(()=> controller.abort(), timeout);
  try {
    const res = await fetch(url, {...opts, signal: controller.signal});
    return res;
  } finally {
    clearTimeout(id);
  }
}

/* ===========================
   LOAD (INCIDENTS + PROXIMITY)
=========================== */
async function loadFromWorker(silent=false) {
  const label = document.getElementById('feed-status-label');
  if (label && !silent) label.textContent = 'Refreshing…';
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/incidents`, {}, 15000);
    if (!res.ok) throw new Error('HTTP '+res.status);
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : [];
    const cutoff = Date.now() - (48*3600*1000);
    INCIDENTS = arr.map(normaliseWorkerIncident).filter(Boolean).filter(i => {
      try {
        const t = new Date(i.time).getTime();
        return !isNaN(t) && t >= cutoff;
      } catch(e) { return false; }
    }).sort((a,b) => new Date(b.time) - new Date(a.time));
    FEED_IS_LIVE = true;
    if (label && !silent) label.textContent = `LIVE • ${INCIDENTS.length} ITEMS`;
  } catch(e) {
    FEED_IS_LIVE = false;
    if (label && !silent) label.textContent = 'OFFLINE • Worker unreachable';
    console.error('loadFromWorker error', e);
  }
}

async function loadProximityFromWorker(silent=false) {
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/proximity`, {}, 12000);
    if (!res.ok) { if (!silent) console.warn('proximity returned', res.status); return; }
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
   MAP INIT
=========================== */
function initMap() {
  if (typeof L === 'undefined') { console.warn('Leaflet not available'); return; }
  const southWest = L.latLng(-85, -179.999), northEast = L.latLng(85, 179.999);
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

  const esri = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom:19, attribution: 'Tiles © Esri — Esri, USGS, NOAA', noWrap:true, bounds, keepBuffer:2 });
  const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { subdomains:'abcd', maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO', noWrap:true, bounds, keepBuffer:2 });

  let esriErrors=0, ERROR_THRESHOLD=12;
  esri.on('tileerror', ()=>{ esriErrors++; if (esriErrors>=ERROR_THRESHOLD && map.hasLayer(esri)) { map.removeLayer(esri); carto.addTo(map); console.warn('Switched basemap to Carto after ESRI failures'); }});
  esri.addTo(map);

  assetsClusterGroup = L.layerGroup(); map.addLayer(assetsClusterGroup);

  incidentClusterGroup = L.markerClusterGroup({
    chunkedLoading:true, spiderfyOnMaxZoom:true, showCoverageOnHover:false, disableClusteringAtZoom:13, maxClusterRadius:50,
    zoomToBoundsOnClick: !('ontouchstart' in window || navigator.maxTouchPoints>0),
    iconCreateFunction: function(cluster) {
      const children = cluster.getAllChildMarkers ? cluster.getAllChildMarkers() : [];
      let counts = { critical:0, high:0, medium:0, low:0 }, maxSeverity=0;
      children.forEach(m => {
        const s = Number(m.options.severity || 1);
        if (s >= 5) { counts.critical++; maxSeverity = Math.max(maxSeverity, 5); }
        else if (s >=4) { counts.high++; maxSeverity = Math.max(maxSeverity,4); }
        else if (s === 3) { counts.medium++; maxSeverity = Math.max(maxSeverity,3); }
        else counts.low++; 
      });
      let cls = 'cluster-blue';
      if (counts.critical + counts.high > 0) cls = (counts.critical > 0) ? 'cluster-red' : 'cluster-amber';
      if (maxSeverity >= 4) cls = 'cluster-red'; else if (maxSeverity === 3) cls = 'cluster-amber';
      const html = `<div class="cluster-icon ${cls}" tabindex="0" role="button" title="Cluster (${children.length})"><div class="cluster-count">${children.length}</div></div>`;
      return L.divIcon({ html, className:'', iconSize:[40,40], iconAnchor:[20,20] });
    }
  });

  incidentClusterGroup.on('clustermouseover', (e)=> {
    try {
      const cluster = e.layer;
      const children = cluster.getAllChildMarkers();
      let counts = { critical:0, high:0, medium:0, low:0 };
      children.forEach(m => {
        const s = Number(m.options.severity || 1);
        if (s >=5) counts.critical++;
        else if (s >=4) counts.high++;
        else if (s === 3) counts.medium++;
        else counts.low++;
      });
      const tt = `Critical: ${counts.critical}, High: ${counts.high}, Medium: ${counts.medium}, Low: ${counts.low}`;
      cluster.bindTooltip(tt, { direction:'top', offset:[0,-10], opacity:0.95, className:'map-tooltip' }).openTooltip();
    } catch(e) {}
  });

  incidentClusterGroup.on('clustermouseout',(e)=>{ try { e.layer.closeTooltip(); } catch(e){} });

  map.addLayer(incidentClusterGroup);
  criticalLayerGroup = L.layerGroup(); map.addLayer(criticalLayerGroup);
}

/* ===========================
   RENDER ASSETS & INCIDENTS
=========================== */
function createAssetsDebugOverlay(){ let d = document.getElementById('assets-debug'); if(!d){ d = document.createElement('div'); d.id = 'assets-debug'; d.className = 'assets-debug'; d.style.display = 'none'; d.setAttribute('role','status'); d.setAttribute('aria-live','polite'); document.body.appendChild(d);} return d; }
function updateAssetsDebugOverlay(info){ if (!DEBUG_UI) return; try { const d = createAssetsDebugOverlay(); d.style.display = 'block'; d.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Map asset diagnostics</div><div><strong>DELL_SITES:</strong> ${info.dellSites}</div><div><strong>ASSETS keys:</strong> ${info.assetsKeys}</div><div><strong>assets.length:</strong> ${info.assetsLen}</div><div><strong>filtered:</strong> ${info.filteredLen}</div><div style="margin-top:6px;font-weight:700">Sample entries</div><pre>${info.sample}</pre>`; } catch(e){ console.warn('updateAssetsDebugOverlay', e); } }

function renderAssetsOnMap(region) {
  if (!assetsClusterGroup || !map) return;
  assetsClusterGroup.clearLayers();
  const assets = Object.values(ASSETS);
  const filtered = (region === 'Global') ? assets : assets.filter(a => a.region === region);
  const sample = filtered.slice(0,8).map(a => `${a.name} [${a.region}]`).join('\n');
  updateAssetsDebugOverlay({dellSites: DELL_SITES.length, assetsKeys: Object.keys(ASSETS).length, assetsLen: assets.length, filteredLen: filtered.length, sample});
  filtered.forEach(a => {
    try {
      const m = L.marker([Number(a.lat), Number(a.lng)], { icon: L.divIcon({ className:'custom-pin', html:'<div class="marker-pin-dell"><i class="fas fa-building"></i></div>', iconSize:[30,42], iconAnchor:[15,42] })});
      m.bindTooltip(escapeHtml(a.name), { className:'map-tooltip', direction:'top' });
      assetsClusterGroup.addLayer(m);
    } catch(e) {}
  });
}

function renderIncidentsOnMap(region, list) {
  if (!incidentClusterGroup || !criticalLayerGroup || !map) return;
  incidentClusterGroup.clearLayers(); criticalLayerGroup.clearLayers();
  const data = (region === 'Global') ? list : list.filter(i => i.region === region);
  data.forEach(i => {
    try {
      const sev = Number(i.severity || 1);
      let coords = null;
      if (Number.isFinite(Number(i.lat)) && Number.isFinite(Number(i.lng)) && Math.abs(Number(i.lat)) > 0.0001 && Math.abs(Number(i.lng)) > 0.0001) {
        coords = { lat: Number(i.lat), lng: Number(i.lng) };
      } else {
        coords = getCoordsForIncident(i);
      }
      if (!coords) return;
      const color = (sev >= 5) ? '#d93025' : (sev === 4 ? '#d93025' : (sev === 3 ? '#f9ab00' : '#1a73e8'));
      const markerOpts = { severity: sev, icon: L.divIcon({ html:`<div class="incident-dot" style="background:${color}"></div>`, className:'', iconSize:[12,12], iconAnchor:[8,8] }) };
      const marker = L.marker([coords.lat, coords.lng], markerOpts)
        .bindPopup(`<b>${escapeHtml(i.title)}</b><br>${escapeHtml(safeTime(i.time))}<br/><a href="${escapeAttr(safeHref(i.link))}" target="_blank" rel="noopener">Source</a>`);
      if (sev >= 4) criticalLayerGroup.addLayer(marker);
      else {
        const isProx = PROXIMITY_INCIDENTS.findIndex(pi => String(pi.id) === String(i.id)) >= 0;
        if (isProx || i.country_wide) incidentClusterGroup.addLayer(marker);
      }
    } catch(e) {}
  });
  try { criticalLayerGroup.bringToFront(); } catch(e) {}
}

/* ===========================
   GENERAL FEED
=========================== */
function renderGeneralFeed(region) {
  const container = document.getElementById('general-news-feed');
  if (!container) return;
  const data = (region === 'Global') ? INCIDENTS : INCIDENTS.filter(i => i.region === region);
  if (!data || data.length === 0) {
    container.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">No incidents for this region.</div>`;
    return;
  }
  let html = '';
  data.forEach(i => {
    const sevMeta = mapSeverityToLabel(i.severity);
    const id = String(i.id);
    const localVote = VOTES_LOCAL[id] || null;
    html += `
      <div class="feed-card" role="article" data-link="${escapeAttr(safeHref(i.link))}" tabindex="0">
        <div class="feed-status-bar ${sevMeta.barClass}"></div>
        <div class="feed-content">
          <div class="feed-tags">
            <span class="ftag ${sevMeta.badgeClass}">${escapeHtml(sevMeta.label)}</span>
            <span class="ftag ftag-loc">${escapeHtml((i.country||"GLOBAL").toUpperCase())}</span>
            <span class="ftag ftag-type">${escapeHtml(i.category || 'UNKNOWN')}</span>
            <span class="feed-region">${escapeHtml(i.region || 'Global')}</span>
          </div>
          <div class="feed-title">
            <a href="${escapeAttr(safeHref(i.link))}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
              ${escapeHtml(i.title)}
            </a>
          </div>
          <div class="feed-meta">${escapeHtml(safeTime(i.time))} • ${escapeHtml(shortHost(i.source))}</div>
          <div class="feed-desc">${escapeHtml(i.summary || '')}</div>
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
  const data = (region === 'Global') ? PROXIMITY_INCIDENTS : PROXIMITY_INCIDENTS.filter(i => i.region === region);
  const alerts = [];
  data.forEach(inc => {
    const coords = (Number.isFinite(Number(inc.lat)) && Number.isFinite(Number(inc.lng))) ? { lat:Number(inc.lat), lng:Number(inc.lng) } : getCoordsForIncident(inc);
    if (!coords) return;
    const key = String(inc.id);
    if (DISMISSED_ALERT_IDS.has(key)) return;
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
  });
  alerts.sort((a,b)=>a.nearest.dist - b.nearest.dist);
  if (!alerts.length) {
    container.innerHTML = `<div style="padding:15px;text-align:center;color:#999;">No threats within ${currentRadius}km.</div>`;
    return;
  }
  container.innerHTML = alerts.slice(0,25).map(a => {
    const i = a.inc; const sev = Number(i.severity || 1);
    const color = sev >= 4 ? '#d93025' : (sev === 3 ? '#f9ab00' : '#1a73e8');
    const distStr = i.country_wide ? 'Country-wide' : `${Math.round(a.nearest.dist)}km`;
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
   haversine
=========================== */
function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ===========================
   getCoordsForIncident
=========================== */
function getCoordsForIncident(i) {
  if (!i) return null;
  const lat = parseCoord(i.lat);
  const lng = parseCoord(i.lng !== undefined ? i.lng : i.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)>0.0001 && Math.abs(lng)>0.0001) return { lat, lng };
  const locRaw = String(i.location || i.city || '').trim().toLowerCase();
  if (locRaw && locRaw !== 'unknown') {
    const locKey = locRaw.split(',')[0].trim();
    if (locKey.length >= 2) {
      if (CITY_COORDS[locKey]) return { lat: CITY_COORDS[locKey].lat, lng: CITY_COORDS[locKey].lng };
      for (const k of Object.keys(CITY_COORDS)) {
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
    if (COUNTRY_COORDS[cut]) return { lat: COUNTRY_COORDS[cut].lat, lng: COUNTRY_COORDS[cut].lng };
    const code = cut.slice(0,2);
    if (COUNTRY_COORDS[cut]) return { lat: COUNTRY_COORDS[cut].lat, lng: COUNTRY_COORDS[cut].lng };
    for (const s of DELL_SITES) {
      const sc = (s.country || '').toLowerCase();
      if (sc === cut || sc === code) return { lat: s.lat, lng: s.lon };
    }
  }
  return null;
}

/* ===========================
   VOTING
=========================== */
function persistVotes(){ try{ localStorage.setItem('os_v1_votes', JSON.stringify(VOTES_LOCAL)); }catch(e){} }
function persistVoteQueue(){ try{ localStorage.setItem('os_v1_vote_queue', JSON.stringify(VOTE_QUEUE)); }catch(e){} }

function applyVoteUIForId(id, vote){
  try {
    document.querySelectorAll(`.btn-vote[data-id="${escapeAttr(id)}"]`).forEach(btn => {
      btn.classList.remove('voted-up','voted-down'); btn.disabled=false;
    });
    if (!vote) return;
    const selector = `.btn-vote[data-id="${escapeAttr(id)}"][data-vote="${vote}"]`;
    document.querySelectorAll(selector).forEach(b => { if (vote==='up') b.classList.add('voted-up'); if (vote==='down') b.classList.add('voted-down'); });
  } catch(e){}
}
function markVoteAcceptedLocally(id, vote) {
  try { VOTES_LOCAL[id] = vote; persistVotes(); applyVoteUIForId(id, vote); } catch(e){}
}
function removeLocalVote(id) {
  try { delete VOTES_LOCAL[id]; persistVotes(); applyVoteUIForId(id, null); } catch(e){}
}

async function sendVoteToServer(payload) {
  if (!payload || !payload.id) return { ok:false, err:'invalid' };
  const endpoints = [`${WORKER_URL}/api/thumb/public`, `${WORKER_URL}/api/thumb`];
  for (let i=0;i<endpoints.length;i++){
    const url = endpoints[i];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', ...( (i===1 && adminGetSecret()) ? { 'secret': adminGetSecret() } : {} ) },
        body: JSON.stringify({ id: payload.id, vote: payload.vote, ts: payload.ts || new Date().toISOString() })
      });
      if (res.ok) return { ok:true, status: res.status };
      if (res.status === 403 && adminGetSecret()) {
        const res2 = await fetch(`${WORKER_URL}/api/thumb`, { method:'POST', headers: {'Content-Type':'application/json','secret': adminGetSecret()}, body: JSON.stringify({ id: payload.id, vote: payload.vote, ts: payload.ts || new Date().toISOString() })});
        if (res2.ok) return { ok:true, status: res2.status };
        else return { ok:false, status: res2.status, text: await res2.text().catch(()=>'') };
      }
      const text = await res.text().catch(()=>'');
      return { ok:false, status: res.status, text };
    } catch(e) {
      if (i === endpoints.length-1) return { ok:false, err:e };
      else continue;
    }
  }
  return { ok:false, err:'no-endpoints' };
}

async function enqueueVote(payload) {
  try { VOTE_QUEUE.push(payload); persistVoteQueue(); } catch(e) {}
}

async function flushVoteQueue() {
  if (!VOTE_QUEUE || !VOTE_QUEUE.length) return;
  const qcopy = VOTE_QUEUE.slice();
  for (let i=0;i<qcopy.length;i++){
    const p = qcopy[i];
    try {
      const r = await sendVoteToServer(p);
      if (r.ok) {
        const idx = VOTE_QUEUE.findIndex(q => q.id===p.id && q.ts===p.ts && q.vote===p.vote);
        if (idx>=0) VOTE_QUEUE.splice(idx,1);
        persistVoteQueue();
      } else console.warn('Queued vote not accepted yet', p, r);
    } catch(e){ console.warn('flushVoteQueue error', e); }
  }
}

setInterval(()=>{ try{ flushVoteQueue(); }catch(e){} }, 30_000);

async function voteThumb(id, vote) {
  if (!id || !vote) return;
  markVoteAcceptedLocally(id,vote);
  const payload = { id: String(id), vote, ts: new Date().toISOString() };
  try {
    const res = await sendVoteToServer(payload);
    if (res.ok) { console.log('Vote flushed', payload); flushVoteQueue().catch(()=>{}); }
    else { await enqueueVote(payload); adminSetFeedback('Vote queued (will retry)', false); }
  } catch(e) {
    await enqueueVote(payload); adminSetFeedback('Vote queued (network)', false);
  }
}

/* ===========================
   ADMIN ACTIONS
=========================== */
async function adminTriggerIngest() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Triggering ingestion…');
  try {
    const res = await fetch(`${WORKER_URL}/api/ingest`, { method:'POST', headers:{ 'secret': sec } });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Ingest failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Ingestion triggered.');
  } catch(e){ adminSetFeedback('Ingest failed (network)', true); console.error(e); }
}

async function adminUnlock() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Requesting unblock…');
  try {
    const res = await fetch(`${WORKER_URL}/api/thumb/unblock`, { method:'POST', headers: {'content-type':'application/json','secret':sec}, body: JSON.stringify({ unblock: true }) });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Unblock failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Unblock requested.');
  } catch(e){ adminSetFeedback('Unblock failed (network)', true); console.error(e); }
}

async function adminThumbsStatus() {
  const sec = adminGetSecret();
  adminSetFeedback('Loading thumbs status…');
  try {
    const res = await fetch(`${WORKER_URL}/api/thumbs/status`, { headers: { ...(sec ? {'secret':sec} : {}) } });
    const data = await res.json().catch(()=>null);
    if (!res.ok) { adminSetFeedback(`Status failed (HTTP ${res.status}).`, true); console.log('thumbs status raw', data); return; }
    adminSetFeedback('Thumbs status loaded. Check console.');
    console.log('thumbs status:', data);
  } catch(e){ adminSetFeedback('Status failed (network)', true); console.error(e); }
}

async function adminForceRefreshTravel() {
  const sec = adminGetSecret();
  adminSetFeedback('Refreshing travel cache…');
  try {
    const res = await fetch(`${WORKER_URL}/api/traveladvisories/refresh`, { method:'POST', headers: { ...(sec ? {'secret':sec} : {}) }});
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Travel refresh failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Travel refresh triggered.');
    try { await loadTravelAdvisories(); } catch(e){}
  } catch(e){ adminSetFeedback('Travel refresh failed (network)', true); console.error(e); }
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
    const res = await fetch(url, { method:'POST', headers: { 'secret': sec }});
    const txt = await res.text().catch(()=>'');
    if (!res.ok) { adminSetFeedback(`Generate failed (HTTP ${res.status}). ${txt}`, true); return; }
    adminSetFeedback(txt || 'Brief generation requested.');
  } catch(e){ adminSetFeedback('Generate failed (network)', true); console.error(e); }
}

async function adminListBriefs() {
  const sec = adminGetSecret();
  if (!sec) { adminSetFeedback('Set Admin Secret first.', true); return; }
  adminSetFeedback('Listing stored briefs…');
  try {
    const res = await fetch(`${WORKER_URL}/api/dailybrief/list`, { headers: { 'secret': sec }});
    const data = await res.json().catch(()=>null);
    if (!res.ok) { adminSetFeedback(`List failed (HTTP ${res.status}).`, true); console.log('brief list raw', data); return; }
    adminSetFeedback('Brief list loaded. Check console.');
    console.log('Stored briefs:', data);
  } catch(e){ adminSetFeedback('List failed (network)', true); console.error(e); }
}

/* ===========================
   TRAVEL ADVISORY + FALLBACK NEWS
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
  } catch(e){ console.warn('loadTravelAdvisories worker live failed', e); }
  sel.innerHTML = `<option selected disabled>Select Country...</option>` + Object.keys(COUNTRY_COORDS).sort().map(c => `<option value="${escapeAttr(c)}">${escapeHtml(capitalizeEach(c))}</option>`).join('');
}

/* Helper: derive travel news by scanning INCIDENTS for country name, returns top N */
function getTravelNewsForCountry(country, limit=5) {
  if (!country) return [];
  const c = String(country || '').toLowerCase();
  const matches = INCIDENTS.filter(i => {
    const incCountry = (i.country || '').toLowerCase();
    const loc = (i.location || '').toLowerCase();
    return incCountry.includes(c) || loc.includes(c) || (i.title || '').toLowerCase().includes(c);
  }).slice(0,limit);
  return matches.map(i => ({ title: i.title, summary: i.summary }));
}

async function filterTravel() {
  const countryRaw = document.getElementById('countrySelect')?.value || '';
  const cont = document.getElementById('travel-advisories');
  const newsCont = document.getElementById('travel-news');
  if (cont) cont.innerHTML = 'Loading…';
  if (newsCont) newsCont.innerHTML = '';
  try {
    const res = await fetchWithTimeout(`${WORKER_URL}/api/traveladvisories?country=${encodeURIComponent(countryRaw)}`, {}, 12000);
    if (!res.ok) throw new Error('HTTP '+res.status);
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
    let news = Array.isArray(data.news) ? data.news : (Array.isArray(data.recent_incidents) ? data.recent_incidents : []);
    if ((!news || !news.length) && countryRaw) {
      news = getTravelNewsForCountry(countryRaw, 5);
    }
    if (news && news.length && newsCont) {
      newsCont.innerHTML = `<div class="news-box-alert"><div class="news-box-header">RELATED NEWS</div>${news.slice(0,5).map(n => `<div class="news-box-item"><div class="news-box-title">${escapeHtml(n.title || '')}</div><div class="news-box-summary">${escapeHtml(n.summary || '')}</div></div>`).join('')}</div>`;
    }
  } catch(e) {
    if (cont) cont.innerHTML = `<div class="safe-box"><i class="fas fa-info-circle safe-icon" aria-hidden="true"></i><div class="safe-text">Advisory unavailable.</div></div>`;
  }
}

/* ===========================
   REPORTING, HISTORY, PREVIEW
=========================== */
async function previewBriefing() {
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
  const fb = document.getElementById('preview-feedback');
  const cont = document.getElementById('briefing-preview');
  if (fb) { fb.style.display='block'; fb.textContent='Generating preview…'; }
  if (cont) cont.innerHTML = '';
  let url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  try {
    const res = await fetchWithTimeout(url, {}, 20000);
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    const incidents = json.incidents || [];
    if (!incidents.length) {
      cont.innerHTML = `<div class="safe-box"><i class="fas fa-check-circle safe-icon"></i><div class="safe-text">No incidents found for this period.</div></div>`;
    } else {
      cont.innerHTML = incidents.slice(0,50).map(i => `<div style="border-bottom:1px solid #eee;padding:8px 0;"><div style="font-weight:700">${escapeHtml(i.title)}</div><div style="font-size:0.8rem;color:#666">${escapeHtml(i.country||'')} • ${escapeHtml(safeTime(i.time))}</div><div style="margin-top:4px;">${escapeHtml(i.summary||'')}</div></div>`).join('');
    }
    if (fb) fb.style.display='none';
  } catch(e){ if (fb) { fb.style.display='block'; fb.textContent = `Error: ${e.message}`; } }
}

async function downloadReport() {
  const region = document.getElementById('reportRegion')?.value || 'Global';
  const date = document.getElementById('reportDate')?.value || '';
  let url = `${WORKER_URL}/api/dailybrief?region=${encodeURIComponent(region)}&download=true`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  window.open(url, '_blank', 'noopener');
}

async function loadHistory(dateStr) {
  const status = document.getElementById('history-status');
  if (status) status.textContent = 'Loading archive…';
  try {
    const res = await fetch(`${WORKER_URL}/api/archive?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) throw new Error('HTTP '+res.status);
    const arr = await res.json();
    if (!status) return;
    if (!arr || !arr.length) { status.textContent = 'No archived incidents found.'; return; }
    status.innerHTML = `<div style="max-height:300px;overflow:auto;margin-top:10px;">` + arr.map(i => `<div style="margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px;"><strong>${escapeHtml(i.title)}</strong><br><span style="font-size:0.8rem;color:#666">${escapeHtml(i.country||'')}</span></div>`).join('') + `</div>`;
  } catch(e){ if (status) status.textContent = `Archive error: ${e.message}`; }
}

/* ===========================
   REFRESH
=========================== */
async function manualRefresh() {
  const btn = document.getElementById('btn-refresh');
  const orig = btn ? btn.innerHTML : 'Refresh';
  try {
    if (btn) { btn.style.opacity='0.7'; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...'; btn.style.pointerEvents='none'; }
    await Promise.all([ loadFromWorker(false), loadProximityFromWorker(false), loadTravelAdvisories() ]);
    const active = document.querySelector('.nav-item-custom.active');
    filterNews(active ? active.textContent.trim() : 'Global');
  } catch(e) {
    console.error('manualRefresh error', e);
  } finally {
    if (btn) { btn.style.opacity='1'; btn.innerHTML = orig; btn.style.pointerEvents='auto'; }
  }
}

/* ===========================
   MAP & UI BOOTSTRAP
=========================== */
function startClock() {
  const container = document.getElementById('multi-clock-container');
  const zones = [
    { label:'Austin', z:'America/Chicago' },
    { label:'Ireland', z:'Europe/Dublin' },
    { label:'India', z:'Asia/Kolkata' },
    { label:'Singapore', z:'Asia/Singapore' },
    { label:'Tokyo', z:'Asia/Tokyo' },
    { label:'Sydney', z:'Australia/Sydney' }
  ];
  if (container && !container.innerHTML) {
    container.innerHTML = zones.map(z => `<div class="clock-box"><div class="clock-label">${escapeHtml(z.label)}</div><div class="clock-val" id="clk-${escapeAttr(z.label)}">--:--</div></div>`).join('');
  }
  setInterval(()=> {
    const now = new Date();
    zones.forEach(z => {
      const el = document.getElementById(`clk-${z.label}`);
      if (el) el.textContent = now.toLocaleTimeString('en-US',{ timeZone: z.z, hour12:false, hour:'2-digit', minute:'2-digit' });
    });
  }, 1000);
}

/* Delegated event handler for data-action */
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  if (!action) return;
  if (t.tagName === 'A' && (t.getAttribute('href') === '#' || !t.getAttribute('href'))) ev.preventDefault();
  if (action === 'filter-region') {
    document.querySelectorAll('[data-action="filter-region"]').forEach(el => el.classList.remove('active'));
    t.classList.add('active');
    filterNews(t.dataset.region || t.textContent.trim());
    return;
  }
  if (action === 'refresh') { manualRefresh(); return; }
  if (action === 'preview-brief') { previewBriefing(); return; }
  if (action === 'download-brief') { downloadReport(); return; }
  if (action === 'vote') {
    ev.preventDefault(); ev.stopPropagation();
    const id = t.getAttribute('data-id'), v = t.getAttribute('data-vote');
    await voteThumb(id, v);
    return;
  }
  if (action === 'dismiss-alert') {
    ev.preventDefault(); ev.stopPropagation();
    const id = t.getAttribute('data-id'); if (id) { DISMISSED_ALERT_IDS.add(id); sessionStorage.setItem('dismissed_prox_alert_ids', JSON.stringify(Array.from(DISMISSED_ALERT_IDS).slice(0,500))); }
    const row = t.closest('.alert-row'); if (row) row.remove();
    return;
  }
  // admin
  if (action === 'admin-save-secret') { adminSaveSecretFromField(); return; }
  if (action === 'admin-clear-secret') { adminClearSecretFromField(); return; }
  if (action === 'admin-trigger-ingest') { adminTriggerIngest(); return; }
  if (action === 'admin-unlock') { adminUnlock(); return; }
  if (action === 'admin-thumbs-status') { adminThumbsStatus(); return; }
  if (action === 'admin-force-refresh-travel') { adminForceRefreshTravel(); return; }
  if (action === 'admin-generate-brief') { adminGenerateBrief(); return; }
  if (action === 'admin-list-briefs') { adminListBriefs(); return; }
});

/* open card link logic */
document.addEventListener('click', (e)=> {
  const card = e.target.closest('.feed-card[data-link]');
  if (!card) return;
  if (e.target.closest('a')) return;
  if (e.target.closest('[data-action]')) return;
  const href = card.getAttribute('data-link');
  if (!href) return;
  try { window.open(href, '_blank', 'noopener'); } catch(e){}
});

/* wire inputs & bootstrap */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    try {
      const s = sessionStorage.getItem('admin_secret') || '';
      if (s) { ADMIN_SECRET = s; try { document.getElementById('adminSecret').value = s; document.getElementById('adminRememberSession').checked = true; } catch(e){} }
    } catch(e){}
    initMap();
    startClock();
    const historyPicker = document.getElementById('history-picker'); if (historyPicker) historyPicker.addEventListener('change', ev => loadHistory(ev.target.value));
    const countrySel = document.getElementById('countrySelect'); if (countrySel) countrySel.addEventListener('change', filterTravel);
    const proxRad = document.getElementById('proxRadius'); if (proxRad) proxRad.addEventListener('change', updateProximityRadius);
    await loadFromWorker();
    await loadProximityFromWorker();
    filterNews('Global');
    await loadTravelAdvisories();
    Object.keys(VOTES_LOCAL).forEach(k => applyVoteUIForId(k, VOTES_LOCAL[k]));
    setTimeout(()=> { try { flushVoteQueue(); } catch(e){} }, 1000);
    setInterval(async () => {
      if (FEED_IS_LIVE) {
        await loadFromWorker(true);
        await loadProximityFromWorker(true);
        const active = document.querySelector('.nav-item-custom.active');
        filterNews(active ? active.textContent.trim() : 'Global');
      }
    }, AUTO_REFRESH_MS);
  } catch(e) {
    console.error('Initialization error', e);
    const feed = document.getElementById('general-news-feed');
    if (feed) feed.innerHTML = `<div style="padding:20px;color:#b00;">Application failed to initialize. See console for details.</div>`;
  }
});

/* filterNews */
function filterNews(region) {
  renderAssetsOnMap(region);
  renderIncidentsOnMap(region, INCIDENTS);
  renderGeneralFeed(region);
  updateHeadline(region);
  renderProximityAlerts(region);
}

/* severity mapping */
function mapSeverityToLabel(s) {
  const n = Number(s || 1);
  if (n >= 5) return { label:'CRITICAL', badgeClass:'ftag-crit', barClass:'status-bar-crit' };
  if (n >= 4) return { label:'HIGH', badgeClass:'ftag-crit', barClass:'status-bar-crit' };
  if (n === 3) return { label:'MEDIUM', badgeClass:'ftag-warn', barClass:'status-bar-warn' };
  return { label:'LOW', badgeClass:'ftag-info', barClass:'status-bar-info' };
}

/* updateHeadline */
function updateHeadline(region) {
  const data = (region === 'Global') ? INCIDENTS : INCIDENTS.filter(i => i.region === region);
  const el = document.getElementById('headline-alert');
  const tags = document.getElementById('headline-tags');
  if (!el || !tags) return;
  if (data && data.length) {
    el.textContent = data[0].title || 'Headline';
    const sev = mapSeverityToLabel(data[0].severity);
    tags.innerHTML = `<span class="tag tag-crit" style="background:${(Number(data[0].severity||1) >= 4) ? '#d93025' : '#5f6368'}">${escapeHtml(sev.label)}</span><span class="tag tag-cat">${escapeHtml(data[0].category || 'CATEGORY')}</span><span class="tag tag-reg">${escapeHtml(data[0].region || 'REGION')}</span>`;
  } else {
    el.textContent = 'No critical alerts.';
    tags.innerHTML = '';
  }
}

/* expose debugging */
window.loadTravelAdvisories = loadTravelAdvisories;
window.filterTravel = filterTravel;
window.loadHistory = loadHistory;
window.voteThumb = voteThumb;
window.flushVoteQueue = flushVoteQueue;
window.normalizeRegion = normalizeRegion;
window.normaliseWorkerIncident = normaliseWorkerIncident;
window.INCIDENTS = INCIDENTS;
window.PROXIMITY_INCIDENTS = PROXIMITY_INCIDENTS;

function capitalizeEach(s){ return String(s||'').split(' ').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
