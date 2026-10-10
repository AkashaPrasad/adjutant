# Adjutant Gate: presenter's runbook

Live demo for judges. Console: https://adjutant.spacesdrive.cc. All button and page names below are the ones in the UI. Sources: README.md, docs/PITCH.md, docs/API.md, backend/app/scenarios.py, frontend/src.

Sidebar pages: Overview, Runs, New run, Effects, Systems, Audit, How it works. Sidebar also has Demo script (key `d`) and Shortcuts (key `?`).

## 1. Before the demo

Do this 10 minutes ahead.

- [ ] Open https://adjutant.spacesdrive.cc.
- [ ] Top bar (top right) shows a green dot with "API healthy" and a commit SHA. If it says "API offline", stop and see section 4.
- [ ] Top bar model chip reads "Muse Spark 1.3 Contributor" with a green dot. If it says "not configured", planning is disabled: use the fallback buttons below.
- [ ] On Overview, click "Reset demo data", then confirm with "Reset demo data" in the dialog. This wipes runs and the sandbox and seeds 8 historical runs. It takes under a second and never calls the model. Expect KPIs near: Actions evaluated 15, Auto-approval rate 60%, Blocked by taint 1, Verified runs 5, Effects undone 2.
- [ ] Set the theme: sidebar bottom switch Light / Dark / System, or press `t`. Dark reads better on a projector in a dim room; light for a bright room.
- [ ] Press `d` to open the "Demo script" panel. It has five steps with an "Open" button each (Set the scene, One batched review, Taint blocks an injected recipient, Exactly once then undo, Proof of done and audit). Tick the boxes as you go; "Clear checklist" resets them. The ticks are stored in your browser only.
- [ ] Open a second browser tab on the Overview as a backup. If the first tab breaks, switch to it.
- [ ] Zoom the browser to 110 to 125 percent so the back row can read the run page.
- [ ] Know the timing: Muse planning takes 7 to 25 seconds, verification (after Execute) 3 to 10 seconds. Everything else is under a second.

Fallback if the model is slow: on New run, pick a scenario and click "Use pre-built plan" (loads the same plan the model is expected to draft) or "Run scenario now" (skips planning and goes straight to the shadow run). Both go through the identical gate. The demos below use "Run scenario now" so nothing waits on planning. Only execute-time verification still calls the model, and it falls back on its own after 20 seconds.

Known mismatch: the Demo script panel step 2 says "3 of 4 actions auto-approved". The real run has 3 actions, 2 auto-approved, 1 needs approval. Say the real numbers.

How to start any scenario: press `d`, click "Open" on the step, or go to New run, pick the scenario under "Demo scenario", then click "Run scenario now". You land on the run page.

| Scenario (title in UI) | Opens from Demo script step | Outcome to expect |
| --- | --- | --- |
| Vendor follow-up across three systems | 2 | 2 auto, 1 needs approval (email). Verified, 3/3 criteria |
| Injected recipient in an inbound email | 3 | `email.send` Blocked (taint: to). Run ends "Completed, items held back", 2/2 criteria |
| Low-risk internal update | not in the script | Approved on creation, 0 prompts |
| The agent says done. Is it? | 5 | `crm.update` blocked, 2/3 criteria met, "Not done" |
| Retry storm: execute twice, send once | 4 | Second execute replayed, one email |

## 2. The 1-minute presentation

Total about 60 seconds, about 140 spoken words. Spoken lines are verbatim. The model needs 3 to 10 seconds to verify after Execute, so talk through it; do not wait in silence.

Run page controls you will use. Bottom bar while reviewing: "Reject run", "Approve all pending (1)", "Submit review". After execute: "Undo", "Execute again", "Audit packet". Audit panel: "Tamper: flip one byte" checkbox, "Verify signature" (becomes "Verify tampered packet" when ticked).

