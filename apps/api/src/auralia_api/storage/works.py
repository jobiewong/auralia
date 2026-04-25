from __future__ import annotations

import json
import re
import sqlite3
from uuid import uuid4

WORKS_SQL = """
CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  authors TEXT,
  source_metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_works_slug_unique ON works (slug);
CREATE INDEX IF NOT EXISTS idx_works_updated_at ON works (updated_at);
"""


def ensure_work_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(WORKS_SQL)
    document_cols = {
        row["name"] for row in conn.execute("PRAGMA table_info(documents);")
    }
    if "work_id" not in document_cols:
        conn.execute(
            "ALTER TABLE documents ADD COLUMN work_id TEXT "
            "REFERENCES works(id) ON DELETE SET NULL;"
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_work_id ON documents (work_id);"
    )
    backfill_document_works(conn)


def ensure_work_for_document(
    conn: sqlite3.Connection,
    *,
    document: dict,
) -> str:
    source_metadata = document.get("source_metadata")
    source_type = _work_source_type(document)
    source_id = document["source_id"] if source_type == "ao3" else document["id"]

    if source_type == "ao3":
        existing = conn.execute(
            "SELECT id FROM works WHERE source_type = ? AND source_id = ? LIMIT 1",
            (source_type, source_id),
        ).fetchone()
        if existing is not None:
            conn.execute(
                "UPDATE works SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (existing["id"],),
            )
            return str(existing["id"])

    title = _work_title(document)
    authors = _metadata_authors(source_metadata)
    work_id = f"work_{uuid4().hex[:12]}"
    slug = _unique_slug(conn, title)
    conn.execute(
        """
        INSERT INTO works (
          id, slug, title, source_type, source_id, authors, source_metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            work_id,
            slug,
            title,
            source_type,
            source_id,
            json.dumps(authors) if authors is not None else None,
            json.dumps(source_metadata) if source_metadata is not None else None,
        ),
    )
    return work_id


def touch_work_for_document(conn: sqlite3.Connection, *, document_id: str) -> None:
    conn.execute(
        """
        UPDATE works
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT work_id FROM documents WHERE id = ?)
        """,
        (document_id,),
    )


def backfill_document_works(conn: sqlite3.Connection) -> None:
    rows = list(
        conn.execute(
            """
            SELECT
              id,
              source_id,
              chapter_id,
              title,
              source_metadata,
              created_at,
              updated_at
            FROM documents
            WHERE work_id IS NULL
            ORDER BY created_at, id
            """
        )
    )
    if not rows:
        return

    ao3_groups: dict[str, list[sqlite3.Row]] = {}
    text_rows: list[sqlite3.Row] = []
    for row in rows:
        document = dict(row)
        metadata = _parse_metadata(document.get("source_metadata"))
        document["source_metadata"] = metadata
        if _work_source_type(document) == "ao3":
            ao3_groups.setdefault(str(document["source_id"]), []).append(row)
        else:
            text_rows.append(row)

    for source_id, group_rows in ao3_groups.items():
        documents = []
        for row in group_rows:
            document = dict(row)
            document["source_metadata"] = _parse_metadata(
                document.get("source_metadata")
            )
            documents.append(document)
        work_id = _ensure_backfill_work(
            conn,
            documents[0],
            source_type="ao3",
            source_id=source_id,
        )
        updated_at = max(str(doc["updated_at"]) for doc in documents)
        conn.execute(
            "UPDATE works SET updated_at = ? WHERE id = ?",
            (updated_at, work_id),
        )
        conn.executemany(
            "UPDATE documents SET work_id = ? WHERE id = ?",
            [(work_id, str(doc["id"])) for doc in documents],
        )

    for row in text_rows:
        document = dict(row)
        document["source_metadata"] = _parse_metadata(document.get("source_metadata"))
        work_id = _ensure_backfill_work(
            conn,
            document,
            source_type="text",
            source_id=str(document["id"]),
        )
        conn.execute(
            "UPDATE works SET updated_at = ? WHERE id = ?",
            (str(document["updated_at"]), work_id),
        )
        conn.execute(
            "UPDATE documents SET work_id = ? WHERE id = ?",
            (work_id, str(document["id"])),
        )


def _ensure_backfill_work(
    conn: sqlite3.Connection,
    document: dict,
    *,
    source_type: str,
    source_id: str,
) -> str:
    existing = conn.execute(
        "SELECT id FROM works WHERE source_type = ? AND source_id = ? LIMIT 1",
        (source_type, source_id),
    ).fetchone()
    if existing is not None:
        return str(existing["id"])

    title = _work_title(document)
    authors = _metadata_authors(document.get("source_metadata"))
    work_id = f"work_{uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO works (
          id,
          slug,
          title,
          source_type,
          source_id,
          authors,
          source_metadata,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            work_id,
            _unique_slug(conn, title),
            title,
            source_type,
            source_id,
            json.dumps(authors) if authors is not None else None,
            json.dumps(document.get("source_metadata"))
            if document.get("source_metadata") is not None
            else None,
            document.get("created_at"),
            document.get("updated_at"),
        ),
    )
    return work_id


def _work_source_type(document: dict) -> str:
    metadata = document.get("source_metadata")
    if isinstance(metadata, str):
        metadata = _parse_metadata(metadata)
    if isinstance(metadata, dict) and metadata.get("source") == "ao3":
        return "ao3"
    if str(document.get("source_id", "")).startswith("ao3:work:"):
        return "ao3"
    return str(document.get("source_type") or "text")


def _work_title(document: dict) -> str:
    metadata = document.get("source_metadata")
    if isinstance(metadata, str):
        metadata = _parse_metadata(metadata)
    if isinstance(metadata, dict):
        work_title = metadata.get("work_title")
        if isinstance(work_title, str) and work_title.strip():
            return work_title.strip()
    for key in ("title", "source_id", "id"):
        value = document.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Untitled Work"


def _metadata_authors(metadata: object) -> object | None:
    if isinstance(metadata, str):
        metadata = _parse_metadata(metadata)
    if not isinstance(metadata, dict):
        return None
    authors = metadata.get("authors")
    return authors if authors is not None else None


def _parse_metadata(value: object) -> dict | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _unique_slug(conn: sqlite3.Connection, title: str) -> str:
    base = _slugify(title)
    slug = base
    suffix = 2
    while conn.execute(
        "SELECT 1 FROM works WHERE slug = ? LIMIT 1",
        (slug,),
    ).fetchone():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def _slugify(value: str) -> str:
    slug = value.lower()
    slug = slug.replace("&", " and ")
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "work"
