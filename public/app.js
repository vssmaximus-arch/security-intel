// public/app.js

let currentRadius = 5;
let map, layerGroup;
let MAP_LOCATIONS = [];
let GENERAL_NEWS_FEED = [];
let PROXIMITY_DATA = { radius_km: 50, alerts: [] };
let CURRENT_PROX_ALERTS = [];

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    initMap();
    startClock();

    // Load data asynchronously
    await loadData();

    populateCountries();
    filterNews('Global');

    // Auto-refresh visible region every 5 minutes
    setInterval(() => {
        const activeEl = document.querySelector('.nav-item-custom.active');
        if (activeEl) filterNews(activeEl.innerText.trim());
        else filterNews('Global');
    }, 300000);

    // Set Date in Modal (Daily Briefings)
    const reportDateInput = document.getElementById('reportDate');
    if (reportDateInput) {
        reportDateInput.valueAsDate = new Date();
    }
});

async function loadData() {
    try {
        const [locResponse, newsResponse, proxResponse] = await Promise.all([
            fetch('config/locations.json'),
            fetch('data/news.json'),
            fetch('data/proximity.json').catch(() => null)
        ]);

        MAP_LOCATIONS = await locResponse.json();

        const newsJson = await newsResponse.json();
        GENERAL_NEWS_FEED = newsJson.articles || newsJson || [];

        if (proxResponse && proxResponse.ok) {
            const proxJson = await proxResponse.json();
            PROXIMITY_DATA.radius_km = proxJson.radius_km || 50;
            PROXIMITY_DATA.alerts = proxJson.alerts || [];
            console.log(`Loaded ${PROXIMITY_DATA.alerts.length} proximity alerts`);
        } else {
            console.log('No proximity.json found or fetch failed – Proximity Alerts panel will be empty.');
        }

        console.log('Data loaded successfully');
    } catch (error) {
        console.error('Error loading JSON data:', error);
        alert('Error loading data files. Please ensure config/locations.json and data/news.json exist.');
    }
}

// --- TRAVEL ADVISORY STATIC DATA (advisory levels) ---

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
    "Senegal": { level: 1, text: "Exercise Normal Precautions." },
    "Seychelles": { level: 1, text: "Exercise Normal Precautions." },
    "Singapore": { level: 1, text: "Exercise Normal Precautions." },
    "Slovakia": { level: 1, text: "Exercise Normal Precautions." },
    "Slovenia": { level: 1, text: "Exercise Normal Precautions." },
    "Solomon Islands": { level: 1, text: "Exercise Normal Precautions." },
    "Switzerland": { level: 1, text: "Exercise Normal Precautions." },
    "Taiwan": { level: 1, text: "Exercise Normal Precautions." },
    "Togo": { level: 1, text: "Exercise Normal Precautions." },
    "Tonga": { level: 1, text: "Exercise Normal Precautions." },
    "United Arab Emirates": { level: 1, text: "Exercise Normal Precautions." },
    "Uzbekistan": { level: 1, text: "Exercise Normal Precautions." },
    "Vanuatu": { level: 1, text: "Exercise Normal Precautions." },
    "Vietnam": { level: 1, text: "Exercise Normal Precautions." },
    "Zambia": { level: 1, text: "Exercise Normal Precautions." }
};

// base list (used + merged with advisory keys)
const COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina",
    "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh",
    "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
    "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso",
    "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic",
    "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (DRC)", "Congo (Republic)",
    "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti",
    "Dominica", "Dominican Republic", "East Timor", "Ecuador", "Egypt", "El Salvador",
    "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland",
    "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
    "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
    "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
    "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
    "Korea, North", "Korea, South", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
    "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
    "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
    "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia",
    "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
    "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia",
    "Norway", "Oman", "Pakistan", "Palau", "Panama", "Papua New Guinea", "Paraguay",
    "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
    "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa",
    "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia",
    "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands",
    "Somalia", "South Africa", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
    "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
    "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
    "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
    "Zambia", "Zimbabwe"
];

