from __future__ import annotations

import hashlib
import json
import shutil
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from auralia_api.config import get_settings
from auralia_api.synthesis.audio import (
    AudioAssemblyError,
    TextChunk,
    concatenate_wavs,
    concatenate_wavs_with_pauses,
    duration_ms,
    plan_text_chunks,
)
from auralia_api.synthesis.storage import (
    AlreadySynthesizedError,
    DocumentNotFoundError,
    SynthesisNotFoundError,
    existing_synthesis_job,
    get_synthesis_job,
    get_synthesis_segment,
    insert_synthesis_job,
    insert_synthesis_segment,
    load_document_plan,
    reset_synthesis,
    update_synthesis_job,
)
from auralia_api.voices.qwen_tts import (
    VoicePreviewUnavailableError,
    generate_qwen_audio,
)
from auralia_api.voices.service import validate_voice_profile

NARRATOR_SPEAKER = "NARRATOR"
SYNTHESIS_VERSION = "m7_synthesis_v2"


class SynthesisValidationError(ValueError):
    def __init__(self, report: dict[str, Any]):
        super().__init__("synthesis prerequisites failed")
        self.report = report


class SynthesisOutputNotReadyError(RuntimeError):
    pass


def create_synthesis_job(
    *,
    document_id: str,
    sqlite_path: str,
    output_root: str,
    voice_root: str,
    force: bool = False,
) -> dict[str, Any]:
    force_wipe: dict[str, int] | None = None
    existing = existing_synthesis_job(
        sqlite_path=sqlite_path, document_id=document_id
    )
    if existing is not None:
        if not force:
            raise AlreadySynthesizedError(
                f"document already has synthesis job: {document_id}"
            )
        force_wipe = reset_synthesis(sqlite_path=sqlite_path, document_id=document_id)
        _remove_document_outputs(output_root=output_root, document_id=document_id)

    plan = load_document_plan(sqlite_path=sqlite_path, document_id=document_id)
    _validate_plan(plan=plan, voice_root=voice_root)
    job_id = f"synth_{uuid4().hex[:12]}"
    job = insert_synthesis_job(
        sqlite_path=sqlite_path,
        job_id=job_id,
        document_id=document_id,
        status="running",
    )
    return {"synthesis_job": job, "force_wipe": force_wipe}


def run_synthesis_job(
    *,
    job_id: str,
    sqlite_path: str,
    output_root: str,
    voice_root: str,
) -> None:
    start = time.perf_counter()
    job = get_synthesis_job(sqlite_path=sqlite_path, job_id=job_id)
    document_id = job["document_id"]
    try:
        plan = load_document_plan(sqlite_path=sqlite_path, document_id=document_id)
        _validate_plan(plan=plan, voice_root=voice_root)
        result = _generate_document_audio(
            job_id=job_id,
            plan=plan,
            sqlite_path=sqlite_path,
            output_root=output_root,
        )
        stats = {
            **result["stats"],
            "duration_seconds": round(time.perf_counter() - start, 3),
        }
        update_synthesis_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="completed",
            output_path=result["output_path"],
            manifest_path=result["manifest_path"],
            stats=stats,
            error_report=None,
        )
    except Exception as exc:
        update_synthesis_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="failed",
            stats={"duration_seconds": round(time.perf_counter() - start, 3)},
            error_report={"message": str(exc), "type": type(exc).__name__},
        )


def get_output_file(*, sqlite_path: str, output_root: str, job_id: str) -> Path:
    job = get_synthesis_job(sqlite_path=sqlite_path, job_id=job_id)
    output_path = job.get("output_path")
    if not output_path:
        raise SynthesisOutputNotReadyError(f"synthesis output not ready: {job_id}")
    return _resolve_output_path(output_root=output_root, relative_path=output_path)


def get_manifest_file(*, sqlite_path: str, output_root: str, job_id: str) -> Path:
    job = get_synthesis_job(sqlite_path=sqlite_path, job_id=job_id)
    manifest_path = job.get("manifest_path")
    if not manifest_path:
        raise SynthesisOutputNotReadyError(f"synthesis manifest not ready: {job_id}")
    return _resolve_output_path(output_root=output_root, relative_path=manifest_path)


def get_segment_audio_file(
    *, sqlite_path: str, output_root: str, job_id: str, span_id: str
) -> Path:
    get_synthesis_job(sqlite_path=sqlite_path, job_id=job_id)
    segment = get_synthesis_segment(
        sqlite_path=sqlite_path, job_id=job_id, span_id=span_id
    )
    return _resolve_output_path(
        output_root=output_root, relative_path=segment["audio_path"]
    )


