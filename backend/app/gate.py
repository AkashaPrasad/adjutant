"""The gate: shadow run, approval bound to args hashes, exactly-once execution, undo, audit.

Run lifecycle:
    awaiting_approval | blocked | approved  --decision/edit-->  approved | rejected
    approved --execute--> executing --> completed | partially_completed | failed --undo--> compensated

Item lifecycle:
    pending_approval | auto_approved | blocked --> approved | declined | rejected
    approved | auto_approved --> executed | failed | skipped --> compensated
"""

from __future__ import annotations

import contextlib
import secrets
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from . import sandbox
from .canonical import args_hash, canonical_json, hmac_sign, hmac_verify, key_id, now_iso
from .config import Settings
from .db import Database, dumps, loads
from .errors import ApiError, conflict, not_found
from .policy import assess
from .schemas import DecisionRequest, EditRequest, RunCreate
from .tools import Tool, ToolRegistry

PRE_EXECUTION = frozenset({"awaiting_approval", "blocked", "approved"})
FINISHED = frozenset({"completed", "partially_completed", "failed"})
TERMINAL = FINISHED | {"compensated", "rejected"}
EXECUTABLE = frozenset({"approved", "auto_approved"})


def _derive_status(items: list[dict[str, Any]], *, decided: bool) -> str:
    statuses = {i["status"] for i in items}
    if "pending_approval" in statuses:
        return "awaiting_approval"
    if "blocked" in statuses and not decided:
        return "blocked"  # a human must still decide: edit the blocked item, approve the rest, or reject
    return "approved"


def _check_serializable(args: dict[str, Any], node_id: str) -> None:
    try:
        canonical_json(args)
    except (TypeError, ValueError) as e:
        raise ApiError(422, "invalid_args", f"args for node '{node_id}' are not canonical JSON: {e}") from e


