"""Runtime configuration, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

DEFAULT_SIGNING_KEY = "adjutant-dev-signing-key-not-for-production"


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    muse_api_key: str = ""
    muse_base_url: str = "https://api.meta.ai/v1"
    muse_model: str = "muse-spark-1.3-contributor"
    db_path: str = "./data/adjutant.db"
    signing_key: str = DEFAULT_SIGNING_KEY
    allowed_origins: tuple[str, ...] = ("*",)
    git_sha: str = "dev"
    deployed_at: str | None = None
    app_env: str = "development"
    # Per-attempt HTTP timeout and retry count for Muse calls.
    llm_timeout_s: float = 30.0
    llm_max_retries: int = 2
    llm_reasoning_effort: str = "low"
    verify_reasoning_effort: str = "minimal"
    # Fire a second identical request if the first has not answered after this many seconds (0 disables).
    plan_hedge_s: float = 12.0
    verify_hedge_s: float = 8.0
    # Wall-clock budgets so no request can hang a live demo.
    plan_budget_s: float = 45.0
    verify_budget_s: float = 20.0
    request_timeout_s: float = 90.0

    @classmethod
    def from_env(cls) -> Settings:
        origins = tuple(o.strip() for o in _env("ALLOWED_ORIGINS", "*").split(",") if o.strip())
        return cls(
            muse_api_key=_env("MUSE_API_KEY"),
            muse_base_url=_env("MUSE_BASE_URL", cls.muse_base_url).rstrip("/"),
            muse_model=_env("MUSE_MODEL", cls.muse_model),
            db_path=_env("ADJUTANT_DB_PATH", cls.db_path),
            signing_key=_env("ADJUTANT_SIGNING_KEY", DEFAULT_SIGNING_KEY),
            allowed_origins=origins or ("*",),
            git_sha=_env("GIT_SHA", "dev"),
            deployed_at=_env("DEPLOYED_AT") or None,
            app_env=_env("APP_ENV", "development"),
            llm_timeout_s=_float("MUSE_TIMEOUT_S", cls.llm_timeout_s),
            llm_max_retries=int(_float("MUSE_MAX_RETRIES", cls.llm_max_retries)),
            llm_reasoning_effort=_env("MUSE_REASONING_EFFORT", cls.llm_reasoning_effort),
            verify_reasoning_effort=_env("MUSE_VERIFY_REASONING_EFFORT", cls.verify_reasoning_effort),
            plan_hedge_s=_float("PLAN_HEDGE_S", cls.plan_hedge_s),
            verify_hedge_s=_float("VERIFY_HEDGE_S", cls.verify_hedge_s),
            plan_budget_s=_float("PLAN_BUDGET_S", cls.plan_budget_s),
            verify_budget_s=_float("VERIFY_BUDGET_S", cls.verify_budget_s),
            request_timeout_s=_float("REQUEST_TIMEOUT_S", cls.request_timeout_s),
        )

    @property
    def llm_configured(self) -> bool:
        return bool(self.muse_api_key)

    @property
    def using_default_signing_key(self) -> bool:
        return self.signing_key == DEFAULT_SIGNING_KEY


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
