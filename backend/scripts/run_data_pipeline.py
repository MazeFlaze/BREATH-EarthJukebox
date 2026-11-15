#!/usr/bin/env python3
"""
BREATHE End-to-End NASA GEOS-CF v2 Data Pipeline Orchestrator

Coordinates the full atmospheric data refresh workflow:
  1. Target date discovery (latest available NASA NCCS GEOS-CF v2 UTC date or explicit YYYY-MM-DD)
  2. Granule download + NetCDF-4 validation + SQL/SQLite metadata & preset-station ingestion
  3. Statistical EDA calibration refresh (`eda_summary_metrics.json`; diagnostic plots opt-in)
  4. Equirectangular 1920x1080 map PNG rendering + offline catalog updates

Usage Examples:
  # Preview planned operations for the newest NASA GEOS-CF UTC date without downloading/writing:
  python backend/scripts/run_data_pipeline.py --date latest --dry-run

  # Refresh only local granules -> DB + EDA + offline maps without network calls:
  python backend/scripts/run_data_pipeline.py --local-only --date latest

  # Full remote refresh for a specific UTC date at 3-hour cadence:
  python backend/scripts/run_data_pipeline.py --date 2026-11-12 --step-hours 3 --clean-stale
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

script_dir = Path(__file__).resolve().parent
backend_dir = script_dir.parent
project_root = backend_dir.parent
for p in [str(project_root), str(backend_dir)]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from backend.scripts.render_geos_cf_maps import run_render_pipeline, select_granules_for_date
    from backend.src.core.config import settings
    from backend.src.core.database import SessionLocal, init_db
    from backend.src.eda.eda_analyzer import run_eda_pipeline
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.services.ingestion_service import IngestionService
    from backend.src.utils.logger import logger
except ImportError:
    from scripts.render_geos_cf_maps import run_render_pipeline, select_granules_for_date
    from src.core.config import settings
    from src.core.database import SessionLocal, init_db
    from src.eda.eda_analyzer import run_eda_pipeline
    from src.providers.geos_cf import GEOSCFProvider
    from src.services.ingestion_service import IngestionService
    from src.utils.logger import logger


DEFAULT_VARIABLES = ["PM25_RH35", "NO2", "O3", "CO", "SO2"]


def resolve_pipeline_date(
    requested_date: str,
    raw_dir: Path,
    provider: GEOSCFProvider,
    local_only: bool = False,
    skip_ingest: bool = False,
    dry_run: bool = False,
    lookback_days: int = 7,
) -> Tuple[str, str]:
    """
    Resolves 'latest' or validates an explicit 'YYYY-MM-DD' date string.
    Returns (resolved_yyyy_mm_dd, resolution_source).
    """
    cleaned = (requested_date or "latest").strip()
    if cleaned.lower() != "latest":
        parsed = datetime.strptime(cleaned, "%Y-%m-%d")
        return parsed.strftime("%Y-%m-%d"), "explicit"

    if not local_only and not skip_ingest:
        remote_date = provider.discover_latest_available_date(max_lookback_days=lookback_days)
        if remote_date:
            return remote_date, "remote_head_probe"

    _, local_date = select_granules_for_date(raw_dir=raw_dir, target_date="latest", step_hours=1)
    if local_date:
        return local_date, "local_raw_storage"

    if dry_run:
        fallback = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        return fallback, "utc_yesterday_dry_run_fallback"

    raise RuntimeError(
        "Unable to resolve target NASA GEOS-CF UTC date remotely or from local raw storage. "
        "Pass --date YYYY-MM-DD explicitly or ensure local .nc4 granules exist in raw_dir."
    )


def build_daily_slots(target_date: str, step_hours: int) -> List[str]:
    """Builds UTC :30Z timestamps for target_date at step_hours cadence."""
    base = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    stride = max(1, int(step_hours))
    return [
        (base + timedelta(hours=hour, minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for hour in range(0, 24, stride)
    ]


def run_pipeline(
    date: str = "latest",
    variables: Optional[List[str]] = None,
    step_hours: int = 3,
    raw_dir: Optional[Path] = None,
    output_dir: Optional[Path] = None,
    eda_dir: Optional[Path] = None,
    catalog_root: Optional[Path] = None,
    local_only: bool = False,
    skip_ingest: bool = False,
    skip_eda: bool = False,
    render_eda_plots: bool = False,
    skip_render: bool = False,
    clean_stale: bool = False,
    dry_run: bool = False,
    lookback_days: int = 7,
) -> Dict[str, Any]:
    """Executes the staged ingestion -> EDA -> equirectangular map render pipeline."""
    target_vars = list(variables or DEFAULT_VARIABLES)
    resolved_raw_dir = Path(raw_dir) if raw_dir is not None else settings.DATA_STORAGE_ROOT
    resolved_output_dir = (
        Path(output_dir)
        if output_dir is not None
        else project_root / "frontend" / "public" / "images" / "geos-cf"
    )
    resolved_eda_dir = (
        Path(eda_dir)
        if eda_dir is not None
        else backend_dir / "src" / "data" / "eda_outputs"
    )
    resolved_raw_dir.mkdir(parents=True, exist_ok=True)

    provider = GEOSCFProvider(raw_storage_dir=resolved_raw_dir)
    service = IngestionService(provider=provider)

    target_date, date_source = resolve_pipeline_date(
        requested_date=date,
        raw_dir=resolved_raw_dir,
        provider=provider,
        local_only=local_only,
        skip_ingest=skip_ingest,
        dry_run=dry_run,
        lookback_days=lookback_days,
    )
    planned_slots = build_daily_slots(target_date, step_hours)

    report: Dict[str, Any] = {
        "dry_run": dry_run,
        "local_only": local_only,
        "target_date": target_date,
        "date_source": date_source,
        "step_hours": step_hours,
        "variables": target_vars,
        "raw_dir": str(resolved_raw_dir),
        "output_dir": str(resolved_output_dir),
        "eda_dir": str(resolved_eda_dir),
        "steps": {},
    }

    # Step 1: Download & DB Ingestion
    if skip_ingest:
        report["steps"]["ingest"] = {"status": "skipped"}
    elif dry_run:
        if local_only:
            local_granules, _ = select_granules_for_date(
                raw_dir=resolved_raw_dir,
                target_date=target_date,
                step_hours=step_hours,
            )
            report["steps"]["ingest"] = {
                "status": "dry_run",
                "mode": "local_only",
                "matching_local_files": [p.name for p in local_granules],
            }
        else:
            planned_urls = [
                provider.build_remote_url(datetime.fromisoformat(ts.replace("Z", "+00:00")))
                for ts in planned_slots
            ]
            report["steps"]["ingest"] = {
                "status": "dry_run",
                "mode": "remote",
                "planned_slots": planned_slots,
                "planned_urls": planned_urls,
            }
    else:
        init_db()
        with SessionLocal() as db:
            if local_only:
                compact = target_date.replace("-", "")
                pattern = f"GEOS.cf.ana.*.{compact}_*.nc4"
                if not list(resolved_raw_dir.glob(pattern)):
                    pattern = "GEOS.cf.ana.*.nc4"
                ingest_res = service.ingest_directory(
                    db=db,
                    raw_dir=resolved_raw_dir,
                    pattern=pattern,
                    skip_existing=True,
                )
                report["steps"]["ingest"] = {"status": "completed", "mode": "local_only", **ingest_res}
            else:
                batch_results = service.ingest_remote_range(
                    start_time=f"{target_date}T00:30:00Z",
                    end_time=f"{target_date}T23:30:00Z",
                    db=db,
                    variables=target_vars,
                    dry_run=False,
                    step_hours=step_hours,
                    cleanup_after=True,
                )
                completed = sum(1 for r in batch_results if r.get("status") == "completed")
                failed = [r for r in batch_results if r.get("status") == "failed"]
                report["steps"]["ingest"] = {
                    "status": "completed" if not failed else "partial",
                    "mode": "remote",
                    "requested": len(batch_results),
                    "completed": completed,
                    "failed": len(failed),
                }

    # Step 2: Statistical EDA Metrics Refresh (PNGs opt-in via --render-eda-plots)
    if skip_eda:
        report["steps"]["eda"] = {"status": "skipped"}
    elif dry_run:
        report["steps"]["eda"] = {
            "status": "dry_run",
            "metrics_path": str(resolved_eda_dir / "eda_summary_metrics.json"),
            "render_eda_plots": render_eda_plots,
        }
    else:
        eda_summary = run_eda_pipeline(
            raw_dir=resolved_raw_dir,
            eda_out_dir=resolved_eda_dir,
            regenerate=False,
            render_plots=render_eda_plots,
        )
        report["steps"]["eda"] = {
            "status": "completed",
            "granules_analyzed": eda_summary.get("granules_analyzed", 0),
            "render_eda_plots": render_eda_plots,
            "generated_figures": eda_summary.get("generated_figures", []),
        }

    # Step 3: Render 1920x1080 Equirectangular PNG Maps + Offline JSON Manifests
    if skip_render:
        report["steps"]["render"] = {"status": "skipped"}
    elif dry_run:
        report["steps"]["render"] = {
            "status": "dry_run",
            "target_date": target_date,
            "expected_images": len(planned_slots) * len(target_vars),
            "clean_stale": clean_stale,
            "manifest_path": str(resolved_output_dir / "manifest.json"),
        }
    else:
        render_res = run_render_pipeline(
            raw_dir=resolved_raw_dir,
            output_dir=resolved_output_dir,
            variables=target_vars,
            step_hours=step_hours,
            target_date=target_date,
            clean_stale=clean_stale,
            catalog_root=catalog_root,
        )
        report["steps"]["render"] = {"status": "completed", **render_res}

    return report


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="BREATHE unified NASA GEOS-CF v2 data retrieval, preprocessing, EDA, and map render pipeline."
    )
    parser.add_argument("--date", type=str, default="latest", help="Target UTC date YYYY-MM-DD or 'latest'.")
    parser.add_argument("--variables", nargs="+", default=DEFAULT_VARIABLES)
    parser.add_argument("--step-hours", type=int, default=3, help="Temporal stride in hours (default: 3).")
    parser.add_argument("--raw-dir", type=Path, default=settings.DATA_STORAGE_ROOT)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=project_root / "frontend" / "public" / "images" / "geos-cf",
    )
    parser.add_argument(
        "--eda-dir",
        type=Path,
        default=backend_dir / "src" / "data" / "eda_outputs",
    )
    parser.add_argument("--catalog-root", type=Path, default=None, help="Optional root for generated JSON catalogs.")
    parser.add_argument("--local-only", action="store_true", help="Skip remote NASA downloads and process local raw_dir only.")
    parser.add_argument("--skip-ingest", action="store_true", help="Skip Step 1 (download & DB ingestion).")
    parser.add_argument("--skip-eda", action="store_true", help="Skip Step 2 (EDA metrics refresh).")
    parser.add_argument("--render-eda-plots", action="store_true", help="Also generate gitignored EDA PNG figures.")
    parser.add_argument("--skip-render", action="store_true", help="Skip Step 3 (equirectangular PNG map rendering).")
    parser.add_argument("--clean-stale", action="store_true", help="Delete older geos_cf_*.png files when regenerating.")
    parser.add_argument("--lookback-days", type=int, default=7, help="Days to probe backward when --date latest.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned pipeline execution without downloading or writing.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    args = parse_args(argv)
    logger.info(f"Starting BREATHE data pipeline (date={args.date}, dry_run={args.dry_run}, local_only={args.local_only})")
    result = run_pipeline(
        date=args.date,
        variables=args.variables,
        step_hours=args.step_hours,
        raw_dir=args.raw_dir,
        output_dir=args.output_dir,
        eda_dir=args.eda_dir,
        catalog_root=args.catalog_root,
        local_only=args.local_only,
        skip_ingest=args.skip_ingest,
        skip_eda=args.skip_eda,
        render_eda_plots=args.render_eda_plots,
        skip_render=args.skip_render,
        clean_stale=args.clean_stale,
        dry_run=args.dry_run,
        lookback_days=args.lookback_days,
    )
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
