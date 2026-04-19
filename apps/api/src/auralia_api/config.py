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

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
