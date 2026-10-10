"""Runtime configuration, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

DEFAULT_SIGNING_KEY = "adjutant-dev-signing-key-not-for-production"


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


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
    llm_timeout_s: float = 90.0
    llm_max_retries: int = 4

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
