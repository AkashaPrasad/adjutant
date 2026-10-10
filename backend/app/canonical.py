"""Canonical JSON, hashing and signing primitives."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any


def canonical_json(obj: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, UTF-8, no NaN/Infinity."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def args_hash(tool: str, args: dict[str, Any]) -> str:
    """Identity of an action: approval and the effect ledger are bound to this hash."""
    return sha256_hex(canonical_json({"tool": tool, "args": args}))


def hmac_sign(key: str, obj: Any) -> str:
    return hmac.new(key.encode("utf-8"), canonical_json(obj).encode("utf-8"), hashlib.sha256).hexdigest()


def hmac_verify(key: str, obj: Any, signature: str) -> bool:
    return hmac.compare_digest(hmac_sign(key, obj), signature)


def key_id(key: str) -> str:
    return sha256_hex(key)[:12]


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
