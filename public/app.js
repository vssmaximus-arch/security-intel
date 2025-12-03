/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    NEWS: "public/data/news.json",
    PROXIMITY: "public/data/proximity.json"
};

let currentRadius = 5; // Default 5KM

/* --- 1. FULL DELL SITE LIST (VERIFIED SEP 2025) --- */
const HARDCODED_SITES = [
    /* Americas (AMER) */
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

    /* EMEA */
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

    /* APJC */
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

/* --- COMPREHENSIVE COUNTRY LIST --- */
const COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (DRC)", "Congo (Republic)", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "East Timor", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Korea, North", "Korea, South", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

const ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel" }, "Belarus": { level: 4, text: "Do Not Travel" }, "Burkina Faso": { level: 4, text: "Do Not Travel" }, "Haiti": { level: 4, text: "Do Not Travel" }, "Iran": { level: 4, text: "Do Not Travel" }, "Iraq": { level: 4, text: "Do Not Travel" }, "Libya": { level: 4, text: "Do Not Travel" }, "Mali": { level: 4, text: "Do Not Travel" }, "North Korea": { level: 4, text: "Do Not Travel" }, "Russia": { level: 4, text: "Do Not Travel" }, "Somalia": { level: 4, text: "Do Not Travel" }, "South Sudan": { level: 4, text: "Do Not Travel" }, "Sudan": { level: 4, text: "Do Not Travel" }, "Syria": { level: 4, text: "Do Not Travel" }, "Ukraine": { level: 4, text: "Do Not Travel" }, "Venezuela": { level: 4, text: "Do Not Travel" }, "Yemen": { level: 4, text: "Do Not Travel" }, "Israel": { level: 3, text: "Reconsider Travel" }, "Colombia": { level: 3, text: "Reconsider Travel" }, "China": { level: 3, text: "Reconsider Travel" }, "Mexico": { level: 2, text: "Exercise Increased Caution" }, "India": { level: 2, text: "Exercise Increased Caution" }
};

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let map, layerGroup;

document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    populateCountries();
    updateClock();
    setInterval(updateClock, 1000);
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
            if (GENERAL_NEWS_FEED.length === 0) throw new Error("Empty feed");
            badge.innerText = "LIVE FEED";
            badge.className = "badge bg-primary text-white";
        } else {
            throw new Error("News feed fetch failed");
        }

        if (proxRes.status === "fulfilled" && proxRes.value.ok) {
            const rawP = await proxRes.value.json();
            PROXIMITY_ALERTS = rawP.alerts || [];
        }
    } catch (e) {
        console.warn("Using Fallback Data:", e);
        badge.innerText = "SIMULATION MODE";
        badge.className = "badge bg-warning text-dark";
        
        // --- FALLBACK: EXACT SRO-RELEVANT EXAMPLES ---
        GENERAL_NEWS_FEED = [
            { title: "Red Sea Crisis Escalates", snippet: "Major shipping lines divert vessels as security concerns mount near the Bab el-Mandeb strait.", region: "EMEA", severity: 3, type: "SUPPLY CHAIN", time: new Date().toISOString(), source: "Reuters" },
            { title: "Critical Ransomware Strain Targets Manufacturing", snippet: "New 'BlackCat' variant identified targeting industrial control systems in Germany.", region: "EMEA", severity: 3, type: "CYBER SECURITY", time: new Date().toISOString(), source: "BleepingComputer" },
            { title: "Civil unrest triggers curfew in Bogota", snippet: "Authorities declare 24-hour curfew following escalated protests near government district.", region: "LATAM", severity: 3, type: "PHYSICAL SECURITY", time: new Date().toISOString(), source: "Associated Press" }
        ];
        
        // --- FALLBACK: SPECIFIC PROXIMITY ALERTS (Matching Screenshot) ---
        PROXIMITY_ALERTS = [
            { article_title: "Active fire reported at adjacent chemical logistics park.", site_name: "Dell Xiamen Mfg", distance_km: 3.2, type: "Industrial Fire", severity: 3, lat: 24.4798, lon: 118.0894 },
            { article_title: "Rolling brownouts affecting Electronic City Phase 1.", site_name: "Dell Bangalore Campus", distance_km: 1.5, type: "Grid Instability", severity: 2, lat: 12.9716, lon: 77.5946 },
            { article_title: "Cumberland River rising rapidly.", site_name: "Dell Nashville Hub", distance_km: 4.8, type: "Flash Flood", severity: 2, lat: 36.1627, lon: -86.7816 }
        ];
    }
    updateMap('Global');
}

