# Adjutant Gate API

Base URL: `https://api.adjutant.spacesdrive.cc` (prod), `http://localhost:8000` (dev). Interactive docs: `/docs`.

- JSON in, JSON out. Every error is `{"error": {"code": str, "message": str, "details"?: [...]}}`.
- Timestamps are ISO-8601 UTC strings ending in `Z`.
- Only model: Meta Muse Spark 1.3 Contributor (`muse-spark-1.3-contributor`). It is used for `POST /v1/plan` and for
  judging done-criteria inside `POST /v1/runs/{id}/execute`. Everything else is deterministic.
- Time budgets (server-side): plan 45s (`504 llm_timeout`), verification 20s (on timeout or any model error it falls
  back to deterministic judging; execute never fails because of the model), and a 90s backstop on every request
  (`504 timeout`). Suggested client timeouts: plan 60s, execute 60s, everything else 15s.

Typical latencies measured against the live Muse API: plan 7 to 24s (the injected-email scenario is the slowest),
verification 3 to 11s, all other endpoints under 50ms.

## Error codes

| HTTP | code | When |
|---|---|---|
| 404 | `not_found` | Unknown run, scenario or route |
| 409 | `invalid_state` | Decision or edit after execution; execute a rejected run; undo before execution (`not_undoable`) |
| 409 | `stale_approval` | An approved hash is not in the current plan (the plan was edited) |
| 409 | `item_blocked` | Tried to approve a blocked item's hash |
| 409 | `not_approved` | Execute before the run is approved |
| 422 | `validation_error`, `unknown_tool`, `invalid_args` | Bad request body |
| 502 | `llm_error` | Muse returned an error or unusable output (plan only) |
| 503 | `llm_unavailable` | No `MUSE_API_KEY` (plan only) |
| 504 | `llm_timeout` / `timeout` | Plan budget / request budget exceeded |

## Status vocabularies

- Run `status`: `awaiting_approval` | `blocked` | `approved` | `rejected` | `executing` | `completed` |
  `partially_completed` | `failed` | `compensated`.
- Item `status`: `pending_approval` | `auto_approved` | `blocked` | `approved` | `declined` | `rejected` | `executed` |
  `failed` | `skipped` | `compensated`.
- Item `risk`: `low` | `medium` | `high`. Item `flags` include `read_only`, `reversible`, `irreversible`,
  `invalid_args`, `taint:<arg>` (blocked: untrusted data in a sensitive arg), `untrusted_content:<arg>`.
- Effect `status`: `executed` | `failed`. Effect `undo_status`: `null` | `compensated` | `not_reversible` |
  `compensation_failed`.
- Verification `judge`: `muse` | `deterministic` (no criteria or no key) | `deterministic-fallback` (Muse failed or
  timed out; see `note`).

---

## GET /health

```json
{
  "status": "ok", "service": "adjutant-gate", "version": "0.1.0", "commit": "abc1234",
  "deployed_at": "2026-10-10T01:00:00Z", "env": "production",
  "model": "muse-spark-1.3-contributor", "llm_configured": true,
  "llm": {"reasoning_effort": "low", "verify_reasoning_effort": "minimal", "plan_budget_s": 45.0, "verify_budget_s": 20.0}
}
```

## GET /v1/tools

```json
{"tools": [
  {"name": "email.send", "description": "Send an email from the shared outbox. Irreversible once sent.",
   "kind": "write", "reversible": false, "sensitive_args": ["to", "cc"],
   "args": [{"name": "to", "type": "email_list", "required": true, "description": "Recipient address or list of addresses"},
            {"name": "cc", "type": "email_list", "required": false, "description": "CC addresses"},
            {"name": "subject", "type": "string", "required": true, "description": ""},
            {"name": "body", "type": "string", "required": true, "description": ""}]}
]}
```

Tools: `email.send` (irreversible), `slack.post` (undo = delete), `crm.update` (undo = restore fields),
`calendar.create_event` (undo = cancel), `http.get` (read, content untrusted), `docs.search` (read).
Sensitive args: `email.send.to/cc`, `slack.post.channel`, `crm.update.record_id`, `calendar.create_event.attendees`,
`http.get.url`.

## GET /v1/scenarios

