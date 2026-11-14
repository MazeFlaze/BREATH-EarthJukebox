from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...api.schemas.jukebox_schema import (
    NormalizationMethodType,
    SpatialJukeboxRequest,
    JukeboxResponse,
    RegionJukeboxRequest,
    RegionJukeboxResponse,
)
from ...services.region_query_service import region_query_service
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
    normalization_method: NormalizationMethodType = Query(
        "fixed_reference_range",
        description="Normalization strategy ('fixed_reference_range' default or 'log_scale'/'calibrated')",
    ),
    offline_only: bool = Query(False, description="Skip remote OPeNDAP fallback when running offline"),
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
        normalization_method=normalization_method,
        offline_only=offline_only,
    )


@router.post(
    "/region",
    response_model=RegionJukeboxResponse,
    summary="Execute Single-ROI Region Jukebox Mode",
    description="Aggregates spatial grid statistics (mean, p90, max, tier ratios) for one drag-box ROI with calibrated perceptual normalization and ppbv conversion.",
)
def post_region_jukebox(
    request: RegionJukeboxRequest,
    db: Session = Depends(get_db),
):
    return region_query_service.execute_region_query(request, db=db)
