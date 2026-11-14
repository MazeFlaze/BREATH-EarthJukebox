import uuid
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
        meta = self.provider.get_source_metadata()
        provenance = ProvenanceMeta(
            provider=meta["provider"],
            sourceUrl=meta["sourceUrl"],
            productVersion=meta["productVersion"],
            spatialResolution=meta.get("spatialResolution"),
            temporalResolution=meta.get("temporalResolution"),
        )

        # Step 1: Read-Through Database Lookup
        # Check if all requested locations already exist in observation_samples
        db_points_map = {}
        all_in_db = True
        for idx, loc in enumerate(request.locations):
            grid_lat = round(round(loc.lat * 4) / 4, 2)
            grid_lon = round(round(loc.lon * 4) / 4, 2)
            sample = ObservationRepository.get_sample(
                db=db,
                dataset_source_id=request.datasetId,
                variable=request.variable,
                timestamp_utc=req_dt.to_pydatetime(),
                grid_lat=grid_lat,
                grid_lon=grid_lon,
            )
            if sample is not None and sample.value is not None:
                db_points_map[idx] = sample
            else:
                all_in_db = False

        if all_in_db and len(db_points_map) == len(request.locations):
            logger.info(f"Database Read-Through Hit: all {len(request.locations)} points retrieved from observation_samples.")
            points: List[JukeboxPoint] = []
            for idx, loc in enumerate(request.locations):
                sample = db_points_map[idx]
                val = sample.value
                norm_val = ObservationNormalizer.normalize(request.variable, val)
                points.append(
                    JukeboxPoint(
                        order=idx,
                        locationId=loc.id,
                        timestamp=iso_time,
                        requestedCoordinates=CoordinatePair(lat=loc.lat, lon=loc.lon),
                        gridCoordinates=CoordinatePair(lat=sample.grid_latitude, lon=sample.grid_longitude),
                        value=val,
                        normalizedValue=norm_val,
                        quality=sample.quality_status,
                    )
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
            app_cache.set(cache_key, response.model_dump(), dataset_id=request.datasetId)
            return response

        # Step 2: Database Miss - Resolve asset file and extract from NetCDF
        asset = DatasetRepository.get_asset_by_time(db, request.datasetId, req_dt.to_pydatetime())
        file_path = None
        raw_points = None

        if asset and Path(asset.storage_path).exists():
            file_path = Path(asset.storage_path)
        else:
            # Check local raw directory
            expected_filename = self.provider.format_granule_filename(req_dt.to_pydatetime())
            candidate_path = settings.DATA_STORAGE_ROOT / expected_filename
            if candidate_path.exists():
                file_path = candidate_path
            else:
                # Attempt OPeNDAP remote subsetting first without downloading 6.5MB file
                opendap_succeeded = True
                opendap_points = []
                for idx, loc in enumerate(request.locations):
                    pt = self.provider.extract_point_opendap(req_dt.to_pydatetime(), loc.lat, loc.lon, request.variable)
                    if pt:
                        pt["order"] = idx
                        pt["locationId"] = loc.id
                        opendap_points.append(pt)
                    else:
                        opendap_succeeded = False
                        break

                if opendap_succeeded and len(opendap_points) == len(request.locations):
                    raw_points = opendap_points
                    file_path = None
                else:
                    # Fallback to upstream full granule download
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

        # Ensure DatasetSource is registered
        source = DatasetRepository.get_source(db, request.datasetId)
        if not source:
            source = DatasetRepository.upsert_source(
                db=db,
                source_id=meta["datasetId"],
                provider=meta["provider"],
                product=meta["product"],
                product_version=meta["productVersion"],
                data_type=meta["dataType"],
                temporal_resolution=meta["temporalResolution"],
                spatial_resolution=meta["spatialResolution"],
                source_url=meta["sourceUrl"],
            )

        # Ensure DatasetAsset is registered
        if not asset:
            filename = file_path.name if file_path else self.provider.format_granule_filename(req_dt.to_pydatetime())
            asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{request.datasetId}:{filename}"))
            asset = DatasetRepository.get_asset(db, asset_id)
            if not asset:
                asset = DatasetRepository.register_asset(
                    db=db,
                    asset_id=asset_id,
                    dataset_source_id=request.datasetId,
                    original_filename=filename,
                    storage_path=str(file_path) if file_path else f"opendap:{self.provider.build_opendap_url(req_dt.to_pydatetime())}",
                    checksum_sha256="",
                    time_start=req_dt.to_pydatetime(),
                    time_end=req_dt.to_pydatetime(),
                )

        # Extract spatial points using NetCDFProcessor if not already extracted via OPeNDAP
        if raw_points is None:
            loc_dicts = [{"id": l.id, "lat": l.lat, "lon": l.lon} for l in request.locations]
            raw_points = NetCDFProcessor.extract_spatial_slice(
                file_path=file_path,
                variable=request.variable,
                locations=loc_dicts,
                timestamp=iso_time,
            )

        points: List[JukeboxPoint] = []
        for p in raw_points:
            val = p["value"]
            norm_val = ObservationNormalizer.normalize(request.variable, val)
            grid_lat = p["grid_coordinates"]["lat"]
            grid_lon = p["grid_coordinates"]["lon"]

            # Read-Through Persistence: Save extracted point into observation_samples
            try:
                ObservationRepository.upsert_sample(
                    db=db,
                    dataset_source_id=request.datasetId,
                    dataset_asset_id=asset.id,
                    grid_lat=grid_lat,
                    grid_lon=grid_lon,
                    timestamp_utc=req_dt.to_pydatetime(),
                    variable=request.variable,
                    value=val,
                    unit=var_info["unit"],
                    quality_status=p["quality"],
                )
            except Exception as e:
                logger.warning(f"Could not persist sample to DB: {e}")

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
