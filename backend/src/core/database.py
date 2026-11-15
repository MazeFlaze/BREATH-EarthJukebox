from pathlib import Path
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from .config import settings
from ..utils.logger import logger

Base = declarative_base()

def normalize_database_url(url: str) -> str:
    """Normalize database URL for SQLAlchemy, ensuring proper driver prefix for PostgreSQL/Neon."""
    if not url:
        return url
    # Strip channel_binding=require as it can hang with libpq/psycopg under certain TLS proxies
    if "channel_binding=" in url:
        import re
        url = re.sub(r"[?&]channel_binding=[^&]*", "", url)
        if "?" not in url and "&" in url:
            url = url.replace("&", "?", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://") and not url.startswith("postgresql+"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


# Resolve SQLite path relative to backend directory if relative URL is given
db_url = normalize_database_url(settings.DATABASE_URL)
if db_url.startswith("sqlite:///"):
    sqlite_path_str = db_url.replace("sqlite:///", "")
    if sqlite_path_str.startswith("backend/"):
        sqlite_path_str = sqlite_path_str[len("backend/"):]
    sqlite_path = Path(sqlite_path_str)
    if not sqlite_path.is_absolute():
        project_root = Path(__file__).resolve().parent.parent.parent
        resolved_path = (project_root / sqlite_path_str).resolve()
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        db_url = f"sqlite:///{resolved_path}"

connect_args = {}
if "sqlite" in db_url:
    connect_args["check_same_thread"] = False

engine = create_engine(
    db_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


_db_initialized = False


def init_db(bootstrap_raw: bool = True) -> None:
    """Initializes tables and seeds preset locations if they do not exist."""
    global _db_initialized
    from ..models.entities import Location, PRESET_LOCATIONS
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as session:
        existing_count = session.query(Location).count()
        if existing_count == 0:
            logger.info("Seeding 10 default preset locations into database...")
            for loc_data in PRESET_LOCATIONS:
                loc = Location(**loc_data)
                session.add(loc)
            session.commit()
            logger.info("Successfully seeded preset locations.")

        # Auto-bootstrap existing local NetCDF granules in DATA_STORAGE_ROOT
        from ..models.entities import DatasetAsset
        asset_count = session.query(DatasetAsset).count()
        if bootstrap_raw and asset_count == 0:
            raw_dir = settings.DATA_STORAGE_ROOT
            if raw_dir.exists():
                from ..services.ingestion_service import ingestion_service
                for nc_file in sorted(raw_dir.glob("GEOS.cf.ana.*.nc4")):
                    try:
                        logger.info(f"Auto-bootstrapping existing NetCDF file: {nc_file.name}")
                        ingestion_service.ingest_local_file(nc_file, db=session)
                    except Exception as e:
                        logger.warning(f"Could not auto-bootstrap {nc_file.name}: {e}")
        session.commit()
    _db_initialized = True


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding database session per request."""
    if not _db_initialized:
        init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
