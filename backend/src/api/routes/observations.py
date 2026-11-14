from typing import List
from fastapi import APIRouter, HTTPException, Path
from ..schemas.observation_schema import DatasetSchema, ObservationSchema, DatasetRangeSchema
from ...services.data_service import backend_data_service

router = APIRouter(prefix="/observations", tags=["Observations"])


# ------------------------------------------------------------------------------
# 1. NASA SVS 5533 & GEOS-CF Air Quality Endpoints (July - August 2024 PM2.5/CO/O3)
# ------------------------------------------------------------------------------
@router.get("/air-quality", response_model=DatasetSchema, summary="Get SVS 5533 Air Quality Dataset")
@router.get("/svs5533", response_model=DatasetSchema, include_in_schema=False)
def get_air_quality_dataset():
    """
    Returns the complete NASA SVS 5533 & GEOS-CF Air Quality dataset (PM2.5).
    Chronological observations tracking the July - August 2024 wildfire transport across North America.
    """
    dataset = backend_data_service.get_dataset("air_quality")
    if not dataset:
        raise HTTPException(status_code=503, detail="SVS 5533 Air Quality dataset is not yet loaded.")
    return dataset


@router.get("/air-quality/range", response_model=DatasetRangeSchema, summary="Get SVS 5533 Measurement Bounds")
def get_air_quality_range():
    """
    Returns numeric min and max bounds of PM2.5 for sonification audio normalization and chart scales.
    """
    return backend_data_service.get_range("air_quality")


@router.get("/air-quality/{observation_id}", response_model=ObservationSchema, summary="Get Single Air Quality Observation")
def get_air_quality_observation_by_id(
    observation_id: str = Path(..., description="Unique observation ID (e.g. 'geos-cf-2024-07-24-003')")
):
    """
    Retrieves a single SVS 5533 air quality observation record by ID.
    """
    obs = backend_data_service.get_observation_by_id(observation_id, "air_quality")
    if not obs:
        raise HTTPException(
            status_code=404,
            detail=f"Air quality observation '{observation_id}' not found."
        )
    return obs


# ------------------------------------------------------------------------------
# 2. Aerosol Optical Depth (AOD) Endpoints (Backward Compatible Baseline)
# ------------------------------------------------------------------------------
@router.get("/aod", response_model=DatasetSchema, summary="Get Aerosol Optical Depth Dataset")
def get_aod_dataset():
    """
    Returns the complete Aerosol Optical Depth (AOD 550nm) dataset.
    """
    dataset = backend_data_service.get_dataset("aod")
    if not dataset:
        raise HTTPException(status_code=503, detail="AOD dataset is not yet loaded.")
    return dataset


@router.get("/aod/range", response_model=DatasetRangeSchema, summary="Get AOD Measurement Bounds")
def get_aod_range():
    """
    Returns numeric min and max bounds for AOD sonification normalization.
    """
    return backend_data_service.get_range("aod")


@router.get("/aod/{observation_id}", response_model=ObservationSchema, summary="Get Single AOD Observation")
def get_aod_observation_by_id(
    observation_id: str = Path(..., description="Unique observation ID (e.g. 'mock-obs-aod-01')")
):
    """
    Retrieves a single AOD observation record by ID.
    """
    obs = backend_data_service.get_observation_by_id(observation_id, "aod")
    if not obs:
        raise HTTPException(
            status_code=404,
            detail=f"AOD observation '{observation_id}' not found."
        )
    return obs
