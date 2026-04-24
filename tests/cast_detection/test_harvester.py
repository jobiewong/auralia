from auralia_api.cast_detection.harvester import (
    build_deterministic_cast,
    harvest_explicit_speaker_candidates,
)


def test_harvests_post_dialogue_named_tag():
    spans = [
        {
            "id": "d1",
            "type": "dialogue",
            "text": '"I suspect you already have some idea,"',
        },
        {
            "id": "n1",
            "type": "narration",
            "text": " Dumbledore replied. He reached into his pocket.",
        },
    ]

    evidence = harvest_explicit_speaker_candidates(spans)
    cast = build_deterministic_cast(evidence)

    assert evidence[0].surface == "Dumbledore"
    assert cast[0]["canonical_name"] == "Dumbledore"
    assert cast[0]["source"] == "deterministic"


def test_harvests_pre_dialogue_tag_with_honorific():
    spans = [
        {
            "id": "n1",
            "type": "narration",
            "text": "Professor Dumbledore said, ",
        },
        {"id": "d1", "type": "dialogue", "text": '"Lemon drop?"'},
    ]

    evidence = harvest_explicit_speaker_candidates(spans)
    cast = build_deterministic_cast(evidence)

    assert evidence[0].surface == "Professor Dumbledore"
    assert cast[0]["aliases"] == ["Professor Dumbledore", "Dumbledore"]


def test_harvester_ignores_pronoun_tags():
    spans = [
        {"id": "d1", "type": "dialogue", "text": '"Hi."'},
        {"id": "n1", "type": "narration", "text": " He said."},
    ]

    assert harvest_explicit_speaker_candidates(spans) == []

