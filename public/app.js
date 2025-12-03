/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    NEWS: "public/data/news.json",
    PROXIMITY: "public/data/proximity.json"
};

/* --- HARDCODED DELL SITES (To ensure they ALWAYS appear) --- */
const HARDCODED_SITES = [
    { region: "AMER", name: "Dell Round Rock HQ", lat: 30.5083, lon: -97.6788 },
    { region: "AMER", name: "Dell Austin Parmer", lat: 30.2672, lon: -97.7431 },
    { region: "AMER", name: "Dell Hopkinton", lat: 42.2287, lon: -71.5226 },
    { region: "AMER", name: "Dell Nashville Hub", lat: 36.1627, lon: -86.7816 },
    { region: "AMER", name: "Dell Oklahoma City", lat: 35.4676, lon: -97.5164 },
    { region: "AMER", name: "Dell Santa Clara", lat: 37.3541, lon: -121.9552 },
    { region: "LATAM", name: "Dell Sao Paulo", lat: -23.5505, lon: -46.6333 },
    { region: "LATAM", name: "Dell Mexico City", lat: 19.4326, lon: -99.1332 },
    { region: "EMEA", name: "Dell Cork", lat: 51.8985, lon: -8.4756 },
    { region: "EMEA", name: "Dell Limerick", lat: 52.6638, lon: -8.6267 },
    { region: "EMEA", name: "Dell Bracknell", lat: 51.4160, lon: -0.7540 },
    { region: "EMEA", name: "Dell Dubai", lat: 25.2048, lon: 55.2708 },
    { region: "APJC", name: "Dell Bangalore", lat: 12.9716, lon: 77.5946 },
    { region: "APJC", name: "Dell Singapore", lat: 1.3521, lon: 103.8198 },
    { region: "APJC", name: "Dell Xiamen", lat: 24.4798, lon: 118.0894 },
    { region: "APJC", name: "Dell Cyberjaya", lat: 2.9213, lon: 101.6559 },
    { region: "APJC", name: "Dell Sydney", lat: -33.8688, lon: 151.2093 }
];

/* --- FULL TRAVEL LIST (From your snippet) --- */
const ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel" }, "Belarus": { level: 4, text: "Do Not Travel" }, "Burkina Faso": { level: 4, text: "Do Not Travel" }, "Haiti": { level: 4, text: "Do Not Travel" }, "Iran": { level: 4, text: "Do Not Travel" }, "Iraq": { level: 4, text: "Do Not Travel" }, "Libya": { level: 4, text: "Do Not Travel" }, "Mali": { level: 4, text: "Do Not Travel" }, "North Korea": { level: 4, text: "Do Not Travel" }, "Russia": { level: 4, text: "Do Not Travel" }, "Somalia": { level: 4, text: "Do Not Travel" }, "South Sudan": { level: 4, text: "Do Not Travel" }, "Sudan": { level: 4, text: "Do Not Travel" }, "Syria": { level: 4, text: "Do Not Travel" }, "Ukraine": { level: 4, text: "Do Not Travel" }, "Venezuela": { level: 4, text: "Do Not Travel" }, "Yemen": { level: 4, text: "Do Not Travel" }, "Israel": { level: 3, text: "Reconsider Travel" }, "Colombia": { level: 3, text: "Reconsider Travel" }, "Nigeria": { level: 3, text: "Reconsider Travel" }, "Pakistan": { level: 3, text: "Reconsider Travel" }, "Saudi Arabia": { level: 3, text: "Reconsider Travel" }, "Mexico": { level: 2, text: "Exercise Increased Caution" }, "France": { level: 2, text: "Exercise Increased Caution" }, "Germany": { level: 2, text: "Exercise Increased Caution" }, "India": { level: 2, text: "Exercise Increased Caution" }, "Turkey": { level: 2, text: "Exercise Increased Caution" }, "United Kingdom": { level: 2, text: "Exercise Increased Caution" }, "USA": { level: 1, text: "Exercise Normal Precautions" }, "Australia": { level: 1, text: "Exercise Normal Precautions" }, "Canada": { level: 1, text: "Exercise Normal Precautions" }, "Japan": { level: 1, text: "Exercise Normal Precautions" }, "Singapore": { level: 1, text: "Exercise Normal Precautions" }
};
const COUNTRIES = Object.keys(ADVISORIES).sort();

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let map, layerGroup;
let currentRadius = 50;

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
        console.error("Using Fallback", e);
        badge.innerText = "SIMULATION MODE";
        badge.className = "badge bg-warning text-dark";
        // Fallback Mock Data so the page isn't empty
        GENERAL_NEWS_FEED = [
            { title: "System: Live Feed Unavailable", snippet: "Check backend connection.", region: "Global", severity: 2, time: new Date().toISOString(), source: "System" }
        ];
    }
}

/* --- MAP --- */
function initMap() {
    // FIX: prevent infinite zooming out
    map = L.map("map", { zoomControl: false, minZoom: 2, maxBounds: [[-90, -180], [90, 180]] }).setView([20, 0], 2);
    L.control.zoom({ position: "topleft" }).addTo(map);
    // FIX: noWrap prevents the world from repeating
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png", {
        maxZoom: 19, noWrap: true, attribution: '© OpenStreetMap'
    }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
    setTimeout(() => { map.invalidateSize(); }, 500);
}

function updateMap(region) {
    if (!map) return;
    layerGroup.clearLayers();

    // 1. Dell Sites (from Hardcoded List)
    const siteIcon = L.divIcon({ className: "custom-pin", html: '<div class="marker-pin-dell"><i class="fas fa-building"></i></div>', iconSize: [30, 42], iconAnchor: [15, 42] });
    
    const visibleSites = region === "Global" ? HARDCODED_SITES : HARDCODED_SITES.filter(l => l.region === region);
    visibleSites.forEach(loc => {
        L.marker([loc.lat, loc.lon], { icon: siteIcon }).bindTooltip(`<b>${loc.name}</b>`).addTo(layerGroup);
    });

    // 2. Alerts (from Live JSON)
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
