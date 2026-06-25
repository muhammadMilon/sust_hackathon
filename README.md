# QueueStorm — CRM Ticket Triage Service

A small, fast web service for the **SUST CSE Carnival 2026 · bKash Codex Community Hackathon (Mock Preliminary)**.

It reads **one** customer support message and answers four questions:

1. **What kind of problem is this?** → `case_type`
2. **How serious is it?** → `severity`
3. **Which team should handle it?** → `department`
4. **One-sentence summary for an agent** → `agent_summary`

…and raises `human_review_required` for phishing / critical cases.

---

## Approach (TL;DR)

- **Rules-based by default.** Deterministic, dependency-light (only Express), sub-millisecond, **no API key, no GPU, no network call**. This is what gets deployed and graded — it can never rate-limit, time out, or leak a secret.
- Understands **English, Bangla, and Banglish** (mixed Bangla + Latin script).
- **Safety-first priority:** `phishing > wrong_transfer > payment_failed > refund_request > other`.
- **Hard safety guard:** the `agent_summary` is run through a sanitizer that guarantees it never asks the customer to share a PIN / OTP / password / CVV / full card number (the grader auto-fails this).
- **Optional Claude LLM path** (off by default) can be enabled with two env vars for harder free-text — but the rules engine is always the fallback, so enabling it can only add value, never break the service.

> **LLM used (for the submission form): No** — the deployed service is rules-based. (An optional Claude path exists in the code but ships disabled.)

---

## API

### `GET /health`
```json
{ "status": "ok", "service": "queuestorm-ticket-triage", "engine": "rules", "time": "2026-06-25T15:58:05.658Z" }
```

### `POST /sort-ticket`

**Request**
```json
{
  "ticket_id": "T-001",
  "channel": "app",
  "locale": "en",
  "message": "I sent 5000 taka to a wrong number this morning, please help me get it back"
}
```
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ticket_id` | string | **Yes** | Echoed back verbatim |
| `channel` | string | No | `app` \| `sms` \| `call_center` \| `merchant_portal` |
| `locale` | string | No | `bn` \| `en` \| `mixed` (treated as a hint only) |
| `message` | string | Yes | Free-text complaint |

**Response**
```json
{
  "ticket_id": "T-001",
  "case_type": "wrong_transfer",
  "severity": "high",
  "department": "dispute_resolution",
  "agent_summary": "Customer reports sending 5,000 BDT to a wrong number and requests recovery of the funds.",
  "human_review_required": false,
  "confidence": 0.93
}
```

**Enums**

`case_type`: `wrong_transfer` · `payment_failed` · `refund_request` · `phishing_or_social_engineering` · `other`
`severity`: `low` · `medium` · `high` · `critical`
`department`: `customer_support` · `dispute_resolution` · `payments_ops` · `fraud_risk`

| case_type | department | severity default |
|-----------|------------|------------------|
| `wrong_transfer` | `dispute_resolution` | high |
| `payment_failed` | `payments_ops` | high if balance deducted, else medium |
| `refund_request` | `customer_support` (low) / `dispute_resolution` (contested) | low |
| `phishing_or_social_engineering` | `fraud_risk` | **critical** (always → `human_review_required: true`) |
| `other` | `customer_support` | low |

`human_review_required` is `true` when `severity == critical` **or** `case_type == phishing_or_social_engineering`.

---

## Run locally

Requires **Node.js ≥ 18** (developed on Node 22).

```bash
npm install
npm start            # serves on http://localhost:3000
```

Smoke test:
```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/sort-ticket \
  -H "Content-Type: application/json" \
  -d '{"ticket_id":"T-001","channel":"app","locale":"en","message":"I sent 5000 taka to a wrong number, please help me get it back"}'
