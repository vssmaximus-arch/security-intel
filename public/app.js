let currentRadius = 5;
let map, layerGroup;
let MAP_LOCATIONS = [];
let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    initMap();
    startClock();

    await loadData();

    populateCountries();
    filterNews('Global');

    // Refresh filter every 5 minutes based on active tab
    setInterval(() => {
        const activeEl = document.querySelector('.nav-item-custom.active');
        if (activeEl) filterNews(activeEl.innerText.trim());
        else filterNews('Global');
    }, 300000);

    // Set Date in Modal if present
    const reportDate = document.getElementById('reportDate');
    if (reportDate) {
        reportDate.valueAsDate = new Date();
    }
});

async function loadData() {
    try {
        const [locResponse, newsResponse, proxResponse] = await Promise.allSettled([
            fetch('config/locations.json'),
            fetch('data/news.json'),
            fetch('data/proximity.json')
        ]);

        if (locResponse.status === 'fulfilled') {
            MAP_LOCATIONS = await locResponse.value.json();
        }

        if (newsResponse.status === 'fulfilled') {
            const newsJson = await newsResponse.value.json();
            GENERAL_NEWS_FEED = Array.isArray(newsJson) ? newsJson : (newsJson.articles || []);
        }

        if (proxResponse.status === 'fulfilled' && proxResponse.value.ok) {
            const proxJson = await proxResponse.value.json();
            PROXIMITY_ALERTS = Array.isArray(proxJson.alerts) ? proxJson.alerts : [];
        } else {
            PROXIMITY_ALERTS = [];
        }

        console.log(`Loaded locations=${MAP_LOCATIONS.length}, news=${GENERAL_NEWS_FEED.length}, proxAlerts=${PROXIMITY_ALERTS.length}`);
    } catch (err) {
        console.error("Error loading JSON data:", err);
        alert("Error loading data files. Please ensure config/locations.json, data/news.json, and data/proximity.json exist.");
    }
}

// ----------------- CONSTANTS -----------------

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

// Travel advisory mock data (unchanged, but full list kept here)
const MOCK_ADVISORIES = {
    // ... (keep your existing large MOCK_ADVISORIES object here unchanged)
    // I’m not touching this block – your current version is fine and already long.
};

// Full country list
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
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
    "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi",
    "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
    "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova",
    "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
    "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands",
    "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia",
    "Norway", "Oman", "Pakistan", "Palau", "Panama",
    "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland",
    "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
    "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
    "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia",
    "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
    "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
    "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
    "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
    "Tanzania", "Thailand", "Togo", "Tonga", "Trinidad and Tobago",
    "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda",
    "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
    "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela",
    "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

// ----------------- MAP & PROXIMITY -----------------

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        minZoom: 2,
        maxBounds: [[-90, -180], [90, 180]]
    }).setView([25, 10], 2);

    L.control.zoom({ position: 'topleft' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        noWrap: true
    }).addTo(map);

    layerGroup = L.layerGroup().addTo(map);
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById('proxRadius').value);
    const activeEl = document.querySelector('.nav-item-custom.active');
    const currentRegion = activeEl ? activeEl.innerText.trim() : 'Global';
    renderProximityAlerts(currentRegion);
    updateMap(currentRegion);
}

function renderProximityAlerts(filterRegion) {
    const container = document.getElementById('proximity-alerts-container');
    if (!container) return;

    const alerts = PROXIMITY_ALERTS.filter(a => {
        const regionMatch = (filterRegion === 'Global' || a.site_region === filterRegion);
        const distMatch = typeof a.distance_km === 'number' ? a.distance_km <= currentRadius : true;
        return regionMatch && distMatch;
    });

    if (alerts.length === 0) {
        container.innerHTML = `<div style="padding:15px; text-align:center; color:#999;">No proximity alerts within ${currentRadius}km.</div>`;
        return;
    }

    let html = '';
    alerts.forEach(a => {
        const sevColor = a.severity >= 3 ? '#d93025' : (a.severity === 2 ? '#e37400' : '#666');
        const distStr = (typeof a.distance_km === 'number') ? `${a.distance_km.toFixed(1)}km` : '';
        html += `
        <div class="alert-row">
            <div class="alert-top">
                <div class="alert-type">
                    <i class="fas fa-exclamation-triangle" style="color:${sevColor}; margin-right:8px;"></i>
                    ${a.type || 'ALERT'}
                </div>
                <div class="alert-dist" style="color:${sevColor}">${distStr}</div>
            </div>
            <div class="alert-site">
                <i class="far fa-building"></i> ${a.site_name} (${a.site_country})
            </div>
            <div class="alert-desc">${a.snippet || a.title}</div>
        </div>`;
    });

    container.innerHTML = html;
}

