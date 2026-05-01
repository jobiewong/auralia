from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CastDetectRequest(BaseModel):
    document_id: str = Field(..., description="Previously segmented document id.")
    use_llm: bool = Field(
        default=False,
        description=(
            "If true, run compact LLM canonicalization over harvested evidence."
        ),
    )


class CastDetectionJobOut(BaseModel):
    id: str
    document_id: str
    status: Literal["pending", "running", "failed", "completed"]
    model_name: str | None = None
    stats: dict[str, Any] | None = None
    completed_at: str | None = None


class CastMemberOut(BaseModel):
    id: str | None = None
    document_id: str | None = None
    canonical_name: str
    aliases: list[str]
    descriptor: str = ""
    confidence: float = 1.0
    needs_review: bool = False
    source: str = "deterministic"
    manually_edited: bool = False
    manually_deleted: bool = False


class CastEvidenceOut(BaseModel):
    id: str | None = None
    cast_member_id: str | None = None
    document_id: str
    span_id: str
    related_dialogue_span_id: str
    evidence_type: str
    surface_text: str
    evidence_text: str
    confidence: float


class CastDetectResponse(BaseModel):
    cast_detection_job: CastDetectionJobOut
    cast: list[CastMemberOut]
    evidence: list[CastEvidenceOut]
    force_wipe: dict[str, int] | None = None
