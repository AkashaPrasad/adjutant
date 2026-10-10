"""HTTP routes under /v1."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request
from starlette.concurrency import run_in_threadpool

from .errors import ApiError
from .gate import Gate
from .llm import LLMError, LLMUnavailable, MuseClient
from .planner import draft_plan
from .schemas import AuditVerifyRequest, DecisionRequest, EditRequest, PlanRequest, RunCreate
from .verifier import verify_run

router = APIRouter(prefix="/v1")


def _gate(request: Request) -> Gate:
    return request.app.state.gate


def _llm(request: Request) -> MuseClient:
    return request.app.state.llm


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
    try:
        drafted = await draft_plan(body.goal, body.context, _gate(request).registry, llm)
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
    started = await run_in_threadpool(gate.execute_effects, run_id)
    run = await run_in_threadpool(gate.get_run, run_id)
    if not started:
        return {**run, "replayed": True}
    verification = await verify_run(run, _llm(request))
    run = await run_in_threadpool(gate.finalize, run_id, verification)
    return {**run, "replayed": False}


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