function getIconHtmlForType(t) {
    const type = (t || '').toLowerCase();
    if (type.includes('fire')) return '<i class="fas fa-fire"></i>';
    if (type.includes('flood') || type.includes('storm')) return '<i class="fas fa-water"></i>';
    if (type.includes('grid') || type.includes('power')) return '<i class="fas fa-bolt"></i>';
    if (type.includes('protest') || type.includes('unrest')) return '<i class="fas fa-fist-raised"></i>';
    return '<i class="fas fa-exclamation"></i>';
}

function updateMap(filterRegion) {
    layerGroup.clearLayers();

    const dellIcon = L.divIcon({
        className: 'custom-pin',
        html: `<div class="marker-pin-dell"><i class="fas fa-building"></i></div>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

    const incidentIcon = (type, sev) => {
        const colorClass = sev >= 3 ? 'marker-incident-critical' : (sev === 2 ? 'marker-incident-warning' : 'marker-incident-info');
        return L.divIcon({
            className: 'custom-pin',
            html: `<div class="${colorClass}">${getIconHtmlForType(type)}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
    };

    // Dell sites
    const filteredLocs = filterRegion === 'Global'
        ? MAP_LOCATIONS
        : MAP_LOCATIONS.filter(l => l.region === filterRegion);

    filteredLocs.forEach(loc => {
        const marker = L.marker([loc.lat, loc.lon], { icon: dellIcon }).addTo(layerGroup);
        const tooltipContent = `<b>${loc.name || 'Dell Site'}</b><br>${loc.country || ''}`;
        marker.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            className: 'map-tooltip'
        });
        marker.on('mouseover', function () { this.openTooltip(); });
        marker.on('mouseout', function () { this.closeTooltip(); });
    });

    // Proximity incidents as separate markers
    const filteredAlerts = PROXIMITY_ALERTS.filter(a => {
        const regionMatch = (filterRegion === 'Global' || a.site_region === filterRegion);
        const distMatch = typeof a.distance_km === 'number' ? a.distance_km <= currentRadius : true;
        return regionMatch && distMatch && typeof a.lat === 'number' && typeof a.lon === 'number';
    });

    filteredAlerts.forEach(a => {
        const m = L.marker([a.lat, a.lon], { icon: incidentIcon(a.type, a.severity) }).addTo(layerGroup);
        const tt = `<b>${a.title}</b><br>${a.site_name} – ${a.distance_km.toFixed(1)}km<br>${a.snippet || ''}`;
        m.bindTooltip(tt, {
            permanent: false,
            direction: 'top',
            className: 'map-tooltip'
        });
        m.on('mouseover', function () { this.openTooltip(); });
        m.on('mouseout', function () { this.closeTooltip(); });
    });

    if (filterRegion === 'AMER') map.setView([30, -90], 3);
    else if (filterRegion === 'EMEA') map.setView([45, 15], 3);
    else if (filterRegion === 'APJC') map.setView([20, 110], 3);
    else if (filterRegion === 'LATAM') map.setView([-15, -60], 3);
    else map.setView([25, 10], 2);
}

// ----------------- NEWS FEED -----------------

