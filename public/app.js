let currentRadius = 5;
let map, layerGroup;
let MAP_LOCATIONS = [];
let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let PROXIMITY_META = { radius_km: 50, generated_at: null };

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    initMap();
    startClock();

    // Load Data asynchronously
    await loadData();

    populateCountries();
    filterNews('Global');

    // Auto-refresh view every 5 minutes
    setInterval(() => {
        const activeEl = document.querySelector('.nav-item-custom.active');
        if (activeEl) filterNews(activeEl.innerText.trim());
        else filterNews('Global');
    }, 300000);

    // Set Date in Modal
    if (document.getElementById('reportDate')) {
        document.getElementById('reportDate').valueAsDate = new Date();
    }
});

async function loadData() {
    try {
        const [locResponse, newsResponse, proxResponse] = await Promise.all([
            fetch('config/locations.json'),
            fetch('data/news.json'),
            fetch('data/proximity.json').catch(() => null)
        ]);

        // Locations (Dell sites)
        MAP_LOCATIONS = await locResponse.json();

        // News – expect { generated_at, articles: [...] }
        const newsRaw = await newsResponse.json();
        GENERAL_NEWS_FEED = Array.isArray(newsRaw)
            ? newsRaw
            : (newsRaw.articles || []);

        // Proximity alerts – optional
        if (proxResponse && proxResponse.ok) {
            const proxRaw = await proxResponse.json();
            PROXIMITY_META.radius_km = proxRaw.radius_km || 50;
            PROXIMITY_META.generated_at = proxRaw.generated_at || null;
            PROXIMITY_ALERTS = Array.isArray(proxRaw.alerts) ? proxRaw.alerts : [];
        } else {
            PROXIMITY_ALERTS = [];
        }

        console.log("Data loaded successfully", {
            locations: MAP_LOCATIONS.length,
            news: GENERAL_NEWS_FEED.length,
            proximity: PROXIMITY_ALERTS.length
        });
    } catch (error) {
        console.error("Error loading JSON data:", error);
        alert("Error loading data files. Please ensure config/locations.json, data/news.json and data/proximity.json exist.");
    }
}

// --- DATA CONSTANTS (kept in JS as configuration) ---

// Travel advisory levels
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

