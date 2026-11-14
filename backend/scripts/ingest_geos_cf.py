#!/usr/bin/env python3
"""
BREATHE NASA Earth Observation Ingestion CLI
Workstream N01: Data Engineering

Usage Examples:
  # Ingest local NetCDF-4 file:
  python backend/scripts/ingest_geos_cf.py --source local --file "/path/to/GEOS.cf.ana.nc4"

  # Ingest remote NASA GEOS-CF data over time window:
  python backend/scripts/ingest_geos_cf.py --source nasa --start "2026-11-13T00:00:00Z" --end "2026-11-13T03:00:00Z" --variables PM25_RH35

  # Dry-run validation:
  python backend/scripts/ingest_geos_cf.py --source local --file "/path/to/data.nc4" --dry-run
"""

import argparse
import sys
from pathlib import Path

# Setup paths so script can run from root or backend/
script_dir = Path(__file__).resolve().parent
backend_dir = script_dir.parent
project_root = backend_dir.parent
for p in [str(project_root), str(backend_dir)]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from backend.src.core.database import SessionLocal, init_db
    from backend.src.services.ingestion_service import ingestion_service
    from backend.src.utils.logger import logger
except ImportError:
    from src.core.database import SessionLocal, init_db
    from src.services.ingestion_service import ingestion_service
    from src.utils.logger import logger


def parse_args():
    parser = argparse.ArgumentParser(
        description="NASA GMAO GEOS-CF Ingestion CLI for BREATHE Earth Information Jukebox."
    )
    parser.add_argument(
        "--source",
        choices=["local", "local-dir", "nasa"],
        required=True,
        help="Ingestion source: 'local' for one file, 'local-dir' for batch directory ingest, 'nasa' for remote retrieval.",
    )
    parser.add_argument(
        "--dir",
        type=str,
        help="Directory of local .nc4 granules (optional for --source local-dir, defaults to DATA_STORAGE_ROOT).",
    )
    parser.add_argument(
        "--file",
        type=str,
        help="Path to local NetCDF-4 file (required if --source local).",
    )
    parser.add_argument(
        "--start",
        type=str,
        help="Start UTC timestamp in ISO 8601 format, e.g. '2026-11-13T00:00:00Z' (required if --source nasa).",
    )
    parser.add_argument(
        "--end",
        type=str,
        help="End UTC timestamp in ISO 8601 format, e.g. '2026-11-13T03:00:00Z' (required if --source nasa).",
    )
    parser.add_argument(
        "--variables",
        nargs="+",
        default=["PM25_RH35"],
        help="Atmospheric variables to verify/extract (default: PM25_RH35).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate NetCDF file without writing records to database.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    init_db()

    with SessionLocal() as db:
        if args.source == "local":
            if not args.file:
                logger.error("Error: --file argument is required when --source is 'local'.")
                sys.exit(1)

            file_path = Path(args.file).resolve()
            if not file_path.exists():
                logger.error(f"Error: Target file not found: {file_path}")
                sys.exit(1)

            try:
                res = ingestion_service.ingest_local_file(
                    file_path=file_path,
                    db=db,
                    dry_run=args.dry_run,
                )
                logger.info("Local Ingestion Succeeded:")
                for k, v in res.items():
                    logger.info(f"  {k}: {v}")
                print(f"\n[SUCCESS] Ingested {file_path.name}")
                sys.exit(0)
            except Exception as e:
                logger.error(f"Ingestion failed: {e}")
                sys.exit(1)

        elif args.source == "local-dir":
            try:
                summary = ingestion_service.ingest_directory(
                    db=db,
                    raw_dir=Path(args.dir).resolve() if args.dir else None,
                    dry_run=args.dry_run,
                )
                print(
                    f"\n[SUCCESS] Batch ingested {summary['ingested']}/{summary['files_found']} files "
                    f"({summary['skipped']} skipped, {summary['materialized_samples']} preset samples)."
                )
                sys.exit(0)
            except Exception as e:
                logger.error(f"Batch ingestion failed: {e}")
                sys.exit(1)

        elif args.source == "nasa":
            if not args.start or not args.end:
                logger.error("Error: Both --start and --end are required when --source is 'nasa'.")
                sys.exit(1)

            try:
                results = ingestion_service.ingest_remote_range(
                    start_time=args.start,
                    end_time=args.end,
                    db=db,
                    variables=args.variables,
                    dry_run=args.dry_run,
                )
                logger.info(f"Remote Ingestion Completed ({len(results)} hours processed):")
                for r in results:
                    status = r.get("status", "ok")
                    ts = r.get("timestamp") or r.get("time_start")
                    logger.info(f"  [{status.upper()}] {ts}")
                print(f"\n[SUCCESS] Remote ingestion completed for {len(results)} granules.")
                sys.exit(0)
            except Exception as e:
                logger.error(f"Remote ingestion failed: {e}")
                sys.exit(1)


if __name__ == "__main__":
    main()
