from __future__ import annotations

import json
import sqlite3

from auralia_api.storage.works import ensure_work_schema


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE documents (
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
        """
    )
    return conn


def test_backfill_groups_ao3_chapters_by_source_id() -> None:
    conn = _connect()
    metadata = {
        "source": "ao3",
        "work_id": "123",
        "work_title": "The Work",
        "authors": [{"name": "Author", "url": "https://example.test/author"}],
    }
    conn.executemany(
        """
        INSERT INTO documents (
          id, source_id, chapter_id, title, text, text_length, normalization,
          source_metadata, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "doc_1",
                "ao3:work:123",
                "ch_1",
                "Chapter 1",
                "One",
                3,
                "{}",
                json.dumps(metadata),
                "2026-04-20 10:00:00",
            ),
            (
                "doc_2",
                "ao3:work:123",
                "ch_2",
                "Chapter 2",
                "Two",
                3,
                "{}",
                json.dumps(metadata),
                "2026-04-21 10:00:00",
            ),
        ],
    )

    ensure_work_schema(conn)

    works = conn.execute("SELECT * FROM works").fetchall()
    documents = conn.execute("SELECT DISTINCT work_id FROM documents").fetchall()
    assert len(works) == 1
    assert works[0]["title"] == "The Work"
    assert works[0]["updated_at"] == "2026-04-21 10:00:00"
    assert len(documents) == 1
    assert documents[0]["work_id"] == works[0]["id"]


def test_backfill_creates_one_work_per_plain_text_document_with_unique_slugs() -> None:
    conn = _connect()
    conn.executemany(
        """
        INSERT INTO documents (
          id, source_id, chapter_id, title, text, text_length, normalization,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "doc_1",
                "inline:text",
                "ch_1",
                "Same Title",
                "One",
                3,
                "{}",
                "2026-04-20 10:00:00",
            ),
            (
                "doc_2",
                "inline:text",
                "ch_1",
                "Same Title",
                "Two",
                3,
                "{}",
                "2026-04-21 10:00:00",
            ),
        ],
    )

    ensure_work_schema(conn)

    works = conn.execute(
        "SELECT title, slug FROM works ORDER BY updated_at DESC"
    ).fetchall()
    assert [row["title"] for row in works] == ["Same Title", "Same Title"]
    assert [row["slug"] for row in works] == ["same-title-2", "same-title"]
