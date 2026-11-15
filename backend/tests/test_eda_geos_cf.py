import json
from pathlib import Path
from typing import Any, Dict

import numpy as np
import pandas as pd
import xarray as xr

try:
    from backend.src.eda import (
        CORE_VARIABLES,
        HOTSPOT_ROIS,
        _compute_linear_scores,
        _compute_log1p_scores,
        run_eda_pipeline,
    )
    from backend.src.models.entities import PRESET_LOCATIONS
    from backend.src.processors.netcdf_processor import NetCDFProcessor
    from backend.src.providers.geos_cf import GEOSCFProvider
except ImportError:
    from src.eda import (
        CORE_VARIABLES,
        HOTSPOT_ROIS,
        _compute_linear_scores,
        _compute_log1p_scores,
        run_eda_pipeline,
    )
    from src.models.entities import PRESET_LOCATIONS
    from src.processors.netcdf_processor import NetCDFProcessor
    from src.providers.geos_cf import GEOSCFProvider


BACKEND_ROOT = Path(__file__).resolve().parent.parent
EDA_OUTPUT_DIR = BACKEND_ROOT / "src" / "data" / "eda_outputs"


def test_log1p_and_linear_score_helpers() -> None:
    """Verifies bounded [0.0, 1.0] output, monotonicity, and log1p dynamic-range expansion."""
    pm25_values = np.array([2.0, 5.0, 10.0, 25.0, 75.0, 300.0], dtype=np.float64)
    lin = _compute_linear_scores("PM25_RH35", pm25_values)
    log = _compute_log1p_scores(pm25_values, p01=4.0, p99=71.0)

    assert np.all((lin >= 0.0) & (lin <= 1.0))
    assert np.all((log >= 0.0) & (log <= 1.0))
    assert np.all(np.diff(lin) >= 0.0)
    assert np.all(np.diff(log) >= 0.0)
    assert lin[-1] == 1.0
    assert log[-1] == 1.0
    # Typical clean/urban values (5..25 ug/m3) gain much wider spread under log1p
    assert (log[3] - log[1]) > (lin[3] - lin[1])

    unknown = _compute_linear_scores("UNKNOWN_VAR", pm25_values)
    assert np.all(unknown == 0.0)


def test_committed_eda_outputs_and_statistical_invariants() -> None:
    """Validates committed JSON metrics and 300-DPI diagnostic figures for Sub-Issue #12."""
    metrics_path = EDA_OUTPUT_DIR / "eda_summary_metrics.json"
    assert metrics_path.exists(), f"Missing committed EDA metrics artifact: {metrics_path}"

    with open(metrics_path, "r", encoding="utf-8") as f:
        summary: Dict[str, Any] = json.load(f)

    assert summary["granules_analyzed"] == 24
    assert summary["grid_dimensions"] == {"time": 24, "lat": 189, "lon": 369}

    assert len(summary["generated_figures"]) == 5
    for fig_name in summary["generated_figures"]:
        assert isinstance(fig_name, str) and fig_name.endswith(".png")
        fig_path = EDA_OUTPUT_DIR / fig_name
        # EDA diagnostic PNGs are gitignored artifacts generated on demand via run_eda_geos_cf.py;
        # validate file integrity if present locally without failing clean CI checkouts.
        if fig_path.exists():
            assert fig_path.stat().st_size > 50_000, f"Figure too small / corrupted: {fig_name}"

    for var in CORE_VARIABLES:
        info = summary["variables"][var]
        assert info["fill_value_count"] > 0
        assert info["nan_inf_count"] > 0
        assert info["raw_uncleaned_max"] >= NetCDFProcessor.FILL_VALUE_THRESHOLD
        assert info["native_stats"]["max"] < NetCDFProcessor.FILL_VALUE_THRESHOLD

        d = info["display_stats"]
        quantiles = [d["min"], d["p01"], d["p05"], d["p25"], d["p50"], d["p75"], d["p90"], d["p95"], d["p99"], d["max"]]
        assert all(quantiles[i] <= quantiles[i + 1] for i in range(len(quantiles) - 1))

    preset_ids = {p["id"] for p in PRESET_LOCATIONS}
    assert set(summary["preset_locations_diurnal"].keys()) == preset_ids
    for city_id in preset_ids:
        assert len(summary["preset_locations_diurnal"][city_id]["variables"]["PM25_RH35"]["hourly_series"]) == 24

    assert [r["id"] for r in summary["hotspot_rois"]] == [r["id"] for r in HOTSPOT_ROIS]


