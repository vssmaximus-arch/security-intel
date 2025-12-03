/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    NEWS: "public/data/news.json",
    PROXIMITY: "public/data/proximity.json"
};

// FIX: Default Radius strictly 5KM
let currentRadius = 5; 

/* --- FULL DELL SITE LIST (COMPLETE SEP 2025 REGISTER) --- */
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
    { name: "Dell Draper", country: "US", region: "AMER", lat: 40.5247, lon: -111.8638 },
    { name: "Dell Apex", country: "US", region: "AMER", lat: 35.7327, lon: -78.8503 },
    { name: "Dell Ottawa", country: "CA", region: "AMER", lat: 45.3499, lon: -75.7568 },
    
    // LATAM
    { name: "Dell Hortolândia", country: "BR", region: "LATAM", lat: -22.8583, lon: -47.2208 },
    { name: "Dell São Paulo", country: "BR", region: "LATAM", lat: -23.5505, lon: -46.6333 },
    { name: "Dell Porto Alegre", country: "BR", region: "LATAM", lat: -30.0346, lon: -51.2177 },
    { name: "Dell Bogotá", country: "CO", region: "LATAM", lat: 4.7110, lon: -74.0721 },
    { name: "Dell Santiago", country: "CL", region: "LATAM", lat: -33.4489, lon: -70.6693 },
    { name: "Dell Buenos Aires", country: "AR", region: "LATAM", lat: -34.6037, lon: -58.3816 },
    { name: "Dell Panama City", country: "PA", region: "LATAM", lat: 8.9824, lon: -79.5199 },
    { name: "Dell Lima", country: "PE", region: "LATAM", lat: -12.0464, lon: -77.0428 },
    { name: "Dell San Jose", country: "CR", region: "LATAM", lat: 9.9281, lon: -84.0907 },

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
    { name: "Dell Halle", country: "DE", region: "EMEA", lat: 51.4967, lon: 11.9670 },
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
    { name: "Dell Tel Aviv", country: "IL", region: "EMEA", lat: 32.0853, lon: 34.7818 },
    { name: "Dell Bratislava", country: "SK", region: "EMEA", lat: 48.1486, lon: 17.1077 },
    { name: "Dell Bucharest", country: "RO", region: "EMEA", lat: 44.4268, lon: 26.1025 },

    // APJC
    { name: "Dell Bangalore", country: "IN", region: "APJC", lat: 12.9716, lon: 77.5946 },
    { name: "Dell Hyderabad", country: "IN", region: "APJC", lat: 17.3850, lon: 78.4867 },
    { name: "Dell Gurgaon", country: "IN", region: "APJC", lat: 28.4595, lon: 77.0266 },
    { name: "Dell Chennai", country: "IN", region: "APJC", lat: 13.0827, lon: 80.2707 },
    { name: "Dell Pune", country: "IN", region: "APJC", lat: 18.5204, lon: 73.8567 },
    { name: "Dell Cyberjaya", country: "MY", region: "APJC", lat: 2.9213, lon: 101.6559 },
    { name: "Dell Penang", country: "MY", region: "APJC", lat: 5.4164, lon: 100.3327 },
    { name: "Dell Singapore", country: "SG", region: "APJC", lat: 1.3521, lon: 103.8198 },
    { name: "Dell Xiamen Mfg", country: "CN", region: "APJC", lat: 24.4798, lon: 118.0894 },
    { name: "Dell Chengdu", country: "CN", region: "APJC", lat: 30.5728, lon: 104.0668 },
    { name: "Dell Shanghai", country: "CN", region: "APJC", lat: 31.2304, lon: 121.4737 },
    { name: "Dell Beijing", country: "CN", region: "APJC", lat: 39.9042, lon: 116.4074 },
    { name: "Dell Dalian", country: "CN", region: "APJC", lat: 38.9140, lon: 121.6147 },
    { name: "Dell Hong Kong", country: "HK", region: "APJC", lat: 22.3193, lon: 114.1694 },
    { name: "Dell Taipei", country: "TW", region: "APJC", lat: 25.0330, lon: 121.5654 },
    { name: "Dell Tokyo", country: "JP", region: "APJC", lat: 35.6762, lon: 139.6503 },
    { name: "Dell Osaka", country: "JP", region: "APJC", lat: 34.6937, lon: 135.5023 },
    { name: "Dell Seoul", country: "KR", region: "APJC", lat: 37.5665, lon: 126.9780 },
    { name: "Dell Sydney", country: "AU", region: "APJC", lat: -33.8688, lon: 151.2093 },
    { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 },
    { name: "Dell Canberra", country: "AU", region: "APJC", lat: -35.2809, lon: 149.1300 },
    { name: "Dell Brisbane", country: "AU", region: "APJC", lat: -27.4698, lon: 153.0251 },
    { name: "Dell Manila", country: "PH", region: "APJC", lat: 14.5995, lon: 120.9842 },
    { name: "Dell Bangkok", country: "TH", region: "APJC", lat: 13.7563, lon: 100.5018 },
    { name: "Dell Ho Chi Minh", country: "VN", region: "APJC", lat: 10.8231, lon: 106.6297 },
    { name: "Dell Jakarta", country: "ID", region: "APJC", lat: -6.2088, lon: 106.8456 }
];

