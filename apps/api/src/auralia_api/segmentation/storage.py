from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

# Dev-convenience bootstrap mirroring the canonical Drizzle migrations at
# packages/db/drizzle/migrations/0000_m1_baseline.sql (spans table) and
# packages/db/drizzle/migrations/0003_m3_segmentation_jobs.sql. Keep in sync.
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

CREATE TABLE IF NOT EXISTS segmentation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  model_name TEXT,
  stats TEXT,
  error_report TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'running', 'failed', 'completed'))
);
CREATE INDEX IF NOT EXISTS idx_segmentation_jobs_document_status
  ON segmentation_jobs (document_id, status);
"""


class DocumentNotFoundError(LookupError):
    pass


class AlreadySegmentedError(RuntimeError):
    pass


def _connect(sqlite_path: str) -> sqlite3.Connection:
    db_path = Path(sqlite_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(MIGRATION_SQL)
    _ensure_documents_roster(conn)
    return conn


def _ensure_documents_roster(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(documents);")}
    if "roster" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN roster TEXT;")


def load_document(*, sqlite_path: str, document_id: str) -> dict[str, Any]:
    with _connect(sqlite_path) as conn:
        row = conn.execute(
            "SELECT id, source_id, chapter_id, title, text FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
    if row is None:
        raise DocumentNotFoundError(f"document not found: {document_id}")
    return dict(row)


def document_has_spans(*, sqlite_path: str, document_id: str) -> bool:
    with _connect(sqlite_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM spans WHERE document_id = ? LIMIT 1",
            (document_id,),
        ).fetchone()
    return row is not None


def delete_spans_for_document(
    *, sqlite_path: str, document_id: str
) -> tuple[int, int]:
    """Delete spans for a document. Returns (spans_deleted, attributions_cascaded).

    Attributions with a FK on span_id cascade-delete automatically via
    ON DELETE CASCADE. The count is captured before the delete for reporting.
    """
    with _connect(sqlite_path) as conn:
        attrs_row = conn.execute(
            """
            SELECT COUNT(*) FROM attributions a
            JOIN spans s ON s.id = a.span_id
            WHERE s.document_id = ?
            """,
            (document_id,),
        ).fetchone()
        attrs_count = int(attrs_row[0]) if attrs_row else 0
        cur = conn.execute(
            "DELETE FROM spans WHERE document_id = ?",
            (document_id,),
        )
        spans_count = cur.rowcount
    return spans_count, attrs_count


def insert_segmentation_job(
    *,
    sqlite_path: str,
    job_id: str,
    document_id: str,
    status: str,
    chunk_count: int,
    model_name: str | None,
    stats: dict[str, Any] | None,
    error_report: dict[str, Any] | None,
) -> None:
    with _connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO segmentation_jobs (
                id, document_id, status, chunk_count, model_name, stats, error_report
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                document_id,
                status,
                chunk_count,
                model_name,
                json.dumps(stats) if stats is not None else None,
                json.dumps(error_report) if error_report is not None else None,
            ),
        )


def insert_spans(
    *,
    sqlite_path: str,
    document_id: str,
    spans: list[dict[str, Any]],
) -> None:
    if not spans:
        return
    with _connect(sqlite_path) as conn:
        conn.executemany(
            """
            INSERT INTO spans (id, document_id, type, text, start, end)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    span["id"],
                    document_id,
                    span["type"],
                    span["text"],
                    span["start"],
                    span["end"],
                )
                for span in spans
            ],
        )
