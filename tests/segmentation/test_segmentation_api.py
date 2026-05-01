import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app


def _client_with_db(monkeypatch, db_path: Path) -> TestClient:
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(db_path))
    get_settings.cache_clear()
    return TestClient(app)


def _ingest(client: TestClient, text: str) -> str:
    response = client.post(
        "/api/ingest/text",
        json={
            "text": text,
            "source_id": "inline:seg-test",
            "chapter_id": "ch_01",
            "title": "Chapter",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["cleaned_document"]["id"]


def test_segment_endpoint_labels_dialogue_and_narration(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    text = 'Harry walked in. "Hello," he said. She smiled.'
    doc_id = _ingest(client, text)

    response = client.post("/api/segment", json={"document_id": doc_id})
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["segmentation_job"]["status"] == "completed"
    assert body["segmentation_job"]["model_name"] is None

    spans = body["spans"]
    assert [s["type"] for s in spans] == ["narration", "dialogue", "narration"]
    assert spans[0]["text"] == "Harry walked in. "
    assert spans[1]["text"] == '"Hello,"'
    assert spans[2]["text"] == " he said. She smiled."
    assert spans[0]["start"] == 0
    assert spans[-1]["end"] == len(text)


def test_segment_endpoint_persists_spans_and_job(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    text = '"First." Then something. "Second."'
    doc_id = _ingest(client, text)

    response = client.post("/api/segment", json={"document_id": doc_id})
    assert response.status_code == 201, response.text

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        span_rows = list(
            conn.execute(
                "SELECT type, text, start, end FROM spans "
                "WHERE document_id = ? ORDER BY start",
                (doc_id,),
            )
        )
        job_rows = list(
            conn.execute(
                "SELECT status, chunk_count, model_name, stats "
                "FROM segmentation_jobs WHERE document_id = ?",
                (doc_id,),
            )
        )

    assert [r["type"] for r in span_rows] == ["dialogue", "narration", "dialogue"]
    assert span_rows[0]["start"] == 0
    assert span_rows[-1]["end"] == len(text)

    assert len(job_rows) == 1
    assert job_rows[0]["status"] == "completed"
    assert job_rows[0]["chunk_count"] == 0
    assert job_rows[0]["model_name"] is None
    stats = json.loads(job_rows[0]["stats"])
    assert stats["method"] == "deterministic_quote_v1"
    assert stats["span_counts"] == {"total": 3, "narration": 1, "dialogue": 2}


def test_segment_endpoint_returns_404_for_missing_document(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post("/api/segment", json={"document_id": "doc_nope"})
    assert response.status_code == 404


def test_segment_endpoint_rejects_already_segmented(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest(client, "Alpha. Beta. Gamma.")

    first = client.post("/api/segment", json={"document_id": doc_id})
    assert first.status_code == 201
    second = client.post("/api/segment", json={"document_id": doc_id})
    assert second.status_code == 409


def test_segment_endpoint_force_rewipes_spans_and_cascades_attributions(
    monkeypatch, tmp_path
):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest(client, '"Hi," Harry said. "Yo," Ron replied.')

    first = client.post("/api/segment", json={"document_id": doc_id})
    assert first.status_code == 201
    first_spans = first.json()["spans"]
    assert first.json()["force_wipe"] is None

    cast = client.post("/api/detect-cast", json={"document_id": doc_id})
    assert cast.status_code == 201, cast.text

    dialogue_count = sum(1 for s in first_spans if s["type"] == "dialogue")

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE attribution_jobs (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                status TEXT NOT NULL,
                model_name TEXT,
                stats TEXT,
                error_report TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
            """
        )
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
                    f"attr_{span['id']}",
                    span["id"],
                    "Harry",
                    1.0,
                    0,
                )
                for span in first_spans
                if span["type"] == "dialogue"
            ],
        )
        conn.execute(
            """
            INSERT INTO attribution_jobs (
                id,
                document_id,
                status,
                model_name,
                stats,
                error_report
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("attr_job_1", doc_id, "completed", None, "{}", None),
        )
        conn.execute(
            """
            INSERT INTO document_cast_members (
                id,
                document_id,
                canonical_name,
                aliases,
                descriptor,
                confidence,
                needs_review,
                source,
                manually_edited,
                manually_deleted
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "manual_cast_hermione",
                doc_id,
                "Hermione",
                '["Hermione"]',
                "manual edit",
                1.0,
                0,
                "manual",
                1,
                0,
            ),
        )
        conn.execute(
            """
            INSERT INTO document_cast_members (
                id,
                document_id,
                canonical_name,
                aliases,
                descriptor,
                confidence,
                needs_review,
                source,
                manually_edited,
                manually_deleted
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "manual_cast_neville",
                doc_id,
                "Neville",
                '["Neville"]',
                "",
                1.0,
                0,
                "manual",
                1,
                1,
            ),
        )
        conn.execute(
            """
            CREATE TABLE synthesis_jobs (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                status TEXT NOT NULL,
                output_path TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE synthesis_segments (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                span_id TEXT NOT NULL,
                voice_id TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                start INTEGER NOT NULL,
                end INTEGER NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO synthesis_jobs (id, document_id, status) VALUES (?, ?, ?)",
            ("syn_job_1", doc_id, "completed"),
        )
        conn.execute(
            """
            INSERT INTO synthesis_segments (
                id, job_id, span_id, voice_id, audio_path, start, end
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "syn_seg_1",
                "syn_job_1",
                first_spans[0]["id"],
                "voice_1",
                "/tmp/audio.wav",
                0,
                1,
            ),
        )

    forced = client.post(
        "/api/segment?force=true", json={"document_id": doc_id}
    )
    assert forced.status_code == 201, forced.text
    wipe = forced.json()["force_wipe"]
    assert wipe["spans_deleted"] == len(first_spans)
    assert wipe["attributions_cascaded"] == dialogue_count
    assert wipe["attributions_deleted"] == dialogue_count
    assert wipe["attribution_jobs_deleted"] == 1
    assert wipe["cast_detection_jobs_deleted"] == 1
    assert wipe["cast_evidence_deleted"] == len(cast.json()["evidence"])
    assert wipe["generated_cast_deleted"] == len(cast.json()["cast"])
    assert wipe["synthesis_jobs_deleted"] == 1
    assert wipe["synthesis_segments_deleted"] == 1

    with sqlite3.connect(db_path) as conn:
        attr_rows = conn.execute("SELECT COUNT(*) FROM attributions").fetchone()[0]
        attr_jobs = conn.execute("SELECT COUNT(*) FROM attribution_jobs").fetchone()[0]
        cast_jobs = conn.execute(
            "SELECT COUNT(*) FROM cast_detection_jobs"
        ).fetchone()[0]
        synthesis_jobs = conn.execute(
            "SELECT COUNT(*) FROM synthesis_jobs"
        ).fetchone()[0]
        synthesis_segments = conn.execute(
            "SELECT COUNT(*) FROM synthesis_segments"
        ).fetchone()[0]
        cast_rows = conn.execute(
            """
            SELECT canonical_name, manually_deleted
            FROM document_cast_members
            WHERE document_id = ?
            ORDER BY canonical_name
            """,
            (doc_id,),
        ).fetchall()
    assert attr_rows == 0
    assert attr_jobs == 0
    assert cast_jobs == 0
    assert synthesis_jobs == 0
    assert synthesis_segments == 0
    assert cast_rows == [("Hermione", 0), ("Neville", 1)]


def test_segment_endpoint_handles_narration_only(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    text = "There was no dialogue here, only description."
    doc_id = _ingest(client, text)

    response = client.post("/api/segment", json={"document_id": doc_id})
    assert response.status_code == 201
    spans = response.json()["spans"]
    assert len(spans) == 1
    assert spans[0]["type"] == "narration"
    assert spans[0]["text"] == text


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
