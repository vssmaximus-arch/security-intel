/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    NEWS: "data/news.json",
    PROXIMITY: "data/proximity.json",
    LOCATIONS: "data/locations.json"
};

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let MAP_LOCATIONS = [];
let map;
let layerGroup;
let currentRadius = 50; // km

// Travel Advisory Mocks (since we don't have a live API for this yet)
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
    
    await loadAllData();
    
    // Default view
    filterNews('Global');
});

async function loadAllData() {
    try {
        // Parallel fetch
        const [newsRes, proxRes, locRes] = await Promise.allSettled([
            fetch(PATHS.NEWS, { cache: "no-store" }),
            fetch(PATHS.PROXIMITY, { cache: "no-store" }),
            fetch(PATHS.LOCATIONS, { cache: "no-store" })
        ]);

        // Handle Locations
        if (locRes.status === "fulfilled" && locRes.value.ok) {
            MAP_LOCATIONS = await locRes.value.json();
        } else {
            console.warn("Locations failed to load. Map will be empty.");
        }

        // Handle News
        if (newsRes.status === "fulfilled" && newsRes.value.ok) {
            const rawNews = await newsRes.value.json();
            // Handle array vs {articles: [...]} structure
            GENERAL_NEWS_FEED = Array.isArray(rawNews) ? rawNews : (rawNews.articles || []);
        }

        // Handle Proximity
        if (proxRes.status === "fulfilled" && proxRes.value.ok) {
            const rawProx = await proxRes.value.json();
            PROXIMITY_ALERTS = rawProx.alerts || [];
        }

        console.log(`Loaded: ${MAP_LOCATIONS.length} sites, ${GENERAL_NEWS_FEED.length} news, ${PROXIMITY_ALERTS.length} alerts.`);

    } catch (e) {
        console.error("Data load error:", e);
        document.getElementById('general-news-feed').innerHTML = 
            `<div class="alert alert-danger">System Error: Could not load intelligence feeds.</div>`;
    }
}


/* =========================================================
   MAP LOGIC
   ========================================================= */
function initMap() {
    map = L.map("map", { zoomControl: false }).setView([20, 0], 2);
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png", {
        maxZoom: 19
    }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
}

function updateMap(region) {
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
        html: `<div class="${sev >= 3 ? 'marker-incident-critical' : 'marker-incident-warning'}">
                 <i class="fas fa-exclamation"></i>
               </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    // Filter alerts by region AND radius
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
    // Update Tabs
    document.querySelectorAll(".nav-item-custom").forEach(el => {
        el.classList.toggle("active", el.innerText.trim() === region);
    });

    // Render Feeds
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
        banner.style.display = 'none';
        return;
    }

    // Top Critical Alert
    const topCrit = filtered.find(i => i.severity >= 3);
    if (topCrit) {
        banner.style.display = 'flex';
        document.getElementById("headline-alert").innerHTML = 
            `<strong>CRITICAL:</strong> ${topCrit.title} <span style="font-weight:400; opacity:0.8; margin-left:10px;">${topCrit.region}</span>`;
    } else {
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
    
    // Filter by region matches site_region (if present) and radius
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
                <div class="alert-type"><i class="fas fa-radiation"></i> ${a.type || 'INCIDENT'}</div>
                <div class="alert-dist text-danger">${a.distance_km}km</div>
            </div>
            <div class="alert-site"><i class="far fa-building"></i> ${a.site_name}</div>
            <div class="alert-desc">${a.article_title}</div>
        </div>
    `).join('');
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById("proxRadius").value);
    const activeRegion = document.querySelector(".nav-item-custom.active").innerText;
    renderProximityFeed(activeRegion);
    updateMap(activeRegion);
}


/* =========================================================
   HELPERS & SIDEBAR
   ========================================================= */

function startClock() {
    setInterval(() => {
        const now = new Date();
        document.getElementById("clock-time").innerText = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        document.getElementById("clock-date").innerText = now.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short'});
    }, 1000);
}

function formatTime(isoStr) {
    if (!isoStr) return "";
    return new Date(isoStr).toLocaleString();
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
        <div class="advisory-box" style="border-left: 4px solid ${color}; background:#f8f9fa; padding:10px;">
            <div style="font-weight:800; color:${color}; font-size:0.8rem;">LEVEL ${adv.level} ADVISORY</div>
            <div style="font-size:0.9rem; font-weight:600;">${adv.text}</div>
        </div>
    `;
    
    // Find related news
    const related = GENERAL_NEWS_FEED.filter(i => 
        (i.title + i.snippet).toLowerCase().includes(c.toLowerCase())
    );
    const newsDiv = document.getElementById("travel-news");
    if(related.length) {
        newsDiv.innerHTML = `<div class="small mt-2"><strong>Recent Incidents:</strong><br>${related[0].title}</div>`;
    } else {
        newsDiv.innerHTML = `<div class="small mt-2 text-success"><i class="fas fa-check"></i> No recent security incidents.</div>`;
    }
}

function downloadReport() {
    const region = document.getElementById("reportRegion").value.toLowerCase();
    const url = `reports/${region}_latest.html`;
    const fb = document.getElementById("download-feedback");
    
    fb.innerHTML = `<a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary w-100">Open Report <i class="fas fa-external-link-alt"></i></a>`;
}
