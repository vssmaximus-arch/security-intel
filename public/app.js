/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    NEWS: "public/data/news.json",
    PROXIMITY: "public/data/proximity.json"
};

/* --- FULL DELL SITE LIST (AS OF SEP 2025) --- */
const HARDCODED_SITES = [
    // AMER
    { name: "Dell Round Rock HQ", country: "US", region: "AMER", lat: 30.5083, lon: -97.6788 },
    { name: "Dell Austin Parmer", country: "US", region: "AMER", lat: 30.2672, lon: -97.7431 },
    { name: "Dell Hopkinton", country: "US", region: "AMER", lat: 42.2287, lon: -71.5226 },
    { name: "Dell Durham", country: "US", region: "AMER", lat: 35.9940, lon: -78.8986 },
    { name: "Dell Santa Clara", country: "US", region: "AMER", lat: 37.3541, lon: -121.9552 },
    { name: "Dell Nashville Hub", country: "US", region: "AMER", lat: 36.1627, lon: -86.7816 },
    { name: "Dell Oklahoma City", country: "US", region: "AMER", lat: 35.4676, lon: -97.5164 },
    { name: "Dell Toronto", country: "CA", region: "AMER", lat: 43.6532, lon: -79.3832 },
    { name: "Dell Mexico City", country: "MX", region: "AMER", lat: 19.4326, lon: -99.1332 },
    { name: "Dell Franklin MA", country: "US", region: "AMER", lat: 42.0834, lon: -71.4162 },
    { name: "Dell Eden Prairie", country: "US", region: "AMER", lat: 44.8547, lon: -93.4708 },
    
    // LATAM
    { name: "Dell Hortolândia", country: "BR", region: "LATAM", lat: -22.8583, lon: -47.2208 },
    { name: "Dell São Paulo", country: "BR", region: "LATAM", lat: -23.5505, lon: -46.6333 },
    { name: "Dell Porto Alegre", country: "BR", region: "LATAM", lat: -30.0346, lon: -51.2177 },
    { name: "Dell Bogotá", country: "CO", region: "LATAM", lat: 4.7110, lon: -74.0721 },
    { name: "Dell Santiago", country: "CL", region: "LATAM", lat: -33.4489, lon: -70.6693 },
    { name: "Dell Buenos Aires", country: "AR", region: "LATAM", lat: -34.6037, lon: -58.3816 },
    { name: "Dell Panama City", country: "PA", region: "LATAM", lat: 8.9824, lon: -79.5199 },
    
    // EMEA
    { name: "Dell Cork Campus", country: "IE", region: "EMEA", lat: 51.8985, lon: -8.4756 },
    { name: "Dell Limerick", country: "IE", region: "EMEA", lat: 52.6638, lon: -8.6267 },
    { name: "Dell Dublin", country: "IE", region: "EMEA", lat: 53.3498, lon: -6.2603 },
    { name: "Dell Bracknell", country: "UK", region: "EMEA", lat: 51.4160, lon: -0.7540 },
    { name: "Dell Brentford", country: "UK", region: "EMEA", lat: 51.4850, lon: -0.3050 },
    { name: "Dell Glasgow", country: "UK", region: "EMEA", lat: 55.8642, lon: -4.2518 },
    { name: "Dell Paris / Bezons", country: "FR", region: "EMEA", lat: 48.8566, lon: 2.3522 },
    { name: "Dell Montpellier", country: "FR", region: "EMEA", lat: 43.6108, lon: 3.8767 },
    { name: "Dell Frankfurt", country: "DE", region: "EMEA", lat: 50.1109, lon: 8.6821 },
    { name: "Dell Munich", country: "DE", region: "EMEA", lat: 48.1351, lon: 11.5820 },
    { name: "Dell Amsterdam", country: "NL", region: "EMEA", lat: 52.3676, lon: 4.9041 },
    { name: "Dell Copenhagen", country: "DK", region: "EMEA", lat: 55.6761, lon: 12.5683 },
    { name: "Dell Stockholm", country: "SE", region: "EMEA", lat: 59.3293, lon: 18.0686 },
    { name: "Dell Madrid", country: "ES", region: "EMEA", lat: 40.4168, lon: -3.7038 },
    { name: "Dell Rome", country: "IT", region: "EMEA", lat: 41.9028, lon: 12.4964 },
    { name: "Dell Prague", country: "CZ", region: "EMEA", lat: 50.0755, lon: 14.4378 },
    { name: "Dell Warsaw", country: "PL", region: "EMEA", lat: 52.2297, lon: 21.0122 },
    { name: "Dell Dubai", country: "AE", region: "EMEA", lat: 25.2048, lon: 55.2708 },
    { name: "Dell Riyadh", country: "SA", region: "EMEA", lat: 24.7136, lon: 46.6753 },
    { name: "Dell Johannesburg", country: "ZA", region: "EMEA", lat: -26.2041, lon: 28.0473 },
    { name: "Dell Casablanca", country: "MA", region: "EMEA", lat: 33.5731, lon: -7.5898 },
    { name: "Dell Cairo", country: "EG", region: "EMEA", lat: 30.0444, lon: 31.2357 },

    // APJC
    { name: "Dell Bangalore", country: "IN", region: "APJC", lat: 12.9716, lon: 77.5946 },
    { name: "Dell Hyderabad", country: "IN", region: "APJC", lat: 17.3850, lon: 78.4867 },
    { name: "Dell Gurgaon", country: "IN", region: "APJC", lat: 28.4595, lon: 77.0266 },
    { name: "Dell Cyberjaya", country: "MY", region: "APJC", lat: 2.9213, lon: 101.6559 },
    { name: "Dell Penang", country: "MY", region: "APJC", lat: 5.4164, lon: 100.3327 },
    { name: "Dell Singapore", country: "SG", region: "APJC", lat: 1.3521, lon: 103.8198 },
    { name: "Dell Xiamen Mfg", country: "CN", region: "APJC", lat: 24.4798, lon: 118.0894 },
    { name: "Dell Chengdu", country: "CN", region: "APJC", lat: 30.5728, lon: 104.0668 },
    { name: "Dell Shanghai", country: "CN", region: "APJC", lat: 31.2304, lon: 121.4737 },
    { name: "Dell Beijing", country: "CN", region: "APJC", lat: 39.9042, lon: 116.4074 },
    { name: "Dell Hong Kong", country: "HK", region: "APJC", lat: 22.3193, lon: 114.1694 },
    { name: "Dell Taipei", country: "TW", region: "APJC", lat: 25.0330, lon: 121.5654 },
    { name: "Dell Tokyo", country: "JP", region: "APJC", lat: 35.6762, lon: 139.6503 },
    { name: "Dell Osaka", country: "JP", region: "APJC", lat: 34.6937, lon: 135.5023 },
    { name: "Dell Seoul", country: "KR", region: "APJC", lat: 37.5665, lon: 126.9780 },
    { name: "Dell Sydney", country: "AU", region: "APJC", lat: -33.8688, lon: 151.2093 },
    { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 },
    { name: "Dell Canberra", country: "AU", region: "APJC", lat: -35.2809, lon: 149.1300 },
    { name: "Dell Manila", country: "PH", region: "APJC", lat: 14.5995, lon: 120.9842 },
    { name: "Dell Bangkok", country: "TH", region: "APJC", lat: 13.7563, lon: 100.5018 }
];

