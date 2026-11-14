import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
from sqlalchemy.orm import Session
from fastapi import HTTPException

from ..api.schemas.jukebox_schema import (
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


class TemporalQueryService:
    """
    Executes Feature B: Temporal Jukebox queries.
    Returns an ordered time series of scientific observations for a single location across a time range.
    """

    MAX_HOURS_PER_QUERY = 168  # Limit temporal queries to max 7 days (168 hours)

    def __init__(self, provider: Optional[GEOSCFProvider] = None):
        self.provider = provider or GEOSCFProvider(raw_storage_dir=settings.DATA_STORAGE_ROOT)

    def execute_temporal_query(
        self,
        dataset_id: str,
        lat: float,
        lon: float,
        variable: str,
        start_time_str: str,
        end_time_str: str,
        interval: str,
        db: Session,
    ) -> JukeboxResponse:
        # Validate dataset
        if dataset_id != self.provider.DATASET_ID:
            raise HTTPException(
                status_code=404,
                detail=f"Dataset '{dataset_id}' not supported. Available: ['{self.provider.DATASET_ID}']",
            )

        # Validate variable
        variables_catalog = self.provider.list_variables()
        if variable not in variables_catalog:
            raise HTTPException(
                status_code=400,
                detail=f"Variable '{variable}' not found. Supported variables: {list(variables_catalog.keys())}",
            )

        # Validate coordinates
        try:
            val_lat, val_lon = NetCDFProcessor.validate_coordinates(lat, lon)
        except ValueError as ve:
            raise HTTPException(status_code=422, detail=str(ve))

        # Parse time range
        try:
            start_dt = pd.to_datetime(start_time_str, utc=True).to_pydatetime()
            end_dt = pd.to_datetime(end_time_str, utc=True).to_pydatetime()
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid start or end timestamp. Must be ISO 8601 UTC.")

        if start_dt > end_dt:
            raise HTTPException(status_code=400, detail="start timestamp must be earlier than or equal to end timestamp.")

        diff_hours = (end_dt - start_dt).total_seconds() / 3600.0
        if diff_hours > self.MAX_HOURS_PER_QUERY:
            raise HTTPException(
                status_code=400,
                detail=f"Requested range ({diff_hours:.1f}h) exceeds maximum limit of {self.MAX_HOURS_PER_QUERY} hours.",
            )

        cache_key = app_cache.create_key(
            "jukebox_temporal",
            {
                "datasetId": dataset_id,
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "variable": variable,
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
                "interval": interval,
            },
        )
        cached_result = app_cache.get(cache_key)
        if cached_result:
            logger.info(f"Cache hit for temporal query [{variable} from {start_dt.isoformat()}]")
            return JukeboxResponse(**cached_result)

        norm_cfg = ObservationNormalizer.get_config(variable)
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

        var_info = variables_catalog[variable]
        meta = self.provider.get_source_metadata()
        provenance = ProvenanceMeta(
            provider=meta["provider"],
            sourceUrl=meta["sourceUrl"],
            productVersion=meta["productVersion"],
            spatialResolution=meta.get("spatialResolution"),
            temporalResolution=meta.get("temporalResolution"),
        )

        # Expected hourly sequence
        expected_hours = pd.date_range(start=start_dt, end=end_dt, freq="1h")

        # Step 1: Read-Through Database Lookup
        # Calculate grid cell coordinates
        grid_lat = round(round(val_lat * 4) / 4, 2)
        grid_lon = round(round(val_lon * 4) / 4, 2)

        existing_db_samples = ObservationRepository.get_samples_for_grid_and_time_range(
            db=db,
            dataset_source_id=dataset_id,
            variable=variable,
            grid_lat=grid_lat,
            grid_lon=grid_lon,
            start_time=start_dt,
            end_time=end_dt,
        )
        db_samples_by_time = {}
        for s in existing_db_samples:
            if s.value is not None:
                t_val = s.timestamp_utc
                if t_val.tzinfo is None:
                    t_val = t_val.replace(tzinfo=timezone.utc)
                iso_k = t_val.strftime("%Y-%m-%dT%H:%M:%SZ")
                db_samples_by_time[iso_k] = s

        # Gather available hourly files covering any missing hours
        files_by_dt = {}
        for h_dt in expected_hours:
            py_dt = h_dt.to_pydatetime()
            iso_check = py_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            if iso_check not in db_samples_by_time:
                expected_fn = self.provider.format_granule_filename(py_dt)
                local_file = settings.DATA_STORAGE_ROOT / expected_fn
                if local_file.exists():
                    files_by_dt[py_dt] = local_file

        # Ensure DatasetSource is registered if we need to write samples
        source = DatasetRepository.get_source(db, dataset_id)
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

        points: List[JukeboxPoint] = []
        order_idx = 0

        # Build ordered time series point by point
        for h_dt in expected_hours:
            py_dt = h_dt.to_pydatetime()
            iso_time = py_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            # Check if sample exists in database read-through cache
            if iso_time in db_samples_by_time:
                db_sample = db_samples_by_time[iso_time]
                val = db_sample.value
                norm_val = ObservationNormalizer.normalize(variable, val)
                points.append(
                    JukeboxPoint(
                        order=order_idx,
                        locationId=None,
                        timestamp=iso_time,
                        requestedCoordinates=CoordinatePair(lat=lat, lon=lon),
                        gridCoordinates=CoordinatePair(lat=db_sample.grid_latitude, lon=db_sample.grid_longitude),
                        value=val,
                        normalizedValue=norm_val,
                        quality=db_sample.quality_status,
                    )
                )
            else:
                file_path = files_by_dt.get(py_dt)
                if file_path:
                    # Register asset if needed
                    asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{dataset_id}:{file_path.name}"))
                    asset = DatasetRepository.get_asset(db, asset_id)
                    if not asset:
                        asset = DatasetRepository.register_asset(
                            db=db,
                            asset_id=asset_id,
                            dataset_source_id=dataset_id,
                            original_filename=file_path.name,
                            storage_path=str(file_path),
                            checksum_sha256="",
                            time_start=py_dt,
                            time_end=py_dt,
                        )

                    with NetCDFProcessor.open_dataset(file_path) as ds:
                        pt_dict = NetCDFProcessor.extract_point_value(ds, variable, lat, lon, timestamp=py_dt)
                        val = pt_dict["value"]
                        norm_val = ObservationNormalizer.normalize(variable, val)

                        # Read-Through Persistence: Save extracted point into observation_samples
                        try:
                            ObservationRepository.upsert_sample(
                                db=db,
                                dataset_source_id=dataset_id,
                                dataset_asset_id=asset.id,
                                grid_lat=pt_dict["grid_coordinates"]["lat"],
                                grid_lon=pt_dict["grid_coordinates"]["lon"],
                                timestamp_utc=py_dt,
                                variable=variable,
                                value=val,
                                unit=pt_dict["unit"],
                                quality_status=pt_dict["quality"],
                            )
                        except Exception as e:
                            logger.warning(f"Could not persist temporal sample to DB: {e}")

                        points.append(
                            JukeboxPoint(
                                order=order_idx,
                                locationId=None,
                                timestamp=iso_time,
                                requestedCoordinates=CoordinatePair(**pt_dict["requested_coordinates"]),
                                gridCoordinates=CoordinatePair(**pt_dict["grid_coordinates"]),
                                value=val,
                                normalizedValue=norm_val,
                                quality=pt_dict["quality"],
                            )
                        )
                else:
                    # Attempt remote OPeNDAP slice before marking missing
                    opendap_pt = self.provider.extract_point_opendap(py_dt, lat, lon, variable)
                    if opendap_pt and opendap_pt.get("value") is not None:
                        val = opendap_pt["value"]
                        norm_val = ObservationNormalizer.normalize(variable, val)

                        # Register remote OPeNDAP asset record
                        opendap_fn = self.provider.format_granule_filename(py_dt)
                        asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{dataset_id}:{opendap_fn}"))
                        asset = DatasetRepository.get_asset(db, asset_id)
                        if not asset:
                            asset = DatasetRepository.register_asset(
                                db=db,
                                asset_id=asset_id,
                                dataset_source_id=dataset_id,
                                original_filename=opendap_fn,
                                storage_path=f"opendap:{self.provider.build_opendap_url(py_dt)}",
                                checksum_sha256="",
                                time_start=py_dt,
                                time_end=py_dt,
                            )

                        try:
                            ObservationRepository.upsert_sample(
                                db=db,
                                dataset_source_id=dataset_id,
                                dataset_asset_id=asset.id,
                                grid_lat=opendap_pt["grid_coordinates"]["lat"],
                                grid_lon=opendap_pt["grid_coordinates"]["lon"],
                                timestamp_utc=py_dt,
                                variable=variable,
                                value=val,
                                unit=opendap_pt["unit"],
                                quality_status=opendap_pt["quality"],
                            )
                        except Exception as e:
                            logger.warning(f"Could not persist OPeNDAP temporal sample to DB: {e}")

                        points.append(
                            JukeboxPoint(
                                order=order_idx,
                                locationId=None,
                                timestamp=iso_time,
                                requestedCoordinates=CoordinatePair(**opendap_pt["requested_coordinates"]),
                                gridCoordinates=CoordinatePair(**opendap_pt["grid_coordinates"]),
                                value=val,
                                normalizedValue=norm_val,
                                quality=opendap_pt["quality"],
                            )
                        )
                    else:
                        # Explicit missing interval state
                        points.append(
                            JukeboxPoint(
                                order=order_idx,
                                locationId=None,
                                timestamp=iso_time,
                                requestedCoordinates=CoordinatePair(lat=lat, lon=lon),
                                gridCoordinates=CoordinatePair(lat=grid_lat, lon=grid_lon),
                                value=None,
                                normalizedValue=None,
                                quality="missing",
                            )
                        )
            order_idx += 1

        var_info = variables_catalog[variable]
        meta = self.provider.get_source_metadata()
        provenance = ProvenanceMeta(
            provider=meta["provider"],
            sourceUrl=meta["sourceUrl"],
            productVersion=meta["productVersion"],
            spatialResolution=meta.get("spatialResolution"),
            temporalResolution=meta.get("temporalResolution"),
        )

        response = JukeboxResponse(
            mode="temporal",
            datasetId=dataset_id,
            variable=variable,
            unit=var_info["unit"],
            dataType=meta["dataType"],
            isMock=False,
            normalization=norm_meta,
            points=points,
            provenance=provenance,
        )

        app_cache.set(cache_key, response.model_dump(), dataset_id=dataset_id)
        return response


temporal_query_service = TemporalQueryService()
