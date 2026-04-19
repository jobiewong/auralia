from auralia_api.validators.spans import validate_spans_payload_schema


def test_schema_validation_passes_for_valid_payload():
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": "abc",
        "spans": [
            {"id": "s_1", "type": "narration", "text": "a", "start": 0, "end": 1},
            {"id": "s_2", "type": "dialogue", "text": "bc", "start": 1, "end": 3},
        ],
    }

    errors = validate_spans_payload_schema(payload)
    assert errors == []


def test_schema_validation_fails_for_missing_required_top_level_fields():
    payload = {"text": "abc", "spans": []}

    errors = validate_spans_payload_schema(payload)
    codes = {e.code for e in errors}
    assert "SCHEMA_MISSING_FIELD" in codes


def test_schema_validation_fails_for_invalid_span_type():
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": "abc",
        "spans": [{"id": "s_1", "type": "other", "text": "a", "start": 0, "end": 1}],
    }

    errors = validate_spans_payload_schema(payload)
    assert any(e.code == "SCHEMA_INVALID_TYPE" for e in errors)


def test_schema_validation_fails_when_spans_is_not_a_list():
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": "abc",
        "spans": "not-a-list",
    }

    errors = validate_spans_payload_schema(payload)
    assert any(e.code == "SCHEMA_INVALID_TYPE" for e in errors)


def test_schema_validation_rejects_boolean_offsets():
    payload = {
        "source_id": "ao3:work:123456",
        "chapter_id": "ch_01",
        "text": "abc",
        "spans": [{"id": "s_1", "type": "dialogue", "text": "a", "start": True, "end": 1}],
    }

    errors = validate_spans_payload_schema(payload)
    assert any(e.code == "SCHEMA_INVALID_TYPE" for e in errors)
