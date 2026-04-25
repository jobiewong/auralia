from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

VoiceMode = Literal["designed", "clone", "hifi_clone"]


class VoiceProfile(BaseModel):
    id: str
    display_name: str
    mode: VoiceMode
    control_text: str | None = None
    reference_audio_path: str | None = None
    prompt_audio_path: str | None = None
    prompt_text: str | None = None
    cfg_value: float = 2.0
    inference_timesteps: int = 10
    is_canonical: bool = True
    preview_audio_path: str | None = None
    preview_sentence: str | None = None
    created_at: str
    updated_at: str


class VoiceValidationIssue(BaseModel):
    code: str
    field: str | None = None
    message: str


class VoiceValidationResponse(BaseModel):
    voice_id: str
    valid: bool
    errors: list[VoiceValidationIssue] = Field(default_factory=list)
    warnings: list[VoiceValidationIssue] = Field(default_factory=list)


class VoiceListResponse(BaseModel):
    voices: list[VoiceProfile]


class VoicePreviewResponse(BaseModel):
    voice_id: str
    sentence: str
    audio_path: str
    audio_url: str