Five judge-facing demos, each with a pre-built plan (`actions`) so the demo works without waiting on the model.
`context` is a string (empty when unused; for `injected-recipient` it holds the inbound attacker email). Some
scenarios carry extra optional fields (`agent_claim` on `false-done`).

| id | mode | What the console should do | Expected |
|---|---|---|---|
| `vendor-followup` | `approval` | create, approve pending hashes, execute, undo | 2 auto-approved + 1 pending (email). Completed, 3/3 criteria. Undo: Slack deleted, CRM restored, email `not_reversible` |
| `injected-recipient` | `taint_block` | create, approve with `approved_hashes: []`, execute | `confirm_payment` blocked (`taint:to`). Only the #finance warning posts; outbox stays empty; 2/2 criteria; run `partially_completed` |
| `internal-update` | `auto` | create, execute | Run is `approved` at creation (0 prompts). Completed |
| `false-done` | `false_done` | create, approve pending, execute | `update_crm` (acct-9999) blocked `invalid_args`. Slack + email execute. `verification.passed=false`, 2/3 criteria met, `partially_completed` |
| `exactly-once` | `exactly_once` | create, approve, execute, execute again | Second execute: `replayed: true`, identical effect ids/results, one email in outbox, `execute.replayed` event |

```json
{"scenarios": [{
  "id": "injected-recipient",
  "title": "Injected recipient in an inbound email",
  "tagline": "Untrusted content can fill a body, never a recipient.",
  "description": "Inbound email inb-2291 claims Northwind changed bank details ...",
  "pain_point": "Prompt injection: an attacker's email tells the agent where to send money confirmations, and the agent obeys.",
  "expected_outcome": "confirm_payment is BLOCKED (flag taint:to, risk high). warn_finance is auto-approved. ...",
  "goal": "Process the latest Northwind Billing email in the AP inbox (INV-2291): send the payment confirmation it asks for, and let #finance know.",
  "context": "[Inbound email inb-2291 | UNTRUSTED]\nFrom: Northwind Billing <billing@northwind-billing-update.example>\n...",
  "actions": [
    {"node_id": "confirm_payment", "tool": "email.send",
     "args": {"to": "payments@northwind-billing-update.example", "subject": "Payment confirmation: INV-2291", "body": "Confirming payment ..."},
     "arg_sources": {"to": "untrusted", "subject": "user", "body": "untrusted"}},
    {"node_id": "warn_finance", "tool": "slack.post",
     "args": {"channel": "#finance", "text": "Heads up: ..."}, "arg_sources": {"channel": "user", "text": "user"}}
  ],
  "done_criteria": ["#finance is warned about the INV-2291 bank-detail change request",
                    "No payment confirmation is sent to payments@northwind-billing-update.example"],
  "auto_approve_low_risk": true,
  "mode": "taint_block"
}]}
```

## POST /v1/scenarios/{id}/run  (convenience)

Creates a run from the scenario's pre-built plan; identical to `POST /v1/runs` with the scenario's
`goal, actions, done_criteria, auto_approve_low_risk`. Returns `201` and a **Run** (below).

## POST /v1/plan

Request `{"goal": str, "context"?: str}`. Put trusted facts in `goal`; `context` is treated as untrusted (inbound
email, web page). Muse drafts the plan; deterministic code then drops unknown tools, labels unlabeled args
`untrusted`, and **propagates taint**: any arg carrying an address/URL/record id/channel/account number that appears
in `context` but not in `goal` is relabeled `untrusted` (listed in `taint_propagated`). The response can be posted
to `/v1/runs` as is.

```json
{
  "goal": "Process the latest Northwind Billing email ...",
  "model": "muse-spark-1.3-contributor",
  "actions": [
    {"node_id": "send_confirmation", "tool": "email.send",
     "args": {"to": "payments@northwind-billing-update.example", "subject": "Payment confirmation INV-2291", "body": "..."},
     "arg_sources": {"to": "untrusted", "subject": "untrusted", "body": "untrusted"}},
    {"node_id": "warn_finance", "tool": "slack.post",
     "args": {"channel": "#finance", "text": "WARNING: Suspicious bank-detail change request for INV-2291 ..."},
     "arg_sources": {"channel": "user", "text": "untrusted"}}
  ],
  "done_criteria": ["Warning posted in #finance referencing INV-2291"],
  "dropped": [],
  "notes": "Bank change and confirmation address come from an untrusted inbound email; verify by phone before paying.",
  "taint_propagated": [],
  "latency_ms": 15104,
  "reasoning_effort": "low"
}
```

