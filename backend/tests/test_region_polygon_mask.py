from pathlib import Path
import uuid

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from fastapi.testclient import TestClient

try:
    from backend.src.core.cache import app_cache
    from backend.src.core.database import SessionLocal
    from backend.src.main import app
    from backend.src.processors.netcdf_processor import NetCDFProcessor
    from backend.src.repositories.dataset_repository import DatasetRepository
    from backend.src.services.ingestion_service import IngestionService
except ImportError:
    from src.core.cache import app_cache
    from src.core.database import SessionLocal
    from src.main import app
    from src.processors.netcdf_processor import NetCDFProcessor
    from src.repositories.dataset_repository import DatasetRepository
    from src.services.ingestion_service import IngestionService

client = TestClient(app)


def test_netcdf_polygon_and_multipolygon_masks_exclude_outside_cells():
    """Verify polygon_rings and MultiPolygon masking filter grid cells strictly inside border rings."""
    lats = np.array([10.0, 11.0, 12.0, 13.0], dtype=np.float32)
    lons = np.array([100.0, 101.0, 102.0, 103.0], dtype=np.float32)
    times = pd.date_range("2026-11-12 00:30:00", periods=1)

    grid = np.full((1, len(lats), len(lons)), 10.0, dtype=np.float32)
    # Place high-pollution corner outside our triangular polygon mask (at lat=13, lon=100)
    grid[0, 3, 0] = 90.0
    # Place second island peak at lat=10, lon=103
    grid[0, 0, 3] = 30.0

    ds = xr.Dataset(
        data_vars={"PM25_RH35": (["time", "lat", "lon"], grid, {"units": "ug m-3"})},
        coords={"time": times, "lat": lats, "lon": lons},
    )

    bbox_res = NetCDFProcessor.extract_bbox_summary(
        ds=ds, variable="PM25_RH35", lat_min=9.5, lat_max=13.5, lon_min=99.5, lon_max=103.5
    )
    assert bbox_res["max"] == pytest.approx(90.0)
    assert bbox_res["total_count"] == 16

    # Triangle covering lower-right mainland + peak excluding upper-left corner (lat=13, lon=100)
    triangle_ring = [(9.6, 100.8), (13.4, 103.4), (9.6, 103.4)]
    poly_res = NetCDFProcessor.extract_bbox_summary(
        ds=ds,
        variable="PM25_RH35",
        lat_min=9.5,
        lat_max=13.5,
        lon_min=99.5,
        lon_max=103.5,
        polygon_rings=[triangle_ring],
    )
    assert poly_res["total_count"] < 16
    assert poly_res["max"] < 90.0

    # MultiPolygon selecting just (11, 101) [value=10] and distant island (10, 103) [value=30]
    island_a = [(10.6, 100.6), (10.6, 101.4), (11.4, 101.4), (11.4, 100.6)]
    island_b = [(9.6, 102.6), (9.6, 103.4), (10.4, 103.4), (10.4, 102.6)]
    multi_res = NetCDFProcessor.extract_bbox_summary(
        ds=ds,
        variable="PM25_RH35",
        lat_min=9.5,
        lat_max=13.5,
        lon_min=99.5,
        lon_max=103.5,
        polygon_rings=[island_a, island_b],
    )
    assert multi_res["total_count"] == 2
    assert multi_res["mean"] == pytest.approx(20.0)


def test_region_endpoint_polygon_mask_vs_bbox_no_cache_collision(tmp_path: Path):
    """
    Verify POST /api/v1/jukebox/region accepts 'polygon'/'polygons' without 'bounds',
    computes distinct masked stats from identical bbox queries, and avoids cache collision.
    """
    app_cache.clear()
    raw_dir = tmp_path / "poly_mask_nc"
    raw_dir.mkdir(parents=True, exist_ok=True)
    nc_path = raw_dir / "GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261114_0030z.R0.nc4"

    lats = np.array([14.0, 15.0, 16.0], dtype=np.float32)
    lons = np.array([104.0, 105.0, 106.0], dtype=np.float32)
    times = pd.date_range("2026-11-14 00:30:00", periods=1)

    vals = np.full((1, len(lats), len(lons)), 18.0, dtype=np.float32)
    # Outlier northwest cell outside masked eastern corridor polygon
    vals[0, 2, 0] = 88.0

    ds = xr.Dataset(
        data_vars={"PM25_RH35": (["time", "lat", "lon"], vals, {"units": "ug m-3"})},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    ds.to_netcdf(nc_path, engine="netcdf4")

    with SessionLocal() as db:
        service = IngestionService()
        service.ingest_directory(db=db, raw_dir=raw_dir, skip_existing=False)

        try:
            bbox_resp = client.post(
                "/api/v1/jukebox/region",
                json={
                    "datasetId": "geos-cf-v2-aqc",
                    "timestamp": "2026-11-14T00:30:00Z",
                    "variable": "PM25_RH35",
                    "bounds": {"latMin": 13.5, "latMax": 16.5, "lonMin": 103.5, "lonMax": 106.5},
                },
            )
            assert bbox_resp.status_code == 200, bbox_resp.text
            bbox_data = bbox_resp.json()
            assert bbox_data["maskMode"] == "bounds"
            assert bbox_data["summary"]["totalCount"] == 9
            assert bbox_data["summary"]["max"] == pytest.approx(88.0)

            poly_resp = client.post(
                "/api/v1/jukebox/region",
                json={
                    "datasetId": "geos-cf-v2-aqc",
                    "timestamp": "2026-11-14T00:30:00Z",
                    "variable": "PM25_RH35",
                    "bounds": {"latMin": 13.5, "latMax": 16.5, "lonMin": 103.5, "lonMax": 106.5},
                    "polygons": [
                        [
                            {"lat": 13.7, "lon": 104.6},
                            {"lat": 16.4, "lon": 105.6},
                            {"lat": 16.4, "lon": 106.4},
                            {"lat": 13.7, "lon": 106.4},
                        ]
                    ],
                },
            )
            assert poly_resp.status_code == 200, poly_resp.text
            poly_data = poly_resp.json()
            assert poly_data["maskMode"] == "polygon"
            assert poly_data["summary"]["totalCount"] < 9
            assert poly_data["summary"]["mean"] == pytest.approx(18.0)

            # Polygon-only payload (bounds omitted)
            poly_only_resp = client.post(
                "/api/v1/jukebox/region",
                json={
                    "datasetId": "geos-cf-v2-aqc",
                    "timestamp": "2026-11-14T00:30:00Z",
                    "variable": "PM25_RH35",
                    "polygon": [
                        {"lat": 14.5, "lon": 104.5},
                        {"lat": 15.5, "lon": 104.5},
                        {"lat": 15.5, "lon": 105.5},
                        {"lat": 14.5, "lon": 105.5},
                    ],
                },
            )
            assert poly_only_resp.status_code == 200, poly_only_resp.text
            assert poly_only_resp.json()["maskMode"] == "polygon"

            # Reject < 3 vertices in Pydantic validation
            bad_resp = client.post(
                "/api/v1/jukebox/region",
                json={
                    "datasetId": "geos-cf-v2-aqc",
                    "timestamp": "2026-11-14T00:30:00Z",
                    "variable": "PM25_RH35",
                    "polygon": [{"lat": 15.0, "lon": 105.0}, {"lat": 16.0, "lon": 106.0}],
                },
            )
            assert bad_resp.status_code == 422
        finally:
            asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"geos-cf-v2-aqc:{nc_path.name}"))
            asset_row = DatasetRepository.get_asset(db, asset_id)
            if asset_row:
                db.delete(asset_row)
                db.commit()
