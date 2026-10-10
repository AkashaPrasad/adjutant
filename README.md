<div align="center">

# Adjutant Gate

**The action layer that lets AI agents touch real systems safely.**

[![Deploy](https://github.com/AkashaPrasad/adjutant/actions/workflows/deploy.yml/badge.svg)](https://github.com/AkashaPrasad/adjutant/actions/workflows/deploy.yml)
[![CI](https://github.com/AkashaPrasad/adjutant/actions/workflows/ci.yml/badge.svg)](https://github.com/AkashaPrasad/adjutant/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[Live console](https://adjutant.spacesdrive.cc) · [API](https://api.adjutant.spacesdrive.cc/docs) · [Deployment](docs/DEPLOYMENT.md)

</div>

Agents can now decide to act. What fails is everything between that decision and the action landing in a real system: emails that cannot be recalled, approvals that drift from what actually runs, prompts people rubber-stamp, and "done" claims nobody checked. Adjutant Gate sits between any agent and its tools so every side effect is **previewed, approved only when it needs to be, executed once, undone where possible, and verified**.

## How it works

| Problem | What Gate does | What you get |
| --- | --- | --- |
| Duplicate or irreversible actions | Effect ledger keyed on `(run, node, args_hash)`; compensation runs newest-first | No double sends; undo where possible |
| Approval fatigue | Shadow run first (reads real, writes previewed), then one batched plan diff | One review per task, not per call |
| Approved one thing, ran another | Approval is bound to the args hash; any edit goes back through the gate | What you saw is what ships |
| Injected content choosing a recipient | Per-argument taint: untrusted data may fill a body, never `to`, `channel` or a target id | Inbound mail cannot redirect actions |
| False "done" | Checkable done-criteria verified against real outputs | Done means verified |
| No evidence for auditors | Signed audit packet per run: plan, diff, decision, reviewer, effects | Ready for audit and AI Act logs |

Planning and done-criteria judgment use **Meta Muse Spark 1.3 Contributor** (`muse-spark-1.3-contributor`). Policy, taint, hashing and the ledger are deterministic code.

## Repository layout

```
backend/    FastAPI service: gate, policy, effect ledger, sandbox tool adapters, Muse client
frontend/   Vite + React console: new run, plan-diff review, runs, effect ledger
infra/      AWS host bootstrap + provisioning, Cloudflare DNS/Pages scripts, signed deploy
docs/       Architecture and deployment notes
.github/    CI and production deploy workflows
```

## Quick start

```bash
cp .env.example .env            # fill in MUSE_API_KEY for planning (optional for the rest)

# backend  ->  http://localhost:8000/docs
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000

# frontend ->  http://localhost:5173
cd frontend && npm install && npm run dev
```

Tests: `cd backend && uv run pytest -q && uv run ruff check .` and `cd frontend && npm run typecheck && npm run build`.

## Deployment

Every push to `main` goes to production through [`deploy.yml`](.github/workflows/deploy.yml):

1. **CI**: backend lint and tests, frontend typecheck and build. A failure stops the deploy.
2. **Backend** → AWS Lightsail (ap-south-1) at `https://api.adjutant.spacesdrive.cc`. Actions sends an Ed25519-signed deploy request; the host checks out that exact commit, syncs dependencies, restarts, and Actions waits until `/health` reports the new commit.
3. **Frontend** → Cloudflare Pages at `https://adjutant.spacesdrive.cc`, built against the production API.

The console header shows the live API and web commit SHAs, so you can confirm a push is live. Details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## API at a glance

`GET /health` · `GET /v1/tools` · `POST /v1/plan` · `POST /v1/runs` · `GET /v1/runs[/{id}]` · `POST /v1/runs/{id}/decision|edit|execute|undo` · `GET /v1/runs/{id}/audit` · `POST /v1/audit/verify` · `GET /v1/ledger` · `GET /v1/stats` · `GET /v1/sandbox`

Interactive docs at [`/docs`](https://api.adjutant.spacesdrive.cc/docs).

## License

[Apache-2.0](LICENSE)
