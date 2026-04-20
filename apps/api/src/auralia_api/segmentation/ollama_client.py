from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass


class OllamaError(RuntimeError):
    """Transport or server error talking to Ollama."""


@dataclass(slots=True)
class OllamaResponse:
    raw_text: str
    prompt_eval_count: int | None
    eval_count: int | None
    total_duration_ns: int | None


def generate_json(
    *,
    base_url: str,
    model: str,
    system: str,
    prompt: str,
    timeout_seconds: float,
) -> OllamaResponse:
    """Call Ollama's /api/generate with format=json and stream=false.

    The caller is responsible for parsing raw_text into its domain model and for
    applying any retry logic on malformed output.
    """
    endpoint = base_url.rstrip("/") + "/api/generate"
    payload = {
        "model": model,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.0},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            body = response.read()
    except urllib.error.URLError as exc:
        raise OllamaError(f"Ollama request failed: {exc}") from exc
    except TimeoutError as exc:
        raise OllamaError("Ollama request timed out") from exc

    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OllamaError(f"Ollama returned non-JSON envelope: {exc}") from exc

    raw_text = parsed.get("response")
    if not isinstance(raw_text, str):
        raise OllamaError("Ollama envelope missing 'response' field")

    return OllamaResponse(
        raw_text=raw_text,
        prompt_eval_count=_as_int(parsed.get("prompt_eval_count")),
        eval_count=_as_int(parsed.get("eval_count")),
        total_duration_ns=_as_int(parsed.get("total_duration")),
    )


def _as_int(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None
