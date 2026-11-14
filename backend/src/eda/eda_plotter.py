from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib.figure import Figure

try:
    from backend.src.eda.granule_generator import CORE_VARIABLES, HOTSPOT_ROIS, VARIABLE_META
    from backend.src.models.entities import PRESET_LOCATIONS
    from backend.src.utils.logger import logger
except ImportError:
    from src.eda.granule_generator import CORE_VARIABLES, HOTSPOT_ROIS, VARIABLE_META
    from src.models.entities import PRESET_LOCATIONS
    from src.utils.logger import logger


def _configure_matplotlib() -> None:
    """Ensures Matplotlib writes caches to a writable temp folder and uses Agg."""
    mpl_cache_dir = Path(tempfile.gettempdir()) / "breathe_mplconfig"
    mpl_cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(mpl_cache_dir))
    plt.switch_backend("Agg")


def _finalize_figure(fig: Figure, out_path: Path, label: str) -> Path:
    """Saves a figure at 300 DPI, releases resources, and logs completion."""
    fig.savefig(out_path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    logger.info(f"Saved {label}: {out_path.name}")
    return out_path


def _plot_fig1_distributions(
    score_samples: Dict[str, Tuple[np.ndarray, np.ndarray]],
    var_metrics: Dict[str, Dict[str, Any]],
    out_path: Path,
) -> Path:
    """Fig 1: Linear Min-Max vs. Log1p Perceptual Normalized Acoustic Distributions (5x2 grid)."""
    sns.set_theme(style="whitegrid", context="paper")
    fig, axes = plt.subplots(len(CORE_VARIABLES), 2, figsize=(13.5, 16.5), dpi=300, squeeze=False)

    for row_idx, var in enumerate(CORE_VARIABLES):
        meta = VARIABLE_META[var]
        audit = var_metrics[var]["normalization_audit"]
        lin_scores, log_scores = score_samples[var]

        ax_lin = axes[row_idx, 0]
        ax_lin.hist(lin_scores, bins=40, range=(0.0, 1.0), density=True, color="#e6550d", alpha=0.72, edgecolor="white", linewidth=0.4)
        ax_lin.axvspan(0.0, 0.15, color="#fee6ce", alpha=0.55, zorder=0, label="Bottom 15% Pitch Zone")
        ax_lin.axvline(float(np.median(lin_scores)), color="#7f2704", linestyle="--", linewidth=1.4, label=f"Median={np.median(lin_scores):.3f}")
        ax_lin.set_title(
            f"{meta['short_label']} ({meta['display_unit']}) — Linear Min-Max | {audit['linear_pct_in_bottom_15pct']:.1f}% in [0, 0.15]",
            fontsize=10,
            fontweight="bold",
        )
        ax_lin.set_xlim(0.0, 1.0)
        ax_lin.set_ylabel("Density", fontsize=9)
        ax_lin.legend(loc="upper right", fontsize=8, frameon=True)

        ax_log = axes[row_idx, 1]
        ax_log.hist(log_scores, bins=40, range=(0.0, 1.0), density=True, color="#2b8cbe", alpha=0.78, edgecolor="white", linewidth=0.4)
        ax_log.axvline(float(np.percentile(log_scores, 5)), color="#084081", linestyle=":", linewidth=1.2, label=f"P05={np.percentile(log_scores, 5):.2f}")
        ax_log.axvline(float(np.median(log_scores)), color="#084081", linestyle="--", linewidth=1.5, label=f"P50={np.median(log_scores):.2f}")
        ax_log.axvline(float(np.percentile(log_scores, 95)), color="#084081", linestyle="-.", linewidth=1.2, label=f"P95={np.percentile(log_scores, 95):.2f}")
        ax_log.set_title(
            f"{meta['short_label']} — Calibrated log1p([P01, P99]) | Span P05-P95={audit['log1p_p05_to_p95_span']:.2f}",
            fontsize=10,
            fontweight="bold",
        )
        ax_log.set_xlim(0.0, 1.0)
        ax_log.legend(loc="upper right", fontsize=8, frameon=True)

        if row_idx == len(CORE_VARIABLES) - 1:
            ax_lin.set_xlabel("Normalized Acoustic Score [0.0, 1.0] (Linear)", fontsize=9.5)
            ax_log.set_xlabel("Normalized Acoustic Score [0.0, 1.0] (Log1p Perceptual)", fontsize=9.5)

    fig.suptitle(
        "NASA GEOS-CF v2 Global Acoustic Compression Audit: Linear Bounds vs. Log1p Perceptual Scaling",
        fontsize=13,
        fontweight="bold",
        y=0.992,
    )
    fig.tight_layout(rect=(0.0, 0.01, 1.0, 0.985))
    return _finalize_figure(fig, out_path, "Figure 1")


def _plot_fig2_global_heatmaps(
    clean_arrays: Dict[str, np.ndarray],
    lats: np.ndarray,
    lons: np.ndarray,
    out_path: Path,
) -> Path:
    """Fig 2: Global Spatial Mean Heatmaps with Hotspot ROI Bounding Boxes & Preset Cities."""
    sns.set_theme(style="white", context="paper")
    plot_vars = [("PM25_RH35", 130.0), ("NO2", 40.0), ("O3", 65.0), ("CO", 550.0)]

    fig, axes = plt.subplots(2, 2, figsize=(15, 8.8), dpi=300)
    axes_flat = axes.ravel()
    labeled_cities = {"hanoi", "bangkok", "tokyo", "cairo", "london", "new_york", "sao_paulo"}

    for ax, (var, vmax_cap) in zip(axes_flat, plot_vars):
        meta = VARIABLE_META[var]
        spatial_mean = np.nanmean(clean_arrays[var], axis=0) * float(meta["to_display"])

        mesh = ax.pcolormesh(
            lons,
            lats,
            spatial_mean,
            cmap=str(meta["cmap"]),
            vmin=0.0,
            vmax=min(vmax_cap, float(np.nanpercentile(spatial_mean, 99.5))),
            shading="auto",
        )
        cbar = fig.colorbar(mesh, ax=ax, fraction=0.028, pad=0.02)
        cbar.set_label(f"{meta['short_label']} ({meta['display_unit']})", fontsize=8.5)

        for roi in HOTSPOT_ROIS:
            rect = mpatches.Rectangle(
                (float(roi["lon_min"]), float(roi["lat_min"])),
                float(roi["lon_max"]) - float(roi["lon_min"]),
                float(roi["lat_max"]) - float(roi["lat_min"]),
                fill=False,
                edgecolor=str(roi["color"]),
                linewidth=1.35,
                linestyle="--",
            )
            ax.add_patch(rect)

        for p in PRESET_LOCATIONS:
            lon_val = float(p["longitude"])
            lat_val = float(p["latitude"])
            ax.scatter(lon_val, lat_val, color="white", edgecolor="black", s=26, zorder=5, linewidth=0.7)
            if str(p["id"]) in labeled_cities:
                ax.text(
                    lon_val + 2.5,
                    lat_val + 1.5,
                    str(p["name"]),
                    color="white",
                    fontsize=7,
                    fontweight="bold",
                    bbox=dict(boxstyle="round,pad=0.15", facecolor="black", alpha=0.55, edgecolor="none"),
                    zorder=6,
                )

        ax.set_title(f"24h Mean Surface {meta['short_label']} ({meta['display_unit']})", fontsize=10.5, fontweight="bold")
        ax.set_xlim(-180, 180)
        ax.set_ylim(-85, 85)
        ax.set_xlabel("Longitude (deg)", fontsize=8.5)
        ax.set_ylabel("Latitude (deg)", fontsize=8.5)

    roi_handles = [
        mpatches.Patch(edgecolor=str(r["color"]), facecolor="none", linestyle="--", linewidth=1.4, label=str(r["name"]))
        for r in HOTSPOT_ROIS
    ]
    fig.legend(handles=roi_handles, loc="lower center", ncol=5, fontsize=8.5, frameon=True, bbox_to_anchor=(0.5, 0.005))
    fig.suptitle(
        "NASA GEOS-CF v2 Global 24h Mean Fields, Preset Jukebox Cities & Candidate Hotspot ROIs (2026-11-12 UTC)",
        fontsize=13,
        fontweight="bold",
        y=0.985,
    )
    fig.tight_layout(rect=(0.0, 0.045, 1.0, 0.965))
    return _finalize_figure(fig, out_path, "Figure 2")


def _plot_fig3_diurnal_presets(
    time_labels: List[str],
    preset_diurnal: Dict[str, Dict[str, Any]],
    out_path: Path,
) -> Path:
    """Fig 3: 24-hour UTC Diurnal Time Series Across 8 Major Preset Cities."""
    sns.set_theme(style="whitegrid", context="paper")
    featured_cities = [
        c for c in ["hanoi", "bangkok", "singapore", "tokyo", "cairo", "london", "new_york", "sao_paulo"]
        if c in preset_diurnal
    ]
    plot_vars = ["PM25_RH35", "NO2", "O3", "CO"]
    hours_x = np.arange(len(time_labels))
    hour_ticks = [t[11:16] for t in time_labels]

    palette = sns.color_palette("tab10", n_colors=max(1, len(featured_cities)))
    fig, axes = plt.subplots(2, 2, figsize=(14.5, 8.8), dpi=300, sharex=True)
    axes_flat = axes.ravel()

    for ax, var in zip(axes_flat, plot_vars):
        meta = VARIABLE_META[var]
        for c_idx, city_id in enumerate(featured_cities):
            city = preset_diurnal[city_id]
            vals = city["variables"][var]["hourly_series"]
            lw = 2.4 if city_id in {"hanoi", "bangkok"} else 1.5
            ax.plot(hours_x, vals, marker="o", markersize=2.8, linewidth=lw, color=palette[c_idx], label=city["name"])

        ax.set_title(f"24h Diurnal Evolution: {meta['short_label']} ({meta['display_unit']})", fontsize=10.5, fontweight="bold")
        ax.set_ylabel(f"{meta['short_label']} ({meta['display_unit']})", fontsize=9)
        ax.set_xticks(hours_x[::3].tolist())
        ax.set_xticklabels(hour_ticks[::3], rotation=30, fontsize=8)

    for ax in axes[1, :]:
        ax.set_xlabel("UTC Hour (2026-11-12)", fontsize=9.5)

    handles, labels = axes_flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=4, fontsize=9, frameon=True, bbox_to_anchor=(0.5, 0.005))
    fig.suptitle(
        "NASA GEOS-CF v2 Hourly Diurnal Signatures Across Preset Jukebox Locations (UTC Solar Phase Shift)",
        fontsize=13,
        fontweight="bold",
        y=0.985,
    )
    fig.tight_layout(rect=(0.0, 0.06, 1.0, 0.965))
    return _finalize_figure(fig, out_path, "Figure 3")


