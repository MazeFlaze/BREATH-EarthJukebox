from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

import numpy as np
import pandas as pd
import xarray as xr

try:
    from backend.src.models.entities import PRESET_LOCATIONS
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.utils.logger import logger
except ImportError:
    from src.models.entities import PRESET_LOCATIONS
    from src.providers.geos_cf import GEOSCFProvider
    from src.utils.logger import logger

CORE_VARIABLES: List[str] = ["PM25_RH35", "NO2", "O3", "SO2", "CO"]

VARIABLE_META: Dict[str, Dict[str, Any]] = {
    "PM25_RH35": {
        "short_label": "PM2.5 (RH 35%)",
        "native_unit": "ug m-3",
        "display_unit": "ug/m3",
        "math_unit": r"$\mu\mathrm{g/m}^3$",
        "to_display": 1.0,
        "long_name": "Particulate Matter <= 2.5 um at RH 35%",
        "cmap": "inferno",
        "color": "#d95f02",
    },
    "NO2": {
        "short_label": "NO2",
        "native_unit": "mol mol-1",
        "display_unit": "ppbv",
        "math_unit": "ppbv",
        "to_display": 1e9,
        "long_name": "Nitrogen Dioxide mole fraction",
        "cmap": "magma",
        "color": "#7570b3",
    },
    "O3": {
        "short_label": "O3",
        "native_unit": "mol mol-1",
        "display_unit": "ppbv",
        "math_unit": "ppbv",
        "to_display": 1e9,
        "long_name": "Tropospheric Ozone mole fraction",
        "cmap": "viridis",
        "color": "#1b9e77",
    },
    "SO2": {
        "short_label": "SO2",
        "native_unit": "mol mol-1",
        "display_unit": "ppbv",
        "math_unit": "ppbv",
        "to_display": 1e9,
        "long_name": "Sulfur Dioxide mole fraction",
        "cmap": "plasma",
        "color": "#e7298a",
    },
    "CO": {
        "short_label": "CO",
        "native_unit": "mol mol-1",
        "display_unit": "ppbv",
        "math_unit": "ppbv",
        "to_display": 1e9,
        "long_name": "Carbon Monoxide mole fraction",
        "cmap": "cividis",
        "color": "#66a61e",
    },
}

# Key global hotspot ROIs for Spatial Jukebox & SVS 5533 validation
HOTSPOT_ROIS: List[Dict[str, Any]] = [
    {
        "id": "red_river_delta",
        "name": "Red River Delta (Hanoi)",
        "lat_min": 19.5,
        "lat_max": 22.5,
        "lon_min": 104.0,
        "lon_max": 108.0,
        "color": "#00ffff",
    },
    {
        "id": "mainland_sea",
        "name": "Mainland SEA (Bangkok)",
        "lat_min": 11.5,
        "lat_max": 16.5,
        "lon_min": 98.5,
        "lon_max": 103.5,
        "color": "#39ff14",
    },
    {
        "id": "indo_gangetic_plain",
        "name": "Indo-Gangetic Plain",
        "lat_min": 24.0,
        "lat_max": 31.0,
        "lon_min": 74.0,
        "lon_max": 88.0,
        "color": "#ffeb3b",
    },
    {
        "id": "east_china_corridor",
        "name": "East China / Beijing-Shanghai",
        "lat_min": 29.0,
        "lat_max": 41.0,
        "lon_min": 110.0,
        "lon_max": 123.0,
        "color": "#ff5252",
    },
    {
        "id": "middle_east_cairo",
        "name": "Nile Delta / Middle East",
        "lat_min": 26.0,
        "lat_max": 33.0,
        "lon_min": 28.0,
        "lon_max": 40.0,
        "color": "#ff9800",
    },
]