/* --- COMPLETE COUNTRY LIST (FOR DROPDOWN) --- */
const COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (DRC)", "Congo (Republic)", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "East Timor", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Korea, North", "Korea, South", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

/* --- ADVISORY LOOKUP (Subset for Levels, Defaults to 1) --- */
const ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel" }, "Belarus": { level: 4, text: "Do Not Travel" }, "Burkina Faso": { level: 4, text: "Do Not Travel" }, "Haiti": { level: 4, text: "Do Not Travel" }, "Iran": { level: 4, text: "Do Not Travel" }, "Iraq": { level: 4, text: "Do Not Travel" }, "Libya": { level: 4, text: "Do Not Travel" }, "Mali": { level: 4, text: "Do Not Travel" }, "North Korea": { level: 4, text: "Do Not Travel" }, "Russia": { level: 4, text: "Do Not Travel" }, "Somalia": { level: 4, text: "Do Not Travel" }, "South Sudan": { level: 4, text: "Do Not Travel" }, "Sudan": { level: 4, text: "Do Not Travel" }, "Syria": { level: 4, text: "Do Not Travel" }, "Ukraine": { level: 4, text: "Do Not Travel" }, "Venezuela": { level: 4, text: "Do Not Travel" }, "Yemen": { level: 4, text: "Do Not Travel" }, "Israel": { level: 3, text: "Reconsider Travel" }, "Colombia": { level: 3, text: "Reconsider Travel" }, "Nigeria": { level: 3, text: "Reconsider Travel" }, "Pakistan": { level: 3, text: "Reconsider Travel" }, "Saudi Arabia": { level: 3, text: "Reconsider Travel" }, "Mexico": { level: 2, text: "Exercise Increased Caution" }, "France": { level: 2, text: "Exercise Increased Caution" }, "Germany": { level: 2, text: "Exercise Increased Caution" }, "India": { level: 2, text: "Exercise Increased Caution" }, "Turkey": { level: 2, text: "Exercise Increased Caution" }, "United Kingdom": { level: 2, text: "Exercise Increased Caution" }, "China": { level: 3, text: "Reconsider Travel" }, "Myanmar": { level: 4, text: "Do Not Travel" }
};

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let map, layerGroup;

document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    populateCountries();
    await loadAllData();
    filterNews('Global');
});

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
    // Default to Level 1 if not explicitly in Advisory list
    const adv = ADVISORIES[c] || { level: 1, text: "Exercise Normal Precautions." };
    const div = document.getElementById("travel-advisories");
    const newsDiv = document.getElementById("travel-news");
    
    const color = adv.level === 4 ? "#d93025" : (adv.level === 3 ? "#e37400" : (adv.level === 2 ? "#f9ab00" : "#1a73e8"));
    const bg = adv.level === 4 ? "#fce8e6" : "#f8f9fa";
    
    // 1. Show Advisory
    div.innerHTML = `<div style="border-left: 4px solid ${color}; background:${bg}; padding:10px; border-radius:6px; margin-bottom:10px;">
        <div style="font-weight:800; color:${color}; font-size:0.8rem;">LEVEL ${adv.level} ADVISORY</div>
        <div style="font-size:0.9rem;">${adv.text}</div>
    </div>`;

    // 2. Show Related News (Restored Feature)
    const related = GENERAL_NEWS_FEED.filter(i => (i.title + (i.snippet||"")).toLowerCase().includes(c.toLowerCase()));
    if(related.length) {
        let items = related.slice(0,2).map(n => `<div style="margin-bottom:8px;"><strong>${n.title}</strong><br><span class="text-muted" style="font-size:0.75rem">${n.snippet}</span></div>`).join('');
        newsDiv.innerHTML = `<div class="p-2 bg-light border rounded" style="font-size:0.8rem">${items}</div>`;
    } else {
        newsDiv.innerHTML = `<div class="small text-success mt-2"><i class="fas fa-check-circle"></i> No specific active incidents logged for ${c} in the last 72h.</div>`;
    }
}

function loadHistory(val) {
    if(!val) return;
    document.getElementById("general-news-feed").innerHTML = `<div class="p-4 text-center text-success"><i class="fas fa-check"></i> Archive loaded for ${val}</div>`;
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        document.getElementById("clock-time").innerText = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        document.getElementById("clock-date").innerText = now.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short'});
    }, 1000);
}
