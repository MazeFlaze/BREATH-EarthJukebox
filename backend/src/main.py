import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes.health import router as health_router
from .api.routes.observations import router as observations_router
from .api.routes.jukebox import router as jukebox_router
from .api.routes.datasets import router as datasets_router
from .api.routes.locations import router as locations_router
from .core.config import settings
from .core.database import init_db
from .utils.logger import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle management."""
    logger.info("Initializing BREATHE database and models...")
    try:
        init_db()
    except Exception as e:
        logger.warning(f"Database initialization notice: {e}")
    yield


app = FastAPI(
    title="BREATHE - Earth Information Jukebox API",
    description="Scientific API providing NASA atmospheric observation datasets and Spatial/Temporal Jukebox playback for interactive sonification.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS Configuration - Allows communication from Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers under /api/v1
app.include_router(health_router, prefix="/api/v1")
app.include_router(observations_router, prefix="/api/v1")
app.include_router(jukebox_router, prefix="/api/v1")
app.include_router(datasets_router, prefix="/api/v1")
app.include_router(locations_router, prefix="/api/v1")


@app.get("/", tags=["Root"])
def root():
    """Root entrypoint with API discovery links."""
    return {
        "project": "BREATHE",
        "challenge": "NASA Space Apps Challenge 2026 – The Earth Information Jukebox",
        "description": "Scientific API serving atmospheric Earth observations for interactive sonification.",
        "documentation": "/docs",
        "health": "/api/v1/health",
        "jukebox_spatial": "/api/v1/jukebox/spatial",
        "jukebox_temporal": "/api/v1/jukebox/temporal",
        "datasets": "/api/v1/datasets",
        "locations": "/api/v1/locations",
        "air_quality": "/api/v1/observations/air-quality",
        "aod": "/api/v1/observations/aod",
    }


if __name__ == "__main__":
    import uvicorn

    # Support running either from repository root or from inside backend/
    project_root = Path(__file__).resolve().parent.parent.parent
    project_root_str = str(project_root)
    backend_dir_str = str(project_root / "backend")

    if project_root_str not in sys.path:
        sys.path.insert(0, project_root_str)
    if backend_dir_str not in sys.path:
        sys.path.insert(0, backend_dir_str)

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info(f"Starting BREATHE API on http://{host}:{port}")

    # Pass initialized FastAPI app instance to allow execution across different CWDs
    uvicorn.run(app, host=host, port=port)
