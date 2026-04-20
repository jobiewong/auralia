from pathlib import Path

from fastapi.testclient import TestClient

from auralia_api.config import get_settings
from auralia_api.main import app


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


def _client_with_db(monkeypatch, db_path: Path) -> TestClient:
    monkeypatch.setenv("AURALIA_SQLITE_PATH", str(db_path))
    get_settings.cache_clear()
    return TestClient(app)


def test_ingest_ao3_endpoint_persists_cleaned_document(monkeypatch, tmp_path):
    html = (
        "<html><body>"
        "<div id='workskin'>"
        "<div class='preface group'>"
        "<h2 class='title heading'>Hogwarts and All That</h2>"
        "<h3 class='byline heading'>"
        "<a rel='author' href='/users/JaneAuthor/pseuds/JaneAuthor'>JaneAuthor</a>"
        "</h3>"
        "</div>"
        "<div id='chapters'>"
        "<h3 class='title'>Chapter 1: Year 1</h3>"
        "<div class='userstuff module'>"
        "<p>Chapter 1: Year 1</p>"
        "<p>It all started when Lara Sanders got her letter from Hogwarts.</p>"
        "<p>All in all, Lara was surprised how quickly she came to think "
        "of Hogwarts as \u201chome.\u201d It felt odd going back to her "
        "actual home at the end of the year, and Lara couldn\u2019t wait "
        "to come back for her second year.</p>"
        "</div>"
        "</div>"
        "</div>"
        "<ul class='work navigation actions'>"
        "<li class='chapter previous'>"
        "<a href='/works/52818466/chapters/133596876'>&larr; Previous</a>"
        "</li>"
        "<li class='chapter next'>"
        "<a href='/works/52818466/chapters/133596878'>Next &rarr;</a>"
        "</li>"
        "</ul>"
        "</body></html>"
    ).encode("utf-8")

    def fake_urlopen(_request, timeout=15):
        return _FakeResponse(html)

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post(
        "/api/ingest/ao3",
        json={"url": "https://archiveofourown.org/works/52818466/chapters/133596877"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["ingestion_job"]["status"] == "completed"
    assert payload["cleaned_document"]["source_id"] == "ao3:work:52818466"
    assert payload["cleaned_document"]["chapter_id"] == "ch_133596877"
    assert payload["cleaned_document"]["title"] == "Chapter 1: Year 1"
    assert payload["cleaned_document"]["text"].startswith(
        "Chapter 1: Year 1\n\n"
        "It all started when Lara Sanders got her letter from Hogwarts.",
    )

    metadata = payload["cleaned_document"]["source_metadata"]
    assert metadata == {
        "source": "ao3",
        "work_id": "52818466",
        "work_title": "Hogwarts and All That",
        "authors": [
            {
                "name": "JaneAuthor",
                "url": "https://archiveofourown.org/users/JaneAuthor/pseuds/JaneAuthor",
            },
        ],
        "chapter_id": "133596877",
        "chapter_title": "Chapter 1: Year 1",
        "previous_chapter_url": "https://archiveofourown.org/works/52818466/chapters/133596876",
        "next_chapter_url": "https://archiveofourown.org/works/52818466/chapters/133596878",
    }


def test_ingest_ao3_endpoint_rejects_invalid_url(monkeypatch, tmp_path):
    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post(
        "/api/ingest/ao3",
        json={"url": "https://example.com/works/1/chapters/2"},
    )

    assert response.status_code == 400
    assert "archiveofourown.org" in response.json()["detail"]


def test_ingest_ao3_endpoint_maps_fetch_timeout_to_502(monkeypatch, tmp_path):
    def fake_urlopen(_request, timeout=15):
        raise TimeoutError("read timed out")

    monkeypatch.setattr(
        "auralia_api.ingestion.ao3.urllib.request.urlopen",
        fake_urlopen,
    )

    db_path = tmp_path / "auralia.sqlite"
    client = _client_with_db(monkeypatch, db_path)

    response = client.post(
        "/api/ingest/ao3",
        json={"url": "https://archiveofourown.org/works/52818466/chapters/133596877"},
    )

    assert response.status_code == 502
    assert "timed out" in response.json()["detail"]
