/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    NEWS: "data/news.json",
    PROXIMITY: "data/proximity.json",
    LOCATIONS: "data/locations.json"
};

/* FALLBACK DATA: Used if live feeds fail to load */
const FALLBACK_DATA = {
    news: [
        { title: "System Alert: Live Feed Unavailable", snippet: "The dashboard is running in simulation mode because live data files could not be loaded.", region: "Global", severity: 2, type: "SYSTEM", time: new Date().toISOString(), source: "SRO Dashboard" },
        { title: "Typhoon Warning: Manila Operations", snippet: "Heavy rainfall expected in Metro Manila; transport disruptions likely.", region: "APJC", severity: 2, type: "CRISIS", time: new Date().toISOString(), source: "Simulation" },
        { title: "Cyber Alert: Ransomware Campaign", snippet: "New variant targeting logistics sector in Europe.", region: "EMEA", severity: 3, type: "CYBER", time: new Date().toISOString(), source: "Simulation" }
    ],
    alerts: [
        { type: "Grid Instability", site_name: "Dell Bangalore", distance_km: 1.5, severity: 2, article_title: "Power outage risks in region" }
    ],
    locations: [
        { name: "Dell Round Rock HQ", lat: 30.5083, lon: -97.6788, country: "US", region: "AMER" },
        { name: "Dell Bangalore", lat: 12.9716, lon: 77.5946, country: "IN", region: "APJC" },
        { name: "Dell Limerick", lat: 52.6638, lon: -8.6267, country: "IE", region: "EMEA" }
    ]
};

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let MAP_LOCATIONS = [];
let map;
let layerGroup;
let currentRadius = 50; // km

// Travel Advisory Mocks
const ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel" },
    "Ukraine": { level: 4, text: "Do Not Travel (Conflict)" },
    "Israel": { level: 3, text: "Reconsider Travel" },
    "Mexico": { level: 2, text: "Exercise Increased Caution" },
    "France": { level: 2, text: "Exercise Increased Caution" },
    "USA": { level: 1, text: "Normal Precautions" }
};
const COUNTRIES = Object.keys(ADVISORIES).sort();


/* =========================================================
   INITIALIZATION
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    startClock();
    populateCountries();
    
    // Attempt load
    await loadAllData();
    
    // Default view
    filterNews('Global');
});

async function loadAllData() {
    const badge = document.getElementById("status-badge");
    try {
        const ts = new Date().getTime(); // Cache busting
        const [newsRes, proxRes, locRes] = await Promise.allSettled([
            fetch(`${PATHS.NEWS}?t=${ts}`),
            fetch(`${PATHS.PROXIMITY}?t=${ts}`),
            fetch(`${PATHS.LOCATIONS}?t=${ts}`)
        ]);

        // --- LOCATIONS ---
        if (locRes.status === "fulfilled" && locRes.value.ok) {
            MAP_LOCATIONS = await locRes.value.json();
        } else {
            console.warn("Locations failed. Using fallback.");
            MAP_LOCATIONS = FALLBACK_DATA.locations;
        }

        // --- NEWS ---
        if (newsRes.status === "fulfilled" && newsRes.value.ok) {
            const rawNews = await newsRes.value.json();
            GENERAL_NEWS_FEED = Array.isArray(rawNews) ? rawNews : (rawNews.articles || []);
            badge.innerText = "LIVE FEED";
            badge.style.background = "#e8f0fe";
            badge.style.color = "#1a73e8";
        } else {
            throw new Error("News feed failed");
        }

        // --- PROXIMITY ---
        if (proxRes.status === "fulfilled" && proxRes.value.ok) {
            const rawProx = await proxRes.value.json();
            PROXIMITY_ALERTS = rawProx.alerts || [];
        } else {
            PROXIMITY_ALERTS = FALLBACK_DATA.alerts;
        }

    } catch (e) {
        console.error("Data load error (Simulating):", e);
        // ACTIVATE SIMULATION MODE
        GENERAL_NEWS_FEED = FALLBACK_DATA.news;
        PROXIMITY_ALERTS = FALLBACK_DATA.alerts;
        if(MAP_LOCATIONS.length === 0) MAP_LOCATIONS = FALLBACK_DATA.locations;
        
        badge.innerText = "SIMULATION MODE";
        badge.style.background = "#fef7e0";
        badge.style.color = "#e37400";
    }
}


/* =========================================================
   MAP LOGIC
   ========================================================= */
