from __future__ import annotations

import json
from typing import Any

from auralia_api.attribution.parser import AttributionParseError


def parse_cast_response(raw_text: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise AttributionParseError(
            f"invalid JSON: {exc}", raw_response=raw_text
        ) from exc
    roster = _characters_from_payload(payload, raw_text=raw_text)
    parsed: list[dict[str, Any]] = []
    for idx, row in enumerate(roster):
        if not isinstance(row, dict):
            raise AttributionParseError(f"character[{idx}] must be object")
        canonical = row.get("canonical_name")
        aliases = row.get("aliases")
        descriptor = row.get("descriptor")
        if not isinstance(canonical, str) or not canonical.strip():
            raise AttributionParseError("canonical_name must be non-empty string")
        if not isinstance(aliases, list) or any(
            not isinstance(alias, str) for alias in aliases
        ):
            raise AttributionParseError("aliases must be list[str]")
        confidence = row.get("confidence", 0.8)
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            raise AttributionParseError("cast confidence must be number")
        conf_f = float(confidence)
        if conf_f < 0 or conf_f > 1:
            raise AttributionParseError("cast confidence out of range [0,1]")
        needs_review = row.get("needs_review", conf_f < 0.7)
        parsed.append(
            {
                "canonical_name": canonical,
                "aliases": aliases,
                "descriptor": descriptor if isinstance(descriptor, str) else "",
                "confidence": conf_f,
                "needs_review": bool(needs_review),
                "source": "deterministic_llm",
            }
        )
    return parsed


def _characters_from_payload(payload: Any, *, raw_text: str) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("characters", "roster", "character", "cast"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    raise AttributionParseError(
        "cast payload missing 'characters' list",
        raw_response=raw_text,
    )