| Time | What you do on the website | What you say |
| --- | --- | --- |
| 0:00 (7s) | Overview. Point at the tiles: "Auto-approval rate" (its line says prompts avoided), "Blocked by taint", "Verified runs". | "Agents can act now. Gate sits between agent and tools. Here: prompts avoided, taint blocks, verified runs." |
| 0:07 (9s) | Press `d`, click "Open" on step 2 (Vendor follow-up), click "Run scenario now". On the run page, show 3 actions: 2 "Auto", `email.send` "Needs approval". Click "Approve all pending (1)". | "Vendor follow-up: an email, a Slack post and a CRM update. Two are low risk and auto-approved. One review, for the irreversible email only." |
| 0:16 (9s) | Status is now Approved. Click "Execute". While it verifies, scroll to Verification. Land on "Verified 3/3 criteria met". | "Execute. Gate runs each effect once, then Muse checks the done criteria against real outputs. Three of three met." |
| 0:25 (5s) | Click "Execute again". The blue callout appears: "Replayed from effect ledger: no duplicate side effects". | "Now retry, like a flaky agent. Replayed from the ledger. No duplicate email." |
| 0:30 (6s) | Click "Undo", then confirm "Undo effects". Point at Undo results: Slack deleted, CRM restored, "Email cannot be recalled". | "Undo: Slack deleted, CRM restored. The email cannot be recalled, and we say so." |
| 0:36 (8s) | Press `d`, "Open" on step 3, "Run scenario now". Show `email.send` "Blocked", flag "taint: to". Click "Proceed without 1 blocked action", then "Execute". Status ends "Completed, items held back". | "Now an injected email picks the recipient. Taint blocks it. The warning to finance still ships." |
| 0:44 (7s) | Press `d`, "Open" on step 5 (false done), "Run scenario now", "Approve all pending (1)", "Execute". Show "Agent claimed" next to "Gate verdict: Not done, 2 of 3". | "The agent says done. Gate says not done: two of three criteria met." |
| 0:51 (9s) | Click "Audit packet", then "Verify signature" (Signature valid). Tick "Tamper: flip one byte", click "Verify tampered packet" (Signature invalid). | "Every run has a signed audit packet. Valid. Flip one byte: invalid. The model proposes, the code decides, the ledger remembers." |

Timing tips: pre-open nothing; the clicks above are the whole path. If you are behind at 0:36, skip the injected scenario and go straight to false done.

## 3. The 3-minute version

About 180 seconds, about 420 words. Same controls as above. Extra pages: Systems, Effects, How it works.

