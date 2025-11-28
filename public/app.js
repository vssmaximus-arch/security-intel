// ================== GLOBAL STATE ==================
let currentRadius = 5; // km for proximity widget
let map, layerGroup;

let MAP_LOCATIONS = [];
let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let PROXIMITY_META = { generated_at: null, radius_km: null };

// ================== INITIALISE ==================
document.addEventListener("DOMContentLoaded", async function () {
    initMap();
    startClock();

    // Load data (locations, news, proximity)
    await loadData();

    populateCountries();
    filterNews("Global");

    // Refresh filtering every 5 minutes using the active tab
    setInterval(() => {
        const activeEl = document.querySelector(".nav-item-custom.active");
        if (activeEl) filterNews(activeEl.innerText.trim());
        else filterNews("Global");
    }, 300000);

    // Date in the Daily Briefing modal (if present)
    const reportDateEl = document.getElementById("reportDate");
    if (reportDateEl) {
        reportDateEl.valueAsDate = new Date();
    }
});

// ================== DATA LOADING ==================
async function loadData() {
    try {
        const [locResponse, newsResponse, proxResponse] = await Promise.all([
            fetch("config/locations.json"),
            fetch("data/news.json"),
            fetch("data/proximity.json").catch(() => null)
        ]);

        // Locations
        const locJson = await locResponse.json();
        MAP_LOCATIONS = Array.isArray(locJson)
            ? locJson
            : (locJson.locations || []);

        // News (support both {articles: []} and plain [])
        const newsJson = await newsResponse.json();
        GENERAL_NEWS_FEED = Array.isArray(newsJson)
            ? newsJson
            : (newsJson.articles || []);

        // Proximity alerts – optional but preferred
        if (proxResponse && proxResponse.ok) {
            const proxJson = await proxResponse.json();
            PROXIMITY_ALERTS = Array.isArray(proxJson)
                ? proxJson
                : (proxJson.alerts || []);
            PROXIMITY_META.generated_at = proxJson.generated_at || null;
            PROXIMITY_META.radius_km = proxJson.radius_km || null;
        } else {
            PROXIMITY_ALERTS = [];
        }

        console.log(
            "Data loaded:",
            MAP_LOCATIONS.length,
            "locations;",
            GENERAL_NEWS_FEED.length,
            "news items;",
            PROXIMITY_ALERTS.length,
            "proximity alerts"
        );
    } catch (error) {
        console.error("Error loading JSON data:", error);
        alert(
            "Error loading data files. Please ensure config/locations.json, data/news.json and data/proximity.json exist."
        );
    }
}

// ================== MAP SETUP ==================
function initMap() {
    map = L.map("map", {
        zoomControl: false,
        attributionControl: false,
        minZoom: 2,
        maxBounds: [
            [-90, -180],
            [90, 180]
        ]
    }).setView([25, 10], 2);

    L.control.zoom({ position: "topleft" }).addTo(map);

    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png",
        { maxZoom: 19, noWrap: true }
    ).addTo(map);

    layerGroup = L.layerGroup().addTo(map);
}

// ================== PROXIMITY & MAP HELPERS ==================
function updateProximityRadius() {
    const slider = document.getElementById("proxRadius");
    if (!slider) return;
    currentRadius = parseFloat(slider.value);
    const activeEl = document.querySelector(".nav-item-custom.active");
    const currentRegion = activeEl ? activeEl.innerText.trim() : "Global";
    renderProximityAlerts(currentRegion);
    updateMap(currentRegion);
}

// crude classification based on title/summary keywords
function classifyIncidentFromText(text) {
    const t = (text || "").toLowerCase();

    if (t.includes("fire") || t.includes("wildfire"))
        return { icon: "fire", color: "#d93025", label: "Fire / Explosion" };
    if (t.includes("flood") || t.includes("rain") || t.includes("storm"))
        return { icon: "water", color: "#f9ab00", label: "Flood / Storm" };
    if (t.includes("grid") || t.includes("power") || t.includes("blackout") || t.includes("outage"))
        return { icon: "bolt", color: "#e37400", label: "Power / Grid" };
    if (t.includes("protest") || t.includes("strike") || t.includes("riot"))
        return { icon: "fist-raised", color: "#333333", label: "Civil Unrest" };
    if (t.includes("ransomware") || t.includes("malware") || t.includes("cyber"))
        return { icon: "shield-alt", color: "#0f766e", label: "Cyber" };

    return { icon: "exclamation-triangle", color: "#d93025", label: "Incident" };
}

