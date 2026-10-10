"""FastAPI application entry point: `uvicorn app.main:app`."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
        }

    app.include_router(router, tags=["gate"])
    return app


app = create_app()
