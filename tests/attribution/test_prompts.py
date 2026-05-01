from auralia_api.attribution.prompts import (
    WINDOW_SYSTEM_PROMPT,
    build_roster_user_prompt,
    build_window_user_prompt,
)


def test_roster_prompt_contains_document_text():
    prompt = build_roster_user_prompt('"Hi," Harry said.')
    assert "DOCUMENT_TEXT" in prompt
    assert '"Hi," Harry said.' in prompt


def test_window_prompt_contains_roster_context_and_blocks():
    prompt = build_window_user_prompt(
        roster=[{"canonical_name": "Harry", "aliases": ["Harry"], "descriptor": ""}],
        pre_context_text="Before",
        blocks=[
            {
                "id": "d1",
                "type": "dialogue",
                "text": '"Hi"',
                "locked": True,
                "speaker": "Harry",
            },
            {"id": "n1", "type": "narration", "text": " he said."},
        ],
        post_context_text="After",
    )

    assert "ROSTER" in prompt
    assert "PRIOR_NARRATION" in prompt
    assert "POST_NARRATION" in prompt
    assert "locked=true" in prompt
    assert "speaker=Harry" in prompt


def test_system_prompt_mentions_unknown_policy():
    assert "UNKNOWN" in WINDOW_SYSTEM_PROMPT