def _plot_fig4_correlations(
    pearson_corr: pd.DataFrame,
    spearman_corr: pd.DataFrame,
    out_path: Path,
) -> Path:
    """Fig 4: Side-by-Side Pearson & Spearman Multi-Pollutant Correlation Heatmaps."""
    sns.set_theme(style="white", context="paper")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12.8, 5.4), dpi=300)

    display_names = [str(VARIABLE_META[v]["short_label"]) for v in CORE_VARIABLES]
    p_df = pearson_corr.copy()
    s_df = spearman_corr.copy()
    p_df.index = pd.Index(display_names)
    p_df.columns = pd.Index(display_names)
    s_df.index = pd.Index(display_names)
    s_df.columns = pd.Index(display_names)

    sns.heatmap(p_df, annot=True, fmt=".3f", cmap="coolwarm", vmin=-1.0, vmax=1.0, center=0.0, square=True, ax=ax1, cbar_kws={"shrink": 0.8})
    ax1.set_title("Pearson Linear Correlation (r)", fontsize=11, fontweight="bold")

    sns.heatmap(s_df, annot=True, fmt=".3f", cmap="coolwarm", vmin=-1.0, vmax=1.0, center=0.0, square=True, ax=ax2, cbar_kws={"shrink": 0.8})
    ax2.set_title("Spearman Rank Correlation (rho)", fontsize=11, fontweight="bold")

    fig.suptitle(
        "Multi-Pollutant Co-Emission & Photochemical Coupling Matrix (Polyphonic Stem Independence Check)",
        fontsize=12.5,
        fontweight="bold",
        y=1.01,
    )
    fig.tight_layout()
    return _finalize_figure(fig, out_path, "Figure 4")


