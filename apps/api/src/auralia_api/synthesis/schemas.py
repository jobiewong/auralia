from __future__ import annotations

from pydantic import BaseModel, Field


class SynthesisRequest(BaseModel):
    document_id: str = Field(..., description="Document id with reviewed attribution.")


class SynthesisJob(BaseModel):
    id: str
    document_id: str
    status: str
    output_path: str | None = None
    manifest_path: str | None = None
    stats: dict | None = None
    error_report: dict | None = None
    completed_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class SynthesisResponse(BaseModel):
    synthesis_job: SynthesisJob
    force_wipe: dict[str, int] | None = None