function renderProximityAlerts(filterRegion) {
    const container = document.getElementById("proximity-alerts-container");
    if (!container) return;

    if (!PROXIMITY_ALERTS || PROXIMITY_ALERTS.length === 0) {
        container.innerHTML =
            `<div style="padding:15px; text-align:center; color:#999;">` +
            `No proximity alerts available in the last 24h.</div>`;
        return;
    }

    const regionFiltered = PROXIMITY_ALERTS.filter(a =>
        filterRegion === "Global" ? true : a.site_region === filterRegion
    );

    const filteredAlerts = regionFiltered.filter(a => {
        if (typeof a.distance_km !== "number") return false;
        return a.distance_km <= currentRadius;
    });

    if (filteredAlerts.length === 0) {
        container.innerHTML =
            `<div style="padding:15px; text-align:center; color:#999;">` +
            `No alerts within ${currentRadius}km.</div>`;
        return;
    }

    let html = "";
    filteredAlerts.forEach(a => {
        const textForType = `${a.article_title || ""} ${a.summary || ""}`;
        const cls = classifyIncidentFromText(textForType);
        const distStr = `${a.distance_km.toFixed(1)}km`;

        html += `
        <div class="alert-row">
            <div class="alert-top">
                <div class="alert-type">
                    <i class="fas fa-${cls.icon}" style="color:${cls.color}; margin-right:8px;"></i>
                    ${cls.label}
                </div>
                <div class="alert-dist" style="color:${cls.color}">${distStr}</div>
            </div>
            <div class="alert-site">
                <i class="far fa-building"></i>
                ${a.site_name || "Dell Site"}${a.site_country ? " – " + a.site_country : ""}
            </div>
            <div class="alert-desc">
                ${a.article_title || "Incident near facility"}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function getIconHtml(type) {
    if (type === "fire")
        return '<i class="fas fa-fire" style="color:#d93025"></i>';
    if (type === "grid")
        return '<i class="fas fa-bolt" style="color:#e37400"></i>';
    if (type === "flood")
        return '<i class="fas fa-water" style="color:#f9ab00"></i>';
    if (type === "protest")
        return '<i class="fas fa-fist-raised" style="color:#333"></i>';
    return '<i class="fas fa-exclamation" style="color:#d93025"></i>';
}

function updateMap(filterRegion) {
    if (!layerGroup) return;
    layerGroup.clearLayers();

    // Dell sites (blue pins)
    const dellIcon = L.divIcon({
        className: "custom-pin",
        html: `<div class="marker-pin-dell"><i class="fas fa-building"></i></div>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

    const filteredLocs =
        filterRegion === "Global"
            ? MAP_LOCATIONS
            : MAP_LOCATIONS.filter(l => l.region === filterRegion);

    filteredLocs.forEach(loc => {
        if (typeof loc.lat !== "number" || typeof loc.lon !== "number") return;

        const marker = L.marker([loc.lat, loc.lon], { icon: dellIcon }).addTo(layerGroup);
        const tooltipContent = `<b>${loc.name || "Dell Site"}</b>`;
        marker.bindTooltip(tooltipContent, {
            permanent: false,
            direction: "top",
            className: "map-tooltip"
        });
        marker.on("mouseover", function () { this.openTooltip(); });
        marker.on("mouseout", function () { this.closeTooltip(); });
    });

    // Proximity incidents (red / amber markers)
    if (PROXIMITY_ALERTS && PROXIMITY_ALERTS.length > 0) {
        PROXIMITY_ALERTS.forEach(a => {
            if (filterRegion !== "Global" && a.site_region !== filterRegion) return;
            if (typeof a.distance_km !== "number") return;
            if (a.distance_km > currentRadius) return;
            if (typeof a.lat !== "number" || typeof a.lon !== "number") return;

            const cls = classifyIncidentFromText(
                `${a.article_title || ""} ${a.summary || ""}`
            );

            const marker = L.circleMarker([a.lat, a.lon], {
                radius: 7,
                color: cls.color,
                fillColor: cls.color,
                fillOpacity: 0.85,
                weight: 2
            }).addTo(layerGroup);

            const tooltip = `
                <b>${a.article_title || "Incident"}</b><br/>
                Site: ${a.site_name || "Dell Site"}<br/>
                Distance: ${a.distance_km.toFixed(1)}km<br/>
                Source: ${a.article_source || ""}`;
            marker.bindTooltip(tooltip, {
                permanent: false,
                direction: "top",
                className: "map-tooltip"
            });
        });
    }

    // Map view by region
    if (filterRegion === "AMER") map.setView([30, -90], 3);
    else if (filterRegion === "EMEA") map.setView([45, 15], 3);
    else if (filterRegion === "APJC") map.setView([20, 110], 3);
    else if (filterRegion === "LATAM") map.setView([-15, -60], 3);
    else map.setView([25, 10], 2);
}

// ================== GENERAL NEWS FEED ==================
function renderGeneralFeed(filterRegion, dataOverride = null) {
    const container = document.getElementById("general-news-feed");
    if (!container) return;

    let html = "";
    const sourceData = dataOverride || GENERAL_NEWS_FEED;

    const filteredFeed =
        filterRegion === "Global" || !filterRegion
            ? sourceData
            : sourceData.filter(item => item.region === filterRegion);

    if (!filteredFeed || filteredFeed.length === 0) {
        container.innerHTML =
            `<div style="padding:30px; text-align:center; color:#999;">No incidents.</div>`;
        return;
    }

    filteredFeed.forEach(item => {
        const sev = parseInt(item.severity, 10) || 1;
        const barColor = sev === 3 ? "status-bar-crit" : "status-bar-warn";
        const badgeClass = sev === 3 ? "ftag-crit" : "ftag-warn";
        const badgeText = sev === 3 ? "CRITICAL" : "WARNING";
        const url = item.url || item.link || "#";

        html += `
        <a href="${url}" target="_blank" class="feed-card">
            <div class="feed-status-bar ${barColor}"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="ftag ${badgeClass}">${badgeText}</span>
                    <span class="ftag ftag-type">${item.type || "GENERAL"}</span>
                    <span class="feed-region">${item.region || "Global"}</span>
                </div>
                <div class="feed-title">${item.title || ""}</div>
                <div class="feed-meta">
                    ${(item.source || "").trim()} • ${(item.time || item.timestamp || "").toString()}
                </div>
                <div class="feed-desc">${item.snippet || item.summary || ""}</div>
            </div>
        </a>`;
    });

    container.innerHTML = html;
}

// ================== CLOCK ==================
function startClock() {
    setInterval(() => {
        const now = new Date();
        const timeOptions = {
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short"
        };
        const dateOptions = {
            weekday: "long",
            year: "numeric",
            month: "short",
            day: "numeric"
        };
        const dateEl = document.getElementById("clock-date");
        const timeEl = document.getElementById("clock-time");
        if (dateEl) dateEl.innerText = now.toLocaleDateString("en-US", dateOptions);
        if (timeEl) timeEl.innerText = now.toLocaleTimeString("en-US", timeOptions);
    }, 1000);
}

// ================== TRAVEL SAFETY ==================
const MOCK_ADVISORIES = { /* unchanged – your big advisory object here */ };
//  (for brevity I’m not re-pasting MOCK_ADVISORIES – keep exactly what you already have)

// Full country list (your existing long array – leave as is)
const COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola",
    "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
    "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados",
    "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
    "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei",
    "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia",
    "Cameroon", "Canada", "Central African Republic", "Chad", "Chile",
    "China", "Colombia", "Comoros", "Congo (DRC)", "Congo (Republic)",
    "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
    "Denmark", "Djibouti", "Dominica", "Dominican Republic", "East Timor",
    "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea",
    "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland",
    "France", "Gabon", "Gambia", "Georgia", "Germany",
    "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
    "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
    "Iceland", "India", "Indonesia", "Iran", "Iraq",
    "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica",
    "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
    "Korea, North", "Korea, South", "Kosovo", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia",
    "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar",
    "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
    "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
    "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
    "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
    "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
    "North Macedonia", "Norway", "Oman", "Pakistan", "Palau",
    "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines",
    "Poland", "Portugal", "Qatar", "Romania", "Russia",
    "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
    "Saint Vincent and the Grenadines", "Samoa", "San Marino",
    "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia",
    "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
    "Solomon Islands", "Somalia", "South Africa", "South Sudan",
    "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden",
    "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
    "Thailand", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
    "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine",
    "United Arab Emirates", "United Kingdom", "United States",
    "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City",
    "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

function populateCountries() {
    const sel = document.getElementById("countrySelect");
    if (!sel) return;
    sel.innerHTML = ""; // clear any existing
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.innerText = "Select Country...";
    sel.appendChild(placeholder);

    COUNTRIES.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.innerText = c;
        sel.appendChild(opt);
    });
}

