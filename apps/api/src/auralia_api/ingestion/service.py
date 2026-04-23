from __future__ import annotations

from dataclasses import asdict
from uuid import uuid4

from .ao3 import AO3Chapter, fetch_ao3_chapter
from .cleaning import clean_prose_text
from .schemas import IngestAo3Request, IngestTextRequest
from .storage import insert_document, insert_ingestion_job


def _persist_ingestion_result(
    *,
    sqlite_path: str,
    source_type: str,
    source_ref: str,
    source_id: str,
    chapter_id: str,
    title: str | None,
    cleaned_text: str,
    source_metadata: dict | None = None,
) -> dict:
    document_id = f"doc_{uuid4().hex[:12]}"
    job_id = f"ing_{uuid4().hex[:12]}"

    document = {
        "id": document_id,
        "source_type": source_type,
        "source_id": source_id,
        "chapter_id": chapter_id,
        "title": title,
        "text": cleaned_text,
        "text_length": len(cleaned_text),
        "normalization": {
            "whitespace_normalized": True,
            "html_removed": True,
            "markdown_removed": True,
            "quotes_normalized": True,
            "punctuation_normalized": True,
        },
        "source_metadata": source_metadata,
    }

    job = {
        "id": job_id,
        "source_type": source_type,
        "source_ref": source_ref,
        "status": "completed",
        "document_id": document_id,
        "error_message": None,
    }

    insert_document(sqlite_path=sqlite_path, document=document)
    insert_ingestion_job(sqlite_path=sqlite_path, job=job)

    return {
        "ingestion_job": {"id": job_id, "status": "completed"},
        "cleaned_document": document,
    }


def _ao3_source_metadata(chapter: AO3Chapter) -> dict:
    return {
        "source": "ao3",
        "work_id": chapter.work_id,
        "work_title": chapter.work_title,
        "authors": [asdict(a) for a in chapter.authors],
        "chapter_id": chapter.chapter_id,
        "chapter_title": chapter.title,
        "chapter_number": chapter.chapter_number,
        "previous_chapter_url": chapter.previous_chapter_url,
        "next_chapter_url": chapter.next_chapter_url,
        "summary": chapter.summary,
    }


def ingest_text(*, req: IngestTextRequest, sqlite_path: str) -> dict:
    cleaned_text = clean_prose_text(req.text)
    if not cleaned_text:
        raise ValueError("Cleaned text is empty")

    return _persist_ingestion_result(
        sqlite_path=sqlite_path,
        source_type="text",
        source_ref=req.source_id,
        source_id=req.source_id,
        chapter_id=req.chapter_id,
        title=req.title,
        cleaned_text=cleaned_text,
    )


def ingest_ao3(*, req: IngestAo3Request, sqlite_path: str) -> dict:
    chapter = fetch_ao3_chapter(req.url)

    source_id = req.source_id or f"ao3:work:{chapter.work_id}"
    chapter_id = req.chapter_id or f"ch_{chapter.chapter_id}"
    title = req.title or chapter.title

    return _persist_ingestion_result(
        sqlite_path=sqlite_path,
        source_type="ao3",
        source_ref=req.url,
        source_id=source_id,
        chapter_id=chapter_id,
        title=title,
        cleaned_text=chapter.cleaned_text,
        source_metadata=_ao3_source_metadata(chapter),
    )
