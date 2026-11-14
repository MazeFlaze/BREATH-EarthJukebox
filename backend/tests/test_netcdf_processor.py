import math
import numpy as np
import pandas as pd
import pytest
import xarray as xr
from pathlib import Path

try:
    from backend.src.processors.netcdf_processor import NetCDFProcessor
    from backend.src.processors.observation_normalizer import ObservationNormalizer
except ImportError:
    from src.processors.netcdf_processor import NetCDFProcessor
    from src.processors.observation_normalizer import ObservationNormalizer


@pytest.fixture
def synthetic_netcdf_path(tmp_path: Path) -> Path:
    """
    Creates a small synthetic NetCDF-4 dataset with:
    - 3 hourly timestamps
    - 5 latitudes [-90.0, -45.0, 0.0, 45.0, 90.0]
    - 5 longitudes [-180.0, -90.0, 0.0, 90.0, 180.0]
    - Variables: PM25_RH35 (with known values & 1e15 fill values), CO
    """
    times = pd.date_range("2026-11-13 00:30:00", periods=3, freq="1h")
    lats = np.array([-90.0, -45.0, 0.0, 45.0, 90.0], dtype=np.float32)
    lons = np.array([-180.0, -90.0, 0.0, 90.0, 180.0], dtype=np.float32)

    # Shape: (time=3, lat=5, lon=5)
    pm25_data = np.arange(3 * 5 * 5, dtype=np.float32).reshape((3, 5, 5)) + 10.0
    # Inject fill value (1e15) and NaN at specific indices
    pm25_data[0, 2, 2] = 1e15  # equator fill value
    pm25_data[1, 2, 2] = np.nan  # equator NaN

    co_data = np.full((3, 5, 5), 1.5e-7, dtype=np.float32)

    ds = xr.Dataset(
        data_vars={
            "PM25_RH35": (["time", "lat", "lon"], pm25_data, {"units": "ug m-3", "long_name": "PM2.5 Mass Conc"}),
            "CO": (["time", "lat", "lon"], co_data, {"units": "mol mol-1", "long_name": "Carbon Monoxide"}),
        },
        coords={
            "time": times,
            "lat": lats,
            "lon": lons,
        },
        attrs={
            "title": "Synthetic Test Atmosphere",
            "institution": "NASA Space Apps BREATHE Test Lab",
            "VersionID": "v2",
        }
    )

    file_path = tmp_path / "synthetic_test.nc4"
    ds.to_netcdf(file_path, engine="netcdf4")
    return file_path


def test_open_and_inspect_netcdf(synthetic_netcdf_path: Path):
    """Test 1 & 2: Local .nc4 can be opened and variables discovered."""
    info = NetCDFProcessor.inspect_file(synthetic_netcdf_path)
    assert info["title"] == "Synthetic Test Atmosphere"
    assert "PM25_RH35" in info["variables"]
    assert "CO" in info["variables"]
    assert info["variables"]["PM25_RH35"]["units"] == "ug m-3"
    assert len(info["times"]) == 3


def test_nearest_grid_cell_selection(synthetic_netcdf_path: Path):
    """Test 3: Correct geographic grid cell is selected."""
    with NetCDFProcessor.open_dataset(synthetic_netcdf_path) as ds:
        # Request (lat=43.0, lon=85.0) -> nearest is (lat=45.0, lon=90.0)
        res = NetCDFProcessor.extract_point_value(ds, "PM25_RH35", lat=43.0, lon=85.0, timestamp="2026-11-13T00:30:00Z")
        assert res["requested_coordinates"]["lat"] == 43.0
        assert res["requested_coordinates"]["lon"] == 85.0
        assert res["grid_coordinates"]["lat"] == 45.0
        assert res["grid_coordinates"]["lon"] == 90.0
        assert res["quality"] == "valid"
        assert res["value"] is not None


def test_longitude_wraparound():
    """Test 4: Longitude wraparound to [-180, 180) works correctly."""
    assert NetCDFProcessor.normalize_longitude(180.0) == -180.0
    assert NetCDFProcessor.normalize_longitude(190.0) == -170.0
    assert NetCDFProcessor.normalize_longitude(360.0) == 0.0
    assert NetCDFProcessor.normalize_longitude(-190.0) == 170.0
    assert NetCDFProcessor.normalize_longitude(105.85) == pytest.approx(105.85)


def test_different_coordinates_produce_different_values(synthetic_netcdf_path: Path):
    """Test 5: Different coordinates produce distinct values."""
    with NetCDFProcessor.open_dataset(synthetic_netcdf_path) as ds:
        res1 = NetCDFProcessor.extract_point_value(ds, "PM25_RH35", lat=-45.0, lon=-90.0, timestamp="2026-11-13T00:30:00Z")
        res2 = NetCDFProcessor.extract_point_value(ds, "PM25_RH35", lat=45.0, lon=90.0, timestamp="2026-11-13T00:30:00Z")
        assert res1["value"] != res2["value"]


