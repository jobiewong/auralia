from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AttributeRequest(BaseModel):
    document_id: str = Field(..., description="Previously segmented document id.")


class AttributionOut(BaseModel):
    span_id: str
    speaker: str
    speaker_confidence: float
    needs_review: bool
    source: Literal["deterministic_tag", "llm_windowed"]


class AttributionJobOut(BaseModel):
    id: str
    document_id: str
    status: Literal["pending", "running", "failed", "completed"]
    model_name: str | None = None
    stats: dict[str, Any] | None = None
    completed_at: str | None = None


class CharacterRosterOut(BaseModel):
    canonical_name: str
    aliases: list[str]
    descriptor: str


class AttributeResponse(BaseModel):
    attribution_job: AttributionJobOut
    roster: list[CharacterRosterOut]
    attributions: list[AttributionOut]
    force_wipe: dict[str, int] | None = None
