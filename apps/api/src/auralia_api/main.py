from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from auralia_api.attribution.schemas import (
    AttributeRequest,
    AttributeResponse,
)
from auralia_api.attribution.service import (
    AlreadyAttributedError,
    AttributionValidationError,
    CastRequiredError,
    attribute_document,
)
from auralia_api.attribution.service import (
    DocumentNotFoundError as AttributionDocumentNotFoundError,
)
from auralia_api.cast_detection.schemas import CastDetectRequest, CastDetectResponse
from auralia_api.cast_detection.service import (
    AlreadyCastDetectedError,
    CastDetectionError,
    detect_cast,
)
from auralia_api.cast_detection.service import (
    DocumentNotFoundError as CastDocumentNotFoundError,
)
from auralia_api.config import get_settings
from auralia_api.ingestion.ao3 import AO3FetchError, AO3ParseError, AO3ValidationError
from auralia_api.ingestion.schemas import (
    IngestAo3Request,
    IngestTextRequest,
    IngestTextResponse,
)
from auralia_api.ingestion.service import ingest_ao3, ingest_text
from auralia_api.segmentation.ollama_client import OllamaError
from auralia_api.segmentation.schemas import SegmentRequest, SegmentResponse
from auralia_api.segmentation.service import (
    AlreadySegmentedError,
    DocumentNotFoundError,
    SegmentationValidationError,
    segment_document,
)
from auralia_api.voices.qwen_tts import VoicePreviewUnavailableError
from auralia_api.voices.schemas import (
    VoiceGenerateRequest,
    VoiceGenerateResponse,
    VoiceListResponse,
    VoiceMappingListResponse,
    VoiceMappingUpsertRequest,
    VoicePreviewResponse,
    VoiceProfile,
    VoiceValidationResponse,
)
from auralia_api.voices.service import (
    VoiceValidationError,
    create_preview,
    create_voice,
    delete_voice,
    generate_workbench_audio,
    get_preview_file,
    get_workbench_file,
    update_voice,
    validate_voice,
)
from auralia_api.voices.storage import (
    VoiceDeleteBlockedError,
    VoiceNotFoundError,
    clear_voice_mapping,
    get_voice_by_id,
    list_voice_mappings,
    list_voices,
    upsert_voice_mapping,
)

app = FastAPI(title="Auralia API", version="0.1.0")

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/info")
def api_info() -> dict[str, str | int]:
    s = get_settings()
    return {
        "service": "auralia-api",
        "version": app.version,
        "api_port": s.api_port,
        "sqlite_path": s.sqlite_path,
    }


@app.post(
    "/api/voices",
    response_model=VoiceProfile,
    status_code=status.HTTP_201_CREATED,
)
async def create_voice_endpoint(request: Request) -> VoiceProfile:
    settings = get_settings()
    form = await _read_form(request)
    try:
        result = create_voice(
            sqlite_path=settings.sqlite_path,
            voice_root=settings.voice_storage_path,
            voice_id=_optional_text(form.get("voice_id")),
            display_name=str(form.get("display_name") or ""),
            mode=str(form.get("mode") or ""),
            control_text=_optional_text(form.get("control_text")),
            prompt_text=_optional_text(form.get("prompt_text")),
            temperature=_optional_float(form.get("temperature")) or 0.9,
            reference_audio=_form_file(form.get("reference_audio")),
            prompt_audio=_form_file(form.get("prompt_audio")),
        )
    except VoiceValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.args[0]) from exc
    return VoiceProfile.model_validate(result)


@app.get("/api/voices", response_model=VoiceListResponse)
def list_voices_endpoint() -> VoiceListResponse:
    settings = get_settings()
    return VoiceListResponse.model_validate(
        {"voices": list_voices(sqlite_path=settings.sqlite_path)}
    )


