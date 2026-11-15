"""Local integrity receipts for manual NCCS downloads; metadata alone is not provenance."""

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from ..processors.netcdf_processor import NetCDFProcessor

NCCS_PREFIX = "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/"
PRODUCT = "aqc_tavg_1hr_glo_L1440x721_slv"
VARIABLES = ("PM25_RH35", "PM10_RH35", "CO", "NO2", "O3", "SO2")


class DownloadReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["geos-cf-download-receipt-v1"] = "geos-cf-download-receipt-v1"
    source_url: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size_bytes: int = Field(gt=0)
    timestamp_utc: str
    downloaded_at: str


def checksum_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_asset(path: Path) -> dict:
    """Check the full-grid AQC file without fabricating data or loading all six arrays."""
    with NetCDFProcessor.open_dataset(path) as ds:
        description = " ".join(str(v) for v in ds.attrs.values()).lower()
        if any(marker in description for marker in ("synthetic", "fixture", "test granule", "calibration reference sequence")):
            raise ValueError("synthetic_or_test_fixture")
        if ds.sizes.get("time") != 1 or ds.sizes.get("lat") != 721 or ds.sizes.get("lon") != 1440:
            raise ValueError("not_full_grid_geos_cf_aqc")
        timestamp = pd.Timestamp(ds.time.values[0]).tz_localize("UTC")
        if timestamp.minute != 30 or timestamp.second or timestamp.microsecond:
            raise ValueError("not_hourly_midpoint_HH30")
        match = re.search(r"\.(\d{8})_(\d{4})z\.", path.name.lower())
        if not match or PRODUCT not in path.name:
            raise ValueError("invalid_collection_or_filename")
        expected = pd.to_datetime("".join(match.groups()), format="%Y%m%d%H%M", utc=True)
        if timestamp != expected:
            raise ValueError("filename_timestamp_mismatch")
        for coordinate in ("lat", "lon"):
            values = np.asarray(ds[coordinate])
            if not np.isfinite(values).all() or not np.allclose(np.diff(values), 0.25):
                raise ValueError("invalid_coordinates")
        if not (np.isclose(float(ds.lat.min()), -90) and np.isclose(float(ds.lat.max()), 90)
                and np.isclose(float(ds.lon.min()), -180) and np.isclose(float(ds.lon.max()), 179.75)):
            raise ValueError("not_global_quarter_degree_extent")
        names = {key.upper(): key for key in ds.data_vars}
        for variable in VARIABLES:
            if variable not in names:
                raise ValueError(f"missing_variable:{variable}")
            field = ds[names[variable]]
            if set(field.dims) - {"time", "lev", "lat", "lon"} or not {"time", "lat", "lon"}.issubset(field.dims):
                raise ValueError(f"unexpected_dimensions:{variable}")
            if "lev" in field.dims and field.sizes["lev"] != 1:
                raise ValueError("non_surface_level")
            unit = str(field.attrs.get("units", "")).lower().replace("µ", "u").replace("μ", "u")
            allowed = {"ug m-3", "ug/m3", "ug/m³"} if variable.startswith("PM") else {"mol mol-1", "mol/mol"}
            if unit not in allowed:
                raise ValueError(f"invalid_unit:{variable}")
        return {"timestamp_utc": timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"), "variables": list(VARIABLES), "grid_shape": [721, 1440]}


def receipt_path(path: Path) -> Path:
    return path.with_name(path.name + ".source.json")


def valid_receipt(path: Path, checksum: str, timestamp: str, expected_url: str | None = None) -> DownloadReceipt | None:
    try:
        receipt = DownloadReceipt.model_validate_json(receipt_path(path).read_text(encoding="utf-8"))
        if (receipt.schema_version != "geos-cf-download-receipt-v1" or not receipt.source_url.startswith(NCCS_PREFIX)
                or receipt.sha256 != checksum or receipt.size_bytes != path.stat().st_size
                or receipt.timestamp_utc != timestamp or (expected_url and receipt.source_url != expected_url)):
            return None
        return receipt
    except (OSError, ValueError):
        return None


def write_receipt(path: Path, source_url: str) -> DownloadReceipt:
    if not source_url.startswith(NCCS_PREFIX):
        raise ValueError("Download provenance requires an NCCS HTTPS URL")
    info = inspect_asset(path)
    receipt = DownloadReceipt(source_url=source_url, sha256=checksum_file(path), size_bytes=path.stat().st_size,
        timestamp_utc=info["timestamp_utc"], downloaded_at=datetime.now(timezone.utc).isoformat())
    target = receipt_path(path)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(receipt.model_dump_json(indent=2), encoding="utf-8")
    temporary.replace(target)
    return receipt
