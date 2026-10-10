"""HTTP routes under /v1."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from starlette.concurrency import run_in_threadpool

from . import demo, sandbox
from .config import Settings
from .errors import ApiError, not_found
from .gate import Gate
from .llm import LLMError, LLMUnavailable, MuseClient
from .planner import draft_plan
from .scenarios import get_scenario, scenarios
from .schemas import AuditVerifyRequest, DecisionRequest, EditRequest, PlanRequest, ResetRequest, RunCreate
from .verifier import verify_run

log = logging.getLogger("adjutant.api")

router = APIRouter(prefix="/v1")


def _gate(request: Request) -> Gate:
    return request.app.state.gate


def _llm(request: Request) -> MuseClient:
    return request.app.state.llm


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _environment(gate: Gate) -> dict[str, Any]:
    """Facts the planner may rely on: real CRM ids, so it does not have to invent them."""
    with gate.db.connect() as conn:
        records = sandbox.list_objects(conn, "crm_record")
    return {
        "crm_records": [
            {"record_id": r["id"], "name": r["data"].get("name"), "stage": r["data"].get("stage")} for r in records
        ]
    }


@router.get("/tools", summary="Tool catalog")
def list_tools(request: Request) -> dict[str, Any]:
    return {"tools": _gate(request).registry.catalog()}


@router.post("/plan", summary="Draft a plan with Muse, constrained to registered tools")
async def plan(body: PlanRequest, request: Request) -> dict[str, Any]:
    llm = _llm(request)
    if not llm.configured:
        raise ApiError(
            503,
            "llm_unavailable",
            "MUSE_API_KEY is not configured, so planning is disabled. Submit actions directly to POST /v1/runs.",
        )
    settings = _settings(request)
    gate = _gate(request)
    try:
        drafted = await asyncio.wait_for(
            draft_plan(
                body.goal,
                body.context,
                gate.registry,
                llm,
                environment=await run_in_threadpool(_environment, gate),
                effort=settings.llm_reasoning_effort,
                hedge_after_s=settings.plan_hedge_s,
            ),
            timeout=settings.plan_budget_s,
        )
    except TimeoutError as e:
        raise ApiError(
            504, "llm_timeout", f"planning took longer than {settings.plan_budget_s:.0f}s; use a pre-built plan"
        ) from e
    except LLMUnavailable as e:
        raise ApiError(503, "llm_unavailable", str(e)) from e
    except (LLMError, ValueError) as e:
        raise ApiError(502, "llm_error", f"planning failed: {e}") from e
    return {"goal": body.goal, "model": llm.model, **drafted}


@router.post("/runs", status_code=201, summary="Create a run and perform its shadow run")
def create_run(body: RunCreate, request: Request) -> dict[str, Any]:
    return _gate(request).create_run(body)


@router.get("/runs", summary="List runs, newest first")
def list_runs(request: Request, limit: int = Query(20, ge=1, le=200)) -> dict[str, Any]:
    return {"runs": _gate(request).list_runs(limit)}


@router.get("/runs/{run_id}", summary="Get a run with its plan diff, effects and verification")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    return _gate(request).get_run(run_id)


@router.post("/runs/{run_id}/decision", summary="Approve (bound to args hashes) or reject")
def decide(run_id: str, body: DecisionRequest, request: Request) -> dict[str, Any]:
    return _gate(request).decide(run_id, body)


@router.post("/runs/{run_id}/edit", summary="Edit an action's args; re-gates the item")
def edit(run_id: str, body: EditRequest, request: Request) -> dict[str, Any]:
    return _gate(request).edit(run_id, body)


@router.post("/runs/{run_id}/execute", summary="Execute approved items exactly once, then verify")
async def execute(run_id: str, request: Request) -> dict[str, Any]:
    gate = _gate(request)
    settings = _settings(request)
    started = await run_in_threadpool(gate.execute_effects, run_id)
    run = await run_in_threadpool(gate.get_run, run_id)
    if not started:
        return {**run, "replayed": True, "in_progress": run["status"] == "executing"}
    try:
        verification = await verify_run(
            run,
            _llm(request),
            budget_s=settings.verify_budget_s,
            effort=settings.verify_reasoning_effort,
            hedge_after_s=settings.verify_hedge_s,
        )
    except Exception:  # belt and braces: verify_run already falls back internally
        log.exception("verification crashed; finalizing with deterministic verification")
        verification = await verify_run(run, None)
    run = await run_in_threadpool(gate.finalize, run_id, verification)
    return {**run, "replayed": False, "in_progress": False}


@router.post("/runs/{run_id}/undo", summary="Compensate reversible effects, newest first")
def undo(run_id: str, request: Request) -> dict[str, Any]:
    return _gate(request).undo(run_id)


@router.get("/runs/{run_id}/audit", summary="Signed audit packet (HMAC-SHA256 over canonical JSON)")
def audit(run_id: str, request: Request) -> dict[str, Any]:
    return _gate(request).audit(run_id)


@router.post("/audit/verify", summary="Check an audit packet signature")
def verify_audit(body: AuditVerifyRequest, request: Request) -> dict[str, Any]:
    return _gate(request).verify_audit(body.packet, body.signature)


@router.get("/ledger", summary="Recent effects across runs")
def ledger(request: Request, limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    return {"effects": _gate(request).ledger(limit)}


@router.get("/stats", summary="Counters: runs by status, effects, prompts avoided")
def stats(request: Request) -> dict[str, Any]:
    return _gate(request).stats()


@router.get("/sandbox", summary="Current state of the simulated systems (outbox, slack, crm, calendar)")
def sandbox_state(request: Request) -> dict[str, Any]:
    return _gate(request).sandbox_state()


@router.get("/activity", summary="Recent events across all runs, newest first")
def activity(request: Request, limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    return {"events": _gate(request).activity(limit)}


@router.get("/scenarios", summary="Demo scenarios, each mapping to one pain point, with pre-built plans")
def list_scenarios() -> dict[str, Any]:
    return {"scenarios": scenarios()}


@router.post("/scenarios/{scenario_id}/run", status_code=201, summary="Create a run from a scenario's pre-built plan")
def run_scenario(scenario_id: str, request: Request) -> dict[str, Any]:
    scenario = get_scenario(scenario_id)
    if scenario is None:
        raise not_found(f"scenario '{scenario_id}'")
    body = RunCreate(
        goal=scenario["goal"],
        actions=scenario["actions"],
        done_criteria=scenario["done_criteria"],
        auto_approve_low_risk=scenario["auto_approve_low_risk"],
    )
    return _gate(request).create_run(body)


@router.post("/demo/reset", summary="Clear runs, ledger, events and sandbox; re-seed; optionally add history")
async def demo_reset(request: Request, body: ResetRequest | None = Body(default=None)) -> dict[str, Any]:
    gate = _gate(request)
    await demo.reset(gate, seed=bool(body and body.seed))
    return {"ok": True, "stats": await run_in_threadpool(gate.stats)}
