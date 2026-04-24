from __future__ import annotations

import re
from dataclasses import dataclass
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
_NAME = (
    r"(?:(?:Mr|Mrs|Ms|Miss|Professor|Prof|Dr|Madam|Madame|Sir|Lady)\.?\s+)?"
    r"[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,3}"
)
_PRONOUNS = {"He", "She", "They", "We", "I", "You", "It"}

_POST_NAME_VERB = re.compile(
    rf"^\s*[,.!?]?\s*(?P<name>{_NAME})\s+(?:{_VERB_ALT})\b",
)
_POST_VERB_NAME = re.compile(
    rf"^\s*[,.!?]?\s*(?:{_VERB_ALT})\s+(?P<name>{_NAME})\b",
)
_PRE_NAME_VERB = re.compile(
    rf"(?P<name>{_NAME})\s+(?:{_VERB_ALT})[,:]\s*$",
)
_PRE_VERB_NAME = re.compile(
    rf"(?:{_VERB_ALT})\s+(?P<name>{_NAME})[,:]\s*$",
)


@dataclass(frozen=True, slots=True)
class CastCandidateEvidence:
    surface: str
    evidence_type: str
    span_id: str
    related_dialogue_span_id: str
    surface_text: str
    evidence_text: str
    confidence: float


def harvest_explicit_speaker_candidates(
    spans: list[dict[str, Any]],
) -> list[CastCandidateEvidence]:
    """Harvest explicit named speaker tags from narration adjacent to dialogue."""
    evidence: list[CastCandidateEvidence] = []
    for idx, span in enumerate(spans):
        if span.get("type") != "dialogue":
            continue

        prev_text = _adjacent_narration_text(spans, idx - 1)
        if prev_text is not None:
            evidence.extend(
                _match_pre_dialogue_tags(
                    text=prev_text,
                    narration_span_id=spans[idx - 1]["id"],
                    dialogue_span=span,
                )
            )

        next_text = _adjacent_narration_text(spans, idx + 1)
        if next_text is not None:
            evidence.extend(
                _match_post_dialogue_tags(
                    text=next_text,
                    narration_span_id=spans[idx + 1]["id"],
                    dialogue_span=span,
                )
            )

    return evidence


def summarize_candidates(
    evidence: list[CastCandidateEvidence],
) -> list[dict[str, Any]]:
    by_surface: dict[str, list[CastCandidateEvidence]] = {}
    for item in evidence:
        by_surface.setdefault(item.surface, []).append(item)

    summaries: list[dict[str, Any]] = []
    for surface, rows in by_surface.items():
        summaries.append(
            {
                "surface": surface,
                "evidence_count": len(rows),
                "evidence_span_ids": sorted({row.span_id for row in rows}),
                "related_dialogue_span_ids": sorted(
                    {row.related_dialogue_span_id for row in rows}
                ),
                "confidence": max(row.confidence for row in rows),
            }
        )
    return sorted(
        summaries,
        key=lambda row: (-int(row["evidence_count"]), str(row["surface"]).lower()),
    )


def build_deterministic_cast(
    evidence: list[CastCandidateEvidence],
) -> list[dict[str, Any]]:
    cast: list[dict[str, Any]] = []
    for summary in summarize_candidates(evidence):
        surface = str(summary["surface"])
        cast.append(
            {
                "canonical_name": _canonical_name(surface),
                "aliases": _aliases_for_surface(surface),
                "descriptor": "",
                "confidence": float(summary["confidence"]),
                "needs_review": False,
                "source": "deterministic",
                "evidence_span_ids": summary["evidence_span_ids"],
            }
        )
    return _dedupe_cast(cast)


def _match_post_dialogue_tags(
    *,
    text: str,
    narration_span_id: str,
    dialogue_span: dict[str, Any],
) -> list[CastCandidateEvidence]:
    return _match_tag_patterns(
        text=text,
        patterns=(
            ("explicit_post_dialogue_named_tag", _POST_NAME_VERB),
            ("explicit_post_dialogue_inverted_tag", _POST_VERB_NAME),
        ),
        narration_span_id=narration_span_id,
        dialogue_span=dialogue_span,
    )


