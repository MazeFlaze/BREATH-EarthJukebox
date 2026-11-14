#!/usr/bin/env python3
"""
BREATHE - Automated Exploratory Data Analysis (EDA) Pipeline for NASA GEOS-CF v2
Sub-Issue #12 (Parent Issue #11): Data Engineering & Acoustic Calibration

Loads hourly GEOS-CF v2 surface assimilation granules (.nc4) from `DATA_STORAGE_ROOT`,
generates deterministic global calibration granules if none exist locally (preserving
CI fixture dates), performs statistical & missingness audits, quantifies linear vs.
log1p acoustic compression bias, exports `eda_summary_metrics.json`, and renders five
300-DPI diagnostic figures in `backend/src/data/eda_outputs/`.

Usage:
  python backend/scripts/run_eda_geos_cf.py
  python backend/scripts/run_eda_geos_cf.py --regenerate
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Dual-context import path setup (repo root or backend/)
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
for _path in (str(PROJECT_ROOT), str(BACKEND_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

try:
    from backend.src.core.config import settings
    from backend.src.eda import (
        CORE_VARIABLES,
        HOTSPOT_ROIS,
        VARIABLE_META,
        discover_global_granules,
        generate_eda_granules,
        render_all_eda_figures,
        run_eda_pipeline,
    )
except ImportError:
    from src.core.config import settings
    from src.eda import (
        CORE_VARIABLES,
        HOTSPOT_ROIS,
        VARIABLE_META,
        discover_global_granules,
        generate_eda_granules,
        render_all_eda_figures,
        run_eda_pipeline,
    )

__all__ = [
    "CORE_VARIABLES",
    "VARIABLE_META",
    "HOTSPOT_ROIS",
    "generate_eda_granules",
    "discover_global_granules",
    "run_eda_pipeline",
    "render_all_eda_figures",
    "parse_args",
    "main",
]


def parse_args() -> argparse.Namespace:
    """Parses CLI options for raw NetCDF input directory and EDA output destination."""
    parser = argparse.ArgumentParser(
        description="Automated Exploratory Data Analysis (EDA) for NASA GEOS-CF v2 NetCDF-4 granules."
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=settings.DATA_STORAGE_ROOT,
        help="Directory containing GEOS-CF .nc4 granules (default: settings.DATA_STORAGE_ROOT).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=BACKEND_DIR / "src" / "data" / "eda_outputs",
        help="Destination directory for 300-DPI PNG plots and JSON metrics.",
    )
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="Force regeneration of 24-hour 2026-11-12 EDA calibration granules.",
    )
    return parser.parse_args()


def main() -> None:
    """CLI entrypoint executing the GEOS-CF v2 EDA workflow and printing summary metrics."""
    args = parse_args()
    summary = run_eda_pipeline(
        raw_dir=args.raw_dir,
        eda_out_dir=args.out_dir,
        regenerate=args.regenerate,
    )
    print("\n=== BREATHE GEOS-CF v2 EDA SUMMARY ===")
    print(f"Granules analyzed : {summary['granules_analyzed']}")
    print(f"Time range (UTC)  : {summary['time_range_utc']['start']} -> {summary['time_range_utc']['end']}")
    print(f"Grid dimensions   : {summary['grid_dimensions']}")
    for var, info in summary["variables"].items():
        d = info["display_stats"]
        norm = info["normalization_audit"]
        print(
            f"  - {var:10s} [{info['display_unit']:5s}] | "
            f"P05={d['p05']:7.2f} P50={d['p50']:7.2f} P95={d['p95']:7.2f} P99={d['p99']:7.2f} Skew={d['skewness']:5.2f} | "
            f"Lin<=0.15: {norm['linear_pct_in_bottom_15pct']:5.1f}% vs Log1p<=0.15: {norm['log1p_pct_in_bottom_15pct']:5.1f}%"
        )
    print(f"Outputs written to: {args.out_dir}")


if __name__ == "__main__":
    main()
