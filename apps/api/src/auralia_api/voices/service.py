from __future__ import annotations

import random
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from auralia_api.voices import storage
from auralia_api.voices.qwen_tts import generate_qwen_preview

ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}
PREVIEW_SENTENCES = [
    "The lanterns burned low as the last train crossed the valley.",
    "Every story leaves an echo if you listen closely enough.",
    "She opened the door and found the morning waiting on the other side.",
    "A quiet voice can still carry across an entire room.",
]


class VoiceValidationError(ValueError):
    pass


class UnsafeAssetPathError(ValueError):
    pass


def create_voice(
    *,
    sqlite_path: str,
    voice_root: str,
    voice_id: str | None = None,
    display_name: str,
    mode: str,
    control_text: str | None,
    prompt_text: str | None,
    temperature: float,
    reference_audio: UploadFile | None,
    prompt_audio: UploadFile | None,
) -> dict:
    voice_id = voice_id or f"voice_{uuid4().hex}"
    if not voice_id.startswith("voice_"):
        raise VoiceValidationError(
            {
                "errors": [
                    _issue("invalid_voice_id", "voice_id", "invalid voice id")
                ]
            }
        )
    voice_dir = _voice_dir(voice_root, voice_id)
    voice_dir.mkdir(parents=True, exist_ok=True)
    try:
        voice = {
            "id": voice_id,
            "display_name": display_name.strip(),
            "mode": mode,
            "control_text": _clean_optional(control_text),
            "prompt_text": _clean_optional(prompt_text),
            "temperature": temperature,
            "is_canonical": True,
        }
        if reference_audio is not None:
            voice["reference_audio_path"] = _save_upload(
                upload=reference_audio,
                voice_dir=voice_dir,
                voice_root=voice_root,
                stem="reference",
            )
        if prompt_audio is not None:
            voice["prompt_audio_path"] = _save_upload(
                upload=prompt_audio,
                voice_dir=voice_dir,
                voice_root=voice_root,
                stem="prompt",
            )
        result = storage.insert_voice(sqlite_path=sqlite_path, voice=voice)
        report = validate_voice_profile(voice=result, voice_root=voice_root)
        if report["errors"]:
            storage.delete_voice(
                sqlite_path=sqlite_path, voice_id=voice_id, force=False
            )
            raise VoiceValidationError(report)
        return storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    except Exception:
        if not storage_path_exists(sqlite_path=sqlite_path, voice_id=voice_id):
            shutil.rmtree(voice_dir, ignore_errors=True)
        raise


def update_voice(
    *,
    sqlite_path: str,
    voice_root: str,
    voice_id: str,
    display_name: str | None = None,
    mode: str | None = None,
    control_text: str | None = None,
    prompt_text: str | None = None,
    temperature: float | None = None,
    reference_audio: UploadFile | None = None,
    prompt_audio: UploadFile | None = None,
) -> dict:
    fields: dict = {}
    if display_name is not None:
        fields["display_name"] = display_name.strip()
    if mode is not None:
        fields["mode"] = mode
    if control_text is not None:
        fields["control_text"] = _clean_optional(control_text)
    if prompt_text is not None:
        fields["prompt_text"] = _clean_optional(prompt_text)
    if temperature is not None:
        fields["temperature"] = temperature
    voice_dir = _voice_dir(voice_root, voice_id)
    voice_dir.mkdir(parents=True, exist_ok=True)
    if reference_audio is not None:
        fields["reference_audio_path"] = _save_upload(
            upload=reference_audio,
            voice_dir=voice_dir,
            voice_root=voice_root,
            stem="reference",
        )
    if prompt_audio is not None:
        fields["prompt_audio_path"] = _save_upload(
            upload=prompt_audio,
            voice_dir=voice_dir,
            voice_root=voice_root,
            stem="prompt",
        )
    existing = storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    candidate = {**existing, **fields}
    report = validate_voice_profile(voice=candidate, voice_root=voice_root)
    if report["errors"]:
        raise VoiceValidationError(report)
    preview_inputs_changed = _preview_inputs_changed(existing=existing, fields=fields)
    result = storage.update_voice(
        sqlite_path=sqlite_path, voice_id=voice_id, fields=fields
    )
    if preview_inputs_changed:
        previews_dir = _voice_dir(voice_root, result["id"]) / "previews"
        if previews_dir.exists():
            shutil.rmtree(previews_dir)
        storage.update_voice(
            sqlite_path=sqlite_path,
            voice_id=voice_id,
            fields={"preview_audio_path": None, "preview_sentence": None},
        )
    return storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)


