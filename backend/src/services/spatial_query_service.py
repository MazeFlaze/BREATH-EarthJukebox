from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
from sqlalchemy.orm import Session
from fastapi import HTTPException

from ..api.schemas.jukebox_schema import (
    SpatialJukeboxRequest,
    JukeboxResponse,
    JukeboxPoint,
    CoordinatePair,
    NormalizationMeta,
    ProvenanceMeta,
)
from ..core.cache import app_cache
from ..core.config import settings
from ..processors.netcdf_processor import NetCDFProcessor
from ..processors.observation_normalizer import ObservationNormalizer
from ..providers.geos_cf import GEOSCFProvider
from ..repositories.dataset_repository import DatasetRepository
from ..repositories.observation_repository import ObservationRepository
from ..utils.logger import logger


class SpatialQueryService:
    """
    Executes Feature A: Spatial Jukebox queries.
    Retrieves observations across an ordered sequence of locations for a single timestamp.
    """

    def __init__(self, provider: Optional[GEOSCFProvider] = None):
        self.provider = provider or GEOSCFProvider(raw_storage_dir=settings.DATA_STORAGE_ROOT)

    def execute_spatial_query(self, request: SpatialJukeboxRequest, db: Session) -> JukeboxResponse:
        # Validate dataset
        if request.datasetId != self.provider.DATASET_ID:
            raise HTTPException(
                status_code=404,
                detail=f"Dataset '{request.datasetId}' not supported. Available: ['{self.provider.DATASET_ID}']",
            )

        # Validate variable
        variables_catalog = self.provider.list_variables()
        if request.variable not in variables_catalog:
            raise HTTPException(
                status_code=400,
                detail=f"Variable '{request.variable}' not found. Supported variables: {list(variables_catalog.keys())}",
            )

        # Parse and validate timestamp
        try:
            req_dt = pd.to_datetime(request.timestamp, utc=True)
            iso_time = req_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            raise HTTPException(status_code=422, detail=f"Invalid ISO 8601 timestamp: '{request.timestamp}'")

        # Check in-memory cache
        cache_key = app_cache.create_key(
            "jukebox_spatial",
            {
                "datasetId": request.datasetId,
                "timestamp": iso_time,
                "variable": request.variable,
                "locations": [{"id": l.id, "lat": l.lat, "lon": l.lon} for l in request.locations],
            },
        )
        cached_result = app_cache.get(cache_key)
        if cached_result:
            logger.info(f"Cache hit for spatial query [{request.variable} at {iso_time}]")
            return JukeboxResponse(**cached_result)

        # Resolve asset file: check DB first, then local filesystem, then remote fetch
        asset = DatasetRepository.get_asset_by_time(db, request.datasetId, req_dt.to_pydatetime())
        file_path = None
        if asset and Path(asset.storage_path).exists():
            file_path = Path(asset.storage_path)
        else:
            # Check local raw directory
            expected_filename = self.provider.format_granule_filename(req_dt.to_pydatetime())
            candidate_path = settings.DATA_STORAGE_ROOT / expected_filename
            if candidate_path.exists():
                file_path = candidate_path
            else:
                # Attempt upstream fetch
                try:
                    file_path = self.provider.fetch_granule(iso_time)
                except FileNotFoundError:
                    raise HTTPException(
                        status_code=404,
                        detail=f"NASA observation for timestamp '{iso_time}' not available upstream or locally.",
                    )
                except Exception as e:
                    logger.error(f"Upstream fetch error: {e}")
                    raise HTTPException(
                        status_code=503,
                        detail=f"Upstream NASA data service temporarily unavailable: {e}",
                    )

        # Extract spatial points using NetCDFProcessor
        loc_dicts = [{"id": l.id, "lat": l.lat, "lon": l.lon} for l in request.locations]
        raw_points = NetCDFProcessor.extract_spatial_slice(
            file_path=file_path,
            variable=request.variable,
            locations=loc_dicts,
            timestamp=iso_time,
        )

        var_info = variables_catalog[request.variable]
        norm_cfg = ObservationNormalizer.get_config(request.variable)
        norm_meta = (
            NormalizationMeta(
                method=norm_cfg.method,
                min=norm_cfg.min,
                max=norm_cfg.max,
                configVersion=norm_cfg.configVersion,
            )
            if norm_cfg
            else None
        )

        points: List[JukeboxPoint] = []
        for p in raw_points:
            val = p["value"]
            norm_val = ObservationNormalizer.normalize(request.variable, val)
            pt = JukeboxPoint(
                order=p["order"],
                locationId=p.get("locationId"),
                timestamp=p["timestamp"] or iso_time,
                requestedCoordinates=CoordinatePair(**p["requested_coordinates"]),
                gridCoordinates=CoordinatePair(**p["grid_coordinates"]),
                value=val,
                normalizedValue=norm_val,
                quality=p["quality"],
            )
            points.append(pt)

        meta = self.provider.get_source_metadata()
        provenance = ProvenanceMeta(
            provider=meta["provider"],
            sourceUrl=meta["sourceUrl"],
            productVersion=meta["productVersion"],
            spatialResolution=meta.get("spatialResolution"),
            temporalResolution=meta.get("temporalResolution"),
        )

        response = JukeboxResponse(
            mode="spatial",
            datasetId=request.datasetId,
            variable=request.variable,
            unit=var_info["unit"],
            dataType=meta["dataType"],
            isMock=False,
            normalization=norm_meta,
            points=points,
            provenance=provenance,
        )

        # Cache response
        app_cache.set(cache_key, response.model_dump(), dataset_id=request.datasetId)
        return response


spatial_query_service = SpatialQueryService()
