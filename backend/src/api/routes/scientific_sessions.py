"""Additive scientific contract. Existing /jukebox/region consumers remain compatible."""
from fastapi import APIRouter, Response

from ..schemas.geos_cf_catalog_schema import GeosCfCatalog
from ..schemas.scientific_session_schema import FrameRequest, FrameView, SessionPlan, SessionRequest
from ...services.scientific_session_service import scientific_sessions

router = APIRouter(prefix="/scientific", tags=["Scientific Sessions"])


@router.get("/catalog", response_model=GeosCfCatalog)
def catalog(response: Response) -> GeosCfCatalog:
    response.headers["Cache-Control"] = "no-store"
    return scientific_sessions.catalog.read()


@router.post("/sessions", response_model=SessionPlan)
def prepare(request: SessionRequest, response: Response) -> SessionPlan:
    response.headers["Cache-Control"] = "no-store"
    return scientific_sessions.create(request)


@router.post("/frames", response_model=FrameView)
def source_frame(request: FrameRequest, response: Response) -> FrameView:
    response.headers["Cache-Control"] = "no-store"
    return scientific_sessions.frame(request)


@router.get("/sessions/{plan_id}/views/{slot_index}", response_model=FrameView)
def frame(plan_id: str, slot_index: int, response: Response) -> FrameView:
    response.headers["Cache-Control"] = "no-store"
    return scientific_sessions.view(plan_id, slot_index)
