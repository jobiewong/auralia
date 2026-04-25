from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from auralia_api.storage.works import ensure_work_schema, touch_work_for_document

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  normalization TEXT NOT NULL,
  source_metadata TEXT,
  roster TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CHECK (type IN ('narration', 'dialogue'))
);
CREATE INDEX IF NOT EXISTS idx_spans_document_offsets
  ON spans (document_id, start, end);

CREATE TABLE IF NOT EXISTS attributions (
  id TEXT PRIMARY KEY NOT NULL,
  span_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  speaker_confidence REAL NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attributions_span_id ON attributions (span_id);

CREATE TABLE IF NOT EXISTS attribution_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model_name TEXT,
  stats TEXT,
  error_report TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'running', 'failed', 'completed'))
);
CREATE INDEX IF NOT EXISTS idx_attribution_jobs_document_status
  ON attribution_jobs (document_id, status);
"""


class DocumentNotFoundError(LookupError):
    pass


class AlreadyAttributedError(RuntimeError):
    pass


def _connect(sqlite_path: str) -> sqlite3.Connection:
    db_path = Path(sqlite_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(MIGRATION_SQL)
    _ensure_documents_roster(conn)
    _ensure_attribution_jobs_completed_at(conn)
    ensure_work_schema(conn)
    return conn


def _ensure_documents_roster(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(documents);")}
    if "roster" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN roster TEXT;")


def _ensure_attribution_jobs_completed_at(conn: sqlite3.Connection) -> None:
    cols = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(attribution_jobs);")
    }
    if "completed_at" not in cols:
        conn.execute("ALTER TABLE attribution_jobs ADD COLUMN completed_at TEXT;")


def load_document_with_spans(*, sqlite_path: str, document_id: str) -> dict[str, Any]:
    with _connect(sqlite_path) as conn:
        doc = conn.execute(
            "SELECT id, source_id, chapter_id, title, text FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if doc is None:
            raise DocumentNotFoundError(f"document not found: {document_id}")

        spans = list(
            conn.execute(
                (
                    "SELECT id, type, text, start, end FROM spans "
                    "WHERE document_id = ? ORDER BY start"
                ),
                (document_id,),
            )
        )
        if not spans:
            raise DocumentNotFoundError(f"document spans not found: {document_id}")

    return {
        "id": doc["id"],
        "source_id": doc["source_id"],
        "chapter_id": doc["chapter_id"],
        "title": doc["title"],
        "text": doc["text"],
        "spans": [dict(s) for s in spans],
    }


def document_has_attributions(*, sqlite_path: str, document_id: str) -> bool:
    with _connect(sqlite_path) as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM attributions a
            JOIN spans s ON s.id = a.span_id
            WHERE s.document_id = ?
            LIMIT 1
            """,
            (document_id,),
        ).fetchone()
    return row is not None


def delete_attributions_for_document(
    *, sqlite_path: str, document_id: str
) -> int:
    """Delete all attribution rows tied to the document's spans. Returns count."""
    with _connect(sqlite_path) as conn:
        cur = conn.execute(
            """
            DELETE FROM attributions
            WHERE span_id IN (SELECT id FROM spans WHERE document_id = ?)
            """,
            (document_id,),
        )
        return cur.rowcount


def insert_attributions(
    *,
    sqlite_path: str,
    attributions: list[dict[str, Any]],
) -> None:
    if not attributions:
        return
    with _connect(sqlite_path) as conn:
        conn.executemany(
            """
            INSERT INTO attributions (
                id,
                span_id,
                speaker,
                speaker_confidence,
                needs_review
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    row["id"],
                    row["span_id"],
                    row["speaker"],
                    row["speaker_confidence"],
                    1 if row["needs_review"] else 0,
                )
                for row in attributions
            ],
        )


def save_document_roster(
    *,
    sqlite_path: str,
    document_id: str,
    roster: list[dict[str, Any]],
) -> None:
    with _connect(sqlite_path) as conn:
        conn.execute(
            "UPDATE documents SET roster = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ?",
            (json.dumps(roster), document_id),
        )
        touch_work_for_document(conn, document_id=document_id)


def insert_attribution_job(
    *,
    sqlite_path: str,
    job_id: str,
    document_id: str,
    status: str,
    model_name: str | None,
    stats: dict[str, Any] | None,
    error_report: dict[str, Any] | None,
) -> None:
    with _connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO attribution_jobs (
                id,
                document_id,
                status,
                model_name,
                stats,
                error_report,
                completed_at,
                created_at,
                updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                CASE
                    WHEN ? IN ('failed', 'completed') THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            """,
            (
                job_id,
                document_id,
                status,
                model_name,
                json.dumps(stats) if stats is not None else None,
                json.dumps(error_report) if error_report is not None else None,
                status,
            ),
        )


def update_attribution_job(
    *,
    sqlite_path: str,
    job_id: str,
    status: str,
    stats: dict[str, Any] | None,
    error_report: dict[str, Any] | None,
) -> None:
    with _connect(sqlite_path) as conn:
        conn.execute(
            """
            UPDATE attribution_jobs
            SET
                status = ?,
                stats = ?,
                error_report = ?,
                completed_at = CASE
                    WHEN ? IN ('failed', 'completed') THEN CURRENT_TIMESTAMP
                    ELSE completed_at
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                status,
                json.dumps(stats) if stats is not None else None,
                json.dumps(error_report) if error_report is not None else None,
                status,
                job_id,
            ),
        )
