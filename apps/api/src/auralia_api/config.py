from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment.

    Optionally reads `.env` at repository root.
    """

    model_config = SettingsConfigDict(
        env_prefix="AURALIA_",
        env_file=(".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_host: str = Field(default="0.0.0.0", description="Bind address for Uvicorn.")
    api_port: int = Field(default=8000, ge=1, le=65535)
    sqlite_path: str = Field(
        default="data/db/auralia.sqlite",
        description="SQLite database file path relative to the repository root.",
    )
    cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:3000",
        description="Comma-separated list of allowed CORS origins.",
    )

    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Base URL of the local Ollama server.",
    )
    segmentation_model: str = Field(
        default="qwen3:8b",
        description="Ollama model tag used for segmentation.",
    )
    chunk_size: int = Field(
        default=3000, ge=500, le=16000, description="Target chunk size (chars)."
    )
    chunk_overlap: int = Field(
        default=200, ge=0, le=2000, description="Overlap between chunks (chars)."
    )
    segmentation_max_retries: int = Field(
        default=3,
        ge=0,
        le=10,
        description="Max LLM retries per chunk on malformed output.",
    )
    ollama_timeout_seconds: float = Field(
        default=120.0,
        gt=0,
        description="HTTP timeout for a single Ollama generate call.",
    )

    attribution_model: str = Field(
        default="qwen3:8b",
        description="Ollama model tag used for speaker attribution.",
    )
    attribution_confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    attribution_max_window_dialogues: int = Field(default=12, ge=1, le=50)
    attribution_max_window_chars: int = Field(default=6000, ge=1000, le=20000)
    attribution_max_gap_chars: int = Field(default=400, ge=0, le=5000)
    attribution_max_retries: int = Field(default=3, ge=0, le=10)

    cast_detection_model: str = Field(
        default="qwen3:8b",
        description="Ollama model tag used for optional cast canonicalization.",
    )
    cast_detection_max_retries: int = Field(default=3, ge=0, le=10)
    voice_storage_path: str = Field(
        default="data/voices",
        description="Directory for imported voice assets and generated previews.",
    )

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
