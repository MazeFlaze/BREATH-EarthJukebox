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
from .jukebox_helpers import (
    SUPPORTED_TEMPORAL_INTERVALS,
    build_normalization_meta,
    build_provenance_meta,
    normalize_and_convert,
    validate_dataset_and_variable,
)


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
        normalization_method: str = "fixed_reference_range",
        offline_only: Optional[bool] = None,
    ) -> JukeboxResponse:
        var_info = validate_dataset_and_variable(self.provider, dataset_id, variable)

        interval_freq = SUPPORTED_TEMPORAL_INTERVALS.get(interval)
        if not interval_freq:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported interval '{interval}'. Supported: {sorted(SUPPORTED_TEMPORAL_INTERVALS.keys())}",
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
                "normalizationMethod": normalization_method,
            },
        )
        cached_result = app_cache.get(cache_key)
        if cached_result:
            logger.info(f"Cache hit for temporal query [{variable} from {start_dt.isoformat()}]")
            return JukeboxResponse(**cached_result)

        norm_meta = build_normalization_meta(variable, normalization_method)
        provenance = build_provenance_meta(self.provider)
        meta = self.provider.get_source_metadata()

        expected_hours = pd.date_range(start=start_dt, end=end_dt, freq=interval_freq)

        # Step 1: DB-First Lookup (matches nearest stored grid cell within 0.6 deg)
        db_samples_by_time = {
            iso_k: s
            for iso_k, s in ObservationRepository.get_samples_near_coordinate_and_time_range(
                db=db,
                dataset_source_id=dataset_id,
                variable=variable,
                lat=val_lat,
                lon=val_lon,
                start_time=start_dt,
                end_time=end_dt,
                tolerance_deg=0.6,
            ).items()
            if s.value is not None
        }

        expected_iso_list = [h_dt.to_pydatetime().strftime("%Y-%m-%dT%H:%M:%SZ") for h_dt in expected_hours]
        all_db_hit = all(iso_k in db_samples_by_time for iso_k in expected_iso_list)

        # Gather available local files only when there are DB misses
        files_by_dt = {}
        if not all_db_hit:
            for h_dt in expected_hours:
                py_dt = h_dt.to_pydatetime()
                iso_check = py_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                if iso_check not in db_samples_by_time:
                    expected_fn = self.provider.format_granule_filename(py_dt)
                    local_file = settings.DATA_STORAGE_ROOT / expected_fn
                    if local_file.exists():
                        files_by_dt[py_dt] = local_file

        # Ensure DatasetSource only if we have local/remote misses to persist
        if files_by_dt or (not all_db_hit and not offline_only):
            source = DatasetRepository.get_source(db, dataset_id)
            if not source:
                DatasetRepository.upsert_source(
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

        # Default grid snap fallback for explicit 'missing' intervals
        fallback_grid_lat = round(round(val_lat * 4) / 4, 2)
        fallback_grid_lon = round(round(val_lon * 4) / 4, 2)
        resolved_display_unit = ObservationNormalizer.to_display_unit(
            variable, None, raw_unit=var_info["unit"]
        ).display_unit

        points: List[JukeboxPoint] = []
        for order_idx, h_dt in enumerate(expected_hours):
            py_dt = h_dt.to_pydatetime()
            iso_time = py_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            if iso_time in db_samples_by_time:
                db_sample = db_samples_by_time[iso_time]
                val = db_sample.value
                norm_val, disp_val, disp_unit = normalize_and_convert(
                    variable, val, normalization_method, db_sample.unit or var_info["unit"]
                )
                resolved_display_unit = disp_unit
                points.append(
                    JukeboxPoint(
                        order=order_idx,
                        locationId=None,
                        timestamp=iso_time,
                        requestedCoordinates=CoordinatePair(lat=lat, lon=lon),
                        gridCoordinates=CoordinatePair(lat=db_sample.grid_latitude, lon=db_sample.grid_longitude),
                        value=val,
                        normalizedValue=norm_val,
                        displayValue=disp_val,
                        displayUnit=disp_unit,
                        quality=db_sample.quality_status,
                    )
                )
                continue

            file_path = files_by_dt.get(py_dt)
            if file_path:
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
                    raw_unit = pt_dict["unit"] or var_info["unit"]
                    norm_val, disp_val, disp_unit = normalize_and_convert(
                        variable, val, normalization_method, raw_unit
                    )
                    resolved_display_unit = disp_unit

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
                            unit=raw_unit,
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
                            displayValue=disp_val,
                            displayUnit=disp_unit,
                            quality=pt_dict["quality"],
                        )
                    )
                continue

            # Remote OPeNDAP lookup only if not forced offline
            opendap_pt = (
                None
                if offline_only
                else self.provider.extract_point_opendap(py_dt, lat, lon, variable)
            )
            if opendap_pt and opendap_pt.get("value") is not None:
                val = opendap_pt["value"]
                raw_unit = opendap_pt["unit"] or var_info["unit"]
                norm_val, disp_val, disp_unit = normalize_and_convert(
                    variable, val, normalization_method, raw_unit
                )
                resolved_display_unit = disp_unit

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
                        unit=raw_unit,
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
                        displayValue=disp_val,
                        displayUnit=disp_unit,
                        quality=opendap_pt["quality"],
                    )
                )
            else:
                points.append(
                    JukeboxPoint(
                        order=order_idx,
                        locationId=None,
                        timestamp=iso_time,
                        requestedCoordinates=CoordinatePair(lat=lat, lon=lon),
                        gridCoordinates=CoordinatePair(lat=fallback_grid_lat, lon=fallback_grid_lon),
                        value=None,
                        normalizedValue=None,
                        displayValue=None,
                        displayUnit=resolved_display_unit,
                        quality="missing",
                    )
                )

        response = JukeboxResponse(
            mode="temporal",
            datasetId=dataset_id,
            variable=variable,
            unit=var_info["unit"],
            displayUnit=resolved_display_unit,
            dataType=meta["dataType"],
            isMock=False,
            normalization=norm_meta,
            points=points,
            provenance=provenance,
        )

        app_cache.set(cache_key, response.model_dump(), dataset_id=dataset_id)
        return response


temporal_query_service = TemporalQueryService()