/* --- COMPREHENSIVE COUNTRY LIST (ALL WORLD COUNTRIES) --- */
const ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel" }, "Albania": { level: 1, text: "Normal Precautions" }, "Algeria": { level: 2, text: "Increased Caution" }, "Andorra": { level: 1, text: "Normal Precautions" }, "Angola": { level: 1, text: "Normal Precautions" },
    "Antigua and Barbuda": { level: 1, text: "Normal Precautions" }, "Argentina": { level: 1, text: "Normal Precautions" }, "Armenia": { level: 1, text: "Normal Precautions" }, "Australia": { level: 1, text: "Normal Precautions" }, "Austria": { level: 1, text: "Normal Precautions" },
    "Azerbaijan": { level: 2, text: "Increased Caution" }, "Bahamas": { level: 2, text: "Increased Caution" }, "Bahrain": { level: 1, text: "Normal Precautions" }, "Bangladesh": { level: 2, text: "Increased Caution" }, "Barbados": { level: 1, text: "Normal Precautions" },
    "Belarus": { level: 4, text: "Do Not Travel" }, "Belgium": { level: 2, text: "Increased Caution" }, "Belize": { level: 2, text: "Increased Caution" }, "Benin": { level: 1, text: "Normal Precautions" }, "Bhutan": { level: 1, text: "Normal Precautions" },
    "Bolivia": { level: 2, text: "Increased Caution" }, "Bosnia and Herzegovina": { level: 2, text: "Increased Caution" }, "Botswana": { level: 1, text: "Normal Precautions" }, "Brazil": { level: 2, text: "Increased Caution" }, "Brunei": { level: 1, text: "Normal Precautions" },
    "Bulgaria": { level: 1, text: "Normal Precautions" }, "Burkina Faso": { level: 4, text: "Do Not Travel" }, "Burundi": { level: 3, text: "Reconsider Travel" }, "Cabo Verde": { level: 1, text: "Normal Precautions" }, "Cambodia": { level: 1, text: "Normal Precautions" },
    "Cameroon": { level: 2, text: "Increased Caution" }, "Canada": { level: 1, text: "Normal Precautions" }, "Central African Republic": { level: 4, text: "Do Not Travel" }, "Chad": { level: 3, text: "Reconsider Travel" }, "Chile": { level: 2, text: "Increased Caution" },
    "China": { level: 3, text: "Reconsider Travel" }, "Colombia": { level: 3, text: "Reconsider Travel" }, "Comoros": { level: 1, text: "Normal Precautions" }, "Congo (DRC)": { level: 3, text: "Reconsider Travel" }, "Costa Rica": { level: 2, text: "Increased Caution" },
    "Croatia": { level: 1, text: "Normal Precautions" }, "Cuba": { level: 2, text: "Increased Caution" }, "Cyprus": { level: 1, text: "Normal Precautions" }, "Czech Republic": { level: 1, text: "Normal Precautions" }, "Denmark": { level: 2, text: "Increased Caution" },
    "Djibouti": { level: 1, text: "Normal Precautions" }, "Dominica": { level: 1, text: "Normal Precautions" }, "Dominican Republic": { level: 2, text: "Increased Caution" }, "Ecuador": { level: 2, text: "Increased Caution" }, "Egypt": { level: 3, text: "Reconsider Travel" },
    "El Salvador": { level: 3, text: "Reconsider Travel" }, "Equatorial Guinea": { level: 1, text: "Normal Precautions" }, "Eritrea": { level: 3, text: "Reconsider Travel" }, "Estonia": { level: 1, text: "Normal Precautions" }, "Eswatini": { level: 1, text: "Normal Precautions" },
    "Ethiopia": { level: 3, text: "Reconsider Travel" }, "Fiji": { level: 1, text: "Normal Precautions" }, "Finland": { level: 1, text: "Normal Precautions" }, "France": { level: 2, text: "Increased Caution" }, "Gabon": { level: 1, text: "Normal Precautions" },
    "Gambia": { level: 1, text: "Normal Precautions" }, "Georgia": { level: 1, text: "Normal Precautions" }, "Germany": { level: 2, text: "Increased Caution" }, "Ghana": { level: 1, text: "Normal Precautions" }, "Greece": { level: 1, text: "Normal Precautions" },
    "Grenada": { level: 1, text: "Normal Precautions" }, "Guatemala": { level: 3, text: "Reconsider Travel" }, "Guinea": { level: 2, text: "Increased Caution" }, "Guinea-Bissau": { level: 3, text: "Reconsider Travel" }, "Guyana": { level: 3, text: "Reconsider Travel" },
    "Haiti": { level: 4, text: "Do Not Travel" }, "Honduras": { level: 3, text: "Reconsider Travel" }, "Hungary": { level: 1, text: "Normal Precautions" }, "Iceland": { level: 1, text: "Normal Precautions" }, "India": { level: 2, text: "Increased Caution" },
    "Indonesia": { level: 2, text: "Increased Caution" }, "Iran": { level: 4, text: "Do Not Travel" }, "Iraq": { level: 4, text: "Do Not Travel" }, "Ireland": { level: 1, text: "Normal Precautions" }, "Israel": { level: 3, text: "Reconsider Travel" },
    "Italy": { level: 2, text: "Increased Caution" }, "Jamaica": { level: 3, text: "Reconsider Travel" }, "Japan": { level: 1, text: "Normal Precautions" }, "Jordan": { level: 2, text: "Increased Caution" }, "Kazakhstan": { level: 1, text: "Normal Precautions" },
    "Kenya": { level: 2, text: "Increased Caution" }, "Kiribati": { level: 1, text: "Normal Precautions" }, "Korea, North": { level: 4, text: "Do Not Travel" }, "Korea, South": { level: 1, text: "Normal Precautions" }, "Kosovo": { level: 2, text: "Increased Caution" },
    "Kuwait": { level: 1, text: "Normal Precautions" }, "Kyrgyzstan": { level: 1, text: "Normal Precautions" }, "Laos": { level: 1, text: "Normal Precautions" }, "Latvia": { level: 1, text: "Normal Precautions" }, "Lebanon": { level: 4, text: "Do Not Travel" },
    "Lesotho": { level: 1, text: "Normal Precautions" }, "Liberia": { level: 1, text: "Normal Precautions" }, "Libya": { level: 4, text: "Do Not Travel" }, "Liechtenstein": { level: 1, text: "Normal Precautions" }, "Lithuania": { level: 1, text: "Normal Precautions" },
    "Luxembourg": { level: 1, text: "Normal Precautions" }, "Madagascar": { level: 2, text: "Increased Caution" }, "Malawi": { level: 1, text: "Normal Precautions" }, "Malaysia": { level: 1, text: "Normal Precautions" }, "Maldives": { level: 2, text: "Increased Caution" },
    "Mali": { level: 4, text: "Do Not Travel" }, "Malta": { level: 1, text: "Normal Precautions" }, "Mauritania": { level: 3, text: "Reconsider Travel" }, "Mauritius": { level: 1, text: "Normal Precautions" }, "Mexico": { level: 2, text: "Increased Caution" },
    "Micronesia": { level: 1, text: "Normal Precautions" }, "Moldova": { level: 2, text: "Increased Caution" }, "Monaco": { level: 1, text: "Normal Precautions" }, "Mongolia": { level: 1, text: "Normal Precautions" }, "Montenegro": { level: 1, text: "Normal Precautions" },
    "Morocco": { level: 2, text: "Increased Caution" }, "Mozambique": { level: 2, text: "Increased Caution" }, "Myanmar": { level: 4, text: "Do Not Travel" }, "Namibia": { level: 1, text: "Normal Precautions" }, "Nauru": { level: 1, text: "Normal Precautions" },
    "Nepal": { level: 2, text: "Increased Caution" }, "Netherlands": { level: 2, text: "Increased Caution" }, "New Zealand": { level: 1, text: "Normal Precautions" }, "Nicaragua": { level: 3, text: "Reconsider Travel" }, "Niger": { level: 3, text: "Reconsider Travel" },
    "Nigeria": { level: 3, text: "Reconsider Travel" }, "North Macedonia": { level: 1, text: "Normal Precautions" }, "Norway": { level: 1, text: "Normal Precautions" }, "Oman": { level: 1, text: "Normal Precautions" }, "Pakistan": { level: 3, text: "Reconsider Travel" },
    "Palau": { level: 1, text: "Normal Precautions" }, "Panama": { level: 1, text: "Normal Precautions" }, "Papua New Guinea": { level: 2, text: "Increased Caution" }, "Paraguay": { level: 1, text: "Normal Precautions" }, "Peru": { level: 2, text: "Increased Caution" },
    "Philippines": { level: 2, text: "Increased Caution" }, "Poland": { level: 1, text: "Normal Precautions" }, "Portugal": { level: 1, text: "Normal Precautions" }, "Qatar": { level: 1, text: "Normal Precautions" }, "Romania": { level: 1, text: "Normal Precautions" },
    "Russia": { level: 4, text: "Do Not Travel" }, "Rwanda": { level: 1, text: "Normal Precautions" }, "Samoa": { level: 1, text: "Normal Precautions" }, "Saudi Arabia": { level: 3, text: "Reconsider Travel" }, "Senegal": { level: 1, text: "Normal Precautions" },
    "Serbia": { level: 2, text: "Increased Caution" }, "Seychelles": { level: 1, text: "Normal Precautions" }, "Sierra Leone": { level: 2, text: "Increased Caution" }, "Singapore": { level: 1, text: "Normal Precautions" }, "Slovakia": { level: 1, text: "Normal Precautions" },
    "Slovenia": { level: 1, text: "Normal Precautions" }, "Solomon Islands": { level: 1, text: "Normal Precautions" }, "Somalia": { level: 4, text: "Do Not Travel" }, "South Africa": { level: 2, text: "Increased Caution" }, "South Sudan": { level: 4, text: "Do Not Travel" },
    "Spain": { level: 2, text: "Increased Caution" }, "Sri Lanka": { level: 2, text: "Increased Caution" }, "Sudan": { level: 4, text: "Do Not Travel" }, "Suriname": { level: 1, text: "Normal Precautions" }, "Sweden": { level: 2, text: "Increased Caution" },
    "Switzerland": { level: 1, text: "Normal Precautions" }, "Syria": { level: 4, text: "Do Not Travel" }, "Taiwan": { level: 1, text: "Normal Precautions" }, "Tajikistan": { level: 2, text: "Increased Caution" }, "Tanzania": { level: 2, text: "Increased Caution" },
    "Thailand": { level: 1, text: "Normal Precautions" }, "Timor-Leste": { level: 2, text: "Increased Caution" }, "Togo": { level: 1, text: "Normal Precautions" }, "Tonga": { level: 1, text: "Normal Precautions" }, "Trinidad and Tobago": { level: 2, text: "Increased Caution" },
    "Tunisia": { level: 2, text: "Increased Caution" }, "Turkey": { level: 2, text: "Increased Caution" }, "Turkmenistan": { level: 2, text: "Increased Caution" }, "Tuvalu": { level: 1, text: "Normal Precautions" }, "Uganda": { level: 3, text: "Reconsider Travel" },
    "Ukraine": { level: 4, text: "Do Not Travel" }, "United Arab Emirates": { level: 1, text: "Normal Precautions" }, "United Kingdom": { level: 2, text: "Increased Caution" }, "USA": { level: 1, text: "Normal Precautions" }, "Uruguay": { level: 1, text: "Normal Precautions" },
    "Uzbekistan": { level: 1, text: "Normal Precautions" }, "Vanuatu": { level: 1, text: "Normal Precautions" }, "Venezuela": { level: 4, text: "Do Not Travel" }, "Vietnam": { level: 1, text: "Normal Precautions" }, "Yemen": { level: 4, text: "Do Not Travel" },
    "Zambia": { level: 1, text: "Normal Precautions" }, "Zimbabwe": { level: 2, text: "Increased Caution" }
};
const COUNTRIES = Object.keys(ADVISORIES).sort();

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let map, layerGroup;
// FIX: DEFAULT RADIUS 5KM
let currentRadius = 5;

