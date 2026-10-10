import copy

from .conftest import CRM, DOCS, EMAIL, SLACK, FakeLLM, create_run, item, pending_hashes


def approve(client, run, hashes=None, reviewer="alex"):
    hashes = pending_hashes(run) if hashes is None else hashes
    return client.post(
        f"/v1/runs/{run['id']}/decision", json={"decision": "approve", "reviewer": reviewer, "approved_hashes": hashes}
    )


def test_shadow_run_gates_only_what_needs_a_human(client):
    run = create_run(client, [DOCS, SLACK, EMAIL])
    assert run["status"] == "awaiting_approval"
    assert item(run, "n_docs")["status"] == "auto_approved"
    assert item(run, "n_docs")["preview"]["results"], "reads are performed for real in the shadow run"
    assert item(run, "n_slack")["status"] == "auto_approved"
    email = item(run, "n_email")
    assert (email["status"], email["risk"], email["decision_required"]) == ("pending_approval", "high", True)
    assert "irreversible" in email["flags"]
    assert email["preview"]["to"] == ["dana@ourco.example"]
    assert run["summary"] == {"total": 3, "auto_approved": 2, "needs_approval": 1, "blocked": 0}
    assert run["effects"] == [], "shadow run has no side effects"
    assert client.get("/v1/sandbox").json()["email"] == []


def test_full_lifecycle_execute_once_undo_audit(client):
    run = create_run(client, [DOCS, SLACK, CRM, EMAIL], done_criteria=["Dana was emailed"])
    assert approve(client, run, hashes=["0" * 64]).json()["error"]["code"] == "stale_approval"

    run = approve(client, run).json()
    assert run["status"] == "approved"
    assert item(run, "n_email")["approved_by"] == "alex"

    first = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert first["status"] == "completed", first["verification"]
    assert first["replayed"] is False
    assert [e["status"] for e in first["effects"]] == ["executed"] * 4
    assert all(e["verified"] for e in first["effects"])
    assert first["verification"]["method"] == "deterministic"
    assert first["verification"]["passed"] is True

    # Idempotent: a second execute never re-runs effects.
    second = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert second["replayed"] is True
    assert len(client.get("/v1/ledger").json()["effects"]) == 4
    sandbox = client.get("/v1/sandbox").json()
    assert len(sandbox["email"]) == 1 and len(sandbox["slack_message"]) == 1
    crm = next(o for o in sandbox["crm_record"] if o["id"] == "acct-1001")
    assert crm["data"]["stage"] == "qualified"

    undone = client.post(f"/v1/runs/{run['id']}/undo").json()
    assert undone["status"] == "compensated"
    assert undone["undo"]["compensated"] == ["n_crm", "n_slack"], "newest first"
    assert undone["undo"]["not_reversible"] == ["n_email"]
    sandbox = client.get("/v1/sandbox").json()
    assert sandbox["slack_message"][0]["status"] == "deleted"
    assert next(o for o in sandbox["crm_record"] if o["id"] == "acct-1001")["data"]["stage"] == "prospect"
    assert sandbox["email"][0]["status"] == "sent"
    assert client.post(f"/v1/runs/{run['id']}/undo").json()["status"] == "compensated"  # idempotent

    audit = client.get(f"/v1/runs/{run['id']}/audit").json()
    assert audit["algorithm"] == "HMAC-SHA256"
    packet = audit["packet"]
    assert packet["reviewer"] == "alex"
    assert {"plan", "diff", "decision", "effects", "verification", "undo", "events"} <= packet.keys()
    ok = client.post("/v1/audit/verify", json={"packet": packet, "signature": audit["signature"]}).json()
    assert ok["valid"] is True
    tampered = copy.deepcopy(packet)
    tampered["reviewer"] = "mallory"
    bad = client.post("/v1/audit/verify", json={"packet": tampered, "signature": audit["signature"]}).json()
    assert bad["valid"] is False


def test_taint_blocks_sensitive_arg_and_edit_unblocks(client):
    tainted = copy.deepcopy(EMAIL)
    tainted["args"]["to"] = "exfil@attacker.example"
    tainted["arg_sources"] = {"to": "untrusted", "body": "untrusted"}
    run = create_run(client, [tainted])
    email = item(run, "n_email")
    assert run["status"] == "blocked"
    assert email["status"] == "blocked" and "taint:to" in email["flags"]

    resp = approve(client, run, hashes=[email["args_hash"]])
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "item_blocked"
    assert client.post(f"/v1/runs/{run['id']}/execute").json()["error"]["code"] == "not_approved"

    # The reviewer supplies the recipient: that value is trusted; the untrusted body stays flagged.
    new_args = {**tainted["args"], "to": "dana@ourco.example"}
    run = client.post(f"/v1/runs/{run['id']}/edit", json={"node_id": "n_email", "args": new_args}).json()
    email = item(run, "n_email")
    assert run["status"] == "awaiting_approval"
    assert email["arg_sources"] == {"to": "user", "body": "untrusted"}
    assert "untrusted_content:body" in email["flags"]
    assert approve(client, run).json()["status"] == "approved"
    assert client.post(f"/v1/runs/{run['id']}/execute").json()["status"] == "completed"


