## 6) `USAGE.md` (short dev & Claude instructions + `.env.example`)

```markdown
# Usage & Environment (USAGE.md)

## Quick start — frontend
1. `npm install`
2. `npm run dev`   # or `npm start` (check package.json)
3. Open browser at `http://localhost:3000` (or port from logs)

## Quick start — Cloudflare Worker (local)
1. Install Wrangler v2+: `npm i -g wrangler`
2. Create or update `wrangler.toml` with account and KV binding:
   ```toml
   name = "osinfohub-worker"
   account_id = "<ACCOUNT_ID>"
   type = "javascript"
   kv_namespaces = [
     { binding = "INTEL_KV", id = "<KV_ID>" }
   ]

### One-shot commit & push (copy/paste)
Run this from your repo root to add all six files to a branch and push:

```bash
cd /path/to/repo
git checkout -b chore/docs-machine-index
# create files by pasting content above into respective files (CLAUDE.md etc.)
git add CLAUDE.md TODO.md CODE_INDEX.md ARCHITECTURE.md DEPENDENCY_PROPOSAL_TEMPLATE.md USAGE.md
git commit -m "chore(docs): add machine-friendly CLAUDE.md, TODO.md, CODE_INDEX.md, ARCHITECTURE, dependency template, usage"
git push -u origin chore/docs-machine-index