from __future__ import annotations

import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser

from .cleaning import clean_prose_text

_AO3_ORIGIN = "https://archiveofourown.org"
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
class AO3Author:
    name: str
    url: str | None = None


@dataclass(slots=True)
class AO3Chapter:
    work_id: str
    chapter_id: str
    title: str | None
    cleaned_text: str
    work_title: str | None = None
    authors: list[AO3Author] = field(default_factory=list)
    previous_chapter_url: str | None = None
    next_chapter_url: str | None = None


class _AO3ChapterParser(HTMLParser):
    """Extract chapter body and work metadata from AO3 chapter HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._depth = 0

        # chapter body
        self._chapters_depth: int | None = None
        self._target_depth: int | None = None
        self._capturing_chapter_title = False
        self._chapter_title_chunks: list[str] = []
        self._body_chunks: list[str] = []

        # work metadata
        self._in_work_title = False
        self._work_title_chunks: list[str] = []
        self._in_author = False
        self._author_chunks: list[str] = []
        self._current_author_url: str | None = None
        self._authors: list[AO3Author] = []

        # chapter navigation
        self._in_prev_li = False
        self._in_next_li = False
        self._previous_chapter_url: str | None = None
        self._next_chapter_url: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._depth += 1
        attrs_dict = {k: (v or "") for k, v in attrs}
        class_names = set(attrs_dict.get("class", "").split())

        # --- Chapter body + chapter title (scoped to #chapters) ---
        if tag == "div" and attrs_dict.get("id") == "chapters":
            self._chapters_depth = self._depth

        in_chapters = (
            self._chapters_depth is not None
            and self._depth >= self._chapters_depth
        )
        if in_chapters:
            if tag == "h3" and "title" in class_names:
                self._capturing_chapter_title = True

            if (
                tag == "div"
                and self._target_depth is None
                and {"userstuff", "module"}.issubset(class_names)
            ):
                self._target_depth = self._depth

        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(self.get_starttag_text())

        # --- Work title (h2.title.heading, outside #chapters) ---
        if (
            tag == "h2"
            and not in_chapters
            and "title" in class_names
            and "heading" in class_names
        ):
            self._in_work_title = True

        # --- Authors (a[rel=author]) ---
        if tag == "a" and attrs_dict.get("rel", "").strip().lower() == "author":
            self._in_author = True
            self._author_chunks = []
            self._current_author_url = attrs_dict.get("href") or None

        # --- Chapter nav (li.chapter.previous / li.chapter.next) ---
        if tag == "li" and "chapter" in class_names:
            if "previous" in class_names:
                self._in_prev_li = True
            elif "next" in class_names:
                self._in_next_li = True

        if tag == "a":
            href = attrs_dict.get("href") or ""
            if "/chapters/" in href:
                if self._in_prev_li and self._previous_chapter_url is None:
                    self._previous_chapter_url = href
                if self._in_next_li and self._next_chapter_url is None:
                    self._next_chapter_url = href

    def handle_endtag(self, tag: str) -> None:
        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(f"</{tag}>")

        if self._capturing_chapter_title and tag == "h3":
            self._capturing_chapter_title = False

        if self._in_work_title and tag == "h2":
            self._in_work_title = False

        if self._in_author and tag == "a":
            name = "".join(self._author_chunks).strip()
            if name:
                self._authors.append(
                    AO3Author(name=name, url=self._current_author_url),
                )
            self._in_author = False
            self._author_chunks = []
            self._current_author_url = None

        if tag == "li":
            self._in_prev_li = False
            self._in_next_li = False

        if self._target_depth is not None and self._depth == self._target_depth:
            self._target_depth = None

        if self._chapters_depth is not None and self._depth == self._chapters_depth:
            self._chapters_depth = None

        self._depth -= 1

    def handle_data(self, data: str) -> None:
        if self._capturing_chapter_title:
            self._chapter_title_chunks.append(data)

        if self._in_work_title:
            self._work_title_chunks.append(data)

        if self._in_author:
            self._author_chunks.append(data)

        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self._target_depth is not None and self._depth >= self._target_depth:
            self._body_chunks.append(f"&#{name};")

    def result(self) -> dict:
        chapter_title = "".join(self._chapter_title_chunks).strip() or None
        work_title = "".join(self._work_title_chunks).strip() or None
        body_html = "".join(self._body_chunks).strip()
        return {
            "chapter_title": chapter_title,
            "work_title": work_title,
            "authors": list(self._authors),
            "previous_chapter_url": self._previous_chapter_url,
            "next_chapter_url": self._next_chapter_url,
            "body_html": body_html,
        }


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
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64; rv:122.0) "
                "Gecko/20100101 Firefox/122.0"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "identity",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            final_path = urllib.parse.urlparse(response.geturl()).path
            if not final_path.startswith("/works/"):
                raise AO3FetchError(
                    "AO3 redirected away from the chapter URL "
                    "(work may be restricted to registered users, archive-locked, "
                    "or removed)",
                )

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


def _absolutize(href: str | None) -> str | None:
    if not href:
        return None
    return urllib.parse.urljoin(f"{_AO3_ORIGIN}/", href)


def fetch_ao3_chapter(url: str) -> AO3Chapter:
    work_id, chapter_id = _validate_ao3_url(url)
    html_doc = _fetch_html(url)

    parser = _AO3ChapterParser()
    parser.feed(html_doc)
    parser.close()

    parsed = parser.result()
    body_html = parsed["body_html"]
    if not body_html:
        raise AO3ParseError("Could not locate AO3 chapter body")

    cleaned = clean_prose_text(body_html)
    if not cleaned:
        raise AO3ParseError("AO3 chapter body is empty after cleaning")

    if cleaned.startswith("Chapter Text\n\n"):
        cleaned = cleaned[len("Chapter Text\n\n") :]

    chapter_title = parsed["chapter_title"]
    if chapter_title and not cleaned.startswith(chapter_title):
        cleaned = f"{chapter_title}\n\n{cleaned}".strip()

    authors: list[AO3Author] = []
    for author in parsed["authors"]:
        authors.append(AO3Author(name=author.name, url=_absolutize(author.url)))

    return AO3Chapter(
        work_id=work_id,
        chapter_id=chapter_id,
        title=chapter_title,
        cleaned_text=cleaned,
        work_title=parsed["work_title"],
        authors=authors,
        previous_chapter_url=_absolutize(parsed["previous_chapter_url"]),
        next_chapter_url=_absolutize(parsed["next_chapter_url"]),
    )