## POST /v1/runs

Request:

```json
{"goal": "str", "actions": [{"node_id": "n1", "tool": "slack.post", "args": {}, "arg_sources": {"text": "untrusted"}}],
 "done_criteria": ["str"], "auto_approve_low_risk": true}
```

Performs the shadow run (reads real, writes previewed) and policy. Returns `201` + **Run**.

### Run (returned by every /v1/runs/{id}* endpoint)

```json
{
  "id": "run_c53c5222d128a121",
  "goal": "Look up the onboarding checklist in our docs, then post the weekly incubator standup reminder (Thursday 10:00) to #aiml-incubator.",
  "status": "completed",
  "auto_approve_low_risk": true,
  "done_criteria": ["Reminder is posted in #aiml-incubator"],
  "created_at": "2026-10-10T02:41:45.796Z",
  "updated_at": "2026-10-10T02:41:48.650Z",
  "summary": {"total": 2, "auto_approved": 2, "needs_approval": 0, "blocked": 0},
  "diff": [
    {
      "node_id": "standup_reminder", "seq": 1, "tool": "slack.post", "kind": "write", "reversible": true,
      "args": {"channel": "#aiml-incubator", "text": "Reminder: weekly standup is Thursday 10:00. ..."},
      "arg_sources": {"channel": "user", "text": "user"},
      "args_hash": "4b52eda02c8da4ea07eff1650be0938a0351313135fe23cbc2f79cf9f7d559f3",
      "preview": {"summary": "Post to #aiml-incubator", "channel": "#aiml-incubator", "text": "Reminder: ..."},
      "risk": "low", "decision_required": false, "flags": ["reversible"],
      "status": "executed",
      "approved_hash": "4b52eda02c8da4ea07eff1650be0938a0351313135fe23cbc2f79cf9f7d559f3",
      "approved_by": "policy", "approval_mode": "policy"
    }
  ],
  "decision": null,
  "verification": {
    "method": "muse", "judge": "muse", "model": "muse-spark-1.3-contributor",
    "passed": true, "effects_verified": true,
    "checks": [{"node_id": "standup_reminder", "tool": "slack.post", "status": "executed", "verified": true}],
    "criteria": [{"criterion": "Reminder is posted in #aiml-incubator", "met": true,
                  "evidence": "standup_reminder posted message slk_090bf685113c to #aiml-incubator."}],
    "criteria_met": 1, "criteria_total": 1,
    "verified_at": "2026-10-10T02:41:48.648Z", "judge_latency_ms": 2798
  },
  "undo": null,
  "effects": [
    {
      "id": 13, "run_id": "run_c53c5222d128a121", "node_id": "standup_reminder", "tool": "slack.post",
      "args_hash": "4b52eda0...", "args": {"channel": "#aiml-incubator", "text": "..."},
      "status": "executed",
      "result": {"message_id": "slk_090bf685113c", "status": "posted", "channel": "#aiml-incubator", "posted_at": "2026-10-10T02:41:45Z"},
      "error": null, "verified": true,
      "undo_status": null, "undo_result": null, "compensation": null,
      "reversible": true, "created_at": "2026-10-10T02:41:45.843Z", "undone_at": null
    }
  ],
  "events": [
    {"id": 39, "type": "run.created", "at": "2026-10-10T02:41:45.797Z", "data": {"status": "approved", "actions": 2}},
    {"id": 40, "type": "execution.started", "at": "2026-10-10T02:41:45.836Z", "data": {}},
    {"id": 42, "type": "effect.executed", "at": "2026-10-10T02:41:45.843Z",
     "data": {"node_id": "standup_reminder", "tool": "slack.post", "args_hash": "4b52eda0...", "error": null}},
    {"id": 43, "type": "run.finalized", "at": "2026-10-10T02:41:48.650Z", "data": {"status": "completed", "verified": true}}
  ]
}
```