def _match_pre_dialogue_tags(
    *,
    text: str,
    narration_span_id: str,
    dialogue_span: dict[str, Any],
) -> list[CastCandidateEvidence]:
    return _match_tag_patterns(
        text=text,
        patterns=(
            ("explicit_pre_dialogue_named_tag", _PRE_NAME_VERB),
            ("explicit_pre_dialogue_inverted_tag", _PRE_VERB_NAME),
        ),
        narration_span_id=narration_span_id,
        dialogue_span=dialogue_span,
    )


def _match_tag_patterns(
    *,
    text: str,
    patterns: tuple[tuple[str, re.Pattern[str]], ...],
    narration_span_id: str,
    dialogue_span: dict[str, Any],
) -> list[CastCandidateEvidence]:
    matches: list[CastCandidateEvidence] = []
    for evidence_type, pattern in patterns:
        match = pattern.search(text)
        if match is None:
            continue
        surface = _normalize_surface(match.group("name"))
        if not _is_usable_surface(surface):
            continue
        matches.append(
            CastCandidateEvidence(
                surface=surface,
                evidence_type=evidence_type,
                span_id=narration_span_id,
                related_dialogue_span_id=str(dialogue_span["id"]),
                surface_text=surface,
                evidence_text=_evidence_text(str(dialogue_span.get("text", "")), text),
                confidence=1.0,
            )
        )
    return matches


def _adjacent_narration_text(
    spans: list[dict[str, Any]], idx: int
) -> str | None:
    if idx < 0 or idx >= len(spans):
        return None
    span = spans[idx]
    if span.get("type") != "narration":
        return None
    text = span.get("text")
    return text if isinstance(text, str) else None


def _normalize_surface(surface: str) -> str:
    return re.sub(r"\s+", " ", surface.replace(".", "")).strip()


def _is_usable_surface(surface: str) -> bool:
    if not surface or surface in _PRONOUNS:
        return False
    if surface.startswith(("The ", "A ", "An ")):
        return False
    return True


def _canonical_name(surface: str) -> str:
    parts = surface.split()
    if len(parts) >= 2 and parts[0] in {
        "Mr",
        "Mrs",
        "Ms",
        "Miss",
        "Professor",
        "Prof",
        "Dr",
        "Madam",
        "Madame",
        "Sir",
        "Lady",
    }:
        return surface
    return surface


def _aliases_for_surface(surface: str) -> list[str]:
    aliases = [surface]
    parts = surface.split()
    if len(parts) >= 2 and parts[0] in {
        "Mr",
        "Mrs",
        "Ms",
        "Miss",
        "Professor",
        "Prof",
        "Dr",
        "Madam",
        "Madame",
        "Sir",
        "Lady",
    }:
        aliases.append(parts[-1])
    return list(dict.fromkeys(aliases))


def _dedupe_cast(cast: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    for row in cast:
        key = str(row["canonical_name"]).lower()
        if key not in by_name:
            by_name[key] = row
            continue
        existing = by_name[key]
        existing["aliases"] = list(
            dict.fromkeys([*existing.get("aliases", []), *row.get("aliases", [])])
        )
        existing["evidence_span_ids"] = sorted(
            {
                *existing.get("evidence_span_ids", []),
                *row.get("evidence_span_ids", []),
            }
        )
        existing["confidence"] = max(
            float(existing.get("confidence", 0)), float(row.get("confidence", 0))
        )
    return sorted(by_name.values(), key=lambda row: str(row["canonical_name"]).lower())


def _evidence_text(dialogue_text: str, narration_text: str) -> str:
    text = f"{dialogue_text}{narration_text}"
    return re.sub(r"\s+", " ", text).strip()[:500]

