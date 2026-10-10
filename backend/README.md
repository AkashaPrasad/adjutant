# Adjutant Gate (backend)

A drop-in action layer between an AI agent and its tools. Every side effect is **previewed** (shadow run),
**approved only when needed**, **bound to its exact arguments** (args hash), **executed exactly once** through an
effect ledger, **undoable** (compensation newest-first), **verified**, and recorded in a **signed audit packet**.

Stack: Python 3.12, FastAPI, pydantic v2, httpx, SQLite (WAL). LLM: Meta Muse Spark 1.3 Contributor only.

## Run locally

```bash
uv sync
cp .env.example .env            # optional; export the variables you need (the app reads the process env)
uv run uvicorn app.main:app --reload --port 8000
# open http://localhost:8000/docs
```

Production (behind Caddy):

```bash
uv sync --frozen --no-dev
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Docker (local): `docker build -t adjutant-gate . && docker run -p 8000:8000 -v adjutant-data:/app/data adjutant-gate`

## Test and lint

```bash
uv run pytest -q
uv run ruff check .
```

Tests never touch the network: the Muse client is exercised with `httpx.MockTransport`, and API tests use a fake LLM.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MUSE_API_KEY` | (empty) | Without it `/v1/plan` returns 503 and verification is deterministic; everything else works. |
| `MUSE_BASE_URL` | `https://api.meta.ai/v1` | OpenAI-compatible Chat Completions base URL. |
| `MUSE_MODEL` | `muse-spark-1.3-contributor` | |
| `ADJUTANT_DB_PATH` | `./data/adjutant.db` | SQLite file (WAL). Holds runs, ledger, events and sandbox state. |
| `ADJUTANT_SIGNING_KEY` | dev key (warns) | HMAC-SHA256 key for audit packets. Set in production. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins. |
| `GIT_SHA`, `DEPLOYED_AT`, `APP_ENV` | `dev`, null, `development` | Reported by `/health`. |
| `MUSE_REASONING_EFFORT` / `MUSE_VERIFY_REASONING_EFFORT` | `low` / `minimal` | Reasoning effort for planning / verification. |
| `MUSE_TIMEOUT_S`, `MUSE_MAX_RETRIES` | `30`, `2` | Per-attempt HTTP timeout and retries for Muse. |
| `PLAN_BUDGET_S`, `VERIFY_BUDGET_S` | `45`, `20` | Wall-clock budgets. Plan -> `504 llm_timeout`; verify -> deterministic fallback. |
| `PLAN_HEDGE_S`, `VERIFY_HEDGE_S` | `12`, `8` | Fire a second identical Muse request if the first has not answered by then (0 disables). |
| `REQUEST_TIMEOUT_S` | `90` | Backstop for every request (`504 timeout`). |

## How it works

1. **Shadow run** (`POST /v1/runs`): for each action, compute `args_hash = sha256(canonical_json({tool, args}))`,
   validate, and `simulate` it. Reads run for real; writes are only previewed. The result is one plan diff.
2. **Deterministic policy** (`app/policy.py`), no model involved:
   invalid args or **untrusted data in a sensitive argument** (e.g. `email.send.to`, `slack.post.channel`,
   `crm.update.record_id`, `http.get.url`) -> **blocked**; irreversible write -> **approval required (high)**;
   reversible write carrying untrusted content -> **approval required (medium)**; reversible write -> **auto-approved
   (low)** when `auto_approve_low_risk`; read -> auto. Argument provenance comes from `arg_sources`
   (`"user"` | `"untrusted"`, default `"user"`; plans drafted by Muse default unlabeled args to `"untrusted"`).
3. **Approval bound to hashes** (`/decision`): the reviewer approves specific `args_hash` values. A hash that is not
   in the current plan -> `409 stale_approval`; a blocked item -> `409 item_blocked`. Pending items not approved are
   declined. Any `/edit` recomputes the hash and re-gates the item.
4. **Exactly-once execution** (`/execute`): each approved item is executed and written to the effect ledger in one
   SQLite transaction, keyed `UNIQUE(run_id, node_id, args_hash)`. Calling execute again replays the stored result.
   A failed effect halts the run; the remaining items are `skipped`.
5. **Verification**: every effect is re-checked against sandbox state (`tool.verify`); done-criteria are judged by
   Muse against the real outputs when a key is configured, otherwise deterministically.
6. **Undo** (`/undo`): compensates reversible effects newest-first; irreversible ones are recorded `not_reversible`.
7. **Audit** (`/audit`): HMAC-SHA256 over the canonical JSON of plan, diff, decision, reviewer, effects,
   verification, undo and the event log.

Tools are simulated sandbox adapters (`app/tools.py`) with state in SQLite:
`email.send` (irreversible), `slack.post` (undo: delete), `crm.update` (undo: restore previous values),
`calendar.create_event` (undo: cancel), `http.get` (read; sandboxed pages, content untrusted), `docs.search` (read).
Seeded CRM records: `acct-1001`..`acct-1004`; seeded inbox: `inb-2291` (injected bank-detail email), `inb-4417`.

## API

All errors: `{"error": {"code", "message"}}`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Status, version, commit, deployed_at, env, model, llm_configured |
| GET | `/v1/tools` | Tool catalog (kind, reversible, sensitive_args, args) |
| POST | `/v1/plan` | `{goal, context?}` -> Muse-drafted `{actions, done_criteria, dropped}` (503 without key) |
| POST | `/v1/runs` | `{goal, actions, done_criteria?, auto_approve_low_risk?}` -> shadow run + plan diff |
| GET | `/v1/runs?limit=` | Runs, newest first |
| GET | `/v1/runs/{id}` | Run with diff, decision, effects, verification, undo |
| POST | `/v1/runs/{id}/decision` | `{decision, reviewer, approved_hashes, note?}` |
| POST | `/v1/runs/{id}/edit` | `{node_id, args, arg_sources?}` -> re-gates the item |
| POST | `/v1/runs/{id}/execute` | Execute once through the ledger, then verify |
| POST | `/v1/runs/{id}/undo` | Compensate newest-first |
| GET | `/v1/runs/{id}/audit` | `{packet, signature, algorithm: "HMAC-SHA256", key_id}` |
| POST | `/v1/audit/verify` | `{packet, signature}` -> `{valid}` |
| GET | `/v1/ledger?limit=` | Recent effects across runs |
| GET | `/v1/stats` | Runs by status, effects, prompts avoided |
| GET | `/v1/sandbox` | Current sandbox state (outbox, Slack, CRM, calendar, inbox) |
| GET | `/v1/activity?limit=` | Events across runs, newest first |
| GET | `/v1/scenarios` | Five demo scenarios with pre-built plans |
| POST | `/v1/scenarios/{id}/run` | Create a run from a scenario |
| POST | `/v1/demo/reset` | `{seed?}`: wipe and re-seed; optionally add ~8 historical runs |

Full response shapes with examples: [`docs/API.md`](../docs/API.md).

Example:

```bash
curl -s localhost:8000/v1/runs -H 'content-type: application/json' -d '{
  "goal": "Tell #sales about Acme and email Dana",
  "actions": [
    {"node_id": "n1", "tool": "slack.post", "args": {"channel": "#sales", "text": "Acme researched"}},
    {"node_id": "n2", "tool": "email.send",
     "args": {"to": "dana@ourco.example", "subject": "Acme", "body": "Summary attached"}}
  ],
  "done_criteria": ["Dana received the Acme summary"]
}'
```
