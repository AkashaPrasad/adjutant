"""FastAPI application entry point: `uvicorn app.main:app`."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .api import router
from .config import Settings, get_settings
from .db import Database
from .errors import install_error_handlers
from .gate import Gate
from .llm import MuseClient
from .tools import default_registry

log = logging.getLogger("adjutant")

DESCRIPTION = """Adjutant Gate sits between an AI agent and its tools. Every side effect is previewed
(shadow run), approved only when needed, bound to its exact arguments (args hash), executed exactly once
through an effect ledger, undoable, verified, and recorded in a signed audit packet."""


class RequestTimeoutMiddleware:
    """Server-side budget: a request that has not started responding within `timeout_s` gets a 504.

    LLM-backed routes have tighter budgets of their own; this is the backstop so nothing hangs a demo.
    """

    def __init__(self, app: ASGIApp, timeout_s: float) -> None:
        self.app = app
        self.timeout_s = timeout_s

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.timeout_s <= 0:
            await self.app(scope, receive, send)
            return
        started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await asyncio.wait_for(self.app(scope, receive, send_wrapper), timeout=self.timeout_s)
        except TimeoutError:
            log.error("request timed out after %.0fs: %s %s", self.timeout_s, scope.get("method"), scope.get("path"))
            if started:
                return
            body = json.dumps(
                {"error": {"code": "timeout", "message": f"request exceeded the {self.timeout_s:.0f}s server budget"}}
            ).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 504,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
                }
            )
            await send({"type": "http.response.body", "body": body})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.using_default_signing_key:
            log.warning("ADJUTANT_SIGNING_KEY is not set; audit packets are signed with the insecure dev key")
        if not settings.llm_configured:
            log.warning("MUSE_API_KEY is not set; /v1/plan returns 503 and verification is deterministic")
        app.state.gate = Gate(Database(settings.db_path), default_registry(), settings)
        yield

    app = FastAPI(title="Adjutant Gate", version=__version__, description=DESCRIPTION, lifespan=lifespan)
    app.state.settings = settings
    app.state.llm = MuseClient.from_settings(settings)

    origins = list(settings.allowed_origins)
    app.add_middleware(RequestTimeoutMiddleware, timeout_s=settings.request_timeout_s)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials="*" not in origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        max_age=600,
    )
    install_error_handlers(app)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, Any]:
        return {"service": "adjutant-gate", "version": __version__, "docs": "/docs", "health": "/health"}

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "adjutant-gate",
            "version": __version__,
            "commit": settings.git_sha,
            "deployed_at": settings.deployed_at,
            "env": settings.app_env,
            "model": settings.muse_model,
            "llm_configured": app.state.llm.configured,
            "llm": {
                "reasoning_effort": settings.llm_reasoning_effort,
                "verify_reasoning_effort": settings.verify_reasoning_effort,
                "plan_budget_s": settings.plan_budget_s,
                "verify_budget_s": settings.verify_budget_s,
            },
        }

    app.include_router(router, tags=["gate"])
    return app


app = create_app()
