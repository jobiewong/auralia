from __future__ import annotations

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from auralia_api.config import get_settings
from auralia_api.ingestion.schemas import IngestTextRequest, IngestTextResponse
from auralia_api.ingestion.service import ingest_text

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