def test_edit_after_approval_regates_and_invalidates_old_hash(client):
    run = create_run(client, [EMAIL])
    old_hash = item(run, "n_email")["args_hash"]
    assert approve(client, run).json()["status"] == "approved"

    new_args = {**EMAIL["args"], "body": "Changed after approval"}
    run = client.post(f"/v1/runs/{run['id']}/edit", json={"node_id": "n_email", "args": new_args}).json()
    assert run["status"] == "awaiting_approval"
    assert item(run, "n_email")["args_hash"] != old_hash
    assert item(run, "n_email")["approved_hash"] is None
    assert client.post(f"/v1/runs/{run['id']}/execute").status_code == 409
    resp = approve(client, run, hashes=[old_hash])
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "stale_approval"


def test_blocked_items_are_skipped_when_rest_is_approved(client):
    tainted = {
        "node_id": "n_bad",
        "tool": "slack.post",
        "args": {"channel": "#general", "text": "x"},
        "arg_sources": {"channel": "untrusted"},
    }
    run = create_run(client, [SLACK, tainted])
    assert run["status"] == "blocked"
    run = approve(client, run, hashes=[]).json()
    assert run["status"] == "approved"
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert done["status"] == "partially_completed"
    assert [e["node_id"] for e in done["effects"]] == ["n_slack"]


def test_reject(client):
    run = create_run(client, [EMAIL])
    run = client.post(f"/v1/runs/{run['id']}/decision", json={"decision": "reject", "reviewer": "alex"}).json()
    assert run["status"] == "rejected"
    resp = client.post(f"/v1/runs/{run['id']}/execute")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "invalid_state"
    assert client.get("/v1/ledger").json()["effects"] == []


def test_auto_approve_off_and_invalid_and_unknown(client):
    run = create_run(client, [SLACK], auto_approve_low_risk=False)
    assert run["status"] == "awaiting_approval"

    bad = {"node_id": "n1", "tool": "crm.update", "args": {"record_id": "acct-9999", "fields": {"stage": "x"}}}
    run = create_run(client, [bad])
    assert item(run, "n1")["status"] == "blocked"
    assert item(run, "n1")["flags"] == ["invalid_args"]
    assert "not found" in item(run, "n1")["preview"]["error"]

    resp = client.post("/v1/runs", json={"goal": "g", "actions": [{"node_id": "n1", "tool": "shell.exec"}]})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "unknown_tool"
    dup = client.post("/v1/runs", json={"goal": "g", "actions": [SLACK, SLACK]})
    assert dup.status_code == 422


def test_failed_effect_halts_and_marks_rest_skipped(client, app, monkeypatch):
    run = create_run(client, [SLACK, CRM])
    tool = app.state.gate.registry.get("slack.post")

    def boom(conn, args):
        raise RuntimeError("slack is down")

    monkeypatch.setattr(tool, "execute", boom)
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert done["status"] == "failed"
    assert item(done, "n_slack")["status"] == "failed"
    assert item(done, "n_crm")["status"] == "skipped"
    assert done["effects"][0]["error"] == "slack is down"
    assert client.get("/v1/sandbox").json()["slack_message"] == []


def test_done_criteria_judged_by_muse(client, app):
    def responder(messages, name):
        assert name == "adjutant_verify"
        return {"criteria": [{"criterion": "posted", "met": False, "evidence": "n_slack posted to wrong channel"}]}

    app.state.llm = FakeLLM(responder)
    run = create_run(client, [SLACK], done_criteria=["A message was posted to #marketing"])
    done = client.post(f"/v1/runs/{run['id']}/execute").json()
    assert done["verification"]["method"] == "muse"
    assert done["verification"]["criteria"][0]["met"] is False
    assert done["verification"]["criteria"][0]["criterion"] == "A message was posted to #marketing"
    assert done["status"] == "partially_completed"


def test_list_runs_ledger_and_stats(client):
    a = create_run(client, [DOCS, SLACK])
    b = create_run(client, [EMAIL])
    client.post(f"/v1/runs/{a['id']}/execute")
    runs = client.get("/v1/runs?limit=10").json()["runs"]
    assert [r["id"] for r in runs] == [b["id"], a["id"]]
    assert runs[1]["summary"]["auto_approved"] == 2
    assert len(client.get("/v1/runs?limit=1").json()["runs"]) == 1
    assert client.get("/v1/runs?limit=0").status_code == 422

    stats = client.get("/v1/stats").json()
    assert stats["runs_total"] == 2
    assert stats["runs_by_status"] == {"completed": 1, "awaiting_approval": 1}
    assert stats["effects_total"] == 2
    assert stats["prompts_avoided"] == 2
    assert stats["approvals_required"] == 1
