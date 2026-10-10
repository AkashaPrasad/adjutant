import asyncio
import json

import httpx
import pytest

from app.llm import LLMError, LLMUnavailable, MuseClient

from .conftest import FakeLLM


def test_plan_without_key_is_503(client):
    resp = client.post("/v1/plan", json={"goal": "email Dana"})
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "llm_unavailable"


def test_plan_is_constrained_to_registered_tools(client, app):
    def responder(messages, name):
        assert name == "adjutant_plan"
        assert "slack.post" in messages[1]["content"]
        return {
            "actions": [
                {
                    "node_id": "n1",
                    "tool": "http.get",
                    "args": {"url": "https://acme-supplies.example/about"},
                    "arg_sources": {"url": "user"},
                },
                {
                    "node_id": "n1",
                    "tool": "slack.post",
                    "args": {"channel": "#sales", "text": "Acme summary"},
                    "arg_sources": {"channel": "user", "text": "bogus"},
                },
                {"node_id": "n3", "tool": "shell.exec", "args": {"cmd": "rm -rf /"}, "arg_sources": {}},
            ],
            "done_criteria": ["A summary was posted to #sales", ""],
        }

    app.state.llm = FakeLLM(responder)
    plan = client.post("/v1/plan", json={"goal": "Research Acme and tell #sales"}).json()
    assert [a["tool"] for a in plan["actions"]] == ["http.get", "slack.post"]
    assert len({a["node_id"] for a in plan["actions"]}) == 2
    assert plan["actions"][1]["arg_sources"] == {"channel": "user", "text": "untrusted"}
    assert plan["dropped"] == [{"node_id": "n3", "tool": "shell.exec", "reason": "unknown_tool"}]
    assert plan["done_criteria"] == ["A summary was posted to #sales"]

    # The drafted plan can be submitted as-is.
    resp = client.post("/v1/runs", json={"goal": plan["goal"], "actions": plan["actions"]})
    assert resp.status_code == 201


def _client(handler, **kw) -> MuseClient:
    return MuseClient(
        api_key="k",
        base_url="https://muse.test/v1",
        model="muse-spark-1.3-contributor",
        backoff_base_s=0,
        transport=httpx.MockTransport(handler),
        **kw,
    )


def _completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def _call(client: MuseClient):
    return asyncio.run(client.complete_json([{"role": "user", "content": "hi"}], schema={"type": "object"}, name="t"))


def test_muse_request_shape():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return _completion('{"ok": true}')

    assert _call(_client(handler)) == {"ok": True}
    body = seen["body"]
    assert seen["url"] == "https://muse.test/v1/chat/completions"
    assert seen["auth"] == "Bearer k"
    assert body["model"] == "muse-spark-1.3-contributor"
    assert body["reasoning_effort"] == "low"
    assert "max_completion_tokens" in body and "max_tokens" not in body
    assert body["response_format"]["type"] == "json_schema"
    assert not {"stream", "stop", "n", "logprobs"} & body.keys()


def test_muse_falls_back_when_schema_rejected():
    bodies = []

    def handler(request: httpx.Request):
        bodies.append(json.loads(request.content))
        if "response_format" in bodies[-1]:
            return httpx.Response(400, json={"error": {"message": "response_format json_schema not supported"}})
        return _completion('Sure:\n```json\n{"ok": 1}\n```')

    assert _call(_client(handler, max_retries=0)) == {"ok": 1}
    assert "JSON Schema" in bodies[1]["messages"][-1]["content"]


def test_muse_retries_429_then_succeeds():
    statuses = iter([429, 503, 200])

    def handler(request):
        status = next(statuses)
        return _completion('{"ok": 2}') if status == 200 else httpx.Response(status, headers={"retry-after": "0"})

    assert _call(_client(handler)) == {"ok": 2}


def test_muse_errors():
    with pytest.raises(LLMError):
        _call(_client(lambda r: httpx.Response(500), max_retries=1))
    with pytest.raises(LLMError):
        _call(_client(lambda r: httpx.Response(401, json={"error": "bad key"})))
    with pytest.raises(LLMError):
        _call(_client(lambda r: _completion("no json here")))
    missing = MuseClient(api_key="", base_url="https://muse.test/v1", model="m")
    with pytest.raises(LLMUnavailable):
        _call(missing)
