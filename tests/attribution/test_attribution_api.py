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


def _detect_cast(client: TestClient, document_id: str) -> None:
    response = client.post("/api/detect-cast", json={"document_id": document_id})
    assert response.status_code == 201, response.text


def test_attribute_endpoint_happy_path(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said. "Yo," Ron replied.')
    _detect_cast(client, doc_id)

    response = client.post("/api/attribute", json={"document_id": doc_id})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["attribution_job"]["status"] == "completed"
    assert len(body["attributions"]) == 2
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT status, completed_at
            FROM attribution_jobs
            WHERE id = ?
            """,
            (body["attribution_job"]["id"],),
        ).fetchone()
    assert row is not None
    assert row[0] == "completed"
    assert row[1] is not None


def test_attribute_endpoint_404_missing_document(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post("/api/attribute", json={"document_id": "doc_missing"})
    assert response.status_code == 404


def test_attribute_endpoint_409_when_cast_missing(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said.')

    response = client.post("/api/attribute", json={"document_id": doc_id})

    assert response.status_code == 409
    assert "run cast detection" in response.json()["detail"]


def test_attribute_endpoint_409_already_attributed(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said.')
    _detect_cast(client, doc_id)

    first = client.post("/api/attribute", json={"document_id": doc_id})
    assert first.status_code == 201
    second = client.post("/api/attribute", json={"document_id": doc_id})
    assert second.status_code == 409


def test_attribute_endpoint_force_rewipes_attributions(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said. "Yo," Ron replied.')
    _detect_cast(client, doc_id)

    first = client.post("/api/attribute", json={"document_id": doc_id})
    assert first.status_code == 201
    assert first.json()["force_wipe"] is None
    first_attr_count = len(first.json()["attributions"])

    forced = client.post(
        "/api/attribute?force=true", json={"document_id": doc_id}
    )
    assert forced.status_code == 201, forced.text
    assert forced.json()["force_wipe"] == {
        "attributions_deleted": first_attr_count,
    }

    with sqlite3.connect(db_path) as conn:
        attr_count = conn.execute("SELECT COUNT(*) FROM attributions").fetchone()[0]
        job_count = conn.execute(
            "SELECT COUNT(*) FROM attribution_jobs WHERE document_id = ?",
            (doc_id,),
        ).fetchone()[0]
    assert attr_count == first_attr_count
    assert job_count == 2


def test_attribute_endpoint_422_on_validator_failure(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)
    doc_id = _ingest_and_segment(client, '"Hi," Harry said. "Yo," Harry replied.')
    _detect_cast(client, doc_id)

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
    doc_id = _ingest_and_segment(client, '"Hi," Harry said. "Okay," he replied.')
    _detect_cast(client, doc_id)

    def _raise_ollama(**kwargs):
        from auralia_api.segmentation.ollama_client import OllamaError

        raise OllamaError("connection refused")

    monkeypatch.setattr("auralia_api.attribution.service.generate_json", _raise_ollama)

    response = client.post("/api/attribute", json={"document_id": doc_id})
    assert response.status_code == 502


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