// ----- MAP + PROXIMITY -----

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        minZoom: 2,
        maxBounds: [[-90, -180], [90, 180]]
    }).setView([25, 10], 2);

    L.control.zoom({ position: 'topleft' }).addTo(map);

    L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
        { maxZoom: 19, noWrap: true }
    ).addTo(map);

    layerGroup = L.layerGroup().addTo(map);
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById('proxRadius').value);
    const activeEl = document.querySelector('.nav-item-custom.active');
    const currentRegion = activeEl ? activeEl.innerText.trim() : 'Global';
    renderProximityAlerts(currentRegion);
}

function classifyAlertIconAndColor(alert) {
    const type = (alert.type || '').toLowerCase();
    let icon = 'exclamation-triangle';
    let color = '#f9ab00';

    if (alert.severity >= 3) {
        color = '#d93025';
    } else if (alert.severity === 2) {
        color = '#e37400';
    }

    if (type.includes('fire') || type.includes('explosion') || type.includes('wildfire')) {
        icon = 'fire';
    } else if (type.includes('flood') || type.includes('storm') || type.includes('hurricane')) {
        icon = 'water';
    } else if (type.includes('power') || type.includes('grid') || type.includes('utility')) {
        icon = 'bolt';
    } else if (type.includes('protest') || type.includes('strike') || type.includes('riot')) {
        icon = 'fist-raised';
    }

    return { icon, color };
}

function renderProximityAlerts(filterRegion) {
    const container = document.getElementById('proximity-alerts-container');
    if (!container) return;

    const alerts = PROXIMITY_DATA.alerts || [];
    const filtered = alerts.filter(a => {
        const regionMatch =
            filterRegion === 'Global' ||
            a.site_region === filterRegion ||
            a.region === filterRegion;
        const distMatch = a.distance_km <= currentRadius;
        return regionMatch && distMatch;
    });

    CURRENT_PROX_ALERTS = filtered;

    if (filtered.length === 0) {
        container.innerHTML = `<div style="padding:15px; text-align:center; color:#999;">No alerts within ${currentRadius}km.</div>`;
        return;
    }

    let html = '';
    filtered.forEach(a => {
        const { icon, color } = classifyAlertIconAndColor(a);
        const distStr = `${a.distance_km.toFixed(1)}km`;
        html += `
        <div class="alert-row">
            <div class="alert-top">
                <div class="alert-type">
                    <i class="fas fa-${icon}" style="color:${color}; margin-right:8px;"></i> ${a.type || 'Incident'}
                </div>
                <div class="alert-dist" style="color:${color}">${distStr}</div>
            </div>
            <div class="alert-site">
                <i class="far fa-building"></i> ${a.site_name}
            </div>
            <div class="alert-desc">${a.summary || ''}</div>
        </div>`;
    });
    container.innerHTML = html;
}

// Icon helper for map pins
function getIconHtml(type) {
    if (type === 'fire') return '<i class="fas fa-fire" style="color:#d93025"></i>';
    if (type === 'bolt' || type === 'grid') return '<i class="fas fa-bolt" style="color:#e37400"></i>';
    if (type === 'water' || type === 'flood') return '<i class="fas fa-water" style="color:#f9ab00"></i>';
    if (type === 'fist-raised' || type === 'protest') return '<i class="fas fa-fist-raised" style="color:#333"></i>';
    return '<i class="fas fa-exclamation" style="color:#d93025"></i>';
}

