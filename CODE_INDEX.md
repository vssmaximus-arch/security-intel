# CODE_INDEX.md — File Map & Signatures

- Path: index.html
  Purpose: Main UI Shell & CSP Security configuration.
  Main Components: #map, #general-news-feed, #proximity-alerts-container, #reportModal, #adminModal.
  Dependencies: Leaflet 1.9.4, MarkerCluster 1.5.3, Bootstrap 5.3.2, FontAwesome 6.4.2.
  Reference: index.html (frontend scaffold)

- Path: worker.js
  Purpose: Cloudflare Worker (Module Pattern) — ingestion, filtering, proximity, throttled KV writes, SSE streaming, archival, and alerting.
  Public Functions / Important Internals:
    - fetch(request, env, ctx) → main HTTP entrypoint handling API routes
    - runIngestion(env, options) → ingestion flow: merge feeds, enrich, and persist using throttled writes
    - kvPutWithThrottle(env, key, value, opts, minIntervalMs, force) → throttled KV put using `${key}__ts` sentinel; returns `{ wrote, reason }`
    - shouldIncludeInProximity(env, incident, nearestSite, ctx = undefined) → async 6-gate proximity predicate (distance, recency, noise/blacklist, AI category, security-keywords + business-impact/severity, natural-event gating)
    - handleApiStream(env, req) → GET `/api/stream` Server-Sent Events handler (initial snapshot + poll on `${INCIDENTS_KV_KEY}__ts`)
    - archiveIncidents(env, opts) → move incidents older than RETENTION_DAYS into date-partitioned archive shards (ARCHIVE_PREFIX) and update ARCHIVE_INDEX_KEY
    - listArchiveDates(env, limitPerPage) → returns archived dates (uses in-memory `__kvListCache` TTL)
    - isRelevantIncident(env, text, src, aiCategory, severity, coords, incidentMeta) → multi-stage gating logic (AI + keywords + proximity + business-impact)
    - sendAlertEmail(env, incident, opts) → builds & sends HTML via Resend
    - refreshTravelData(env, opts) → refresh & cache travel advisories
    - handleAdminAction(env, req, ctx) → admin triggers (ingest/list briefs, thumbs handling, archive-now)
  Main dependencies: INTEL_KV (Cloudflare KV), GROQ API (AI categories), RESEND_API_KEY, nearestDell helper, wrapLongitude helper
  Notes:
    - KV throttling uses a `${key}__ts` sentinel to avoid mutating stored shapes (arrays remain arrays).
    - Proximity dedupes by `incident.id + siteId`; emitted alerts include `{ siteId, distanceKm, reason, title }`.
    - Archive writes are chunked by date to avoid KV size limits and written with `force=true` to ensure correctness.
    - SSE endpoint polls the `${INCIDENTS_KV_KEY}__ts` sentinel to stream only when new data exists.

- Path: app.js
  Purpose: Frontend application logic — map state, clustering, UI interactions, normalization of incidents, and real-time feed client.
  Public Functions:
    - initMap() → configure Leaflet map, enable `worldCopyJump`, and register tile layers
    - wrapLongitude(lng) → normalize longitudes to `[-180, +180]` to avoid dateline duplication
    - renderAssetsOnMap(region) → render Dell assets on the map (clustered)
    - renderIncidentsOnMap(region, list) → render incidents and critical/highlight layers (uses normalized longitudes)
    - normaliseWorkerIncident(item) → normalize worker incident payloads for UI consumption
    - connectSSE() → EventSource client connecting to Worker `/api/stream` with exponential backoff and fallback polling
    - loadFromWorker(), loadProximityFromWorker() → fetch live feeds for initial page loads and fallback
  Main dependencies: Leaflet, leaflet.markercluster, WORKER_URL endpoints
  Notes:
    - Dateline duplication fixed via `wrapLongitude` + `worldCopyJump:true`.
    - SSE client replaces the previous setInterval poller and updates INCIDENTS/PROXIMITY_INCIDENTS on `incidents`/`proximity` events.

- Path: pages-deploy.yml
  Purpose: GitHub Actions workflow for automated deployment to GitHub Pages (CI/CD).
  Reference: pages-deploy.yml

- Path: worker.js
  Purpose: Cloudflare Worker — ingestion, filtering, proximity, throttled KV writes, SSE streaming, archival, alerting, and user dislike persistence.
  Public Functions / Important Internals (added/changed for dislike flow):
    - DISLIKES_KV_PREFIX (constant) → "DISLIKES:" prefix for per-user dislike keys
    - recordUserDislike(env, userId, incidentId) → stores per-user disliked incident IDs in INTEL_KV (DISLIKES:<userId>)
    - handlePublicThumb(env, body, req, ctx) → updated to extract X-User-Id, record dislikes on vote==='down' and return { hide: true } to client
    - handleApiThumb → updated routing to pass `req` into handlePublicThumb
    - handleApiIncidents(env, req) / handleApiProximity(env, req) → accept X-User-Id, load DISLIKES:<userId>, filter out disliked IDs before returning incidents/proximity
    - Updated CORS_HEADERS to allow `X-User-Id` in preflight
  Notes:
    - Disliked IDs are stored as JSON arrays (capped/TTL) and used to filter results server-side.
    - Telemetry: `debug('dislike','recorded',...)` and `debug('dislike','filtered',...)` emitted (guarded).
    - API contract: clients must send `X-User-Id` header to persist or request user-specific filtering.

- Path: app.js
  Purpose: Frontend application logic — map, SSE client, incident rendering, and dislike UX/flow.
  Public Functions / Important Internals (added/changed for dislike flow):
    - getOrCreateUserId() → creates/stores opaque `OSINFO_USER_ID` in localStorage
    - OSINFO_USER_ID (localStorage key) and DISLIKED_IDS (client-side Set) → client-side persistence for instant hide and filtering before server response
    - persistDislikedIds() → persist DISLIKED_IDS to localStorage
    - sendVoteToServer(...) → now includes `X-User-Id` header and parses `{ hide: true }` response
    - voteThumb(...) → on dislike + hide:true removes DOM card and updates DISLIKED_IDS
    - hideDislikedArticle(id) → client-side removal + persist
    - loadFromWorker() / loadProximityFromWorker() → include `X-User-Id` header and filter results client-side using DISLIKED_IDS (defensive)
    - connectSSE() → applies DISLIKED_IDS filter to SSE `incidents`/`proximity` events
  Notes:
    - `OSINFO_USER_ID` is an opaque per-browser id (no PII) used for per-user dislikes.
    - Client immediately hides disliked articles and server-side filtering prevents them returning on refresh.

# Notes
- Keep each CODE_INDEX entry terse. For edits, provide the specific function block (10–60 lines) and the relevant `CODE_INDEX.md` excerpt.
- If a function signature is updated in source, update this file concurrently.
- Verification checklist (post-change):
  1. Run `wrangler tail` and trigger ingestion. Confirm `debug('proximity','emitted',...)` appears only for security/physical incidents near sites.
  2. Confirm `kvPutWithThrottle` logs show `SKIP`/`WROTE` during bursts.
  3. Confirm `GET /api/stream` returns `incidents` when `${INCIDENTS_KV_KEY}__ts` advances.
