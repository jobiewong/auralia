from pathlib import Path

from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app


def _client_with_db(monkeypatch, db_path: Path) -> TestClient:
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(db_path))
    get_settings.cache_clear()
    return TestClient(app)


def test_ingest_text_endpoint_persists_plain_text(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post(
        "/api/ingest/text",
        json={
            "text": "<h1>Ch 1</h1>\n\nHarry\t  said: &quot;Hi&quot;",
            "source_id": "inline:test",
            "chapter_id": "ch_01",
            "title": "Chapter 1",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ingestion_job"]["status"] == "completed"
    assert payload["cleaned_document"]["source_id"] == "inline:test"
    assert payload["cleaned_document"]["chapter_id"] == "ch_01"
    assert payload["cleaned_document"]["title"] == "Chapter 1"
    assert payload["cleaned_document"]["text"] == 'Ch 1\n\nHarry said: "Hi"'
    assert payload["cleaned_document"]["text_length"] == len(
        payload["cleaned_document"]["text"]
    )


def test_ingest_text_endpoint_handles_markdown_like_plain_text(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    markdown_body = (
        "# Chapter 1\n\n"
        "Harry said, **\"Hello!\"**\n\n"
        "She whispered *softly* and [left](https://example.com).\n"
    )
    plain_body = 'Chapter 1\n\nHarry said, "Hello!"\n\nShe whispered softly and left.'

    md_response = client.post(
        "/api/ingest/text",
        json={"text": markdown_body, "source_id": "inline:md"},
    )
    plain_response = client.post(
        "/api/ingest/text",
        json={"text": plain_body, "source_id": "inline:plain"},
    )

    assert md_response.status_code == 201
    assert plain_response.status_code == 201
    assert (
        md_response.json()["cleaned_document"]["text"]
        == plain_response.json()["cleaned_document"]["text"]
    )


def test_ingest_text_endpoint_rejects_empty_text(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post("/api/ingest/text", json={"text": ""})
    assert response.status_code == 422


def test_ingest_text_endpoint_rejects_whitespace_only_text(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post("/api/ingest/text", json={"text": "   \n\t\n"})
    assert response.status_code == 422
    assert response.json()["detail"] == "Text is empty after cleaning"
