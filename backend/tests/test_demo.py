"""Demo-support endpoints and the five judge-facing scenarios (no network: the LLM is faked or absent)."""

import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.llm import LLMError, MuseClient, hedged
from app.main import create_app
from app.planner import propagate_taint

from .conftest import FakeLLM, item

SCENARIO_KEYS = {
    "id",
    "title",
    "tagline",
    "description",
    "pain_point",
    "expected_outcome",
    "goal",
    "context",
    "actions",
    "done_criteria",
    "auto_approve_low_risk",
    "mode",
}


def scenario(client, sid):
    return next(s for s in client.get("/v1/scenarios").json()["scenarios"] if s["id"] == sid)


def start(client, sid):
    s = scenario(client, sid)
    resp = client.post(
        "/v1/runs",
        json={k: s[k] for k in ("goal", "actions", "done_criteria", "auto_approve_low_risk")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def approve_pending(client, run):
    hashes = [i["args_hash"] for i in run["diff"] if i["status"] == "pending_approval"]
    resp = client.post(
        f"/v1/runs/{run['id']}/decision",
        json={"decision": "approve", "reviewer": "judge", "approved_hashes": hashes},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---- catalog --------------------------------------------------------------------------------------
def test_scenarios_catalog_shape(client):
    scenarios = client.get("/v1/scenarios").json()["scenarios"]
    ids = [s["id"] for s in scenarios]
    assert ids[:5] == ["vendor-followup", "injected-recipient", "internal-update", "false-done", "exactly-once"]
    modes = {s["id"]: s["mode"] for s in scenarios}
    assert modes["injected-recipient"] == "taint_block" and modes["exactly-once"] == "exactly_once"
    for s in scenarios:
        assert s.keys() >= SCENARIO_KEYS, s["id"]
        assert isinstance(s["context"], str)
        for a in s["actions"]:
            assert {"node_id", "tool", "args", "arg_sources"} <= a.keys()
    assert "payments@northwind-billing-update.example" in scenario(client, "injected-recipient")["context"]


def test_every_scenario_creates_a_run(client):
    for s in client.get("/v1/scenarios").json()["scenarios"]:
        resp = client.post(f"/v1/scenarios/{s['id']}/run")
        assert resp.status_code == 201, (s["id"], resp.text)
    assert client.post("/v1/scenarios/nope/run").status_code == 404


# ---- the five scenarios ---------------------------------------------------------------------------
def test_vendor_followup_one_batched_review(client):
    run = start(client, "vendor-followup")
    assert run["status"] == "awaiting_approval"
    assert run["summary"] == {"total": 3, "auto_approved": 2, "needs_approval": 1, "blocked": 0}
    run = approve_pending(client, run)
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert done["status"] == "completed"
    assert done["verification"]["passed"] is True
    assert done["verification"]["criteria_met"] == 3

    undone = client.post(f"/v1/runs/{run['id']}/undo").json()
    by_node = {e["node_id"]: e for e in undone["effects"]}
    assert by_node["email_vendor"]["undo_status"] == "not_reversible"
    assert "cannot be recalled" in by_node["email_vendor"]["undo_result"]["message"]
    assert by_node["email_vendor"]["compensation"] == by_node["email_vendor"]["undo_result"]
    assert by_node["notify_procurement"]["undo_status"] == "compensated"
    sb = client.get("/v1/sandbox").json()
    assert sb["slack_message"][0]["status"] == "deleted"
    assert sb["email"][0]["data"]["recall"] == "not_possible"
    crm = next(o for o in sb["crm_record"] if o["id"] == "acct-1004")
    assert crm["data"]["stage"] == "PO delayed"


def test_injected_recipient_is_blocked_by_taint(client):
    run = start(client, "injected-recipient")
    assert run["status"] == "blocked"
    confirm = item(run, "confirm_payment")
    assert confirm["status"] == "blocked" and "taint:to" in confirm["flags"] and confirm["risk"] == "high"
    assert item(run, "warn_finance")["status"] == "auto_approved"
    blocked = client.post(
        f"/v1/runs/{run['id']}/decision",
        json={"decision": "approve", "reviewer": "judge", "approved_hashes": [confirm["args_hash"]]},
    )
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "item_blocked"

    run = approve_pending(client, run)  # approve the rest: nothing pending, the blocked item stays blocked
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert [e["node_id"] for e in done["effects"]] == ["warn_finance"]
    assert done["verification"]["passed"] is True, done["verification"]
    sb = client.get("/v1/sandbox").json()
    assert sb["email"] == [], "no email ever left the outbox"
    assert sb["slack_message"][0]["data"]["channel"] == "#finance"
    assert any(o["id"] == "inb-2291" for o in sb["inbox"])


def test_internal_update_needs_zero_prompts(client):
    run = start(client, "internal-update")
    assert run["status"] == "approved"
    assert run["summary"]["needs_approval"] == 0
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert done["status"] == "completed"
    assert client.get("/v1/stats").json()["prompts_avoided"] == 2


def test_false_done_is_caught_deterministically(client):
    run = start(client, "false-done")
    assert item(run, "update_crm")["status"] == "blocked"
    assert item(run, "update_crm")["flags"] == ["invalid_args"]
    run = approve_pending(client, run)
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    v = done["verification"]
    assert done["status"] == "partially_completed"
    assert v["judge"] == "deterministic"
    assert v["passed"] is False
    assert [c["met"] for c in v["criteria"]] == [False, True, True]
    assert "acct-1003" in v["criteria"][0]["evidence"]
    assert (v["criteria_met"], v["criteria_total"]) == (2, 3)
    assert client.get("/v1/stats").json()["verification_failed_runs"] == 1


def test_false_done_ledger_guard_overrides_an_optimistic_model(client, app):
    def responder(messages, name):
        return {"criteria": [{"criterion": "x", "met": True, "evidence": "looks done"}] * 3}

    app.state.llm = FakeLLM(responder)
    run = approve_pending(client, start(client, "false-done"))
    v = client.post(f"/v1/runs/{run['id']}/execute").json()["verification"]
    assert v["judge"] == "muse"
    assert [c["met"] for c in v["criteria"]] == [False, True, True]
    assert "ledger guard" in v["criteria"][0]["evidence"]
    assert v["passed"] is False


def test_exactly_once_second_execute_replays(client):
    run = approve_pending(client, start(client, "exactly-once"))
    first = client.post(f"/v1/runs/{run['id']}/execute").json()
    second = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert (first["replayed"], second["replayed"]) == (False, True)
    assert second["in_progress"] is False
    strip = [(e["id"], e["args_hash"], e["result"]) for e in first["effects"]]
    assert strip == [(e["id"], e["args_hash"], e["result"]) for e in second["effects"]]
    assert len(strip) == 2
    sb = client.get("/v1/sandbox").json()
    assert len(sb["email"]) == 1 and len(sb["calendar_event"]) == 1
    assert len(client.get("/v1/ledger").json()["effects"]) == 2
    types = [e["type"] for e in second["events"]]
    assert types.count("execute.replayed") == 1
    replay = next(e for e in second["events"] if e["type"] == "execute.replayed")
    assert replay["data"]["new_effects"] == 0

    undone = client.post(f"/v1/runs/{run['id']}/undo").json()
    assert undone["undo"] == {**undone["undo"], "compensated": ["invite"], "not_reversible": ["email_agenda"]}
    assert client.get("/v1/sandbox").json()["calendar_event"][0]["status"] == "cancelled"


# ---- verifier fallback ----------------------------------------------------------------------------
class BrokenLLM(FakeLLM):
    def __init__(self, exc: Exception) -> None:
        super().__init__(lambda m, n: None)
        self.exc = exc

    async def complete_json(self, messages, *, schema, name, effort="low", max_completion_tokens=4000):
        self.calls.append(name)
        raise self.exc


class SlowLLM(FakeLLM):
    async def complete_json(self, messages, *, schema, name, effort="low", max_completion_tokens=4000):
        self.calls.append(name)
        await asyncio.sleep(5)
        return {}


@pytest.mark.parametrize("exc", [LLMError("HTTP 500"), RuntimeError("boom"), KeyError("criteria")])
def test_verifier_falls_back_when_muse_fails(client, app, exc):
    app.state.llm = BrokenLLM(exc)
    run = approve_pending(client, start(client, "vendor-followup"))
    done = client.post(f"/v1/runs/{run['id']}/execute")
    assert done.status_code == 200
    v = done.json()["verification"]
    assert done.json()["status"] == "completed"
    assert v["judge"] == "deterministic-fallback" and v["method"] == "deterministic"
    assert "Muse verification unavailable" in v["note"]
    assert v["passed"] is True


def test_verifier_falls_back_on_timeout(tmp_path):
    settings = Settings(db_path=str(tmp_path / "a.db"), verify_budget_s=0.2, verify_hedge_s=0)
    from fastapi.testclient import TestClient

    app = create_app(settings)
    with TestClient(app) as client:
        app.state.llm = SlowLLM(lambda m, n: None)
        run = client.post("/v1/scenarios/internal-update/run").json()
        v = client.post(f"/v1/runs/{run['id']}/execute").json()["verification"]
        assert v["judge"] == "deterministic-fallback"
        assert "timed out" in v["note"]

        app.state.llm = SlowLLM(lambda m, n: None)
        settings2 = Settings(db_path=str(tmp_path / "a.db"), plan_budget_s=0.2, plan_hedge_s=0)
        app.state.settings = settings2
        resp = client.post("/v1/plan", json={"goal": "x"})
        assert resp.status_code == 504 and resp.json()["error"]["code"] == "llm_timeout"


# ---- reset, activity, stats, run shape ------------------------------------------------------------
def test_demo_reset_with_and_without_seed(client):
    client.post("/v1/scenarios/internal-update/run")
    body = client.post("/v1/demo/reset", json={"seed": True}).json()
    assert body["ok"] is True
    stats = body["stats"]
    assert 6 <= stats["runs_total"] <= 8
    assert stats["runs_by_status"].get("compensated") == 1
    assert stats["runs_by_status"].get("rejected") == 1
    assert stats["runs_by_status"].get("awaiting_approval") == 1
    assert stats["effects_compensated"] >= 1 and stats["verified_runs"] >= 3
    assert sum(d["runs"] for d in stats["runs_last_7d"]) == stats["runs_total"]
    runs = client.get("/v1/runs?limit=50").json()["runs"]
    days = {r["created_at"][:10] for r in runs}
    assert len(days) >= 4, "history is spread over several days"
    assert runs == sorted(runs, key=lambda r: r["created_at"], reverse=True)
    sb = client.get("/v1/sandbox").json()
    assert {"email", "slack_message", "crm_record", "calendar_event", "inbox"} <= sb.keys()

    empty = client.post("/v1/demo/reset").json()["stats"]
    assert empty["runs_total"] == 0 and empty["effects_total"] == 0
    assert client.get("/v1/activity").json()["events"] == []
    sb = client.get("/v1/sandbox").json()
    assert sb["email"] == [] and len(sb["crm_record"]) == 4 and len(sb["inbox"]) == 2
    assert client.post("/v1/demo/reset", json={"seed": False}).status_code == 200


def test_activity_and_stats_and_run_events(client):
    run = client.post("/v1/scenarios/internal-update/run").json()
    client.post(f"/v1/runs/{run['id']}/execute")
    events = client.get("/v1/activity?limit=3").json()["events"]
    assert len(events) == 3
    assert set(events[0]) == {"id", "run_id", "goal", "type", "at", "data"}
    assert events[0]["type"] == "run.finalized" and events[0]["goal"] == run["goal"]
    assert [e["id"] for e in events] == sorted((e["id"] for e in events), reverse=True)

    full = client.get(f"/v1/runs/{run['id']}").json()
    assert [e["type"] for e in full["events"]][:2] == ["run.created", "execution.started"]
    assert {"id", "type", "at", "data"} <= full["events"][0].keys()
    for i in full["diff"]:
        assert {"preview", "flags", "risk", "status", "approved_by", "approval_mode"} <= i.keys()
    for e in full["effects"]:
        assert {"result", "verified", "undo_status", "undo_result", "compensation", "reversible"} <= e.keys()

    stats = client.get("/v1/stats").json()
    for key in (
        "runs_total",
        "prompts_avoided",
        "taint_blocks",
        "verified_runs",
        "verification_failed_runs",
        "effects_compensated",
        "blocked_items",
        "human_approvals",
        "avg_actions_per_run",
        "runs_last_7d",
        "by_tool",
    ):
        assert key in stats
    assert len(stats["runs_last_7d"]) == 7 and stats["runs_last_7d"][-1]["runs"] == 1
    assert stats["by_tool"] == {"docs.search": 1, "slack.post": 1}
    assert stats["avg_actions_per_run"] == 2


def test_health_reports_model(client):
    body = client.get("/health").json()
    assert body["model"] == "muse-spark-1.3-contributor"
    assert "llm_configured" in body


# ---- planner and LLM client -----------------------------------------------------------------------
def test_planner_propagates_taint_from_context(client, app):
    def responder(messages, name):
        payload = json.loads(messages[1]["content"])
        assert any(r["record_id"] == "acct-1004" for r in payload["environment"]["crm_records"])
        return {
            "actions": [
                {
                    "node_id": "confirm",
                    "tool": "email.send",
                    "args": {
                        "to": "payments@northwind-billing-update.example",
                        "subject": "Confirmation",
                        "body": "Paid.",
                    },
                    # The model mislabels the recipient as trusted; deterministic propagation fixes it.
                    "arg_sources": {"to": "user", "subject": "user", "body": "user"},
                }
            ],
            "done_criteria": ["Confirmation sent"],
            "notes": "n",
        }

    app.state.llm = FakeLLM(responder)
    s = scenario(client, "injected-recipient")
    plan = client.post("/v1/plan", json={"goal": s["goal"], "context": s["context"]}).json()
    assert plan["actions"][0]["arg_sources"]["to"] == "untrusted"
    assert plan["taint_propagated"][0]["arg"] == "to"
    assert plan["notes"] == "n" and "latency_ms" in plan
    run = client.post("/v1/runs", json={"goal": s["goal"], "actions": plan["actions"]}).json()
    assert run["diff"][0]["status"] == "blocked"


def test_propagate_taint_ignores_identifiers_from_the_goal():
    actions = [{"node_id": "a", "tool": "slack.post", "args": {"channel": "#finance", "text": "hi"}, "arg_sources": {}}]
    assert propagate_taint(actions, "tell #finance", "email mentions #finance and x@y.example") == []
    assert actions[0]["arg_sources"] == {}


def test_muse_retries_when_reasoning_eats_the_budget():
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        if len(bodies) == 1:
            return httpx.Response(200, json={"choices": [{"message": {"content": None}, "finish_reason": "length"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": 3}'}, "finish_reason": "stop"}]})

    llm = MuseClient(api_key="k", base_url="https://muse.test/v1", model="m", transport=httpx.MockTransport(handler))
    out = asyncio.run(llm.complete_json([{"role": "user", "content": "x"}], schema={}, name="t"))
    assert out == {"ok": 3}
    assert bodies[1]["max_completion_tokens"] == 2 * bodies[0]["max_completion_tokens"]
    assert bodies[1]["reasoning_effort"] == "minimal"


def test_hedged_returns_the_first_success():
    calls = []

    async def factory():
        calls.append(1)
        n = len(calls)
        await asyncio.sleep(1.0 if n == 1 else 0.01)
        return n

    assert asyncio.run(hedged(factory, 0.05)) == 2
    assert len(calls) == 2

    async def fast():
        return "x"

    assert asyncio.run(hedged(fast, 0.05)) == "x"


def test_request_timeout_backstop(tmp_path):
    from fastapi.testclient import TestClient

    settings = Settings(db_path=str(tmp_path / "b.db"), request_timeout_s=0.2, plan_budget_s=10, plan_hedge_s=0)
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.llm = SlowLLM(lambda m, n: None)
        resp = client.post("/v1/plan", json={"goal": "x"})
        assert resp.status_code == 504 and resp.json()["error"]["code"] == "timeout"
        assert client.get("/health").status_code == 200


def test_cors_production_origins(tmp_path):
    from fastapi.testclient import TestClient

    origins = ("https://adjutant.spacesdrive.cc", "https://adjutant.pages.dev")
    app = create_app(Settings(db_path=str(tmp_path / "c.db"), allowed_origins=origins))
    with TestClient(app) as client:
        headers = {"Origin": "https://adjutant.spacesdrive.cc", "Access-Control-Request-Method": "POST"}
        ok = client.options("/v1/demo/reset", headers=headers)
        assert ok.status_code == 200
        assert ok.headers["access-control-allow-origin"] == "https://adjutant.spacesdrive.cc"
        bad = client.options("/v1/runs", headers={**headers, "Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in bad.headers