function updateMap(filterRegion) {
    if (!layerGroup) return;
    layerGroup.clearLayers();

    const dellIcon = L.divIcon({
        className: 'custom-pin',
        html: `<div class="marker-pin-dell"><i class="fas fa-building"></i></div>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

    const filteredLocs =
        filterRegion === 'Global'
            ? MAP_LOCATIONS
            : MAP_LOCATIONS.filter(l => l.region === filterRegion);

    // 1) Dell sites + any static risk locations in locations.json
    filteredLocs.forEach(loc => {
        let icon = dellIcon;
        let tooltipContent = `<b>${loc.name || 'Dell Site'}</b>`;

        if (loc.type === 'risk') {
            icon = L.divIcon({
                className: 'custom-pin',
                html: `<div class="marker-incident">${getIconHtml(loc.subType)}</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });
            tooltipContent = `<b>${loc.name}</b><br>${loc.desc}`;
        }

        const marker = L.marker([loc.lat, loc.lon], { icon }).addTo(layerGroup);

        marker.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            className: 'map-tooltip'
        });

        marker.on('mouseover', function () { this.openTooltip(); });
        marker.on('mouseout', function () { this.closeTooltip(); });
    });

    // 2) Proximity alerts (real incidents), anchored near incident location
    CURRENT_PROX_ALERTS.forEach(a => {
        if (filterRegion !== 'Global' &&
            a.site_region !== filterRegion &&
            a.region !== filterRegion) {
            return;
        }

        const { icon } = classifyAlertIconAndColor(a);

        const incidentIcon = L.divIcon({
            className: 'custom-pin',
            html: `<div class="marker-incident">${getIconHtml(icon)}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const lat = a.incident_lat ?? a.site_lat;
        const lon = a.incident_lon ?? a.site_lon;

        const marker = L.marker([lat, lon], { icon: incidentIcon }).addTo(layerGroup);

        const tooltipContent =
            `<b>${a.type || 'Incident'}</b><br>${a.site_name}` +
            `<br>${a.summary || ''}` +
            `<br><span style="color:#f97316">${a.distance_km.toFixed(1)}km from site</span>`;

        marker.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            className: 'map-tooltip'
        });

        marker.on('mouseover', function () { this.openTooltip(); });
        marker.on('mouseout', function () { this.closeTooltip(); });
    });

    // region-specific map view
    if (filterRegion === 'AMER') map.setView([30, -90], 3);
    else if (filterRegion === 'EMEA') map.setView([45, 15], 3);
    else if (filterRegion === 'APJC') map.setView([20, 110], 3);
    else if (filterRegion === 'LATAM') map.setView([-15, -60], 3);
    else map.setView([25, 10], 2);
}

// ----- NEWS + CLOCK + TRAVEL + HISTORY + REPORTS -----

function renderGeneralFeed(filterRegion, dataOverride = null) {
    const container = document.getElementById('general-news-feed');
    if (!container) return;

    let html = '';
    const sourceData = dataOverride || GENERAL_NEWS_FEED;
    const filteredFeed =
        (filterRegion === 'Global' || !filterRegion)
            ? sourceData
            : sourceData.filter(item => item.region === filterRegion);

    if (filteredFeed.length === 0) {
        container.innerHTML =
            `<div style="padding:30px; text-align:center; color:#999;">No incidents.</div>`;
        return;
    }

    filteredFeed.forEach(item => {
        const barColor = item.severity === 3 ? 'status-bar-crit' : 'status-bar-warn';
        const badgeClass = item.severity === 3 ? 'ftag-crit' : 'ftag-warn';
        const badgeText = item.severity === 3 ? 'CRITICAL' : 'WARNING';

        html += `
        <a href="${item.url}" target="_blank" class="feed-card">
            <div class="feed-status-bar ${barColor}"></div>
            <div class="feed-content">
                <div class="feed-tags">
                    <span class="ftag ${badgeClass}">${badgeText}</span>
                    <span class="ftag ftag-type">${item.type}</span>
                    <span class="feed-region">${item.region}</span>
                </div>
                <div class="feed-title">${item.title}</div>
                <div class="feed-meta">${item.source} • ${item.time}</div>
                <div class="feed-desc">${item.snippet}</div>
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

        const dateEl = document.getElementById('clock-date');
        const timeEl = document.getElementById('clock-time');

        if (dateEl && timeEl) {
            dateEl.innerText = now.toLocaleDateString('en-US', dateOptions);
            timeEl.innerText = now.toLocaleTimeString('en-US', timeOptions);
        }
    }, 1000);
}

function populateCountries() {
    const sel = document.getElementById('countrySelect');
    if (!sel) return;

    const set = new Set();

    // base list
    COUNTRIES.forEach(c => set.add(c));
    // make sure every advisory country is included
    Object.keys(MOCK_ADVISORIES).forEach(c => set.add(c));

    const all = Array.from(set).sort((a, b) => a.localeCompare(b));

    all.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        sel.appendChild(opt);
    });
}

