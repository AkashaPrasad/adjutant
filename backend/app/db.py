"""SQLite storage (stdlib sqlite3, WAL). One short-lived connection per unit of work."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id                    TEXT PRIMARY KEY,
    goal                  TEXT NOT NULL,
    status                TEXT NOT NULL,
    auto_approve_low_risk INTEGER NOT NULL,
    done_criteria         TEXT NOT NULL,
    decision              TEXT,
    verification          TEXT,
    undo                  TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_items (
    run_id            TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_id           TEXT NOT NULL,
    seq               INTEGER NOT NULL,
    tool              TEXT NOT NULL,
    args              TEXT NOT NULL,
    arg_sources       TEXT NOT NULL,
    args_hash         TEXT NOT NULL,
    preview           TEXT,
    risk              TEXT NOT NULL,
    decision_required INTEGER NOT NULL,
    flags             TEXT NOT NULL,
    status            TEXT NOT NULL,
    approved_hash     TEXT,
    approved_by       TEXT,
    approval_mode     TEXT,
    PRIMARY KEY (run_id, node_id)
);

-- The effect ledger. UNIQUE(run_id, node_id, args_hash) is what makes execution exactly-once.
CREATE TABLE IF NOT EXISTS effects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL REFERENCES runs(id),
    node_id     TEXT NOT NULL,
    args_hash   TEXT NOT NULL,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,
    status      TEXT NOT NULL,
    result      TEXT,
    error       TEXT,
    verified    INTEGER,
    undo_status TEXT,
    undo_result TEXT,
    created_at  TEXT NOT NULL,
    undone_at   TEXT,
    UNIQUE (run_id, node_id, args_hash)
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT NOT NULL,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);

-- State of the simulated sandbox systems (outbox, slack, crm, calendar).
CREATE TABLE IF NOT EXISTS sandbox_objects (
    kind       TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       TEXT NOT NULL,
    status     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, id)
);
"""


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def loads(value: str | None) -> Any:
    return None if value is None else json.loads(value)


class Database:
    def __init__(self, path: str) -> None:
        self.path = path
        Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """BEGIN IMMEDIATE: takes the write lock up front so check-then-write is atomic."""
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