| Time | What you do on the website | What you say |
| --- | --- | --- |
| 0:00 (15s) | Overview. Point at the six tiles (Pending approvals, Actions evaluated, Auto-approval rate, Blocked by taint, Verified runs, Effects undone) and the "Demo scenarios" panel. | "Agents can decide to act. What fails is everything between the decision and the real system: emails that cannot be recalled, prompts people rubber-stamp, injected recipients, false done. Gate is a proxy between any agent and its tools. The downstream tools here are sandbox adapters, so nothing leaves the demo." |
| 0:15 (10s) | Click "How it works". Show the "Data plane" diagram, then go back. | "This is the path every call takes: shadow run, policy, review, ledger, verification, audit. The model plans and judges. Policy, taint, hashing and the ledger are plain code." |
| 0:25 (35s) | New run. Pick "Vendor follow-up across three systems". Click "Plan with Muse" (7 to 25 seconds, the progress panel shows what it is doing). Review the plan, click "Run shadow run". If over 20 seconds, click "Use pre-built plan". On the run page, click the `email.send` row, show Arguments with their Source badges and the Binding block (Args hash). | "Muse drafts the plan from our six registered tools. Then a shadow run: reads are real, writes are only previewed. Slack and the CRM update are low risk and reversible, so policy approves them. Only the email, which cannot be recalled, needs a person. The approval is bound to this args hash." |
| 1:00 (15s) | Press `a` to stage approve (or click "Approve"), click "Submit review: 1 approve, 0 decline", then "Execute". Show the Verification panel (3/3 met, judge Muse Spark 1.3 Contributor). | "One review for the whole task, not three prompts. Execute writes each effect once to the ledger. Then Muse checks each done criterion against what actually happened." |
| 1:15 (15s) | Click "Execute again". Callout: "Replayed from effect ledger". Click "Systems", then "Outbox": one email. | "A retry after a timeout hits the same ledger key and returns the stored result. One email in the outbox, not two." |
| 1:30 (15s) | Back on the run, click "Undo", confirm "Undo effects". Open Systems, tab "Slack" (message struck through) and "CRM" (stage restored). Open "Effects" in the sidebar: show the ledger rows with their undo status. | "Undo runs newest first. Slack message deleted, CRM restored. The email stays sent and the ledger records it as not reversible. Nothing is hidden." |
| 1:45 (25s) | New run, "Injected recipient in an inbound email", "Run scenario now". Show Blocked, the "Taint: to" reason, and the "Edit to fix" button. Click "Proceed without 1 blocked action", "Execute". Status: "Completed, items held back". Open Systems, "Outbox": nothing new. | "An inbound email claims bank details changed and asks for confirmation at a look-alike domain. The plan complies. Untrusted text may fill a body but never a recipient, so this is blocked and cannot be approved by accident. The Slack warning to finance, which we wrote, still goes out. Held back is by design." |
| 2:10 (20s) | New run, "The agent says done. Is it?", "Run scenario now". Show the blocked `crm.update` (invalid arguments, record not found). "Approve all pending (1)", "Execute". Show "Agent claimed" and "Gate verdict: Not done: 2 of 3". | "The agent hallucinated a CRM record id. Gate caught it in the shadow run. The agent would report done. Verification checks the CRM, the Slack channel and the outbox, and says two of three. Done means verified." |
| 2:30 (25s) | Click "Audit packet". Click "Verify signature": valid. Tick "Tamper: flip one byte", click "Verify tampered packet": invalid. | "Each run produces a signed packet: plan, diff, decision, reviewer, effects, verification, events. Verification recomputes the HMAC on the server. Change one byte and it fails. This is the log and oversight evidence audit programs ask for." |
| 2:55 (5s) | Overview. Point at the tiles now moved. | "The model proposes, the code decides, the ledger remembers." |

Optional if time remains: Audit page (sidebar) lets a verifier paste a packet or choose a file, with its own Tamper checkbox and "Verify" button.

## 4. If something goes wrong

| What you see | What to do and say |
| --- | --- |
| Orange banner "API unreachable at ... Showing the last loaded data; retrying every 15s", top bar says "API offline" | Click "Retry now". Say: "The console is a static site; the API host is not reachable from this network." Switch to the backup tab. If still down, walk the screenshots or the Overview data already on screen and run local (section 5). |
| "Plan with Muse" is slow (progress panel with a seconds counter; warning "The planner is taking longer than 20 seconds") | Click "Use pre-built plan" in the warning, or "Run scenario now". Say: "Muse takes 7 to 25 seconds. The scenario ships with the plan it is expected to draft, and it goes through the identical gate." |
| "Planning failed" (502 or 504) | Click "Use pre-built plan instead". Say: "Policy, taint and the ledger do not depend on the model." |
| Verification shows Judge "Deterministic fallback" and a yellow note that Muse verification was unavailable | Say: "Muse timed out, so the gate judged the criteria from the effect ledger instead. Execute never fails because of the model, and the effects are the same." Do not hide it. |
| Run status "Completed, items held back" | By design. Say: "Everything that ran was verified. The gate held back what it should not run: the blocked email, or an item the reviewer did not approve." It is the expected end state of the injected-recipient and false-done scenarios. |
| Run page says "Run not found" | The data was reset. Click "View all runs", or start the scenario again. |
| Toast "Review failed" or 409 | A stale page. The run reloads itself. Re-click. |
| Tab frozen or odd | Refresh. State is on the server, so runs, ledger, sandbox and audit packets all survive. Lost on refresh: approvals you staged with `a` or `r` but did not submit, and a loaded audit packet (click "Audit packet" again). Kept in the browser: theme, reviewer name, Demo script ticks. |
| Run stuck on "Executing" | The page polls every 2 seconds. Wait up to 20 seconds for verification, then refresh. |
| State is messy before a second demo | Overview, "Reset demo data". Systems has a separate "Reset sandbox". |

