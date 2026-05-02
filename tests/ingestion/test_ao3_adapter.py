import urllib.error

from auralia_api.ingestion.ao3 import (
    AO3Author,
    AO3FetchError,
    AO3ValidationError,
    fetch_ao3_chapter,
)


class _FakeResponse:
    def __init__(
        self,
        body: bytes,
        content_type: str = "text/html; charset=utf-8",
        final_url: str = "https://archiveofourown.org/works/1/chapters/1",
    ) -> None:
        self._body = body
        self._final_url = final_url
        self.headers = {"Content-Type": content_type}

    def read(self, _size: int = -1) -> bytes:
        return self._body

    def geturl(self) -> str:
        return self._final_url

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


AO3_SAMPLE_HTML = (
    "<html>"
    "<body>"
    "<div id='workskin'>"
    "<div class='preface group'>"
    "<h2 class='title heading'>Hogwarts and All That</h2>"
    "<h3 class='byline heading'>"
    "<a rel='author' href='/users/JaneAuthor/pseuds/JaneAuthor'>JaneAuthor</a>"
    ", "
    "<a rel='author' href='/users/CoWriter/pseuds/CoWriter'>CoWriter</a>"
    "</h3>"
    "</div>"
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
    "</div>"
    "<ul class='work navigation actions'>"
    "<li class='chapter previous'>"
    "<a href='/works/52818466/chapters/133596876'>&larr; Previous Chapter</a>"
    "</li>"
    "<li class='chapter' role='navigation'>"
    "<form><select id='selected_id'></select></form>"
    "</li>"
    "<li class='chapter next'>"
    "<a href='/works/52818466/chapters/133596878'>Next Chapter &rarr;</a>"
    "</li>"
    "</ul>"
    "</body>"
    "</html>"
).encode("utf-8")


def test_fetch_ao3_chapter_extracts_title_and_cleaned_body(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=15):
        captured["request"] = request
        return _FakeResponse(AO3_SAMPLE_HTML)

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    chapter = fetch_ao3_chapter(
        "https://archiveofourown.org/works/52818466/chapters/133596877",
    )

    assert captured["request"].get_header("Cookie") == "view_adult=true"
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
    assert chapter.work_title == "Hogwarts and All That"
    assert chapter.authors == [
        AO3Author(
            name="JaneAuthor",
            url="https://archiveofourown.org/users/JaneAuthor/pseuds/JaneAuthor",
        ),
        AO3Author(
            name="CoWriter",
            url="https://archiveofourown.org/users/CoWriter/pseuds/CoWriter",
        ),
    ]
    assert (
        chapter.previous_chapter_url
        == "https://archiveofourown.org/works/52818466/chapters/133596876"
    )
    assert (
        chapter.next_chapter_url
        == "https://archiveofourown.org/works/52818466/chapters/133596878"
    )


def test_fetch_ao3_chapter_rejects_non_ao3_urls():
    try:
        fetch_ao3_chapter("https://example.com/works/1/chapters/2")
    except AO3ValidationError as exc:
        assert "archiveofourown.org" in str(exc)
    else:
        raise AssertionError("Expected AO3ValidationError")


def test_fetch_ao3_chapter_detects_restricted_work_redirect(monkeypatch):
    def fake_urlopen(_request, timeout=15):
        return _FakeResponse(
            b"<html><title>Home | Archive of Our Own</title></html>",
            final_url="https://archiveofourown.org/",
        )

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    try:
        fetch_ao3_chapter(
            "https://archiveofourown.org/works/52818466/chapters/133596877",
        )
    except AO3FetchError as exc:
        assert "redirected" in str(exc).lower()
    else:
        raise AssertionError("Expected AO3FetchError for redirected response")


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