def _generate_document_audio(
    *,
    job_id: str,
    plan: dict[str, Any],
    sqlite_path: str,
    output_root: str,
) -> dict[str, Any]:
    settings = get_settings()
    span_pause_ms = settings.synthesis_span_pause_ms
    chunk_pause_ms = settings.synthesis_chunk_pause_ms
    newline_pause_ms = settings.synthesis_newline_pause_ms
    document = plan["document"]
    output_dir = Path(output_root) / document["id"] / job_id
    segments_dir = output_dir / "segments"
    chunks_dir = output_dir / "chunks"
    cache_dir = Path(output_root) / "cache"
    segments_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    generated_segments: list[dict[str, Any]] = []
    span_paths: list[Path] = []
    cache_hits = 0
    chunk_total = 0
    completed_spans = 0
    total_spans = len(plan["spans"])
    for index, span in enumerate(plan["spans"]):
        update_synthesis_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="running",
            stats=_progress_stats(
                phase="generating_span",
                total_spans=total_spans,
                completed_spans=completed_spans,
                current_span_id=span["id"],
                current_span_index=index,
            ),
            error_report=None,
        )
        speaker = _speaker_for_span(span)
        voice = plan["mappings"][speaker]
        text_hash = _sha256(span["text"])
        cache_key = _cache_key(
            span=span,
            voice=voice,
            chunk_pause_ms=chunk_pause_ms,
            newline_pause_ms=newline_pause_ms,
        )
        cached_path = cache_dir / f"{cache_key}.wav"
        segment_path = segments_dir / f"{index:05d}_{span['id']}.wav"
        chunks = plan_text_chunks(
            span["text"],
            max_sentences=3,
            chunk_pause_ms=chunk_pause_ms,
            newline_pause_ms=newline_pause_ms,
        )
        chunk_total += len(chunks)
        if cached_path.exists() and cached_path.stat().st_size > 0:
            shutil.copyfile(cached_path, segment_path)
            cache_hits += 1
        else:
            chunk_paths = _generate_span_chunks(
                span=span,
                chunks=chunks,
                voice=voice,
                chunks_dir=chunks_dir,
            )
            concatenate_wavs_with_pauses(
                chunk_paths,
                segment_path,
                pause_ms_between=[
                    chunk.pause_after_ms or 0 for chunk in chunks[:-1]
                ],
            )
            shutil.copyfile(segment_path, cached_path)

        relative_segment_path = _relative_to_output_root(
            output_root=output_root, path=segment_path
        )
        segment = {
            "id": f"synth_seg_{uuid4().hex[:12]}",
            "job_id": job_id,
            "span_id": span["id"],
            "voice_id": voice["id"],
            "audio_path": relative_segment_path,
            "start": span["start"],
            "end": span["end"],
            "cache_key": cache_key,
            "text_hash": text_hash,
            "chunk_count": len(chunks),
            "duration_ms": duration_ms(segment_path),
            "speaker": speaker,
            "type": span["type"],
        }
        insert_synthesis_segment(sqlite_path=sqlite_path, segment=segment)
        generated_segments.append(segment)
        span_paths.append(segment_path)
        completed_spans += 1
        update_synthesis_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="running",
            stats=_progress_stats(
                phase="generating_span",
                total_spans=total_spans,
                completed_spans=completed_spans,
                latest_completed_span_id=span["id"],
            ),
            error_report=None,
        )

    output_path = output_dir / "output.wav"
    update_synthesis_job(
        sqlite_path=sqlite_path,
        job_id=job_id,
        status="running",
        stats=_progress_stats(
            phase="assembling_output",
            total_spans=total_spans,
            completed_spans=completed_spans,
            latest_completed_span_id=generated_segments[-1]["span_id"]
            if generated_segments
            else None,
        ),
        error_report=None,
    )
    concatenate_wavs(span_paths, output_path, pause_ms=span_pause_ms)
    manifest_path = output_dir / "manifest.json"
    manifest = {
        "version": SYNTHESIS_VERSION,
        "job_id": job_id,
        "document_id": document["id"],
        "output_path": _relative_to_output_root(
            output_root=output_root, path=output_path
        ),
        "span_pause_ms": span_pause_ms,
        "chunk_pause_ms": chunk_pause_ms,
        "newline_pause_ms": newline_pause_ms,
        "segments": generated_segments,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return {
        "output_path": manifest["output_path"],
        "manifest_path": _relative_to_output_root(
            output_root=output_root, path=manifest_path
        ),
        "stats": {
            "span_count": len(plan["spans"]),
            "chunk_count": chunk_total,
            "cache_hits": cache_hits,
            "output_bytes": output_path.stat().st_size,
            "method": SYNTHESIS_VERSION,
            "phase": "completed",
            "total_spans": total_spans,
            "completed_spans": completed_spans,
            "latest_completed_span_id": generated_segments[-1]["span_id"]
            if generated_segments
            else None,
        },
    }


def _generate_span_chunks(
    *,
    span: dict[str, Any],
    chunks: list[TextChunk],
    voice: dict[str, Any],
    chunks_dir: Path,
) -> list[Path]:
    span_dir = chunks_dir / span["id"]
    span_dir.mkdir(parents=True, exist_ok=True)
    chunk_paths: list[Path] = []
    for index, chunk in enumerate(chunks):
        chunk_path = span_dir / f"{index:03d}.wav"
        generate_qwen_audio(voice=voice, text=chunk.text, output_path=chunk_path)
        chunk_paths.append(chunk_path)
    return chunk_paths


def _validate_plan(*, plan: dict[str, Any], voice_root: str) -> None:
    errors: list[dict[str, Any]] = []
    spans = plan["spans"]
    if not spans:
        errors.append(_issue("missing_spans", "document", "run segmentation first"))

    dialogue_spans = [span for span in spans if span["type"] == "dialogue"]
    for span in dialogue_spans:
        if span.get("speaker") is None:
            errors.append(
                _issue("missing_attribution", span["id"], "run attribution first")
            )
        elif span["speaker"] == "UNKNOWN":
            errors.append(_issue("unknown_speaker", span["id"], "speaker is UNKNOWN"))
        if bool(span.get("needs_review")):
            errors.append(
                _issue("needs_review", span["id"], "span still requires review")
            )

    required_speakers = {NARRATOR_SPEAKER}
    required_speakers.update(
        span["speaker"]
        for span in dialogue_spans
        if isinstance(span.get("speaker"), str) and span["speaker"] != "UNKNOWN"
    )
    mappings = plan["mappings"]
    for speaker in sorted(required_speakers):
        voice = mappings.get(speaker)
        if voice is None:
            errors.append(
                _issue(
                    "missing_voice_mapping",
                    speaker,
                    f"speaker has no voice mapping: {speaker}",
                )
            )
            continue
        report = validate_voice_profile(voice=voice, voice_root=voice_root)
        for row in report["errors"]:
            errors.append({**row, "speaker": speaker, "voice_id": voice["id"]})
        if voice["mode"] == "clone":
            errors.append(
                _issue(
                    "unsupported_voice_mode",
                    speaker,
                    "plain clone voices cannot synthesize audio yet",
                    voice_id=voice["id"],
                )
            )
    if errors:
        raise SynthesisValidationError({"errors": errors})


def _speaker_for_span(span: dict[str, Any]) -> str:
    if span["type"] == "narration":
        return NARRATOR_SPEAKER
    speaker = span.get("speaker")
    if not isinstance(speaker, str):
        raise SynthesisValidationError(
            {"errors": [_issue("missing_attribution", span["id"], "speaker missing")]}
        )
    return speaker


def _cache_key(
    *,
    span: dict[str, Any],
    voice: dict[str, Any],
    chunk_pause_ms: int,
    newline_pause_ms: int,
) -> str:
    payload = {
        "version": SYNTHESIS_VERSION,
        "text": span["text"],
        "voice": {
            "id": voice["id"],
            "mode": voice["mode"],
            "control_text": voice.get("control_text"),
            "prompt_audio_path": voice.get("prompt_audio_path"),
            "prompt_text": voice.get("prompt_text"),
            "temperature": voice.get("temperature"),
            "updated_at": voice.get("updated_at"),
        },
        "chunking": {
            "mode": "sentence_chunks_with_newline_pauses",
            "max_sentences": 3,
            "chunk_pause_ms": chunk_pause_ms,
            "newline_pause_ms": newline_pause_ms,
        },
    }
    return _sha256(json.dumps(payload, sort_keys=True))


def _progress_stats(
    *,
    phase: str,
    total_spans: int,
    completed_spans: int,
    current_span_id: str | None = None,
    current_span_index: int | None = None,
    latest_completed_span_id: str | None = None,
) -> dict[str, Any]:
    return {
        "method": SYNTHESIS_VERSION,
        "phase": phase,
        "total_spans": total_spans,
        "completed_spans": completed_spans,
        "pending_spans": max(total_spans - completed_spans, 0),
        "current_span_id": current_span_id,
        "current_span_index": current_span_index,
        "latest_completed_span_id": latest_completed_span_id,
    }


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _issue(
    code: str,
    field: str,
    message: str,
    *,
    voice_id: str | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {"code": code, "field": field, "message": message}
    if voice_id is not None:
        row["voice_id"] = voice_id
    return row


def _relative_to_output_root(*, output_root: str, path: Path) -> str:
    return str(path.resolve().relative_to(Path(output_root).resolve()))


def _resolve_output_path(*, output_root: str, relative_path: str) -> Path:
    root = Path(output_root).resolve()
    path = (root / relative_path).resolve()
    if root != path and root not in path.parents:
        raise SynthesisNotFoundError("synthesis output path escapes output root")
    if not path.exists():
        raise SynthesisNotFoundError(
            f"synthesis output file not found: {relative_path}"
        )
    return path


def _remove_document_outputs(*, output_root: str, document_id: str) -> None:
    path = (Path(output_root) / document_id).resolve()
    root = Path(output_root).resolve()
    if root == path or root not in path.parents:
        return
    shutil.rmtree(path, ignore_errors=True)


__all__ = [
    "AlreadySynthesizedError",
    "AudioAssemblyError",
    "DocumentNotFoundError",
    "SynthesisOutputNotReadyError",
    "SynthesisValidationError",
    "VoicePreviewUnavailableError",
    "create_synthesis_job",
    "get_manifest_file",
    "get_output_file",
    "get_segment_audio_file",
    "run_synthesis_job",
]
