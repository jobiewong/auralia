from __future__ import annotations

import json
import os
import sys
import wave
from pathlib import Path
from typing import Any


def _status(message: str) -> None:
    print(f"[qwen-tts] {message}", file=sys.stderr, flush=True)


def main() -> int:
    payload = json.loads(sys.stdin.read())
    output_path = Path(payload["output_path"])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if os.environ.get("AURALIA_QWEN_TTS_TEST_FAKE") == "1":
        _write_test_wav(output_path)
        print(json.dumps({"output_path": str(output_path), "sample_rate": 16000}))
        return 0

    mode = payload.get("mode")
    if mode != "designed":
        raise ValueError(f"Unsupported Qwen preview mode: {mode}")

    _status("importing runtime packages")
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    device = str(payload.get("device") or "cuda:0")
    cuda_available = torch.cuda.is_available()
    _status(f"torch cuda_available={cuda_available} device={device}")
    if device.startswith("cuda") and not cuda_available:
        raise RuntimeError(
            f"Qwen TTS is configured for {device}, but torch.cuda.is_available() "
            "is False in the configured Python environment."
        )

    dtype = _torch_dtype(torch, str(payload.get("dtype") or "bfloat16"))
    model_kwargs = {
        "device_map": device,
        "dtype": dtype,
    }
    _status(f"loading model {payload['model']}")
    try:
        model = Qwen3TTSModel.from_pretrained(
            payload["model"],
            **model_kwargs,
            attn_implementation="flash_attention_2",
        )
    except Exception:
        _status("flash_attention_2 load failed; retrying without it")
        model = Qwen3TTSModel.from_pretrained(payload["model"], **model_kwargs)
    temperature = float(payload.get("temperature") or 0.9)
    _status(f"generating voice design preview temperature={temperature}")
    wavs, sr = model.generate_voice_design(
        text=payload["text"],
        language=payload.get("language") or "English",
        instruct=payload.get("instruct") or "",
        temperature=temperature,
        subtalker_temperature=temperature,
    )
    sf.write(str(output_path), wavs[0], sr)
    _status(f"wrote {output_path}")
    print(json.dumps({"output_path": str(output_path), "sample_rate": sr}))
    return 0


def _torch_dtype(torch_module: Any, value: str) -> Any:
    if value == "float16":
        return torch_module.float16
    if value == "float32":
        return torch_module.float32
    return torch_module.bfloat16


def _write_test_wav(path: Path) -> None:
    sample_rate = 16_000
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x01\x00" * (sample_rate // 10))


if __name__ == "__main__":
    raise SystemExit(main())
