from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from auralia_api.config import get_settings

logger = logging.getLogger(__name__)


class VoicePreviewUnavailableError(RuntimeError):
    pass


def generate_qwen_preview(
    *,
    voice: dict[str, Any],
    text: str,
    output_path: Path,
) -> None:
    if voice["mode"] != "designed":
        raise VoicePreviewUnavailableError(
            f"Qwen preview is not implemented for {voice['mode']} voices yet"
        )

    settings = get_settings()
    if not settings.qwen_tts_python:
        raise VoicePreviewUnavailableError(
            "AURALIA_QWEN_TTS_PYTHON must point to the local Qwen3-TTS "
            "Python executable"
        )

    payload = {
        "mode": "designed",
        "text": text,
        "output_path": str(output_path),
        "language": settings.qwen_tts_default_language,
        "model": settings.qwen_tts_voice_design_model,
        "device": settings.qwen_tts_device,
        "dtype": settings.qwen_tts_dtype,
        "instruct": voice.get("control_text") or "",
        "temperature": voice.get("temperature", 0.9),
    }
    env = os.environ.copy()
    src_path = str(Path(__file__).resolve().parents[2])
    cache_dir = Path(settings.qwen_tts_numba_cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    env["PYTHONPATH"] = (
        src_path
        if not env.get("PYTHONPATH")
        else f"{src_path}{os.pathsep}{env['PYTHONPATH']}"
    )
    qwen_bin = str(Path(settings.qwen_tts_python).resolve().parent)
    env["PATH"] = (
        qwen_bin if not env.get("PATH") else f"{qwen_bin}{os.pathsep}{env['PATH']}"
    )
    env.setdefault("NUMBA_CACHE_DIR", str(cache_dir))
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.setdefault("TOKENIZERS_PARALLELISM", "false")
    command = [
        settings.qwen_tts_python,
        "-m",
        "auralia_api.voices.qwen_tts_cli",
    ]
    logger.info(
        "Starting Qwen TTS preview voice_id=%s model=%s device=%s output=%s",
        voice["id"],
        settings.qwen_tts_voice_design_model,
        settings.qwen_tts_device,
        output_path,
    )
    result = _run_qwen_subprocess(
        command=command,
        payload=payload,
        timeout_seconds=settings.qwen_tts_timeout_seconds,
        env=env,
    )

    if result["returncode"] != 0:
        detail = _tail(result["stderr"])
        raise VoicePreviewUnavailableError(
            detail
            or f"Qwen preview generation failed with exit code {result['returncode']}. "
            "See the FastAPI terminal for Qwen subprocess logs."
        )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise VoicePreviewUnavailableError("Qwen preview did not produce audio output")

    _parse_json_status(str(result["stdout"]))


def _run_qwen_subprocess(
    *,
    command: list[str],
    payload: dict[str, Any],
    timeout_seconds: float,
    env: dict[str, str],
) -> dict[str, str | int]:
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except OSError as exc:
        raise VoicePreviewUnavailableError(str(exc)) from exc

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    stdout_thread = threading.Thread(
        target=_collect_lines,
        args=(process.stdout, stdout_lines, None),
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=_collect_lines,
        args=(process.stderr, stderr_lines, sys.stderr),
        daemon=True,
    )
    stdout_thread.start()
    stderr_thread.start()

    assert process.stdin is not None
    process.stdin.write(json.dumps(payload))
    process.stdin.close()
    try:
        returncode = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.wait()
        raise VoicePreviewUnavailableError(
            f"Qwen preview generation timed out after {timeout_seconds:g} seconds"
        ) from exc

    stdout_thread.join(timeout=1)
    stderr_thread.join(timeout=1)
    return {
        "returncode": returncode,
        "stdout": "".join(stdout_lines),
        "stderr": "".join(stderr_lines),
    }


def _collect_lines(pipe: Any, lines: list[str], mirror: Any | None) -> None:
    if pipe is None:
        return
    for line in iter(pipe.readline, ""):
        lines.append(line)
        if mirror is not None:
            print(line, end="", file=mirror, flush=True)


def _tail(value: str, *, max_chars: int = 2000) -> str:
    return value.strip()[-max_chars:]


def _parse_json_status(stdout: str) -> dict[str, Any]:
    for line in reversed(stdout.splitlines()):
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        try:
            value = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise VoicePreviewUnavailableError(
        "Qwen preview completed but did not return a JSON status line"
    )
