"""Verification: tool-level checks against sandbox state, plus done-criteria judged against real outputs."""

from __future__ import annotations

import json
from typing import Any

from .canonical import now_iso
from .llm import LLMError, LLMUnavailable, MuseClient

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "criterion": {"type": "string"},
                    "met": {"type": "boolean"},
                    "evidence": {"type": "string"},
                },
                "required": ["criterion", "met", "evidence"],
            },
        }
    },
    "required": ["criteria"],
}

SYSTEM_PROMPT = """You verify whether an AI agent's actions achieved checkable done-criteria.
Judge ONLY from the executed effects and their real outputs provided (not from the plan or intent).
A criterion is met only if the evidence clearly shows it. Cite the node_id(s) in the evidence.
Respond with JSON only: one entry per criterion, in the given order."""


def _evidence(run: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "node_id": e["node_id"],
            "tool": e["tool"],
            "args": e["args"],
            "status": e["status"],
            "result": e["result"],
            "verified_against_state": e["verified"],
        }
        for e in run["effects"]
    ]


async def verify_run(run: dict[str, Any], llm: MuseClient | None) -> dict[str, Any]:
    effects = run["effects"]
    checks = [
        {"node_id": e["node_id"], "tool": e["tool"], "status": e["status"], "verified": bool(e["verified"])}
        for e in effects
    ]
    ok = sum(1 for c in checks if c["status"] == "executed" and c["verified"])
    effects_verified = bool(checks) and ok == len(checks)
    criteria = list(run["done_criteria"]) or ["All executed effects are verified against system state"]

    method, note, results = "deterministic", None, []
    if run["done_criteria"] and llm is not None and llm.configured:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {"goal": run["goal"], "done_criteria": criteria, "effects": _evidence(run)},
                    ensure_ascii=False,
                ),
            },
        ]
        try:
            data = await llm.complete_json(messages, schema=VERIFY_SCHEMA, name="adjutant_verify")
            judged = data.get("criteria") if isinstance(data, dict) else None
            if not isinstance(judged, list):
                raise LLMError("verification response missing 'criteria'")
            for i, criterion in enumerate(criteria):
                entry = judged[i] if i < len(judged) and isinstance(judged[i], dict) else {}
                results.append(
                    {
                        "criterion": criterion,
                        "met": entry.get("met") is True,
                        "evidence": str(entry.get("evidence") or "not assessed")[:1000],
                    }
                )
            method = "muse"
        except (LLMError, LLMUnavailable) as e:
            note = f"Muse verification unavailable ({e}); fell back to deterministic checks"
            results = []

    if not results:
        evidence = f"{ok}/{len(checks)} effect(s) executed and verified against sandbox state"
        results = [{"criterion": c, "met": effects_verified, "evidence": evidence} for c in criteria]

    verification = {
        "method": method,
        "passed": effects_verified and all(r["met"] for r in results),
        "effects_verified": effects_verified,
        "checks": checks,
        "criteria": results,
        "verified_at": now_iso(),
    }
    if note:
        verification["note"] = note
    return verification
