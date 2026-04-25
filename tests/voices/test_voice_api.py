from __future__ import annotations

import io
import sqlite3
import wave
from pathlib import Path

from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app
from auralia_api.voices.service import PREVIEW_SENTENCES


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(tmp_path / "auralia.sqlite"))
    monkeypatch.setenv("AURALIA_VOICE_STORAGE_PATH", str(tmp_path / "voices"))
    get_settings.cache_clear()
    return TestClient(app)


def _wav_bytes() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 160)
    return buf.getvalue()


def test_create_list_detail_and_update_designed_voice(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)

    created = client.post(
        "/api/voices",
        data={
            "display_name": "Warm narrator",
            "mode": "designed",
            "control_text": "warm, clear, composed",
        },
    )

    assert created.status_code == 201, created.text
    voice_id = created.json()["id"]
    assert created.json()["display_name"] == "Warm narrator"

    listed = client.get("/api/voices")
    assert listed.status_code == 200
    assert [voice["id"] for voice in listed.json()["voices"]] == [voice_id]

    detail = client.get(f"/api/voices/{voice_id}")
    assert detail.status_code == 200
    assert detail.json()["control_text"] == "warm, clear, composed"

    updated = client.patch(
        f"/api/voices/{voice_id}",
        data={
            "display_name": "Cool narrator",
            "control_text": "cool, precise",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["display_name"] == "Cool narrator"


def test_upload_imports_clone_audio_under_voice_storage(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)

    response = client.post(
        "/api/voices",
        data={"display_name": "Clone", "mode": "clone"},
        files={"reference_audio": ("sample.wav", _wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 201, response.text
    rel_path = response.json()["reference_audio_path"]
    assert rel_path.endswith("reference.wav")
    assert (tmp_path / "voices" / rel_path).exists()


def test_validation_reports_missing_mode_requirements(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    response = client.post(
        "/api/voices",
        data={"display_name": "Invalid", "mode": "designed"},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["errors"][0]["code"] == "missing_control_text"


def test_delete_blocks_mapped_voice_and_force_removes_mapping(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/voices",
        data={
            "display_name": "Mapped",
            "mode": "designed",
            "control_text": "steady",
        },
    )
    assert created.status_code == 201, created.text
    voice_id = created.json()["id"]
    with sqlite3.connect(tmp_path / "auralia.sqlite") as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                text TEXT NOT NULL,
                text_length INTEGER NOT NULL,
                normalization TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO documents
              (id, source_id, chapter_id, text, text_length, normalization)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("doc_1", "inline", "1", "text", 4, "{}"),
        )
        conn.execute(
            "INSERT INTO voice_mappings"
            " (id, document_id, speaker, voice_id) VALUES (?, ?, ?, ?)",
            ("mapping_1", "doc_1", "NARRATOR", voice_id),
        )

    blocked = client.delete(f"/api/voices/{voice_id}")
    assert blocked.status_code == 409

    forced = client.delete(f"/api/voices/{voice_id}?force=true")
    assert forced.status_code == 200, forced.text
    assert forced.json()["removed_mappings"] == 1


def test_preview_uses_preset_sentence_and_persists_wav(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/voices",
        data={
            "display_name": "Preview",
            "mode": "designed",
            "control_text": "steady",
        },
    )
    voice_id = created.json()["id"]

    response = client.post(f"/api/voices/{voice_id}/preview")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sentence"] in PREVIEW_SENTENCES
    assert (tmp_path / "voices" / body["audio_path"]).exists()
