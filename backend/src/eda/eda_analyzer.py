from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
import xarray as xr
from scipy import stats

try:
    from backend.src.eda.eda_plotter import render_all_eda_figures
    from backend.src.eda.granule_generator import (
        CORE_VARIABLES,
        HOTSPOT_ROIS,
        VARIABLE_META,
        discover_global_granules,
    )
    from backend.src.models.entities import PRESET_LOCATIONS
    from backend.src.processors.netcdf_processor import NetCDFProcessor
    from backend.src.processors.observation_normalizer import ObservationNormalizer
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.utils.logger import logger
except ImportError:
    from src.eda.eda_plotter import render_all_eda_figures
    from src.eda.granule_generator import (
        CORE_VARIABLES,
        HOTSPOT_ROIS,
        VARIABLE_META,
        discover_global_granules,
    )
    from src.models.entities import PRESET_LOCATIONS
    from src.processors.netcdf_processor import NetCDFProcessor
    from src.processors.observation_normalizer import ObservationNormalizer
    from src.providers.geos_cf import GEOSCFProvider
    from src.utils.logger import logger


def _compute_log1p_scores(display_values: np.ndarray, p01: float, p99: float) -> np.ndarray:
    """Applies perceptual log1p normalization anchored at [p01, p99] display quantiles."""
    denom = float(np.log1p(max(1e-12, p99 - p01)))
    scaled = np.log1p(np.maximum(0.0, display_values - p01)) / denom
    return np.clip(scaled, 0.0, 1.0)


def _compute_linear_scores(variable: str, native_values: np.ndarray) -> np.ndarray:
    """Vectorized equivalent of current ObservationNormalizer linear min-max bounds."""
    cfg = ObservationNormalizer.get_config(variable)
    if cfg is None or cfg.max <= cfg.min:
        return np.zeros_like(native_values, dtype=np.float64)
    clamped = np.clip(native_values, cfg.min, cfg.max)
    return (clamped - cfg.min) / (cfg.max - cfg.min)


def _sanitize_variables(
    surface_ds: xr.Dataset,
) -> Tuple[Dict[str, np.ndarray], Dict[str, np.ndarray], Dict[str, np.ndarray], Dict[str, np.ndarray]]:
    """Masks NaN/Inf and NASA fill sentinels (|x| >= 1e14) into NaNs while preserving raw arrays."""
    raw_arrays: Dict[str, np.ndarray] = {}
    clean_arrays: Dict[str, np.ndarray] = {}
    fill_masks: Dict[str, np.ndarray] = {}
    nan_masks: Dict[str, np.ndarray] = {}

    for var in CORE_VARIABLES:
        arr = surface_ds[var].values.astype(np.float64)
        is_nan = np.isnan(arr) | np.isinf(arr)
        is_fill = (~is_nan) & (np.abs(arr) >= NetCDFProcessor.FILL_VALUE_THRESHOLD)
        is_valid = (~is_nan) & (~is_fill)

        raw_arrays[var] = arr
        clean_arrays[var] = np.where(is_valid, arr, np.nan)
        fill_masks[var] = is_fill
        nan_masks[var] = is_nan

    return raw_arrays, clean_arrays, fill_masks, nan_masks