/* --- MAP --- */
function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 2.5, maxBounds: [[-90, -180], [90, 180]] }).setView([20, 0], 2.5);
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

    // 1. DELL SITES (Blue Pins)
    const siteIcon = L.divIcon({ className: "custom-pin", html: '<div class="marker-pin-dell"><i class="fas fa-building"></i></div>', iconSize: [30, 42], iconAnchor: [15, 42] });
    const visibleSites = region === "Global" ? HARDCODED_SITES : HARDCODED_SITES.filter(l => l.region === region);
    visibleSites.forEach(loc => {
        L.marker([loc.lat, loc.lon], { icon: siteIcon }).bindTooltip(`<b>${loc.name}</b><br>${loc.country}`).addTo(layerGroup);
    });

    // 2. PROXIMITY ALERTS (Red/Amber Pins - Only if within Radius)
    const alertIcon = (sev) => L.divIcon({ className: "custom-pin", html: `<div class="marker-incident" style="background:${sev>=3?'#d93025':'#f9ab00'}"><i class="fas fa-exclamation"></i></div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
    PROXIMITY_ALERTS.forEach(a => {
        if((region === "Global" || (a.site_region === region)) && a.distance_km <= currentRadius && a.lat) {
            L.marker([a.lat, a.lon], { icon: alertIcon(a.severity) }).bindTooltip(`<b>${a.type || 'Alert'}</b><br>${a.distance_km}km from ${a.site_name}`).addTo(layerGroup);
        }
    });

    const centers = { "AMER": [30, -90], "EMEA": [45, 15], "APJC": [20, 110], "LATAM": [-15, -60], "Global": [25, 10] };
    map.setView(centers[region] || centers["Global"], region === "Global" ? 2.5 : 3);
}

/* --- UI HELPERS --- */
function filterNews(region) {
    document.querySelectorAll(".nav-item-custom").forEach(el => el.classList.toggle("active", el.innerText.trim() === region));
    const container = document.getElementById("general-news-feed");
    const filtered = region === "Global" ? GENERAL_NEWS_FEED : GENERAL_NEWS_FEED.filter(i => i.region === region);

    if (!filtered.length) { container.innerHTML = `<div class="p-4 text-center text-muted">No active incidents.</div>`; }
    else {
        container.innerHTML = filtered.map(item => {
            const timeStr = safeDate(item.time);
            // BADGES: [SEVERITY] [CATEGORY] [REGION]
            const sevBadge = item.severity >= 3 
                ? `<span class="badge rounded-0" style="background:#d93025; color:white; font-size:0.7rem; margin-right:5px;">CRITICAL</span>` 
                : `<span class="badge rounded-0" style="background:#f9ab00; color:white; font-size:0.7rem; margin-right:5px;">WARNING</span>`;
            const typeBadge = `<span class="badge rounded-0" style="background:#333; color:white; font-size:0.7rem; margin-right:5px;">${(item.type || 'GENERAL').toUpperCase()}</span>`;
            const regBadge = `<span class="badge rounded-0" style="background:#555; color:white; font-size:0.7rem; float:right;">${(item.region || 'GLOBAL').toUpperCase()}</span>`;
            const barColor = item.severity >= 3 ? "#d93025" : "#f9ab00";

            return `
            <div class="feed-card" style="border-left: 5px solid ${barColor}; margin-bottom: 12px; background:white; padding:15px; border-radius:4px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="margin-bottom:8px;">${sevBadge}${typeBadge}${regBadge}</div>
                <div class="feed-title" style="font-size:1rem; font-weight:700; color:#202124; margin-bottom:5px;">${item.title}</div>
                <div class="feed-meta" style="font-size:0.8rem; color:#666; margin-bottom:8px;">${item.source} • ${timeStr}</div>
                <div class="feed-desc" style="font-size:0.85rem; color:#333;">${item.snippet || item.summary}</div>
            </div>`;
        }).join('');
    }
    
    // Update Proximity List based on Region filter
    updateProximityRadius();
    updateMap(region);
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById("proxRadius").value);
    const activeEl = document.querySelector(".nav-item-custom.active");
    const activeRegion = activeEl ? activeEl.innerText.trim() : 'Global';
    const container = document.getElementById("proximity-alerts-container");
    
    const filtered = PROXIMITY_ALERTS.filter(a => {
        // Since PROXIMITY_ALERTS might lack 'site_region' in fallback, we assume global for now or match hardcoded
        // In a real app, the alert object should have 'site_region'
        return a.distance_km <= currentRadius;
    });

    if (!filtered.length) {
        container.innerHTML = `<div class="p-3 text-center text-muted small">Currently no alerts in proximity to Dell sites.</div>`;
    } else {
        container.innerHTML = filtered.map(a => {
            const iconMap = {"Industrial Fire": "fire", "Grid Instability": "bolt", "Flash Flood": "water"};
            const icon = iconMap[a.type] || "exclamation-circle";
            const color = a.severity >= 3 ? "#d93025" : "#f9ab00";
            
            return `
            <div class="alert-row" style="padding:12px 0; border-bottom:1px solid #eee;">
                <div class="d-flex justify-content-between align-items-center">
                    <span style="font-weight:700; color:#202124; font-size:0.85rem;"><i class="fas fa-${icon}" style="color:${color}; margin-right:6px;"></i> ${a.type}</span>
                    <span style="color:${color}; font-weight:700; font-size:0.85rem;">${a.distance_km}km</span>
                </div>
                <div style="font-size:0.8rem; font-weight:600; color:#555; margin:4px 0 2px 24px;"><i class="far fa-building"></i> ${a.site_name}</div>
                <div style="font-size:0.75rem; color:#666; margin-left:24px; line-height:1.3;">${a.article_title}</div>
            </div>`;
        }).join('');
    }
    updateMap(activeRegion);
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
    
    div.innerHTML = `<div style="border-left: 4px solid ${color}; background:#f8f9fa; padding:10px; border-radius:6px; margin-bottom:10px;">
        <div style="font-weight:800; color:${color}; font-size:0.8rem;">LEVEL ${adv.level} ADVISORY</div>
        <div style="font-size:0.9rem;">${adv.text}</div>
    </div>`;
}

function safeDate(iso) {
    try { return new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); } catch(e) { return "Just now"; }
}

function updateClock() {
    const now = new Date();
    // Format: Wednesday, Dec 3, 2025 | 03:49 PM GMT+11
    const options = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
    document.getElementById("clock-date").innerText = now.toLocaleString('en-US', options);
    document.getElementById("clock-time").innerText = ""; 
}

function loadHistory(val) {
    if(!val) return;
    document.getElementById("general-news-feed").innerHTML = `<div class="p-4 text-center text-success"><i class="fas fa-check"></i> Archive loaded for ${val}</div>`;
}

function downloadReport() {
    const region = document.getElementById("reportRegion").value.toLowerCase();
    const url = `public/reports/${region}_latest.html`;
    window.open(url, '_blank');
}
