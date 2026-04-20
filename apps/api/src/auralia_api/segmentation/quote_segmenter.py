from __future__ import annotations

from dataclasses import dataclass

_QUOTE = '"'


@dataclass(frozen=True, slots=True)
class SpanInterval:
    type: str
    start: int
    end: int


def segment_text_by_quotes(text: str) -> list[SpanInterval]:
    """Segment cleaned prose into narration/dialogue spans by pairing ASCII
    double quotes.

    The ingestion pipeline normalizes every curly/angle double quote to the
    ASCII `"` character, so `"..."` is a reliable dialogue delimiter for the
    common case. Single quotes (apostrophes, nested speech) are deliberately
    ignored because they conflict with contractions and possessives.

    Rules:
      - A paired `"..."` region (inclusive of both quote characters) is one
        dialogue span.
      - Every region outside a paired dialogue span is narration.
      - An opening `"` without a matching closing `"` anywhere after it is
        treated as narration — we do not silently close dialogue at EOF
        because that tends to swallow the rest of the chapter on a stray
        stray quote.
      - The returned spans are contiguous, non-overlapping, and cover
        [0, len(text)) exactly. Empty input returns an empty list.
    """
    n = len(text)
    if n == 0:
        return []

    spans: list[SpanInterval] = []
    cursor = 0
    while cursor < n:
        open_idx = text.find(_QUOTE, cursor)
        if open_idx == -1:
            spans.append(SpanInterval(type="narration", start=cursor, end=n))
            break

        close_idx = text.find(_QUOTE, open_idx + 1)
        if close_idx == -1:
            spans.append(SpanInterval(type="narration", start=cursor, end=n))
            break

        if open_idx > cursor:
            spans.append(SpanInterval(type="narration", start=cursor, end=open_idx))
        spans.append(SpanInterval(type="dialogue", start=open_idx, end=close_idx + 1))
        cursor = close_idx + 1

    return spans


__all__ = ["SpanInterval", "segment_text_by_quotes"]
