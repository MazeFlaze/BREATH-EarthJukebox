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
