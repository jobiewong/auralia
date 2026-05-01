from __future__ import annotations

from typing import Any

from auralia_api.validators.spans import ValidationError


def run_all_attribution_validators(
    *,
    spans: list[dict[str, Any]],
    attributions: list[dict[str, Any]],
    roster_names: set[str],
    threshold: float,
) -> list[ValidationError]:
    errors: list[ValidationError] = []

    span_type_by_id = {s["id"]: s["type"] for s in spans}
    dialogue_ids = {s["id"] for s in spans if s.get("type") == "dialogue"}

    seen: set[str] = set()
    attributed_dialogue_ids: set[str] = set()

    for i, row in enumerate(attributions):
        span_id = row.get("span_id")
        speaker = row.get("speaker")
        confidence = row.get("speaker_confidence")
        needs_review = row.get("needs_review")

        if not isinstance(span_id, str):
            errors.append(
                ValidationError(
                    code="ATTR_SPAN_ID_INVALID",
                    message="span_id must be string",
                    index=i,
                )
            )
            continue

        if span_id in seen:
            errors.append(
                ValidationError(
                    code="ATTR_DUPLICATE_SPAN_ID",
                    message="duplicate span_id in attribution set",
                    span_id=span_id,
                    index=i,
                )
            )
            continue
        seen.add(span_id)

        span_type = span_type_by_id.get(span_id)
        if span_type == "narration":
            errors.append(
                ValidationError(
                    code="ATTR_NARRATION_PRESENT",
                    message="narration span must not have attribution",
                    span_id=span_id,
                    index=i,
                )
            )
        elif span_type == "dialogue":
            attributed_dialogue_ids.add(span_id)
        else:
            errors.append(
                ValidationError(
                    code="ATTR_SPAN_NOT_FOUND",
                    message="attribution references unknown span_id",
                    span_id=span_id,
                    index=i,
                )
            )

        if not isinstance(speaker, str):
            errors.append(
                ValidationError(
                    code="ATTR_SPEAKER_INVALID",
                    message="speaker must be string",
                    span_id=span_id,
                    index=i,
                )
            )
        elif speaker != "UNKNOWN" and speaker not in roster_names:
            errors.append(
                ValidationError(
                    code="ATTR_SPEAKER_INVALID",
                    message="speaker must be roster canonical or UNKNOWN",
                    span_id=span_id,
                    index=i,
                )
            )

        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            errors.append(
                ValidationError(
                    code="ATTR_CONFIDENCE_INVALID",
                    message="speaker_confidence must be numeric",
                    span_id=span_id,
                    index=i,
                )
            )
        else:
            conf_f = float(confidence)
            if conf_f < 0 or conf_f > 1:
                errors.append(
                    ValidationError(
                        code="ATTR_CONFIDENCE_RANGE",
                        message="speaker_confidence must be within [0, 1]",
                        span_id=span_id,
                        index=i,
                    )
                )
            if speaker == "UNKNOWN" and conf_f >= threshold:
                errors.append(
                    ValidationError(
                        code="ATTR_UNKNOWN_HIGH_CONFIDENCE",
                        message=(
                            "UNKNOWN attribution should have confidence "
                            "below threshold"
                        ),
                        span_id=span_id,
                        index=i,
                    )
                )

        if speaker == "UNKNOWN" and needs_review is not True:
            errors.append(
                ValidationError(
                    code="ATTR_UNKNOWN_REVIEW_REQUIRED",
                    message="UNKNOWN attribution must set needs_review=true",
                    span_id=span_id,
                    index=i,
                )
            )

    missing = sorted(dialogue_ids - attributed_dialogue_ids)
    for span_id in missing:
        errors.append(
            ValidationError(
                code="ATTR_DIALOGUE_MISSING",
                message="dialogue span missing attribution",
                span_id=span_id,
            )
        )

    return errors