function renderGeneralFeed(filterRegion, dataOverride = null) {
    const container = document.getElementById('general-news-feed');
    if (!container) return;

    const sourceData = dataOverride || GENERAL_NEWS_FEED;
    const filteredFeed = (filterRegion === 'Global' || !filterRegion)
        ? sourceData
        : sourceData.filter(item => item.region === filterRegion);

    if (filteredFeed.length === 0) {
        container.innerHTML = `<div style="padding:30px; text-align:center; color:#999;">No incidents.</div>`;
        return;
    }

    let html = '';
    filteredFeed.forEach(item => {
        const sev = parseInt(item.severity || 1, 10);
        const barColor = sev === 3 ? 'status-bar-crit' : (sev === 2 ? 'status-bar-warn' : 'status-bar-info');
        const badgeClass = sev === 3 ? 'ftag-crit' : (sev === 2 ? 'ftag-warn' : 'ftag-info');
        const badgeText = sev === 3 ? 'CRITICAL' : (sev === 2 ? 'WARNING' : 'INFO');

        html += `
        <a href="${item.url}" target="_blank" class="feed-card">
            <div class="feed-status-bar ${barColor}"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="ftag ${badgeClass}">${badgeText}</span>
                    <span class="ftag ftag-type">${item.type || 'GENERAL'}</span>
                    <span class="feed-region">${item.region}</span>
                </div>
                <div class="feed-title">${item.title}</div>
                <div class="feed-meta">${item.source} • ${item.time}</div>
                <div class="feed-desc">${item.snippet || item.snippet_raw || ''}</div>
            </div>
        </a>`;
    });

    container.innerHTML = html;
}

// ----------------- CLOCK & UI HELPERS -----------------

function startClock() {
    setInterval(() => {
        const now = new Date();
        const timeOptions = { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
        const dateEl = document.getElementById('clock-date');
        const timeEl = document.getElementById('clock-time');
        if (dateEl) dateEl.innerText = now.toLocaleDateString('en-US', dateOptions);
        if (timeEl) timeEl.innerText = now.toLocaleTimeString('en-US', timeOptions);
    }, 1000);
}

function populateCountries() {
    const sel = document.getElementById('countrySelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Country...</option>';
    COUNTRIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        sel.appendChild(opt);
    });
}

function filterTravel() {
    const country = document.getElementById('countrySelect').value;
    const advContainer = document.getElementById('travel-advisories');
    const newsContainer = document.getElementById('travel-news');
    if (!advContainer || !newsContainer) return;

    let advisory = MOCK_ADVISORIES[country];

    let advColor = "#002a86";
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
          <div class="advisory-text" style="color:${advColor === '#002a86' ? '#0d47a1' : '#202124'}">
            ${advisory.text}
          </div>
        </div>`;

    const relatedNews = GENERAL_NEWS_FEED.filter(item =>
        (item.title && item.title.includes(country)) ||
        (item.snippet && item.snippet.includes(country)) ||
        (item.snippet_raw && item.snippet_raw.includes(country))
    );

    if (relatedNews.length > 0) {
        let newsHtml = `<div class="news-box-alert"><div class="news-box-header">RECENT INCIDENTS (72H)</div>`;
        relatedNews.forEach(n => {
            newsHtml += `
            <div class="news-box-item">
                <div class="news-box-title">${n.title}</div>
                <div class="news-box-summary">${n.snippet || n.snippet_raw || ''}</div>
            </div>`;
        });
        newsHtml += `</div>`;
        newsContainer.innerHTML = newsHtml;
    } else {
        newsContainer.innerHTML = `
            <div class="safe-box">
              <i class="fas fa-check-circle safe-icon"></i>
              <div class="safe-text">No specific active incidents logged for ${country} in the last 72h.</div>
            </div>`;
    }
}

function loadHistory(dateStr) {
    if (!dateStr) return;
    const statusDiv = document.getElementById('history-status');
    if (!statusDiv) return;

    statusDiv.innerHTML = `<span class="spinner-border spinner-border-sm text-primary" role="status"></span> Loading...`;
    setTimeout(() => {
        statusDiv.innerHTML = `<span class="text-success"><i class="fas fa-check"></i> Archive Loaded: ${dateStr}</span>`;
        renderGeneralFeed(null, ARCHIVE_DATA);
    }, 800);
}

function downloadReport() {
    const feedback = document.getElementById('download-feedback');
    if (!feedback) return;
    feedback.style.display = 'block';
    feedback.innerHTML = `<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Retrieving...`;
    setTimeout(() => {
        feedback.innerHTML = `<div class="alert alert-success mt-2 text-start" style="font-size:0.8rem"><strong><i class="fas fa-check-circle"></i> Simulation Successful</strong></div>`;
    }, 1000);
}

function filterNews(region) {
    document.querySelectorAll('.nav-item-custom').forEach(el => {
        el.classList.remove('active');
        if (el.innerText.trim() === region) el.classList.add('active');
    });
    renderGeneralFeed(region);
    renderProximityAlerts(region);
    updateMap(region);
}
