from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...api.schemas.dataset_metadata_schema import (
    DatasetSummary,
    VariableMeta,
    DatasetAvailability,
)
from ...providers.geos_cf import GEOSCFProvider
from ...repositories.dataset_repository import DatasetRepository
from ...services.data_service import backend_data_service

router = APIRouter(prefix="/datasets", tags=["Dataset Metadata"])
geos_cf_provider = GEOSCFProvider()


@router.get("", response_model=List[DatasetSummary], summary="List Available Datasets")
def list_datasets(db: Session = Depends(get_db)):
    """Returns all available atmospheric products in the system."""
    geos_meta = geos_cf_provider.get_source_metadata()
    datasets = [
        DatasetSummary(
            id=geos_meta["datasetId"],
            title="NASA GMAO GEOS-CF Composition Analysis v2",
            provider=geos_meta["provider"],
            product=geos_meta["product"],
            version=geos_meta["productVersion"],
            dataType=geos_meta["dataType"],
            temporalResolution=geos_meta["temporalResolution"],
            spatialResolution=geos_meta["spatialResolution"],
            isMock=False,
        ),
        DatasetSummary(
            id="nasa-svs5533-geos-cf-2024",
            title="NASA SVS 5533: GEOS-CF Air Quality & Wildfire Transport (July - August 2024)",
            provider="NASA GMAO & SVS",
            product="SVS-5533-Events",
            version="1.0.0-prototype",
            dataType="prototype_demonstration",
            temporalResolution="event-based",
            spatialResolution="regional-transboundary",
            isMock=True,
        ),
        DatasetSummary(
            id="mock-nasa-aod-series-2026",
            title="Aerosol Optical Depth (AOD 550nm) Prototype Series",
            provider="NASA Earthdata MODIS (Modeled)",
            product="MODIS-AOD-550nm",
            version="0.1.0-mock",
            dataType="prototype_demonstration",
            temporalResolution="daily",
            spatialResolution="global-prototype",
            isMock=True,
        ),
    ]
    return datasets


@router.get("/{dataset_id}/variables", response_model=List[VariableMeta], summary="List Dataset Variables")
def get_dataset_variables(
    dataset_id: str = Path(..., description="Unique dataset identifier"),
):
    """Lists available variables, physical units, and descriptions for a dataset."""
    if dataset_id == geos_cf_provider.DATASET_ID:
        vars_dict = geos_cf_provider.list_variables()
        return [
            VariableMeta(
                variable=code,
                name=info["name"],
                unit=info["unit"],
                displayUnit=info["display_unit"],
                description=info["description"],
                type=info["type"],
            )
            for code, info in vars_dict.items()
        ]
    elif dataset_id == "nasa-svs5533-geos-cf-2024":
        return [
            VariableMeta(
                variable="PM25",
                name="Particulate Matter (PM2.5)",
                unit="ug m-3",
                displayUnit="µg/m³",
                description="Surface Particulate Matter <= 2.5 µm (Synthetic Prototype)",
                type="mass_concentration",
            )
        ]
    elif dataset_id == "mock-nasa-aod-series-2026":
        return [
            VariableMeta(
                variable="AOD",
                name="Aerosol Optical Depth (550nm)",
                unit="dimensionless",
                displayUnit="dimensionless",
                description="Total atmospheric column light extinction (dimensionless)",
                type="optical_depth",
            )
        ]
    else:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")


@router.get("/{dataset_id}/availability", response_model=DatasetAvailability, summary="Get Dataset Availability")
def get_dataset_availability(
    dataset_id: str = Path(..., description="Unique dataset identifier"),
    db: Session = Depends(get_db),
):
    """Returns available temporal range and timestamps for a dataset."""
    if dataset_id != geos_cf_provider.DATASET_ID:
        # Check in memory datasets
        if dataset_id == "nasa-svs5533-geos-cf-2024":
            ds = backend_data_service.get_dataset("air_quality")
            times = [o.timestamp for o in ds.observations] if ds else []
            return DatasetAvailability(
                datasetId=dataset_id,
                availableTimes=times,
                timeRange={"start": times[0] if times else None, "end": times[-1] if times else None},
                totalGranules=len(times),
            )
        elif dataset_id == "mock-nasa-aod-series-2026":
            ds = backend_data_service.get_dataset("aod")
            times = [o.timestamp for o in ds.observations] if ds else []
            return DatasetAvailability(
                datasetId=dataset_id,
                availableTimes=times,
                timeRange={"start": times[0] if times else None, "end": times[-1] if times else None},
                totalGranules=len(times),
            )
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    available_times = geos_cf_provider.list_available_times()
    start_time = available_times[0] if available_times else None
    end_time = available_times[-1] if available_times else None

    return DatasetAvailability(
        datasetId=dataset_id,
        availableTimes=available_times,
        timeRange={"start": start_time, "end": end_time},
        totalGranules=len(available_times),
    )