// MOCK_ADVISORIES is large; kept here rather than separate file
const MOCK_ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel due to civil unrest, armed conflict, crime, terrorism, kidnapping, and wrongful detention." },
    "Belarus": { level: 4, text: "Do Not Travel due to the arbitrary enforcement of laws, the risk of detention, and the buildup of Russian military." },
    "Burkina Faso": { level: 4, text: "Do Not Travel due to terrorism, crime, and kidnapping." },
    "Burma (Myanmar)": { level: 4, text: "Do Not Travel due to civil unrest, armed conflict, and arbitrary enforcement of laws." },
    "Central African Republic": { level: 4, text: "Do Not Travel due to crime, civil unrest, kidnapping, and armed conflict." },
    "Haiti": { level: 4, text: "Do Not Travel due to kidnapping, crime, and civil unrest." },
    "Iran": { level: 4, text: "Do Not Travel due to the risk of kidnapping and the arbitrary arrest and detention of U.S. citizens." },
    "Iraq": { level: 4, text: "Do Not Travel due to terrorism, kidnapping, armed conflict, and civil unrest." },
    "Libya": { level: 4, text: "Do Not Travel due to crime, terrorism, civil unrest, kidnapping, and armed conflict." },
    "Mali": { level: 4, text: "Do Not Travel due to crime, terrorism, and kidnapping." },
    "North Korea": { level: 4, text: "Do Not Travel due to the serious risk of arrest and long-term detention of U.S. nationals." },
    "Korea, North": { level: 4, text: "Do Not Travel due to the serious risk of arrest and long-term detention of U.S. nationals." },
    "Russia": { level: 4, text: "Do Not Travel due to the unpredictable consequences of the unprovoked full-scale invasion of Ukraine." },
    "Somalia": { level: 4, text: "Do Not Travel due to crime, terrorism, civil unrest, health issues, kidnapping, and piracy." },
    "South Sudan": { level: 4, text: "Do Not Travel due to crime, kidnapping, and armed conflict." },
    "Sudan": { level: 4, text: "Do Not Travel due to armed conflict, civil unrest, crime, terrorism, and kidnapping." },
    "Syria": { level: 4, text: "Do Not Travel due to terrorism, civil unrest, kidnapping, armed conflict, and risk of unjust detention." },
    "Ukraine": { level: 4, text: "Do Not Travel due to active armed conflict." },
    "Venezuela": { level: 4, text: "Do Not Travel due to crime, civil unrest, kidnapping, and the arbitrary enforcement of local laws." },
    "Yemen": { level: 4, text: "Do Not Travel due to terrorism, civil unrest, health risks, kidnapping, armed conflict, and landmines." },
    "Burundi": { level: 3, text: "Reconsider Travel due to crime, health, and political violence." },
    "Chad": { level: 3, text: "Reconsider Travel due to crime, terrorism, and civil unrest." },
    "Colombia": { level: 3, text: "Reconsider Travel due to crime and terrorism." },
    "Congo (DRC)": { level: 3, text: "Reconsider Travel due to crime and civil unrest." },
    "Egypt": { level: 3, text: "Reconsider Travel due to terrorism." },
    "El Salvador": { level: 3, text: "Reconsider Travel due to crime." },
    "Ethiopia": { level: 3, text: "Reconsider Travel due to sporadic conflict, civil unrest, and crime." },
    "Guatemala": { level: 3, text: "Reconsider Travel due to crime." },
    "Guinea-Bissau": { level: 3, text: "Reconsider Travel due to crime and civil unrest." },
    "Guyana": { level: 3, text: "Reconsider Travel due to crime." },
    "Honduras": { level: 3, text: "Reconsider Travel due to crime and kidnapping." },
    "Israel": { level: 3, text: "Reconsider Travel due to terrorism and civil unrest." },
    "Jamaica": { level: 3, text: "Reconsider Travel due to crime and medical services." },
    "Lebanon": { level: 3, text: "Reconsider Travel due to crime, terrorism, and armed conflict." },
    "Mauritania": { level: 3, text: "Reconsider Travel due to crime and terrorism." },
    "Nicaragua": { level: 3, text: "Reconsider Travel due to limited healthcare and arbitrary enforcement of laws." },
    "Niger": { level: 3, text: "Reconsider Travel due to crime, terrorism, and kidnapping." },
    "Nigeria": { level: 3, text: "Reconsider Travel due to crime, terrorism, civil unrest, kidnapping, and maritime crime." },
    "Pakistan": { level: 3, text: "Reconsider Travel due to terrorism and sectarian violence." },
    "Papua New Guinea": { level: 3, text: "Reconsider Travel due to crime, civil unrest, and health concerns." },
    "Saudi Arabia": { level: 3, text: "Reconsider Travel due to the threat of missile and drone attacks." },
    "Trinidad and Tobago": { level: 3, text: "Reconsider Travel due to crime." },
    "Uganda": { level: 3, text: "Reconsider Travel due to crime and terrorism." },
    "Algeria": { level: 2, text: "Exercise Increased Caution due to terrorism and kidnapping." },
    "Bangladesh": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and kidnapping." },
    "Belgium": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Belize": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Bolivia": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "Bosnia and Herzegovina": { level: 2, text: "Exercise Increased Caution due to terrorism and landmines." },
    "Brazil": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Cameroon": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Chile": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "China": { level: 2, text: "Exercise Increased Caution due to the arbitrary enforcement of local laws." },
    "Costa Rica": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Cuba": { level: 2, text: "Exercise Increased Caution due to demonstrated attacks targeting U.S. Embassy employees." },
    "Denmark": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Dominican Republic": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Ecuador": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "France": { level: 2, text: "Exercise Increased Caution due to terrorism and civil unrest." },
    "Germany": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Guinea": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "India": { level: 2, text: "Exercise Increased Caution due to crime and terrorism." },
    "Indonesia": { level: 2, text: "Exercise Increased Caution due to terrorism and natural disasters." },
    "Italy": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Jordan": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Kenya": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and kidnapping." },
    "Kosovo": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Madagascar": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Maldives": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Mexico": { level: 2, text: "Exercise Increased Caution due to widespread crime and kidnapping." },
    "Morocco": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Nepal": { level: 2, text: "Exercise Increased Caution due to potential for political unrest." },
    "Netherlands": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Peru": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "Philippines": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and civil unrest." },
    "Serbia": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Sierra Leone": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "South Africa": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "Spain": { level: 2, text: "Exercise Increased Caution due to terrorism and civil unrest." },
    "Sri Lanka": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Sweden": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Tajikistan": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Tanzania": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and targeting of LGBTI persons." },
    "Thailand": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "Tunisia": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Turkey": { level: 2, text: "Exercise Increased Caution due to terrorism and arbitrary detentions." },
    "Turkmenistan": { level: 2, text: "Exercise Increased Caution due to arbitrary enforcement of local laws." },
    "United Kingdom": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Uruguay": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Zimbabwe": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "Andorra": { level: 1, text: "Exercise Normal Precautions." },
    "Angola": { level: 1, text: "Exercise Normal Precautions." },
    "Argentina": { level: 1, text: "Exercise Normal Precautions." },
    "Armenia": { level: 1, text: "Exercise Normal Precautions." },
    "Australia": { level: 1, text: "Exercise Normal Precautions." },
    "Austria": { level: 1, text: "Exercise Normal Precautions." },
    "Azerbaijan": { level: 1, text: "Exercise Normal Precautions." },
    "Bahrain": { level: 1, text: "Exercise Normal Precautions." },
    "Barbados": { level: 1, text: "Exercise Normal Precautions." },
    "Benin": { level: 1, text: "Exercise Normal Precautions." },
    "Bhutan": { level: 1, text: "Exercise Normal Precautions." },
    "Botswana": { level: 1, text: "Exercise Normal Precautions." },
    "Brunei": { level: 1, text: "Exercise Normal Precautions." },
    "Bulgaria": { level: 1, text: "Exercise Normal Precautions." },
    "Cambodia": { level: 1, text: "Exercise Normal Precautions." },
    "Canada": { level: 1, text: "Exercise Normal Precautions." },
    "Croatia": { level: 1, text: "Exercise Normal Precautions." },
    "Cyprus": { level: 1, text: "Exercise Normal Precautions." },
    "Czech Republic": { level: 1, text: "Exercise Normal Precautions." },
    "Estonia": { level: 1, text: "Exercise Normal Precautions." },
    "Fiji": { level: 1, text: "Exercise Normal Precautions." },
    "Finland": { level: 1, text: "Exercise Normal Precautions." },
    "Gabon": { level: 1, text: "Exercise Normal Precautions." },
    "Georgia": { level: 1, text: "Exercise Normal Precautions." },
    "Ghana": { level: 1, text: "Exercise Normal Precautions." },
    "Greece": { level: 1, text: "Exercise Normal Precautions." },
    "Grenada": { level: 1, text: "Exercise Normal Precautions." },
    "Hungary": { level: 1, text: "Exercise Normal Precautions." },
    "Iceland": { level: 1, text: "Exercise Normal Precautions." },
    "Ireland": { level: 1, text: "Exercise Normal Precautions." },
    "Japan": { level: 1, text: "Exercise Normal Precautions." },
    "Kazakhstan": { level: 1, text: "Exercise Normal Precautions." },
    "Kuwait": { level: 1, text: "Exercise Normal Precautions." },
    "Kyrgyzstan": { level: 1, text: "Exercise Normal Precautions." },
    "Laos": { level: 1, text: "Exercise Normal Precautions." },
    "Latvia": { level: 1, text: "Exercise Normal Precautions." },
    "Lesotho": { level: 1, text: "Exercise Normal Precautions." },
    "Liberia": { level: 1, text: "Exercise Normal Precautions." },
    "Liechtenstein": { level: 1, text: "Exercise Normal Precautions." },
    "Lithuania": { level: 1, text: "Exercise Normal Precautions." },
    "Luxembourg": { level: 1, text: "Exercise Normal Precautions." },
    "Malawi": { level: 1, text: "Exercise Normal Precautions." },
    "Malaysia": { level: 1, text: "Exercise Normal Precautions." },
    "Malta": { level: 1, text: "Exercise Normal Precautions." },
    "Mauritius": { level: 1, text: "Exercise Normal Precautions." },
    "Mongolia": { level: 1, text: "Exercise Normal Precautions." },
    "Montenegro": { level: 1, text: "Exercise Normal Precautions." },
    "Mozambique": { level: 1, text: "Exercise Normal Precautions." },
    "Namibia": { level: 1, text: "Exercise Normal Precautions." },
    "New Zealand": { level: 1, text: "Exercise Normal Precautions." },
    "North Macedonia": { level: 1, text: "Exercise Normal Precautions." },
    "Norway": { level: 1, text: "Exercise Normal Precautions." },
    "Oman": { level: 1, text: "Exercise Normal Precautions." },
    "Panama": { level: 1, text: "Exercise Normal Precautions." },
    "Paraguay": { level: 1, text: "Exercise Normal Precautions." },
    "Poland": { level: 1, text: "Exercise Normal Precautions." },
    "Portugal": { level: 1, text: "Exercise Normal Precautions." },
    "Qatar": { level: 1, text: "Exercise Normal Precautions." },
    "Romania": { level: 1, text: "Exercise Normal Precautions." },
    "Rwanda": { level: 1, text: "Exercise Normal Precautions." },
    "Saint Kitts and Nevis": { level: 1, text: "Exercise Normal Precautions." },
    "Saint Lucia": { level: 1, text: "Exercise Normal Precautions." },
    "Saint Vincent and the Grenadines": { level: 1, text: "Exercise Normal Precautions." },
    "Samoa": { level: 1, text: "Exercise Normal Precautions." },
    "San Marino": { level: 1, text: "Exercise Normal Precautions." },
    "Sao Tome and Principe": { level: 1, text: "Exercise Normal Precautions." },
    "Senegal": { level: 1, text: "Exercise Normal Precautions." },
    "Seychelles": { level: 1, text: "Exercise Normal Precautions." },
    "Singapore": { level: 1, text: "Exercise Normal Precautions." },
    "Slovakia": { level: 1, text: "Exercise Normal Precautions." },
    "Slovenia": { level: 1, text: "Exercise Normal Precautions." },
    "Solomon Islands": { level: 1, text: "Exercise Normal Precautions." },
    "South Korea": { level: 1, text: "Exercise Normal Precautions." },
    "Suriname": { level: 1, text: "Exercise Normal Precautions." },
    "Switzerland": { level: 1, text: "Exercise Normal Precautions." },
    "Taiwan": { level: 1, text: "Exercise Normal Precautions." },
    "Togo": { level: 1, text: "Exercise Normal Precautions." },
    "Tonga": { level: 1, text: "Exercise Normal Precautions." },
    "United Arab Emirates": { level: 1, text: "Exercise Normal Precautions." },
    "United States": { level: 1, text: "Exercise Normal Precautions." },
    "Uruguay": { level: 1, text: "Exercise Normal Precautions." },
    "Uzbekistan": { level: 1, text: "Exercise Normal Precautions." },
    "Vanuatu": { level: 1, text: "Exercise Normal Precautions." },
    "Vatican City": { level: 1, text: "Exercise Normal Precautions." },
    "Vietnam": { level: 1, text: "Exercise Normal Precautions." },
    "Zambia": { level: 1, text: "Exercise Normal Precautions." }
};