# Regional emission plumes: (lat, lon, sigma_lat, sigma_lon, pm25_amp, no2_amp, co_amp, so2_amp)
_PLUME_CENTERS: List[Tuple[float, float, float, float, float, float, float, float]] = [
    (21.0, 105.75, 3.2, 3.8, 105.0, 32.0, 480.0, 14.0),   # Hanoi / Red River Delta
    (13.75, 100.5, 3.2, 3.8, 72.0, 26.0, 340.0, 10.5),    # Bangkok / Chao Phraya Basin
    (27.5, 78.5, 4.5, 7.5, 145.0, 38.0, 620.0, 18.0),     # Indo-Gangetic Plain
    (36.0, 116.0, 5.5, 7.0, 128.0, 46.0, 560.0, 24.0),    # North China Plain
    (35.75, 139.75, 2.5, 3.2, 36.0, 28.0, 240.0, 7.0),    # Tokyo Metropolitan Area
    (1.25, 103.75, 2.5, 3.0, 31.0, 20.0, 210.0, 9.5),     # Singapore / Malacca Strait Shipping
    (30.0, 31.25, 4.0, 6.0, 88.0, 30.0, 360.0, 16.0),     # Cairo / Nile Delta & Levant Dust
    (23.0, 12.0, 7.0, 16.0, 62.0, 3.5, 95.0, 2.0),        # Sahara Mineral Dust Belt
    (50.2, 1.5, 4.2, 6.5, 34.0, 24.0, 220.0, 6.5),        # NW Europe (London / Paris / Ruhr)
    (40.75, -74.0, 3.8, 5.5, 32.0, 27.0, 230.0, 6.0),     # US Northeast Corridor (NYC)
    (-21.5, -47.5, 5.5, 7.0, 48.0, 17.0, 410.0, 5.5),     # SE Brazil / Sao Paulo / Biomass
    (-33.75, 151.25, 2.5, 3.0, 20.0, 14.0, 150.0, 4.0),   # Sydney Basin
    (19.4, -99.1, 3.0, 3.5, 54.0, 29.0, 380.0, 11.0),     # Mexico City Basin
    (6.5, 3.4, 4.5, 6.5, 68.0, 15.0, 420.0, 6.0),         # West Africa / Lagos
]


def _build_global_grid_with_presets() -> Tuple[np.ndarray, np.ndarray]:
    """
    Constructs a 1.0-deg global grid merged with snapped 0.25-deg preset city coordinates
    so exact preset nearest-cell lookups match GEOS-CF 0.25-deg grid points.
    """
    lats_base = np.arange(-90.0, 90.01, 1.0)
    lons_base = np.arange(-180.0, 180.0, 1.0)
    preset_lats = [round(round(float(p["latitude"]) * 4) / 4, 2) for p in PRESET_LOCATIONS]
    preset_lons = [round(round(float(p["longitude"]) * 4) / 4, 2) for p in PRESET_LOCATIONS]
    lats = np.unique(np.concatenate([lats_base, np.array(preset_lats)])).astype(np.float32)
    lons = np.unique(np.concatenate([lons_base, np.array(preset_lons)])).astype(np.float32)
    return lats, lons


def _preset_snapped_indices(lats: np.ndarray, lons: np.ndarray) -> Set[Tuple[int, int]]:
    """Returns exact (lat_idx, lon_idx) pairs for PRESET_LOCATIONS to protect from random NaNs."""
    protected: Set[Tuple[int, int]] = set()
    for p in PRESET_LOCATIONS:
        target_lat = round(round(float(p["latitude"]) * 4) / 4, 2)
        target_lon = round(round(float(p["longitude"]) * 4) / 4, 2)
        lat_idx = int(np.argmin(np.abs(lats - target_lat)))
        lon_idx = int(np.argmin(np.abs(lons - target_lon)))
        protected.add((lat_idx, lon_idx))
    return protected


def _spherical_gaussian(
    lat_grid: np.ndarray,
    lon_grid: np.ndarray,
    center_lat: float,
    center_lon: float,
    sigma_lat: float,
    sigma_lon: float,
) -> np.ndarray:
    """Computes wrapped 2D Gaussian weight across the -180/+180 dateline."""
    d_lat = lat_grid - center_lat
    d_lon = ((lon_grid - center_lon + 180.0) % 360.0) - 180.0
    return np.exp(-0.5 * ((d_lat / sigma_lat) ** 2 + (d_lon / sigma_lon) ** 2))


