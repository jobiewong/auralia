from __future__ import annotations

import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser

from .cleaning import clean_prose_text

_AO3_ALLOWED_HOST = "archiveofourown.org"
_AO3_PATH_RE = re.compile(r"^/works/(?P<work_id>\d+)/chapters/(?P<chapter_id>\d+)/?$")
_MAX_HTML_BYTES = 2_000_000
_MIN_REQUEST_INTERVAL_SECONDS = 2.0

_fetch_lock = threading.Lock()
_last_fetch_started_at = 0.0


class AO3ValidationError(ValueError):
    pass


class AO3FetchError(RuntimeError):
    pass


class AO3ParseError(ValueError):
    pass


@dataclass(slots=True)
class AO3Chapter:
    work_id: str
    chapter_id: str
    title: str | None
    cleaned_text: str


class _AO3ChapterParser(HTMLParser):
    """Extract first chapter body from AO3 chapter HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._depth = 0
        self._chapters_depth: int | None = None
        self._target_depth: int | None = None
        self._capturing_title = False
        self._title_chunks: list[str] = []
        self._body_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._depth += 1
        attrs_dict = {k: (v or "") for k, v in attrs}

        if tag == "div" and attrs_dict.get("id") == "chapters":
            self._chapters_depth = self._depth

        in_chapters = (
            self._chapters_depth is not None
            and self._depth >= self._chapters_depth
        )
        if in_chapters:
            class_names = set(attrs_dict.get("class", "").split())
            if tag == "h3" and "title" in class_names:
                self._capturing_title = True

            if (
                tag == "div"
                and self._target_depth is None
                and {"userstuff", "module"}.issubset(class_names)
            ):
                self._target_depth = self._depth

        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(self.get_starttag_text())

    def handle_endtag(self, tag: str) -> None:
        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(f"</{tag}>")

        if self._capturing_title and tag == "h3":
            self._capturing_title = False

        if self._target_depth is not None and self._depth == self._target_depth:
            self._target_depth = None

        if self._chapters_depth is not None and self._depth == self._chapters_depth:
            self._chapters_depth = None

        self._depth -= 1

    def handle_data(self, data: str) -> None:
        if self._capturing_title:
            self._title_chunks.append(data)

        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(f"&#{name};")

    def result(self) -> tuple[str | None, str]:
        title = "".join(self._title_chunks).strip() or None
        body_html = "".join(self._body_chunks).strip()
        return title, body_html


def _validate_ao3_url(url: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(url)

    if parsed.scheme != "https":
        raise AO3ValidationError("AO3 URL must use https")

    if parsed.netloc != _AO3_ALLOWED_HOST:
        raise AO3ValidationError("Only archiveofourown.org URLs are supported")

    match = _AO3_PATH_RE.match(parsed.path)
    if not match:
        raise AO3ValidationError(
            "AO3 URL must match /works/<work_id>/chapters/<chapter_id>",
        )

    return match.group("work_id"), match.group("chapter_id")


def _respectful_gate() -> None:
    global _last_fetch_started_at
    with _fetch_lock:
        now = time.monotonic()
        wait = _MIN_REQUEST_INTERVAL_SECONDS - (now - _last_fetch_started_at)
        if wait > 0:
            time.sleep(wait)
        _last_fetch_started_at = time.monotonic()


def _fetch_html(url: str) -> str:
    _respectful_gate()

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Auralia/0.1 (+local personal use; contact: n/a)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "")
            if "html" not in content_type.lower():
                raise AO3FetchError("AO3 response is not HTML")

            payload = response.read(_MAX_HTML_BYTES + 1)
            if len(payload) > _MAX_HTML_BYTES:
                raise AO3FetchError("AO3 response too large")

            return payload.decode("utf-8", errors="replace")
    except TimeoutError as exc:
        raise AO3FetchError("Failed to fetch AO3 URL: timed out") from exc
    except urllib.error.URLError as exc:
        raise AO3FetchError(f"Failed to fetch AO3 URL: {exc}") from exc


def fetch_ao3_chapter(url: str) -> AO3Chapter:
    work_id, chapter_id = _validate_ao3_url(url)
    html_doc = _fetch_html(url)

    parser = _AO3ChapterParser()
    parser.feed(html_doc)
    parser.close()

    title, body_html = parser.result()
    if not body_html:
        raise AO3ParseError("Could not locate AO3 chapter body")

    cleaned = clean_prose_text(body_html)
    if not cleaned:
        raise AO3ParseError("AO3 chapter body is empty after cleaning")

    # AO3 often includes a generic in-body heading "Chapter Text".
    if cleaned.startswith("Chapter Text\n\n"):
        cleaned = cleaned[len("Chapter Text\n\n") :]

    # Ensure chapter title is present as canonical prefix for downstream contracts.
    if title and not cleaned.startswith(title):
        cleaned = f"{title}\n\n{cleaned}".strip()

    return AO3Chapter(
        work_id=work_id,
        chapter_id=chapter_id,
        title=title,
        cleaned_text=cleaned,
    )
