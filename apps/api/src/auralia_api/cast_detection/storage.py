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

CREATE TABLE IF NOT EXISTS cast_detection_jobs (
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
CREATE INDEX IF NOT EXISTS idx_cast_detection_jobs_document_status
  ON cast_detection_jobs (document_id, status);

CREATE TABLE IF NOT EXISTS document_cast_members (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  descriptor TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'deterministic',
  manually_edited INTEGER NOT NULL DEFAULT 0,
  manually_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_cast_members_document_name
  ON document_cast_members (document_id, canonical_name);

CREATE TABLE IF NOT EXISTS cast_member_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  cast_member_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  related_dialogue_span_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  surface_text TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cast_member_id) REFERENCES document_cast_members(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE,
  FOREIGN KEY (related_dialogue_span_id) REFERENCES spans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cast_member_evidence_member
  ON cast_member_evidence (cast_member_id);
"""


class DocumentNotFoundError(LookupError):
    pass


class AlreadyCastDetectedError(RuntimeError):
    pass


class CastRequiredError(RuntimeError):
    pass


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
    return {**dict(doc), "spans": [dict(row) for row in spans]}


def document_has_active_cast(*, sqlite_path: str, document_id: str) -> bool:
    with _connect(sqlite_path) as conn:
        row = conn.execute(
            """
            SELECT 1 FROM document_cast_members
            WHERE document_id = ? AND manually_deleted = 0
            LIMIT 1
            """,
            (document_id,),
        ).fetchone()
    return row is not None


def delete_generated_cast_for_document(
    *, sqlite_path: str, document_id: str
) -> int:
    with _connect(sqlite_path) as conn:
        cur = conn.execute(
            """
            DELETE FROM document_cast_members
            WHERE document_id = ? AND manually_edited = 0
            """,
            (document_id,),
        )
        deleted = cur.rowcount
        _sync_document_roster(conn, document_id=document_id)
        return deleted


def insert_cast_detection_job(
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
            INSERT INTO cast_detection_jobs (
                id, document_id, status, model_name, stats, error_report, completed_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                CASE
                    WHEN ? IN ('failed', 'completed') THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END
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


def update_cast_detection_job(
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
            UPDATE cast_detection_jobs
            SET status = ?,
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


def upsert_cast_members_with_evidence(
    *,
    sqlite_path: str,
    document_id: str,
    cast: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    with _connect(sqlite_path) as conn:
        deleted_names = _load_deleted_names(conn, document_id=document_id)
        for row in cast:
            canonical = str(row["canonical_name"]).strip()
            if not canonical or canonical.lower() in deleted_names:
                continue
            member_id = f"cast_{document_id}_{_slug(canonical)}"
            aliases = _normalize_aliases(row.get("aliases"), canonical)
            conn.execute(
                """
                INSERT INTO document_cast_members (
                    id, document_id, canonical_name, aliases, descriptor,
                    confidence, needs_review, source, manually_edited,
                    manually_deleted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                ON CONFLICT(document_id, canonical_name) DO UPDATE SET
                    aliases = CASE
                        WHEN document_cast_members.manually_edited = 1
                        THEN document_cast_members.aliases
                        ELSE excluded.aliases
                    END,
                    descriptor = CASE
                        WHEN document_cast_members.manually_edited = 1
                        THEN document_cast_members.descriptor
                        ELSE excluded.descriptor
                    END,
                    confidence = MAX(
                        document_cast_members.confidence,
                        excluded.confidence
                    ),
                    needs_review = CASE
                        WHEN document_cast_members.manually_edited = 1
                        THEN document_cast_members.needs_review
                        ELSE excluded.needs_review
                    END,
                    source = CASE
                        WHEN document_cast_members.source = excluded.source
                        THEN document_cast_members.source
                        ELSE document_cast_members.source || '_' || excluded.source
                    END,
                    manually_deleted = 0,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    member_id,
                    document_id,
                    canonical,
                    json.dumps(aliases),
                    str(row.get("descriptor") or ""),
                    float(row.get("confidence", 1.0)),
                    1 if row.get("needs_review") else 0,
                    str(row.get("source") or "deterministic"),
                ),
            )

        conn.execute(
            """
            DELETE FROM cast_member_evidence
            WHERE document_id = ?
              AND cast_member_id IN (
                SELECT id FROM document_cast_members
                WHERE document_id = ? AND manually_edited = 0
              )
            """,
            (document_id, document_id),
        )

        persisted_evidence: list[dict[str, Any]] = []
        for row in evidence:
            canonical = str(row["canonical_name"]).strip()
            member = conn.execute(
                """
                SELECT id FROM document_cast_members
                WHERE document_id = ? AND canonical_name = ? AND manually_deleted = 0
                """,
                (document_id, canonical),
            ).fetchone()
            if member is None:
                continue
            evidence_id = (
                f"castev_{member['id']}_{row['span_id']}_"
                f"{row['related_dialogue_span_id']}"
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO cast_member_evidence (
                    id, cast_member_id, document_id, span_id,
                    related_dialogue_span_id, evidence_type, surface_text,
                    evidence_text, confidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evidence_id,
                    member["id"],
                    document_id,
                    row["span_id"],
                    row["related_dialogue_span_id"],
                    row["evidence_type"],
                    row["surface_text"],
                    row["evidence_text"],
                    float(row.get("confidence", 1.0)),
                ),
            )
            persisted_evidence.append(
                {
                    "id": evidence_id,
                    "cast_member_id": member["id"],
                    "document_id": document_id,
                    "span_id": row["span_id"],
                    "related_dialogue_span_id": row["related_dialogue_span_id"],
                    "evidence_type": row["evidence_type"],
                    "surface_text": row["surface_text"],
                    "evidence_text": row["evidence_text"],
                    "confidence": float(row.get("confidence", 1.0)),
                }
            )

        _sync_document_roster(conn, document_id=document_id)
        touch_work_for_document(conn, document_id=document_id)
        active_cast = _load_active_cast(conn, document_id=document_id)
        return active_cast, persisted_evidence


def load_cast_roster(*, sqlite_path: str, document_id: str) -> list[dict[str, Any]]:
    with _connect(sqlite_path) as conn:
        cast = _load_active_cast(conn, document_id=document_id)
        if cast:
            return cast
        row = conn.execute(
            "SELECT roster FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if row is None:
            raise DocumentNotFoundError(f"document not found: {document_id}")
    return _parse_legacy_roster(row["roster"])


def require_cast_roster(*, sqlite_path: str, document_id: str) -> list[dict[str, Any]]:
    roster = load_cast_roster(sqlite_path=sqlite_path, document_id=document_id)
    if not roster:
        raise CastRequiredError(
            "document cast is empty; run cast detection before attribution"
        )
    return roster


def _load_deleted_names(conn: sqlite3.Connection, *, document_id: str) -> set[str]:
    return {
        str(row["canonical_name"]).lower()
        for row in conn.execute(
            """
            SELECT canonical_name FROM document_cast_members
            WHERE document_id = ? AND manually_deleted = 1
            """,
            (document_id,),
        )
    }


def _load_active_cast(
    conn: sqlite3.Connection, *, document_id: str
) -> list[dict[str, Any]]:
    return [
        _cast_row_to_dict(row)
        for row in conn.execute(
            """
            SELECT * FROM document_cast_members
            WHERE document_id = ? AND manually_deleted = 0
            ORDER BY canonical_name
            """,
            (document_id,),
        )
    ]


def _cast_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "document_id": row["document_id"],
        "canonical_name": row["canonical_name"],
        "aliases": _parse_aliases(row["aliases"]),
        "descriptor": row["descriptor"] or "",
        "confidence": float(row["confidence"]),
        "needs_review": bool(row["needs_review"]),
        "source": row["source"],
        "manually_edited": bool(row["manually_edited"]),
        "manually_deleted": bool(row["manually_deleted"]),
    }


def _sync_document_roster(conn: sqlite3.Connection, *, document_id: str) -> None:
    cast = _load_active_cast(conn, document_id=document_id)
    conn.execute(
        "UPDATE documents SET roster = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (_serialize_roster(cast), document_id),
    )


def _serialize_roster(cast: list[dict[str, Any]]) -> str:
    return json.dumps(
        {
            "characters": [
                {
                    "canonical_name": row["canonical_name"],
                    "aliases": row["aliases"],
                    "descriptor": row.get("descriptor", ""),
                }
                for row in cast
            ]
        }
    )


def _parse_legacy_roster(value: str | None) -> list[dict[str, Any]]:
    if not value:
        return []
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return []
    rows = payload if isinstance(payload, list) else payload.get("characters")
    if not isinstance(rows, list):
        return []
    cast: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        canonical = row.get("canonical_name")
        if not isinstance(canonical, str):
            canonical = row.get("canonicalName")
        if not isinstance(canonical, str):
            continue
        cast.append(
            {
                "canonical_name": canonical,
                "aliases": _parse_aliases(row.get("aliases")),
                "descriptor": row.get("descriptor") or "",
                "confidence": 1.0,
                "needs_review": False,
                "source": "legacy_roster",
            }
        )
    return cast


def _parse_aliases(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        value = parsed
    if not isinstance(value, list):
        return []
    return [str(alias) for alias in value if isinstance(alias, str)]


def _normalize_aliases(value: Any, canonical: str) -> list[str]:
    aliases = _parse_aliases(value)
    if canonical not in aliases:
        aliases.insert(0, canonical)
    return list(dict.fromkeys(alias.strip() for alias in aliases if alias.strip()))


def _slug(value: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in value).strip("_")
    return slug or "speaker"