function filterTravel() {
    const sel = document.getElementById('countrySelect');
    const advContainer = document.getElementById('travel-advisories');
    const newsContainer = document.getElementById('travel-news');
    if (!sel || !advContainer || !newsContainer) return;

    const country = sel.value;
    let advisory = MOCK_ADVISORIES[country];

    let advColor = '#002a86'; // Level 1 Blue (Safe)
    let advBg = '#e8f0fe';
    let advBorder = '#d2e3fc';
    let levelText = 'LEVEL 1';

    if (!advisory) {
        advisory = { level: 1, text: 'Exercise Normal Precautions.' };
    } else {
        if (advisory.level === 2) {
            advColor = '#f9ab00'; advBg = '#fef7e0'; advBorder = '#feebc8'; levelText = 'LEVEL 2';
        } else if (advisory.level === 3) {
            advColor = '#e37400'; advBg = '#fff5e5'; advBorder = '#ffdecb'; levelText = 'LEVEL 3';
        } else if (advisory.level === 4) {
            advColor = '#d93025'; advBg = '#fce8e6'; advBorder = '#fad2cf'; levelText = 'LEVEL 4';
        }
    }

    advContainer.innerHTML =
        `<div class="advisory-box" style="background:${advBg}; border-color:${advBorder}">
            <div class="advisory-header">
                <span class="advisory-label">OFFICIAL ADVISORY</span>
                <span class="advisory-level-badge" style="background:${advColor}">${levelText}</span>
            </div>
            <div class="advisory-text" style="color:${advColor === '#002a86' ? '#0d47a1' : '#202124'}">
                ${advisory.text}
            </div>
        </div>`;

    const relatedNews = GENERAL_NEWS_FEED.filter(item =>
        item.title.includes(country) || item.snippet.includes(country)
    );

    if (relatedNews.length > 0) {
        let newsHtml =
            `<div class="news-box-alert">
                <div class="news-box-header">RECENT INCIDENTS (72H)</div>`;
        relatedNews.forEach(n => {
            newsHtml +=
                `<div class="news-box-item">
                    <div class="news-box-title">${n.title}</div>
                    <div class="news-box-summary">${n.snippet}</div>
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

function loadHistory(dateStr) {
    if (!dateStr) return;
    const statusDiv = document.getElementById('history-status');
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
    const feedback = document.getElementById('download-feedback');
    if (!feedback) return;

    feedback.style.display = 'block';
    feedback.innerHTML =
        `<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Retrieving...`;

    setTimeout(() => {
        feedback.innerHTML =
            `<div class="alert alert-success mt-2 text-start" style="font-size:0.8rem">
                <strong><i class="fas fa-check-circle"></i> Simulation Successful</strong>
             </div>`;
    }, 1000);
}

function filterNews(region) {
    document.querySelectorAll('.nav-item-custom').forEach(el => {
        el.classList.remove('active');
        if (el.innerText.trim() === region) el.classList.add('active');
    });

    renderGeneralFeed(region);
    renderProximityAlerts(region);   // sets CURRENT_PROX_ALERTS
    updateMap(region);               // uses CURRENT_PROX_ALERTS + MAP_LOCATIONS
}
