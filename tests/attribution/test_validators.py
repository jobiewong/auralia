from auralia_api.attribution.validators import run_all_attribution_validators


def _spans() -> list[dict]:
    return [
        {"id": "n1", "type": "narration", "text": "Alpha ", "start": 0, "end": 6},
        {"id": "d1", "type": "dialogue", "text": '"Hi"', "start": 6, "end": 10},
        {"id": "d2", "type": "dialogue", "text": '"Yo"', "start": 10, "end": 14},
    ]


def test_validators_fail_when_dialogue_is_missing_attribution():
    attributions = [
        {
            "span_id": "d1",
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "needs_review": False,
            "source": "deterministic_tag",
        }
    ]

    errors = run_all_attribution_validators(
        spans=_spans(),
        attributions=attributions,
        roster_names={"Harry", "Ron"},
        threshold=0.7,
    )

    assert any(e.code == "ATTR_DIALOGUE_MISSING" for e in errors)


def test_validators_fail_when_narration_has_attribution():
    attributions = [
        {
            "span_id": "n1",
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "needs_review": False,
            "source": "deterministic_tag",
        },
        {
            "span_id": "d1",
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "needs_review": False,
            "source": "deterministic_tag",
        },
        {
            "span_id": "d2",
            "speaker": "Ron",
            "speaker_confidence": 0.8,
            "needs_review": False,
            "source": "llm_windowed",
        },
    ]

    errors = run_all_attribution_validators(
        spans=_spans(),
        attributions=attributions,
        roster_names={"Harry", "Ron"},
        threshold=0.7,
    )

    assert any(e.code == "ATTR_NARRATION_PRESENT" for e in errors)


def test_validators_fail_on_unknown_speaker_not_allowed():
    attributions = [
        {
            "span_id": "d1",
            "speaker": "Dobby",
            "speaker_confidence": 0.6,
            "needs_review": True,
            "source": "llm_windowed",
        },
        {
            "span_id": "d2",
            "speaker": "Ron",
            "speaker_confidence": 0.8,
            "needs_review": False,
            "source": "llm_windowed",
        },
    ]

    errors = run_all_attribution_validators(
        spans=_spans(),
        attributions=attributions,
        roster_names={"Harry", "Ron"},
        threshold=0.7,
    )

    assert any(e.code == "ATTR_SPEAKER_INVALID" for e in errors)


def test_validators_fail_on_duplicate_span_id():
    attributions = [
        {
            "span_id": "d1",
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "needs_review": False,
            "source": "deterministic_tag",
        },
        {
            "span_id": "d1",
            "speaker": "Harry",
            "speaker_confidence": 1.0,
            "needs_review": False,
            "source": "deterministic_tag",
        },
        {
            "span_id": "d2",
            "speaker": "Ron",
            "speaker_confidence": 0.9,
            "needs_review": False,
            "source": "llm_windowed",
        },
    ]

    errors = run_all_attribution_validators(
        spans=_spans(),
        attributions=attributions,
        roster_names={"Harry", "Ron"},
        threshold=0.7,
    )

    assert any(e.code == "ATTR_DUPLICATE_SPAN_ID" for e in errors)