function filterTravel() {
    const country = document.getElementById("countrySelect").value;
    const advContainer = document.getElementById("travel-advisories");
    const newsContainer = document.getElementById("travel-news");
    if (!country || !advContainer || !newsContainer) return;

    let advisory = MOCK_ADVISORIES[country];

    let advColor = "#002a86"; // default L1
    let advBg = "#e8f0fe";
    let advBorder = "#d2e3fc";
    let levelText = "LEVEL 1";

    if (!advisory) {
        advisory = { level: 1, text: "Exercise Normal Precautions." };
    } else {
        if (advisory.level === 2) {
            advColor = "#f9ab00"; advBg = "#fef7e0"; advBorder = "#feebc8"; levelText = "LEVEL 2";
        } else if (advisory.level === 3) {
            advColor = "#e37400"; advBg = "#fff5e5"; advBorder = "#ffdecb"; levelText = "LEVEL 3";
        } else if (advisory.level === 4) {
            advColor = "#d93025"; advBg = "#fce8e6"; advBorder = "#fad2cf"; levelText = "LEVEL 4";
        }
    }

    advContainer.innerHTML = `
        <div class="advisory-box" style="background:${advBg}; border-color:${advBorder}">
            <div class="advisory-header">
                <span class="advisory-label">OFFICIAL ADVISORY</span>
                <span class="advisory-level-badge" style="background:${advColor}">${levelText}</span>
            </div>
            <div class="advisory-text" style="color:${advColor === "#002a86" ? "#0d47a1" : "#202124"}">
                ${advisory.text}
            </div>
        </div>`;

    const relatedNews = GENERAL_NEWS_FEED.filter(item =>
        (item.title && item.title.includes(country)) ||
        (item.snippet && item.snippet.includes(country)) ||
        (item.summary && item.summary.includes(country))
    );

    if (relatedNews.length > 0) {
        let newsHtml =
            `<div class="news-box-alert"><div class="news-box-header">RECENT INCIDENTS (72H)</div>`;
        relatedNews.forEach(n => {
            newsHtml += `
                <div class="news-box-item">
                    <div class="news-box-title">${n.title || ""}</div>
                    <div class="news-box-summary">${n.snippet || n.summary || ""}</div>
                </div>`;
        });
        newsHtml += `</div>`;
        newsContainer.innerHTML = newsHtml;
    } else {
        newsContainer.innerHTML =
            `<div class="safe-box">
                <i class="fas fa-check-circle safe-icon"></i>
                <div class="safe-text">No specific active incidents logged for ${country} in the last 72h.</div>
             </div>`;
    }
}