def _plot_fig5_quality_audit(
    clean_arrays: Dict[str, np.ndarray],
    var_metrics: Dict[str, Dict[str, Any]],
    missing_by_lat_band: Dict[str, Dict[str, float]],
    out_path: Path,
) -> Path:
    """Fig 5: Scientific Fill-Value (1e15) Trap & Latitude Missingness Audit."""
    sns.set_theme(style="whitegrid", context="paper")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.8, 5.4), dpi=300)

    pm_clean_valid = clean_arrays["PM25_RH35"][~np.isnan(clean_arrays["PM25_RH35"]) & (clean_arrays["PM25_RH35"] > 0)]
    rng = np.random.default_rng(99)
    pm_clean_sample = (
        rng.choice(pm_clean_valid, size=120_000, replace=False)
        if pm_clean_valid.size > 120_000
        else pm_clean_valid
    )

    fill_count = int(var_metrics["PM25_RH35"]["fill_value_count"])
    nan_count = int(var_metrics["PM25_RH35"]["nan_inf_count"])
    sample_scale = len(pm_clean_sample) / max(1, len(pm_clean_valid))
    scaled_fill_height = max(10, int(round(fill_count * sample_scale))) if fill_count > 0 else 0

    ax1.hist(np.log10(pm_clean_sample), bins=35, color="#1f78b4", alpha=0.82, label="Sanitized Valid PM25_RH35 (< 1e14)")
    ax1.axvline(14.0, color="#d95f02", linestyle="--", linewidth=1.6, label="FILL_VALUE_THRESHOLD (1e14)")
    if fill_count > 0:
        ax1.bar([15.0], [scaled_fill_height], width=0.55, color="#e31a1c", alpha=0.88, label=f"Injected Fill Spike 1e15 (n={fill_count:,})")
    ax1.set_yscale("log")
    ax1.set_xlabel(r"$\log_{10}(\mathrm{Raw\ PM25\_RH35\ [\mu g/m^3]})$", fontsize=9.5)
    ax1.set_ylabel("Cell Count (log scale)", fontsize=9.5)
    ax1.set_title(
        f"Sanitization Audit: Removing 1e15 Fill Values & NaNs (n_fill={fill_count:,}, n_nan={nan_count:,})",
        fontsize=10.5,
        fontweight="bold",
    )
    ax1.legend(loc="upper center", fontsize=8, frameon=True)

    bands = list(missing_by_lat_band.keys())
    band_missing_totals = [missing_by_lat_band[b]["PM25_RH35"] for b in bands]
    colors = ["#4575b4", "#74add1", "#abd9e9", "#fdae61", "#d73027"]

    bars = ax2.barh(bands, band_missing_totals, color=colors, edgecolor="#333333", linewidth=0.6)
    max_missing = max(band_missing_totals) if band_missing_totals else 0.0
    label_offset = max(0.05, max_missing * 0.025)
    for bar, val in zip(bars, band_missing_totals):
        ax2.text(val + label_offset, bar.get_y() + bar.get_height() / 2.0, f"{val:.2f}%", va="center", fontsize=8.5, fontweight="bold")
    ax2.set_xlim(0, max(1.0, max_missing * 1.25))
    ax2.set_xlabel("Missing / Fill-Masked Observations (%)", fontsize=9.5)
    ax2.set_title("Spatial Distribution of Masked Cells by Latitude Band", fontsize=10.5, fontweight="bold")

    fig.suptitle(
        "NASA GEOS-CF v2 Data Hygiene & Missing-Value Safeguard Audit (Zero Fake-Zero Policy)",
        fontsize=12.5,
        fontweight="bold",
        y=1.01,
    )
    fig.tight_layout()
    return _finalize_figure(fig, out_path, "Figure 5")


