from __future__ import annotations

import html
import re
from html.parser import HTMLParser

_PUNCTUATION_TRANSLATIONS = {
    0x2026: "...",  # HORIZONTAL ELLIPSIS
    0x2014: "--",   # EM DASH
    0x2015: "--",   # HORIZONTAL BAR
    0x2013: "-",    # EN DASH
    0x2212: "-",    # MINUS SIGN
}


_QUOTE_TRANSLATIONS = {
    # Double quotes → "
    0x201C: '"',  # LEFT DOUBLE QUOTATION MARK
    0x201D: '"',  # RIGHT DOUBLE QUOTATION MARK
    0x201E: '"',  # DOUBLE LOW-9 QUOTATION MARK
    0x201F: '"',  # DOUBLE HIGH-REVERSED-9 QUOTATION MARK
    0x00AB: '"',  # LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
    0x00BB: '"',  # RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
    0x2033: '"',  # DOUBLE PRIME
    # Single quotes → '
    0x2018: "'",  # LEFT SINGLE QUOTATION MARK
    0x2019: "'",  # RIGHT SINGLE QUOTATION MARK
    0x201A: "'",  # SINGLE LOW-9 QUOTATION MARK
    0x201B: "'",  # SINGLE HIGH-REVERSED-9 QUOTATION MARK
    0x2039: "'",  # SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    0x203A: "'",  # SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    0x2032: "'",  # PRIME
}


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


def _strip_markdown(text: str) -> str:
    # Fenced code blocks: keep inner content, drop the fences.
    text = re.sub(r"```[^\n]*\n(.*?)\n?```", r"\1", text, flags=re.DOTALL)

    # Images: drop entirely (alt text is usually not prose).
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)

    # Inline links: keep the visible label, drop the URL.
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)

    # Reference-style link definitions on their own line.
    text = re.sub(r"^\s*\[[^\]]+\]:\s*\S.*$", "", text, flags=re.MULTILINE)

    lines = text.split("\n")
    processed: list[str] = []
    for line in lines:
        # ATX headers.
        line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
        # Blockquote markers.
        line = re.sub(r"^\s{0,3}(?:>\s?)+", "", line)
        # Unordered list markers.
        line = re.sub(r"^\s{0,3}[-*+]\s+", "", line)
        # Ordered list markers.
        line = re.sub(r"^\s{0,3}\d+\.\s+", "", line)
        # Setext underlines and horizontal rules.
        if re.fullmatch(r"\s{0,3}(?:-{3,}|={3,}|\*{3,}|_{3,})\s*", line):
            continue
        processed.append(line)
    text = "\n".join(processed)

    # Emphasis: bold, italic, bold-italic (both * and _ variants).
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"___(.+?)___", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"__(.+?)__", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<![A-Za-z0-9])\*(?!\s)(.+?)(?<!\s)\*(?![A-Za-z0-9])", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<![A-Za-z0-9])_(?!\s)(.+?)(?<!\s)_(?![A-Za-z0-9])", r"\1", text, flags=re.DOTALL)

    # Strikethrough.
    text = re.sub(r"~~(.+?)~~", r"\1", text, flags=re.DOTALL)

    # Inline code.
    text = re.sub(r"`([^`\n]+)`", r"\1", text)

    return text


def clean_prose_text(raw_text: str) -> str:
    """Normalize prose input for ingestion.

    Accepts plain text, markdown, or HTML-tagged text and produces a single
    canonical prose representation: markdown syntax stripped, HTML tags
    stripped, entities decoded, and whitespace normalized.
    """
    text = _strip_markdown(raw_text)

    # Preserve unknown/malformed tags as literal text while stripping known tags.
    escaped = text.replace("<", "&lt;").replace(">", "&gt;")
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
    text = text.translate(_QUOTE_TRANSLATIONS)
    text = text.translate(_PUNCTUATION_TRANSLATIONS)

    # Collapse runs of spaces while preserving line boundaries.
    text = re.sub(r"[ ]+", " ", text)

    # Strip spaces around newlines and collapse excessive blank lines.
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
