from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app


def _client_with_db(monkeypatch, db_path: Path) -> TestClient:
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(db_path))
    get_settings.cache_clear()
    return TestClient(app)


def _ingest_and_segment(client: TestClient, text: str) -> str:
    ingest = client.post(
        "/api/ingest/text",
        json={
            "text": text,
            "source_id": "inline:attr-test",
            "chapter_id": "ch_01",
            "title": "Chapter",
        },
    )
    assert ingest.status_code == 201, ingest.text
    doc_id = ingest.json()["cleaned_document"]["id"]
    seg = client.post("/api/segment", json={"document_id": doc_id})
    assert seg.status_code == 201, seg.text
    return doc_id


def test_attribute_endpoint_happy_path(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said. "Yo," Ron replied.')

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

    response = client.post("/api/attribute", json={"document_id": doc_id})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["attribution_job"]["status"] == "completed"
    assert len(body["attributions"]) == 2


def test_attribute_endpoint_404_missing_document(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post("/api/attribute", json={"document_id": "doc_missing"})
    assert response.status_code == 404


def test_attribute_endpoint_409_already_attributed(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said.')

    monkeypatch.setattr(
        "auralia_api.attribution.service.extract_character_roster",
        lambda **kwargs: (
            [{"canonical_name": "Harry", "aliases": ["Harry"], "descriptor": ""}],
            {"prompt_eval_count": 0, "eval_count": 0, "duration_ms": 0},
        ),
    )

    first = client.post("/api/attribute", json={"document_id": doc_id})
    assert first.status_code == 201
    second = client.post("/api/attribute", json={"document_id": doc_id})
    assert second.status_code == 409


def test_attribute_endpoint_422_on_validator_failure(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said. "Yo," Harry replied.')

    monkeypatch.setattr(
        "auralia_api.attribution.service.extract_character_roster",
        lambda **kwargs: (
            [{"canonical_name": "Harry", "aliases": ["Harry"], "descriptor": ""}],
            {"prompt_eval_count": 0, "eval_count": 0, "duration_ms": 0},
        ),
    )

    monkeypatch.setattr(
        "auralia_api.attribution.service._merge_attributions",
        lambda **kwargs: [],
    )

    response = client.post("/api/attribute", json={"document_id": doc_id})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["message"] == "attribution output failed validation"
    assert "report" in detail


def test_attribute_endpoint_502_on_ollama_unavailable(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," he said.')

    def _raise_ollama(**kwargs):
        from auralia_api.segmentation.ollama_client import OllamaError

        raise OllamaError("connection refused")

    monkeypatch.setattr(
        "auralia_api.attribution.service.extract_character_roster",
        _raise_ollama,
    )

    response = client.post("/api/attribute", json={"document_id": doc_id})
    assert response.status_code == 502


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