def test_spatial_slice_preserves_order(synthetic_netcdf_path: Path):
    """Test 6 & 8: Spatial slice preserves requested order."""
    locs = [
        {"id": "loc_c", "lat": 45.0, "lon": 90.0},
        {"id": "loc_a", "lat": -45.0, "lon": -90.0},
        {"id": "loc_b", "lat": 0.0, "lon": 90.0},
    ]
    points = NetCDFProcessor.extract_spatial_slice(synthetic_netcdf_path, "PM25_RH35", locs, timestamp="2026-11-13T00:30:00Z")
    assert len(points) == 3
    assert [p["locationId"] for p in points] == ["loc_c", "loc_a", "loc_b"]
    assert [p["order"] for p in points] == [0, 1, 2]


def test_temporal_series_order_and_utc(synthetic_netcdf_path: Path):
    """Test 7 & 9: Temporal series returns ascending chronological UTC timestamps."""
    pts = NetCDFProcessor.extract_temporal_series([synthetic_netcdf_path], "PM25_RH35", lat=45.0, lon=90.0)
    assert len(pts) == 3
    timestamps = [p["timestamp"] for p in pts]
    assert timestamps == sorted(timestamps)
    for ts in timestamps:
        assert ts.endswith("Z")


def test_fill_and_nan_values_never_leak(synthetic_netcdf_path: Path):
    """Test 11 & 12: 1e15 fill values and NaN become None, never fake observations."""
    with NetCDFProcessor.open_dataset(synthetic_netcdf_path) as ds:
        # At (0.0, 0.0) time 0, we injected 1e15
        res_fill = NetCDFProcessor.extract_point_value(ds, "PM25_RH35", lat=0.0, lon=0.0, timestamp="2026-11-13T00:30:00Z")
        assert res_fill["value"] is None
        assert res_fill["quality"] == "missing"

        # At (0.0, 0.0) time 1, we injected NaN
        res_nan = NetCDFProcessor.extract_point_value(ds, "PM25_RH35", lat=0.0, lon=0.0, timestamp="2026-11-13T01:30:00Z")
        assert res_nan["value"] is None
        assert res_nan["quality"] == "missing"


def test_unknown_variable_rejected(synthetic_netcdf_path: Path):
    """Test 14: Requesting nonexistent variable raises KeyError."""
    with NetCDFProcessor.open_dataset(synthetic_netcdf_path) as ds:
        with pytest.raises(KeyError, match="Variable 'NON_EXISTENT' not found"):
            NetCDFProcessor.extract_point_value(ds, "NON_EXISTENT", lat=0.0, lon=0.0)


def test_invalid_coordinates_rejected():
    """Test 15: Invalid latitude bounds raise ValueError."""
    with pytest.raises(ValueError, match="Latitude 120.0 out of bounds"):
        NetCDFProcessor.validate_coordinates(120.0, 50.0)
    with pytest.raises(ValueError, match="Latitude -95.0 out of bounds"):
        NetCDFProcessor.validate_coordinates(-95.0, 50.0)


def test_observation_normalizer():
    """Test audio normalization mapping with WHO/EPA reference bounds."""
    # PM2.5 in [0, 250]
    assert ObservationNormalizer.normalize("PM25_RH35", 0.0) == 0.0
    assert ObservationNormalizer.normalize("PM25_RH35", 125.0) == 0.5
    assert ObservationNormalizer.normalize("PM25_RH35", 250.0) == 1.0
    # Clamping beyond 250:
    assert ObservationNormalizer.normalize("PM25_RH35", 350.0) == 1.0
    # None value returns None
    assert ObservationNormalizer.normalize("PM25_RH35", None) is None
    # Unknown variable without reference range returns None
    assert ObservationNormalizer.normalize("UNKNOWN_VAR", 50.0) is None