const COUNTRIES = Object.keys(MOCK_ADVISORIES).sort();

// ---------------- Map & Proximity ----------------

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
        const distMatch = typeof a.distance_km === 'number'
            ? a.distance_km <= currentRadius
            : true;
        return regionMatch && distMatch;
    });

    if (alerts.length === 0) {
        container.innerHTML = `<div style="padding:15px; text-align:center; color:#999;">No proximity alerts within ${currentRadius}km.</div>`;
        return;
    }

    let html = '';
    alerts.forEach(a => {
        const sevColor = a.severity === 3 ? '#d93025' : (a.severity === 2 ? '#e37400' : '#f9ab00');
        const sevLabel = a.severity === 3 ? 'CRITICAL' : (a.severity === 2 ? 'WARNING' : 'INFO');
        const distStr = (typeof a.distance_km === 'number')
            ? `${a.distance_km.toFixed(1)}km`
            : '';

        html += `
        <div class="alert-row">
            <div class="alert-top">
                <div class="alert-type">
                    <span class="badge" style="background:${sevColor};color:white;margin-right:6px;">${sevLabel}</span>
                    ${a.article_title || 'Incident near Dell site'}
                </div>
                <div class="alert-dist" style="color:${sevColor}">${distStr}</div>
            </div>
            <div class="alert-site">
                <i class="far fa-building"></i> ${a.site_name || 'Dell Site'} (${a.site_country || ''})
            </div>
            <div class="alert-desc">${a.summary || ''}</div>
            <a href="${a.article_link || '#'}" target="_blank" class="alert-link">View source: ${a.article_source || ''}</a>
        </div>`;
    });
    container.innerHTML = html;
}

