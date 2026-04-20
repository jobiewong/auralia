import pytest

from auralia_api.attribution.parser import (
    AttributionParseError,
    parse_roster_response,
    parse_window_attributions,
)


def test_parse_roster_response_accepts_valid_payload():
    raw = (
        '{"characters":[{"canonical_name":"Harry","aliases":["Harry","Harry Potter"],'
        '"descriptor":"pov"}]}'
    )

    characters = parse_roster_response(raw, require_non_empty=True)

    assert characters[0]["canonical_name"] == "Harry"
    assert characters[0]["aliases"] == ["Harry", "Harry Potter"]


def test_parse_roster_response_rejects_duplicate_canonical_names():
    raw = (
        '{"characters":[{"canonical_name":"Harry","aliases":["Harry"]},'
        '{"canonical_name":"Harry","aliases":["Potter"]}]}'
    )

    with pytest.raises(AttributionParseError, match="duplicate canonical"):
        parse_roster_response(raw, require_non_empty=True)


def test_parse_roster_response_rejects_shared_aliases():
    raw = (
        '{"characters":[{"canonical_name":"Harry","aliases":["Potter"]},'
        '{"canonical_name":"James","aliases":["Potter"]}]}'
    )

    with pytest.raises(AttributionParseError, match="shared alias"):
        parse_roster_response(raw, require_non_empty=True)


def test_parse_roster_response_allows_empty_when_not_required():
    raw = '{"characters":[]}'

    assert parse_roster_response(raw, require_non_empty=False) == []


def test_parse_window_attributions_accepts_valid_payload_with_locked():
    raw = (
        '{"attributions":['
        '{"id":"d1","speaker":"Harry","speaker_confidence":1.0},'
        '{"id":"d2","speaker":"Ron","speaker_confidence":0.76}'
        "]}"
    )

    rows = parse_window_attributions(
        raw,
        dialogue_ids=["d1", "d2"],
        locked_speakers={"d1": "Harry"},
        roster_names={"Harry", "Ron"},
    )

    assert [r["id"] for r in rows] == ["d1", "d2"]
    assert rows[1]["speaker_confidence"] == 0.76


def test_parse_window_attributions_rejects_missing_or_extra_ids():
    raw = '{"attributions":[{"id":"d1","speaker":"Harry","speaker_confidence":1.0}]}'

    with pytest.raises(AttributionParseError, match="missing ids"):
        parse_window_attributions(
            raw,
            dialogue_ids=["d1", "d2"],
            locked_speakers={},
            roster_names={"Harry"},
        )


def test_parse_window_attributions_rejects_locked_speaker_changes():
    raw = '{"attributions":[{"id":"d1","speaker":"Ron","speaker_confidence":1.0}]}'

    with pytest.raises(AttributionParseError, match="locked"):
        parse_window_attributions(
            raw,
            dialogue_ids=["d1"],
            locked_speakers={"d1": "Harry"},
            roster_names={"Harry", "Ron"},
        )


def test_parse_window_attributions_coerces_unknown_speaker_to_unknown():
    raw = '{"attributions":[{"id":"d1","speaker":"Dobby","speaker_confidence":0.8}]}'

    rows = parse_window_attributions(
        raw,
        dialogue_ids=["d1"],
        locked_speakers={},
        roster_names={"Harry", "Ron"},
    )

    assert rows[0]["speaker"] == "UNKNOWN"
    assert rows[0]["speaker_confidence"] == 0.0


def test_parse_window_attributions_maps_aliases_to_canonical():
    raw = '{"attributions":[{"id":"d1","speaker":"Potter","speaker_confidence":0.9}]}'

    rows = parse_window_attributions(
        raw,
        dialogue_ids=["d1"],
        locked_speakers={},
        roster_names={"Harry"},
        alias_to_canonical={"Potter": "Harry"},
    )

    assert rows[0]["speaker"] == "Harry"
    assert rows[0]["speaker_confidence"] == 0.9


def test_parse_window_attributions_case_insensitive_speaker_match():
    raw = '{"attributions":[{"id":"d1","speaker":"harry","speaker_confidence":0.9}]}'

    rows = parse_window_attributions(
        raw,
        dialogue_ids=["d1"],
        locked_speakers={},
        roster_names={"Harry"},
    )

    assert rows[0]["speaker"] == "Harry"


def test_parse_window_attributions_rejects_confidence_out_of_range():
    raw = '{"attributions":[{"id":"d1","speaker":"Harry","speaker_confidence":1.5}]}'

    with pytest.raises(AttributionParseError, match="confidence"):
        parse_window_attributions(
            raw,
            dialogue_ids=["d1"],
            locked_speakers={},
            roster_names={"Harry"},
        )