def test_observation_normalizer_log_scale_and_quantile_calibration():
    """Verify EDA-calibrated perceptual normalization (log_scale and O3 quantile_linear)."""
    # Boundary clamping at global [P01, P99]
    assert ObservationNormalizer.normalize("PM25_RH35", 4.03, method="log_scale") == 0.0
    assert ObservationNormalizer.normalize("PM25_RH35", 1.0, method="log_scale") == 0.0
    assert ObservationNormalizer.normalize("PM25_RH35", 71.05, method="log_scale") == 1.0
    assert ObservationNormalizer.normalize("PM25_RH35", 200.0, method="log_scale") == 1.0

    # Perceptual expansion at global median (P50) vs compressed linear fixed bounds
    for var, p50_val in [
        ("PM25_RH35", 7.63),
        ("CO", 9.45e-8),
        ("NO2", 3.26e-10),
        ("SO2", 2.50e-10),
    ]:
        linear_score = ObservationNormalizer.normalize(var, p50_val)
        log_score = ObservationNormalizer.normalize(var, p50_val, method="log_scale")
        flag_score = ObservationNormalizer.normalize(var, p50_val, log_scale=True)
        assert linear_score is not None and log_score is not None
        assert log_score == flag_score
        assert log_score > linear_score * 2.5
        assert 0.12 <= log_score <= 0.45

    # Verify unit invariance for NO2 between mol mol-1 and ppbv formulation
    p01_ppb, p50_ppb, p99_ppb = 0.111, 0.326, 20.8
    test_val_mol = 2.0e-9  # 2.0 ppbv
    expected_log = round(
        math.log1p((2.0 - p01_ppb) / (p50_ppb - p01_ppb))
        / math.log1p((p99_ppb - p01_ppb) / (p50_ppb - p01_ppb)),
        4,
    )
    assert ObservationNormalizer.normalize("NO2", test_val_mol, method="log_scale") == expected_log

    # Symmetric O3 uses calibrated quantile_linear [1.95e-8, 4.26e-8]
    assert ObservationNormalizer.normalize("O3", 1.95e-8, method="log_scale") == 0.0
    assert ObservationNormalizer.normalize("O3", 3.105e-8, method="log_scale") == 0.5
    assert ObservationNormalizer.normalize("O3", 4.26e-8, method="log_scale") == 1.0

    # Non-finite values and unknown method guards
    assert ObservationNormalizer.normalize("NO2", float("nan"), method="log_scale") is None
    assert ObservationNormalizer.normalize("NO2", float("inf"), method="log_scale") is None
    with pytest.raises(ValueError, match="Unsupported normalization method"):
        ObservationNormalizer.normalize("NO2", 1e-9, method="unknown_mode")


def test_observation_normalizer_to_display_unit():
    """Verify mol mol-1 to ppbv conversion while retaining raw unit provenance."""
    no2_conv = ObservationNormalizer.to_display_unit("NO2", 3.26e-10)
    assert no2_conv.raw_value == pytest.approx(3.26e-10)
    assert no2_conv.raw_unit == "mol mol-1"
    assert no2_conv.display_value == pytest.approx(0.326)
    assert no2_conv.display_unit == "ppbv"
    assert no2_conv.conversion_factor == 1.0e9

    co_conv = ObservationNormalizer.to_display_unit("CO", 9.45e-8, raw_unit="mol mol-1")
    assert co_conv.display_value == pytest.approx(94.5)
    assert co_conv.display_unit == "ppbv"
    assert co_conv.raw_unit == "mol mol-1"

    pm_conv = ObservationNormalizer.to_display_unit("PM25_RH35", 42.5)
    assert pm_conv.raw_value == pytest.approx(42.5)
    assert pm_conv.raw_unit == "ug m-3"
    assert pm_conv.display_value == pytest.approx(42.5)
    assert pm_conv.display_unit == "µg/m³"
    assert pm_conv.conversion_factor == 1.0

    aod_conv = ObservationNormalizer.to_display_unit("AOD", 0.35)
    assert aod_conv.display_unit == "dimensionless"
    assert aod_conv.raw_unit == "dimensionless"

    missing_conv = ObservationNormalizer.to_display_unit("SO2", None)
    assert missing_conv.raw_value is None
    assert missing_conv.display_value is None
    assert missing_conv.display_unit == "ppbv"


@pytest.fixture
def roi_dataset() -> xr.Dataset:
    """Builds a 0.5-deg synthetic grid for ROI spatial aggregation and edge-case tests."""
    times = pd.date_range("2026-11-13 01:30:00", periods=1, freq="1h")
    lats = np.array([20.0, 20.5, 21.0, 21.5, 22.0], dtype=np.float32)
    lons = np.array([-179.5, 104.5, 105.0, 105.5, 106.0, 179.5], dtype=np.float32)

    # Monotonic coordinates with controllable 5x6 PM2.5 + CO grid
    grid_pm25 = np.full((1, 1, 5, 6), 10.0, dtype=np.float64)
    # Within lat [20.5, 21.5] (idx 1..3) and lon [105.0, 106.0] (idx 2..4) -> 9 cells total:
    # 7 valid cells across Low (<15), Moderate [15,35), High (>=35), plus 1 fill (1e15) & 1 NaN
    roi_patch = np.array([
        [5.0, 10.0, 20.0],     # 2 low, 1 moderate
        [25.0, 40.0, 1e15],    # 1 moderate, 1 high, 1 fill
        [50.0, 80.0, np.nan],  # 2 high, 1 NaN
    ], dtype=np.float64)
    grid_pm25[0, 0, 1:4, 2:5] = roi_patch

    # Antimeridian all-missing region at lons [-179.5, 179.5] (indices 0 and 5)
    grid_pm25[0, 0, :, 0] = 1e15
    grid_pm25[0, 0, :, 5] = 1e15
    grid_pm25[0, 0, 0, 5] = np.nan

    grid_co = np.full((1, 1, 5, 6), 1.5e-7, dtype=np.float64)

    return xr.Dataset(
        data_vars={
            "PM25_RH35": (["time", "lev", "lat", "lon"], grid_pm25, {"units": "ug m-3"}),
            "CO": (["time", "lev", "lat", "lon"], grid_co, {"units": "mol mol-1"}),
        },
        coords={"time": times, "lev": [1.0], "lat": lats, "lon": lons},
    )