class Gate:
    def __init__(self, db: Database, registry: ToolRegistry, settings: Settings) -> None:
        self.db = db
        self.registry = registry
        self.settings = settings
        self._lock = threading.RLock()
        with db.transaction() as conn:
            sandbox.seed(conn)

    # ------------------------------------------------------------------------------------------
    # Shadow run
    # ------------------------------------------------------------------------------------------
    def _shadow(
        self, conn: sqlite3.Connection, tool: Tool, args: dict[str, Any], sources: dict[str, str], auto: bool
    ) -> dict[str, Any]:
        """Reads are performed for real, writes are only previewed; then the policy decides."""
        error: str | None = None
        try:
            tool.validate(args)
            preview = tool.simulate(conn, args)
        except Exception as e:  # any adapter failure during preview blocks the item
            error = str(e) or e.__class__.__name__
            preview = {"summary": f"Invalid arguments: {error}", "error": error}
        a = assess(tool, args, sources, auto_approve_low_risk=auto, simulation_error=error)
        status = "blocked" if a.blocked else "pending_approval" if a.decision_required else "auto_approved"
        h = args_hash(tool.name, args)
        auto_ok = status == "auto_approved"
        return {
            "args_hash": h,
            "preview": preview,
            "risk": a.risk,
            "decision_required": a.decision_required,
            "flags": a.flags,
            "status": status,
            "approved_hash": h if auto_ok else None,
            "approved_by": "policy" if auto_ok else None,
            "approval_mode": "policy" if auto_ok else None,
        }

    def create_run(self, body: RunCreate) -> dict[str, Any]:
        unknown = sorted({a.tool for a in body.actions if self.registry.get(a.tool) is None})
        if unknown:
            raise ApiError(422, "unknown_tool", f"unknown tool(s): {', '.join(unknown)}; see GET /v1/tools")
        for action in body.actions:
            _check_serializable(action.args, action.node_id)

        run_id = f"run_{secrets.token_hex(8)}"
        ts = now_iso()
        with self._lock, self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO runs (id, goal, status, auto_approve_low_risk, done_criteria, created_at, updated_at)"
                " VALUES (?, ?, 'awaiting_approval', ?, ?, ?, ?)",
                (run_id, body.goal, int(body.auto_approve_low_risk), dumps(body.done_criteria), ts, ts),
            )
            for seq, action in enumerate(body.actions):
                tool = self.registry.get(action.tool)
                assert tool is not None
                sources = {k: v for k, v in action.arg_sources.items() if k in action.args}
                shadow = self._shadow(conn, tool, action.args, sources, body.auto_approve_low_risk)
                conn.execute(
                    "INSERT INTO run_items (run_id, node_id, seq, tool, args, arg_sources, args_hash, preview, risk,"
                    " decision_required, flags, status, approved_hash, approved_by, approval_mode)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        run_id,
                        action.node_id,
                        seq,
                        tool.name,
                        dumps(action.args),
                        dumps(sources),
                        shadow["args_hash"],
                        dumps(shadow["preview"]),
                        shadow["risk"],
                        int(shadow["decision_required"]),
                        dumps(shadow["flags"]),
                        shadow["status"],
                        shadow["approved_hash"],
                        shadow["approved_by"],
                        shadow["approval_mode"],
                    ),
                )
            status = _derive_status(self._items(conn, run_id), decided=False)
            self._set_run(conn, run_id, status=status)
            self._event(conn, run_id, "run.created", {"status": status, "actions": len(body.actions)})
            return self._serialize(conn, run_id)

    # ------------------------------------------------------------------------------------------
    # Approval and edits
    # ------------------------------------------------------------------------------------------
    def decide(self, run_id: str, body: DecisionRequest) -> dict[str, Any]:
        with self._lock, self.db.transaction() as conn:
            run = self._run_row(conn, run_id)
            if run["status"] not in PRE_EXECUTION:
                raise conflict("invalid_state", f"run is {run['status']}; decisions are accepted only before execution")
            items = self._items(conn, run_id)
            decision = {
                "decision": body.decision,
                "reviewer": body.reviewer,
                "approved_hashes": body.approved_hashes,
                "note": body.note,
                "decided_at": now_iso(),
            }
            if body.decision == "reject":
                for item in items:
                    self._set_item(conn, run_id, item["node_id"], status="rejected")
                status = "rejected"
            else:
                by_hash = {i["args_hash"]: i for i in items}
                stale = [h for h in body.approved_hashes if h not in by_hash]
                if stale:
                    raise conflict(
                        "stale_approval",
                        f"{len(stale)} approved hash(es) do not match the current plan; re-review the latest diff",
                    )
                blocked = sorted(
                    {by_hash[h]["node_id"] for h in body.approved_hashes if by_hash[h]["status"] == "blocked"}
                )
                if blocked:
                    raise conflict("item_blocked", f"blocked item(s) cannot be approved: {', '.join(blocked)}")
                approved = set(body.approved_hashes)
                for item in items:
                    if item["status"] != "pending_approval":
                        continue
                    if item["args_hash"] in approved:
                        self._set_item(
                            conn,
                            run_id,
                            item["node_id"],
                            status="approved",
                            approved_hash=item["args_hash"],
                            approved_by=body.reviewer,
                            approval_mode="human",
                        )
                    else:
                        self._set_item(conn, run_id, item["node_id"], status="declined")
                status = _derive_status(self._items(conn, run_id), decided=True)
            self._set_run(conn, run_id, status=status, decision=decision)
            self._event(conn, run_id, "decision", {**decision, "status": status})
            return self._serialize(conn, run_id)

    def edit(self, run_id: str, body: EditRequest) -> dict[str, Any]:
        _check_serializable(body.args, body.node_id)
        with self._lock, self.db.transaction() as conn:
            run = self._run_row(conn, run_id)
            if run["status"] not in PRE_EXECUTION:
                raise conflict("invalid_state", f"run is {run['status']}; edits are accepted only before execution")
            item = next((i for i in self._items(conn, run_id) if i["node_id"] == body.node_id), None)
            if item is None:
                raise not_found(f"node '{body.node_id}'")
            tool = self.registry.get(item["tool"])
            assert tool is not None
            old_args, old_sources = item["args"], item["arg_sources"]
            if body.arg_sources is not None:
                sources = {k: v for k, v in body.arg_sources.items() if k in body.args}
            else:  # values the reviewer changed are reviewer-supplied, i.e. trusted
                sources = {
                    k: old_sources.get(k, "user") if k in old_args and old_args[k] == v else "user"
                    for k, v in body.args.items()
                }
                sources = {k: v for k, v in sources.items() if v != "user" or k in old_sources}
            if args_hash(tool.name, body.args) == item["args_hash"] and sources == old_sources:
                return self._serialize(conn, run_id)

            shadow = self._shadow(conn, tool, body.args, sources, bool(run["auto_approve_low_risk"]))
            self._set_item(
                conn,
                run_id,
                body.node_id,
                args=dumps(body.args),
                arg_sources=dumps(sources),
                args_hash=shadow["args_hash"],
                preview=dumps(shadow["preview"]),
                risk=shadow["risk"],
                decision_required=int(shadow["decision_required"]),
                flags=dumps(shadow["flags"]),
                status=shadow["status"],
                approved_hash=shadow["approved_hash"],
                approved_by=shadow["approved_by"],
                approval_mode=shadow["approval_mode"],
            )
            status = _derive_status(self._items(conn, run_id), decided=False)
            self._set_run(conn, run_id, status=status)
            self._event(
                conn,
                run_id,
                "item.edited",
                {
                    "node_id": body.node_id,
                    "old_args_hash": item["args_hash"],
                    "new_args_hash": shadow["args_hash"],
                    "old_args": old_args,
                    "new_args": body.args,
                    "item_status": shadow["status"],
                    "status": status,
                },
            )
            return self._serialize(conn, run_id)

    # ------------------------------------------------------------------------------------------
    # Execution through the effect ledger
    # ------------------------------------------------------------------------------------------
    def execute_effects(self, run_id: str) -> bool:
        """Execute approved items in order. Returns False if the run already executed (idempotent replay)."""
        with self._lock:
            with self.db.transaction() as conn:
                run = self._run_row(conn, run_id)
                if run["status"] == "rejected":
                    raise conflict("invalid_state", "run was rejected; nothing will be executed")
                if run["status"] in TERMINAL or run["status"] == "executing":
                    # Exactly-once: a repeated execute never re-runs effects; it replays the ledger.
                    count = conn.execute("SELECT COUNT(*) FROM effects WHERE run_id = ?", (run_id,)).fetchone()[0]
                    self._event(
                        conn,
                        run_id,
                        "execute.replayed",
                        {"status": run["status"], "effects": count, "new_effects": 0},
                    )
                    return False
                if run["status"] != "approved":
                    raise conflict("not_approved", f"run is {run['status']}; it must be approved before execution")
                self._set_run(conn, run_id, status="executing")
                self._event(conn, run_id, "execution.started", {})
                items = self._items(conn, run_id)

            halted = False
            for item in items:
                if item["status"] not in EXECUTABLE:
                    continue
                if halted:
                    with self.db.transaction() as conn:
                        self._set_item(conn, run_id, item["node_id"], status="skipped")
                    continue
                halted = not self._execute_item(run_id, item)

            # Verify every executed effect against the committed sandbox state.
            with self.db.transaction() as conn:
                for effect in self._effects(conn, run_id):
                    if effect["status"] != "executed":
                        continue
                    tool = self.registry.get(effect["tool"])
                    try:
                        ok = bool(tool and tool.verify(conn, effect["args"], effect["result"]))
                    except Exception:
                        ok = False
                    conn.execute("UPDATE effects SET verified = ? WHERE id = ?", (int(ok), effect["id"]))
        return True

    def _execute_item(self, run_id: str, item: dict[str, Any]) -> bool:
        node_id = item["node_id"]
        with self.db.transaction() as conn:
            if item["approved_hash"] != item["args_hash"]:
                self._set_item(conn, run_id, node_id, status="failed")
                self._event(conn, run_id, "effect.refused", {"node_id": node_id, "reason": "approval_hash_mismatch"})
                return False
            existing = conn.execute(
                "SELECT status FROM effects WHERE run_id = ? AND node_id = ? AND args_hash = ?",
                (run_id, node_id, item["args_hash"]),
            ).fetchone()
            if existing is not None:  # ledger hit: this exact effect already happened
                self._set_item(conn, run_id, node_id, status=existing["status"])
                self._event(conn, run_id, "effect.deduplicated", {"node_id": node_id, "args_hash": item["args_hash"]})
                return existing["status"] == "executed"

            tool = self.registry.get(item["tool"])
            assert tool is not None
            conn.execute("SAVEPOINT effect")
            try:
                result, error, status = tool.execute(conn, item["args"]), None, "executed"
                conn.execute("RELEASE SAVEPOINT effect")
            except Exception as e:
                conn.execute("ROLLBACK TO SAVEPOINT effect")
                conn.execute("RELEASE SAVEPOINT effect")
                result, error, status = None, str(e) or e.__class__.__name__, "failed"
            conn.execute(
                "INSERT INTO effects (run_id, node_id, args_hash, tool, args, status, result, error, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    node_id,
                    item["args_hash"],
                    tool.name,
                    dumps(item["args"]),
                    status,
                    dumps(result) if result is not None else None,
                    error,
                    now_iso(),
                ),
            )
            self._set_item(conn, run_id, node_id, status=status)
            self._event(
                conn,
                run_id,
                f"effect.{status}",
                {"node_id": node_id, "tool": tool.name, "args_hash": item["args_hash"], "error": error},
            )
            return status == "executed"

    def finalize(self, run_id: str, verification: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self.db.transaction() as conn:
            items = self._items(conn, run_id)
            executed = [i for i in items if i["status"] == "executed"]
            if not executed:
                status = "failed"
            elif len(executed) == len(items) and verification["passed"]:
                status = "completed"
            else:
                status = "partially_completed"
            self._set_run(conn, run_id, status=status, verification=verification)
            self._event(conn, run_id, "run.finalized", {"status": status, "verified": verification["passed"]})
            return self._serialize(conn, run_id)

    # ------------------------------------------------------------------------------------------
    # Undo
    # ------------------------------------------------------------------------------------------
    def undo(self, run_id: str) -> dict[str, Any]:
        with self._lock, self.db.transaction() as conn:
            run = self._run_row(conn, run_id)
            if run["status"] == "compensated":
                return self._serialize(conn, run_id)
            if run["status"] not in FINISHED:
                raise conflict("not_undoable", f"run is {run['status']}; only executed runs can be undone")
            summary: dict[str, list[str]] = {"compensated": [], "not_reversible": [], "failed": []}
            for effect in reversed(self._effects(conn, run_id)):  # newest first
                if effect["status"] != "executed" or effect["undo_status"] is not None:
                    continue
                tool = self.registry.get(effect["tool"])
                if tool is None or tool.kind == "read":
                    continue
                if not tool.reversible:
                    undo_status = "not_reversible"
                    try:
                        undo_result = tool.refuse_undo(conn, effect["args"], effect["result"] or {})
                    except Exception:
                        undo_result = {"reversible": False, "reason": f"{tool.name} cannot be undone"}
                else:
                    conn.execute("SAVEPOINT undo")
                    try:
                        undo_result = tool.compensate(conn, effect["args"], effect["result"])
                        undo_status = "compensated"
                        conn.execute("RELEASE SAVEPOINT undo")
                        self._set_item(conn, run_id, effect["node_id"], status="compensated")
                    except Exception as e:
                        conn.execute("ROLLBACK TO SAVEPOINT undo")
                        conn.execute("RELEASE SAVEPOINT undo")
                        undo_status, undo_result = "compensation_failed", {"error": str(e)}
                conn.execute(
                    "UPDATE effects SET undo_status = ?, undo_result = ?, undone_at = ? WHERE id = ?",
                    (undo_status, dumps(undo_result), now_iso(), effect["id"]),
                )
                key = {"compensated": "compensated", "not_reversible": "not_reversible"}.get(undo_status, "failed")
                summary[key].append(effect["node_id"])
            undo = {**summary, "undone_at": now_iso()}
            self._set_run(conn, run_id, status="compensated", undo=undo)
            self._event(conn, run_id, "run.compensated", undo)
            return self._serialize(conn, run_id)

    # ------------------------------------------------------------------------------------------
    # Audit
    # ------------------------------------------------------------------------------------------
    def audit(self, run_id: str) -> dict[str, Any]:
        with self.db.connect() as conn:
            run = self._serialize(conn, run_id)
            events = [
                {"type": r["type"], "data": loads(r["data"]), "at": r["created_at"]}
                for r in conn.execute("SELECT * FROM events WHERE run_id = ? ORDER BY id", (run_id,))
            ]
        decision = run["decision"]
        packet = {
            "schema": "adjutant.audit.v1",
            "run_id": run["id"],
            "goal": run["goal"],
            "status": run["status"],
            "created_at": run["created_at"],
            "plan": {
                "actions": [{k: i[k] for k in ("node_id", "tool", "args", "arg_sources")} for i in run["diff"]],
                "done_criteria": run["done_criteria"],
            },
            "diff": [
                {
                    k: i[k]
                    for k in (
                        "node_id",
                        "tool",
                        "args_hash",
                        "preview",
                        "risk",
                        "decision_required",
                        "flags",
                        "status",
                        "approved_hash",
                        "approved_by",
                    )
                }
                for i in run["diff"]
            ],
            "decision": decision,
            "reviewer": decision["reviewer"] if decision else None,
            "effects": [
                {
                    k: e[k]
                    for k in (
                        "node_id",
                        "tool",
                        "args_hash",
                        "status",
                        "result",
                        "error",
                        "verified",
                        "undo_status",
                        "undo_result",
                        "created_at",
                        "undone_at",
                    )
                }
                for e in run["effects"]
            ],
            "verification": run["verification"],
            "undo": run["undo"],
            "events": events,
        }
        key = self.settings.signing_key
        return {
            "packet": packet,
            "signature": hmac_sign(key, packet),
            "algorithm": "HMAC-SHA256",
            "key_id": key_id(key),
        }

    def verify_audit(self, packet: dict[str, Any], signature: str) -> dict[str, Any]:
        key = self.settings.signing_key
        try:
            valid = hmac_verify(key, packet, signature)
        except (TypeError, ValueError):
            valid = False
        return {"valid": valid, "algorithm": "HMAC-SHA256", "key_id": key_id(key)}

    # ------------------------------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------------------------------
    def get_run(self, run_id: str) -> dict[str, Any]:
        with self.db.connect() as conn:
            return self._serialize(conn, run_id)

    def list_runs(self, limit: int) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM runs ORDER BY rowid DESC LIMIT ?", (limit,)).fetchall()
            counts = {
                r["run_id"]: r
                for r in conn.execute(
                    "SELECT run_id, COUNT(*) AS total, SUM(approval_mode = 'policy') AS auto,"
                    " SUM(status = 'pending_approval') AS pending, SUM(status = 'blocked') AS blocked"
                    " FROM run_items GROUP BY run_id"
                )
            }
        out = []
        for row in rows:
            c = counts.get(row["id"])
            out.append(
                {
                    "id": row["id"],
                    "goal": row["goal"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "summary": {
                        "total": c["total"] if c else 0,
                        "auto_approved": (c["auto"] or 0) if c else 0,
                        "needs_approval": (c["pending"] or 0) if c else 0,
                        "blocked": (c["blocked"] or 0) if c else 0,
                    },
                }
            )
        return out

    def ledger(self, limit: int) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM effects ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return [self._effect_full(r) for r in rows]

    def stats(self) -> dict[str, Any]:
        with self.db.connect() as conn:
            by_status = {r[0]: r[1] for r in conn.execute("SELECT status, COUNT(*) FROM runs GROUP BY status")}
            effects = {r[0]: r[1] for r in conn.execute("SELECT status, COUNT(*) FROM effects GROUP BY status")}
            undo = {
                r[0]: r[1]
                for r in conn.execute(
                    "SELECT undo_status, COUNT(*) FROM effects WHERE undo_status IS NOT NULL GROUP BY undo_status"
                )
            }
            items = conn.execute(
                "SELECT COUNT(*) AS total, SUM(approval_mode = 'policy') AS auto,"
                " SUM(approval_mode = 'human') AS human, SUM(decision_required) AS gated,"
                " SUM(flags LIKE '%\"taint:%') AS taint, SUM(status = 'blocked') AS blocked FROM run_items"
            ).fetchone()
            verif = conn.execute(
                "SELECT SUM(json_extract(verification, '$.passed') = 1) AS ok,"
                " SUM(json_extract(verification, '$.passed') = 0) AS bad FROM runs WHERE verification IS NOT NULL"
            ).fetchone()
            by_tool = {
                r[0]: r[1]
                for r in conn.execute(
                    "SELECT tool, COUNT(*) FROM effects WHERE status = 'executed' GROUP BY tool ORDER BY 2 DESC, 1"
                )
            }
            today = datetime.now(UTC).date()
            days = [(today - timedelta(days=d)).isoformat() for d in range(6, -1, -1)]
            runs_per_day = dict(
                conn.execute(
                    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) FROM runs WHERE day >= ? GROUP BY day",
                    (days[0],),
                ).fetchall()
            )
            avoided_per_day = dict(
                conn.execute(
                    "SELECT substr(r.created_at, 1, 10) AS day, COUNT(*)"
                    " FROM run_items i JOIN runs r ON r.id = i.run_id"
                    " WHERE i.approval_mode = 'policy' AND day >= ? GROUP BY day",
                    (days[0],),
                ).fetchall()
            )
        runs_total = sum(by_status.values())
        actions_total = items["total"] or 0
        return {
            "runs_total": runs_total,
            "runs_by_status": by_status,
            "effects_total": sum(effects.values()),
            "effects_by_status": effects,
            "undo_by_status": undo,
            "actions_total": actions_total,
            "prompts_avoided": items["auto"] or 0,
            "human_approvals": items["human"] or 0,
            "approvals_required": items["gated"] or 0,
            "taint_blocks": items["taint"] or 0,
            "verified_runs": verif["ok"] or 0,
            "verification_failed_runs": verif["bad"] or 0,
            "effects_compensated": undo.get("compensated", 0),
            "blocked_items": items["blocked"] or 0,
            "avg_actions_per_run": round(actions_total / runs_total, 2) if runs_total else 0,
            "runs_last_7d": [
                {"day": d, "runs": runs_per_day.get(d, 0), "prompts_avoided": avoided_per_day.get(d, 0)} for d in days
            ],
            "by_tool": by_tool,
        }

    def activity(self, limit: int) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT e.id, e.run_id, e.type, e.data, e.created_at, r.goal FROM events e"
                " LEFT JOIN runs r ON r.id = e.run_id ORDER BY e.created_at DESC, e.id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "run_id": r["run_id"],
                "goal": r["goal"],
                "type": r["type"],
                "at": r["created_at"],
                "data": loads(r["data"]),
            }
            for r in rows
        ]

    # ------------------------------------------------------------------------------------------
    # Demo support
    # ------------------------------------------------------------------------------------------
    def reset(self) -> None:
        """Wipe runs, ledger, events and sandbox state; re-seed the sandbox."""
        with self._lock, self.db.transaction() as conn:
            for table in ("events", "effects", "run_items", "runs", "sandbox_objects"):
                conn.execute(f"DELETE FROM {table}")
            conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('events', 'effects')")
            sandbox.reset(conn)

    def backdate(self, run_id: str, since: str, hours_ago: float) -> None:
        """Shift a run (and the sandbox objects it created after `since`) back in time, for demo history."""
        delta = timedelta(hours=hours_ago)

        def shift(ts: str | None) -> str | None:
            if not ts:
                return ts
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) - delta
            return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")

        def shift_fields(obj: Any) -> Any:
            if not isinstance(obj, dict):
                return obj
            out = dict(obj)
            for k, v in obj.items():
                if k.endswith("_at") and isinstance(v, str):
                    with contextlib.suppress(ValueError):
                        out[k] = shift(v)
            return out

        with self._lock, self.db.transaction() as conn:
            row = self._run_row(conn, run_id)
            conn.execute(
                "UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?",
                (shift(row["created_at"]), shift(row["updated_at"]), run_id),
            )
            for r in conn.execute("SELECT id, created_at FROM events WHERE run_id = ?", (run_id,)).fetchall():
                conn.execute("UPDATE events SET created_at = ? WHERE id = ?", (shift(r["created_at"]), r["id"]))
            for r in conn.execute(
                "SELECT id, created_at, undone_at, result, undo_result FROM effects WHERE run_id = ?", (run_id,)
            ).fetchall():
                conn.execute(
                    "UPDATE effects SET created_at = ?, undone_at = ?, result = ?, undo_result = ? WHERE id = ?",
                    (
                        shift(r["created_at"]),
                        shift(r["undone_at"]),
                        r["result"] and dumps(shift_fields(loads(r["result"]))),
                        r["undo_result"] and dumps(shift_fields(loads(r["undo_result"]))),
                        r["id"],
                    ),
                )
            undo = loads(row["undo"])
            if undo:
                conn.execute("UPDATE runs SET undo = ? WHERE id = ?", (dumps(shift_fields(undo)), run_id))
            for key in ("decision", "verification"):
                value = loads(row[key])
                if value:
                    conn.execute(f"UPDATE runs SET {key} = ? WHERE id = ?", (dumps(shift_fields(value)), run_id))
            for r in conn.execute(
                "SELECT kind, id, data, created_at, updated_at FROM sandbox_objects WHERE created_at >= ?", (since,)
            ).fetchall():
                conn.execute(
                    "UPDATE sandbox_objects SET data = ?, created_at = ?, updated_at = ? WHERE kind = ? AND id = ?",
                    (
                        dumps(shift_fields(loads(r["data"]))),
                        shift(r["created_at"]),
                        shift(r["updated_at"]),
                        r["kind"],
                        r["id"],
                    ),
                )

    def sandbox_state(self) -> dict[str, Any]:
        with self.db.connect() as conn:
            objects = sandbox.list_objects(conn)
        return {kind: [o for o in objects if o["kind"] == kind] for kind in sandbox.KINDS}

    # ------------------------------------------------------------------------------------------
    # Storage helpers
    # ------------------------------------------------------------------------------------------
    def _run_row(self, conn: sqlite3.Connection, run_id: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            raise not_found(f"run '{run_id}'")
        return row

    def _items(self, conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
        rows = conn.execute("SELECT * FROM run_items WHERE run_id = ? ORDER BY seq", (run_id,)).fetchall()
        out = []
        for r in rows:
            tool = self.registry.get(r["tool"])
            out.append(
                {
                    "node_id": r["node_id"],
                    "seq": r["seq"],
                    "tool": r["tool"],
                    "kind": tool.kind if tool else None,
                    "reversible": tool.reversible if tool else None,
                    "args": loads(r["args"]),
                    "arg_sources": loads(r["arg_sources"]),
                    "args_hash": r["args_hash"],
                    "preview": loads(r["preview"]),
                    "risk": r["risk"],
                    "decision_required": bool(r["decision_required"]),
                    "flags": loads(r["flags"]),
                    "status": r["status"],
                    "approved_hash": r["approved_hash"],
                    "approved_by": r["approved_by"],
                    "approval_mode": r["approval_mode"],
                }
            )
        return out

    @staticmethod
    def _effect(r: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": r["id"],
            "run_id": r["run_id"],
            "node_id": r["node_id"],
            "tool": r["tool"],
            "args_hash": r["args_hash"],
            "args": loads(r["args"]),
            "status": r["status"],
            "result": loads(r["result"]),
            "error": r["error"],
            "verified": None if r["verified"] is None else bool(r["verified"]),
            "undo_status": r["undo_status"],
            "undo_result": loads(r["undo_result"]),
            "created_at": r["created_at"],
            "undone_at": r["undone_at"],
        }

    def _effect_full(self, r: sqlite3.Row) -> dict[str, Any]:
        e = self._effect(r)
        tool = self.registry.get(e["tool"])
        e["reversible"] = tool.reversible if tool else None
        e["compensation"] = e["undo_result"]
        return e

    def _effects(self, conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
        rows = conn.execute("SELECT * FROM effects WHERE run_id = ? ORDER BY id", (run_id,)).fetchall()
        return [self._effect_full(r) for r in rows]

    def _serialize(self, conn: sqlite3.Connection, run_id: str) -> dict[str, Any]:
        row = self._run_row(conn, run_id)
        items = self._items(conn, run_id)
        return {
            "id": row["id"],
            "goal": row["goal"],
            "status": row["status"],
            "auto_approve_low_risk": bool(row["auto_approve_low_risk"]),
            "done_criteria": loads(row["done_criteria"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "summary": {
                "total": len(items),
                "auto_approved": sum(1 for i in items if i["approval_mode"] == "policy"),
                "needs_approval": sum(1 for i in items if i["status"] == "pending_approval"),
                "blocked": sum(1 for i in items if i["status"] == "blocked"),
            },
            "diff": items,
            "decision": loads(row["decision"]),
            "verification": loads(row["verification"]),
            "undo": loads(row["undo"]),
            "effects": self._effects(conn, run_id),
            "events": self._events(conn, run_id),
        }

    @staticmethod
    def _events(conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
        return [
            {"id": r["id"], "type": r["type"], "at": r["created_at"], "data": loads(r["data"])}
            for r in conn.execute("SELECT * FROM events WHERE run_id = ? ORDER BY id", (run_id,))
        ]

    _RUN_COLUMNS = frozenset({"status", "decision", "verification", "undo"})
    _ITEM_COLUMNS = frozenset(
        {
            "args",
            "arg_sources",
            "args_hash",
            "preview",
            "risk",
            "decision_required",
            "flags",
            "status",
            "approved_hash",
            "approved_by",
            "approval_mode",
        }
    )

    def _set_run(self, conn: sqlite3.Connection, run_id: str, **fields: Any) -> None:
        assert set(fields) <= self._RUN_COLUMNS
        values = {k: (dumps(v) if k in ("decision", "verification", "undo") else v) for k, v in fields.items()}
        values["updated_at"] = now_iso()
        assignments = ", ".join(f"{k} = ?" for k in values)
        conn.execute(f"UPDATE runs SET {assignments} WHERE id = ?", (*values.values(), run_id))

    def _set_item(self, conn: sqlite3.Connection, run_id: str, node_id: str, **fields: Any) -> None:
        assert set(fields) <= self._ITEM_COLUMNS
        assignments = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE run_items SET {assignments} WHERE run_id = ? AND node_id = ?", (*fields.values(), run_id, node_id)
        )

    @staticmethod
    def _event(conn: sqlite3.Connection, run_id: str, type_: str, data: dict[str, Any]) -> None:
        conn.execute(
            "INSERT INTO events (run_id, type, data, created_at) VALUES (?, ?, ?, ?)",
            (run_id, type_, dumps(data), now_iso()),
        )
