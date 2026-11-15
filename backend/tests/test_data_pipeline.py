from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

try:
    from backend.scripts import render_geos_cf_maps, run_data_pipeline
    from backend.src.api.routes.datasets import get_dataset_availability
    from backend.src.api.routes.health import healthcheck
    from backend.src.api.routes.locations import list_locations
    from backend.src.core.config import Settings
    from backend.src.core.database import Base
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.services.ingestion_service import IngestionService
except ImportError:
    from scripts import render_geos_cf_maps, run_data_pipeline
    from src.api.routes.datasets import get_dataset_availability
    from src.api.routes.health import healthcheck
    from src.api.routes.locations import list_locations
    from src.core.config import Settings
    from src.core.database import Base
    from src.providers.geos_cf import GEOSCFProvider
    from src.services.ingestion_service import IngestionService


def _create_synthetic_granule(path: Path, timestamp_utc: str) -> None:
    """Writes a compact valid 4D (1,1,60,60) GEOS-CF v2 NetCDF-4 file for pipeline tests."""
    lats = np.linspace(-90.0, 90.0, 60, dtype=np.float32)
    lons = np.linspace(-180.0, 179.0, 60, dtype=np.float32)
    lev = np.array([72.0], dtype=np.float32)
    rng = np.random.default_rng(abs(hash(timestamp_utc)) % (2**31))

    pm25 = rng.lognormal(mean=2.2, sigma=0.4, size=(1, 1, 60, 60)).astype(np.float32)
    no2 = (pm25 * 0.25 * 1e-9).astype(np.float32)
    o3 = (np.full((1, 1, 60, 60), 30.0, dtype=np.float32) * np.float32(1e-9))
    so2 = (pm25 * 0.1 * 1e-9).astype(np.float32)
    co = ((80.0 + pm25 * 3.0) * np.float32(1e-9)).astype(np.float32)
    for arr in (pm25, no2, o3, so2, co):
        arr[0, 0, 0, 0] = np.float32(1e15)

    ts = pd.Timestamp(timestamp_utc, tz="UTC")
    ds = xr.Dataset(
        data_vars={
            "PM25_RH35": (["time", "lev", "lat", "lon"], pm25, {"units": "ug m-3"}),
            "NO2": (["time", "lev", "lat", "lon"], no2, {"units": "mol mol-1"}),
            "O3": (["time", "lev", "lat", "lon"], o3, {"units": "mol mol-1"}),
            "SO2": (["time", "lev", "lat", "lon"], so2, {"units": "mol mol-1"}),
            "CO": (["time", "lev", "lat", "lon"], co, {"units": "mol mol-1"}),
        },
        coords={
            "time": pd.DatetimeIndex([ts.tz_localize(None)]),
            "lev": ("lev", lev, {"units": "layer"}),
            "lat": ("lat", lats, {"units": "degrees_north"}),
            "lon": ("lon", lons, {"units": "degrees_east"}),
        },
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(path, engine="netcdf4")
    ds.close()


def test_cors_origins_parses_csv_and_json_strings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://breathe-frontend.azurecontainerapps.io/, http://localhost:3000 ",
    )
    csv_settings = Settings(_env_file=None)
    assert csv_settings.CORS_ORIGINS == [
        "https://breathe-frontend.azurecontainerapps.io",
        "http://localhost:3000",
    ]

    monkeypatch.setenv("CORS_ORIGINS", '["https://a.example.com/", "https://b.example.com"]')
    json_settings = Settings(_env_file=None)
    assert json_settings.CORS_ORIGINS == [
        "https://a.example.com",
        "https://b.example.com",
    ]


def test_discover_latest_available_date_probes_backward(tmp_path: Path) -> None:
    provider = GEOSCFProvider(raw_storage_dir=tmp_path)
    anchor = datetime(2026, 11, 15, 12, 0, 0, tzinfo=timezone.utc)

    def fake_head(url: str) -> MagicMock:
        resp = MagicMock()
        resp.status_code = 200 if "Y2026/M11/D14/" in url else 404
        return resp

    mock_client = MagicMock()
    mock_client.head.side_effect = fake_head
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    import sys

    geos_cf_mod = sys.modules[GEOSCFProvider.__module__]
    with patch.object(geos_cf_mod.httpx, "Client", return_value=mock_ctx):
        found = provider.discover_latest_available_date(max_lookback_days=3, reference_date=anchor)

    assert found == "2026-11-14"


def test_ingest_remote_range_disables_mid_batch_eviction(tmp_path: Path) -> None:
    provider = GEOSCFProvider(raw_storage_dir=tmp_path)
    service = IngestionService(provider=provider)
    fetched_flags: List[bool] = []

    def fake_fetch(timestamp: str, target_dir: Path | None = None, auto_cleanup: bool = True) -> Path:
        fetched_flags.append(auto_cleanup)
        dt = pd.to_datetime(timestamp, utc=True).to_pydatetime()
        nc = tmp_path / provider.format_granule_filename(dt)
        nc.write_bytes(b"mock")
        return nc

    with patch.object(provider, "fetch_granule", side_effect=fake_fetch), patch.object(
        provider, "cleanup_old_granules", return_value=[]
    ) as mock_cleanup, patch.object(
        service, "ingest_local_file", return_value={"status": "completed"}
    ):
        results = service.ingest_remote_range(
            start_time="2026-11-15T00:30:00Z",
            end_time="2026-11-15T03:30:00Z",
            db=MagicMock(),
            step_hours=3,
        )

    assert len(results) == 2
    assert fetched_flags == [False, False]
    mock_cleanup.assert_called_once()


