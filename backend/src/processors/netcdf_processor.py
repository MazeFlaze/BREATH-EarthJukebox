import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Union
import numpy as np
import pandas as pd
import xarray as xr

from ..utils.logger import logger


class NetCDFProcessor:
    """
    Scientific processing engine for NASA NetCDF4 atmospheric datasets (e.g., GMAO GEOS-CF).
    Decodes coordinates, standardizes UTC timestamps, resolves nearest grid cells,
    and safeguards scientific units and quality flags.
    """

    FILL_VALUE_THRESHOLD = 1e14  # NASA GEOS-CF uses 1e15 for missing values

    # Concentration tier thresholds (moderate_min, high_min) in native GEOS-CF science units
    # Aligned with WHO air quality guidelines (PM2.5/PM10) and GEOS-CF EDA scales (trace gases)
    CONCENTRATION_TIER_THRESHOLDS: Dict[str, Tuple[float, float]] = {
        "PM25_RH35": (15.0, 35.0),        # µg/m³ (WHO 24h AQG / IT-3)
        "PM10_RH35": (45.0, 100.0),       # µg/m³ (WHO 24h AQG / IT-2)
        "CO": (1.0e-7, 3.0e-7),           # 100 ppbv / 300 ppbv in mol mol-1
        "NO2": (2.0e-9, 1.5e-8),          # 2 ppbv / 15 ppbv in mol mol-1
        "O3": (3.0e-8, 4.0e-8),           # 30 ppbv / 40 ppbv in mol mol-1
        "SO2": (1.0e-9, 5.0e-9),          # 1 ppbv / 5 ppbv in mol mol-1
    }

    @staticmethod
    def normalize_longitude(lon: float) -> float:
        """
        Normalizes longitude to the standard [-180.0, 180.0) range.
        Handles wraparound for coordinate systems using [0, 360).
        """
        norm_lon = ((lon + 180.0) % 360.0) - 180.0
        return norm_lon

    @staticmethod
    def validate_coordinates(lat: float, lon: float) -> Tuple[float, float]:
        """
        Validates latitude in [-90.0, 90.0] and normalizes longitude.
        Raises ValueError if latitude is out of bounds.
        """
        if not (-90.0 <= lat <= 90.0):
            raise ValueError(f"Latitude {lat} out of bounds [-90.0, 90.0].")
        if math.isnan(lat) or math.isnan(lon) or math.isinf(lat) or math.isinf(lon):
            raise ValueError("Coordinates must be finite numeric values.")
        return lat, NetCDFProcessor.normalize_longitude(lon)

    @classmethod
    def open_dataset(cls, file_path: Union[str, Path]) -> xr.Dataset:
        """
        Opens a NetCDF4 file via xarray with netcdf4 engine and closes on demand.
        """
        path_obj = Path(file_path)
        if not path_obj.exists():
            raise FileNotFoundError(f"NetCDF file not found: {file_path}")
        return xr.open_dataset(str(path_obj), engine="netcdf4")

    @classmethod
    def clean_scientific_value(cls, raw_val: Any) -> Optional[float]:
        """
        Converts raw NetCDF values into sanitized Python floats.
        Replaces NaN, Inf, and GEOS-CF fill values with None.
        """
        if raw_val is None:
            return None
        try:
            val = float(raw_val)
        except (ValueError, TypeError):
            return None

        if math.isnan(val) or math.isinf(val) or abs(val) >= cls.FILL_VALUE_THRESHOLD:
            return None
        return val

    @classmethod
    def inspect_file(cls, file_path: Union[str, Path]) -> Dict[str, Any]:
        """
        Inspects global attributes, coordinates, and variables of a NetCDF file.
        """
        with cls.open_dataset(file_path) as ds:
            attrs = {k: str(v) for k, v in ds.attrs.items()}
            variables_info = {}
            for var_name, da in ds.data_vars.items():
                variables_info[var_name] = {
                    "dimensions": list(da.dims),
                    "shape": list(da.shape),
                    "units": da.attrs.get("units", "unknown"),
                    "long_name": da.attrs.get("long_name", var_name),
                }

            times = [
                pd.to_datetime(t).tz_localize("UTC" if pd.to_datetime(t).tzinfo is None else None).strftime("%Y-%m-%dT%H:%M:%SZ")
                for t in ds["time"].values
            ] if "time" in ds else []

            return {
                "title": attrs.get("title", ""),
                "institution": attrs.get("institution", ""),
                "contact": attrs.get("contact", ""),
                "history": attrs.get("history", ""),
                "spatial_resolution": "0.25x0.25" if len(ds.get("lat", [])) == 721 else "unknown",
                "variables": variables_info,
                "times": times,
                "lat_bounds": [float(ds["lat"].min()), float(ds["lat"].max())] if "lat" in ds else None,
                "lon_bounds": [float(ds["lon"].min()), float(ds["lon"].max())] if "lon" in ds else None,
            }

    @classmethod
    def extract_point_value(
        cls,
        ds: xr.Dataset,
        variable: str,
        lat: float,
        lon: float,
        timestamp: Optional[Union[str, datetime]] = None,
    ) -> Dict[str, Any]:
        """
        Extracts single observation for requested coordinates and timestamp.
        Returns requested coordinates, selected grid coordinates, and clean value.
        """
        if variable not in ds.data_vars:
            raise KeyError(f"Variable '{variable}' not found in dataset. Available: {list(ds.data_vars.keys())}")

        val_lat, val_lon = cls.validate_coordinates(lat, lon)
        da = ds[variable]

        # Select time slice if timestamp is provided and 'time' dimension exists
        if "time" in da.dims and timestamp is not None:
            if isinstance(timestamp, str):
                target_dt = pd.to_datetime(timestamp, utc=True)
            else:
                target_dt = pd.to_datetime(timestamp)

            # Match nearest time slice
            da = da.sel(time=target_dt.to_numpy(), method="nearest")

        # Select nearest lat and lon
        point_da = da.sel(lat=val_lat, lon=val_lon, method="nearest")
        selected_lat = float(point_da["lat"].values)
        selected_lon = float(point_da["lon"].values)

        # Handle optional lev/vertical dimension (e.g. surface layer)
        if "lev" in point_da.dims:
            point_da = point_da.isel(lev=0)

        raw_num = point_da.values
        if hasattr(raw_num, "item"):
            raw_num = raw_num.item()
        clean_num = cls.clean_scientific_value(raw_num)

        # Extract time string
        point_time = None
        if "time" in point_da.coords:
            t_arr = np.asarray(point_da["time"].values)
            t_val = t_arr.flat[0] if t_arr.ndim > 0 else point_da["time"].values
            point_time = pd.to_datetime(t_val, utc=True).strftime("%Y-%m-%dT%H:%M:%SZ")

        unit = da.attrs.get("units", "unknown")

        return {
            "requested_coordinates": {"lat": lat, "lon": lon},
            "grid_coordinates": {"lat": selected_lat, "lon": selected_lon},
            "timestamp": point_time,
            "variable": variable,
            "unit": unit,
            "value": clean_num,
            "quality": "valid" if clean_num is not None else "missing",
        }

    @classmethod
    def extract_spatial_slice(
        cls,
        file_path: Union[str, Path],
        variable: str,
        locations: List[Dict[str, Any]],
        timestamp: Optional[Union[str, datetime]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Extracts observations for an ordered sequence of locations from a NetCDF file.
        Preserves the exact requested location order.
        """
        results = []
        with cls.open_dataset(file_path) as ds:
            for idx, loc in enumerate(locations):
                loc_id = loc.get("id")
                lat = float(loc["lat"])
                lon = float(loc["lon"])

                point_data = cls.extract_point_value(ds, variable, lat, lon, timestamp=timestamp)
                point_data["order"] = idx
                point_data["locationId"] = loc_id
                results.append(point_data)
        return results

    @classmethod
    def extract_temporal_series(
        cls,
        file_paths: List[Union[str, Path]],
        variable: str,
        lat: float,
        lon: float,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> List[Dict[str, Any]]:
        """
        Extracts time series observations for given coordinate across multiple NetCDF files.
        Guarantees ascending chronological order.
        """
        all_points = []
        for fp in file_paths:
            with cls.open_dataset(fp) as ds:
                if variable not in ds.data_vars:
                    continue

                times = ds["time"].values if "time" in ds else [None]
                for t in times:
                    t_dt = pd.to_datetime(t, utc=True) if t is not None else None
                    if start_time and t_dt and t_dt < start_time:
                        continue
                    if end_time and t_dt and t_dt > end_time:
                        continue

                    pt = cls.extract_point_value(ds, variable, lat, lon, timestamp=t_dt)
                    all_points.append(pt)

        # Sort chronologically by timestamp
        all_points.sort(key=lambda p: p["timestamp"] or "")
        # Assign 0-indexed order
        for idx, p in enumerate(all_points):
            p["order"] = idx
        return all_points

    @classmethod
    def _select_time_and_surface(
        cls,
        da: xr.DataArray,
        timestamp: Optional[Union[str, datetime]] = None,
    ) -> Tuple[xr.DataArray, Optional[str]]:
        """Slices a DataArray to a single timestamp (nearest or first) and surface level."""
        if "time" in da.dims:
            if timestamp is not None:
                target_dt = pd.to_datetime(timestamp, utc=True)
                da = da.sel(time=target_dt.to_numpy(), method="nearest")
            else:
                da = da.isel(time=0)

        resolved_time: Optional[str] = None
        if "time" in da.coords:
            t_val = da["time"].values
            resolved_time = pd.to_datetime(t_val, utc=True).strftime("%Y-%m-%dT%H:%M:%SZ")

        if "lev" in da.dims:
            da = da.isel(lev=0)

        return da, resolved_time

    @classmethod
    def _compute_tier_ratios(cls, variable: str, valid_values: np.ndarray) -> Dict[str, float]:
        """Computes low/moderate/high pixel ratios summing to 1.0 for valid ROI observations."""
        if valid_values.size == 0:
            return {"low": 0.0, "moderate": 0.0, "high": 0.0}

        thresholds = cls.CONCENTRATION_TIER_THRESHOLDS.get(variable)
        if thresholds is not None:
            mod_thresh, high_thresh = thresholds
        else:
            mod_thresh = float(np.percentile(valid_values, 33.33))
            high_thresh = float(np.percentile(valid_values, 66.67))
            if mod_thresh >= high_thresh:
                return {"low": 1.0, "moderate": 0.0, "high": 0.0}

        total = float(valid_values.size)
        low_count = int(np.sum(valid_values < mod_thresh))
        mod_count = int(np.sum((valid_values >= mod_thresh) & (valid_values < high_thresh)))

        low_ratio = round(low_count / total, 4)
        cum_mod = round((low_count + mod_count) / total, 4)
        mod_ratio = round(max(0.0, cum_mod - low_ratio), 4)
        high_ratio = round(max(0.0, 1.0 - cum_mod), 4)
        return {"low": low_ratio, "moderate": mod_ratio, "high": high_ratio}

    @staticmethod
    def _points_in_ring(
        lat_grid: np.ndarray,
        lon_grid: np.ndarray,
        ring: List[Tuple[float, float]],
    ) -> np.ndarray:
        """Vectorized even-odd ray-casting mask over (lat_grid, lon_grid) for a [(lat, lon), ...] ring."""
        inside = np.zeros(lat_grid.shape, dtype=bool)
        if len(ring) < 3:
            return inside
        n = len(ring)
        for i in range(n):
            yi, xi = float(ring[i][0]), float(ring[i][1])
            yj, xj = float(ring[(i + 1) % n][0]), float(ring[(i + 1) % n][1])
            crosses_lat = (yi > lat_grid) != (yj > lat_grid)
            x_intersect = ((xj - xi) * (lat_grid - yi)) / (yj - yi + 1e-12) + xi
            inside ^= crosses_lat & (lon_grid < x_intersect)
        return inside

    @classmethod
    def _snap_to_nearest_cell(
        cls,
        da: xr.DataArray,
        grid_lats: np.ndarray,
        grid_lons: np.ndarray,
        lat_min: float,
        lat_max: float,
        lon_min: float,
        lon_max: float,
        polygon_rings: Optional[List[List[Tuple[float, float]]]] = None,
    ) -> np.ndarray:
        """Selects the nearest model grid cell to a sub-grid ROI centroid."""
        center_lat = 0.5 * (lat_min + lat_max)
        center_lon = cls.normalize_longitude(
            0.5 * (lon_min + lon_max) if lon_min <= lon_max else lon_min + 0.5 * ((lon_max - lon_min) % 360.0)
        )
        if polygon_rings and polygon_rings[0]:
            primary_ring = polygon_rings[0]
            center_lat = float(sum(pt[0] for pt in primary_ring) / len(primary_ring))
            center_lon = cls.normalize_longitude(
                float(sum(pt[1] for pt in primary_ring) / len(primary_ring))
            )
        lat_idx = int(np.argmin(np.abs(grid_lats - center_lat)))
        lon_diffs = np.abs(((grid_lons - center_lon + 180.0) % 360.0) - 180.0)
        lon_idx = int(np.argmin(lon_diffs))
        region_da = da.isel(lat=lat_idx, lon=lon_idx)
        return np.atleast_1d(region_da.values.astype(np.float64))

    @classmethod
    def extract_bbox_summary(
        cls,
        ds: xr.Dataset,
        variable: str,
        lat_min: float,
        lat_max: float,
        lon_min: float,
        lon_max: float,
        timestamp: Optional[Union[str, datetime]] = None,
        polygon_rings: Optional[List[List[Tuple[float, float]]]] = None,
    ) -> Dict[str, Any]:
        """
        Extracts spatial summary statistics across an arbitrary rectangular bounding box
        [lat_min, lat_max] x [lon_min, lon_max], or optionally masks grid cells strictly inside
        one or more (lat, lon) polygon boundary rings.
        """
        if variable not in ds.data_vars:
            raise KeyError(f"Variable '{variable}' not found in dataset. Available: {list(ds.data_vars.keys())}")

        coords = (lat_min, lat_max, lon_min, lon_max)
        if any(not math.isfinite(float(c)) for c in coords):
            raise ValueError("Bounding box coordinates must be finite numeric values.")
        if lat_min < -90.0 or lat_max > 90.0 or lat_min > lat_max:
            raise ValueError(
                f"Invalid latitude bounds [{lat_min}, {lat_max}]; expected -90.0 <= lat_min <= lat_max <= 90.0."
            )

        da, resolved_time = cls._select_time_and_surface(ds[variable], timestamp=timestamp)
        grid_lats = da["lat"].values.astype(np.float64)
        grid_lons = da["lon"].values.astype(np.float64)

        lat_mask = (grid_lats >= lat_min - 1.0e-9) & (grid_lats <= lat_max + 1.0e-9)
        is_standard_lon_grid = float(np.max(grid_lons)) <= 180.0 + 1.0e-9
        is_cartesian_box = (-180.0 <= lon_min <= lon_max <= 180.0) and is_standard_lon_grid
        if is_cartesian_box:
            lon_mask = (grid_lons >= lon_min - 1.0e-9) & (grid_lons <= lon_max + 1.0e-9)
        else:
            lon_span = min(360.0, (lon_max - lon_min) % 360.0 if lon_max < lon_min else (lon_max - lon_min))
            lon_mask = ((grid_lons - lon_min) % 360.0) <= (lon_span + 1.0e-9)

        matched_lats = grid_lats[lat_mask]
        matched_lons = grid_lons[lon_mask]

        snapped_to_nearest = False
        if matched_lats.size == 0 or matched_lons.size == 0:
            arr = cls._snap_to_nearest_cell(
                da, grid_lats, grid_lons, lat_min, lat_max, lon_min, lon_max, polygon_rings
            )
            snapped_to_nearest = True
        else:
            region_da = da.sel(lat=matched_lats, lon=matched_lons)
            if "lat" in region_da.dims and "lon" in region_da.dims:
                region_da = region_da.transpose("lat", "lon")
            arr = region_da.values.astype(np.float64)
            if polygon_rings:
                norm_lons = np.where(matched_lons > 180.0, ((matched_lons + 180.0) % 360.0) - 180.0, matched_lons)
                lat2d, lon2d = np.meshgrid(matched_lats, norm_lons, indexing="ij")
                poly_mask = np.zeros(lat2d.shape, dtype=bool)
                for ring in polygon_rings:
                    poly_mask |= cls._points_in_ring(lat2d, lon2d, ring)

                if int(np.sum(poly_mask)) > 0:
                    arr = arr[poly_mask]
                else:
                    arr = cls._snap_to_nearest_cell(
                        da, grid_lats, grid_lons, lat_min, lat_max, lon_min, lon_max, polygon_rings
                    )
                    snapped_to_nearest = True

        valid_mask = np.isfinite(arr) & (np.abs(arr) < cls.FILL_VALUE_THRESHOLD)
        valid_values = arr[valid_mask]

        total_count = int(arr.size)
        valid_count = int(valid_values.size)
        missing_count = total_count - valid_count

        if valid_count > 0:
            mean_val: Optional[float] = float(np.mean(valid_values))
            p90_val: Optional[float] = float(np.percentile(valid_values, 90))
            max_val: Optional[float] = float(np.max(valid_values))
        else:
            mean_val = None
            p90_val = None
            max_val = None

        return {
            "variable": variable,
            "raw_unit": ds[variable].attrs.get("units", "unknown"),
            "timestamp": resolved_time,
            "bounds": {
                "lat_min": float(lat_min),
                "lat_max": float(lat_max),
                "lon_min": float(lon_min),
                "lon_max": float(lon_max),
            },
            "snapped_to_nearest": snapped_to_nearest,
            "mean": mean_val,
            "p90": p90_val,
            "max": max_val,
            "valid_count": valid_count,
            "missing_count": missing_count,
            "total_count": total_count,
            "tier_ratios": cls._compute_tier_ratios(variable, valid_values),
        }

    @classmethod
    def extract_region_summary(
        cls,
        ds: xr.Dataset,
        variable: str,
        lat: float,
        lon: float,
        delta_deg: float = 0.5,
        timestamp: Optional[Union[str, datetime]] = None,
    ) -> Dict[str, Any]:
        """
        Extracts regional ROI summary statistics within [lat ± delta_deg, lon ± delta_deg].
        Delegates to extract_bbox_summary while validating center coordinates and radius delta.
        """
        val_lat, val_lon = cls.validate_coordinates(lat, lon)
        if not math.isfinite(delta_deg) or delta_deg <= 0.0:
            raise ValueError(f"delta_deg must be a positive finite number, got {delta_deg}.")

        lat_min = max(-90.0, val_lat - delta_deg)
        lat_max = min(90.0, val_lat + delta_deg)
        lon_min = val_lon - delta_deg
        lon_max = val_lon + delta_deg

        summary = cls.extract_bbox_summary(
            ds=ds,
            variable=variable,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max,
            timestamp=timestamp,
        )
        summary["center"] = {"lat": val_lat, "lon": val_lon}
        summary["delta_deg"] = float(delta_deg)
        return summary
