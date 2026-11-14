from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...api.schemas.jukebox_schema import (
    SpatialJukeboxRequest,
    JukeboxResponse,
)
from ...services.spatial_query_service import spatial_query_service
from ...services.temporal_query_service import temporal_query_service

router = APIRouter(prefix="/jukebox", tags=["Jukebox Modes"])


@router.post(
    "/spatial",
    response_model=JukeboxResponse,
    summary="Execute Spatial Jukebox Mode",
    description="Plays atmospheric conditions across an ordered sequence of geographic locations at a single timestamp.",
)
def post_spatial_jukebox(
    request: SpatialJukeboxRequest,
    db: Session = Depends(get_db),
):
    return spatial_query_service.execute_spatial_query(request, db=db)


@router.get(
    "/temporal",
    response_model=JukeboxResponse,
    summary="Execute Temporal Jukebox Mode",
    description="Returns an ordered time series of atmospheric observations for a single location across a time range.",
)
def get_temporal_jukebox(
    dataset_id: str = Query("geos-cf-v2-aqc", description="Dataset identifier"),
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees"),
    lon: float = Query(..., description="Longitude in decimal degrees"),
    variable: str = Query("PM25_RH35", description="Atmospheric variable to query"),
    start: str = Query(..., description="Start timestamp (ISO 8601 UTC)"),
    end: str = Query(..., description="End timestamp (ISO 8601 UTC)"),
    interval: str = Query("1h", description="Sampling interval (default '1h')"),
    db: Session = Depends(get_db),
):
    return temporal_query_service.execute_temporal_query(
        dataset_id=dataset_id,
        lat=lat,
        lon=lon,
        variable=variable,
        start_time_str=start,
        end_time_str=end,
        interval=interval,
        db=db,
    )
