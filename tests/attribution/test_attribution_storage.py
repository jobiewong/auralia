import sqlite3

from auralia_api.attribution.storage import (
    insert_attribution_job,
    insert_attributions,
)


def test_storage_inserts_attributions_and_job(tmp_path):
    db_path = tmp_path / "auralia.sqlite"

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
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
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE spans (
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
        """
    )
    conn.execute(
        """
        INSERT INTO documents (
            id,
            source_id,
            chapter_id,
            title,
            text,
            text_length,
            normalization,
            source_metadata
        )
        VALUES ('doc_1', 'inline:test', 'ch_01', 'Title', '"Hi"', 4, '{}', NULL)
        """
    )
    conn.execute(
        """
        INSERT INTO spans (id, document_id, type, text, start, end)
        VALUES ('span_1', 'doc_1', 'dialogue', '"Hi"', 0, 4)
        """
    )
    conn.commit()
    conn.close()

    insert_attributions(
        sqlite_path=str(db_path),
        attributions=[
            {
                "id": "attr_1",
                "span_id": "span_1",
                "speaker": "Harry",
                "speaker_confidence": 0.9,
                "needs_review": False,
            }
        ],
    )
    insert_attribution_job(
        sqlite_path=str(db_path),
        job_id="job_1",
        document_id="doc_1",
        status="completed",
        model_name="qwen3:8b",
        stats={"x": 1},
        error_report=None,
    )

    conn = sqlite3.connect(db_path)
    attr_count = conn.execute("SELECT COUNT(*) FROM attributions").fetchone()[0]
    job_count = conn.execute("SELECT COUNT(*) FROM attribution_jobs").fetchone()[0]
    conn.close()

    assert attr_count == 1
    assert job_count == 1
