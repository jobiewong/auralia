from __future__ import annotations

import html
import re
from html.parser import HTMLParser

_BLOCK_TAGS = {
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "section",
    "article",
}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # type: ignore[override]
        if tag.lower() in _BLOCK_TAGS:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in _BLOCK_TAGS:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        self._chunks.append(data)

    def handle_entityref(self, name: str) -> None:
        self._chunks.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self._chunks.append(f"&#{name};")

    def get_text(self) -> str:
        return "".join(self._chunks)


def clean_prose_text(raw_text: str) -> str:
    """Strip HTML/tags and normalize whitespace for ingestion pipeline."""
    # Preserve unknown/malformed tags as literal text while stripping known tags.
    escaped = raw_text.replace("<", "&lt;").replace(">", "&gt;")
    unescaped_known_tags = re.sub(r"&lt;(/?[a-zA-Z][^&<>]*)&gt;", r"<\1>", escaped)

    parser = _TextExtractor()
    parser.feed(unescaped_known_tags)
    parser.close()

    text = parser.get_text()
    text = html.unescape(text)

    # Drop malformed/dangling HTML-like tag fragments that survived parsing.
    text = re.sub(r"<[A-Za-z][A-Za-z0-9_-]*", "", text)

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\t", " ")

    # Collapse runs of spaces while preserving line boundaries.
    text = re.sub(r"[ ]+", " ", text)

    # Strip spaces around newlines and collapse excessive blank lines.
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