def _audit_variables(
    raw_arrays: Dict[str, np.ndarray],
    clean_arrays: Dict[str, np.ndarray],
    fill_masks: Dict[str, np.ndarray],
    nan_masks: Dict[str, np.ndarray],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Tuple[np.ndarray, np.ndarray]]]:
    """Computes distribution percentiles, skewness, and linear vs. log1p normalization metrics."""
    var_metrics: Dict[str, Dict[str, Any]] = {}
    score_samples: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
    pct_keys = [1, 5, 25, 50, 75, 90, 95, 99]
    rng = np.random.default_rng(42)

    for var in CORE_VARIABLES:
        meta = VARIABLE_META[var]
        factor = float(meta["to_display"])
        raw_arr = raw_arrays[var]
        clean_arr = clean_arrays[var]

        total_n = int(raw_arr.size)
        fill_n = int(np.sum(fill_masks[var]))
        nan_n = int(np.sum(nan_masks[var]))
        missing_n = fill_n + nan_n

        valid_native = clean_arr[~np.isnan(clean_arr)]
        valid_disp = valid_native * factor

        percentiles_disp = np.percentile(valid_disp, pct_keys)
        p_map_disp = {f"p{k:02d}": float(val) for k, val in zip(pct_keys, percentiles_disp)}
        p_map_native = {k: float(v / factor) for k, v in p_map_disp.items()}

        var_skew = float(stats.skew(valid_disp, bias=False))
        var_kurt = float(stats.kurtosis(valid_disp, bias=False))

        lin_scores = _compute_linear_scores(var, valid_native)
        log_scores = _compute_log1p_scores(valid_disp, p_map_disp["p01"], p_map_disp["p99"])

        if valid_native.size > 120_000:
            sel = rng.choice(valid_native.size, size=120_000, replace=False)
            score_samples[var] = (lin_scores[sel], log_scores[sel])
        else:
            score_samples[var] = (lin_scores, log_scores)

        norm_cfg = ObservationNormalizer.get_config(var)
        lin_min = norm_cfg.min if norm_cfg is not None else 0.0
        lin_max = norm_cfg.max if norm_cfg is not None else 1.0

        raw_finite = raw_arr[~np.isnan(raw_arr) & ~np.isinf(raw_arr)]
        var_metrics[var] = {
            "native_unit": meta["native_unit"],
            "display_unit": meta["display_unit"],
            "conversion_factor": factor,
            "total_cells": total_n,
            "valid_count": int(valid_native.size),
            "fill_value_count": fill_n,
            "nan_inf_count": nan_n,
            "missing_total_count": missing_n,
            "missing_pct": round(missing_n / total_n * 100.0, 4),
            "raw_uncleaned_max": float(np.max(raw_finite)) if raw_finite.size else None,
            "native_stats": {
                "min": float(np.min(valid_native)),
                **p_map_native,
                "mean": float(np.mean(valid_native)),
                "std": float(np.std(valid_native)),
                "max": float(np.max(valid_native)),
            },
            "display_stats": {
                "min": float(np.min(valid_disp)),
                **p_map_disp,
                "mean": float(np.mean(valid_disp)),
                "std": float(np.std(valid_disp)),
                "max": float(np.max(valid_disp)),
                "skewness": round(var_skew, 4),
                "excess_kurtosis": round(var_kurt, 4),
            },
            "normalization_audit": {
                "linear_bounds": {"min": lin_min, "max": lin_max},
                "linear_pct_in_bottom_15pct": round(float(np.mean(lin_scores <= 0.15) * 100.0), 2),
                "linear_mean_score": round(float(np.mean(lin_scores)), 4),
                "linear_p05_to_p95_span": round(float(np.percentile(lin_scores, 95) - np.percentile(lin_scores, 5)), 4),
                "log1p_p01_anchor_display": round(p_map_disp["p01"], 4),
                "log1p_p99_anchor_display": round(p_map_disp["p99"], 4),
                "log1p_pct_in_bottom_15pct": round(float(np.mean(log_scores <= 0.15) * 100.0), 2),
                "log1p_mean_score": round(float(np.mean(log_scores)), 4),
                "log1p_p05_to_p95_span": round(float(np.percentile(log_scores, 95) - np.percentile(log_scores, 5)), 4),
            },
        }

    return var_metrics, score_samples


def _compute_latitude_missingness(
    clean_arrays: Dict[str, np.ndarray],
    lats: np.ndarray,
) -> Dict[str, Dict[str, float]]:
    """Computes missing/fill-masked percentages across five canonical latitude bands."""
    lat_bands = [
        ("Polar South [-90,-60)", -90.0, -60.0),
        ("Mid-South [-60,-23.5)", -60.0, -23.5),
        ("Tropics [-23.5,23.5]", -23.5, 23.5),
        ("Mid-North (23.5,60]", 23.5, 60.0),
        ("Polar North (60,90]", 60.0, 90.0),
    ]
    missing_by_lat_band: Dict[str, Dict[str, float]] = {}
    for band_name, l_min, l_max in lat_bands:
        if l_min == -23.5:
            lat_mask = (lats >= l_min) & (lats <= l_max)
        elif l_min < 0:
            lat_mask = (lats >= l_min) & (lats < l_max)
        else:
            lat_mask = (lats > l_min) & (lats <= l_max)

        has_cells = bool(np.any(lat_mask))
        missing_by_lat_band[band_name] = {
            var: round(float(np.mean(np.isnan(clean_arrays[var][:, lat_mask, :])) * 100.0), 3) if has_cells else 0.0
            for var in CORE_VARIABLES
        }
    return missing_by_lat_band