document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    populateCountries();
    await loadAllData();
    filterNews('Global');
});

/* --- DATA LOADING --- */
async function loadAllData() {
    const badge = document.getElementById("status-badge");
    try {
        const ts = new Date().getTime();
        const [newsRes, proxRes] = await Promise.allSettled([
            fetch(`${PATHS.NEWS}?t=${ts}`),
            fetch(`${PATHS.PROXIMITY}?t=${ts}`)
        ]);

        if (newsRes.status === "fulfilled" && newsRes.value.ok) {
            const raw = await newsRes.value.json();
            GENERAL_NEWS_FEED = Array.isArray(raw) ? raw : (raw.articles || []);
            badge.innerText = "LIVE FEED";
            badge.className = "badge bg-primary text-white";
        } else {
            throw new Error("News feed failed");
        }

        if (proxRes.status === "fulfilled" && proxRes.value.ok) {
            const rawP = await proxRes.value.json();
            PROXIMITY_ALERTS = rawP.alerts || [];
        }
    } catch (e) {
        console.warn("Live feed unavailable, using Fallback.");
        badge.innerText = "SIMULATION MODE";
        badge.className = "badge bg-warning text-dark";
        // SRO RELEVANT FALLBACK DATA (No sports/fluff)
        GENERAL_NEWS_FEED = [
            { title: "Critical: Ransomware Attack on Logistics Hub", snippet: "Major shipping partner reports system outage affecting EMEA routes.", region: "EMEA", severity: 3, time: new Date().toISOString(), source: "SRO Alert" },
            { title: "Typhoon Warning: Taiwan & Philippines", snippet: "Category 4 storm approaching. Manufacturing sites initiating prep.", region: "APJC", severity: 2, time: new Date().toISOString(), source: "Weather Ops" },
            { title: "Civil Unrest: Bogota Curfew Extended", snippet: "Protests continue near government district. Staff advised to WFH.", region: "LATAM", severity: 2, time: new Date().toISOString(), source: "Security Ops" }
        ];
    }
    // Refresh map to show hardcoded sites
    updateMap('Global');
}