def delete_voice(
    *, sqlite_path: str, voice_root: str, voice_id: str, force: bool
) -> dict:
    result = storage.delete_voice(
        sqlite_path=sqlite_path, voice_id=voice_id, force=force
    )
    shutil.rmtree(_voice_dir(voice_root, voice_id), ignore_errors=True)
    return result


def validate_voice(*, sqlite_path: str, voice_root: str, voice_id: str) -> dict:
    voice = storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    return validate_voice_profile(voice=voice, voice_root=voice_root)


def validate_voice_profile(*, voice: dict, voice_root: str) -> dict:
    errors: list[dict] = []
    warnings: list[dict] = []
    mode = voice["mode"]
    if not voice["display_name"].strip():
        errors.append(
            _issue("missing_display_name", "display_name", "display_name is required")
        )
    if mode not in {"designed", "clone", "hifi_clone"}:
        errors.append(
            _issue(
                "invalid_mode",
                "mode",
                "mode must be designed, clone, or hifi_clone",
            )
        )
    if not 0.1 <= float(voice["temperature"]) <= 2.0:
        errors.append(
            _issue(
                "invalid_temperature",
                "temperature",
                "temperature must be between 0.1 and 2.0",
            )
        )
    if mode == "designed" and not _clean_optional(voice.get("control_text")):
        errors.append(
            _issue(
                "missing_control_text",
                "control_text",
                "designed voices require control_text",
            )
        )
    if mode == "clone":
        _validate_asset(
            voice.get("reference_audio_path"),
            "reference_audio_path",
            voice_root,
            errors,
            warnings,
        )
    if mode == "hifi_clone":
        _validate_asset(
            voice.get("prompt_audio_path"),
            "prompt_audio_path",
            voice_root,
            errors,
            warnings,
        )
        if not _clean_optional(voice.get("prompt_text")):
            errors.append(
                _issue(
                    "missing_prompt_text",
                    "prompt_text",
                    "hifi_clone voices require prompt_text",
                )
            )
    return {
        "voice_id": voice["id"],
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
    }


def _preview_inputs_changed(*, existing: dict, fields: dict) -> bool:
    preview_fields = {
        "mode",
        "control_text",
        "prompt_text",
        "temperature",
        "reference_audio_path",
        "prompt_audio_path",
    }
    return any(
        field in fields and fields[field] != existing.get(field)
        for field in preview_fields
    )


def create_preview(*, sqlite_path: str, voice_root: str, voice_id: str) -> dict:
    voice = storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    report = validate_voice_profile(voice=voice, voice_root=voice_root)
    if report["errors"]:
        raise VoiceValidationError(report)
    previews_dir = _voice_dir(voice_root, voice_id) / "previews"
    if previews_dir.exists():
        shutil.rmtree(previews_dir)
    preview = _generate_preview(voice=voice, voice_root=voice_root)
    storage.update_voice(
        sqlite_path=sqlite_path,
        voice_id=voice_id,
        fields={
            "preview_audio_path": preview["audio_path"],
            "preview_sentence": preview["sentence"],
        },
    )
    output_name = Path(preview["audio_path"]).name
    return {
        "voice_id": voice_id,
        "sentence": preview["sentence"],
        "audio_path": preview["audio_path"],
        "audio_url": f"/api/voices/{voice_id}/preview-file/{output_name}",
    }


def generate_workbench_audio(
    *, sqlite_path: str, voice_root: str, voice_id: str, text: str
) -> dict:
    voice = storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    report = validate_voice_profile(voice=voice, voice_root=voice_root)
    if report["errors"]:
        raise VoiceValidationError(report)
    clean_text = text.strip()
    if not clean_text:
        raise VoiceValidationError(
            {"errors": [_issue("missing_text", "text", "text is required")]}
        )
    workbench_dir = _voice_dir(voice_root, voice_id) / "workbench"
    workbench_dir.mkdir(parents=True, exist_ok=True)
    output_path = workbench_dir / f"workbench_{uuid4().hex}.wav"
    generate_qwen_preview(voice=voice, text=clean_text, output_path=output_path)
    audio_path = _relative_to_root(output_path, voice_root)
    output_name = Path(audio_path).name
    return {
        "voice_id": voice_id,
        "text": clean_text,
        "audio_path": audio_path,
        "audio_url": f"/api/voices/{voice_id}/workbench-file/{output_name}",
    }


