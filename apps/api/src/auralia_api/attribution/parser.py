from __future__ import annotations

import json
from typing import Any


class AttributionParseError(ValueError):
    pass


def parse_roster_response(
    raw_text: str, *, require_non_empty: bool
) -> list[dict[str, Any]]:
    payload = _parse_json(raw_text)
    chars = payload.get("characters")
    if not isinstance(chars, list):
        raise AttributionParseError("roster payload missing 'characters' list")

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
) -> list[dict[str, Any]]:
    payload = _parse_json(raw_text)
    items = payload.get("attributions")
    if not isinstance(items, list):
        raise AttributionParseError("payload missing 'attributions' list")

    by_id: dict[str, dict[str, Any]] = {}
    for idx, row in enumerate(items):
        if not isinstance(row, dict):
            raise AttributionParseError(f"attributions[{idx}] must be object")
        span_id = row.get("id")
        speaker = row.get("speaker")
        confidence = row.get("speaker_confidence")
        if not isinstance(span_id, str):
            raise AttributionParseError("id must be string")
        if span_id in by_id:
            raise AttributionParseError("duplicate id in attribution payload")
        if not isinstance(speaker, str):
            raise AttributionParseError("speaker must be string")
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            raise AttributionParseError("confidence must be number")
        conf_f = float(confidence)
        if conf_f < 0 or conf_f > 1:
            raise AttributionParseError("confidence out of range [0,1]")
        if speaker not in roster_names and speaker != "UNKNOWN":
            raise AttributionParseError("speaker must be in roster or UNKNOWN")

        by_id[span_id] = {
            "id": span_id,
            "speaker": speaker,
            "speaker_confidence": conf_f,
        }

    expected = set(dialogue_ids)
    actual = set(by_id.keys())
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing:
        raise AttributionParseError(f"missing ids in attribution payload: {missing}")
    if extra:
        raise AttributionParseError(f"extra ids in attribution payload: {extra}")

    for locked_id, locked_speaker in locked_speakers.items():
        if by_id[locked_id]["speaker"] != locked_speaker:
            raise AttributionParseError("locked speaker was modified")

    return [by_id[span_id] for span_id in dialogue_ids]


def _parse_json(raw_text: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise AttributionParseError(f"invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise AttributionParseError("payload must be JSON object")
    return payload
