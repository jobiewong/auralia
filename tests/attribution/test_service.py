import pytest

from auralia_api.attribution.parser import AttributionParseError
from auralia_api.attribution.service import (
    AttributionValidationError,
    _attribute_window_with_retries,
    _merge_attributions,
)


def test_merge_attributions_marks_unknown_for_missing_llm_rows():
    merged = _merge_attributions(
        dialogue_ids=["d1", "d2"],
        resolved={"d1": {"speaker": "Harry"}},
        llm_rows={},
        confidence_threshold=0.7,
    )

    assert merged[0]["speaker"] == "Harry"
    assert merged[0]["source"] == "deterministic_tag"
    assert merged[1]["speaker"] == "UNKNOWN"
    assert merged[1]["needs_review"] is True


def test_merge_attributions_applies_review_threshold():
    merged = _merge_attributions(
        dialogue_ids=["d1"],
        resolved={},
        llm_rows={
            "d1": {
                "speaker": "Ron",
                "speaker_confidence": 0.65,
                "source": "llm_windowed",
            }
        },
        confidence_threshold=0.7,
    )

    assert merged[0]["speaker"] == "Ron"
    assert merged[0]["needs_review"] is True


def test_attribute_window_retries_on_parse_error(monkeypatch):
    calls = {"n": 0}

    class _Resp:
        def __init__(self, raw_text, p=None, e=None):
            self.raw_text = raw_text
            self.prompt_eval_count = p
            self.eval_count = e

    def fake_generate_json(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Resp('{"attributions":[{"id":"d1","speaker":"Harry"}]}')
        return _Resp(
            '{"attributions":[{"id":"d1","speaker":"Harry","speaker_confidence":0.9}]}',
            p=11,
            e=5,
        )

    monkeypatch.setattr(
        "auralia_api.attribution.service.generate_json", fake_generate_json
    )

    rows, usage = _attribute_window_with_retries(
        roster=[{"canonical_name": "Harry", "aliases": ["Harry"], "descriptor": ""}],
        window={
            "pre_context": "",
            "post_context": "",
            "blocks": [
                {"id": "d1", "type": "dialogue", "text": '"Hi"', "locked": False}
            ],
        },
        model_name="qwen3:8b",
        base_url="http://localhost:11434",
        timeout_seconds=1.0,
        max_retries=1,
    )

    assert calls["n"] == 2
    assert rows[0]["speaker"] == "Harry"
    assert usage == {"prompt_eval_count": 11, "eval_count": 5}


def test_attribute_window_raises_after_retry_exhausted(monkeypatch):
    class _Resp:
        def __init__(self, raw_text):
            self.raw_text = raw_text
            self.prompt_eval_count = None
            self.eval_count = None

    monkeypatch.setattr(
        "auralia_api.attribution.service.generate_json",
        lambda **kwargs: _Resp('{"attributions":[{"id":"d1","speaker":"Harry"}]}'),
    )

    with pytest.raises(AttributionParseError):
        _attribute_window_with_retries(
            roster=[
                {"canonical_name": "Harry", "aliases": ["Harry"], "descriptor": ""}
            ],
            window={
                "pre_context": "",
                "post_context": "",
                "blocks": [
                    {"id": "d1", "type": "dialogue", "text": '"Hi"', "locked": False}
                ],
            },
            model_name="qwen3:8b",
            base_url="http://localhost:11434",
            timeout_seconds=1.0,
            max_retries=0,
        )


def test_validation_error_exposes_report_and_job_id():
    report = {"ok": False, "errors": [{"code": "X"}]}
    exc = AttributionValidationError(report=report, job_id="attr_123")
    assert exc.report == report
    assert exc.job_id == "attr_123"