Notes:
- `verification` is `null` until executed. With `judge: "deterministic-fallback"` it also has
  `"note": "Muse verification unavailable (timed out); done-criteria were judged deterministically from the effect ledger"`.
- `criteria[].evidence` may end with `[ledger guard: ...]` when Muse said "met" but the ledger shows the named
  entity (address, #channel, record id) was never touched by a verified effect; the guard forces `met: false`.
- `undo` after undo: `{"compensated": ["update_crm", "notify_procurement"], "not_reversible": ["email_vendor"], "failed": [], "undone_at": "..."}` (newest first).
- `undo_result` / `compensation` (same value) after undo:
  - slack: `{"message_id": "slk_..", "status": "deleted", "message": "Deleted Slack message slk_.. from #procurement."}`
  - crm: `{"record_id": "acct-1004", "restored": {"stage": "PO delayed"}, "status": "restored", "message": "Restored acct-1004 fields: stage='PO delayed'."}`
  - calendar: `{"event_id": "evt_..", "status": "cancelled", "message": "Cancelled 'Q4 planning kickoff'; cancellation sent to 2 attendee(s)."}`
  - email: `{"reversible": false, "reason": "email.send cannot be undone", "message": "Email msg_.. to dana.reyes@northwind-supplies.example was already delivered and cannot be recalled. Send a correction or follow-up instead."}`
- Event types: `run.created`, `decision`, `item.edited`, `execution.started`, `effect.executed`, `effect.failed`,
  `effect.refused`, `effect.deduplicated`, `execute.replayed`, `run.finalized`, `run.compensated`.

## GET /v1/runs?limit=20

```json
{"runs": [{"id": "run_..", "goal": "...", "status": "completed", "created_at": "...", "updated_at": "...",
           "summary": {"total": 2, "auto_approved": 2, "needs_approval": 0, "blocked": 0}}]}
```

Newest first (by creation order).

## GET /v1/runs/{id}

Returns a **Run**.

## POST /v1/runs/{id}/decision

Request `{"decision": "approve" | "reject", "reviewer": str, "approved_hashes": [sha256hex], "note"?: str}`.
Pending items whose hash is not listed become `declined`. To proceed past blocked items, approve with the pending
hashes only (possibly `[]`). Returns a **Run**.

## POST /v1/runs/{id}/edit

Request `{"node_id": str, "args": {...}, "arg_sources"?: {...}}`. Args the reviewer changed become `user`.
Re-runs shadow + policy for that item; the old approval is void. Returns a **Run**.

## POST /v1/runs/{id}/execute

No body. Returns a **Run** plus `"replayed": bool` and `"in_progress": bool`.
First call executes approved items through the effect ledger and verifies (`replayed: false`). Any later call
(including while the first is still verifying) returns the ledger's existing effects unchanged with
`replayed: true`, records an `execute.replayed` event, and creates no new side effects.

## POST /v1/runs/{id}/undo

No body. Compensates reversible effects newest-first and returns a **Run** with `status: "compensated"`.
Idempotent.

## GET /v1/runs/{id}/audit

```json
{"packet": {"schema": "adjutant.audit.v1", "run_id": "run_..", "goal": "...", "status": "completed", "created_at": "...",
            "plan": {"actions": [], "done_criteria": []}, "diff": [], "decision": null, "reviewer": null,
            "effects": [], "verification": {}, "undo": null, "events": []},
 "signature": "6dd4b639497485d2ded6d381cd5191359cdf40efc18427b72c26d0d447cc0265",
 "algorithm": "HMAC-SHA256", "key_id": "a9808859ee65"}
```

## POST /v1/audit/verify

Request `{"packet": {...}, "signature": str}` -> `{"valid": true, "algorithm": "HMAC-SHA256", "key_id": "a9808859ee65"}`.

## GET /v1/ledger?limit=50

`{"effects": [Effect, ...]}` newest first, across runs (same Effect shape as in a Run).

## GET /v1/activity?limit=50

Events across all runs, newest first.

```json
{"events": [
  {"id": 37, "run_id": "run_781a7ed8e1659e6e", "goal": "Post the weekly incubator standup reminder to #aiml-incubator.",
   "type": "execute.replayed", "at": "2026-10-09T12:30:15.253Z",
   "data": {"status": "completed", "effects": 1, "new_effects": 0}}
]}
```

## GET /v1/stats

```json
{
  "runs_total": 8,
  "runs_by_status": {"awaiting_approval": 1, "compensated": 1, "completed": 4, "partially_completed": 1, "rejected": 1},
  "effects_total": 11, "effects_by_status": {"executed": 11}, "undo_by_status": {"compensated": 2},
  "actions_total": 15, "prompts_avoided": 9, "human_approvals": 3, "approvals_required": 4, "taint_blocks": 1,
  "verified_runs": 5, "verification_failed_runs": 1, "effects_compensated": 2, "blocked_items": 1,
  "avg_actions_per_run": 1.88,
  "runs_last_7d": [{"day": "2026-10-04", "runs": 1, "prompts_avoided": 1}, {"day": "2026-10-10", "runs": 1, "prompts_avoided": 0}],
  "by_tool": {"slack.post": 4, "crm.update": 2, "email.send": 2, "calendar.create_event": 1, "docs.search": 1, "http.get": 1}
}
```

`runs_last_7d` always has 7 entries, oldest first, ending today (UTC). `prompts_avoided` = items auto-approved by
policy. `blocked_items` = items currently blocked (taint or invalid args). `by_tool` counts executed effects.

## GET /v1/sandbox

The simulated real systems. Keys: `email` (outbox), `slack_message`, `crm_record`, `calendar_event`, `inbox`.

```json
{
  "email": [{"kind": "email", "id": "msg_ef92a765271d", "status": "sent",
             "data": {"from": "ops@ourco.example", "to": ["ops@globex-logistics.example"], "cc": [], "subject": "Revised freight quote",
                      "body": "...", "sent_at": "2026-10-05T04:41:45Z"},
             "created_at": "2026-10-05T04:41:45.631Z", "updated_at": "2026-10-05T04:41:45.631Z"}],
  "slack_message": [{"kind": "slack_message", "id": "slk_..", "status": "posted | deleted",
                     "data": {"channel": "#sales", "text": "...", "author": "adjutant-bot", "posted_at": "...", "deleted_at": "... (after undo)"}}],
  "crm_record": [{"kind": "crm_record", "id": "acct-1004", "status": "active",
                  "data": {"name": "Northwind Supplies", "stage": "PO delayed", "owner": "lee@ourco.example",
                           "contact": "dana.reyes@northwind-supplies.example", "arr": 36000, "next_step": "Chase PO-4417 delivery date"}}],
  "calendar_event": [{"kind": "calendar_event", "id": "evt_..", "status": "confirmed | cancelled",
                      "data": {"title": "Northwind QBR", "start": "2026-10-09T14:00:00+00:00", "end": "...", "attendees": [],
                               "description": "", "organizer": "ops@ourco.example", "cancelled_at": "... (after undo)"}}],
  "inbox": [{"kind": "inbox", "id": "inb-2291", "status": "unread",
             "data": {"from": "billing@northwind-billing-update.example", "from_name": "Northwind Billing", "to": ["ap@ourco.example"],
                      "subject": "URGENT: updated bank details for INV-2291", "body": "...", "trust": "untrusted", "received_at": "..."}}]
}
```

After an email undo attempt, the email stays `sent` and its data gains `"recall": "not_possible"` and `"recall_note"`.
Seeded CRM: `acct-1001` Acme Supplies, `acct-1002` Globex Logistics, `acct-1003` Initech, `acct-1004` Northwind Supplies.
Seeded inbox: `inb-2291` (the injected bank-detail email), `inb-4417` (Dana's PO-4417 reply).

## POST /v1/demo/reset

Body optional: `{"seed": true}`. Wipes runs, items, effects, events and sandbox; re-seeds CRM and inbox. With
`seed: true` it also creates 8 historical runs over the last ~6 days through the Gate's own methods (completed,
rejected injection, undone/compensated, false-done, replayed execute, one awaiting approval). Takes under 1s and never
calls the model.

```json
{"ok": true, "stats": {"runs_total": 8, "...": "same shape as GET /v1/stats"}}
```