@app.get("/api/voices/{voice_id}", response_model=VoiceProfile)
def get_voice_endpoint(voice_id: str) -> VoiceProfile:
    settings = get_settings()
    try:
        return VoiceProfile.model_validate(
            get_voice_by_id(sqlite_path=settings.sqlite_path, voice_id=voice_id)
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/voices/{voice_id}", response_model=VoiceProfile)
async def update_voice_endpoint(voice_id: str, request: Request) -> VoiceProfile:
    settings = get_settings()
    form = await _read_form(request)
    try:
        result = update_voice(
            sqlite_path=settings.sqlite_path,
            voice_root=settings.voice_storage_path,
            voice_id=voice_id,
            display_name=_optional_text(form.get("display_name")),
            mode=_optional_text(form.get("mode")),
            control_text=_optional_text(form.get("control_text")),
            prompt_text=_optional_text(form.get("prompt_text")),
            temperature=_optional_float(form.get("temperature")),
            reference_audio=_form_file(form.get("reference_audio")),
            prompt_audio=_form_file(form.get("prompt_audio")),
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.args[0]) from exc
    return VoiceProfile.model_validate(result)


@app.delete("/api/voices/{voice_id}")
def delete_voice_endpoint(
    voice_id: str,
    force: bool = Query(
        False, description="Delete mappings that reference this voice."
    ),
) -> dict[str, int]:
    settings = get_settings()
    try:
        return delete_voice(
            sqlite_path=settings.sqlite_path,
            voice_root=settings.voice_storage_path,
            voice_id=voice_id,
            force=force,
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceDeleteBlockedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/voices/{voice_id}/validate", response_model=VoiceValidationResponse)
def validate_voice_endpoint(voice_id: str) -> VoiceValidationResponse:
    settings = get_settings()
    try:
        return VoiceValidationResponse.model_validate(
            validate_voice(
                sqlite_path=settings.sqlite_path,
                voice_root=settings.voice_storage_path,
                voice_id=voice_id,
            )
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/voices/{voice_id}/preview", response_model=VoicePreviewResponse)
def create_voice_preview_endpoint(voice_id: str) -> VoicePreviewResponse:
    settings = get_settings()
    try:
        return VoicePreviewResponse.model_validate(
            create_preview(
                sqlite_path=settings.sqlite_path,
                voice_root=settings.voice_storage_path,
                voice_id=voice_id,
            )
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.args[0]) from exc
    except VoicePreviewUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/voices/{voice_id}/preview-file/{filename}")
def get_voice_preview_file_endpoint(voice_id: str, filename: str) -> FileResponse:
    settings = get_settings()
    try:
        path = get_preview_file(
            voice_root=settings.voice_storage_path,
            voice_id=voice_id,
            filename=filename,
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="audio/wav")


@app.post("/api/voices/{voice_id}/workbench", response_model=VoiceGenerateResponse)
def generate_voice_workbench_endpoint(
    voice_id: str, request: VoiceGenerateRequest
) -> VoiceGenerateResponse:
    settings = get_settings()
    try:
        return VoiceGenerateResponse.model_validate(
            generate_workbench_audio(
                sqlite_path=settings.sqlite_path,
                voice_root=settings.voice_storage_path,
                voice_id=voice_id,
                text=request.text,
            )
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.args[0]) from exc
    except VoicePreviewUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/voices/{voice_id}/workbench-file/{filename}")
def get_voice_workbench_file_endpoint(voice_id: str, filename: str) -> FileResponse:
    settings = get_settings()
    try:
        path = get_workbench_file(
            voice_root=settings.voice_storage_path,
            voice_id=voice_id,
            filename=filename,
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="audio/wav")


@app.get(
    "/api/documents/{document_id}/voice-mappings",
    response_model=VoiceMappingListResponse,
)
def list_document_voice_mappings_endpoint(
    document_id: str,
) -> VoiceMappingListResponse:
    settings = get_settings()
    return VoiceMappingListResponse.model_validate(
        {
            "mappings": list_voice_mappings(
                sqlite_path=settings.sqlite_path,
                document_id=document_id,
            )
        }
    )


@app.post("/api/documents/{document_id}/voice-mappings")
def upsert_document_voice_mapping_endpoint(
    document_id: str,
    request: VoiceMappingUpsertRequest,
) -> dict:
    settings = get_settings()
    try:
        return upsert_voice_mapping(
            sqlite_path=settings.sqlite_path,
            document_id=document_id,
            speaker=request.speaker,
            voice_id=request.voice_id,
        )
    except VoiceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/documents/{document_id}/voice-mappings/{speaker}")
def clear_document_voice_mapping_endpoint(
    document_id: str, speaker: str
) -> dict[str, int]:
    settings = get_settings()
    return clear_voice_mapping(
        sqlite_path=settings.sqlite_path,
        document_id=document_id,
        speaker=speaker,
    )


async def _read_form(request: Request) -> dict[str, str | UploadFile]:
    form_data = await request.form()
    return dict(form_data)  # type: ignore[arg-type]


def _optional_text(value: str | UploadFile | None) -> str | None:
    return value if isinstance(value, str) else None


def _optional_float(value: str | UploadFile | None) -> float | None:
    if not isinstance(value, str) or value == "":
        return None
    return float(value)


def _optional_int(value: str | UploadFile | None) -> int | None:
    if not isinstance(value, str) or value == "":
        return None
    return int(value)


def _form_file(value: str | UploadFile | None) -> UploadFile | None:
    if value is None or isinstance(value, str):
        return None
    return value


@app.post(
    "/api/ingest/text",
    response_model=IngestTextResponse,
    status_code=status.HTTP_201_CREATED,
)
def ingest_text_endpoint(req: IngestTextRequest) -> IngestTextResponse:
    settings = get_settings()
    try:
        result = ingest_text(req=req, sqlite_path=settings.sqlite_path)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Text is empty after cleaning",
        ) from exc

    return IngestTextResponse.model_validate(result)


@app.post(
    "/api/segment",
    response_model=SegmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def segment_endpoint(
    req: SegmentRequest,
    force: bool = Query(
        False,
        description=(
            "If true and the document already has spans, delete them "
            "(cascading to any attributions) and re-run."
        ),
    ),
) -> SegmentResponse:
    settings = get_settings()
    try:
        result = segment_document(
            document_id=req.document_id,
            sqlite_path=settings.sqlite_path,
            force=force,
        )
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AlreadySegmentedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SegmentationValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "segmentation output failed validation",
                "job_id": exc.job_id,
                "report": exc.report,
            },
        ) from exc

    return SegmentResponse.model_validate(result)


@app.post(
    "/api/ingest/ao3",
    response_model=IngestTextResponse,
    status_code=status.HTTP_201_CREATED,
)
def ingest_ao3_endpoint(req: IngestAo3Request) -> IngestTextResponse:
    settings = get_settings()
    try:
        result = ingest_ao3(req=req, sqlite_path=settings.sqlite_path)
    except AO3ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AO3FetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except AO3ParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return IngestTextResponse.model_validate(result)


@app.post(
    "/api/detect-cast",
    response_model=CastDetectResponse,
    status_code=status.HTTP_201_CREATED,
)
def detect_cast_endpoint(
    req: CastDetectRequest,
    force: bool = Query(
        False,
        description=(
            "If true and the document already has cast members, delete generated "
            "cast rows while preserving manual edits/deletions, then re-run."
        ),
    ),
) -> CastDetectResponse:
    settings = get_settings()
    try:
        result = detect_cast(
            document_id=req.document_id,
            sqlite_path=settings.sqlite_path,
            model_name=settings.cast_detection_model,
            base_url=settings.ollama_base_url,
            timeout_seconds=settings.ollama_timeout_seconds,
            max_retries=settings.cast_detection_max_retries,
            force=force,
            use_llm=req.use_llm,
        )
    except CastDocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AlreadyCastDetectedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except CastDetectionError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "cast detection failed",
                "job_id": exc.job_id,
                "report": exc.report,
            },
        ) from exc
    except OllamaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return CastDetectResponse.model_validate(result)


@app.post(
    "/api/attribute",
    response_model=AttributeResponse,
    status_code=status.HTTP_201_CREATED,
)
def attribute_endpoint(
    req: AttributeRequest,
    force: bool = Query(
        False,
        description=(
            "If true and the document already has attributions, delete them "
            "(and overwrite the cached roster on success) and re-run."
        ),
    ),
) -> AttributeResponse:
    settings = get_settings()
    try:
        result = attribute_document(
            document_id=req.document_id,
            sqlite_path=settings.sqlite_path,
            model_name=settings.attribution_model,
            base_url=settings.ollama_base_url,
            timeout_seconds=settings.ollama_timeout_seconds,
            confidence_threshold=settings.attribution_confidence_threshold,
            max_window_dialogues=settings.attribution_max_window_dialogues,
            max_window_chars=settings.attribution_max_window_chars,
            max_gap_chars=settings.attribution_max_gap_chars,
            max_retries=settings.attribution_max_retries,
            force=force,
        )
    except AttributionDocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AlreadyAttributedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except CastRequiredError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AttributionValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "attribution output failed validation",
                "job_id": exc.job_id,
                "report": exc.report,
            },
        ) from exc
    except OllamaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return AttributeResponse.model_validate(result)
