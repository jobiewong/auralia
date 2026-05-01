from auralia_api.synthesis.audio import (
    TextChunk,
    chunk_text_by_sentences,
    plan_text_chunks,
)


def test_chunk_text_by_sentences_preserves_text_with_three_sentence_chunks():
    text = "One. Two! Three? Four. Five."

    chunks = chunk_text_by_sentences(text, max_sentences=3)

    assert chunks == ["One. Two! Three?", " Four. Five."]
    assert "".join(chunks) == text


def test_chunk_text_by_sentences_leaves_short_text_as_single_chunk():
    text = "One. Two. Three."

    assert chunk_text_by_sentences(text, max_sentences=3) == [text]


def test_plan_text_chunks_uses_newline_pause_for_single_newlines():
    text = "Chapter 1\nSaturday 7th August\nHe woke up. It was hot."

    chunks = plan_text_chunks(
        text,
        max_sentences=3,
        chunk_pause_ms=125,
        newline_pause_ms=900,
    )

    assert chunks == [
        TextChunk("Chapter 1", 900),
        TextChunk("Saturday 7th August", 900),
        TextChunk("He woke up. It was hot.", None),
    ]


def test_plan_text_chunks_collapses_blank_line_runs_to_one_newline_pause():
    text = "Chapter 1\n\n\nSaturday 7th August"

    chunks = plan_text_chunks(
        text,
        max_sentences=3,
        chunk_pause_ms=125,
        newline_pause_ms=900,
    )

    assert chunks == [
        TextChunk("Chapter 1", 900),
        TextChunk("Saturday 7th August", None),
    ]


def test_plan_text_chunks_keeps_sentence_chunk_pause_inside_line_block():
    text = "One. Two. Three. Four.\nFive."

    chunks = plan_text_chunks(
        text,
        max_sentences=3,
        chunk_pause_ms=125,
        newline_pause_ms=900,
    )

    assert chunks == [
        TextChunk("One. Two. Three.", 125),
        TextChunk(" Four.", 900),
        TextChunk("Five.", None),
    ]