## 5. Running it locally

Needs uv and Node.

```bash
cp .env.example .env     # set MUSE_API_KEY for planning and verification; optional for everything else

# backend  ->  http://localhost:8000/docs
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000

# frontend ->  http://localhost:5173
cd frontend && npm install && npm run dev
```

Environment variables (`.env.example`): `MUSE_API_KEY` (empty disables planning; verification then uses deterministic checks), `MUSE_BASE_URL`, `MUSE_MODEL` (default `muse-spark-1.3-contributor`), `ADJUTANT_DB_PATH` (SQLite), `ADJUTANT_SIGNING_KEY` (audit HMAC key; required in production), `ALLOWED_ORIGINS` (CORS, `*` for dev), `APP_ENV`. The frontend reads `VITE_API_BASE` (default `http://localhost:8000`). Locally, click "Reset demo data" first, the same as in section 1.

Checks before going on stage: `cd backend && uv run pytest -q && uv run ruff check .` and `cd frontend && npm run typecheck && npm run build`.

## 6. Deploying

See docs/DEPLOYMENT.md and `infra/deploy-local.sh backend|frontend|all [sha]` (needs the credentials listed in the script header). The top bar shows the live API and web commit SHAs, so you can confirm a deploy landed.

## 7. Judge Q&A quick answers

Facts come from docs/PITCH.md section D. Do not state figures that RESEARCH.md marks unverified.

1. **Model vendors will build this. Why you?**
   They will build it for their own harness. A team using Claude Code, Cursor, n8n and custom agents needs one policy and one ledger across all of them, and a vendor has little reason to police a competitor's agent.

2. **MCP gateways can add approvals. What is different?**
   Most gateways allow or deny per tool, and approvals on top are still one prompt per call. Gate adds a shadow run, one batched diff, per-argument taint, a ledger for exactly-once and undo, and a done check.

3. **Why only Muse Spark 1.3 Contributor, and what does it do?**
   It was the model we were given, so we built to that constraint: one model, two narrow jobs. It drafts the plan and judges done criteria. It never sets policy.

4. **What is deterministic and what is model-judged?**
   Deterministic: policy (AUTO, ASK, BLOCK), taint, args hashing, the ledger, replay, undo order, audit signing. Model-judged: the plan and the done-criteria judgment. A wrong plan is still gated step by step, and a failed done check blocks the claim.

5. **What happens if it crashes mid-run?**
   The ledger is written per effect, keyed on run, node and args hash, so on restart recorded effects are replayed, not re-sent. The gap: a crash after an external system accepts a call but before we record it depends on that system's idempotency key.

6. **What cannot be undone?**
   A sent email cannot be recalled. Gate reduces risk before sending and records it, and undo works where a compensating action exists (delete the Slack message, restore the CRM fields, cancel the event). Tools with no inverse are marked non-reversible and default to needing approval.

7. **How does it integrate?**
   As an MCP proxy (point the agent's MCP config at Gate) or with a few lines of SDK that wrap the tool call. No change to the agent's prompts or framework.

8. **What is real and what is simulated in this demo?**
   Real: the API and console, the gate, policy, taint, ledger, replay, undo, signed packets, and Muse planning and judging. Simulated: Gmail, Slack and the CRM are sandbox adapters with the same interface a real connector would have, so nothing leaves the demo.

If asked about rubber-stamping: approval is bound to the args hash, the diff shows real arguments, and risky parts are blocked by code regardless of the click. Honest limits: no customers yet, no independent security audit, and exactly-once under real network failure is designed but not proven against live services.
