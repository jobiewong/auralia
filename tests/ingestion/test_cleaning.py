from auralia_api.ingestion.cleaning import clean_prose_text


def test_clean_prose_text_strips_malformed_html_and_entities():
    raw = "<div><p>Hello&nbsp;<b>world</b><p>Line &amp; more <broken"

    cleaned = clean_prose_text(raw)

    assert cleaned == "Hello world\nLine & more"


def test_clean_prose_text_normalizes_odd_whitespace():
    raw = "\tHello\u00A0\u00A0  world\r\n\r\n\r\n  Next\tline  "

    cleaned = clean_prose_text(raw)

    assert cleaned == "Hello world\n\nNext line"
