# Initiative: OS InfoHub "AI Brain" Upgrade

## 🎯 Vision
Transform the dashboard from a passive filter into an active intelligence assistant. The system must analyze, rank, and summarize security data with "commercial-grade" logic while maintaining a zero-budget profile using hybrid AI (Rules + TF-IDF + Optional LLM).

## 🧠 AI Capability Initiatives

### 1. The "Relevancy Engine" (Hybrid Ranking)
- **Logic**: Move beyond binary pass/fail filters. Every incident must receive a `relevance_score` (0.0–1.0).
- **Formula**: Score = (40% Heuristic) + (30% Semantic Similarity) + (10% Severity) + (10% Recency) + (10% Thumbs/Feedback).
- **Operational Effect**: The dashboard "Top News" will now be sorted by what actually matters to a Regional Security Manager, not just by time.

### 2. Semantic Awareness (The Zero-Budget Brain)
- **Local TF-IDF**: Use TF-IDF to identify clusters of related events without external APIs.
- **Security Seeds**: Compare news against curated "Security Seed Vectors" (e.g., "port blockade", "facility fire", "civil unrest near manufacturing").
- **Automatic Deduplication**: Use semantic similarity to group multiple reports of the same event into a single intelligence event.

### 3. Automated Executive Briefings (LLM Summarization)
- **Canonical Summaries**: When an LLM key is present, generate a strict 1–2 line "Executive Brief" for every high-severity incident.
- **Actionable Insights**: Extract WHO/WHAT/WHERE and suggest a 1-sentence "Recommended Action".

### 4. Continuous Learning (Feedback Loop)
- **Weight Updates**: Up/Down clicks immediately update `keywordWeights` in KV storage.
- **Dynamic Thresholds**: Learn noisy sources and automatically lower their trust score over time.

## 🛠 Technical Implementation Requirements
- **Surgical Edits**: Implement via new `/api/ai/rank` and `/api/ai/feedback` endpoints in `worker.js`. Do not refactor core ingestion.
- **Background Processing**: Use `ctx.waitUntil` for all AI scoring and summarization to keep the UI fast.
- **Cost Gating**: If `AI_MODE='tfidf'` external API calls must be disabled.
- **Defaults**: `AI_MODE` default = `tfidf`. `RECENT_WINDOW_HOURS` default = 72.

## Data model summary (high-level)
- `ai:meta:<incident_id>`: embedding|tfidf_vector|canonical_summary|relevance_score|operational_score|semantic_score|last_scored_at
- `ai:rules`: { keywordWeights: {...}, sourceWeights: {...}, produced_at }
- Per-user: `DISLIKES:<user_id>`

## API: minimum required
- `GET /api/ai/rank?region=&limit=&country=` — returns ranked items with relevance and scores
- `POST /api/ai/feedback` — accepts {id,user_id,action:'up'|'down'|'hide'}
- `POST /api/ai/summarize` — optional LLM call to generate canonical_summary (fallback extractive summary if no key)

## Tests & acceptance (human test)
- Deploy, seed 4–6 test incidents, set `AI_MODE=tfidf`, call `GET /api/ai/rank` and expect:
  - `items[]` sorted by `relevance_score`
  - Each item has `relevance_score`, `operational_score`, `semantic_score`
  - No outbound embedding/LLM calls in TF-IDF mode
- Feedback via `/api/ai/feedback` updates `ai:rules` and affects later ranking.

## Cost / zero-budget constraints
- Default mode = `tfidf` (zero external costs)
- Optional `hybrid` or `llm` only if `EMBEDDING_API_KEY` / `LLM_API_KEY` present
- Batch embedding & summarization in background `ctx.waitUntil`, cache results in KV with TTL

---
(End of AI_BRAIN_SPEC.md)