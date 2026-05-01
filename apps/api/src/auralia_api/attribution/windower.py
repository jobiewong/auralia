from __future__ import annotations

from typing import Any


def build_attribution_windows(
    *,
    spans: list[dict[str, Any]],
    resolved: dict[str, dict[str, Any]],
    max_gap_chars: int,
    max_window_dialogues: int,
    max_window_chars: int,
    pre_context_chars: int,
    post_context_chars: int,
) -> list[dict[str, Any]]:
    dialogue_indices = [i for i, s in enumerate(spans) if s.get("type") == "dialogue"]
    windows_indices: list[list[int]] = []
    current: list[int] = []

    for idx in dialogue_indices:
        if not current:
            current = [idx]
            continue

        prev_idx = current[-1]
        should_split = _should_split(
            spans=spans,
            prev_dialogue_idx=prev_idx,
            next_dialogue_idx=idx,
            current_dialogue_count=len(current),
            current_window_indices=current,
            max_gap_chars=max_gap_chars,
            max_window_dialogues=max_window_dialogues,
            max_window_chars=max_window_chars,
        )
        if should_split:
            windows_indices.append(current)
            current = [idx]
        else:
            current.append(idx)

    if current:
        windows_indices.append(current)

    windows: list[dict[str, Any]] = []
    for idxs in windows_indices:
        dialogue_ids = [spans[i]["id"] for i in idxs]
        if all(did in resolved for did in dialogue_ids):
            continue

        start_idx = idxs[0]
        end_idx = idxs[-1]
        blocks = []
        for s in spans[start_idx : end_idx + 1]:
            if s.get("type") == "dialogue":
                row = {
                    "id": s["id"],
                    "type": "dialogue",
                    "text": s["text"],
                    "locked": s["id"] in resolved,
                }
                if s["id"] in resolved:
                    row["speaker"] = resolved[s["id"]]["speaker"]
                blocks.append(row)
            else:
                blocks.append({"id": s["id"], "type": "narration", "text": s["text"]})

        windows.append(
            {
                "dialogue_ids": dialogue_ids,
                "pre_context": _pre_context(spans, start_idx, pre_context_chars),
                "post_context": _post_context(spans, end_idx, post_context_chars),
                "blocks": blocks,
            }
        )

    return windows


def _should_split(
    *,
    spans: list[dict[str, Any]],
    prev_dialogue_idx: int,
    next_dialogue_idx: int,
    current_dialogue_count: int,
    current_window_indices: list[int],
    max_gap_chars: int,
    max_window_dialogues: int,
    max_window_chars: int,
) -> bool:
    if current_dialogue_count >= max_window_dialogues:
        return True

    gap = _narration_gap_chars(spans, prev_dialogue_idx, next_dialogue_idx)
    if gap > max_gap_chars:
        return True

    projected = _window_char_count(spans, current_window_indices + [next_dialogue_idx])
    if projected > max_window_chars:
        return True

    return False


def _narration_gap_chars(
    spans: list[dict[str, Any]], prev_dialogue_idx: int, next_dialogue_idx: int
) -> int:
    total = 0
    for s in spans[prev_dialogue_idx + 1 : next_dialogue_idx]:
        if s.get("type") == "narration":
            total += len(str(s.get("text", "")))
    return total


def _window_char_count(spans: list[dict[str, Any]], dialogue_indices: list[int]) -> int:
    if not dialogue_indices:
        return 0
    start = dialogue_indices[0]
    end = dialogue_indices[-1]
    return sum(len(str(s.get("text", ""))) for s in spans[start : end + 1])


def _pre_context(spans: list[dict[str, Any]], start_idx: int, limit: int) -> str:
    if start_idx <= 0:
        return ""
    prev = spans[start_idx - 1]
    if prev.get("type") != "narration":
        return ""
    text = str(prev.get("text", ""))
    return text[-limit:]


def _post_context(spans: list[dict[str, Any]], end_idx: int, limit: int) -> str:
    if end_idx >= len(spans) - 1:
        return ""
    nxt = spans[end_idx + 1]
    if nxt.get("type") != "narration":
        return ""
    text = str(nxt.get("text", ""))
    return text[:limit]
