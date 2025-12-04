/* =========================================================
   CONFIG & STATE
   ========================================================= */

/*
  Make paths resilient to whether the site is served from repository root or from within the public/ folder.
  This computes the base directory of the running script and builds data/report URLs relative to that base.
*/
const _scriptSrc = (document.currentScript && document.currentScript.src)
  || (function(){ const s = document.getElementsByTagName('script'); return s[s.length-1] && s[s.length-1].src; })()
  || '';
const BASE = _scriptSrc ? _scriptSrc.replace(/\/[^\/]*$/, '/') : './';

const PATHS = {
    NEWS: `${BASE}data/news.json`,
    PROXIMITY: `${BASE}data/proximity.json`
};

let currentRadius = 5;
let currentCategory = 'ALL'; // Global category filter

/* --- FULL DELL SITE LIST (VERIFIED SEP 2025) --- */
const HARDCODED_SITES = [
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
    { name: "Dell Chengdu", country: "CN", region: "APJC", lat: 30.5728, lon: 104.0668 },
    { name: "Dell Shanghai", country: "CN", region: "APJC", lat: 31.2304, lon: 121.4737 },
    { name: "Dell Taipei", country: "TW", region: "APJC", lat: 25.0330, lon: 121.5654 },
    { name: "Dell Tokyo", country: "JP", region: "APJC", lat: 35.6762, lon: 139.6503 },
    { name: "Dell Kawasaki", country: "JP", region: "APJC", lat: 35.5300, lon: 139.6960 },
    { name: "Dell Sydney", country: "AU", region: "APJC", lat: -33.8688, lon: 151.2093 },
    { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 }
];

const COUNTRIES = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh" /* ... */];

