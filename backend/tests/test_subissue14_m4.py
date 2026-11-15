import json
import struct
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from fastapi.testclient import TestClient

try:
    from backend.scripts.render_geos_cf_maps import render_flat_map_png
    from backend.src.core.cache import app_cache
    from backend.src.core.database import SessionLocal
    from backend.src.main import app
    from backend.src.processors.netcdf_processor import NetCDFProcessor
    from backend.src.processors.observation_normalizer import ObservationNormalizer
    from backend.src.repositories.dataset_repository import DatasetRepository
    from backend.src.repositories.observation_repository import ObservationRepository
    from backend.src.services.ingestion_service import IngestionService
    from backend.src.services.temporal_query_service import TemporalQueryService
except ImportError:
    from scripts.render_geos_cf_maps import render_flat_map_png
    from src.core.cache import app_cache
    from src.core.database import SessionLocal
    from src.main import app
    from src.processors.netcdf_processor import NetCDFProcessor
    from src.processors.observation_normalizer import ObservationNormalizer
    from src.repositories.dataset_repository import DatasetRepository
    from src.repositories.observation_repository import ObservationRepository
    from src.services.ingestion_service import IngestionService
    from src.services.temporal_query_service import TemporalQueryService

client = TestClient(app)


def test_single_roi_region_jukebox_endpoint_drag_box_and_center():
    """Verify POST /api/v1/jukebox/region supports drag-box bounds, ppbv display units, and log_scale."""
    app_cache.clear()
    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "NO2",
        "bounds": {
            "latMin": 20.5,
            "latMax": 22.0,
            "lonMin": 105.0,
            "lonMax": 106.5,
        },
        "normalizationMethod": "log_scale",
    }
    res = client.post("/api/v1/jukebox/region", json=payload)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["mode"] == "region"
    assert data["variable"] == "NO2"
    assert data["unit"] == "mol mol-1"
    assert data["displayUnit"] == "ppbv"
    assert data["isMock"] is False
    assert data["normalization"]["method"] == "log_scale"

    summary = data["summary"]
    assert summary["validCount"] >= 1
    assert summary["min"] == pytest.approx(1.2e-8, rel=0.05)
    assert summary["displayMin"] == pytest.approx(12.0, rel=0.05)
    assert summary["normalizedMin"] == pytest.approx(ObservationNormalizer.normalize("NO2", summary["min"], method="log_scale"))
    assert summary["p90"] == pytest.approx(1.2e-8, rel=0.05)
    assert summary["displayP90"] == pytest.approx(12.0, rel=0.05)
    assert summary["normalizedP90"] == pytest.approx(ObservationNormalizer.normalize("NO2", summary["p90"], method="log_scale"))
    assert sum(summary["tierRatios"].values()) == pytest.approx(1.0)
    assert data["series"] is None
    assert data["seriesTimestamps"] is None

    # Center + deltaDeg shorthand
    center_res = client.post(
        "/api/v1/jukebox/region",
        json={
            "datasetId": "geos-cf-v2-aqc",
            "timestamp": "2026-11-13T01:30:00Z",
            "variable": "PM25_RH35",
            "center": {"lat": 21.03, "lon": 105.85},
            "deltaDeg": 0.5,
        },
    )
    assert center_res.status_code == 200, center_res.text
    assert center_res.json()["displayUnit"] == "µg/m³"

    # Missing timestamp granule returns 404 explicitly
    missing_ts_res = client.post(
        "/api/v1/jukebox/region",
        json={
            "datasetId": "geos-cf-v2-aqc",
            "timestamp": "2020-01-01T00:30:00Z",
            "variable": "PM25_RH35",
            "bounds": {"latMin": 20.0, "latMax": 22.0, "lonMin": 105.0, "lonMax": 107.0},
        },
    )
    assert missing_ts_res.status_code == 404

    # Invalid payload missing both bounds and center rejected by Pydantic
    invalid_res = client.post(
        "/api/v1/jukebox/region",
        json={"datasetId": "geos-cf-v2-aqc", "timestamp": "2026-11-13T01:30:00Z", "variable": "PM25_RH35"},
    )
    assert invalid_res.status_code == 422


