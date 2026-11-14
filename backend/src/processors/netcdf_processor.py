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
            t_val = point_da["time"].values
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
