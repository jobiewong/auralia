from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from auralia_api.storage.works import ensure_work_for_document, ensure_work_schema

# Dev-convenience bootstrap that mirrors the canonical Drizzle migrations
# under packages/db/drizzle/migrations/. Keep these in sync; Drizzle is the
# source of truth (see docs/migrations.md).
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

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  document_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_document_id
  ON ingestion_jobs (document_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs (status);
"""


def _connect(sqlite_path: str) -> sqlite3.Connection:
    db_path = Path(sqlite_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(MIGRATION_SQL)
    _ensure_documents_columns(conn)
    ensure_work_schema(conn)
    return conn


def _ensure_documents_columns(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(documents);")}
    if "source_metadata" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN source_metadata TEXT;")
    if "roster" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN roster TEXT;")


def insert_document(*, sqlite_path: str, document: dict) -> None:
    source_metadata = document.get("source_metadata")
    with _connect(sqlite_path) as conn:
        work_id = ensure_work_for_document(conn, document=document)
        conn.execute(
            """
            INSERT INTO documents (
                id,
                work_id,
                source_id,
                chapter_id,
                title,
                text,
                text_length,
                normalization,
                source_metadata
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document["id"],
                work_id,
                document["source_id"],
                document["chapter_id"],
                document.get("title"),
                document["text"],
                document["text_length"],
                json.dumps(document["normalization"]),
                json.dumps(source_metadata) if source_metadata is not None else None,
            ),
        )


def insert_ingestion_job(*, sqlite_path: str, job: dict) -> None:
    with _connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO ingestion_jobs (
                id,
                source_type,
                source_ref,
                status,
                document_id,
                error_message
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                job["id"],
                job["source_type"],
                job["source_ref"],
                job["status"],
                job.get("document_id"),
                job.get("error_message"),
            ),
        )
