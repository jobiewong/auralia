from pathlib import Path

from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app


def _client_with_db(monkeypatch, db_path: Path) -> TestClient:
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(db_path))
    get_settings.cache_clear()
    return TestClient(app)


def test_ingest_text_file_endpoint_persists_cleaned_document_and_job(
    monkeypatch, tmp_path
):
    source_file = tmp_path / "chapter01.txt"
    source_file.write_text(
        "<h1>Ch 1</h1>\n\nHarry\t  said: &quot;Hi&quot;", encoding="utf-8"
    )

    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post(
        "/api/ingest/text-file",
        json={
            "file_path": str(source_file),
            "source_id": "local:test",
            "chapter_id": "ch_01",
            "title": "Chapter 1",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ingestion_job"]["status"] == "completed"
    assert payload["cleaned_document"]["source_id"] == "local:test"
    assert payload["cleaned_document"]["chapter_id"] == "ch_01"
    assert payload["cleaned_document"]["title"] == "Chapter 1"
    assert payload["cleaned_document"]["text"] == 'Ch 1\n\nHarry said: "Hi"'
    assert payload["cleaned_document"]["text_length"] == len(
        payload["cleaned_document"]["text"]
    )


def test_ingest_text_file_endpoint_returns_404_for_missing_file(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post(
        "/api/ingest/text-file",
        json={"file_path": str(tmp_path / "missing.txt")},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Input text file not found"
