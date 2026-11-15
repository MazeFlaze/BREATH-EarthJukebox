#!/usr/bin/env python3
"""
BREATHE Offline SVS 5533-Styled GEOS-CF v2 Equirectangular Map Renderer (M4 Ready)
Workstream N01 / N05: Renders clean 16:9 (1920x1080) flat-map heatmap PNGs from local
GEOS-CF NetCDF-4 granules without hardcoded bounding boxes so the Frontend drag-box
ROI selector maps pixel coordinates accurately across [-180, 180] x [-90, 90].
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import xarray as xr  # noqa: E402

script_dir = Path(__file__).resolve().parent
backend_dir = script_dir.parent
project_root = backend_dir.parent
for p in [str(project_root), str(backend_dir)]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from backend.src.core.config import settings
    from backend.src.models.entities import PRESET_LOCATIONS
    from backend.src.processors.netcdf_processor import NetCDFProcessor
    from backend.src.processors.observation_normalizer import ObservationNormalizer
    from backend.src.utils.logger import logger
except ImportError:
    from src.core.config import settings
    from src.models.entities import PRESET_LOCATIONS
    from src.processors.netcdf_processor import NetCDFProcessor
    from src.processors.observation_normalizer import ObservationNormalizer
    from src.utils.logger import logger


# Aligned with docs/EDA_REPORT_GEOS_CF.md Section 8B colormap calibration
MAP_RENDER_SPECS: Dict[str, Dict[str, Any]] = {
    "PM25_RH35": {
        "display_name": "Particulate Matter (PM2.5)",
        "cmap": "inferno",
        "vmin": 0.0,
        "vmax": 150.0,
        "display_unit": "µg/m³",
        "factor": 1.0,
    },
    "NO2": {
        "display_name": "Nitrogen Dioxide (NO2)",
        "cmap": "magma",
        "vmin": 0.0,
        "vmax": 45.0,
        "display_unit": "ppbv",
        "factor": 1.0e9,
    },
    "O3": {
        "display_name": "Tropospheric Ozone (O3)",
        "cmap": "viridis",
        "vmin": 10.0,
        "vmax": 50.0,
        "display_unit": "ppbv",
        "factor": 1.0e9,
    },
    "CO": {
        "display_name": "Carbon Monoxide (CO)",
        "cmap": "cividis",
        "vmin": 50.0,
        "vmax": 600.0,
        "display_unit": "ppbv",
        "factor": 1.0e9,
    },
    "SO2": {
        "display_name": "Sulfur Dioxide (SO2)",
        "cmap": "plasma",
        "vmin": 0.0,
        "vmax": 25.0,
        "display_unit": "ppbv",
        "factor": 1.0e9,
    },
}

OUTPUT_WIDTH_PX = 1920
OUTPUT_HEIGHT_PX = 1080
RENDER_DPI = 120


def render_flat_map_png(
    nc_path: Path,
    variable: str,
    output_path: Path,
    width: int = OUTPUT_WIDTH_PX,
    height: int = OUTPUT_HEIGHT_PX,
) -> Dict[str, Any]:
    """
    Renders a single clean 1920x1080 equirectangular flat-map PNG for a GEOS-CF variable.
    Zero axes margins or borders ensure pixel coordinates align directly to EPSG:4326.
    """
    if variable not in MAP_RENDER_SPECS:
        raise ValueError(f"Unsupported map variable '{variable}'. Supported: {list(MAP_RENDER_SPECS.keys())}")

    spec = MAP_RENDER_SPECS[variable]
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with NetCDFProcessor.open_dataset(nc_path) as ds:
        if variable not in ds.data_vars:
            raise KeyError(f"Variable '{variable}' not found in {nc_path.name}")

        da = ds[variable]
        if "time" in da.dims:
            da = da.isel(time=0)
        if "lev" in da.dims:
            da = da.isel(lev=0)

        iso_time = (
            pd.to_datetime(da["time"].values, utc=True).strftime("%Y-%m-%dT%H:%M:%SZ")
            if "time" in da.coords
            else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        )

        lats = da["lat"].values.astype(np.float64)
        lons = da["lon"].values.astype(np.float64)
        values = da.values.astype(np.float64)

        # Ensure ascending coordinates for pcolormesh even on unordered grids
        lat_order = np.argsort(lats)
        lon_order = np.argsort(lons)
        lats_sorted = lats[lat_order]
        lons_sorted = lons[lon_order]
        grid = values[np.ix_(lat_order, lon_order)]

        valid_mask = np.isfinite(grid) & (np.abs(grid) < NetCDFProcessor.FILL_VALUE_THRESHOLD)
        display_grid = np.where(valid_mask, grid * spec["factor"], np.nan)
        masked_grid = np.ma.masked_invalid(display_grid)

    cmap_obj = matplotlib.colormaps.get_cmap(spec["cmap"]).copy()
    cmap_obj.set_bad(color="#070b14")

    fig = plt.figure(figsize=(width / RENDER_DPI, height / RENDER_DPI), dpi=RENDER_DPI)
    ax = fig.add_axes([0.0, 0.0, 1.0, 1.0])
    ax.set_facecolor("#070b14")

    lon_edges = np.linspace(-180.0, 180.0, len(lons_sorted) + 1) if lons_sorted.size == 1 else None
    if lon_edges is not None:
        ax.pcolormesh(
            lon_edges,
            np.linspace(-90.0, 90.0, len(lats_sorted) + 1),
            masked_grid,
            cmap=cmap_obj,
            vmin=spec["vmin"],
            vmax=spec["vmax"],
            shading="flat",
        )
    else:
        ax.pcolormesh(
            lons_sorted,
            lats_sorted,
            masked_grid,
            cmap=cmap_obj,
            vmin=spec["vmin"],
            vmax=spec["vmax"],
            shading="nearest",
        )

    ax.set_xlim(-180.0, 180.0)
    ax.set_ylim(-90.0, 90.0)
    ax.set_axis_off()
    fig.savefig(output_path, dpi=RENDER_DPI, facecolor="#070b14")
    plt.close(fig)

    return {
        "variable": variable,
        "timestamp": iso_time,
        "imageUrl": f"/images/geos-cf/{output_path.name}",
        "cmap": spec["cmap"],
        "vmin": spec["vmin"],
        "vmax": spec["vmax"],
        "displayUnit": spec["display_unit"],
        "width": width,
        "height": height,
        "bounds": {"latMin": -90.0, "latMax": 90.0, "lonMin": -180.0, "lonMax": 180.0},
        "sourceFile": nc_path.name,
    }


def build_offline_observations(
    granules: List[Path],
    rendered_entries: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Extracts verified surface PM25_RH35 observations directly from ingested GEOS-CF
    granules paired with local equirectangular PNG assets for 100% offline M4 playback.
    """
    pm25_images = {e["timestamp"]: e["imageUrl"] for e in rendered_entries if e["variable"] == "PM25_RH35"}
    observations: List[Dict[str, Any]] = []

    for idx, nc_path in enumerate(granules):
        preset = PRESET_LOCATIONS[idx % len(PRESET_LOCATIONS)]
        with NetCDFProcessor.open_dataset(nc_path) as ds:
            raw_time = np.asarray(ds["time"].values).flat[0] if "time" in ds.coords else None
            iso_target = (
                pd.to_datetime(raw_time, utc=True).strftime("%Y-%m-%dT%H:%M:%SZ")
                if raw_time is not None
                else None
            )
            pt = NetCDFProcessor.extract_point_value(
                ds=ds,
                variable="PM25_RH35",
                lat=preset["latitude"],
                lon=preset["longitude"],
                timestamp=iso_target,
            )

        ts = str(pt["timestamp"] or iso_target or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        val = pt["value"]
        if val is None or ts not in pm25_images:
            continue

        conv = ObservationNormalizer.to_display_unit("PM25_RH35", val, raw_unit=pt["unit"])
        norm_score = ObservationNormalizer.normalize("PM25_RH35", val, method="log_scale")
        obs_date = ts[:10].replace("-", "")
        obs_hour = ts[11:16].replace(":", "")

        observations.append(
            {
                "id": f"geos-cf-{obs_date}-{obs_hour}-{preset['id']}",
                "timestamp": ts,
                "imageUrl": pm25_images[ts],
                "value": round(float(conv.display_value if conv.display_value is not None else val), 3),
                "unit": "µg/m³",
                "variable": "Particulate Matter (PM2.5)",
                "description": (
                    f"GEOS-CF v2 hourly surface PM2.5 assimilation at {preset['name']} "
                    f"({preset['region']}); calibrated acoustic index={norm_score}."
                ),
                "isMock": False,
                "coordinates": {
                    "lat": pt["grid_coordinates"]["lat"],
                    "lon": pt["grid_coordinates"]["lon"],
                    "regionName": f"{preset['name']} ({preset['region']})",
                },
                "provenance": {
                    "satellite": "NASA GMAO GEOS-CF v2 Assimilation (MODIS / VIIRS / OMI)",
                    "instrument": "GEOS-CF Chemistry & Aerosol Model",
                    "processingLevel": "Level 4 Global 2D Surface Analysis (Offline M4 Render)",
                    "citationUrl": "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/",
                },
            }
        )

    return observations


def update_offline_json_catalogs(
    manifest: Dict[str, Any],
    observations: List[Dict[str, Any]],
    frontend_obs_path: Path,
    backend_offline_path: Path,
    svs_processed_path: Path,
) -> None:
    """Writes authentic offline GEOS-CF catalogs while keeping SVS prototype test fixtures intact."""
    if observations:
        vals = [o["value"] for o in observations]
        offline_payload = {
            "_meta": {
                "notice": "VERIFIED NASA GEOS-CF v2 OFFLINE M4 DATASET",
                "disclaimer": (
                    "Values extracted directly from authentic NASA GMAO GEOS-CF v2 NetCDF-4 "
                    "granules and paired with local SVS 5533-styled 1920x1080 equirectangular PNGs. "
                    "PM2.5 (µg/m³) is strictly distinct from dimensionless AOD."
                ),
                "isMock": False,
                "targetVariable": "Surface Particulate Matter (PM2.5)",
                "unit": "µg/m³",
                "version": "2.0.0-offline-m4-calibrated",
                "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            "dataset": {
                "id": "geos-cf-v2-aqc",
                "title": "NASA GMAO GEOS-CF v2: Global Surface Air Quality (Offline M4 Ready)",
                "source": "NASA GMAO & NASA Scientific Visualization Studio (#5533)",
                "sourceUrl": "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/",
                "variable": "Particulate Matter (PM2.5)",
                "unit": "µg/m³",
                "description": (
                    "Offline-ready GEOS-CF v2 PM2.5 observations paired with 16:9 equirectangular "
                    "heatmap assets for browser drag-box ROI selection and log-scale sonification."
                ),
                "observations": observations,
                "isMock": False,
                "range": {"min": min(vals), "max": max(vals)},
            },
            "maps": manifest["maps"],
        }

        frontend_obs_path.parent.mkdir(parents=True, exist_ok=True)
        frontend_obs_path.write_text(json.dumps(offline_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        backend_offline_path.parent.mkdir(parents=True, exist_ok=True)
        backend_offline_path.write_text(json.dumps(offline_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # Annotate existing svs5533_geos_cf_processed.json with offline asset cross-links without altering
    # its 2024 snapshot URLs/values tested by backend/tests/test_svs_api.py
    if svs_processed_path.exists() and manifest["maps"]:
        svs_data = json.loads(svs_processed_path.read_text(encoding="utf-8"))
        pm25_urls = [m["imageUrl"] for m in manifest["maps"] if m["variable"] == "PM25_RH35"]
        if pm25_urls:
            svs_data.setdefault("_meta", {})["offlineMapManifest"] = "/images/geos-cf/manifest.json"
            for i, obs in enumerate(svs_data.get("dataset", {}).get("observations", [])):
                obs["offlineImageUrl"] = pm25_urls[i % len(pm25_urls)]
            svs_processed_path.write_text(json.dumps(svs_data, indent=2, ensure_ascii=False), encoding="utf-8")


def _extract_granule_date(path: Path) -> Optional[str]:
    """Extracts YYYYMMDD stamp from GEOS.cf.ana.*.YYYYMMDD_HH30z.*.nc4 filename."""
    for part in path.name.split("."):
        if len(part) >= 13 and part[8] == "_" and part[:8].isdigit():
            return part[:8]
    return None


def _extract_granule_hour(path: Path) -> Optional[int]:
    """Extracts UTC hour (0-23) from GEOS.cf.ana.*.YYYYMMDD_HH30z.*.nc4 filename."""
    for part in path.name.split("."):
        if len(part) >= 13 and part[8] == "_" and part[9:11].isdigit():
            return int(part[9:11])
    return None


def select_granules_for_date(
    raw_dir: Path,
    target_date: str = "latest",
    step_hours: int = 3,
    limit: Optional[int] = None,
) -> Tuple[List[Path], Optional[str]]:
    """
    Selects local GEOS-CF granules for 'latest', 'all', or a specific YYYY-MM-DD date.
    Prefers modulo-hour matching (idempotent whether 24h or 3h files exist on disk).
    """
    all_granules = sorted(raw_dir.glob("GEOS.cf.ana.*.nc4"))
    if not all_granules:
        return [], None

    normalized = (target_date or "latest").strip().lower()
    resolved_date: Optional[str] = None

    if normalized == "all":
        filtered = all_granules
        dates = sorted({d for p in filtered if (d := _extract_granule_date(p)) is not None})
        resolved_date = f"{dates[-1][:4]}-{dates[-1][4:6]}-{dates[-1][6:8]}" if dates else None
    elif normalized == "latest":
        dates = sorted({d for p in all_granules if (d := _extract_granule_date(p)) is not None})
        if dates:
            latest_stamp = dates[-1]
            filtered = [p for p in all_granules if _extract_granule_date(p) == latest_stamp]
            resolved_date = f"{latest_stamp[:4]}-{latest_stamp[4:6]}-{latest_stamp[6:8]}"
        else:
            filtered = all_granules
    else:
        compact = normalized.replace("-", "")
        filtered = [p for p in all_granules if _extract_granule_date(p) == compact]
        resolved_date = f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}" if len(compact) == 8 else normalized

    if step_hours > 1 and filtered:
        aligned = [
            p for p in filtered
            if (hr := _extract_granule_hour(p)) is not None and (hr % step_hours) == 0
        ]
        filtered = aligned if aligned else filtered[::step_hours]

    if limit is not None and limit > 0:
        filtered = filtered[:limit]

    return filtered, resolved_date


def run_render_pipeline(
    raw_dir: Path,
    output_dir: Path,
    variables: List[str],
    step_hours: int = 3,
    limit: Optional[int] = None,
    target_date: str = "latest",
    clean_stale: bool = False,
    catalog_root: Optional[Path] = None,
) -> Dict[str, Any]:
    """Selects local granules at fixed cadence, renders equirectangular PNGs, and updates manifests."""
    granules, resolved_date = select_granules_for_date(
        raw_dir=raw_dir,
        target_date=target_date,
        step_hours=step_hours,
        limit=limit,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    rendered_entries: List[Dict[str, Any]] = []
    rendered_names: set[str] = set()
    for nc_path in granules:
        stamp = next((part for part in nc_path.name.split(".") if "_" in part and part.endswith("z")), nc_path.stem)
        for var in variables:
            out_file = output_dir / f"geos_cf_{var}_{stamp}.png"
            entry = render_flat_map_png(nc_path, var, out_file)
            rendered_entries.append(entry)
            rendered_names.add(out_file.name)
            logger.info(f"Rendered {out_file.name}")

    stale_removed = 0
    if clean_stale and rendered_entries:
        for existing_png in output_dir.glob("geos_cf_*.png"):
            if existing_png.name not in rendered_names:
                existing_png.unlink()
                stale_removed += 1

    manifest = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "targetDate": resolved_date,
        "projection": "EPSG:4326",
        "width": OUTPUT_WIDTH_PX,
        "height": OUTPUT_HEIGHT_PX,
        "bounds": {"latMin": -90.0, "latMax": 90.0, "lonMin": -180.0, "lonMax": 180.0},
        "maps": rendered_entries,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    observations = build_offline_observations(granules, rendered_entries)
    base_root = catalog_root or project_root
    update_offline_json_catalogs(
        manifest=manifest,
        observations=observations,
        frontend_obs_path=base_root / "frontend" / "src" / "data" / "observations.json",
        backend_offline_path=base_root / "backend" / "src" / "data" / "processed" / "geos_cf_offline_maps.json",
        svs_processed_path=base_root / "backend" / "src" / "data" / "processed" / "svs5533_geos_cf_processed.json",
    )

    return {
        "target_date": resolved_date,
        "granules_processed": len(granules),
        "images_rendered": len(rendered_entries),
        "stale_removed": stale_removed,
        "manifest_path": str(manifest_path),
        "offline_observations": len(observations),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Render offline SVS 5533 equirectangular maps for M4 readiness.")
    parser.add_argument("--raw-dir", type=Path, default=settings.DATA_STORAGE_ROOT)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "frontend" / "public" / "images" / "geos-cf",
    )
    parser.add_argument("--variables", nargs="+", default=["PM25_RH35", "NO2", "O3", "CO", "SO2"])
    parser.add_argument("--step-hours", type=int, default=3, help="Stride in hours across granules (1 = all hours).")
    parser.add_argument("--limit", type=int, default=None, help="Optional maximum number of granules to render.")
    parser.add_argument("--date", type=str, default="latest", help="Target UTC date YYYY-MM-DD, 'latest', or 'all'.")
    parser.add_argument("--clean-stale", action="store_true", help="Remove older geos_cf_*.png files when regenerating.")
    args = parser.parse_args()

    result = run_render_pipeline(
        raw_dir=args.raw_dir,
        output_dir=args.output_dir,
        variables=args.variables,
        step_hours=args.step_hours,
        limit=args.limit,
        target_date=args.date,
        clean_stale=args.clean_stale,
    )
    print(f"[SUCCESS] Rendered {result['images_rendered']} offline map PNGs across {result['granules_processed']} granules (date={result['target_date']}).")


if __name__ == "__main__":
    main()
