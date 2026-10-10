"""Verification: tool-level checks against sandbox state, plus done-criteria judged against real outputs.

`verify_run` never raises: if Muse is unavailable, slow or returns garbage, the done-criteria are judged
deterministically and the verification says so (`judge: "deterministic-fallback"`).

The deterministic judge is entity-based: a criterion that names concrete entities (an email address, a
#channel, a CRM record id) is met only if an executed effect that touched those entities was verified
against sandbox state. Negative criteria ("no email was sent to X") are met only if no executed effect
touched X. The same check also guards Muse's verdict: Muse can never mark a criterion met when the
ledger shows the named entity was never touched.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from .canonical import canonical_json, now_iso
from .llm import MuseClient, hedged

log = logging.getLogger("adjutant.verifier")

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
Judge ONLY from the executed effects and their real outputs (the ledger), not from the plan or intent.
Planned actions that were blocked, declined, skipped or failed did NOT happen.
A criterion is met only if the evidence clearly shows it. Cite the node_id(s) in one short sentence of evidence.
Respond with JSON only: one entry per criterion, in the given order."""

_ENTITY_RE = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\bacct-\d+\b|#[a-z0-9][a-z0-9._-]+",
    re.I,
)
_NEGATION_RE = re.compile(r"\b(no|not|never|without|none|nothing|blocked)\b|n't\b", re.I)


def _entities(text: str) -> list[str]:
    seen: list[str] = []
    for m in _ENTITY_RE.finditer(text):
        e = m.group(0).lower().rstrip(".,;")
        if e not in seen:
            seen.append(e)
    return seen


def _blob(effect: dict[str, Any]) -> str:
    return canonical_json({"args": effect["args"], "result": effect["result"]}).lower()


def deterministic_judgment(criterion: str, run: dict[str, Any]) -> dict[str, Any]:
    """Judge one criterion from the ledger alone. Returns {criterion, met, evidence, entities}."""
    effects = run["effects"]
    executed = [e for e in effects if e["status"] == "executed"]
    verified = [e for e in executed if e["verified"]]
    entities = _entities(criterion)
    negative = bool(_NEGATION_RE.search(criterion))

    if entities and negative:
        touched = sorted({e["node_id"] for e in executed for ent in entities if ent in _blob(e)})
        if touched:
            return {"met": False, "evidence": f"Ledger shows {', '.join(touched)} touched {', '.join(entities)}."}
        return {"met": True, "evidence": f"No executed effect touched {', '.join(entities)}."}

    if entities:
        missing = [ent for ent in entities if not any(ent in _blob(e) for e in verified)]
        if missing:
            not_run = [
                f"{i['node_id']} ({i['status']})"
                for i in run.get("diff", [])
                if i["status"] not in ("executed", "compensated")
                and any(ent in canonical_json(i["args"]).lower() for ent in entities)
            ]
            why = f"; planned but not executed: {', '.join(not_run)}" if not_run else ""
            return {
                "met": False,
                "evidence": f"No verified effect touched {', '.join(missing)}{why}.",
            }
        nodes = sorted({e["node_id"] for e in verified for ent in entities if ent in _blob(e)})
        return {"met": True, "evidence": f"Verified against system state via {', '.join(nodes)}."}

    ok = bool(executed) and len(verified) == len(effects)
    return {
        "met": ok,
        "evidence": f"{len(verified)}/{len(effects)} effect(s) executed and verified against sandbox state "
        "(criterion names no concrete entity, so all effects must verify).",
    }


def _evidence(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "ledger": [
            {
                "node_id": e["node_id"],
                "tool": e["tool"],
                "args": e["args"],
                "status": e["status"],
                "result": e["result"],
                "error": e["error"],
                "verified_against_state": e["verified"],
            }
            for e in run["effects"]
        ],
        "not_executed": [
            {"node_id": i["node_id"], "tool": i["tool"], "status": i["status"], "flags": i["flags"]}
            for i in run.get("diff", [])
            if i["status"] not in ("executed", "compensated")
        ],
    }


async def _muse_judgment(
    run: dict[str, Any], criteria: list[str], llm: MuseClient, budget_s: float, effort: str, hedge_after_s: float
) -> list[dict[str, Any]]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": json.dumps(
                {"goal": run["goal"], "done_criteria": criteria, **_evidence(run)},
                ensure_ascii=False,
            ),
        },
    ]
    data = await asyncio.wait_for(
        hedged(
            lambda: llm.complete_json(
                messages, schema=VERIFY_SCHEMA, name="adjutant_verify", effort=effort, max_completion_tokens=4000
            ),
            hedge_after_s,
        ),
        timeout=budget_s,
    )
    judged = data.get("criteria") if isinstance(data, dict) else None
    if not isinstance(judged, list):
        raise ValueError("verification response missing 'criteria'")
    out = []
    for i, criterion in enumerate(criteria):
        entry = judged[i] if i < len(judged) and isinstance(judged[i], dict) else {}
        out.append(
            {
                "criterion": criterion,
                "met": entry.get("met") is True,
                "evidence": str(entry.get("evidence") or "not assessed")[:1000],
            }
        )
    return out


async def verify_run(
    run: dict[str, Any],
    llm: MuseClient | None,
    *,
    budget_s: float = 25.0,
    effort: str = "low",
    hedge_after_s: float = 0,
) -> dict[str, Any]:
    effects = run["effects"]
    checks = [
        {"node_id": e["node_id"], "tool": e["tool"], "status": e["status"], "verified": bool(e["verified"])}
        for e in effects
    ]
    ok = sum(1 for c in checks if c["status"] == "executed" and c["verified"])
    effects_verified = bool(checks) and ok == len(checks)
    criteria = list(run["done_criteria"]) or ["All executed effects are verified against system state"]
    deterministic = [{"criterion": c, **deterministic_judgment(c, run)} for c in criteria]

    judge, note, results, latency_ms = "deterministic", None, deterministic, None
    if run["done_criteria"] and llm is not None and llm.configured:
        started = time.perf_counter()
        try:
            judged = await _muse_judgment(run, criteria, llm, budget_s, effort, hedge_after_s)
            latency_ms = int((time.perf_counter() - started) * 1000)
            results = []
            for muse, det in zip(judged, deterministic, strict=True):
                if muse["met"] and not det["met"]:
                    results.append(
                        {**muse, "met": False, "evidence": f"{muse['evidence']} [ledger guard: {det['evidence']}]"}
                    )
                else:
                    results.append(muse)
            judge = "muse"
        except Exception as e:  # never let the judge break execution
            latency_ms = int((time.perf_counter() - started) * 1000)
            reason = "timed out" if isinstance(e, TimeoutError) else f"{e.__class__.__name__}: {e}"[:300]
            log.warning("Muse verification failed, using deterministic fallback: %s", reason)
            judge, results = "deterministic-fallback", deterministic
            note = (
                f"Muse verification unavailable ({reason}); done-criteria were judged deterministically "
                "from the effect ledger"
            )

    verification: dict[str, Any] = {
        "method": "muse" if judge == "muse" else "deterministic",
        "judge": judge,
        "model": getattr(llm, "model", None) if judge == "muse" else None,
        "passed": effects_verified and all(r["met"] for r in results),
        "effects_verified": effects_verified,
        "checks": checks,
        "criteria": results,
        "criteria_met": sum(1 for r in results if r["met"]),
        "criteria_total": len(results),
        "verified_at": now_iso(),
    }
    if latency_ms is not None:
        verification["judge_latency_ms"] = latency_ms
    if note:
        verification["note"] = note
    return verification
