from __future__ import annotations

import re
import shutil
import subprocess
import wave
from pathlib import Path


class AudioAssemblyError(RuntimeError):
    pass


def chunk_text_by_sentences(text: str, *, max_sentences: int = 3) -> list[str]:
    if max_sentences < 1:
        raise ValueError("max_sentences must be at least 1")
    sentences = _split_sentences(text)
    if len(sentences) <= max_sentences:
        return [text]
    chunks: list[str] = []
    for index in range(0, len(sentences), max_sentences):
        chunks.append("".join(sentences[index : index + max_sentences]))
    return chunks


def concatenate_wavs(
    input_paths: list[Path],
    output_path: Path,
    *,
    pause_ms: int = 0,
) -> None:
    if not input_paths:
        raise AudioAssemblyError("no audio clips to concatenate")
    if shutil.which("ffmpeg") is None:
        raise AudioAssemblyError("ffmpeg is required for audio assembly")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    work_dir = output_path.parent / f".concat_{output_path.stem}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        concat_inputs: list[Path] = []
        silence_path: Path | None = None
        if pause_ms > 0 and len(input_paths) > 1:
            silence_path = work_dir / f"silence_{pause_ms}ms.wav"
            _write_silence_like(input_paths[0], silence_path, pause_ms=pause_ms)
        for index, path in enumerate(input_paths):
            concat_inputs.append(path)
            if silence_path is not None and index < len(input_paths) - 1:
                concat_inputs.append(silence_path)

        list_path = work_dir / "inputs.txt"
        list_path.write_text(
            "".join(f"file '{_escape_concat_path(path)}'\n" for path in concat_inputs),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_path),
                "-c",
                "copy",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise AudioAssemblyError(result.stderr.strip() or "ffmpeg concat failed")
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise AudioAssemblyError("ffmpeg did not produce audio output")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def duration_ms(path: Path) -> int | None:
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate <= 0:
                return None
            return round((frames / rate) * 1000)
    except wave.Error:
        return None


def _split_sentences(text: str) -> list[str]:
    if not text:
        return [text]
    boundaries: list[int] = []
    for match in re.finditer(r"[.!?]+", text):
        boundary = match.end()
        while boundary < len(text) and text[boundary] in "\"')]}":
            boundary += 1
        if boundary == len(text) or text[boundary].isspace():
            boundaries.append(boundary)
    if not boundaries:
        return [text]

    sentences: list[str] = []
    start = 0
    for boundary in boundaries:
        sentences.append(text[start:boundary])
        start = boundary
    if start < len(text):
        sentences[-1] += text[start:]
    return [sentence for sentence in sentences if sentence]


def _write_silence_like(source_path: Path, output_path: Path, *, pause_ms: int) -> None:
    try:
        with wave.open(str(source_path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            frame_rate = source.getframerate()
    except wave.Error as exc:
        raise AudioAssemblyError(
            f"could not inspect source WAV: {source_path}"
        ) from exc

    frames = max(1, round(frame_rate * (pause_ms / 1000)))
    with wave.open(str(output_path), "wb") as silence:
        silence.setnchannels(channels)
        silence.setsampwidth(sample_width)
        silence.setframerate(frame_rate)
        silence.writeframes(b"\x00" * frames * channels * sample_width)


def _escape_concat_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "'\\''")
