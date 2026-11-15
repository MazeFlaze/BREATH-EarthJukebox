import os
from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # CORS Allowed Origins
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:3000",
    ]

    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env", "backend/.env.local", "backend/.env", "../.env.local", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
