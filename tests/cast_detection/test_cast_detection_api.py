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


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
