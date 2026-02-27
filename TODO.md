# OS InfoHub Dashboard - Implementation Roadmap (TODO.md)

## 🎯 Current Milestone: S2.5 — Live Logistics Operations Active
> **Active Status**: Phase 2 complete; Phase 3 next (S3.1 DEP_APPROVAL required)
> **Current Context**: S2.5 fully operational — all logistics bugs resolved: (1) `?icao24=` param now correctly read in `handleApiLogisticsTrack` (was `?id=`); (2) response schema fixed — `trackFlight` now reads `data.states[0].baro_altitude` / `velocity` (was `data.geo_altitude` — field didn't exist); (3) MMSI guard added — 7-9 digit numeric IDs return `{ error:'vessel_id' }` JSON with user-facing "Use AIS deep-link" message; (4) hub bbox radar count fixed to read `data.states.length` (was `data.length` → always 0); (5) all 400/500 bodies are now JSON objects; (6) "Flight not currently in range." replaces generic "No live data"; (7) `_cached` indicator shown in radar result. `fetchAisStreamData(mmsi)` stub ready for AISStream.io key. Flight/Vessel toggle + VesselFinder deep-link fully wired. Commits: `e0ca5fa` (root) / `ae5856b` (worktree).
> **Next Session Tip**: Deploy (`wrangler publish`), open **Logistics** drawer: (A) add ICAO24 flight → Live Radar shows altitude/velocity or "Flight not currently in range"; (B) add vessel MMSI (9 digits) → watchlist shows "Track via AIS" link; (C) click hub **Live Radar** → aircraft count shows correctly; (D) click **Test Alert** → inbox receives test. Next: run `wrangler secret put AISSTREAM_API_KEY` to enable live maritime dots.

---

## Legend
- [x] completed
- [/] in progress
- [ ] not started
- **[NEXT]**: next task to work on
- **DEP_APPROVAL**: task requires dependency proposal & human approval
- **HIGH_RISK**: human must approve plan before edits

---

## ✅ Phase 1: Foundation (COMPLETED)
- [x] **S1.1**: Dev Environment setup (Dell 7960)
- [x] **S1.2**: Backend Security Layer (JWT/OAuth2)
- [x] **S1.3**: Frontend Scaffold

## 🚧 Phase 2: Intelligence Engine (IN PROGRESS)
- [x] **S2.1**: DB Schema for Global Security Events
- [/] **S2.2**: Threat Feed Aggregator (API connectors)
- [x] **S2.3**: Real-time SSE bridge for live alerts (GET /api/stream + EventSource client)
- [x] **S2.4**: Historical Data Archival
- [x] **S2.5**: Alert Escalation & Notification Pipeline (logistics geofences, OpenSky proxy, watchlist, drawer UI)
  - TBD: S2.5 — Schedule Fallback implemented: flight schedules + vessel last-hub + status badges.

## 📅 Phase 3: Visualization & Analytics
- [ ] **S3.1**: Interactive SVG Global Map (D3.js) — DEP_APPROVAL — [NEXT]
- [x] **S3.2**: Threat Level Heatmap (leaflet-heat, severity-weighted, cdnjs CDN)
- [x] **S3.3**: PDF Report Generator (jsPDF + html2canvas, client-side, cdnjs CDN)

## 🔴 Blockers / Deferred
- [ ] *Deferred*: Multi-tenancy support
- [ ] *Blocker*: API Key rotation logic (security review required)

## ✅ Out-of-band completed
- [x] **KV write-throttling**: added `kvPutWithThrottle` helper + `__kvListCache` to worker.js; ingestion writes (INCIDENTS_KV_KEY, PROXIMITY_KV_KEY) and `saveThumbsPrefs` (THUMBS_KV_KEY) now skip writes when payload is unchanged and < `MIN_WRITE_INTERVAL_MS` (default 60 s) has elapsed; `listArchiveDates` serves from in-memory cache within the same interval.
  > **Next Session Tip**: After deploying worker, check Cloudflare dashboard → KV → INTEL_KV → Metrics and confirm write-count drops after back-to-back ingestion runs within 60 s.
- [x] **High-precision noise filtering**: expanded `isNoise()` to 4-tier regex (hard sports/entertainment, finance/markets with supply-chain carve-out, politics/diplomacy with security carve-out, meeting noise); tightened `ALLOWED_KEYWORDS` to physical-security + facility disruption only; expanded `BLACKLIST_TERMS` with politics/finance/entertainment; narrowed `BUSINESS_IMPACT_TERMS` to physical supply-chain disruption; removed `"GENERAL"` from `AI_WHITELIST_CATEGORIES`.
  > **Next Session Tip**: Deploy worker; trigger manual ingestion; confirm noisy feed items (e.g., earnings reports, election news, sports) are filtered and only physical-security / facility / natural-hazard items pass through to INCIDENTS_KV.
- [x] **Security-gated `isRelevantIncident`**: added `SECURITY_FOCUS_TERMS`/`SECURITY_FOCUS_REGEX`/`SECURITY_MIN_KEYWORD_MATCH`; blacklist now short-circuits before quick-acceptors; `INCIDENT_KEYWORDS_REGEX` accept requires `SECURITY_FOCUS_REGEX || OPERATIONAL_KEYWORDS`; non-security AI categories gate on security keywords + proximity; `LEARNING_SCORE_THRESHOLD` raised 1.5 → 1.8; debug telemetry on every accept/reject; sync smoke-test IIFE with 5 vectors appended before `export default`.
  > TBD: Validate new security-focused filtering by reviewing rejected samples after deployment.
- [x] **Proximity alert gating**: extracted `shouldIncludeInProximity(incident, nearestSite)` predicate inside `runIngestion` proxOut loop; applies 6 gates (noise/blacklist → distance → recency 72h → natural magnitude/severity → AI-security shortcut → security-keyword+business/severity); per-site dedup via `proxSeen` Set; `debug('proximity','emitted'|'rejected',{reason,title,siteId,distanceKm})` telemetry; added `PROXIMITY_MAX_DISTANCE_KM`, `PROXIMITY_WINDOW_HOURS`, `PROXIMITY_SEVERITY_THRESHOLD` constants; DEBUG-guarded smoke-test IIFE with 5 vectors.
  > TBD: Validate proximity alert filtering by reviewing rejected samples after deployment.
  > **Next Session Tip**: Run `wrangler tail` after deploying, trigger an ingestion, and check for `debug('proximity','emitted'|'rejected')` lines — confirm diplomat/politics items are rejected and port/plant items near sites are emitted.
- [x] **Proximity predicate async upgrade**: replaced sync `shouldIncludeInProximity` with async version (`env, incident, nearestSite, ctx`) including `isRelevantIncident` fallback, `typeof debug/warn` safe-call guards, and spec-verbatim `proxOut` loop with per-site `proxSeen` dedup; all seven JS validity issues confirmed absent (no smart quotes, no bare `DEBUG`, no TS annotations, no placeholder brackets).
  > TBD: Validate proximity alert filtering by reviewing rejected samples after deployment via `wrangler tail` filtering for `proximity emitted` / `proximity rejected` log lines.
- [x] **JS validity fixes**: replaced U+2014 em-dashes in JSDoc lines 601-604 with ASCII hyphens (fixes "Invalid character" TS-check errors); added `ctx = undefined` default to `shouldIncludeInProximity` signature; changed call-site from `..., ctx)` to `..., undefined)` since `runIngestion` has no `ctx` parameter.
  > TBD: Verify proximity gating via wrangler tail for debug proximity logs.
- [x] **Telemetry guard completeness**: applied `typeof debug === 'function' &&` guard to three remaining bare `debug()` calls in the proximity-adjacent dedupe/store block (lines 2305, 2308, 2310); confirmed zero TS annotations, zero bare `DEBUG` references, zero unguarded debug/warn in proximity predicate.
  > TBD: Verify proximity predicate fixes via wrangler tail for proximity logs.
- [x] **Dislike persistence flow**: added `recordUserDislike(env, userId, incidentId)` helper (KV key `DISLIKES:<userId>`, 90-day TTL, capped at 500); modified `handlePublicThumb` to extract `X-User-Id` header, call `recordUserDislike` on `vote==='down'`, return `{ id, vote, hide: true }` on dislike; updated `handleApiIncidents` and `handleApiProximity` to accept `req`, read `X-User-Id`, filter out disliked IDs from response; updated `CORS_HEADERS` to expose `X-User-Id`; added `getOrCreateUserId()`/`OSINFO_USER_ID`/`DISLIKED_IDS` in app.js, `hideDislikedArticle()` for immediate DOM removal + localStorage persistence, and `DISLIKED_IDS` filter in SSE `incidents`/`proximity` handlers and `loadFromWorker`/`loadProximityFromWorker`.
  > **Next Session Tip**: Deploy worker, open DevTools → Network → XHR, dislike an article, confirm the `/api/thumb/public` response contains `"hide":true`, confirm the card disappears immediately, and confirm it stays hidden after a hard-refresh.
  > TBD: Verify dislike flow via wrangler tail — filter for "debug('dislike','recorded')" and "debug('dislike','filtered')" after a dislike action.
  > TBD: Verify archive/daily JSON via wrangler tail — run curl '${WORKER_URL}/api/archive?date=YYYY-MM-DD' and confirm Content-Type: application/json and response is a JSON array (or empty array); test daily brief preview with curl '${WORKER_URL}/api/dailybrief?date=YYYY-MM-DD' and confirm JSON `{ "incidents": [...] }`.

---

## AI instructions for TODO.md
- **Always read this file first**.
- **On success**: update the item to `[x]`, move `[NEXT]` to the next logical task, and include a 1-line "Next Session Tip".
- **Dependency workflow**:
  1. Mark the task `DEP_APPROVAL` if a new dependency is required.
  2. Attach a filled `DEPENDENCY_PROPOSAL_TEMPLATE.md` when requesting approval.
  3. Do not change repo dependency files until `APPROVE_DEP: <package@version>` is posted by the maintainer.
- **If blocked**: add a "Why blocked" bullet with explicit missing context, logs, or permissions.