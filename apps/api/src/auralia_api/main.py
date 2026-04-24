from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

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