def test_render_pipeline_picks_latest_date_and_cleans_stale(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    out_dir = tmp_path / "out_maps"
    provider = GEOSCFProvider(raw_storage_dir=raw_dir)

    # Create one older 2026-11-12 granule and two newer 2026-11-15 granules
    _create_synthetic_granule(
        raw_dir / provider.format_granule_filename(datetime(2026, 11, 12, 0, 30, tzinfo=timezone.utc)),
        "2026-11-12T00:30:00Z",
    )
    _create_synthetic_granule(
        raw_dir / provider.format_granule_filename(datetime(2026, 11, 15, 0, 30, tzinfo=timezone.utc)),
        "2026-11-15T00:30:00Z",
    )
    _create_synthetic_granule(
        raw_dir / provider.format_granule_filename(datetime(2026, 11, 15, 3, 30, tzinfo=timezone.utc)),
        "2026-11-15T03:30:00Z",
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    stale_png = out_dir / "geos_cf_PM25_RH35_20261112_0030z.png"
    stale_png.write_bytes(b"stale")

    selected, resolved_date = render_geos_cf_maps.select_granules_for_date(
        raw_dir=raw_dir,
        target_date="latest",
        step_hours=3,
    )
    assert resolved_date == "2026-11-15"
    assert len(selected) == 2
    assert all("20261115_" in p.name for p in selected)

    res = render_geos_cf_maps.run_render_pipeline(
        raw_dir=raw_dir,
        output_dir=out_dir,
        variables=["PM25_RH35"],
        step_hours=3,
        target_date="latest",
        clean_stale=True,
        catalog_root=tmp_path,
    )
    assert res["target_date"] == "2026-11-15"
    assert res["granules_processed"] == 2
    assert res["images_rendered"] == 2
    assert res["stale_removed"] == 1
    assert not stale_png.exists()

    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["targetDate"] == "2026-11-15"
    assert len(manifest["maps"]) == 2
    assert (tmp_path / "frontend" / "src" / "data" / "observations.json").exists()


def test_run_data_pipeline_dry_run_and_local_end_to_end(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    out_dir = tmp_path / "public_maps"
    eda_dir = tmp_path / "eda_outputs"
    catalog_root = tmp_path / "catalog"
    provider = GEOSCFProvider(raw_storage_dir=raw_dir)

    _create_synthetic_granule(
        raw_dir / provider.format_granule_filename(datetime(2026, 11, 15, 0, 30, tzinfo=timezone.utc)),
        "2026-11-15T00:30:00Z",
    )
    _create_synthetic_granule(
        raw_dir / provider.format_granule_filename(datetime(2026, 11, 15, 3, 30, tzinfo=timezone.utc)),
        "2026-11-15T03:30:00Z",
    )

    dry_report = run_data_pipeline.main(
        [
            "--date",
            "latest",
            "--local-only",
            "--step-hours",
            "3",
            "--raw-dir",
            str(raw_dir),
            "--output-dir",
            str(out_dir),
            "--eda-dir",
            str(eda_dir),
            "--dry-run",
        ]
    )
    assert dry_report["dry_run"] is True
    assert dry_report["target_date"] == "2026-11-15"
    assert dry_report["steps"]["render"]["expected_images"] == 40
    assert not (out_dir / "manifest.json").exists()

    db_path = tmp_path / "pipeline_test.db"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    with patch.object(run_data_pipeline, "init_db", side_effect=lambda: Base.metadata.create_all(bind=engine)), patch.object(
        run_data_pipeline, "SessionLocal", TestingSession
    ):
        real_report = run_data_pipeline.run_pipeline(
            date="latest",
            variables=["PM25_RH35", "NO2"],
            step_hours=3,
            raw_dir=raw_dir,
            output_dir=out_dir,
            eda_dir=eda_dir,
            catalog_root=catalog_root,
            local_only=True,
            render_eda_plots=False,
            dry_run=False,
        )

    assert real_report["target_date"] == "2026-11-15"
    assert real_report["steps"]["ingest"]["status"] == "completed"
    assert real_report["steps"]["ingest"]["ingested"] == 2
    assert real_report["steps"]["eda"]["granules_analyzed"] == 2
    assert real_report["steps"]["eda"]["generated_figures"] == []
    assert real_report["steps"]["render"]["images_rendered"] == 4
    assert (eda_dir / "eda_summary_metrics.json").exists()
    assert not list(eda_dir.glob("*.png"))
    assert (out_dir / "manifest.json").exists()


def test_direct_route_handlers_health_locations_and_availability(tmp_path: Path) -> None:
    db_path = tmp_path / "routes_test.db"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    health = healthcheck()
    assert health["status"] == "healthy"
    assert health["dataset_loaded"] is True

    with TestingSession() as db:
        locs = list_locations(db=db)
        assert len(locs) >= 6
        assert any(loc.id == "hanoi" for loc in locs)

        avail = get_dataset_availability(dataset_id="geos-cf-v2-aqc", db=db)
        assert avail.datasetId == "geos-cf-v2-aqc"
        assert isinstance(avail.availableTimes, list)
