from auralia_api.synthesis.audio import chunk_text_by_sentences


def test_chunk_text_by_sentences_preserves_text_with_three_sentence_chunks():
    text = "One. Two! Three? Four. Five."

    chunks = chunk_text_by_sentences(text, max_sentences=3)

    assert chunks == ["One. Two! Three?", " Four. Five."]
    assert "".join(chunks) == text


def test_chunk_text_by_sentences_leaves_short_text_as_single_chunk():
    text = "One. Two. Three."

    assert chunk_text_by_sentences(text, max_sentences=3) == [text]
