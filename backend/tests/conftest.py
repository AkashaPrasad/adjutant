from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


class FakeLLM:
    """Stands in for MuseClient: no network. `responder(messages, name)` returns the parsed JSON."""

    model = "muse-spark-1.3-contributor"

    def __init__(self, responder: Callable[[list[dict[str, Any]], str], Any]) -> None:
        self.responder = responder
        self.calls: list[str] = []

    @property
    def configured(self) -> bool:
        return True

    async def complete_json(self, messages, *, schema, name, effort="low", max_completion_tokens=4000):
        self.calls.append(name)
        return self.responder(messages, name)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(db_path=str(tmp_path / "adjutant.db"), signing_key="test-signing-key", git_sha="abc123")


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


# ---- helpers ------------------------------------------------------------------------------------
def create_run(client: TestClient, actions: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    resp = client.post("/v1/runs", json={"goal": "test goal", "actions": actions, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


def item(run: dict[str, Any], node_id: str) -> dict[str, Any]:
    return next(i for i in run["diff"] if i["node_id"] == node_id)


def pending_hashes(run: dict[str, Any]) -> list[str]:
    return [i["args_hash"] for i in run["diff"] if i["status"] == "pending_approval"]


EMAIL = {
    "node_id": "n_email",
    "tool": "email.send",
    "args": {"to": "dana@ourco.example", "subject": "Acme summary", "body": "Acme sells fasteners."},
    "arg_sources": {"to": "user", "body": "user"},
}
SLACK = {"node_id": "n_slack", "tool": "slack.post", "args": {"channel": "#sales", "text": "Acme researched"}}
DOCS = {"node_id": "n_docs", "tool": "docs.search", "args": {"query": "acme vendor"}}
CRM = {"node_id": "n_crm", "tool": "crm.update", "args": {"record_id": "acct-1001", "fields": {"stage": "qualified"}}}
