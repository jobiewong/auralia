import urllib.error

from auralia_api.ingestion.ao3 import (
    AO3FetchError,
    AO3ValidationError,
    fetch_ao3_chapter,
)


class _FakeResponse:
    def __init__(
        self,
        body: bytes,
        content_type: str = "text/html; charset=utf-8",
    ) -> None:
        self._body = body
        self.headers = {"Content-Type": content_type}

    def read(self, _size: int = -1) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


AO3_SAMPLE_HTML = (
    "<html>"
    "<body>"
    "<div id='chapters'>"
    "<div class='chapter' id='chapter-133596877'>"
    "<h3 class='title'>Chapter 1: Year 1</h3>"
    "<div class='userstuff module' role='article'>"
    "<p>Chapter 1: Year 1</p>"
    "<p>It all started when Lara Sanders got her letter from Hogwarts.</p>"
    "<p>All in all, Lara was surprised how quickly she came to think "
    "of Hogwarts as \u201chome.\u201d It felt odd going back to her "
    "actual home at the end of the year, and Lara couldn\u2019t wait "
    "to come back for her second year.</p>"
    "</div>"
    "</div>"
    "</div>"
    "</body>"
    "</html>"
).encode("utf-8")


def test_fetch_ao3_chapter_extracts_title_and_cleaned_body(monkeypatch):
    def fake_urlopen(_request, timeout=15):
        return _FakeResponse(AO3_SAMPLE_HTML)

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    chapter = fetch_ao3_chapter(
        "https://archiveofourown.org/works/52818466/chapters/133596877",
    )

    assert chapter.work_id == "52818466"
    assert chapter.chapter_id == "133596877"
    assert chapter.title == "Chapter 1: Year 1"
    assert chapter.cleaned_text.startswith(
        "Chapter 1: Year 1\n\n"
        "It all started when Lara Sanders got her letter from Hogwarts.",
    )
    assert chapter.cleaned_text.endswith(
        "All in all, Lara was surprised how quickly she came to think "
        "of Hogwarts as \"home.\" It felt odd going back to her actual "
        "home at the end of the year, and Lara couldn't wait to come "
        "back for her second year.",
    )


def test_fetch_ao3_chapter_rejects_non_ao3_urls():
    try:
        fetch_ao3_chapter("https://example.com/works/1/chapters/2")
    except AO3ValidationError as exc:
        assert "archiveofourown.org" in str(exc)
    else:
        raise AssertionError("Expected AO3ValidationError")


def test_fetch_ao3_chapter_wraps_transport_timeout(monkeypatch):
    def fake_urlopen(_request, timeout=15):
        raise TimeoutError("read timed out")

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    try:
        fetch_ao3_chapter(
            "https://archiveofourown.org/works/52818466/chapters/133596877",
        )
    except AO3FetchError as exc:
        assert "timed out" in str(exc)
    else:
        raise AssertionError("Expected AO3FetchError")


def test_fetch_ao3_chapter_wraps_url_errors(monkeypatch):
    def fake_urlopen(_request, timeout=15):
        raise urllib.error.URLError("temporary dns failure")

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    try:
        fetch_ao3_chapter(
            "https://archiveofourown.org/works/52818466/chapters/133596877",
        )
    except AO3FetchError as exc:
        assert "temporary dns failure" in str(exc)
    else:
        raise AssertionError("Expected AO3FetchError")
