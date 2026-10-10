# Adjutant Gate: pitch kit

Facts used here are sourced in docs/RESEARCH.md. Numbers marked (unverified) there should not be stated as fact on stage.

## A. 60-second pitch (about 150 words)

Agents can now decide to act. What breaks is everything between the decision and the real system. In April, a coding agent deleted a company's production database and its backups in nine seconds. Anthropic says its users approve 93 percent of permission prompts, so those prompts are not really a check. An email can tell an agent where to send money. And agents say "done" when nothing was done.

Adjutant Gate is a proxy between any agent and its tools. It runs the task first as a shadow run: reads are real, writes are previewed. You review one plan for the whole task, not one prompt per call. A deterministic policy decides what runs on its own, what needs a person, and what is blocked. Untrusted content can fill an email body but never choose the recipient. Every effect goes in a ledger, so it runs exactly once and can be undone. Then we check "done" against the real systems.

Today we will show all of that live.

## B. 3-minute pitch

Agents can now decide to act. That part works. The part that does not work is everything between the decision and the action landing in a real system.

Look at what has happened in the last year. In July 2025 a Replit agent deleted a production database during a code freeze. In April this year a coding agent hit a credential mismatch, found a way to delete a storage volume, and took out a production database and its backups in nine seconds. The most recent usable backup was three months old.

The usual answer is "ask the human first". But Anthropic's own engineering post says its users approve 93 percent of Claude Code permission prompts. When every third click is a yes, the prompt is a speed bump, not a control. And the second usual answer, a gateway that allows or denies a tool, cannot tell a good email from a bad one. It only knows that the email tool is allowed.

So we built Adjutant Gate. It is a drop-in proxy between any agent, whether that is Claude Code, Cursor, an OpenAI agent, n8n or your own code, and its tools: Gmail, Slack, a CRM, Postgres, any MCP server.

It does five things.

One, a shadow run. The agent's plan executes against real reads and simulated writes, so the reviewer sees what would happen before anything does.

Two, a plan diff. Instead of three prompts for an email, a Slack post and a CRM update, there is one batched review for the whole task. Low-risk plans, like an internal update, skip review entirely.

Three, a calibrated gate. A deterministic policy returns AUTO, ASK or BLOCK. It tracks taint per argument. Text from an inbound email may fill a message body. It may never pick a recipient, a channel or a target id. That is the exact hole that injection attacks use, such as the Supabase MCP ticket attack and the EchoLeak email attack on Copilot.

Four, an effect ledger. Every side effect is keyed on run, node and a hash of its arguments. Run it twice and the second call is replayed from the ledger, so no duplicate email. If something must be rolled back, compensation runs newest first. Approval is bound to the args hash, so what you approved is what ships.

Five, proof of done. The task carries done criteria, and we check them against real outputs. If the CRM record is missing, the answer is "not met", not "done".

Every run produces a signed audit packet: the plan, the diff, the decision, the reviewer and the effects. It supports the logging and human oversight evidence that ISO-style and EU AI Act programs ask for. The EU dates moved to December 2027 and August 2028, but the need for logs and oversight did not.

A word on models. We use one model, Meta Muse Spark 1.3 Contributor, for two judgment jobs: planning, and judging done criteria. Everything that must be right every time, which is policy, taint, hashing and the ledger, is plain code.

The point: the model proposes, the code decides, and the ledger remembers. That is what lets a team give an agent real tools without crossing their fingers.

## C. What the judges will see: demo script (about 4 minutes)

Open the console at https://adjutant.spacesdrive.cc. Header shows live API and web commit SHAs. Say one sentence per scenario, then act.

1. **Vendor follow-up (one approval instead of three).**
   Run the vendor follow-up task. Show the shadow run and the plan diff: email, Slack post, CRM update on one screen. Approve once. Point at the count: one review, three effects.
   Line: "Three prompts would have been three clicks nobody reads. This is one review that shows everything."

2. **Injected recipient (taint blocks the target).**
   Run the scenario where an inbound email says to send the payment to a different address. Show the recipient argument marked as tainted and the gate returning BLOCK for it. Show that the warning to the owner still ships.
   Line: "The email can write the message. It cannot choose who gets it."

3. **Internal update (zero prompts).**
   Run the internal update. The gate returns AUTO. No review, effects land.
   Line: "Safe work should not interrupt anyone. That is how you keep reviews meaningful."

4. **False done (verification says NOT met).**
   Run the scenario where the CRM record is missing. Show the done-criteria check against the real output returning NOT met.
   Line: "Done means verified, not claimed."

5. **Exactly-once, undo, audit.**
   Execute the vendor run a second time. Show the second execution replayed from the ledger, with no duplicate email. Open the effect ledger. Press undo and show compensation newest first. Open the audit packet, then call the tamper check (`POST /v1/audit/verify`) on the intact packet (valid), edit one field, and run it again (fails).
   Line: "Replay is safe, undo is ordered, and the evidence is signed."

