from auralia_api.attribution.pre_pass import resolve_dialogue_spans_deterministically


def _roster() -> list[dict[str, object]]:
    return [
        {
            "canonical_name": "Harry",
            "aliases": ["Harry", "Harry Potter"],
            "descriptor": "",
        },
        {
            "canonical_name": "Ron",
            "aliases": ["Ron", "Ron Weasley"],
            "descriptor": "",
        },
    ]


def test_pre_pass_resolves_post_dialogue_named_tag():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello,"', "start": 0, "end": 8},
        {
            "id": "n1",
            "type": "narration",
            "text": " Harry said.",
            "start": 8,
            "end": 20,
        },
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved["d1"]["speaker"] == "Harry"
    assert resolved["d1"]["speaker_confidence"] == 1.0
    assert resolved["d1"]["source"] == "deterministic_tag"
    assert unresolved == []


def test_pre_pass_resolves_post_dialogue_inverted_tag():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello,"', "start": 0, "end": 8},
        {
            "id": "n1",
            "type": "narration",
            "text": " said Harry.",
            "start": 8,
            "end": 21,
        },
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved["d1"]["speaker"] == "Harry"
    assert unresolved == []


def test_pre_pass_resolves_pre_dialogue_tag():
    spans = [
        {
            "id": "n1",
            "type": "narration",
            "text": "Harry said, ",
            "start": 0,
            "end": 12,
        },
        {"id": "d1", "type": "dialogue", "text": '"Hello."', "start": 12, "end": 20},
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved["d1"]["speaker"] == "Harry"
    assert unresolved == []


def test_pre_pass_handles_adverb_after_tag():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello,"', "start": 0, "end": 8},
        {
            "id": "n1",
            "type": "narration",
            "text": " Harry said softly.",
            "start": 8,
            "end": 27,
        },
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved["d1"]["speaker"] == "Harry"
    assert unresolved == []


def test_pre_pass_leaves_pronoun_only_tag_unresolved():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello,"', "start": 0, "end": 8},
        {"id": "n1", "type": "narration", "text": " he said.", "start": 8, "end": 17},
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved == {}
    assert unresolved == ["d1"]


def test_pre_pass_leaves_ambiguous_tag_unresolved():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello!"', "start": 0, "end": 8},
        {
            "id": "n1",
            "type": "narration",
            "text": " said Harry and Ron together.",
            "start": 8,
            "end": 36,
        },
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved == {}
    assert unresolved == ["d1"]


def test_pre_pass_leaves_unknown_verb_unresolved():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello,"', "start": 0, "end": 8},
        {
            "id": "n1",
            "type": "narration",
            "text": " Harry chirped.",
            "start": 8,
            "end": 23,
        },
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved == {}
    assert unresolved == ["d1"]


def test_pre_pass_leaves_name_not_in_roster_unresolved():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello,"', "start": 0, "end": 8},
        {
            "id": "n1",
            "type": "narration",
            "text": " Dobby said.",
            "start": 8,
            "end": 20,
        },
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved == {}
    assert unresolved == ["d1"]


def test_pre_pass_leaves_dialogue_without_adjacent_narration_unresolved():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hello."', "start": 0, "end": 8},
    ]

    resolved, unresolved = resolve_dialogue_spans_deterministically(
        spans=spans, roster=_roster()
    )

    assert resolved == {}
    assert unresolved == ["d1"]
