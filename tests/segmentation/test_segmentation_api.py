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

    monkeypatch.setattr(
        "auralia_api.attribution.service.extract_character_roster",
        lambda **kwargs: (
            [
                {"canonical_name": "Harry", "aliases": ["Harry"], "descriptor": ""},
                {"canonical_name": "Ron", "aliases": ["Ron"], "descriptor": ""},
            ],
            {"prompt_eval_count": 0, "eval_count": 0, "duration_ms": 0},
        ),
    )
    attr = client.post("/api/attribute", json={"document_id": doc_id})
    assert attr.status_code == 201
    dialogue_count = sum(1 for s in first_spans if s["type"] == "dialogue")

    forced = client.post(
        "/api/segment?force=true", json={"document_id": doc_id}
    )
    assert forced.status_code == 201, forced.text
    wipe = forced.json()["force_wipe"]
    assert wipe == {
        "spans_deleted": len(first_spans),
        "attributions_cascaded": dialogue_count,
    }

    with sqlite3.connect(db_path) as conn:
        attr_rows = conn.execute("SELECT COUNT(*) FROM attributions").fetchone()[0]
    assert attr_rows == 0


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
