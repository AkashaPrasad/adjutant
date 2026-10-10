def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["service"] == "adjutant-gate"
    assert body["commit"] == "abc123"
    assert body["model"] == "muse-spark-1.3-contributor"
    assert body["llm_configured"] is False
    assert {"version", "deployed_at", "env"} <= body.keys()


def test_root_points_to_docs(client):
    assert client.get("/").json()["docs"] == "/docs"


def test_error_model_for_unknown_route_and_run(client):
    resp = client.get("/v1/nope")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"
    resp = client.get("/v1/runs/run_missing")
    assert resp.status_code == 404
    assert set(resp.json()["error"]) == {"code", "message"}


def test_validation_error_shape(client):
    resp = client.post("/v1/runs", json={"goal": "x", "actions": []})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


def test_cors_preflight(client):
    resp = client.options(
        "/v1/runs",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] in ("*", "http://localhost:5173")


def test_tool_catalog(client):
    tools = {t["name"]: t for t in client.get("/v1/tools").json()["tools"]}
    assert set(tools) == {"email.send", "slack.post", "crm.update", "calendar.create_event", "http.get", "docs.search"}
    assert tools["email.send"]["reversible"] is False
    assert tools["email.send"]["sensitive_args"] == ["to", "cc"]
    assert tools["slack.post"]["sensitive_args"] == ["channel"]
    assert tools["http.get"]["kind"] == "read"
