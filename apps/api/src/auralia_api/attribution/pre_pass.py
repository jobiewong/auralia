from __future__ import annotations

import re
from typing import Any

VERBS = [
    "said",
    "asked",
    "replied",
    "answered",
    "checked",
    "thought",
    "whispered",
    "shouted",
    "yelled",
    "called",
    "cried",
    "murmured",
    "muttered",
    "added",
    "continued",
    "snapped",
    "drawled",
    "cheered",
    "breathed",
    "hissed",
    "ribbed",
    "growled",
    "declared",
    "grumbled",
    "sighed",
    "exclaimed",
    "mumbled",
    "remarked",
    "gasped",
    "laughed",
    "grinned",
    "agreed",
    "admitted",
    "protested",
    "insisted",
    "interrupted",
]

_VERB_ALT = "|".join(re.escape(v) for v in VERBS)


def resolve_dialogue_spans_deterministically(
    *,
    spans: list[dict[str, Any]],
    roster: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Resolve obvious dialogue speaker tags from adjacent narration spans."""
    alias_to_canonical = _build_alias_map(roster)
    if not alias_to_canonical:
        return {}, [s["id"] for s in spans if s.get("type") == "dialogue"]

    resolved: dict[str, dict[str, Any]] = {}
    unresolved: list[str] = []

    for idx, span in enumerate(spans):
        if span.get("type") != "dialogue":
            continue

        candidates: set[str] = set()

        prev_text = _adjacent_text(spans, idx - 1)
        if prev_text is not None:
            candidates.update(_match_pre_dialogue(prev_text, alias_to_canonical))

        next_text = _adjacent_text(spans, idx + 1)
        if next_text is not None:
            candidates.update(_match_post_dialogue(next_text, alias_to_canonical))

        if len(candidates) == 1:
            speaker = next(iter(candidates))
            resolved[span["id"]] = {
                "speaker": speaker,
                "speaker_confidence": 1.0,
                "source": "deterministic_tag",
            }
        else:
            unresolved.append(span["id"])

    return resolved, unresolved


def _adjacent_text(spans: list[dict[str, Any]], idx: int) -> str | None:
    if idx < 0 or idx >= len(spans):
        return None
    span = spans[idx]
    if span.get("type") != "narration":
        return None
    text = span.get("text")
    if isinstance(text, str):
        return text
    return None


def _build_alias_map(roster: list[dict[str, Any]]) -> dict[str, str]:
    alias_to_canonical: dict[str, str] = {}
    for row in roster:
        canonical = row.get("canonical_name")
        aliases = row.get("aliases")
        if not isinstance(canonical, str):
            continue
        if not isinstance(aliases, list):
            continue

        alias_to_canonical[canonical] = canonical
        for alias in aliases:
            if isinstance(alias, str):
                alias_to_canonical[alias] = canonical

    return alias_to_canonical


def _match_post_dialogue(text: str, alias_map: dict[str, str]) -> set[str]:
    candidates: set[str] = set()
    aliases = sorted(alias_map.keys(), key=len, reverse=True)

    for alias in aliases:
        escaped = re.escape(alias)
        p1 = re.compile(
            rf"^\s*[,.!?]?\s*{escaped}\s+(?:{_VERB_ALT})\b(?:\s+\w+)?",
        )
        p2 = re.compile(
            rf"^\s*[,.!?]?\s*(?:{_VERB_ALT})\s+{escaped}\b(?:\s+\w+)?",
        )
        if p1.search(text) or p2.search(text):
            candidates.add(alias_map[alias])

    if _starts_with_tag_verb(text):
        aliases_in_text = _all_aliases_in_text(text, alias_map)
        if len(aliases_in_text) > 1:
            candidates.update(aliases_in_text)

    return candidates


def _match_pre_dialogue(text: str, alias_map: dict[str, str]) -> set[str]:
    candidates: set[str] = set()
    aliases = sorted(alias_map.keys(), key=len, reverse=True)

    for alias in aliases:
        escaped = re.escape(alias)
        p1 = re.compile(
            rf"{escaped}\s+(?:{_VERB_ALT})[,:]\s*$",
        )
        p2 = re.compile(
            rf"(?:{_VERB_ALT})\s+{escaped}[,:]\s*$",
        )
        if p1.search(text) or p2.search(text):
            candidates.add(alias_map[alias])

    return candidates


def _all_aliases_in_text(text: str, alias_map: dict[str, str]) -> set[str]:
    found: set[str] = set()
    for alias, canonical in alias_map.items():
        if re.search(rf"\b{re.escape(alias)}\b", text):
            found.add(canonical)
    return found


def _starts_with_tag_verb(text: str) -> bool:
    return re.search(rf"^\s*[,.!?]?\s*(?:{_VERB_ALT})\b", text) is not None
