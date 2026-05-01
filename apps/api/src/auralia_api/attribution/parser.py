from __future__ import annotations

import json
from typing import Any


class AttributionParseError(ValueError):
    def __init__(self, message: str, *, raw_response: str | None = None) -> None:
        super().__init__(message)
        self.raw_response = raw_response


def parse_roster_response(
    raw_text: str, *, require_non_empty: bool
) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise AttributionParseError(
            f"invalid JSON: {exc}", raw_response=raw_text
        ) from exc

    chars: Any = None
    if isinstance(payload, list):
        chars = payload
    elif isinstance(payload, dict):
        for key in ("characters", "roster", "character", "cast"):
            value = payload.get(key)
            if isinstance(value, list):
                chars = value
                break
    if not isinstance(chars, list):
        raise AttributionParseError(
            "roster payload missing 'characters' list",
            raw_response=raw_text,
        )

    parsed: list[dict[str, Any]] = []
    seen_canonicals: set[str] = set()
    seen_aliases: set[str] = set()

    for idx, row in enumerate(chars):
        if not isinstance(row, dict):
            raise AttributionParseError(f"character[{idx}] must be object")
        canonical = row.get("canonical_name")
        aliases = row.get("aliases")
        descriptor = row.get("descriptor")
        if not isinstance(canonical, str) or not canonical.strip():
            raise AttributionParseError("canonical_name must be non-empty string")
        if canonical in seen_canonicals:
            raise AttributionParseError("duplicate canonical name in roster")
        if not isinstance(aliases, list) or any(
            not isinstance(a, str) for a in aliases
        ):
            raise AttributionParseError("aliases must be list[str]")

        normalized_aliases: list[str] = []
        for alias in aliases:
            if alias in seen_aliases:
                raise AttributionParseError("shared alias across canonical names")
            seen_aliases.add(alias)
            normalized_aliases.append(alias)

        seen_canonicals.add(canonical)
        parsed.append(
            {
                "canonical_name": canonical,
                "aliases": normalized_aliases,
                "descriptor": descriptor if isinstance(descriptor, str) else "",
            }
        )

    if require_non_empty and not parsed:
        raise AttributionParseError("roster must be non-empty when dialogue exists")

    return parsed


def parse_window_attributions(
    raw_text: str,
    *,
    dialogue_ids: list[str],
    locked_speakers: dict[str, str],
    roster_names: set[str],
    alias_to_canonical: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    payload = _parse_json(raw_text, raw_text_for_error=raw_text)
    items = payload.get("attributions")
    if not isinstance(items, list):
        raise AttributionParseError(
            "payload missing 'attributions' list", raw_response=raw_text
        )

    alias_map = alias_to_canonical or {}
    roster_lower = {name.lower(): name for name in roster_names}
    alias_lower = {k.lower(): v for k, v in alias_map.items()}

    by_id: dict[str, dict[str, Any]] = {}
    for idx, row in enumerate(items):
        if not isinstance(row, dict):
            raise AttributionParseError(
                f"attributions[{idx}] must be object", raw_response=raw_text
            )
        span_id = row.get("id")
        speaker = row.get("speaker")
        confidence = row.get("speaker_confidence")
        if not isinstance(span_id, str):
            raise AttributionParseError("id must be string", raw_response=raw_text)
        if span_id in by_id:
            raise AttributionParseError(
                "duplicate id in attribution payload", raw_response=raw_text
            )
        if not isinstance(speaker, str):
            raise AttributionParseError(
                "speaker must be string", raw_response=raw_text
            )
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            raise AttributionParseError(
                "confidence must be number", raw_response=raw_text
            )
        conf_f = float(confidence)
        if conf_f < 0 or conf_f > 1:
            raise AttributionParseError(
                "confidence out of range [0,1]", raw_response=raw_text
            )

        resolved_speaker, coerced = _resolve_speaker(
            speaker=speaker,
            roster_names=roster_names,
            alias_map=alias_map,
            roster_lower=roster_lower,
            alias_lower=alias_lower,
        )
        resolved_conf = 0.0 if coerced else conf_f

        by_id[span_id] = {
            "id": span_id,
            "speaker": resolved_speaker,
            "speaker_confidence": resolved_conf,
        }

    expected = set(dialogue_ids)
    actual = set(by_id.keys())
    missing = sorted(expected - actual)
    if missing:
        raise AttributionParseError(
            f"missing ids in attribution payload: {missing}",
            raw_response=raw_text,
        )

    for locked_id, locked_speaker in locked_speakers.items():
        if by_id[locked_id]["speaker"] != locked_speaker:
            raise AttributionParseError(
                "locked speaker was modified", raw_response=raw_text
            )

    return [by_id[span_id] for span_id in dialogue_ids]


def _resolve_speaker(
    *,
    speaker: str,
    roster_names: set[str],
    alias_map: dict[str, str],
    roster_lower: dict[str, str],
    alias_lower: dict[str, str],
) -> tuple[str, bool]:
    if speaker == "UNKNOWN":
        return "UNKNOWN", False
    if speaker in roster_names:
        return speaker, False
    if speaker in alias_map:
        return alias_map[speaker], False
    lowered = speaker.lower()
    if lowered in roster_lower:
        return roster_lower[lowered], False
    if lowered in alias_lower:
        return alias_lower[lowered], False
    return "UNKNOWN", True


def _parse_json(
    raw_text: str, *, raw_text_for_error: str | None = None
) -> dict[str, Any]:
    snippet = raw_text_for_error if raw_text_for_error is not None else raw_text
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise AttributionParseError(
            f"invalid JSON: {exc}", raw_response=snippet
        ) from exc
    if not isinstance(payload, dict):
        raise AttributionParseError(
            "payload must be JSON object", raw_response=snippet
        )
    return payload