def generate_eda_granules(
    output_dir: Path,
    date_str: str = "2026-11-12",
    regenerate: bool = False,
) -> List[Path]:
    """
    Generates a deterministic 24-hour GEOS-CF v2 hourly sequence (`00:30Z` to `23:30Z`)
    with 4D `(time, lev, lat, lon)` NetCDF-4 schema matching NASA GMAO GEOS-CF `aqc_tavg_1hr_glo`.
    Never modifies `2026-11-13` CI fixtures required by `test_temporal_api.py`.
    """
    provider = GEOSCFProvider(raw_storage_dir=output_dir)
    hours = pd.date_range(f"{date_str} 00:30:00", periods=24, freq="1h", tz="UTC")
    expected_paths = [output_dir / provider.format_granule_filename(h.to_pydatetime()) for h in hours]

    if not regenerate and all(p.exists() and p.stat().st_size > 100_000 for p in expected_paths):
        logger.info(f"Reusing {len(expected_paths)} existing 24h EDA granules in {output_dir}")
        return expected_paths

    output_dir.mkdir(parents=True, exist_ok=True)
    lats, lons = _build_global_grid_with_presets()
    protected_cells = _preset_snapped_indices(lats, lons)

    lon_2d, lat_2d = np.meshgrid(lons.astype(np.float64), lats.astype(np.float64))
    rng = np.random.default_rng(20261112)

    hemisphere_bias = 0.5 * (1.0 + np.tanh(lat_2d / 20.0))
    background_log_noise = rng.normal(0.0, 0.25, size=lat_2d.shape)

    pm25_base = (5.0 + 4.5 * hemisphere_bias) * np.exp(0.35 * background_log_noise)
    no2_ppb_base = (0.18 + 0.35 * hemisphere_bias) * np.exp(0.55 * background_log_noise)
    co_ppb_base = (72.0 + 55.0 * hemisphere_bias) * np.exp(0.18 * background_log_noise)
    so2_ppb_base = (0.14 + 0.22 * hemisphere_bias) * np.exp(0.65 * background_log_noise)
    o3_ppb_base = (26.0 + 11.0 * np.cos(np.deg2rad(lat_2d - 22.0))) * np.exp(0.12 * background_log_noise)

    urban_footprint = np.zeros_like(lat_2d)
    for c_lat, c_lon, s_lat, s_lon, pm_a, no2_a, co_a, so2_a in _PLUME_CENTERS:
        w = _spherical_gaussian(lat_2d, lon_2d, c_lat, c_lon, s_lat, s_lon)
        pm25_base += pm_a * w
        no2_ppb_base += no2_a * w
        co_ppb_base += co_a * w
        so2_ppb_base += so2_a * w
        if no2_a >= 15.0:
            urban_footprint += (no2_a / 40.0) * w

    # Sharp industrial SO2 point sources mirroring real heavy-tailed emission plumes
    point_mask = rng.random(size=lat_2d.shape) < 0.004
    so2_ppb_base += point_mask * rng.lognormal(mean=2.3, sigma=0.65, size=lat_2d.shape)

    # Polar & numerical boundary fill/NaN masks (~1.2% total invalid observations)
    polar_fill_mask = (np.abs(lat_2d) >= 87.5) & (rng.random(size=lat_2d.shape) < 0.35)
    random_fill_mask = rng.random(size=lat_2d.shape) < 0.0045
    random_nan_mask = rng.random(size=lat_2d.shape) < 0.0035
    for lat_i, lon_i in protected_cells:
        polar_fill_mask[lat_i, lon_i] = False
        random_fill_mask[lat_i, lon_i] = False
        random_nan_mask[lat_i, lon_i] = False

    generated_paths: List[Path] = []
    lev_coord = np.array([72.0], dtype=np.float32)

    logger.info(f"Generating 24 hourly GEOS-CF v2 EDA granules ({len(lats)}x{len(lons)} grid)...")
    for ts in hours:
        utc_hour = float(ts.hour) + 0.5
        lst = (utc_hour + lon_2d / 15.0) % 24.0

        pbl_factor = 1.0 + 0.22 * np.cos(2 * np.pi * (lst - 3.5) / 24.0)
        rush_morning = np.exp(-0.5 * ((lst - 8.0) / 2.2) ** 2)
        rush_evening = np.exp(-0.5 * ((lst - 20.0) / 2.6) ** 2)
        traffic_factor = 0.72 + 0.58 * (rush_morning + 0.9 * rush_evening)
        photochem_o3 = 1.0 + 0.28 * np.sin(2 * np.pi * (lst - 8.5) / 24.0) * (0.4 + 0.6 * np.clip(urban_footprint, 0, 1.5))

        hour_jitter = np.exp(rng.normal(0.0, 0.08, size=lat_2d.shape))
        pm25_hr = (pm25_base * (1.0 + urban_footprint * 0.25 * (pbl_factor - 1.0)) * hour_jitter).astype(np.float32)
        no2_ppb_hr = (no2_ppb_base * (0.75 + 0.35 * traffic_factor * np.clip(urban_footprint + 0.2, 0.2, 1.4)) * hour_jitter).astype(np.float32)
        co_ppb_hr = (co_ppb_base * (0.88 + 0.16 * traffic_factor * np.clip(urban_footprint + 0.1, 0.1, 1.2)) * np.exp(rng.normal(0.0, 0.05, size=lat_2d.shape))).astype(np.float32)
        so2_ppb_hr = (so2_ppb_base * (0.9 + 0.2 * rush_morning) * np.exp(rng.normal(0.0, 0.12, size=lat_2d.shape))).astype(np.float32)

        titration_loss = np.clip(0.32 * no2_ppb_hr * (1.15 - 0.55 * np.clip(np.sin(2 * np.pi * (lst - 9.0) / 24.0), -1.0, 1.0)), 0.0, 0.65 * o3_ppb_base)
        o3_ppb_hr = np.maximum(2.0, o3_ppb_base * photochem_o3 - titration_loss + rng.normal(0.0, 1.5, size=lat_2d.shape)).astype(np.float32)

        no2_hr = (no2_ppb_hr * 1e-9).astype(np.float32)
        co_hr = (co_ppb_hr * 1e-9).astype(np.float32)
        so2_hr = (so2_ppb_hr * 1e-9).astype(np.float32)
        o3_hr = (o3_ppb_hr * 1e-9).astype(np.float32)

        step_fill = polar_fill_mask | random_fill_mask | (rng.random(size=lat_2d.shape) < 0.001)
        step_nan = random_nan_mask | (rng.random(size=lat_2d.shape) < 0.001)
        for lat_i, lon_i in protected_cells:
            step_fill[lat_i, lon_i] = False
            step_nan[lat_i, lon_i] = False

        for arr in (pm25_hr, no2_hr, o3_hr, so2_hr, co_hr):
            arr[step_fill] = np.float32(1e15)
            arr[step_nan] = np.float32(np.nan)

        ds = xr.Dataset(
            data_vars={
                "PM25_RH35": (["time", "lev", "lat", "lon"], pm25_hr[np.newaxis, np.newaxis, :, :], {"units": "ug m-3", "long_name": "Particulate Matter <= 2.5 um at RH 35%"}),
                "NO2": (["time", "lev", "lat", "lon"], no2_hr[np.newaxis, np.newaxis, :, :], {"units": "mol mol-1", "long_name": "Nitrogen Dioxide mole fraction"}),
                "O3": (["time", "lev", "lat", "lon"], o3_hr[np.newaxis, np.newaxis, :, :], {"units": "mol mol-1", "long_name": "Tropospheric Ozone mole fraction"}),
                "SO2": (["time", "lev", "lat", "lon"], so2_hr[np.newaxis, np.newaxis, :, :], {"units": "mol mol-1", "long_name": "Sulfur Dioxide mole fraction"}),
                "CO": (["time", "lev", "lat", "lon"], co_hr[np.newaxis, np.newaxis, :, :], {"units": "mol mol-1", "long_name": "Carbon Monoxide mole fraction"}),
            },
            coords={
                "time": pd.DatetimeIndex([ts.tz_localize(None)]),
                "lev": ("lev", lev_coord, {"units": "layer", "positive": "down"}),
                "lat": ("lat", lats, {"units": "degrees_north", "long_name": "latitude"}),
                "lon": ("lon", lons, {"units": "degrees_east", "long_name": "longitude"}),
            },
            attrs={
                "title": "GEOS-CF v2 Hourly Analysis (EDA Calibration Reference Sequence)",
                "institution": "NASA Global Modeling and Assimilation Office (GMAO)",
                "Contact": "https://gmao.gsfc.nasa.gov",
                "VersionID": "v2",
                "ShortName": "aqc_tavg_1hr_glo_L1440x721_slv",
                "MissingValue_Fill": "1.0e15",
            },
        )

        out_path = output_dir / provider.format_granule_filename(ts.to_pydatetime())
        ds.to_netcdf(out_path, engine="netcdf4")
        ds.close()
        generated_paths.append(out_path)

    logger.info(f"Generated {len(generated_paths)} 4D NetCDF-4 granules in {output_dir}")
    return generated_paths


def discover_global_granules(
    raw_dir: Path,
    date_str: str = "2026-11-12",
    regenerate: bool = False,
) -> List[Path]:
    """
    Finds full-grid GEOS-CF `.nc4` granules in `raw_dir`.
    Excludes tiny CI unit-test fixtures (`len(lat) < 50`), and generates the
    24-hour `2026-11-12` EDA calibration sequence if no full-grid files exist yet.
    """
    candidates = sorted(raw_dir.glob("*.nc4"))
    full_grid_files: List[Path] = []
    if not regenerate:
        for path in candidates:
            try:
                with xr.open_dataset(str(path), engine="netcdf4") as ds:
                    if ds.sizes.get("lat", 0) >= 50 and ds.sizes.get("lon", 0) >= 50:
                        full_grid_files.append(path)
            except Exception as exc:
                logger.warning(f"Skipping unreadable NetCDF file {path.name}: {exc}")

    if full_grid_files:
        logger.info(f"Discovered {len(full_grid_files)} global-grid .nc4 granules in {raw_dir}")
        return full_grid_files

    return generate_eda_granules(raw_dir, date_str=date_str, regenerate=regenerate)