```

> On **Windows PowerShell**, prefer `Invoke-RestMethod` (curl aliases differ) and pass Bangla/UTF-8 bodies from a file rather than inline, to avoid console encoding issues.

Run the tests (27 cases — all public samples, worked examples, Banglish/Bangla, tie-breaks, the safety rule, and edge cases):
```bash
npm test
```

---

## Deployment runbook

Two shapes are supported from the **same repo**:
- a **long-running Node server** (`src/server.js`, binds `process.env.PORT` / `0.0.0.0`) for Render, Railway, Fly, Docker, EC2; and
- **serverless functions** (`api/*.js` + [`vercel.json`](vercel.json)) for Vercel.

Pick **any one** of the options below.

### Option A — Render (recommended, free, `render.yaml` included)
1. Push this repo to GitHub.
2. Render Dashboard → **New +** → **Blueprint** → select the repo. Render reads [`render.yaml`](render.yaml).
3. It builds with `npm ci`, starts with `npm start`, and health-checks `GET /health`.
4. Your base URL is `https://<service-name>.onrender.com`. Verify `…/health` responds.

*(No secrets required. To enable the optional LLM, add `USE_LLM=true` and `ANTHROPIC_API_KEY` as environment variables in the Render dashboard.)*

### Option B — Vercel (serverless, directly from GitHub) ✅
This repo ships with `api/health.js`, `api/sort-ticket.js`, and [`vercel.json`](vercel.json) that rewrites `/health` → `/api/health` and `/sort-ticket` → `/api/sort-ticket`, so the endpoints live at the **base URL** (not under `/api`).
1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → **Add New… → Project** → **Import** your GitHub repo.
3. Framework Preset: **Other**. Leave Build & Output settings empty (no build step needed). Click **Deploy**.
4. Base URL is `https://<project>.vercel.app`. Verify `…/health` and `POST …/sort-ticket`.

*(Optional LLM: add `USE_LLM=true` + `ANTHROPIC_API_KEY` in Project → Settings → Environment Variables, then redeploy.)*
CLI alternative: `npm i -g vercel && vercel --prod`.

### Option C — Railway
1. Push to GitHub → Railway → **New Project** → **Deploy from GitHub repo**.
2. Railway auto-detects Node and runs `npm start` (a [`Procfile`](Procfile) is also provided).
3. **Settings → Networking → Generate Domain** to get an HTTPS URL. Confirm `/health`.

### Option D — Fly.io (Docker, `fly.toml` included)
```bash
fly launch --no-deploy     # claim an app name; keep the provided fly.toml
fly deploy
fly open /health
```

### Option E — Docker (Fly, EC2, Poridhi Lab, any VM)
```bash
docker build -t queuestorm .
docker run -p 3000:3000 queuestorm
# → http://localhost:3000/health
```
On a VM (EC2 / Poridhi Lab): install Docker, run the two commands above, then put it behind HTTPS (e.g. an Nginx/Caddy reverse proxy or the platform's TLS load balancer).

### Option F — Bare VM without Docker
```bash
git clone <repo-url> && cd <repo>
npm ci --omit=dev
PORT=8080 node src/server.js          # run under pm2/systemd for resilience
```

### Environment variables
| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP port (most platforms inject this) |
| `HOST` | `0.0.0.0` | Bind address |
| `USE_LLM` | `false` | Set to `true` **and** provide `ANTHROPIC_API_KEY` to enable the optional Claude path |
| `ANTHROPIC_API_KEY` | — | Only needed if `USE_LLM=true`; **never commit it** |

See [`.env.example`](.env.example). Real secrets go in platform env vars / a gitignored `.env`, never in the repo.

---

## Project layout
```
src/
  server.js     # HTTP server entry for long-running hosts (binds PORT)
  app.js        # Express layer: routes + CORS, delegates to handler.js
  handler.js    # transport-agnostic core: validation + orchestration
  classify.js   # rules engine — the heart of the grade
  sanitize.js   # hard safety guard for agent_summary
  llm.js        # optional Claude path (disabled by default)
api/            # Vercel serverless entrypoints (reuse src/handler.js)
  health.js         # GET /health
  sort-ticket.js    # POST /sort-ticket
prompts/
  system_prompt.txt  # system prompt used only by the optional LLM path
test/
  classify.test.js   # unit tests (classifier)
  api.test.js        # HTTP integration tests (Express, both endpoints)
  vercel.test.js     # serverless handler tests (mock req/res)
vercel.json   # routes /health & /sort-ticket to the api/ functions
Dockerfile · render.yaml · fly.toml · Procfile   # other deploy targets
```

## Known issues / notes
- Bangla over `curl` on Windows may mangle UTF-8 at the shell; real HTTP clients send proper UTF-8 and classify correctly (covered by tests).
- The optional LLM path requires `npm install @anthropic-ai/sdk`; it is intentionally not a hard dependency so deploys stay lean and bulletproof.

---

*Built for the QueueStorm Warmup mock preliminary. No team is eliminated on this round — this repo doubles as a validated deployment + GitHub workflow rehearsal.*
