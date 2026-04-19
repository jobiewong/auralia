from __future__ import annotations

from uuid import uuid4

from .cleaning import clean_prose_text
from .schemas import IngestTextRequest
from .storage import insert_document, insert_ingestion_job


def ingest_text(*, req: IngestTextRequest, sqlite_path: str) -> dict:
    cleaned_text = clean_prose_text(req.text)
    if not cleaned_text:
        raise ValueError("Cleaned text is empty")

    document_id = f"doc_{uuid4().hex[:12]}"
    job_id = f"ing_{uuid4().hex[:12]}"

    document = {
        "id": document_id,
        "source_id": req.source_id,
        "chapter_id": req.chapter_id,
        "title": req.title,
        "text": cleaned_text,
        "text_length": len(cleaned_text),
        "normalization": {
            "whitespace_normalized": True,
            "html_removed": True,
            "markdown_removed": True,
            "quotes_normalized": True,
            "punctuation_normalized": True,
        },
    }

    job = {
        "id": job_id,
        "source_type": "text",
        "source_ref": req.source_id,
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