def _generate_preview(*, voice: dict, voice_root: str) -> dict:
    sentence = random.choice(PREVIEW_SENTENCES)
    previews_dir = _voice_dir(voice_root, voice["id"]) / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)
    output_path = previews_dir / f"preview_{uuid4().hex}.wav"
    generate_qwen_preview(voice=voice, text=sentence, output_path=output_path)
    return {
        "audio_path": _relative_to_root(output_path, voice_root),
        "sentence": sentence,
    }


def get_preview_file(*, voice_root: str, voice_id: str, filename: str) -> Path:
    path = _voice_dir(voice_root, voice_id) / "previews" / filename
    _assert_inside_root(path, voice_root)
    if not path.exists():
        raise storage.VoiceNotFoundError(f"preview not found: {filename}")
    return path


def get_workbench_file(*, voice_root: str, voice_id: str, filename: str) -> Path:
    path = _voice_dir(voice_root, voice_id) / "workbench" / filename
    _assert_inside_root(path, voice_root)
    if not path.exists():
        raise storage.VoiceNotFoundError(f"workbench audio not found: {filename}")
    return path


def storage_path_exists(*, sqlite_path: str, voice_id: str) -> bool:
    try:
        storage.get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    except storage.VoiceNotFoundError:
        return False
    return True


def _save_upload(
    *, upload: UploadFile, voice_dir: Path, voice_root: str, stem: str
) -> str:
    filename = upload.filename or ""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise VoiceValidationError(
            {
                "errors": [
                    _issue(
                        "invalid_audio_extension", stem, "unsupported audio extension"
                    )
                ]
            }
        )
    dest = voice_dir / f"{stem}{ext}"
    _assert_inside_root(dest, voice_root)
    with dest.open("wb") as handle:
        while chunk := upload.file.read(1024 * 1024):
            handle.write(chunk)
    if dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise VoiceValidationError(
            {
                "errors": [
                    _issue("empty_audio_file", stem, "uploaded audio file is empty")
                ]
            }
        )
    return _relative_to_root(dest, voice_root)


def _validate_asset(
    rel_path: str | None,
    field: str,
    voice_root: str,
    errors: list[dict],
    warnings: list[dict],
) -> None:
    if not rel_path:
        errors.append(_issue(f"missing_{field}", field, f"{field} is required"))
        return
    path = Path(voice_root) / rel_path
    try:
        _assert_inside_root(path, voice_root)
    except UnsafeAssetPathError:
        errors.append(
            _issue(
                "unsafe_asset_path",
                field,
                "asset path must stay inside voice storage",
            )
        )
        return
    if path.suffix.lower() not in ALLOWED_AUDIO_EXTENSIONS:
        errors.append(
            _issue("invalid_audio_extension", field, "unsupported audio extension")
        )
    if not path.exists():
        errors.append(_issue("missing_audio_file", field, "audio file does not exist"))
        return
    if path.stat().st_size == 0:
        errors.append(_issue("empty_audio_file", field, "audio file is empty"))
        return
    if shutil.which("ffprobe") is None:
        warnings.append(
            _issue(
                "ffprobe_unavailable",
                field,
                "audio metadata could not be inspected",
            )
        )
        return
    try:
        import subprocess

        subprocess.run(
            ["ffprobe", "-v", "error", "-show_format", "-show_streams", str(path)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except Exception:
        errors.append(
            _issue(
                "unreadable_audio",
                field,
                "audio file could not be read by ffprobe",
            )
        )

def _voice_dir(voice_root: str, voice_id: str) -> Path:
    path = Path(voice_root) / voice_id
    _assert_inside_root(path, voice_root)
    return path


def _assert_inside_root(path: Path, voice_root: str) -> None:
    root = Path(voice_root).resolve()
    resolved = path.resolve()
    if root != resolved and root not in resolved.parents:
        raise UnsafeAssetPathError("path escapes voice storage root")


def _relative_to_root(path: Path, voice_root: str) -> str:
    return str(path.resolve().relative_to(Path(voice_root).resolve()))


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _issue(code: str, field: str | None, message: str) -> dict:
    return {"code": code, "field": field, "message": message}
