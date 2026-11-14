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

        # Gather available hourly files covering the range
        # Generate expected hourly sequence (e.g. step by 1 hour)
        expected_hours = pd.date_range(start=start_dt, end=end_dt, freq="1h")
        files_by_dt = {}
        for h_dt in expected_hours:
            py_dt = h_dt.to_pydatetime()
            expected_fn = self.provider.format_granule_filename(py_dt)
            local_file = settings.DATA_STORAGE_ROOT / expected_fn
            if local_file.exists():
                files_by_dt[py_dt] = local_file

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

        points: List[JukeboxPoint] = []
        order_idx = 0

        # Build ordered time series point by point
        for h_dt in expected_hours:
            py_dt = h_dt.to_pydatetime()
            iso_time = py_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            file_path = files_by_dt.get(py_dt)
            if file_path:
                with NetCDFProcessor.open_dataset(file_path) as ds:
                    pt_dict = NetCDFProcessor.extract_point_value(ds, variable, lat, lon, timestamp=py_dt)
                    val = pt_dict["value"]
                    norm_val = ObservationNormalizer.normalize(variable, val)
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
                # Explicit missing interval state
                grid_lat = round(round(val_lat * 4) / 4, 2)
                grid_lon = round(round(val_lon * 4) / 4, 2)
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