def test_extract_region_summary_and_fill_exclusion(roi_dataset: xr.Dataset):
    """Verify ROI aggregation calculates mean, p90, max, counts, and tier ratios excluding fill/NaN."""
    summary = NetCDFProcessor.extract_region_summary(
        roi_dataset,
        variable="PM25_RH35",
        lat=21.0,
        lon=105.5,
        delta_deg=0.5,
        timestamp="2026-11-13T01:30:00Z",
    )

    valid_expected = np.array([5.0, 10.0, 20.0, 25.0, 40.0, 50.0, 80.0])
    assert summary["raw_unit"] == "ug m-3"
    assert summary["snapped_to_nearest"] is False
    assert summary["valid_count"] == 7
    assert summary["missing_count"] == 2
    assert summary["total_count"] == 9
    assert summary["mean"] == pytest.approx(float(np.mean(valid_expected)))
    assert summary["p90"] == pytest.approx(float(np.percentile(valid_expected, 90)))
    assert summary["max"] == pytest.approx(80.0)

    tiers = summary["tier_ratios"]
    assert tiers["low"] == pytest.approx(2 / 7, abs=1e-4)
    assert tiers["moderate"] == pytest.approx(2 / 7, abs=1e-4)
    assert tiers["high"] == pytest.approx(3 / 7, abs=1e-4)
    assert sum(tiers.values()) == pytest.approx(1.0)


def test_extract_bbox_summary_drag_box_and_edge_cases(roi_dataset: xr.Dataset):
    """Verify arbitrary drag-box bounds, tiny boxes (< grid step), antimeridian missing ROIs, and guards."""
    # Asymmetric rectangular drag-box covering lat [20.5, 21.0] x lon [105.0, 106.0]
    rect_summary = NetCDFProcessor.extract_bbox_summary(
        roi_dataset, "PM25_RH35", lat_min=20.5, lat_max=21.0, lon_min=105.0, lon_max=106.0
    )
    rect_valid = np.array([5.0, 10.0, 20.0, 25.0, 40.0])
    assert rect_summary["valid_count"] == 5
    assert rect_summary["missing_count"] == 1
    assert rect_summary["mean"] == pytest.approx(float(np.mean(rect_valid)))

    # Sub-grid drag box falling strictly between grid lines -> snaps cleanly to nearest cell (21.0, 105.0)
    tiny_summary = NetCDFProcessor.extract_bbox_summary(
        roi_dataset, "PM25_RH35", lat_min=20.8, lat_max=20.9, lon_min=104.8, lon_max=104.9
    )
    assert tiny_summary["snapped_to_nearest"] is True
    assert tiny_summary["valid_count"] == 1
    assert tiny_summary["mean"] == pytest.approx(25.0)

    # All-fill / NaN ROI crossing antimeridian (179.0 to 181.0 -> includes 179.5 & -179.5)
    empty_roi = NetCDFProcessor.extract_bbox_summary(
        roi_dataset, "PM25_RH35", lat_min=20.0, lat_max=20.5, lon_min=179.0, lon_max=181.0
    )
    assert empty_roi["valid_count"] == 0
    assert empty_roi["missing_count"] == 4
    assert empty_roi["mean"] is None
    assert empty_roi["p90"] is None
    assert empty_roi["max"] is None
    assert empty_roi["tier_ratios"] == {"low": 0.0, "moderate": 0.0, "high": 0.0}

    # Validation guards
    with pytest.raises(KeyError, match="NO_SUCH_VAR"):
        NetCDFProcessor.extract_region_summary(roi_dataset, "NO_SUCH_VAR", lat=21.0, lon=105.5)
    with pytest.raises(ValueError, match="delta_deg"):
        NetCDFProcessor.extract_region_summary(roi_dataset, "PM25_RH35", lat=21.0, lon=105.5, delta_deg=-0.5)
    with pytest.raises(ValueError, match="Invalid latitude bounds"):
        NetCDFProcessor.extract_bbox_summary(roi_dataset, "PM25_RH35", lat_min=22.0, lat_max=20.0, lon_min=105.0, lon_max=106.0)
