from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from auralia_api.storage.pipeline_resets import reset_synthesis_for_document
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

CREATE TABLE IF NOT EXISTS voices (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  control_text TEXT,
  reference_audio_path TEXT,
  prompt_audio_path TEXT,
  prompt_text TEXT,
  temperature REAL NOT NULL DEFAULT 0.9,
  is_canonical INTEGER NOT NULL DEFAULT 1,
  preview_audio_path TEXT,
  preview_sentence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (mode IN ('designed', 'clone', 'hifi_clone'))
);
CREATE INDEX IF NOT EXISTS idx_voices_display_name ON voices (display_name);
CREATE INDEX IF NOT EXISTS idx_voices_mode ON voices (mode);

CREATE TABLE IF NOT EXISTS voice_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (voice_id) REFERENCES voices(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_mappings_document_speaker_unique
  ON voice_mappings (document_id, speaker);
CREATE INDEX IF NOT EXISTS idx_voice_mappings_voice_id
  ON voice_mappings (voice_id);

CREATE TABLE IF NOT EXISTS synthesis_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output_path TEXT,
  manifest_path TEXT,
  stats TEXT,
  error_report TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'running', 'failed', 'completed'))
);
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_document_status
  ON synthesis_jobs (document_id, status);

CREATE TABLE IF NOT EXISTS synthesis_segments (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  cache_key TEXT,
  text_hash TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES synthesis_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE RESTRICT,
  FOREIGN KEY (voice_id) REFERENCES voices(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_synthesis_segments_job_start
  ON synthesis_segments (job_id, start);
"""


class DocumentNotFoundError(LookupError):
    pass


class SynthesisNotFoundError(LookupError):
    pass


class AlreadySynthesizedError(RuntimeError):
    pass


def connect(sqlite_path: str) -> sqlite3.Connection:
    db_path = Path(sqlite_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(MIGRATION_SQL)
    _add_columns_if_missing(conn)
    ensure_work_schema(conn)
    return conn


def existing_synthesis_job(
    *, sqlite_path: str, document_id: str
) -> dict[str, Any] | None:
    with connect(sqlite_path) as conn:
        row = conn.execute(
            """
            SELECT *
            FROM synthesis_jobs
            WHERE document_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (document_id,),
        ).fetchone()
        return _row_to_job(row) if row is not None else None


def reset_synthesis(*, sqlite_path: str, document_id: str) -> dict[str, int]:
    with connect(sqlite_path) as conn:
        counts = reset_synthesis_for_document(conn, document_id=document_id)
    return counts


def load_document_plan(*, sqlite_path: str, document_id: str) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        document = conn.execute(
            "SELECT id, source_id, chapter_id, title, text FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if document is None:
            raise DocumentNotFoundError(f"document not found: {document_id}")
        spans = [
            dict(row)
            for row in conn.execute(
                """
                SELECT
                  s.id,
                  s.type,
                  s.text,
                  s.start,
                  s.end,
                  a.speaker,
                  a.speaker_confidence,
                  a.needs_review
                FROM spans s
                LEFT JOIN attributions a ON a.span_id = s.id
                WHERE s.document_id = ?
                ORDER BY s.start
                """,
                (document_id,),
            )
        ]
        mappings = {
            row["speaker"]: dict(row)
            for row in conn.execute(
                """
                SELECT
                  vm.speaker,
                  v.*
                FROM voice_mappings vm
                INNER JOIN voices v ON v.id = vm.voice_id
                WHERE vm.document_id = ?
                """,
                (document_id,),
            )
        }

    return {"document": dict(document), "spans": spans, "mappings": mappings}


def insert_synthesis_job(
    *, sqlite_path: str, job_id: str, document_id: str, status: str
) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO synthesis_jobs (
              id, document_id, status, created_at, updated_at
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (job_id, document_id, status),
        )
        touch_work_for_document(conn, document_id=document_id)
        row = conn.execute(
            "SELECT * FROM synthesis_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        assert row is not None
        return _row_to_job(row)


def update_synthesis_job(
    *,
    sqlite_path: str,
    job_id: str,
    status: str,
    output_path: str | None = None,
    manifest_path: str | None = None,
    stats: dict[str, Any] | None = None,
    error_report: dict[str, Any] | None = None,
) -> None:
    with connect(sqlite_path) as conn:
        conn.execute(
            """
            UPDATE synthesis_jobs
            SET
              status = ?,
              output_path = COALESCE(?, output_path),
              manifest_path = COALESCE(?, manifest_path),
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
                output_path,
                manifest_path,
                json.dumps(stats) if stats is not None else None,
                json.dumps(error_report) if error_report is not None else None,
                status,
                job_id,
            ),
        )
        job = conn.execute(
            "SELECT document_id FROM synthesis_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if job is not None:
            touch_work_for_document(conn, document_id=job["document_id"])


def insert_synthesis_segment(
    *,
    sqlite_path: str,
    segment: dict[str, Any],
) -> None:
    with connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO synthesis_segments (
              id,
              job_id,
              span_id,
              voice_id,
              audio_path,
              start,
              end,
              cache_key,
              text_hash,
              chunk_count,
              duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                segment["id"],
                segment["job_id"],
                segment["span_id"],
                segment["voice_id"],
                segment["audio_path"],
                segment["start"],
                segment["end"],
                segment.get("cache_key"),
                segment.get("text_hash"),
                segment.get("chunk_count", 1),
                segment.get("duration_ms"),
            ),
        )


def get_synthesis_segment(
    *, sqlite_path: str, job_id: str, span_id: str
) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        row = conn.execute(
            """
            SELECT *
            FROM synthesis_segments
            WHERE job_id = ? AND span_id = ?
            """,
            (job_id, span_id),
        ).fetchone()
    if row is None:
        raise SynthesisNotFoundError(
            f"synthesis segment not found: {job_id}/{span_id}"
        )
    return dict(row)


def get_synthesis_job(*, sqlite_path: str, job_id: str) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        row = conn.execute(
            "SELECT * FROM synthesis_jobs WHERE id = ?", (job_id,)
        ).fetchone()
    if row is None:
        raise SynthesisNotFoundError(f"synthesis job not found: {job_id}")
    return _row_to_job(row)


def _add_columns_if_missing(conn: sqlite3.Connection) -> None:
    job_cols = {
        row["name"] for row in conn.execute("PRAGMA table_info(synthesis_jobs);")
    }
    for column, ddl in {
        "manifest_path": "ALTER TABLE synthesis_jobs ADD COLUMN manifest_path TEXT",
        "stats": "ALTER TABLE synthesis_jobs ADD COLUMN stats TEXT",
        "error_report": "ALTER TABLE synthesis_jobs ADD COLUMN error_report TEXT",
        "completed_at": "ALTER TABLE synthesis_jobs ADD COLUMN completed_at TEXT",
    }.items():
        if column not in job_cols:
            conn.execute(ddl)

    segment_cols = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(synthesis_segments);")
    }
    for column, ddl in {
        "cache_key": "ALTER TABLE synthesis_segments ADD COLUMN cache_key TEXT",
        "text_hash": "ALTER TABLE synthesis_segments ADD COLUMN text_hash TEXT",
        "chunk_count": (
            "ALTER TABLE synthesis_segments ADD COLUMN "
            "chunk_count INTEGER NOT NULL DEFAULT 1"
        ),
        "duration_ms": "ALTER TABLE synthesis_segments ADD COLUMN duration_ms INTEGER",
    }.items():
        if column not in segment_cols:
            conn.execute(ddl)


def _row_to_job(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["stats"] = _parse_json(data.get("stats"))
    data["error_report"] = _parse_json(data.get("error_report"))
    return data


def _parse_json(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None