function getIconHtml(type) {
    if (type === 'fire') return '<i class="fas fa-fire" style="color:#d93025"></i>';
    if (type === 'grid') return '<i class="fas fa-bolt" style="color:#e37400"></i>';
    if (type === 'flood') return '<i class="fas fa-water" style="color:#f9ab00"></i>';
    if (type === 'protest') return '<i class="fas fa-fist-raised" style="color:#333"></i>';
    return '<i class="fas fa-exclamation" style="color:#d93025"></i>';
}

function updateMap(filterRegion) {
    layerGroup.clearLayers();

    const dellIcon = L.divIcon({
        className: 'custom-pin',
        html: `<div class="marker-pin-dell"><i class="fas fa-building"></i></div>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

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

    // Incident markers from proximity alerts
    const incidentAlerts = PROXIMITY_ALERTS.filter(a => {
        if (filterRegion !== 'Global' && a.site_region !== filterRegion) return false;
        if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return false;
        if (typeof a.distance_km === 'number' && a.distance_km > currentRadius) return false;
        return true;
    });

    incidentAlerts.forEach(a => {
        const sevType = a.severity === 3 ? 'fire' : (a.severity === 2 ? 'grid' : 'flood');
        const icon = L.divIcon({
            className: 'custom-pin',
            html: `<div class="marker-incident">${getIconHtml(sevType)}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([a.lat, a.lon], { icon }).addTo(layerGroup);
        const tooltip = `<b>${a.article_title || 'Incident'}</b><br>${a.site_name || ''}<br>${a.summary || ''}`;
        marker.bindTooltip(tooltip, {
            permanent: false,
            direction: 'top',
            className: 'map-tooltip'
        });
        marker.on('mouseover', function () { this.openTooltip(); });
        marker.on('mouseout', function () { this.closeTooltip(); });
    });

    // Region view
    if (filterRegion === 'AMER') map.setView([30, -90], 3);
    else if (filterRegion === 'EMEA') map.setView([45, 15], 3);
    else if (filterRegion === 'APJC') map.setView([20, 110], 3);
    else if (filterRegion === 'LATAM') map.setView([-15, -60], 3);
    else map.setView([25, 10], 2);
}