def render_all_eda_figures(
    eda_out_dir: Path,
    clean_arrays: Dict[str, np.ndarray],
    score_samples: Dict[str, Tuple[np.ndarray, np.ndarray]],
    var_metrics: Dict[str, Dict[str, Any]],
    lats: np.ndarray,
    lons: np.ndarray,
    time_labels: List[str],
    preset_diurnal: Dict[str, Dict[str, Any]],
    pearson_corr: pd.DataFrame,
    spearman_corr: pd.DataFrame,
    missing_by_lat_band: Dict[str, Dict[str, float]],
) -> List[Path]:
    """Renders all five 300-DPI diagnostic figures for the GEOS-CF v2 EDA report."""
    _configure_matplotlib()
    eda_out_dir.mkdir(parents=True, exist_ok=True)
    return [
        _plot_fig1_distributions(score_samples, var_metrics, eda_out_dir / "fig1_distributions_raw_vs_log.png"),
        _plot_fig2_global_heatmaps(clean_arrays, lats, lons, eda_out_dir / "fig2_global_spatial_heatmaps.png"),
        _plot_fig3_diurnal_presets(time_labels, preset_diurnal, eda_out_dir / "fig3_diurnal_timeseries_presets.png"),
        _plot_fig4_correlations(pearson_corr, spearman_corr, eda_out_dir / "fig4_pollutant_correlation_matrix.png"),
        _plot_fig5_quality_audit(clean_arrays, var_metrics, missing_by_lat_band, eda_out_dir / "fig5_missingness_and_quality_audit.png"),
    ]
