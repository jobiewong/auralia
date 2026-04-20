from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class IngestTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    source_id: str = Field(default="inline:text")
    chapter_id: str = Field(default="ch_01")
    title: str | None = Field(default=None)


class IngestAo3Request(BaseModel):
    url: str = Field(..., min_length=1)
    source_id: str | None = Field(default=None)
    chapter_id: str | None = Field(default=None)
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
    source_metadata: dict[str, Any] | None = None


class IngestTextResponse(BaseModel):
    ingestion_job: IngestionJobOut
    cleaned_document: CleanedDocumentOut
