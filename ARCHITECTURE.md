# OS InfoHub — System Architecture & Usage (ARCHITECTURE.md)

## 🔄 Data Pipeline (summary)
1. **Ingestion**
   - `runIngestion(env, options)` fetches from deterministic and rotating sources (RSS/ATOM). Output: raw items.
2. **Normalization**
   - `normalizeIncident` / `normaliseWorkerIncident` convert raw items to normalized incident shape.
3. **Gating**
   - `isRelevantIncident` uses heuristic + AI gating (magnitude, category, operational keywords, thumbs/learning rules).
4. **Proximity**
   - `haversineKm` and `nearestDell` compute distance to Dell sites and mark proximity incidents.
5. **Alerts**
   - High-severity incidents call `sendAlertEmail` which builds rich HTML and sends via Resend; writes to KV to dedupe.
6. **Storage**
   - INTEL_KV holds `incidents`, `proximity`, `learning_rules`, and archives (with `archiveIncidents`).

## 🔐 Environment Variables (required/optional)
- `INTEL_KV`: Cloudflare KV binding (required)
- `RESEND_API_KEY`: Resend API key for outgoing emails (required for alerts)
- `EMAIL_FROM` or `RESEND_FROM`: sender address (recommended)
- `GROQ_API_KEY`: (optional) for Groq AI enrichment if configured
- `GEOCODE_API_KEY`: (optional) for reverse geocoding service
- `TRAVEL_API_URL`: (optional) external travel advisory endpoint override
- `LOG_LEVEL`: (optional) debug/info/warn/error (defaults to info)

> For local testing use `.env` and `.env.example`. Do not commit real secrets to Git.

## 🛠 How to run locally
**Frontend (dev server)**:
- `npm install`
- `npm run dev`  (or `npm start` depending on repo scripts)
- Open `http://localhost:3000` (or configured port).

**Worker (Cloudflare Wrangler)**:
- Install Wrangler v2+: `npm i -g wrangler`
- Configure `wrangler.toml` with `account_id`, `name`, and KV bindings
- `wrangler dev --local` (for local testing)
- `wrangler publish` (for deploy)

**Tests**
- `npm test` or `npm run test`
- For map-specific tests: `npm run test -- map`

## ✅ Claude Code (CLI) usage & conventions
**Preferred workflow**:
1. Create a branch for the change.
2. Provide `CLAUDE.md`, `TODO.md`, and `CODE_INDEX.md` to Claude (Projects or Code).
3. Use concise bundles: `git diff --unified=3` or a 10–60 line function block plus the short index entry.

**Example CLI prompt using `@file` notation (if supported)**: