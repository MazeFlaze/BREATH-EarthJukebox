import json
import os
from pathlib import Path
from typing import Any, List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_catalog_root(config_file: Path | None = None) -> Path:
    """Resolve the default verified catalog path across repo and container layouts."""
    target = (config_file or Path(__file__)).resolve()
    if len(target.parents) > 3 and (target.parents[3] / "frontend").is_dir():
        return target.parents[3] / "frontend/public/data/geos-cf-catalog"
    return target.parents[2] / "data/geos-cf-catalog"


class Settings(BaseSettings):
    """
    Application Settings configured via environment variables and .env file.
    Follows Pydantic v2 BaseSettings specification.
    """

    # Service Configuration
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "INFO"

    # Database Configuration (PostgreSQL with SQLite fallback)
    DATABASE_URL: str = "sqlite:///src/data/breathe.db"
    DATABASE_URL_UNPOOLED: Optional[str] = None

    # Data Storage Root for NetCDF files
    DATA_STORAGE_ROOT: Path = Path(__file__).resolve().parent.parent / "data" / "raw"
    NASA_ARCHIVE_ROOT: Path = Path(__file__).resolve().parent.parent / "data" / "nasa-archive"
    # Read-only verified artifacts from the existing manual exporter. Mount this directory in production.
    GEOS_CF_CATALOG_ROOT: Path = _default_catalog_root()

    # NASA GEOS-CF Product Configuration
    NASA_PROVIDER: str = "NASA GMAO"
    NASA_GEOS_CF_VERSION: str = "v2"
    NASA_GEOS_CF_PRODUCT: str = "aqc_tavg_1hr_glo_L1440x721_slv"
    NASA_GEOS_CF_PORTAL_URL: str = "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana"
    NASA_GEOS_CF_OPENDAP_URL: str = "https://opendap.nccs.nasa.gov/dods/gmao/geos-cf/v2/ana"
    NASA_EARTHDATA_TOKEN: Optional[str] = None
    ENABLE_REMOTE_OPENDAP: bool = False
    OPENDAP_TIMEOUT_SECONDS: int = 5

    # Ingestion Controls
    INGEST_REQUEST_TIMEOUT: int = 60
    INGEST_MAX_RETRIES: int = 3
    INGEST_MAX_CONCURRENCY: int = 4
    MAX_RAW_FILES_TO_KEEP: int = 10

    # Cache Configuration
    CACHE_ENABLED: bool = True
    CACHE_TTL_SECONDS: int = 3600
    CACHE_MAX_SIZE: int = 1000

    # CORS Allowed Origins (accepts JSON array or comma-separated string in env)
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:3000",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> List[str]:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                try:
                    parsed = json.loads(stripped)
                    if isinstance(parsed, list):
                        return [
                            str(item).strip().rstrip("/") if str(item).strip() != "*" else "*"
                            for item in parsed
                            if str(item).strip()
                        ]
                except json.JSONDecodeError:
                    pass
            return [
                item.strip().rstrip("/") if item.strip() != "*" else "*"
                for item in stripped.split(",")
                if item.strip()
            ]
        if isinstance(value, (list, tuple)):
            return [
                str(item).strip().rstrip("/") if str(item).strip() != "*" else "*"
                for item in value
                if str(item).strip()
            ]
        return []

    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env", "backend/.env.local", "backend/.env", "../.env.local", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
