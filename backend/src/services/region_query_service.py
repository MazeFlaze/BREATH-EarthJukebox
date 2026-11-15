from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import json
import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..api.schemas.jukebox_schema import (
    BoundingBoxInput,
    RegionJukeboxRequest,
    RegionJukeboxResponse,
    RegionSummaryMetrics,
    RegionTierRatios,
)
from ..core.cache import app_cache
from ..core.config import settings
from ..processors.netcdf_processor import NetCDFProcessor
from ..processors.observation_normalizer import ObservationNormalizer
from ..providers.geos_cf import GEOSCFProvider
from ..repositories.dataset_repository import DatasetRepository
from ..utils.logger import logger
from .jukebox_helpers import (
    build_normalization_meta,
    build_provenance_meta,
    normalize_and_convert,
    validate_dataset_and_variable,
)


class RegionQueryService:
    """
    Executes Single-ROI (drag-box bounding box or center+delta) spatial aggregation
    using calibrated perceptual normalization and ppbv display conversion.
    """

    def __init__(self, provider: Optional[GEOSCFProvider] = None):
        self.provider = provider or GEOSCFProvider(raw_storage_dir=settings.DATA_STORAGE_ROOT)

    def execute_region_query(
        self,
        request: RegionJukeboxRequest,
        db: Session,
    ) -> RegionJukeboxResponse:
        var_info = validate_dataset_and_variable(self.provider, request.datasetId, request.variable)

        try:
            req_dt = pd.to_datetime(request.timestamp, utc=True)
            iso_time = req_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            raise HTTPException(status_code=422, detail=f"Invalid ISO 8601 timestamp: '{request.timestamp}'")

        polygon_rings: Optional[List[List[Tuple[float, float]]]] = None
        if request.polygons:
            polygon_rings = [[(pt.lat, pt.lon) for pt in ring] for ring in request.polygons]
        elif request.polygon:
            polygon_rings = [[(pt.lat, pt.lon) for pt in request.polygon]]

        if request.bounds is not None:
            bbox = request.bounds
        elif polygon_rings:
            all_lats = [lat for ring in polygon_rings for (lat, _) in ring]
            all_lons = [lon for ring in polygon_rings for (_, lon) in ring]
            bbox = BoundingBoxInput(
                latMin=min(all_lats),
                latMax=max(all_lats),
                lonMin=min(all_lons),
                lonMax=max(all_lons),
            )
        else:
            assert request.center is not None
            bbox = BoundingBoxInput(
                latMin=max(-90.0, request.center.lat - request.deltaDeg),
                latMax=min(90.0, request.center.lat + request.deltaDeg),
                lonMin=request.center.lon - request.deltaDeg,
                lonMax=request.center.lon + request.deltaDeg,
            )

        polygon_hash = (
            hashlib.sha256(json.dumps(polygon_rings, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
            if polygon_rings
            else "bbox"
        )
        mask_mode = "polygon" if polygon_rings else "bounds"

        cache_key = app_cache.create_key(
            "jukebox_region",
            {
                "datasetId": request.datasetId,
                "timestamp": iso_time,
                "variable": request.variable,
                "latMin": round(bbox.latMin, 4),
                "latMax": round(bbox.latMax, 4),
                "lonMin": round(bbox.lonMin, 4),
                "lonMax": round(bbox.lonMax, 4),
                "polygonHash": polygon_hash,
                "normalizationMethod": request.normalizationMethod,
                "includeSeries": request.includeSeries,
                "seriesStepHours": request.seriesStepHours if request.includeSeries else None,
            },
        )
        cached_result = app_cache.get(cache_key)
        if cached_result:
            logger.info(f"Cache hit for region ROI query [{request.variable} at {iso_time}]")
            return RegionJukeboxResponse(**cached_result)

        norm_meta = build_normalization_meta(request.variable, request.normalizationMethod)
        provenance = build_provenance_meta(self.provider)
        meta = self.provider.get_source_metadata()

        py_dt = req_dt.to_pydatetime()
        asset = DatasetRepository.get_asset_by_time(db, request.datasetId, py_dt)
        file_path: Optional[Path] = None
        if asset:
            file_path = asset.resolve_path()

        if file_path is None:
            candidate = settings.DATA_STORAGE_ROOT / self.provider.format_granule_filename(py_dt)
            if candidate.exists():
                file_path = candidate

        if file_path is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No local NetCDF granule found for dataset '{request.datasetId}' at '{iso_time}'. "
                    "ROI spatial aggregation requires an ingested local granule."
                ),
            )

        raw_summary = self._summarize_file(
            file_path=file_path,
            request=request,
            bbox=bbox,
            polygon_rings=polygon_rings,
            target_dt=py_dt,
        )

        raw_unit = raw_summary.get("raw_unit") or var_info["unit"]
        norm_min, disp_min, _ = normalize_and_convert(
            request.variable, raw_summary["min"], request.normalizationMethod, raw_unit
        )
        norm_mean, disp_mean, disp_unit = normalize_and_convert(
            request.variable, raw_summary["mean"], request.normalizationMethod, raw_unit
        )
        norm_p90, disp_p90, _ = normalize_and_convert(
            request.variable, raw_summary["p90"], request.normalizationMethod, raw_unit
        )
        norm_max, disp_max, _ = normalize_and_convert(
            request.variable, raw_summary["max"], request.normalizationMethod, raw_unit
        )

        # Fallback display unit lookup when summary statistics are missing
        if raw_summary["valid_count"] == 0:
            disp_unit = ObservationNormalizer.to_display_unit(request.variable, None, raw_unit=raw_unit).display_unit

        resolved_ts = raw_summary.get("timestamp") or iso_time
        series_values: Optional[List[float]] = None
        series_timestamps: Optional[List[str]] = None
        if request.includeSeries:
            series_values, series_timestamps = self._build_daily_series(
                db=db,
                request=request,
                bbox=bbox,
                polygon_rings=polygon_rings,
                target_dt=py_dt,
                current_timestamp=resolved_ts,
                current_display_mean=disp_mean,
                fallback_raw_unit=raw_unit,
            )

        response = RegionJukeboxResponse(
            mode="region",
            maskMode=mask_mode,
            datasetId=request.datasetId,
            variable=request.variable,
            timestamp=resolved_ts,
            unit=raw_unit,
            displayUnit=disp_unit,
            dataType=meta["dataType"],
            isMock=False,
            bounds=bbox,
            normalization=norm_meta,
            summary=RegionSummaryMetrics(
                min=raw_summary["min"],
                mean=raw_summary["mean"],
                p90=raw_summary["p90"],
                max=raw_summary["max"],
                displayMin=disp_min,
                displayMean=disp_mean,
                displayP90=disp_p90,
                displayMax=disp_max,
                normalizedMin=norm_min,
                normalizedMean=norm_mean,
                normalizedP90=norm_p90,
                normalizedMax=norm_max,
                validCount=raw_summary["valid_count"],
                missingCount=raw_summary["missing_count"],
                totalCount=raw_summary["total_count"],
                snappedToNearest=raw_summary["snapped_to_nearest"],
                tierRatios=RegionTierRatios(**raw_summary["tier_ratios"]),
            ),
            series=series_values,
            seriesTimestamps=series_timestamps,
            provenance=provenance,
        )
        app_cache.set(cache_key, response.model_dump(), dataset_id=request.datasetId)
        return response

    @staticmethod
    def _ensure_utc(dt: datetime) -> datetime:
        """Normalizes naive datetimes (e.g. from SQLite) to UTC-aware datetimes."""
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)

    @staticmethod
    def _summarize_file(
        file_path: Path,
        request: RegionJukeboxRequest,
        bbox: BoundingBoxInput,
        polygon_rings: Optional[List[List[Tuple[float, float]]]],
        target_dt: datetime,
    ) -> Dict[str, Any]:
        """Opens a single NetCDF granule and aggregates ROI summary statistics."""
        with NetCDFProcessor.open_dataset(file_path) as ds:
            if request.bounds is not None or polygon_rings is not None:
                return NetCDFProcessor.extract_bbox_summary(
                    ds=ds,
                    variable=request.variable,
                    lat_min=bbox.latMin,
                    lat_max=bbox.latMax,
                    lon_min=bbox.lonMin,
                    lon_max=bbox.lonMax,
                    timestamp=target_dt,
                    polygon_rings=polygon_rings,
                )
            assert request.center is not None
            return NetCDFProcessor.extract_region_summary(
                ds=ds,
                variable=request.variable,
                lat=request.center.lat,
                lon=request.center.lon,
                delta_deg=request.deltaDeg,
                timestamp=target_dt,
            )

    def _build_daily_series(
        self,
        db: Session,
        request: RegionJukeboxRequest,
        bbox: BoundingBoxInput,
        polygon_rings: Optional[List[List[Tuple[float, float]]]],
        target_dt: datetime,
        current_timestamp: str,
        current_display_mean: Optional[float],
        fallback_raw_unit: str,
    ) -> Tuple[List[float], List[str]]:
        """
        Samples same-UTC-day regional mean values in chronological steps (>= seriesStepHours),
        reusing the already-computed current timestamp summary to keep latency under FE abort limits.
        """
        utc_target = self._ensure_utc(target_dt)
        day_start = utc_target.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(hours=23, minutes=59, seconds=59)

        day_assets = DatasetRepository.get_assets_in_range(db, request.datasetId, day_start, day_end)
        step_seconds = max(1, request.seriesStepHours) * 3600

        series_vals: List[float] = []
        series_ts: List[str] = []
        last_selected: Optional[datetime] = None

        for asset in day_assets:
            asset_dt = self._ensure_utc(asset.time_start)
            if asset_dt < day_start or asset_dt > day_end:
                continue

            if last_selected is not None and (asset_dt - last_selected).total_seconds() < step_seconds - 60:
                continue

            # Reuse primary query result for matching timestamp without reopening the granule
            if abs((asset_dt - utc_target).total_seconds()) < 60:
                last_selected = asset_dt
                if current_display_mean is not None:
                    series_vals.append(float(current_display_mean))
                    series_ts.append(current_timestamp)
                continue

            asset_path = asset.resolve_path()
            if asset_path is None:
                continue

            slot_summary = self._summarize_file(
                file_path=asset_path,
                request=request,
                bbox=bbox,
                polygon_rings=polygon_rings,
                target_dt=asset_dt,
            )
            slot_raw_unit = slot_summary.get("raw_unit") or fallback_raw_unit
            _, slot_disp_mean, _ = normalize_and_convert(
                request.variable, slot_summary["mean"], request.normalizationMethod, slot_raw_unit
            )
            last_selected = asset_dt
            if slot_disp_mean is not None:
                series_vals.append(float(slot_disp_mean))
                series_ts.append(slot_summary.get("timestamp") or asset_dt.strftime("%Y-%m-%dT%H:%M:%SZ"))

        if not series_vals and current_display_mean is not None:
            series_vals.append(float(current_display_mean))
            series_ts.append(current_timestamp)

        return series_vals, series_ts


region_query_service = RegionQueryService()