// ---------------- News Feed & UI ----------------

function renderGeneralFeed(filterRegion, dataOverride = null) {
    const container = document.getElementById('general-news-feed');
    const sourceData = dataOverride || GENERAL_NEWS_FEED;

    const filteredFeed = (filterRegion === 'Global' || !filterRegion)
        ? sourceData
        : sourceData.filter(item => item.region === filterRegion);

    if (!filteredFeed || filteredFeed.length === 0) {
        container.innerHTML = `<div style="padding:30px; text-align:center; color:#999;">No incidents.</div>`;
        return;
    }

    let html = '';
    filteredFeed.forEach(item => {
        const sev = item.severity || 1;
        const barColor = sev === 3 ? 'status-bar-crit' : (sev === 2 ? 'status-bar-warn' : 'status-bar-info');
        const badgeClass = sev === 3 ? 'ftag-crit' : (sev === 2 ? 'ftag-warn' : 'ftag-info');
        const badgeText = sev === 3 ? 'CRITICAL' : (sev === 2 ? 'WARNING' : 'INFO');

        html += `
        <a href="${item.link}" target="_blank" class="feed-card">
            <div class="feed-status-bar ${barColor}"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="ftag ${badgeClass}">${badgeText}</span>
                    <span class="ftag ftag-type">${item.type || 'GENERAL'}</span>
                    <span class="feed-region">${item.region || 'Global'}</span>
                </div>
                <div class="feed-title">${item.title}</div>
                <div class="feed-meta">${item.source} • ${item.timestamp}</div>
                <div class="feed-desc">${item.summary}</div>
            </div>
        </a>`;
    });
    container.innerHTML = html;
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        const timeOptions = { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
        if (document.getElementById('clock-date')) {
            document.getElementById('clock-date').innerText = now.toLocaleDateString('en-US', dateOptions);
            document.getElementById('clock-time').innerText = now.toLocaleTimeString('en-US', timeOptions);
        }
    }, 1000);
}

