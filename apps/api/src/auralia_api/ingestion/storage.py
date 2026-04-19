from __future__ import annotations

import json
import sqlite3
from pathlib import Path

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  normalization TEXT NOT NULL,
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
"""


def _connect(sqlite_path: str) -> sqlite3.Connection:
    db_path = Path(sqlite_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(MIGRATION_SQL)
    return conn


def insert_document(*, sqlite_path: str, document: dict) -> None:
    with _connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO documents (
                id,
                source_id,
                chapter_id,
                title,
                text,
                text_length,
                normalization
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document["id"],
                document["source_id"],
                document["chapter_id"],
                document.get("title"),
                document["text"],
                document["text_length"],
                json.dumps(document["normalization"]),
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
