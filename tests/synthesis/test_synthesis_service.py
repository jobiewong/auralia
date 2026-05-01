from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

from auralia_api.config import get_settings
from auralia_api.ingestion.schemas import IngestTextRequest
from auralia_api.ingestion.service import ingest_text
from auralia_api.segmentation.service import segment_document
from auralia_api.synthesis.service import (
    AlreadySynthesizedError,
    SynthesisValidationError,
    _cache_key,
    create_synthesis_job,
    get_segment_audio_file,
    run_synthesis_job,
)
from auralia_api.synthesis.storage import (
    SynthesisNotFoundError,
    get_synthesis_job,
)
from auralia_api.synthesis.storage import (
    connect as connect_synthesis_storage,
)


def _configure(monkeypatch, tmp_path: Path) -> tuple[Path, Path, Path]:
    db_path = tmp_path / "auralia.sqlite"
    voice_root = tmp_path / "voices"
    output_root = tmp_path / "outputs"
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(db_path))
    monkeypatch.setenv("AURALIA_VOICE_STORAGE_PATH", str(voice_root))
    monkeypatch.setenv("AURALIA_OUTPUT_STORAGE_PATH", str(output_root))
    monkeypatch.setenv("AURALIA_QWEN_TTS_PYTHON", sys.executable)
    monkeypatch.setenv("AURALIA_QWEN_TTS_TEST_FAKE", "1")
    get_settings.cache_clear()
    return db_path, voice_root, output_root


def _ingest_segment_and_attribute(db_path: Path, text: str) -> str:
    result = ingest_text(
        sqlite_path=str(db_path),
        req=IngestTextRequest(
            text=text,
            source_id="inline:synthesis-test",
            chapter_id="ch_01",
            title="Chapter",
        ),
    )
    document_id = result["cleaned_document"]["id"]
    segment_document(sqlite_path=str(db_path), document_id=document_id)
    _insert_dialogue_attributions(db_path, document_id=document_id)
    return document_id


def _insert_dialogue_attributions(
    db_path: Path,
    *,
    document_id: str,
    speaker: str = "Harry",
    needs_review: bool = False,
) -> None:
    with sqlite3.connect(db_path) as conn:
        spans = conn.execute(
            """
            SELECT id, type FROM spans
            WHERE document_id = ?
            ORDER BY start
            """,
            (document_id,),
        ).fetchall()
        for index, (span_id, span_type) in enumerate(spans):
            if span_type != "dialogue":
                continue
            conn.execute(
                """
                INSERT INTO attributions (
                  id, span_id, speaker, speaker_confidence, needs_review
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    f"attr_{index}",
                    span_id,
                    speaker,
                    0 if speaker == "UNKNOWN" else 1,
                    1 if needs_review else 0,
                ),
            )


def _insert_designed_voice(db_path: Path, voice_id: str, name: str) -> None:
    with connect_synthesis_storage(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO voices (
              id, display_name, mode, control_text, temperature, is_canonical,
              created_at, updated_at
            )
            VALUES (?, ?, 'designed', 'warm, clear, steady', 0.9, 1,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (voice_id, name),
        )


def _insert_clone_voice(db_path: Path, voice_root: Path) -> None:
    reference_path = voice_root / "voice_clone" / "reference.wav"
    reference_path.parent.mkdir(parents=True)
    reference_path.write_bytes(b"fake")
    with connect_synthesis_storage(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO voices (
              id, display_name, mode, reference_audio_path, temperature,
              is_canonical, created_at, updated_at
            )
            VALUES (
              'voice_clone', 'Clone', 'clone', 'voice_clone/reference.wav',
              0.9, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """
        )


