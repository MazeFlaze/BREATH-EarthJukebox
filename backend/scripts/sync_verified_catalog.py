"""Probe NASA NCCS backward for verified GEOS-CF v2 granules and sync the web catalog."""
import argparse
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

import httpx

try:
    from backend.src.api.schemas.geos_cf_catalog_schema import GeosCfCatalog
    from backend.src.core.config import settings
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.providers.geos_cf_provenance import receipt_path
    from backend.src.services.geos_cf_catalog_service import export_catalog
    from backend.src.utils.logger import logger
except ImportError:
    from src.api.schemas.geos_cf_catalog_schema import GeosCfCatalog
    from src.core.config import settings
    from src.providers.geos_cf import GEOSCFProvider
    from src.providers.geos_cf_provenance import receipt_path
    from src.services.geos_cf_catalog_service import export_catalog
    from src.utils.logger import logger

_HEX64_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def latest_midpoint_utc(reference_now: datetime | None = None) -> datetime:
    """Return the latest :30Z UTC hourly midpoint timestamp <= reference_now."""
    now = reference_now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)
    shifted = now - timedelta(minutes=30)
    floored = shifted.replace(minute=0, second=0, microsecond=0)
    return floored + timedelta(minutes=30)


def _parse_utc_datetime(raw: str) -> datetime:
    normalized = raw.strip()
    if normalized.endswith(("Z", "z")):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def resolve_reference_contract(reference_contract: Path | None = None) -> Path | None:
    """Resolve an optional notebook-demo reference contract, returning None when absent."""
    if reference_contract is not None:
        return reference_contract if reference_contract.exists() else None
    script_path = Path(__file__).resolve()
    if len(script_path.parents) > 2:
        repo_default = script_path.parents[2] / "frontend" / "public" / "data" / "notebook-demo" / "contract.json"
        if repo_default.exists():
            return repo_default
    cwd_default = Path("frontend/public/data/notebook-demo/contract.json")
    return cwd_default if cwd_default.exists() else None


def _stage_file(source: Path, destination: Path) -> None:
    try:
        os.link(source, destination)
        return
    except OSError:
        pass
    try:
        destination.symlink_to(source.resolve())
        return
    except OSError:
        pass
    shutil.copy2(source, destination)


def _stage_selected_window(selected: list[Path], stage_dir: Path) -> None:
    for nc_path in selected:
        _stage_file(nc_path, stage_dir / nc_path.name)
        sidecar = receipt_path(nc_path)
        if sidecar.exists():
            _stage_file(sidecar, stage_dir / sidecar.name)


def prune_catalog_output(output: Path, keep_hashes: set[str]) -> list[str]:
    """Delete stale 64-hex snapshot directories from output without touching non-hash files."""
    if not output.exists():
        return []
    removed: list[str] = []
    for child in sorted(output.iterdir()):
        if not child.is_dir() or not _HEX64_PATTERN.fullmatch(child.name):
            continue
        if child.name not in keep_hashes:
            shutil.rmtree(child)
            removed.append(child.name)
    return removed


def prune_archive_dir(archive_dir: Path, keep_paths: list[Path]) -> list[Path]:
    """Delete stale raw NetCDF granules and .source.json sidecars outside the selected window."""
    if not archive_dir.exists():
        return []
    keep_resolved = {path.resolve() for path in keep_paths}
    keep_sidecars = {receipt_path(path).resolve() for path in keep_resolved}
    removed: list[Path] = []
    for candidate in sorted(archive_dir.rglob("*")):
        if ".validation" in candidate.parts or not candidate.is_file():
            continue
        resolved = candidate.resolve()
        is_netcdf = candidate.suffix.lower() in {".nc", ".nc4"}
        is_sidecar = candidate.name.endswith(".source.json")
        if (is_netcdf and resolved not in keep_resolved) or (is_sidecar and resolved not in keep_sidecars):
            candidate.unlink()
            removed.append(candidate)
    return removed


