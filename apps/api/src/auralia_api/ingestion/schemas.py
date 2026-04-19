from __future__ import annotations

from pydantic import BaseModel, Field


class IngestTextFileRequest(BaseModel):
    file_path: str = Field(..., min_length=1)
    source_id: str = Field(default="local:file")
    chapter_id: str = Field(default="ch_01")
    title: str | None = Field(default=None)


class IngestionJobOut(BaseModel):
    id: str
    status: str


class CleanedDocumentOut(BaseModel):
    id: str
    source_id: str
    chapter_id: str
    title: str | None
    text: str
    text_length: int
    normalization: dict[str, bool]


class IngestTextFileResponse(BaseModel):
    ingestion_job: IngestionJobOut
    cleaned_document: CleanedDocumentOut