def _map_voice(db_path: Path, document_id: str, speaker: str, voice_id: str) -> None:
    with connect_synthesis_storage(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO voice_mappings (
              id, document_id, speaker, voice_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (f"vm_{speaker}", document_id, speaker, voice_id),
        )


def _map_required_voices(db_path: Path, document_id: str) -> None:
    _insert_designed_voice(db_path, "voice_narrator", "Narrator")
    _insert_designed_voice(db_path, "voice_harry", "Harry")
    _map_voice(db_path, document_id, "NARRATOR", "voice_narrator")
    _map_voice(db_path, document_id, "Harry", "voice_harry")


def test_synthesis_job_generates_output_and_manifest(monkeypatch, tmp_path):
    db_path, voice_root, output_root = _configure(monkeypatch, tmp_path)
    monkeypatch.setenv("AURALIA_SYNTHESIS_SPAN_PAUSE_MS", "375")
    monkeypatch.setenv("AURALIA_SYNTHESIS_CHUNK_PAUSE_MS", "125")
    monkeypatch.setenv("AURALIA_SYNTHESIS_NEWLINE_PAUSE_MS", "950")
    get_settings.cache_clear()
    document_id = _ingest_segment_and_attribute(
        db_path,
        (
            'The door opened. "One. Two. Three. Four," Harry said. '
            "Everyone waited."
        ),
    )
    _map_required_voices(db_path, document_id)

    created = create_synthesis_job(
        document_id=document_id,
        sqlite_path=str(db_path),
        output_root=str(output_root),
        voice_root=str(voice_root),
    )
    job_id = created["synthesis_job"]["id"]
    run_synthesis_job(
        job_id=job_id,
        sqlite_path=str(db_path),
        output_root=str(output_root),
        voice_root=str(voice_root),
    )

    job = get_synthesis_job(sqlite_path=str(db_path), job_id=job_id)
    assert job["status"] == "completed"
    assert job["stats"]["phase"] == "completed"
    assert job["stats"]["completed_spans"] == job["stats"]["span_count"]
    assert job["stats"]["latest_completed_span_id"]
    assert job["output_path"].endswith("/output.wav")
    assert job["manifest_path"].endswith("/manifest.json")
    assert (output_root / job["output_path"]).exists()
    manifest_path = output_root / job["manifest_path"]
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["span_pause_ms"] == 375
    assert manifest["chunk_pause_ms"] == 125
    assert manifest["newline_pause_ms"] == 950
    with sqlite3.connect(db_path) as conn:
        span_count = conn.execute(
            "SELECT COUNT(*) FROM spans WHERE document_id = ?",
            (document_id,),
        ).fetchone()[0]
        segment_count = conn.execute(
            "SELECT COUNT(*) FROM synthesis_segments WHERE job_id = ?",
            (job_id,),
        ).fetchone()[0]
        first_segment = conn.execute(
            """
            SELECT span_id, duration_ms, chunk_count
            FROM synthesis_segments
            WHERE job_id = ?
            ORDER BY start
            LIMIT 1
            """,
            (job_id,),
        ).fetchone()
    assert segment_count == span_count
    assert first_segment is not None
    assert first_segment[1] is not None
    assert first_segment[2] >= 1
    segment_audio = get_segment_audio_file(
        sqlite_path=str(db_path),
        output_root=str(output_root),
        job_id=job_id,
        span_id=first_segment[0],
    )
    assert segment_audio.exists()


def test_synthesis_blocks_needs_review(monkeypatch, tmp_path):
    db_path, voice_root, output_root = _configure(monkeypatch, tmp_path)
    result = ingest_text(
        sqlite_path=str(db_path),
        req=IngestTextRequest(
            text='"Hello," Harry said.',
            source_id="inline:synthesis-test",
            chapter_id="ch_01",
            title="Chapter",
        ),
    )
    document_id = result["cleaned_document"]["id"]
    segment_document(sqlite_path=str(db_path), document_id=document_id)
    _insert_dialogue_attributions(
        db_path, document_id=document_id, needs_review=True
    )
    _map_required_voices(db_path, document_id)

    try:
        create_synthesis_job(
            document_id=document_id,
            sqlite_path=str(db_path),
            output_root=str(output_root),
            voice_root=str(voice_root),
        )
    except SynthesisValidationError as exc:
        codes = {error["code"] for error in exc.report["errors"]}
    else:
        raise AssertionError("expected SynthesisValidationError")
    assert "needs_review" in codes


def test_segment_audio_rejects_unfinished_span(monkeypatch, tmp_path):
    db_path, voice_root, output_root = _configure(monkeypatch, tmp_path)
    document_id = _ingest_segment_and_attribute(db_path, '"Hello," Harry said.')
    _map_required_voices(db_path, document_id)
    created = create_synthesis_job(
        document_id=document_id,
        sqlite_path=str(db_path),
        output_root=str(output_root),
        voice_root=str(voice_root),
    )

    try:
        get_segment_audio_file(
            sqlite_path=str(db_path),
            output_root=str(output_root),
            job_id=created["synthesis_job"]["id"],
            span_id="span_missing",
        )
    except SynthesisNotFoundError:
        pass
    else:
        raise AssertionError("expected SynthesisNotFoundError")


def test_synthesis_blocks_missing_narrator_mapping(monkeypatch, tmp_path):
    db_path, voice_root, output_root = _configure(monkeypatch, tmp_path)
    document_id = _ingest_segment_and_attribute(db_path, '"Hello," Harry said.')
    _insert_designed_voice(db_path, "voice_harry", "Harry")
    _map_voice(db_path, document_id, "Harry", "voice_harry")

    try:
        create_synthesis_job(
            document_id=document_id,
            sqlite_path=str(db_path),
            output_root=str(output_root),
            voice_root=str(voice_root),
        )
    except SynthesisValidationError as exc:
        codes = {error["code"] for error in exc.report["errors"]}
    else:
        raise AssertionError("expected SynthesisValidationError")
    assert "missing_voice_mapping" in codes


def test_synthesis_existing_job_requires_force(monkeypatch, tmp_path):
    db_path, voice_root, output_root = _configure(monkeypatch, tmp_path)
    document_id = _ingest_segment_and_attribute(db_path, '"Hello," Harry said.')
    _map_required_voices(db_path, document_id)

    create_synthesis_job(
        document_id=document_id,
        sqlite_path=str(db_path),
        output_root=str(output_root),
        voice_root=str(voice_root),
    )
    try:
        create_synthesis_job(
            document_id=document_id,
            sqlite_path=str(db_path),
            output_root=str(output_root),
            voice_root=str(voice_root),
        )
    except AlreadySynthesizedError:
        pass
    else:
        raise AssertionError("expected AlreadySynthesizedError")

    forced = create_synthesis_job(
        document_id=document_id,
        sqlite_path=str(db_path),
        output_root=str(output_root),
        voice_root=str(voice_root),
        force=True,
    )
    assert forced["force_wipe"]["synthesis_jobs_deleted"] == 1


def test_synthesis_blocks_plain_clone_voice(monkeypatch, tmp_path):
    db_path, voice_root, output_root = _configure(monkeypatch, tmp_path)
    document_id = _ingest_segment_and_attribute(db_path, '"Hello," Harry said.')
    _insert_designed_voice(db_path, "voice_narrator", "Narrator")
    _insert_clone_voice(db_path, voice_root)
    _map_voice(db_path, document_id, "NARRATOR", "voice_narrator")
    _map_voice(db_path, document_id, "Harry", "voice_clone")

    try:
        create_synthesis_job(
            document_id=document_id,
            sqlite_path=str(db_path),
            output_root=str(output_root),
            voice_root=str(voice_root),
        )
    except SynthesisValidationError as exc:
        codes = {error["code"] for error in exc.report["errors"]}
    else:
        raise AssertionError("expected SynthesisValidationError")
    assert "unsupported_voice_mode" in codes


def test_synthesis_cache_key_includes_newline_pause():
    span = {
        "id": "span_1",
        "type": "narration",
        "text": "Chapter 1\nSaturday 7th August",
    }
    voice = {
        "id": "voice_narrator",
        "mode": "designed",
        "control_text": "warm, clear, steady",
        "prompt_audio_path": None,
        "prompt_text": None,
        "temperature": 0.9,
        "updated_at": "2026-01-01T00:00:00",
    }

    first = _cache_key(
        span=span,
        voice=voice,
        chunk_pause_ms=125,
        newline_pause_ms=900,
    )
    second = _cache_key(
        span=span,
        voice=voice,
        chunk_pause_ms=125,
        newline_pause_ms=950,
    )

    assert first != second