def _compute_preset_diurnal(
    clean_arrays: Dict[str, np.ndarray],
    lats: np.ndarray,
    lons: np.ndarray,
    time_labels: List[str],
) -> Dict[str, Dict[str, Any]]:
    """Extracts nearest-cell hourly series and summary metrics for PRESET_LOCATIONS."""
    preset_diurnal: Dict[str, Dict[str, Any]] = {}
    for p in PRESET_LOCATIONS:
        lat_idx = int(np.argmin(np.abs(lats - float(p["latitude"]))))
        lon_idx = int(np.argmin(np.abs(lons - float(p["longitude"]))))
        city_vars: Dict[str, Any] = {}
        for var in CORE_VARIABLES:
            meta = VARIABLE_META[var]
            series_arr = clean_arrays[var][:, lat_idx, lon_idx] * float(meta["to_display"])
            valid_vals = series_arr[~np.isnan(series_arr)]
            peak_idx = int(np.nanargmax(series_arr)) if valid_vals.size > 0 else 0
            city_vars[var] = {
                "unit": meta["display_unit"],
                "mean": round(float(np.mean(valid_vals)), 3) if valid_vals.size > 0 else None,
                "min": round(float(np.min(valid_vals)), 3) if valid_vals.size > 0 else None,
                "max": round(float(np.max(valid_vals)), 3) if valid_vals.size > 0 else None,
                "peak_utc": time_labels[peak_idx],
                "hourly_series": [None if np.isnan(v) else round(float(v), 4) for v in series_arr],
            }
        preset_diurnal[str(p["id"])] = {
            "name": p["name"],
            "region": p["region"],
            "requested_coords": {"lat": p["latitude"], "lon": p["longitude"]},
            "grid_coords": {"lat": float(lats[lat_idx]), "lon": float(lons[lon_idx])},
            "variables": city_vars,
        }
    return preset_diurnal


def _compute_hotspot_rois(
    clean_arrays: Dict[str, np.ndarray],
    lats: np.ndarray,
    lons: np.ndarray,
) -> List[Dict[str, Any]]:
    """Aggregates regional pollutant burden across verified spatial hotspot ROIs."""
    roi_summaries: List[Dict[str, Any]] = []
    for roi in HOTSPOT_ROIS:
        lat_m = (lats >= float(roi["lat_min"])) & (lats <= float(roi["lat_max"]))
        lon_m = (lons >= float(roi["lon_min"])) & (lons <= float(roi["lon_max"]))
        stats_roi: Dict[str, Any] = {}
        for var in CORE_VARIABLES:
            sub = clean_arrays[var][:, lat_m, :][:, :, lon_m] * float(VARIABLE_META[var]["to_display"])
            valid_sub = sub[~np.isnan(sub)]
            stats_roi[var] = (
                {
                    "mean": round(float(np.mean(valid_sub)), 3),
                    "p95": round(float(np.percentile(valid_sub, 95)), 3),
                    "max": round(float(np.max(valid_sub)), 3),
                }
                if valid_sub.size > 0
                else {"mean": None, "p95": None, "max": None}
            )
        roi_summaries.append({**roi, "stats": stats_roi})
    return roi_summaries