def test_temporal_jukebox_db_first_nearest_grid_and_log_scale(tmp_path: Path):
    """
    Verifies batch directory ingestion stores nearest 1.0-deg cells and DB-first temporal lookup
    serves calibrated log_scale + ppbv responses without reopening NetCDF files.
    """
    app_cache.clear()
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    # Create a 1.0-deg granule at 2026-11-10T01:30:00Z so Hanoi (21.03, 105.85) snaps to (21.0, 106.0)
    # Note (21.0, 106.0) differs from hardcoded 0.25-deg (21.0, 105.75), testing variable-grid DB lookup
    sample_nc = raw_dir / "GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261110_0130z.R0.nc4"
    lats = np.arange(-90.0, 91.0, 1.0, dtype=np.float32)
    lons = np.arange(-180.0, 180.0, 1.0, dtype=np.float32)
    times = pd.date_range("2026-11-10 01:30:00", periods=1)

    no2_grid = np.full((1, len(lats), len(lons)), 2.5e-9, dtype=np.float32)
    ds = xr.Dataset(
        data_vars={"NO2": (["time", "lat", "lon"], no2_grid, {"units": "mol mol-1"})},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    ds.to_netcdf(sample_nc, engine="netcdf4")

    target_dt = datetime(2026, 11, 10, 1, 30, tzinfo=timezone.utc)
    service = IngestionService()
    with SessionLocal() as db:
        summary = service.ingest_directory(db=db, raw_dir=raw_dir, skip_existing=False)
        assert summary["ingested"] == 1
        assert summary["materialized_samples"] >= 1

        # Verify nearest DB sample lookup resolves (21.0, 106.0)
        db_map = ObservationRepository.get_samples_near_coordinate_and_time_range(
            db=db,
            dataset_source_id="geos-cf-v2-aqc",
            variable="NO2",
            lat=21.03,
            lon=105.85,
            start_time=target_dt,
            end_time=target_dt,
        )
        assert "2026-11-10T01:30:00Z" in db_map
        assert db_map["2026-11-10T01:30:00Z"].grid_longitude == pytest.approx(106.0)

        app_cache.clear()
        with patch.object(NetCDFProcessor, "open_dataset") as mock_open:
            t_service = TemporalQueryService()
            resp = t_service.execute_temporal_query(
                dataset_id="geos-cf-v2-aqc",
                lat=21.03,
                lon=105.85,
                variable="NO2",
                start_time_str="2026-11-10T01:30:00Z",
                end_time_str="2026-11-10T01:30:00Z",
                interval="1h",
                db=db,
                normalization_method="log_scale",
                offline_only=True,
            )
            mock_open.assert_not_called()

        assert len(resp.points) == 1
        pt = resp.points[0]
        assert pt.displayUnit == "ppbv"
        assert pt.displayValue == pytest.approx(2.5)
        assert pt.normalizedValue == ObservationNormalizer.normalize("NO2", 2.5e-9, method="log_scale")

        # Cleanup synthetic test DB asset/samples
        import uuid

        asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"geos-cf-v2-aqc:{sample_nc.name}"))
        asset_row = DatasetRepository.get_asset(db, asset_id)
        if asset_row:
            db.delete(asset_row)
            db.commit()


def test_offline_svs5533_flat_map_png_render_and_catalogs(tmp_path: Path):
    """Verifies render_flat_map_png creates exact 1920x1080 PNGs and offline M4 assets exist."""
    nc_file = tmp_path / "render_sample.nc4"
    lats = np.linspace(-90.0, 90.0, 19, dtype=np.float32)
    lons = np.linspace(-180.0, 170.0, 36, dtype=np.float32)
    pm25 = np.full((1, 1, 19, 36), 25.0, dtype=np.float32)
    pm25[0, 0, 0, 0] = 1e15  # fill value must mask cleanly without raising

    ds = xr.Dataset(
        data_vars={"PM25_RH35": (["time", "lev", "lat", "lon"], pm25, {"units": "ug m-3"})},
        coords={"time": pd.date_range("2026-11-12 00:30:00", periods=1), "lev": [1.0], "lat": lats, "lon": lons},
    )
    ds.to_netcdf(nc_file, engine="netcdf4")

    out_png = tmp_path / "flat_pm25.png"
    meta = render_flat_map_png(nc_file, "PM25_RH35", out_png)
    assert out_png.exists() and out_png.stat().st_size > 1000
    assert meta["width"] == 1920
    assert meta["height"] == 1080

    # Verify PNG header exact pixel dimensions (IHDR chunk bytes 16..24)
    raw_bytes = out_png.read_bytes()
    assert raw_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", raw_bytes[16:24])
    assert (width, height) == (1920, 1080)

    # Verify generated offline M4 assets in repository
    repo_root = Path(__file__).resolve().parent.parent.parent
    manifest_file = repo_root / "frontend" / "public" / "images" / "geos-cf" / "manifest.json"
    frontend_obs = repo_root / "frontend" / "src" / "data" / "observations.json"
    backend_offline = repo_root / "backend" / "src" / "data" / "processed" / "geos_cf_offline_maps.json"

    assert manifest_file.exists()
    manifest_json = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert len(manifest_json["maps"]) > 0
    for item in manifest_json["maps"]:
        img_rel = item["imageUrl"].lstrip("/")
        assert (repo_root / "frontend" / "public" / img_rel).exists()

    assert frontend_obs.exists()
    fe_json = json.loads(frontend_obs.read_text(encoding="utf-8"))
    assert fe_json["dataset"]["isMock"] is False
    assert all(obs["imageUrl"].startswith("/images/geos-cf/") for obs in fe_json["dataset"]["observations"])
    assert backend_offline.exists()
