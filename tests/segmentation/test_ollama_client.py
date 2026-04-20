import json

import pytest

from auralia_api.segmentation import ollama_client
from auralia_api.segmentation.ollama_client import OllamaError, generate_json


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_generate_json_parses_ollama_envelope(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):  # type: ignore[no-untyped-def]
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _FakeResponse(
            json.dumps(
                {
                    "response": '{"spans": []}',
                    "prompt_eval_count": 12,
                    "eval_count": 5,
                    "total_duration": 1_000_000,
                }
            ).encode("utf-8")
        )

    monkeypatch.setattr(ollama_client.urllib.request, "urlopen", fake_urlopen)

    result = generate_json(
        base_url="http://localhost:11434",
        model="qwen2.5:7b",
        system="sys",
        prompt="p",
        timeout_seconds=30.0,
    )

    assert captured["url"] == "http://localhost:11434/api/generate"
    assert captured["body"]["model"] == "qwen2.5:7b"
    assert captured["body"]["format"] == "json"
    assert captured["body"]["stream"] is False
    assert result.raw_text == '{"spans": []}'
    assert result.prompt_eval_count == 12
    assert result.eval_count == 5


def test_generate_json_wraps_transport_error(monkeypatch):
    def raising_urlopen(request, timeout):  # type: ignore[no-untyped-def]
        import urllib.error

        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(ollama_client.urllib.request, "urlopen", raising_urlopen)

    with pytest.raises(OllamaError, match="connection refused"):
        generate_json(
            base_url="http://localhost:11434",
            model="qwen2.5:7b",
            system="s",
            prompt="p",
            timeout_seconds=1.0,
        )


def test_generate_json_requires_response_field(monkeypatch):
    def fake_urlopen(request, timeout):  # type: ignore[no-untyped-def]
        return _FakeResponse(json.dumps({"other": "x"}).encode("utf-8"))

    monkeypatch.setattr(ollama_client.urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(OllamaError, match="response"):
        generate_json(
            base_url="http://localhost:11434",
            model="qwen2.5:7b",
            system="s",
            prompt="p",
            timeout_seconds=1.0,
        )


def test_generate_json_rejects_non_json_envelope(monkeypatch):
    def fake_urlopen(request, timeout):  # type: ignore[no-untyped-def]
        return _FakeResponse(b"<html>nope</html>")

    monkeypatch.setattr(ollama_client.urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(OllamaError, match="non-JSON"):
        generate_json(
            base_url="http://localhost:11434",
            model="qwen2.5:7b",
            system="s",
            prompt="p",
            timeout_seconds=1.0,
        )
