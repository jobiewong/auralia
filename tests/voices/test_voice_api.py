from __future__ import annotations

import io
import sqlite3
import sys
import wave
from pathlib import Path

from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app
from auralia_api.voices.qwen_tts import _collect_stream, generate_qwen_preview
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


def test_qwen_subprocess_collector_handles_carriage_return_progress():
    captured: list[str] = []
    pipe = io.StringIO("loading\r50%\rdone")

    _collect_stream(pipe, captured, None)

    assert "".join(captured) == "loading\r50%\rdone"


def test_create_list_detail_and_update_designed_voice(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)

    created = client.post(
        "/api/voices",
        data={
            "display_name": "Warm narrator",
            "mode": "designed",
            "control_text": "warm, clear, composed",
            "temperature": "1.15",
        },
    )

    assert created.status_code == 201, created.text
    voice_id = created.json()["id"]
    assert created.json()["display_name"] == "Warm narrator"
    assert created.json()["temperature"] == 1.15
    assert created.json()["preview_audio_path"] is None

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
            "temperature": "0.75",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["display_name"] == "Cool narrator"
    assert updated.json()["temperature"] == 0.75


def test_designed_qwen_preview_payload_includes_temperature(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    get_settings.cache_clear()
    captured = {}
    output_path = tmp_path / "preview.wav"

    def fake_run_qwen_subprocess(*, command, payload, timeout_seconds, env):
        captured["payload"] = payload
        output_path.write_bytes(_wav_bytes())
        return {"returncode": 0, "stdout": '{"ok": true}', "stderr": ""}

    monkeypatch.setattr(
        "auralia_api.voices.qwen_tts._run_qwen_subprocess",
        fake_run_qwen_subprocess,
    )

    generate_qwen_preview(
        voice={
            "id": "voice_temp",
            "mode": "designed",
            "control_text": "bright",
            "temperature": 1.35,
        },
        text="Preview text.",
        output_path=output_path,
    )

    assert captured["payload"]["temperature"] == 1.35


def test_hifi_clone_qwen_preview_payload_uses_prompt_audio_and_text(
    monkeypatch, tmp_path
):
    voice_root = tmp_path / "voices"
    prompt_path = voice_root / "voice_clone" / "prompt.wav"
    prompt_path.parent.mkdir(parents=True)
    prompt_path.write_bytes(_wav_bytes())
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    monkeypatch.setenv("AURALIA_VOICE_STORAGE_PATH", str(voice_root))
    monkeypatch.setenv("AURALIA_QWEN_TTS_VOICE_CLONE_MODEL", "clone-model")
    get_settings.cache_clear()
    captured = {}
    output_path = tmp_path / "preview.wav"

    def fake_run_qwen_subprocess(*, command, payload, timeout_seconds, env):
        captured["payload"] = payload
        output_path.write_bytes(_wav_bytes())
        return {"returncode": 0, "stdout": '{"ok": true}', "stderr": ""}

    monkeypatch.setattr(
        "auralia_api.voices.qwen_tts._run_qwen_subprocess",
        fake_run_qwen_subprocess,
    )

    generate_qwen_preview(
        voice={
            "id": "voice_clone",
            "mode": "hifi_clone",
            "prompt_audio_path": "voice_clone/prompt.wav",
            "prompt_text": "The exact words in the sample.",
            "temperature": 0.8,
        },
        text="Preview text.",
        output_path=output_path,
    )

    assert captured["payload"]["mode"] == "hifi_clone"
    assert captured["payload"]["model"] == "clone-model"
    assert captured["payload"]["ref_audio"] == str(prompt_path)
    assert captured["payload"]["ref_text"] == "The exact words in the sample."
    assert captured["payload"]["temperature"] == 0.8


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


def test_hifi_clone_requires_prompt_text(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    response = client.post(
        "/api/voices",
        data={"display_name": "Clone", "mode": "hifi_clone"},
        files={"prompt_audio": ("sample.wav", _wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["errors"][0]["code"] == "missing_prompt_text"


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


def test_voice_mapping_endpoints(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/voices",
        data={
            "display_name": "Preview",
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

    upserted = client.post(
        "/api/documents/doc_1/voice-mappings",
        json={"speaker": "NARRATOR", "voice_id": voice_id},
    )
    assert upserted.status_code == 200, upserted.text
    assert upserted.json()["speaker"] == "NARRATOR"

    listed = client.get("/api/documents/doc_1/voice-mappings")
    assert listed.status_code == 200
    assert listed.json()["mappings"][0]["voice_id"] == voice_id

    cleared = client.delete("/api/documents/doc_1/voice-mappings/NARRATOR")
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] == 1


def test_preview_uses_preset_sentence_and_persists_wav(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    monkeypatch.setenv("AURALIA_QWEN_TTS_TEST_FAKE", "1")
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


def test_name_only_update_preserves_existing_preview(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    monkeypatch.setenv("AURALIA_QWEN_TTS_TEST_FAKE", "1")
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/voices",
        data={
            "display_name": "Preview",
            "mode": "designed",
            "control_text": "steady",
            "temperature": "0.9",
        },
    )
    voice_id = created.json()["id"]
    preview = client.post(f"/api/voices/{voice_id}/preview")
    assert preview.status_code == 200, preview.text
    preview_body = preview.json()

    updated = client.patch(
        f"/api/voices/{voice_id}",
        data={
            "display_name": "Renamed preview",
            "mode": "designed",
            "control_text": "steady",
            "temperature": "0.9",
        },
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["display_name"] == "Renamed preview"
    assert updated.json()["preview_audio_path"] == preview_body["audio_path"]
    assert updated.json()["preview_sentence"] == preview_body["sentence"]
    assert (tmp_path / "voices" / preview_body["audio_path"]).exists()


def test_hifi_clone_preview_uses_preset_sentence_and_persists_wav(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    monkeypatch.setenv("AURALIA_QWEN_TTS_TEST_FAKE", "1")
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/voices",
        data={
            "display_name": "Hifi Clone",
            "mode": "hifi_clone",
            "prompt_text": "The exact transcript for this sample.",
            "temperature": "0.85",
        },
        files={"prompt_audio": ("sample.wav", _wav_bytes(), "audio/wav")},
    )
    assert created.status_code == 201, created.text
    voice_id = created.json()["id"]
    assert created.json()["prompt_audio_path"].endswith("prompt.wav")

    response = client.post(f"/api/voices/{voice_id}/preview")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sentence"] in PREVIEW_SENTENCES
    assert (tmp_path / "voices" / body["audio_path"]).exists()


def test_preview_without_qwen_runtime_returns_502(monkeypatch, tmp_path):
    monkeypatch.delenv("AURALIA_QWEN_TTS_PYTHON", raising=False)
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

    assert response.status_code == 502


def test_clone_preview_is_not_supported_yet(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    monkeypatch.setenv("AURALIA_QWEN_TTS_TEST_FAKE", "1")
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/voices",
        data={"display_name": "Clone", "mode": "clone"},
        files={"reference_audio": ("sample.wav", _wav_bytes(), "audio/wav")},
    )
    voice_id = created.json()["id"]

    response = client.post(f"/api/voices/{voice_id}/preview")

    assert response.status_code == 502