def _compute_correlations(
    clean_arrays: Dict[str, np.ndarray],
) -> Tuple[pd.DataFrame, pd.DataFrame, int]:
    """Computes Pearson and Spearman rank correlation matrices across jointly valid cells."""
    joint_valid_mask = np.ones_like(clean_arrays[CORE_VARIABLES[0]], dtype=bool)
    for var in CORE_VARIABLES:
        joint_valid_mask &= ~np.isnan(clean_arrays[var])

    flat_idx = np.flatnonzero(joint_valid_mask)
    if flat_idx.size > 150_000:
        stride = max(1, flat_idx.size // 150_000)
        sample_idx = flat_idx[::stride][:150_000]
    else:
        sample_idx = flat_idx

    df_sample = pd.DataFrame({
        var: clean_arrays[var].ravel()[sample_idx] * float(VARIABLE_META[var]["to_display"])
        for var in CORE_VARIABLES
    })
    return df_sample.corr(method="pearson").round(4), df_sample.corr(method="spearman").round(4), int(len(df_sample))


def run_eda_pipeline(
    raw_dir: Path,
    eda_out_dir: Path,
    regenerate: bool = False,
    render_plots: bool = True,
) -> Dict[str, Any]:
    """
    Executes the full GEOS-CF v2 EDA pipeline:
    1. Load multi-granule 4D `.nc4` stack.
    2. Audit data quality, coordinates, fill values (`1e15`), and latitude missingness.
    3. Compute exact statistics, quantile bounds, and acoustic compression bias metrics.
    4. Extract diurnal time series for `PRESET_LOCATIONS` and spatial Hotspot ROIs.
    5. Optionally render 5 publication-grade 300-DPI PNG figures & export `eda_summary_metrics.json`.
    """
    eda_out_dir.mkdir(parents=True, exist_ok=True)
    granule_paths = discover_global_granules(raw_dir, regenerate=regenerate)

    logger.info(f"Opening {len(granule_paths)} NetCDF-4 granules with NetCDFProcessor...")
    datasets = [xr.open_dataset(str(p), engine="netcdf4") for p in granule_paths]
    combined: xr.Dataset | None = None

    try:
        combined = xr.concat(datasets, dim="time").sortby("time")
        surface_ds = combined.isel(lev=0) if "lev" in combined.dims else combined

        lats = surface_ds["lat"].values.astype(np.float64)
        lons = surface_ds["lon"].values.astype(np.float64)
        times = pd.to_datetime(surface_ds["time"].values, utc=True)
        time_labels = [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times]
        sample_inspection = NetCDFProcessor.inspect_file(granule_paths[0])

        raw_arrays, clean_arrays, fill_masks, nan_masks = _sanitize_variables(surface_ds)
        var_metrics, score_samples = _audit_variables(raw_arrays, clean_arrays, fill_masks, nan_masks)
        missing_by_lat_band = _compute_latitude_missingness(clean_arrays, lats)
        preset_diurnal = _compute_preset_diurnal(clean_arrays, lats, lons, time_labels)
        roi_summaries = _compute_hotspot_rois(clean_arrays, lats, lons)
        pearson_corr, spearman_corr, corr_n = _compute_correlations(clean_arrays)

        generated_figures: List[str] = []
        if render_plots:
            fig_paths = render_all_eda_figures(
                eda_out_dir=eda_out_dir,
                clean_arrays=clean_arrays,
                score_samples=score_samples,
                var_metrics=var_metrics,
                lats=lats,
                lons=lons,
                time_labels=time_labels,
                preset_diurnal=preset_diurnal,
                pearson_corr=pearson_corr,
                spearman_corr=spearman_corr,
                missing_by_lat_band=missing_by_lat_band,
            )
            generated_figures = [p.name for p in fig_paths]

        summary_payload: Dict[str, Any] = {
            "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dataset_id": GEOSCFProvider.DATASET_ID,
            "product": GEOSCFProvider.DEFAULT_PRODUCT,
            "granules_analyzed": len(granule_paths),
            "time_range_utc": {"start": time_labels[0], "end": time_labels[-1]},
            "grid_dimensions": {"time": int(len(times)), "lat": int(len(lats)), "lon": int(len(lons))},
            "source_schema_sample": sample_inspection,
            "variables": var_metrics,
            "missing_by_latitude_band_pct": missing_by_lat_band,
            "preset_locations_diurnal": preset_diurnal,
            "hotspot_rois": roi_summaries,
            "correlations": {
                "sample_size": corr_n,
                "pearson": pearson_corr.to_dict(),
                "spearman": spearman_corr.to_dict(),
            },
            "generated_figures": generated_figures,
        }

        metrics_path = eda_out_dir / "eda_summary_metrics.json"
        with open(metrics_path, "w", encoding="utf-8") as f:
            json.dump(summary_payload, f, indent=2)

        logger.info(f"EDA pipeline completed successfully. Metrics saved to {metrics_path}")
        return summary_payload
    finally:
        if combined is not None:
            combined.close()
        for ds_item in datasets:
            ds_item.close()
