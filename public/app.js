/* SRO Intelligence – Frontend Controller (Map + Proximity Panel)
   - Loads config/locations.json, data/news.json, data/proximity.json
   - Renders Dell sites and proximity alerts on the map
   - Removes all “TEST” flags; shows live updated timestamp and radius control
*/

let MAP;
let SITE_LAYER;
let ALERT_LAYER;

let DELL_SITES = [];
let NEWS_ITEMS = [];
let PROXIMITY = { generated_at: "", radius_km: 50, alerts: [] };

let currentRegion = "Global"; // Global | AMER | EMEA | APJC | LATAM
let currentRadius = 50;

const REGION_TABS = ["Global", "AMER", "EMEA", "APJC", "LATAM"];

document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  wireRadiusSelect();
  loadData().then(() => {
    initMap();
    renderSites();
    renderProximityAlerts();
    fitToMarkers();
  });
});

function wireTabs() {
  REGION_TABS.forEach((r) => {
    const el = document.querySelector(`[data-region="${r}"]`);
    if (el) {
      el.addEventListener("click", () => {
        document.querySelectorAll(".region-tab").forEach((x) => x.classList.remove("active"));
        el.classList.add("active");
        currentRegion = r;
        renderProximityAlerts();
        renderAlertMarkers();
        fitToMarkers();
      });
    }
  });
}

function wireRadiusSelect() {
  const sel = document.getElementById("radius-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    currentRadius = parseInt(sel.value, 10);
    renderProximityAlerts();
    renderAlertMarkers();
    fitToMarkers();
  });
}

async function loadData() {
  const [locRes, newsRes, proxRes] = await Promise.allSettled([
    fetch("config/locations.json", { cache: "no-cache" }),
    fetch("data/news.json", { cache: "no-cache" }),
    fetch("data/proximity.json", { cache: "no-cache" }),
  ]);

  if (locRes.status === "fulfilled" && locRes.value.ok) {
    try { DELL_SITES = await locRes.value.json(); } catch { DELL_SITES = []; }
  }
  if (newsRes.status === "fulfilled" && newsRes.value.ok) {
    try { NEWS_ITEMS = await newsRes.value.json(); } catch { NEWS_ITEMS = []; }
  }
  if (proxRes.status === "fulfilled" && proxRes.value.ok) {
    try { PROXIMITY = await proxRes.value.json(); } catch { PROXIMITY = {generated_at:"", radius_km:50, alerts:[]}; }
  }

  currentRadius = (typeof PROXIMITY.radius_km === "number" && PROXIMITY.radius_km > 0)
    ? PROXIMITY.radius_km : 50;

  // Initialize radius select options and updated timestamp
  const sel = document.getElementById("radius-select");
  if (sel) {
    const options = [5, 10, 25, 50, 100, 250];
    sel.innerHTML = options.map(v => `<option value="${v}" ${v===currentRadius ? "selected" : ""}>${v} km</option>`).join("");
  }
  const up = document.getElementById("prox-updated");
  if (up) {
    up.textContent = PROXIMITY.generated_at ? new Date(PROXIMITY.generated_at).toUTCString() : "—";
  }
}

function initMap() {
  if (MAP) return;
  MAP = L.map("map", { zoomControl: true, preferCanvas: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors",
  }).addTo(MAP);

  SITE_LAYER = L.layerGroup().addTo(MAP);
  ALERT_LAYER = L.layerGroup().addTo(MAP);
}

function renderSites() {
  SITE_LAYER.clearLayers();
  (DELL_SITES || []).forEach((s) => {
    if (!s || typeof s.lat !== "number" || typeof s.lon !== "number") return;
    const marker = L.marker([s.lat, s.lon], { title: s.name });
    marker.bindPopup(`<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.country)} • ${escapeHtml(s.region)}`);
    marker.addTo(SITE_LAYER);
  });
}

function renderAlertMarkers() {
  ALERT_LAYER.clearLayers();
  const alerts = filteredAlerts();
  alerts.forEach((a) => {
    if (typeof a.lat === "number" && typeof a.lon === "number") {
      const sev = parseInt(a.severity || 1, 10);
      const color = sev >= 3 ? "red" : (sev === 2 ? "orange" : "blue");
      const circle = L.circleMarker([a.lat, a.lon], { radius: 6, color, weight: 2, fillOpacity: 0.4 });
      circle.bindPopup(
        `<b>${badge(sev)} ${escapeHtml(a.article_title)}</b><br>` +
        `${escapeHtml(a.site_name)} – ${escapeHtml(a.site_country)}<br>` +
        `${a.distance_km != null ? `${a.distance_km} km` : ""}<br>` +
        (a.article_link ? `<a href="${a.article_link}" target="_blank" rel="noopener">Open article</a>` : "")
      );
      circle.addTo(ALERT_LAYER);
    }
  });
}

function fitToMarkers() {
  const allBounds = [];
  SITE_LAYER.eachLayer((l) => allBounds.push(l.getLatLng()));
  ALERT_LAYER.eachLayer((l) => allBounds.push(l.getLatLng()));
  if (allBounds.length === 0) return;
  const bounds = L.latLngBounds(allBounds);
  MAP.fitBounds(bounds.pad(0.2), { animate: false });
}

function filteredAlerts() {
  const alerts = Array.isArray(PROXIMITY.alerts) ? PROXIMITY.alerts : [];
  return alerts.filter((a) => {
    const regionOk = (currentRegion === "Global") || (a.site_region === currentRegion);
    const distOk = (typeof a.distance_km !== "number") ? true : (a.distance_km <= currentRadius);
    return regionOk && distOk;
  });
}

function renderProximityAlerts() {
  const container = document.getElementById("proximity-alerts-container");
  if (!container) return;
  const alerts = filteredAlerts();
  if (alerts.length === 0) {
    container.innerHTML = `<div class="empty">No proximity alerts within ${currentRadius} km.</div>`;
    ALERT_LAYER.clearLayers();
    return;
  }

  const html = alerts.map((a) => {
    const sev = parseInt(a.severity || 1, 10);
    return `
      <div class="prox-item">
        <div class="prox-row">
          <span class="sev sev-${sev}">${sevLabel(sev)}</span>
          <span class="distance">${typeof a.distance_km === "number" ? `${a.distance_km} km` : ""}</span>
        </div>
        <div class="title">${escapeHtml(a.article_title)}</div>
        <div class="meta">${escapeHtml(a.site_name)} • ${escapeHtml(a.site_country)} • ${escapeHtml(a.site_region)}</div>
        <div class="snippet">${escapeHtml(a.summary || "")}</div>
        <div class="link">${a.article_link ? `<a href="${a.article_link}" target="_blank" rel="noopener">Open article</a>` : ""}</div>
      </div>`;
  }).join("");

  container.innerHTML = html;
  renderAlertMarkers();
}

function sevLabel(s) {
  if (s >= 3) return "CRITICAL";
  if (s === 2) return "WARNING";
  return "INFO";
}

function badge(s) {
  return `<span class="sev sev-${s}">${sevLabel(s)}</span>`;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
}