Fallbacks: if the Muse key or network fails, say so, and use the already-created runs in the Runs tab. Policy, taint and ledger behavior do not depend on the model.

## D. Likely judge questions

1. **Model vendors will build this. Why you?**
   They will build it for their own harness. Anthropic already ships auto mode inside Claude Code. A team using Claude Code, Cursor, n8n and a custom agent needs one policy and one ledger across all of them, and a vendor has no reason to police a competitor's agent. We also sit on the side effect, which is the one place every framework passes through.

2. **MCP gateways can add approvals. What is different?**
   Most gateways allow or deny per tool. An approval feature on top is still one prompt per call. Gate adds what a gateway lacks: a shadow run, one batched plan diff, per-argument taint, a ledger for exactly-once and undo, and a done check. A gateway could build these, and if so that validates the layer; we think the ledger and the verification are the hard part.

3. **Why only Muse Spark 1.3 Contributor, and how is it used?**
   It was the model we were given for this project, so we built to that constraint and made it a feature: one model, two narrow jobs. It turns the task into a plan with tool calls and done criteria, and it judges whether done criteria are met from real outputs. It never sets policy and never sees secrets it does not need.

4. **What is deterministic and what is model-judged?**
   Deterministic: policy (AUTO, ASK, BLOCK), taint tracking, args hashing, the ledger, replay, compensation order, audit signing. Model-judged: the plan, and the done-criteria judgment. If the model is wrong about a plan, the policy still gates each step. If it is wrong about done, the criteria are checked against real outputs, and a failed check blocks the claim.

5. **What happens if it crashes mid-run?**
   The ledger is written per effect, keyed on run, node and args hash. On restart, effects already recorded are replayed rather than re-sent, and the run resumes at the first unrecorded node. The gap to know about: if a crash lands after an external system accepted a call but before we recorded it, we depend on that system's idempotency key. We pass one where the API supports it, and flag it where it does not.

6. **What cannot be undone?**
   A sent email cannot be unsent. Gate reduces the risk before sending (shadow run, review, taint) and records it, but it cannot recall it. Undo works where a compensating action exists: delete the Slack message, reverse the CRM update, restore the row. Tools without an inverse are marked non-reversible, and the policy treats them as ASK by default.

7. **How does it integrate?**
   Two ways. As an MCP proxy: point the agent's MCP config at Gate, and Gate forwards to the real servers. Or a few lines of SDK for custom agents: wrap the tool call so it goes through the gate. No change to the agent's prompts or framework.

8. **What is the business model?**
   Open source core, free. Team at $99 a month per workspace, Agency at $299 a month, Enterprise on custom terms for audit, SSO and private deployment. A gate check costs about $0.00005 in our estimate, so the unit economics do not depend on seat counts.

9. **What is real and what is simulated in this demo?**
   Real: the API and console, the gate, the policy, taint, ledger, replay, undo, signed audit packets, and Muse planning and done judgment. Simulated: the downstream tools. Gmail, Slack and the CRM are sandbox adapters, so nothing leaves the demo environment. The adapters follow the same interface a real connector would.

10. **Does a human reviewer not just rubber-stamp the batched diff?**
    They can. The difference is that fewer reviews exist, the diff shows the actual arguments, approval is bound to the args hash so a changed argument goes back through the gate, and the risky parts are blocked by code regardless of the click. We do not claim to fix attention; we stop depending on it for the cases that matter.

11. **How is this different from observability and evals tools?**
    Those tell you what happened after it happened. Gate acts before the call, and its ledger and audit packet are about control, not analytics. They are complementary: send Gate's events into your tracing tool.

12. **What is next in 90 days?**
    Real connectors for Gmail, Slack and one CRM with idempotency keys; the MCP 2026-07-28 revision (stateless servers, multi round-trip elicitation, Tasks extension) tested end to end; a policy editor and per-tool reversibility metadata; a pilot with two or three teams; and mapping audit packets to AIUC-1 and AI Act Art. 12 and 14 evidence with a reviewer.

## E. Honest limitations

Gate is a hackathon build. The downstream tools in the demo are sandbox adapters, not live Gmail, Slack or CRM accounts, so exactly-once under real network failure is designed but not proven against real services. Some actions cannot be undone, and we mark them rather than pretend. Taint covers the arguments we know how to classify, so a new tool needs its argument types declared, and a mislabeled argument weakens the check. The planner and the done judge are one model and can be wrong; policy and the done check limit the damage but do not make the model right. Our market and incident figures come from public sources of mixed quality, listed in docs/RESEARCH.md, and a few strategy-document numbers are still unverified. We have no customers yet, and no independent security audit.