function populateCountries() {
    const sel = document.getElementById('countrySelect');
    if (!sel) return;
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
    let advisory = MOCK_ADVISORIES[country];

    let advColor = "#002a86"; // Level 1
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
            <div class="advisory-text" style="color:${advColor === '#002a86' ? '#0d47a1' : '#202124'}">${advisory.text}</div>
        </div>`;

    const relatedNews = GENERAL_NEWS_FEED.filter(item =>
        (item.title && item.title.includes(country)) ||
        (item.summary && item.summary.includes(country))
    );

    if (relatedNews.length > 0) {
        let newsHtml = `<div class="news-box-alert"><div class="news-box-header">RECENT INCIDENTS (72H)</div>`;
        relatedNews.slice(0, 10).forEach(n => {
            newsHtml += `
            <div class="news-box-item">
                <div class="news-box-title">${n.title}</div>
                <div class="news-box-summary">${n.summary}</div>
            </div>`;
        });
        newsHtml += `</div>`;
        newsContainer.innerHTML = newsHtml;
    } else {
        newsContainer.innerHTML = `<div class="safe-box"><i class="fas fa-check-circle safe-icon"></i><div class="safe-text">No specific active incidents logged for ${country} in the last 72h.</div></div>`;
    }
}

function loadHistory(dateStr) {
    if (!dateStr) return;
    const statusDiv = document.getElementById('history-status');
    statusDiv.innerHTML = `<span class="spinner-border spinner-border-sm text-primary" role="status"></span> Loading...`;
    setTimeout(() => {
        statusDiv.innerHTML = `<span class="text-success"><i class="fas fa-check"></i> Archive Loaded: ${dateStr}</span>`;
        renderGeneralFeed(null, ARCHIVE_DATA);
    }, 800);
}

function downloadReport() {
    const feedback = document.getElementById('download-feedback');
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
