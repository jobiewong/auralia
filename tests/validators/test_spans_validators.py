from auralia_api.validators.spans import (
    ValidationError,
    validate_offset_text_consistency,
    validate_reconstruction,
    validate_span_boundaries,
    validate_span_contiguity,
    validate_span_coverage,
    validate_span_non_overlap,
)


def sample_text() -> str:
    return "Hello world.\n\"Hi, Ron,\" said Hermione."


def valid_spans():
    text = sample_text()
    return [
        {"id": "s_000001", "type": "narration", "text": text[:13], "start": 0, "end": 13},
        {"id": "s_000002", "type": "dialogue", "text": text[13:], "start": 13, "end": len(text)},
    ]


def test_contiguity_passes_for_valid_spans():
    errors = validate_span_contiguity(valid_spans())
    assert errors == []


def test_contiguity_fails_when_gap_exists():
    spans = valid_spans()
    spans[1]["start"] = spans[1]["start"] + 1
    errors = validate_span_contiguity(spans)
    assert len(errors) == 1
    assert errors[0].code == "CONTIGUITY_GAP"


def test_non_overlap_fails_when_overlap_exists():
    spans = valid_spans()
    spans[1]["start"] = spans[0]["end"] - 1
    errors = validate_span_non_overlap(spans)
    assert len(errors) == 1
    assert errors[0].code == "OVERLAP"


def test_coverage_fails_when_first_span_does_not_start_at_zero():
    spans = valid_spans()
    spans[0]["start"] = 1
    errors = validate_span_coverage(spans, sample_text())
    assert any(e.code == "COVERAGE_START" for e in errors)


def test_coverage_fails_when_final_end_is_not_text_length():
    spans = valid_spans()
    spans[-1]["end"] = spans[-1]["end"] - 1
    errors = validate_span_coverage(spans, sample_text())
    assert any(e.code == "COVERAGE_END" for e in errors)


def test_reconstruction_fails_when_joined_span_text_does_not_match_source_text():
    spans = valid_spans()
    spans[1]["text"] = spans[1]["text"] + "!"
    errors = validate_reconstruction(spans, sample_text())
    assert len(errors) == 1
    assert errors[0].code == "RECONSTRUCTION_MISMATCH"


def test_offset_text_consistency_fails_when_text_slice_differs():
    spans = valid_spans()
    spans[1]["text"] = "mismatch"
    errors = validate_offset_text_consistency(spans, sample_text())
    assert len(errors) == 1
    assert errors[0].code == "OFFSET_TEXT_MISMATCH"


def test_boundaries_fail_for_invalid_offsets():
    spans = valid_spans()
    spans[0]["end"] = spans[0]["start"]
    errors = validate_span_boundaries(spans, sample_text())
    assert any(e.code == "INVALID_OFFSETS" for e in errors)


def test_all_error_items_are_typed_validation_errors():
    spans = valid_spans()
    spans[0]["end"] = spans[0]["start"]
    errors = validate_span_boundaries(spans, sample_text())
    assert errors
    assert all(isinstance(e, ValidationError) for e in errors)