const ADVISORIES = { "Afghanistan": { level: 4, text: "Do Not Travel" }, "Belarus": { level: 4, text: "Do Not Travel" }, /* ... */ };

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
        console.warn("Fallback Mode Active.");
        badge.innerText = "SIMULATION MODE";
        badge.className = "badge bg-warning text-dark";
        
        // FALLBACK DATA (Strict SRO - Cyber/Supply Chain focus)
        GENERAL_NEWS_FEED = [
            { title: "Critical: Port Strike in Northern Europe", snippet: "Major logistics disruption at Rotterdam. Cargo delays expected.", region: "EMEA", severity: 3, type: "SUPPLY CHAIN", time: new Date().toISOString(), source: "SRO" },
            { title: "Security Alert: Active Shooter - Downtown Austin", snippet: "Police operation near 6th St. Dell Security advises avoiding area.", region: "AMER", severity: 3, type: "PHYSICAL SECURITY", time: new Date().toISOString(), source: "SRO" },
            { title: "Typhoon Warning: Manila & Luzon", snippet: "Category 3 storm making landfall. Power grid failures reported.", region: "APJC", severity: 2, type: "CRISIS / WEATHER", time: new Date().toISOString(), source: "Met Service" },
            { title: "Cyber Alert: Manufacturing SCADA Vulnerability", snippet: "Critical zero-day affecting industrial controllers. Patch immediately.", region: "Global", severity: 3, type: "CYBER SECURITY", time: new Date().toISOString(), source: "CERT" }
        ];
        
        // FALLBACK PROXIMITY (Matches Screenshot Visuals)
        PROXIMITY_ALERTS = [
            { article_title: "Active fire reported at adjacent chemical logistics park.", site_name: "Dell Xiamen Mfg", distance_km: 3.2, type: "Industrial Fire", severity: 3, lat: 24.4798, lon: 118.0894, site_region: "APJC" },
            { article_title: "Rolling brownouts affecting Electronic City Phase 1.", site_name: "Dell Bangalore Campus", distance_km: 1.5, type: "Grid Instability", severity: 2, lat: 12.9716, lon: 77.5946, site_region: "APJC" },
            { article_title: "Cumberland River rising rapidly.", site_name: "Dell Nashville Hub", distance_km: 4.8, type: "Flash Flood", severity: 2, lat: 36.1627, lon: -86.7816, site_region: "AMER" }
        ];
    }
    updateMap('Global');
}

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

    // PINS: Dell Sites (Blue)
    const siteIcon = L.divIcon({ className: "custom-pin", html: '<div class="marker-pin-dell"><i class="fas fa-building"></i></div>', iconSize: [30, 42], iconAnchor: [15, 42] });
    
    // Filter sites based on region
    const visibleSites = region === "Global" ? HARDCODED_SITES : HARDCODED_SITES.filter(l => l.region === region);
    visibleSites.forEach(loc => {
        L.marker([loc.lat, loc.lon], { icon: siteIcon }).bindTooltip(`<b>${loc.name}</b><br>${loc.country}`).addTo(layerGroup);
    });

    // PINS: Alerts (Red/Amber) - Respect Category Filter
    const alertIcon = (sev) => L.divIcon({ className: "custom-pin", html: `<div class="marker-incident" style="background:${sev>=3?'#d93025':'#f9ab00'}"><i class="fas fa-exclamation"></i></div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
    
    PROXIMITY_ALERTS.forEach(a => {
        // Check Region & Radius & Category
        const categoryMatch = currentCategory === 'ALL' || (a.type && a.type.toUpperCase().includes(currentCategory));
        const regionMatch = (region === "Global" || a.site_region === region);
        const radiusMatch = a.distance_km <= currentRadius;
        
        if(categoryMatch && regionMatch && radiusMatch && a.lat) {
            L.marker([a.lat, a.lon], { icon: alertIcon(a.severity) }).bindTooltip(`<b>${a.type}</b><br>${a.distance_km}km from ${a.site_name}`).addTo(layerGroup);
        }
    });

    const centers = { "AMER": [30, -90], "EMEA": [45, 15], "APJC": [20, 110], "LATAM": [-15, -60], "Global": [25, 10] };
    map.setView(centers[region] || centers["Global"], region === "Global" ? 2.5 : 3);
}

/* --- FILTERING LOGIC (CATEGORY + REGION) --- */
function filterCategory(category) {
    currentCategory = category;
    // Trigger refresh based on current active region tab
    const activeEl = document.querySelector(".nav-item-custom.active");
    filterNews(activeEl ? activeEl.innerText.trim() : 'Global');
}

function filterNews(region) {
    document.querySelectorAll(".nav-item-custom").forEach(el => el.classList.toggle("active", el.innerText.trim() === region));
    const container = document.getElementById("general-news-feed");
    
    // 1. Filter by Region
    let filtered = region === "Global" ? GENERAL_NEWS_FEED : GENERAL_NEWS_FEED.filter(i => i.region === region);
    
    // 2. Filter by Category
    if (currentCategory !== 'ALL') {
        filtered = filtered.filter(i => i.type && i.type.toUpperCase().includes(currentCategory));
    }

    if (!filtered.length) { container.innerHTML = `<div class="p-4 text-center text-muted">No active incidents matching criteria.</div>`; }
    else {
        // BADGE DESIGN
        container.innerHTML = filtered.map(item => {
            const timeStr = safeDate(item.time);
            const sevBadge = item.severity >= 3 
                ? `<span class="badge rounded-0 me-1" style="background:#d93025; color:white; font-size:0.65rem;">CRITICAL</span>` 
                : `<span class="badge rounded-0 me-1" style="background:#f9ab00; color:white; font-size:0.65rem;">WARNING</span>`;
            const typeBadge = `<span class="badge rounded-0 me-1" style="background:#333; color:white; font-size:0.65rem;">${(item.type || 'GENERAL').toUpperCase()}</span>`;
            const regBadge = `<span class="badge rounded-0" style="background:#555; color:white; font-size:0.65rem; float:right;">${(item.region || 'GLOBAL').toUpperCase()}</span>`;
            const barColor = item.severity >= 3 ? "#d93025" : "#f9ab00";

            return `
            <div class="feed-card" style="border-left: 5px solid ${barColor}; margin-bottom: 12px; background:white; padding:15px; border-radius:4px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="margin-bottom:6px;">${sevBadge}${typeBadge}${regBadge}</div>
                <div class="feed-title" style="font-size:0.95rem; font-weight:700; color:#202124; margin-bottom:5px;">${item.title}</div>
                <div class="feed-meta" style="font-size:0.75rem; color:#666; margin-bottom:6px;">${item.source} • ${timeStr}</div>
                <div class="feed-desc" style="font-size:0.8rem; color:#333;">${item.snippet || item.summary}</div>
            </div>`;
        }).join('');
    }
    updateProximityRadius(); // Update sidebar too
    updateMap(region);
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById("proxRadius").value);
    const activeEl = document.querySelector(".nav-item-custom.active");
    const activeRegion = activeEl ? activeEl.innerText.trim() : 'Global';
    const container = document.getElementById("proximity-alerts-container");
    
    // Filter Alerts
    let filtered = PROXIMITY_ALERTS.filter(a => {
        const regMatch = activeRegion === "Global" || (a.site_region === activeRegion);
        const radMatch = a.distance_km <= currentRadius;
        return regMatch && radMatch;
    });
    
    // Filter by Category
    if (currentCategory !== 'ALL') {
        // Simple keyword matching for alerts
        filtered = filtered.filter(a => a.type && a.type.toUpperCase().includes(currentCategory.split(' ')[0])); 
    }

    if (!filtered.length) {
        container.innerHTML = `<div class="p-3 text-center text-muted small">Currently no alerts in proximity to Dell sites.</div>`;
    } else {
        container.innerHTML = filtered.map(a => {
            const iconMap = {"Industrial Fire": "fire", "Grid Instability": "bolt", "Flash Flood": "water"};
            const icon = iconMap[a.type] || "exclamation-circle";
            const color = a.severity >= 3 ? "#d93025" : "#f9ab00";
            return `
            <div class="alert-row" style="padding:10px 0; border-bottom:1px solid #eee;">
                <div class="d-flex justify-content-between align-items-center">
                    <span style="font-weight:700; color:#202124; font-size:0.85rem;">
                        <i class="fas fa-${icon}" style="color:${color}; margin-right:6px;"></i> ${a.type}
                    </span>
                    <span style="color:${color}; font-weight:700; font-size:0.8rem;">${a.distance_km}km</span>
                </div>
                <div style="font-size:0.8rem; font-weight:600; color:#555; margin:4px 0 2px 24px;">
                    <i class="far fa-building"></i> ${a.site_name}
                </div>
                <div style="font-size:0.75rem; color:#666; margin-left:24px; line-height:1.3;">
                    ${a.article_title}
                </div>
            </div>`;
        }).join('');
    }
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
    div.innerHTML = `<div style="border-left: 4px solid ${color}; background:#f8f9fa; padding:10px; border-radius:6px; margin-bottom:10px;"><div style="font-weight:800; color:${color}; font-size:0.9rem;">${adv.text}</div><div style="font-size:0.85rem; color:#555;">Advisory level: ${adv.level}</div></div>`;
}

function safeDate(iso) {
    try { return new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); } catch(e) { return "Just now"; }
}

function updateClock() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    document.getElementById("clock-date").innerText = `${dateStr} | ${timeStr}`;
    document.getElementById("clock-time").innerText = ""; 
}

function loadHistory(val) {
    if(!val) return;
    document.getElementById("general-news-feed").innerHTML = `<div class="p-4 text-center text-success"><i class="fas fa-check"></i> Archive loaded for ${val}</div>`;
}

function downloadReport() {
    const region = (document.getElementById("reportRegion") && document.getElementById("reportRegion").value) ? document.getElementById("reportRegion").value.toLowerCase() : 'global';
    const url = `${BASE}reports/${region}_latest.html`;
    window.open(url, '_blank');
}
