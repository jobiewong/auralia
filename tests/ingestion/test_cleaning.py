from auralia_api.ingestion.cleaning import clean_prose_text


def test_clean_prose_text_strips_malformed_html_and_entities():
    raw = "<div><p>Hello&nbsp;<b>world</b><p>Line &amp; more <broken"

    cleaned = clean_prose_text(raw)

    assert cleaned == "Hello world\nLine & more"


def test_clean_prose_text_normalizes_odd_whitespace():
    raw = "\tHello\u00a0\u00a0  world\r\n\r\n\r\n  Next\tline  "

    cleaned = clean_prose_text(raw)

    assert cleaned == "Hello world\n\nNext line"


def test_clean_prose_text_strips_markdown_headers_and_emphasis():
    raw = (
        "# Chapter One\n\n"
        "She said **hello** and *smiled*.\n\n"
        "## Interlude\n"
        "Then ***everything*** changed."
    )

    cleaned = clean_prose_text(raw)

    assert cleaned == (
        "Chapter One\n\n"
        "She said hello and smiled.\n\n"
        "Interlude\n"
        "Then everything changed."
    )


def test_clean_prose_text_strips_markdown_links_images_and_code():
    raw = (
        "See [the site](https://example.com) for `code` blocks.\n"
        "![alt](https://example.com/x.png)\n"
        "End."
    )

    cleaned = clean_prose_text(raw)

    assert cleaned == "See the site for code blocks.\n\nEnd."


def test_clean_prose_text_strips_markdown_lists_and_blockquotes():
    raw = (
        "> A quote\n"
        "> continues here\n\n"
        "- item one\n"
        "- item two\n\n"
        "1. first\n"
        "2. second"
    )

    cleaned = clean_prose_text(raw)

    assert cleaned == (
        "A quote\n"
        "continues here\n\n"
        "item one\n"
        "item two\n\n"
        "first\n"
        "second"
    )


def test_clean_prose_text_normalizes_curly_and_angle_quotes():
    raw = (
        "\u201cHello,\u201d she said. \u2018Maybe,\u2019 he replied.\n"
        "\u00abBonjour\u00bb and \u2039oui\u203a and it\u2019s fine."
    )

    cleaned = clean_prose_text(raw)

    assert cleaned == (
        "\"Hello,\" she said. 'Maybe,' he replied.\n"
        "\"Bonjour\" and 'oui' and it's fine."
    )


def test_clean_prose_text_normalizes_ellipsis_and_dashes():
    raw = "He paused\u2026 then ran\u2014fast\u2014and the en\u2013dash stayed."

    cleaned = clean_prose_text(raw)

    assert cleaned == "He paused... then ran--fast--and the en-dash stayed."


def test_clean_prose_text_plain_and_markdown_produce_identical_output():
    markdown = "# Title\n\nShe said **hi** and [left](http://x)."
    plain = "Title\n\nShe said hi and left."

    assert clean_prose_text(markdown) == clean_prose_text(plain)