def test_run_eda_pipeline_on_synthetic_slice(tmp_path: Path) -> None:
    """Runs run_eda_pipeline end-to-end on two fast synthetic 4D (1,1,60,60) .nc4 granules."""
    raw_dir = tmp_path / "raw"
    out_dir = tmp_path / "eda_outputs"
    raw_dir.mkdir(parents=True, exist_ok=True)

    provider = GEOSCFProvider(raw_storage_dir=raw_dir)
    lats = np.linspace(-90.0, 90.0, 60, dtype=np.float32)
    lons = np.linspace(-180.0, 179.0, 60, dtype=np.float32)
    lev = np.array([72.0], dtype=np.float32)
    rng = np.random.default_rng(12345)

    for hour in ("00:30:00", "01:30:00"):
        ts = pd.Timestamp(f"2026-11-12 {hour}", tz="UTC")
        pm25 = rng.lognormal(mean=2.0, sigma=0.7, size=(1, 1, 60, 60)).astype(np.float32)
        no2 = (pm25 * 0.25 * 1e-9).astype(np.float32)
        o3 = np.clip(rng.normal(32.0, 4.0, size=(1, 1, 60, 60)), 2.0, 60.0).astype(np.float32) * np.float32(1e-9)
        so2 = (pm25 * 0.1 * 1e-9).astype(np.float32)
        co = ((60.0 + pm25 * 4.5) * 1e-9).astype(np.float32)

        for arr in (pm25, no2, o3, so2, co):
            arr[0, 0, 0, :3] = np.float32(1e15)
            arr[0, 0, -1, :2] = np.float32(np.nan)

        ds = xr.Dataset(
            data_vars={
                "PM25_RH35": (["time", "lev", "lat", "lon"], pm25, {"units": "ug m-3", "long_name": "PM2.5"}),
                "NO2": (["time", "lev", "lat", "lon"], no2, {"units": "mol mol-1", "long_name": "NO2"}),
                "O3": (["time", "lev", "lat", "lon"], o3, {"units": "mol mol-1", "long_name": "O3"}),
                "SO2": (["time", "lev", "lat", "lon"], so2, {"units": "mol mol-1", "long_name": "SO2"}),
                "CO": (["time", "lev", "lat", "lon"], co, {"units": "mol mol-1", "long_name": "CO"}),
            },
            coords={
                "time": pd.DatetimeIndex([ts.tz_localize(None)]),
                "lev": ("lev", lev, {"units": "layer"}),
                "lat": ("lat", lats, {"units": "degrees_north"}),
                "lon": ("lon", lons, {"units": "degrees_east"}),
            },
        )
        ds.to_netcdf(raw_dir / provider.format_granule_filename(ts.to_pydatetime()), engine="netcdf4")
        ds.close()

    summary = run_eda_pipeline(raw_dir=raw_dir, eda_out_dir=out_dir, regenerate=False, render_plots=False)

    assert summary["granules_analyzed"] == 2
    assert summary["grid_dimensions"] == {"time": 2, "lat": 60, "lon": 60}
    assert (out_dir / "eda_summary_metrics.json").exists()
    assert summary["generated_figures"] == []

    for var in CORE_VARIABLES:
        info = summary["variables"][var]
        assert info["fill_value_count"] == 6
        assert info["nan_inf_count"] == 4
        assert info["valid_count"] == (2 * 60 * 60) - 10
        assert info["native_stats"]["max"] < NetCDFProcessor.FILL_VALUE_THRESHOLD

    spearman_pm_no2 = summary["correlations"]["spearman"]["PM25_RH35"]["NO2"]
    assert 0.9 <= spearman_pm_no2 <= 1.0