// ================== HISTORY / REPORT DOWNLOAD ==================
const ARCHIVE_DATA = [
    {
        region: "Global",
        severity: 1,
        type: "Archive",
        url: "#",
        source: "System Archive",
        time: "Historical",
        title: "No Major Incidents Logged on Selected Date",
        snippet: "This is simulated archive data."
    }
];

function loadHistory(dateStr) {
    if (!dateStr) return;
    const statusDiv = document.getElementById("history-status");
    if (!statusDiv) return;

    statusDiv.innerHTML =
        `<span class="spinner-border spinner-border-sm text-primary" role="status"></span> Loading...`;
    setTimeout(() => {
        statusDiv.innerHTML =
            `<span class="text-success"><i class="fas fa-check"></i> Archive Loaded: ${dateStr}</span>`;
        renderGeneralFeed(null, ARCHIVE_DATA);
    }, 800);
}

function downloadReport() {
    const feedback = document.getElementById("download-feedback");
    if (!feedback) return;
    feedback.style.display = "block";
    feedback.innerHTML =
        `<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Retrieving...`;
    setTimeout(() => {
        feedback.innerHTML =
            `<div class="alert alert-success mt-2 text-start" style="font-size:0.8rem">
                <strong><i class="fas fa-check-circle"></i> Simulation Successful</strong>
             </div>`;
    }, 1000);
}

// ================== REGION FILTER ==================
function filterNews(region) {
    document.querySelectorAll(".nav-item-custom").forEach(el => {
        el.classList.remove("active");
        if (el.innerText.trim() === region) el.classList.add("active");
    });

    renderGeneralFeed(region);
    renderProximityAlerts(region);
    updateMap(region);
}
