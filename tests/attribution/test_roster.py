import pytest

from auralia_api.attribution.roster import extract_character_roster
from auralia_api.segmentation.ollama_client import OllamaError


def test_extract_character_roster_skips_llm_when_no_dialogue():
    roster, usage = extract_character_roster(
        document_text="No dialogue here.",
        has_dialogue=False,
        model="qwen3:8b",
        base_url="http://localhost:11434",
        timeout_seconds=1.0,
        max_retries=2,
    )

    assert roster == []
    assert usage["prompt_eval_count"] == 0


def test_extract_character_roster_retries_on_parse_error(monkeypatch):
    calls = {"n": 0}

    class _Resp:
        def __init__(self, raw_text, p=None, e=None):
            self.raw_text = raw_text
            self.prompt_eval_count = p
            self.eval_count = e

    def fake_generate_json(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Resp("not-json")
        return _Resp(
            (
                '{"characters":[{"canonical_name":"Harry","aliases":["Harry"],'
                '"descriptor":""}]}'
            ),
            p=10,
            e=4,
        )

    monkeypatch.setattr(
        "auralia_api.attribution.roster.generate_json", fake_generate_json
    )

    roster, usage = extract_character_roster(
        document_text='"Hi," Harry said.',
        has_dialogue=True,
        model="qwen3:8b",
        base_url="http://localhost:11434",
        timeout_seconds=1.0,
        max_retries=1,
    )

    assert calls["n"] == 2
    assert roster[0]["canonical_name"] == "Harry"
    assert usage["prompt_eval_count"] == 10


def test_extract_character_roster_raises_after_retries(monkeypatch):
    monkeypatch.setattr(
        "auralia_api.attribution.roster.generate_json",
        lambda **kwargs: (_ for _ in ()).throw(OllamaError("down")),
    )

    with pytest.raises(OllamaError):
        extract_character_roster(
            document_text='"Hi," Harry said.',
            has_dialogue=True,
            model="qwen3:8b",
            base_url="http://localhost:11434",
            timeout_seconds=1.0,
            max_retries=0,
        )
