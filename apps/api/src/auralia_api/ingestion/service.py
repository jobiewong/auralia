from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from .cleaning import clean_prose_text
from .schemas import IngestTextFileRequest
from .storage import insert_document, insert_ingestion_job


def ingest_local_text_file(*, req: IngestTextFileRequest, sqlite_path: str) -> dict:
    source = Path(req.file_path)
    if not source.exists() or not source.is_file():
        raise FileNotFoundError(req.file_path)

    raw_text = source.read_text(encoding="utf-8")
    cleaned_text = clean_prose_text(raw_text)

    document_id = f"doc_{uuid4().hex[:12]}"
    job_id = f"ing_{uuid4().hex[:12]}"

    document = {
        "id": document_id,
        "source_id": req.source_id,
        "chapter_id": req.chapter_id,
        "title": req.title,
        "text": cleaned_text,
        "text_length": len(cleaned_text),
        "normalization": {"whitespace_normalized": True, "html_removed": True},
    }

    job = {
        "id": job_id,
        "source_type": "text_file",
        "source_ref": str(source),
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
