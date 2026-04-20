from auralia_api.segmentation.quote_segmenter import (
    SpanInterval,
    segment_text_by_quotes,
)


def _reconstruct(text: str, intervals: list[SpanInterval]) -> str:
    return "".join(text[iv.start : iv.end] for iv in intervals)


def _assert_invariants(text: str, intervals: list[SpanInterval]) -> None:
    if not text:
        assert intervals == []
        return
    assert intervals[0].start == 0
    assert intervals[-1].end == len(text)
    for prev, curr in zip(intervals, intervals[1:], strict=False):
        assert prev.end == curr.start
    assert _reconstruct(text, intervals) == text
    for iv in intervals:
        assert iv.type in {"narration", "dialogue"}
        assert 0 <= iv.start < iv.end <= len(text)


def test_empty_input_returns_empty_list():
    assert segment_text_by_quotes("") == []


def test_narration_only():
    text = "No dialogue here, just prose."
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert len(intervals) == 1
    assert intervals[0].type == "narration"


def test_dialogue_only():
    text = '"Hello there."'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert len(intervals) == 1
    assert intervals[0].type == "dialogue"


def test_narration_then_dialogue_then_narration():
    text = 'Harry walked in. "Hello," he said.'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert [iv.type for iv in intervals] == ["narration", "dialogue", "narration"]
    dialogue = next(iv for iv in intervals if iv.type == "dialogue")
    assert text[dialogue.start : dialogue.end] == '"Hello,"'


def test_multiple_dialogues_with_narration_between():
    text = '"First." middle narration "Second."'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert [iv.type for iv in intervals] == ["dialogue", "narration", "dialogue"]


def test_adjacent_dialogues_without_narration_between():
    text = '"One""Two"'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert [iv.type for iv in intervals] == ["dialogue", "dialogue"]
    assert text[intervals[0].start : intervals[0].end] == '"One"'
    assert text[intervals[1].start : intervals[1].end] == '"Two"'


def test_unmatched_opening_quote_falls_back_to_narration():
    text = 'He said "but never finished his sentence'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert len(intervals) == 1
    assert intervals[0].type == "narration"


def test_single_quotes_are_not_dialogue_delimiters():
    text = "She's happy, isn't she?"
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert len(intervals) == 1
    assert intervals[0].type == "narration"


def test_split_dialogue_tag_between_quoted_fragments():
    text = '"Hello," he said, "world."'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    types = [iv.type for iv in intervals]
    assert types == ["dialogue", "narration", "dialogue"]
    assert text[intervals[0].start : intervals[0].end] == '"Hello,"'
    assert text[intervals[2].start : intervals[2].end] == '"world."'


def test_dialogue_can_span_newlines():
    text = '"First line.\nSecond line."'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert len(intervals) == 1
    assert intervals[0].type == "dialogue"


def test_empty_dialogue_is_still_a_span():
    text = 'before "" after'
    intervals = segment_text_by_quotes(text)
    _assert_invariants(text, intervals)
    assert [iv.type for iv in intervals] == ["narration", "dialogue", "narration"]
    dialogue = intervals[1]
    assert text[dialogue.start : dialogue.end] == '""'
