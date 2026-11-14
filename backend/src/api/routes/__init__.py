from .health import router as health_router
from .observations import router as observations_router
from .jukebox import router as jukebox_router
from .datasets import router as datasets_router
from .locations import router as locations_router

__all__ = [
    "health_router",
    "observations_router",
    "jukebox_router",
    "datasets_router",
    "locations_router",
]
