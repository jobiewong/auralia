from auralia_api.validators.spans import run_all_span_validators


def test_run_all_span_validators_returns_no_errors_for_valid_payload():
    text = "abc"
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": text,
        "spans": [
            {"id": "s_1", "type": "narration", "text": "a", "start": 0, "end": 1},
            {"id": "s_2", "type": "dialogue", "text": "bc", "start": 1, "end": 3},
        ],
    }

    assert run_all_span_validators(payload) == []


def test_run_all_span_validators_short_circuits_when_schema_is_invalid():
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": "abc",
        "spans": [{"id": "s_1", "type": "other", "text": "abc", "start": 0, "end": 3}],
    }

    errors = run_all_span_validators(payload)
    assert errors
    codes = {e.code for e in errors}
    assert "SCHEMA_INVALID_TYPE" in codes


def test_run_all_span_validators_reports_coverage_empty_for_empty_span_list():
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": "abc",
        "spans": [],
    }

    errors = run_all_span_validators(payload)
    assert any(e.code == "COVERAGE_EMPTY" for e in errors)
