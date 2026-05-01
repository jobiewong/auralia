from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(slots=True)
class ValidationError:
    code: str
    message: str
    span_id: str | None = None
    index: int | None = None
    details: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _error(
    code: str,
    message: str,
    *,
    span_id: str | None = None,
    index: int | None = None,
    details: dict[str, Any] | None = None,
) -> ValidationError:
    return ValidationError(
        code=code, message=message, span_id=span_id, index=index, details=details
    )


def _required_top_level_fields() -> dict[str, type]:
    return {
        "source_id": str,
        "chapter_id": str,
        "text": str,
        "spans": list,
    }


def validate_spans_payload_schema(payload: dict[str, Any]) -> list[ValidationError]:
    errors: list[ValidationError] = []

    for field, expected_type in _required_top_level_fields().items():
        if field not in payload:
            errors.append(
                _error(
                    "SCHEMA_MISSING_FIELD",
                    f"Missing required field: {field}",
                    details={"field": field},
                )
            )
            continue

        if not isinstance(payload[field], expected_type):
            errors.append(
                _error(
                    "SCHEMA_INVALID_TYPE",
                    f"Field '{field}' must be of type {expected_type.__name__}",
                    details={"field": field, "expected": expected_type.__name__},
                )
            )

    spans = payload.get("spans", [])
    if not isinstance(spans, list):
        return errors

    for i, span in enumerate(spans):
        if not isinstance(span, dict):
            errors.append(
                _error("SCHEMA_INVALID_TYPE", "Each span must be an object", index=i)
            )
            continue

        for f in ("id", "type", "text", "start", "end"):
            if f not in span:
                errors.append(
                    _error(
                        "SCHEMA_MISSING_FIELD",
                        f"Span missing required field: {f}",
                        index=i,
                        details={"field": f},
                    )
                )

        span_type = span.get("type")
        if span_type is not None and span_type not in {"narration", "dialogue"}:
            errors.append(
                _error(
                    "SCHEMA_INVALID_TYPE",
                    "Span field 'type' must be one of: narration, dialogue",
                    span_id=span.get("id"),
                    index=i,
                    details={"field": "type", "value": span_type},
                )
            )

        if "start" in span and (
            not isinstance(span["start"], int) or isinstance(span["start"], bool)
        ):
            errors.append(
                _error(
                    "SCHEMA_INVALID_TYPE",
                    "Span field 'start' must be integer",
                    span_id=span.get("id"),
                    index=i,
                )
            )

        if "end" in span and (
            not isinstance(span["end"], int) or isinstance(span["end"], bool)
        ):
            errors.append(
                _error(
                    "SCHEMA_INVALID_TYPE",
                    "Span field 'end' must be integer",
                    span_id=span.get("id"),
                    index=i,
                )
            )

        if "text" in span and not isinstance(span["text"], str):
            errors.append(
                _error(
                    "SCHEMA_INVALID_TYPE",
                    "Span field 'text' must be string",
                    span_id=span.get("id"),
                    index=i,
                )
            )

    return errors


def validate_span_boundaries(
    spans: list[dict[str, Any]], text: str
) -> list[ValidationError]:
    errors: list[ValidationError] = []
    text_length = len(text)

    for i, span in enumerate(spans):
        start = span["start"]
        end = span["end"]

        if start < 0 or end < 0 or start >= end or end > text_length:
            errors.append(
                _error(
                    "INVALID_OFFSETS",
                    "Span offsets must satisfy 0 <= start < end <= text_length",
                    span_id=span.get("id"),
                    index=i,
                    details={"start": start, "end": end, "text_length": text_length},
                )
            )

    return errors


def validate_span_contiguity(spans: list[dict[str, Any]]) -> list[ValidationError]:
    errors: list[ValidationError] = []
    for i in range(1, len(spans)):
        prev = spans[i - 1]
        curr = spans[i]
        if curr["start"] != prev["end"]:
            errors.append(
                _error(
                    "CONTIGUITY_GAP",
                    "Adjacent spans must be contiguous (next.start == prev.end)",
                    span_id=curr.get("id"),
                    index=i,
                    details={"prev_end": prev["end"], "next_start": curr["start"]},
                )
            )
    return errors


def validate_span_non_overlap(spans: list[dict[str, Any]]) -> list[ValidationError]:
    errors: list[ValidationError] = []
    for i in range(1, len(spans)):
        prev = spans[i - 1]
        curr = spans[i]
        if curr["start"] < prev["end"]:
            errors.append(
                _error(
                    "OVERLAP",
                    "Spans must not overlap",
                    span_id=curr.get("id"),
                    index=i,
                    details={"prev_end": prev["end"], "next_start": curr["start"]},
                )
            )
    return errors


def validate_span_coverage(
    spans: list[dict[str, Any]], text: str
) -> list[ValidationError]:
    errors: list[ValidationError] = []
    if not spans:
        errors.append(
            _error("COVERAGE_EMPTY", "At least one span is required for non-empty text")
        )
        return errors

    if spans[0]["start"] != 0:
        errors.append(
            _error(
                "COVERAGE_START",
                "First span must start at 0",
                span_id=spans[0].get("id"),
                index=0,
                details={"start": spans[0]["start"]},
            )
        )

    expected_end = len(text)
    if spans[-1]["end"] != expected_end:
        errors.append(
            _error(
                "COVERAGE_END",
                "Final span end must equal len(text)",
                span_id=spans[-1].get("id"),
                index=len(spans) - 1,
                details={"end": spans[-1]["end"], "expected": expected_end},
            )
        )

    return errors


def validate_reconstruction(
    spans: list[dict[str, Any]], text: str
) -> list[ValidationError]:
    joined = "".join(span["text"] for span in spans)
    if joined == text:
        return []

    return [
        _error(
            "RECONSTRUCTION_MISMATCH",
            "Joined span text must exactly reconstruct source text",
            details={"joined_length": len(joined), "text_length": len(text)},
        )
    ]


def validate_offset_text_consistency(
    spans: list[dict[str, Any]], text: str
) -> list[ValidationError]:
    errors: list[ValidationError] = []
    for i, span in enumerate(spans):
        slice_text = text[span["start"] : span["end"]]
        if slice_text != span["text"]:
            errors.append(
                _error(
                    "OFFSET_TEXT_MISMATCH",
                    "Span text must match source text slice for [start:end]",
                    span_id=span.get("id"),
                    index=i,
                    details={"expected": slice_text, "actual": span["text"]},
                )
            )
    return errors


def run_all_span_validators(payload: dict[str, Any]) -> list[ValidationError]:
    errors = validate_spans_payload_schema(payload)
    if errors:
        return errors

    text = payload["text"]
    spans = payload["spans"]

    errors.extend(validate_span_boundaries(spans, text))
    errors.extend(validate_span_contiguity(spans))
    errors.extend(validate_span_non_overlap(spans))
    errors.extend(validate_span_coverage(spans, text))
    errors.extend(validate_reconstruction(spans, text))
    errors.extend(validate_offset_text_consistency(spans, text))

    return errors