function initMap() {
    map = L.map("map", { zoomControl: false }).setView([25, 10], 2);
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    layerGroup = L.layerGroup().addTo(map);
    
    // Fix gray map issue by forcing resize
    setTimeout(() => { map.invalidateSize(); }, 500);
}

function updateMap(region) {
    if (!map) return;
    layerGroup.clearLayers();

    // Dell Sites (Blue Pins)
    const siteIcon = L.divIcon({
        className: "custom-pin",
        html: '<div class="marker-pin-dell"><i class="fas fa-building"></i></div>',
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

    const visibleSites = region === "Global" 
        ? MAP_LOCATIONS 
        : MAP_LOCATIONS.filter(l => l.region === region);

    visibleSites.forEach(loc => {
        L.marker([loc.lat, loc.lon], { icon: siteIcon })
         .bindTooltip(`<b>${loc.name}</b><br>${loc.country}`)
         .addTo(layerGroup);
    });

    // Proximity Alerts (Red/Amber Incidents)
    const alertIcon = (sev) => L.divIcon({
        className: "custom-pin",
        html: `<div class="marker-incident ${sev >= 3 ? 'marker-crit' : 'marker-warn'}">
                 <i class="fas fa-exclamation"></i>
               </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    const visibleAlerts = PROXIMITY_ALERTS.filter(a => {
        const regionMatch = region === "Global" || a.site_region === region;
        const radiusMatch = a.distance_km <= currentRadius;
        return regionMatch && radiusMatch && a.lat && a.lon;
    });

    visibleAlerts.forEach(a => {
        L.marker([a.lat, a.lon], { icon: alertIcon(a.severity) })
         .bindTooltip(`<b>${a.article_title}</b><br>Near: ${a.site_name} (${a.distance_km}km)`)
         .addTo(layerGroup);
    });

    // Recenter
    const centers = {
        "AMER": [30, -90], "EMEA": [45, 15], "APJC": [20, 110], "LATAM": [-15, -60], "Global": [25, 10]
    };
    const zoom = region === "Global" ? 2 : 3;
    map.setView(centers[region] || centers["Global"], zoom);
}


/* =========================================================
   UI & FEED LOGIC
   ========================================================= */

function filterNews(region) {
    document.querySelectorAll(".nav-item-custom").forEach(el => {
        el.classList.toggle("active", el.innerText.trim() === region);
    });
    renderGeneralFeed(region);
    renderProximityFeed(region);
    updateMap(region);
}

function renderGeneralFeed(region) {
    const container = document.getElementById("general-news-feed");
    const banner = document.getElementById("critical-alert-banner");
    
    const filtered = region === "Global" 
        ? GENERAL_NEWS_FEED 
        : GENERAL_NEWS_FEED.filter(i => i.region === region);

    if (!filtered.length) {
        container.innerHTML = `<div class="p-4 text-center text-muted">No active incidents logged for ${region}.</div>`;
        if(banner) banner.style.display = 'none';
        return;
    }

    // Top Critical Alert
    const topCrit = filtered.find(i => i.severity >= 3);
    if (topCrit && banner) {
        banner.style.display = 'flex';
        document.getElementById("headline-alert").innerHTML = 
            `<strong>CRITICAL:</strong> ${topCrit.title}`;
    } else if (banner) {
        banner.style.display = 'none';
    }

    // Feed Cards
    container.innerHTML = filtered.map(item => {
        const barColor = item.severity >= 3 ? "status-bar-crit" : "status-bar-warn";
        const badgeClass = item.severity >= 3 ? "ftag-crit" : "ftag-warn";
        const sevText = item.severity >= 3 ? "CRITICAL" : (item.severity === 2 ? "WARNING" : "INFO");
        
        return `
        <a href="${item.url || item.link || '#'}" target="_blank" class="feed-card">
            <div class="feed-status-bar ${barColor}"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="ftag ${badgeClass}">${sevText}</span>
                    <span class="ftag ftag-type">${item.type || 'GENERAL'}</span>
                    <span class="feed-region">${item.region}</span>
                </div>
                <div class="feed-title">${item.title}</div>
                <div class="feed-meta">${item.source} • ${formatTime(item.time)}</div>
                <div class="feed-desc">${item.snippet || item.summary || ''}</div>
            </div>
        </a>`;
    }).join('');
}

function renderProximityFeed(region) {
    const container = document.getElementById("proximity-alerts-container");
    const filtered = PROXIMITY_ALERTS.filter(a => {
        const regMatch = region === "Global" || (a.site_region === region);
        return regMatch && a.distance_km <= currentRadius;
    });

    if (!filtered.length) {
        container.innerHTML = `<div class="p-3 text-center text-muted small">No threats within ${currentRadius}km of assets.</div>`;
        return;
    }

    container.innerHTML = filtered.map(a => `
        <div class="alert-row">
            <div class="alert-top">
                <div class="alert-type"><i class="fas fa-exclamation-circle"></i> ${a.type || 'INCIDENT'}</div>
                <div class="alert-dist text-danger">${a.distance_km}km</div>
            </div>
            <div class="alert-site"><i class="far fa-building"></i> ${a.site_name}</div>
            <div class="alert-desc">${a.article_title}</div>
        </div>
    `).join('');
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById("proxRadius").value);
    const activeEl = document.querySelector(".nav-item-custom.active");
    if(activeEl) filterNews(activeEl.innerText.trim());
}


/* =========================================================
   HELPERS & SIDEBAR
   ========================================================= */

function startClock() {
    setInterval(() => {
        const now = new Date();
        const tEl = document.getElementById("clock-time");
        const dEl = document.getElementById("clock-date");
        if(tEl) tEl.innerText = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        if(dEl) dEl.innerText = now.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short'});
    }, 1000);
}

function formatTime(isoStr) {
    if (!isoStr) return "";
    try { return new Date(isoStr).toLocaleString(); } catch(e) { return isoStr; }
}

function populateCountries() {
    const sel = document.getElementById("countrySelect");
    COUNTRIES.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.innerText = c;
        sel.appendChild(opt);
    });
}

function filterTravel() {
    const c = document.getElementById("countrySelect").value;
    const adv = ADVISORIES[c] || { level: 1, text: "Normal Precautions" };
    const div = document.getElementById("travel-advisories");
    
    let color = adv.level === 4 ? "#d93025" : (adv.level === 3 ? "#e37400" : (adv.level === 2 ? "#f9ab00" : "#1a73e8"));
    
    div.innerHTML = `
        <div style="border-left: 4px solid ${color}; background:#f8f9fa; padding:10px; border-radius:6px; margin-bottom:10px;">
            <div style="font-weight:800; color:${color}; font-size:0.8rem;">LEVEL ${adv.level} ADVISORY</div>
            <div style="font-size:0.9rem; font-weight:600;">${adv.text}</div>
        </div>
    `;
    
    // Find related news
    const related = GENERAL_NEWS_FEED.filter(i => 
        (i.title + (i.snippet||"")).toLowerCase().includes(c.toLowerCase())
    );
    const newsDiv = document.getElementById("travel-news");
    if(related.length) {
        newsDiv.innerHTML = `<div class="small p-2 bg-light border rounded"><strong>Recent Incident:</strong><br>${related[0].title}</div>`;
    } else {
        newsDiv.innerHTML = `<div class="small text-success"><i class="fas fa-check-circle"></i> No specific incidents logged.</div>`;
    }
}

function downloadReport() {
    const region = document.getElementById("reportRegion").value.toLowerCase();
    const url = `reports/${region}_latest.html`;
    const fb = document.getElementById("download-feedback");
    
    fb.innerHTML = `<a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary w-100">Open Report <i class="fas fa-external-link-alt"></i></a>`;
}
