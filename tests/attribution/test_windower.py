from auralia_api.attribution.windower import build_attribution_windows


def _dialogue(span_id: str, text: str, start: int, end: int) -> dict:
    return {"id": span_id, "type": "dialogue", "text": text, "start": start, "end": end}


def _narration(span_id: str, text: str, start: int, end: int) -> dict:
    return {
        "id": span_id,
        "type": "narration",
        "text": text,
        "start": start,
        "end": end,
    }


def test_windower_single_window_with_locked_context():
    spans = [
        _narration("n0", "Setup.", 0, 6),
        _dialogue("d1", '"A"', 6, 9),
        _narration("n1", " Harry said. ", 9, 22),
        _dialogue("d2", '"B"', 22, 25),
        _narration("n2", " Ron replied.", 25, 37),
        _dialogue("d3", '"C"', 37, 40),
    ]
    resolved = {
        "d1": {
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "source": "deterministic_tag",
        }
    }

    windows = build_attribution_windows(
        spans=spans,
        resolved=resolved,
        max_gap_chars=400,
        max_window_dialogues=12,
        max_window_chars=6000,
        pre_context_chars=200,
        post_context_chars=100,
    )

    assert len(windows) == 1
    window = windows[0]
    assert window["dialogue_ids"] == ["d1", "d2", "d3"]
    locked = [
        b for b in window["blocks"] if b["type"] == "dialogue" and b.get("locked")
    ]
    assert len(locked) == 1
    assert locked[0]["id"] == "d1"
    assert locked[0]["speaker"] == "Harry"


def test_windower_splits_on_large_narration_gap():
    spans = [
        _dialogue("d1", '"A"', 0, 3),
        _narration("n1", "x" * 800, 3, 803),
        _dialogue("d2", '"B"', 803, 806),
    ]

    windows = build_attribution_windows(
        spans=spans,
        resolved={},
        max_gap_chars=400,
        max_window_dialogues=12,
        max_window_chars=6000,
        pre_context_chars=200,
        post_context_chars=100,
    )

    assert len(windows) == 2
    assert windows[0]["dialogue_ids"] == ["d1"]
    assert windows[1]["dialogue_ids"] == ["d2"]


def test_windower_splits_on_max_dialogue_count():
    spans = []
    cursor = 0
    for i in range(5):
        spans.append(_dialogue(f"d{i}", '"x"', cursor, cursor + 3))
        cursor += 3
        spans.append(_narration(f"n{i}", " ", cursor, cursor + 1))
        cursor += 1

    windows = build_attribution_windows(
        spans=spans,
        resolved={},
        max_gap_chars=400,
        max_window_dialogues=2,
        max_window_chars=6000,
        pre_context_chars=200,
        post_context_chars=100,
    )

    assert [w["dialogue_ids"] for w in windows] == [["d0", "d1"], ["d2", "d3"], ["d4"]]


def test_windower_splits_on_max_chars():
    spans = [
        _dialogue("d1", '"A"', 0, 3),
        _narration("n1", "x" * 50, 3, 53),
        _dialogue("d2", '"B"', 53, 56),
    ]

    windows = build_attribution_windows(
        spans=spans,
        resolved={},
        max_gap_chars=400,
        max_window_dialogues=12,
        max_window_chars=30,
        pre_context_chars=200,
        post_context_chars=100,
    )

    assert len(windows) == 2


def test_windower_skips_windows_without_unresolved_dialogue():
    spans = [
        _dialogue("d1", '"A"', 0, 3),
        _narration("n1", " Harry said.", 3, 15),
    ]
    resolved = {
        "d1": {
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "source": "deterministic_tag",
        }
    }

    windows = build_attribution_windows(
        spans=spans,
        resolved=resolved,
        max_gap_chars=400,
        max_window_dialogues=12,
        max_window_chars=6000,
        pre_context_chars=200,
        post_context_chars=100,
    )

    assert windows == []
