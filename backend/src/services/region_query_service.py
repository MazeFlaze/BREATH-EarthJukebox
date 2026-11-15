from pathlib import Path
from typing import List, Optional, Tuple
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

        with NetCDFProcessor.open_dataset(file_path) as ds:
            if request.bounds is not None or polygon_rings is not None:
                raw_summary = NetCDFProcessor.extract_bbox_summary(
                    ds=ds,
                    variable=request.variable,
                    lat_min=bbox.latMin,
                    lat_max=bbox.latMax,
                    lon_min=bbox.lonMin,
                    lon_max=bbox.lonMax,
                    timestamp=py_dt,
                    polygon_rings=polygon_rings,
                )
            else:
                assert request.center is not None
                raw_summary = NetCDFProcessor.extract_region_summary(
                    ds=ds,
                    variable=request.variable,
                    lat=request.center.lat,
                    lon=request.center.lon,
                    delta_deg=request.deltaDeg,
                    timestamp=py_dt,
                )

        raw_unit = raw_summary.get("raw_unit") or var_info["unit"]
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

        response = RegionJukeboxResponse(
            mode="region",
            maskMode=mask_mode,
            datasetId=request.datasetId,
            variable=request.variable,
            timestamp=raw_summary.get("timestamp") or iso_time,
            unit=raw_unit,
            displayUnit=disp_unit,
            dataType=meta["dataType"],
            isMock=False,
            bounds=bbox,
            normalization=norm_meta,
            summary=RegionSummaryMetrics(
                mean=raw_summary["mean"],
                p90=raw_summary["p90"],
                max=raw_summary["max"],
                displayMean=disp_mean,
                displayP90=disp_p90,
                displayMax=disp_max,
                normalizedMean=norm_mean,
                normalizedP90=norm_p90,
                normalizedMax=norm_max,
                validCount=raw_summary["valid_count"],
                missingCount=raw_summary["missing_count"],
                totalCount=raw_summary["total_count"],
                snappedToNearest=raw_summary["snapped_to_nearest"],
                tierRatios=RegionTierRatios(**raw_summary["tier_ratios"]),
            ),
            provenance=provenance,
        )
        app_cache.set(cache_key, response.model_dump(), dataset_id=request.datasetId)
        return response


region_query_service = RegionQueryService()
