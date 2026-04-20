from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class SegmentRequest(BaseModel):
    document_id: str = Field(..., description="Previously ingested document id.")


class SpanOut(BaseModel):
    id: str
    type: Literal["narration", "dialogue"]
    text: str
    start: int
    end: int


class SegmentationJobOut(BaseModel):
    id: str
    document_id: str
    status: Literal["pending", "running", "failed", "completed"]
    chunk_count: int
    model_name: str | None = None
    stats: dict[str, Any] | None = None


class SegmentResponse(BaseModel):
    segmentation_job: SegmentationJobOut
    spans: list[SpanOut]