def sync_catalog(
    *,
    latest_hours: int = 24,
    max_probe_hours: int = 72,
    archive_dir: Path = settings.NASA_ARCHIVE_ROOT,
    output: Path = settings.GEOS_CF_CATALOG_ROOT,
    reference_contract: Path | None = None,
    scientific_only: bool = False,
    append: bool = False,
    end_utc: datetime | str | None = None,
) -> GeosCfCatalog:
    """Probe backward for latest verified GEOS-CF granules, export catalog, and optionally prune."""
    if latest_hours < 1:
        raise ValueError("--latest-hours must be >= 1")
    if max_probe_hours < 1:
        raise ValueError("--max-probe-hours must be >= 1")

    reference_dt = _parse_utc_datetime(end_utc) if isinstance(end_utc, str) else end_utc
    anchor = latest_midpoint_utc(reference_dt)

    provider = GEOSCFProvider(raw_storage_dir=archive_dir, preserve_raw=True)
    selected: list[Path] = []
    seen_paths: set[Path] = set()

    for offset in range(max_probe_hours):
        if len(selected) >= latest_hours:
            break
        probe_dt = anchor - timedelta(hours=offset)
        iso_ts = probe_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            granule_path = provider.fetch_granule(iso_ts, auto_cleanup=False)
        except (RuntimeError, httpx.HTTPError, OSError, ValueError) as exc:
            logger.warning(f"Skipping {iso_ts}: {exc}")
            continue
        resolved = granule_path.resolve()
        if resolved not in seen_paths:
            seen_paths.add(resolved)
            selected.append(resolved)

    if not selected:
        print(
            f"Error: 0 verified GEOS-CF granules found after probing {max_probe_hours} hours from "
            f"{anchor.strftime('%Y-%m-%dT%H:%M:%SZ')}.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    resolved_reference = resolve_reference_contract(reference_contract)
    index_file = output / "index.json"
    previous_index = index_file.read_bytes() if index_file.exists() else None
    if append:
        exported = export_catalog(
            [archive_dir],
            output,
            resolved_reference,
            scientific_only=scientific_only,
        )
    else:
        with tempfile.TemporaryDirectory(prefix="breathe-sync-window-") as tmp_dir:
            stage_dir = Path(tmp_dir)
            _stage_selected_window(selected, stage_dir)
            exported = export_catalog(
                [stage_dir],
                output,
                resolved_reference,
                scientific_only=scientific_only,
            )

    if exported.ready_count <= 0:
        if previous_index is not None:
            tmp_restore = output / "index.tmp"
            tmp_restore.write_bytes(previous_index)
            tmp_restore.replace(index_file)
        print("Error: Catalog export produced 0 ready snapshots; skipping prune.", file=sys.stderr)
        raise SystemExit(1)

    if not append:
        keep_hashes = {entry.id for entry in exported.entries if entry.status == "ready"}
        prune_catalog_output(output, keep_hashes)
        prune_archive_dir(archive_dir, selected)

    print(f"Synced={len(selected)}; Ready={exported.ready_count}; Output={output}", flush=True)
    return exported


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--latest-hours",
        type=int,
        default=24,
        help="Target number of latest available hourly :30Z granules to sync (default: 24)",
    )
    parser.add_argument(
        "--max-probe-hours",
        type=int,
        default=72,
        help="Maximum hourly steps to probe backward from anchor UTC (default: 72)",
    )
    parser.add_argument(
        "--archive-dir",
        type=Path,
        default=settings.NASA_ARCHIVE_ROOT,
        help="Local verified NASA archive directory",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=settings.GEOS_CF_CATALOG_ROOT,
        help="Destination catalog output directory",
    )
    parser.add_argument(
        "--reference-contract",
        type=Path,
        default=None,
        help="Optional notebook-demo contract.json path",
    )
    parser.add_argument(
        "--scientific-only",
        action="store_true",
        help="Export index, detail manifests, and native float32 grids without legacy snapshot PNGs",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Retain existing archive granules and catalog hash directories instead of mirroring",
    )
    parser.add_argument(
        "--end-utc",
        type=str,
        default=None,
        help="Optional UTC ISO anchor timestamp for backward probing (defaults to current UTC)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    try:
        sync_catalog(
            latest_hours=args.latest_hours,
            max_probe_hours=args.max_probe_hours,
            archive_dir=args.archive_dir,
            output=args.output,
            reference_contract=args.reference_contract,
            scientific_only=args.scientific_only,
            append=args.append,
            end_utc=args.end_utc,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