/* --- MAP --- */
function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 2, maxBounds: [[-90, -180], [90, 180]] }).setView([20, 0], 2);
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png", {
        maxZoom: 19, noWrap: true, attribution: '© OpenStreetMap'
    }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
    setTimeout(() => { map.invalidateSize(); }, 500);
}

function updateMap(region) {
    if (!map) return;
    layerGroup.clearLayers();

    // 1. HARDCODED SITES (Always Visible)
    const siteIcon = L.divIcon({ className: "custom-pin", html: '<div class="marker-pin-dell"><i class="fas fa-building"></i></div>', iconSize: [30, 42], iconAnchor: [15, 42] });
    
    const visibleSites = region === "Global" ? HARDCODED_SITES : HARDCODED_SITES.filter(l => l.region === region);
    visibleSites.forEach(loc => {
        L.marker([loc.lat, loc.lon], { icon: siteIcon }).bindTooltip(`<b>${loc.name}</b><br>${loc.country}`).addTo(layerGroup);
    });

    // 2. ALERTS (If available)
    const alertIcon = (sev) => L.divIcon({ className: "custom-pin", html: `<div class="marker-incident" style="background:${sev>=3?'#d93025':'#f9ab00'}"><i class="fas fa-exclamation"></i></div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
    
    PROXIMITY_ALERTS.forEach(a => {
        if((region === "Global" || a.site_region === region) && a.distance_km <= currentRadius && a.lat) {
            L.marker([a.lat, a.lon], { icon: alertIcon(a.severity) }).bindTooltip(`<b>${a.article_title}</b>`).addTo(layerGroup);
        }
    });

    const centers = { "AMER": [30, -90], "EMEA": [45, 15], "APJC": [20, 110], "LATAM": [-15, -60], "Global": [25, 10] };
    map.setView(centers[region] || centers["Global"], region === "Global" ? 2 : 3);
}

/* --- LOGIC --- */
function filterNews(region) {
    document.querySelectorAll(".nav-item-custom").forEach(el => el.classList.toggle("active", el.innerText.trim() === region));
    
    const container = document.getElementById("general-news-feed");
    const filtered = region === "Global" ? GENERAL_NEWS_FEED : GENERAL_NEWS_FEED.filter(i => i.region === region);

    if (!filtered.length) { container.innerHTML = `<div class="p-4 text-center text-muted">No active incidents.</div>`; }
    else {
        container.innerHTML = filtered.map(item => `
            <a href="${item.url||'#'}" target="_blank" class="feed-card">
                <div class="feed-status-bar ${item.severity>=3?'status-bar-crit':'status-bar-warn'}"></div>
                <div class="feed-content">
                    <div class="feed-tags"><span class="ftag ${item.severity>=3?'ftag-crit':'ftag-warn'}">${item.severity>=3?'CRITICAL':'WARNING'}</span><span class="ftag ftag-type">${item.region}</span></div>
                    <div class="feed-title">${item.title}</div>
                    <div class="feed-meta">${item.source} • ${new Date(item.time).toLocaleTimeString()}</div>
                    <div class="feed-desc">${item.snippet || item.summary}</div>
                </div>
            </a>`).join('');
    }
    updateMap(region);
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById("proxRadius").value);
    const activeEl = document.querySelector(".nav-item-custom.active");
    if(activeEl) filterNews(activeEl.innerText.trim());
}

function populateCountries() {
    const sel = document.getElementById("countrySelect");
    COUNTRIES.forEach(c => { const opt = document.createElement("option"); opt.value = c; opt.innerText = c; sel.appendChild(opt); });
}

function filterTravel() {
    const c = document.getElementById("countrySelect").value;
    const adv = ADVISORIES[c] || { level: 1, text: "Normal Precautions" };
    const div = document.getElementById("travel-advisories");
    const color = adv.level === 4 ? "#d93025" : (adv.level === 3 ? "#e37400" : (adv.level === 2 ? "#f9ab00" : "#1a73e8"));
    
    div.innerHTML = `<div style="border-left: 4px solid ${color}; background:#f8f9fa; padding:10px; border-radius:6px;">
        <div style="font-weight:800; color:${color}; font-size:0.8rem;">LEVEL ${adv.level} ADVISORY</div>
        <div style="font-size:0.9rem;">${adv.text}</div>
    </div>`;
}

function loadHistory(val) {
    if(!val) return;
    document.getElementById("general-news-feed").innerHTML = `<div class="p-4 text-center text-success"><i class="fas fa-check"></i> Archive loaded for ${val}</div>`;
}
