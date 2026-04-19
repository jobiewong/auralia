from __future__ import annotations

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from auralia_api.config import get_settings
from auralia_api.ingestion.schemas import IngestTextFileRequest, IngestTextFileResponse
from auralia_api.ingestion.service import ingest_local_text_file

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
    "/api/ingest/text-file",
    response_model=IngestTextFileResponse,
    status_code=status.HTTP_201_CREATED,
)
def ingest_text_file(req: IngestTextFileRequest) -> IngestTextFileResponse:
    settings = get_settings()
    try:
        result = ingest_local_text_file(req=req, sqlite_path=settings.sqlite_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404, detail="Input text file not found"
        ) from exc

    return IngestTextFileResponse.model_validate(result)
