"""Sandbox state for the simulated tool adapters, persisted in SQLite so effects and undo are visible."""

from __future__ import annotations

import sqlite3
from typing import Any

from .canonical import now_iso
from .db import dumps, loads

SEED_CRM_RECORDS: dict[str, dict[str, Any]] = {
    "acct-1001": {"name": "Acme Supplies", "stage": "prospect", "owner": "dana@ourco.example", "arr": 0},
    "acct-1002": {"name": "Globex Logistics", "stage": "negotiation", "owner": "lee@ourco.example", "arr": 48000},
    "acct-1003": {"name": "Initech", "stage": "customer", "owner": "sam@ourco.example", "arr": 120000},
}

KINDS = ("email", "slack_message", "crm_record", "calendar_event")


def seed(conn: sqlite3.Connection) -> None:
    for record_id, data in SEED_CRM_RECORDS.items():
        ts = now_iso()
        conn.execute(
            "INSERT OR IGNORE INTO sandbox_objects (kind, id, data, status, created_at, updated_at)"
            " VALUES ('crm_record', ?, ?, 'active', ?, ?)",
            (record_id, dumps(data), ts, ts),
        )


def insert(conn: sqlite3.Connection, kind: str, obj_id: str, data: dict[str, Any], status: str) -> None:
    ts = now_iso()
    conn.execute(
        "INSERT INTO sandbox_objects (kind, id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (kind, obj_id, dumps(data), status, ts, ts),
    )


def get(conn: sqlite3.Connection, kind: str, obj_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM sandbox_objects WHERE kind = ? AND id = ?", (kind, obj_id)).fetchone()
    return _row(row) if row else None


def update(
    conn: sqlite3.Connection,
    kind: str,
    obj_id: str,
    *,
    data: dict[str, Any] | None = None,
    status: str | None = None,
) -> None:
    current = get(conn, kind, obj_id)
    if current is None:
        raise KeyError(f"{kind}/{obj_id}")
    conn.execute(
        "UPDATE sandbox_objects SET data = ?, status = ?, updated_at = ? WHERE kind = ? AND id = ?",
        (
            dumps(current["data"] if data is None else data),
            current["status"] if status is None else status,
            now_iso(),
            kind,
            obj_id,
        ),
    )


def list_objects(conn: sqlite3.Connection, kind: str | None = None) -> list[dict[str, Any]]:
    if kind:
        rows = conn.execute("SELECT * FROM sandbox_objects WHERE kind = ? ORDER BY rowid", (kind,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM sandbox_objects ORDER BY kind, rowid").fetchall()
    return [_row(r) for r in rows]


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "kind": row["kind"],
        "id": row["id"],
        "data": loads(row["data"]),
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
