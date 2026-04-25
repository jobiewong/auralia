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


def test_detect_cast_endpoint_persists_deterministic_speakers(monkeypatch, tmp_path):
    client = _client_with_db(monkeypatch, tmp_path / "auralia.sqlite")
    ingest = client.post(
        "/api/ingest/text",
        json={
            "text": '"Hi," Dumbledore replied. "Yes," Remus said.',
            "source_id": "inline:cast-test",
            "chapter_id": "ch_01",
            "title": "Chapter",
        },
    )
    assert ingest.status_code == 201, ingest.text
    document_id = ingest.json()["cleaned_document"]["id"]
    segment = client.post("/api/segment", json={"document_id": document_id})
    assert segment.status_code == 201, segment.text

    response = client.post("/api/detect-cast", json={"document_id": document_id})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["cast_detection_job"]["status"] == "completed"
    assert body["cast_detection_job"]["stats"]["deterministic_candidates"] == 2
    assert {row["canonical_name"] for row in body["cast"]} == {
        "Dumbledore",
        "Remus",
    }


def test_detect_cast_endpoint_conflicts_when_cast_exists(monkeypatch, tmp_path):
    client = _client_with_db(monkeypatch, tmp_path / "auralia.sqlite")
    ingest = client.post(
        "/api/ingest/text",
        json={
            "text": '"Hi," Dumbledore replied.',
            "source_id": "inline:cast-test",
            "chapter_id": "ch_01",
            "title": "Chapter",
        },
    )
    document_id = ingest.json()["cleaned_document"]["id"]
    client.post("/api/segment", json={"document_id": document_id})
    first = client.post("/api/detect-cast", json={"document_id": document_id})
    assert first.status_code == 201

    second = client.post("/api/detect-cast", json={"document_id": document_id})

    assert second.status_code == 409


def test_detect_cast_endpoint_force_resets_downstream_and_preserves_manual_cast(
    monkeypatch, tmp_path
):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    ingest = client.post(
        "/api/ingest/text",
        json={
            "text": '"Hi," Dumbledore replied. "Yes," Remus said.',
            "source_id": "inline:cast-test",
            "chapter_id": "ch_01",
            "title": "Chapter",
        },
    )
    assert ingest.status_code == 201, ingest.text
    document_id = ingest.json()["cleaned_document"]["id"]
    segment = client.post("/api/segment", json={"document_id": document_id})
    assert segment.status_code == 201, segment.text
    first_spans = segment.json()["spans"]

    first_cast = client.post("/api/detect-cast", json={"document_id": document_id})
    assert first_cast.status_code == 201, first_cast.text
    dialogue_count = sum(1 for span in first_spans if span["type"] == "dialogue")

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
                    "Dumbledore",
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
            ("attr_job_1", document_id, "completed", None, "{}", None),
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
                "manual_cast_minerva",
                document_id,
                "Minerva",
                '["Minerva"]',
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
            ("syn_job_1", document_id, "completed"),
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
        "/api/detect-cast?force=true", json={"document_id": document_id}
    )
    assert forced.status_code == 201, forced.text
    wipe = forced.json()["force_wipe"]
    assert wipe["attributions_deleted"] == dialogue_count
    assert wipe["attribution_jobs_deleted"] == 1
    assert wipe["cast_evidence_deleted"] == len(first_cast.json()["evidence"])
    assert wipe["generated_cast_deleted"] == len(first_cast.json()["cast"])
    assert wipe["synthesis_jobs_deleted"] == 1
    assert wipe["synthesis_segments_deleted"] == 1

    with sqlite3.connect(db_path) as conn:
        attr_rows = conn.execute("SELECT COUNT(*) FROM attributions").fetchone()[0]
        attr_jobs = conn.execute("SELECT COUNT(*) FROM attribution_jobs").fetchone()[0]
        synthesis_jobs = conn.execute(
            "SELECT COUNT(*) FROM synthesis_jobs"
        ).fetchone()[0]
        synthesis_segments = conn.execute(
            "SELECT COUNT(*) FROM synthesis_segments"
        ).fetchone()[0]
        manual_row = conn.execute(
            """
            SELECT canonical_name, manually_edited, manually_deleted
            FROM document_cast_members
            WHERE document_id = ? AND canonical_name = 'Minerva'
            """,
            (document_id,),
        ).fetchone()

    assert attr_rows == 0
    assert attr_jobs == 0
    assert synthesis_jobs == 0
    assert synthesis_segments == 0
    assert manual_row == ("Minerva", 1, 0)


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
