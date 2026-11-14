"""Offline archive inventory and incremental export. No network or synthetic fallback."""
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..api.schemas.geos_cf_catalog_schema import CatalogEntry, CatalogGap, CatalogSnapshot, FocusFeature, GeosCfCatalog
from ..api.schemas.notebook_demo_schema import NotebookDemoContract
from ..processors.notebook_demo_processor import NotebookDemoProcessor
from ..processors.notebook_demo_maps import render_maps
from .geos_cf_detail_service import export_detail
from ..providers.geos_cf_provenance import DownloadReceipt, NCCS_PREFIX, PRODUCT, checksum_file, inspect_asset, valid_receipt


def inventory(roots: list[Path], reference: NotebookDemoContract | None = None) -> tuple[list[CatalogEntry], dict[str, Path]]:
    entries: list[CatalogEntry] = []
    accepted: dict[str, Path] = {}
    seen: set[Path] = set()
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.nc*")):
            if path.suffix.lower() not in {".nc", ".nc4"} or ".validation" in path.parts or path.resolve() in seen:
                continue
            seen.add(path.resolve())
            digest = checksum_file(path)
            record = CatalogEntry(id=digest, filename=path.name, sha256=digest, size_bytes=path.stat().st_size, status="unverified")
            try:
                info = inspect_asset(path)
                record.timestamp_utc = info["timestamp_utc"]
                record.variables = info["variables"]
                record.grid_shape = info["grid_shape"]
                receipt = valid_receipt(path, digest, info["timestamp_utc"])
                if receipt:
                    record.provenance = "download_receipt"
                    record.source_url = receipt.source_url
                elif (reference and not reference.isMock and reference.source.collection == PRODUCT
                      and (reference.source.source_url or "").startswith(NCCS_PREFIX)
                      and digest == reference.source.sha256 and info["timestamp_utc"] == reference.source.timestamp_utc):
                    record.provenance = "notebook_reference"
                    record.source_url = reference.source.source_url
                else:
                    record.reason = "Valid structure but no matching download receipt or notebook-reference hash"
                if record.provenance != "unverified":
                    if digest in accepted:
                        record.status = "duplicate"
                        record.reason = "Identical source bytes; not another timestamp"
                    else:
                        record.status = "ready"
                        accepted[digest] = path
            except (ValueError, OSError, KeyError) as exc:
                record.status = "invalid"
                record.reason = str(exc)
            entries.append(record)
        # Retain evidence of evicted/missing files without offering their data for playback.
        for sidecar in sorted(root.rglob("*.nc4.source.json")):
            raw = sidecar.with_name(sidecar.name.removesuffix(".source.json"))
            if raw.exists() or ".validation" in sidecar.parts:
                continue
            try:
                receipt = DownloadReceipt.model_validate_json(sidecar.read_text(encoding="utf-8"))
                entries.append(CatalogEntry(id=receipt.sha256, filename=raw.name, sha256=receipt.sha256,
                    timestamp_utc=receipt.timestamp_utc, status="missing", provenance="download_receipt",
                    source_url=receipt.source_url, reason="Receipt exists but raw file is missing; not playable"))
            except (ValueError, OSError):
                continue
    by_time: dict[str, set[str]] = {}
    for record in entries:
        if record.status == "ready":
            by_time.setdefault(record.timestamp_utc or "", set()).add(record.id)
    for record in entries:
        if record.status == "ready" and len(by_time[record.timestamp_utc or ""]) > 1:
            record.status = "conflict"
            record.reason = "Different checksums share this timestamp; resolve the revision explicitly"
            accepted.pop(record.id, None)
    return entries, accepted


def focus_features(contract: NotebookDemoContract, fields: dict) -> dict[str, dict[str, FocusFeature]]:
    result = {}
    for key, da in fields.items():
        features = {}
        plans = contract.global_plans[key] + contract.region_plans[key]
        maximum = contract.pollutants[key].audio_max
        for event in plans:
            science = event.scientific
            lat, lon = science.bounds.lat, science.bounds.lon
            north = lat[1] == 90
            subset = da.where((da.lat >= lat[0]) & ((da.lat <= lat[1]) if north else (da.lat < lat[1])), drop=True)
            subset = subset.where((da.lon >= lon[0]) & (da.lon < lon[1]), drop=True)
            values = np.asarray(subset).ravel()
            values = values[np.isfinite(values)]
            # Quantiles describe valid grid cells; only mean is cosine-latitude weighted.
            p90 = float(np.percentile(values, 90)) if values.size else None
            iqr = float(np.percentile(values, 75) - np.percentile(values, 25)) if values.size else None
            row, col = int((90 - lat[1]) / 45), int((lon[0] + 180) / 45)
            features[science.scan_id] = FocusFeature(
                cell_id=f"r{row}c{col}" if event.variation_kind == "spatial_contrast" else f"region:{science.scan_id}",
                p90=p90, iqr=iqr, spread_score=min(1, (iqr or 0) / maximum), neighbor_contrast=0,
                coverage=science.valid_cells / science.total_cells if science.total_cells else 0,
            )
        grid = {features[e.scientific.scan_id].cell_id: e.scientific.score for e in contract.global_plans[key]}
        for event in contract.global_plans[key]:
            science = event.scientific
            if science.score is None:
                continue
            row = int((90 - science.bounds.lat[1]) / 45)
            col = int((science.bounds.lon[0] + 180) / 45)
            neighbor_ids = [f"r{row}c{(col - 1) % 8}", f"r{row}c{(col + 1) % 8}"]
            neighbor_ids += [f"r{r}c{col}" for r in (row - 1, row + 1) if 0 <= r < 4]
            neighbors = [grid[cell] for cell in neighbor_ids if grid[cell] is not None]
            features[science.scan_id].neighbor_contrast = min(1, abs(science.score - float(np.mean(neighbors)))) if neighbors else 0
        result[key] = features
    return result


def export_catalog(roots: list[Path], output: Path, reference_path: Path | None = None) -> GeosCfCatalog:
    reference = NotebookDemoContract.model_validate_json(reference_path.read_text(encoding="utf-8")) if reference_path and reference_path.exists() else None
    entries, accepted = inventory(roots, reference)
    output.mkdir(parents=True, exist_ok=True)
    for index, record in enumerate([e for e in entries if e.status == "ready"]):
        print(f"Export [{index + 1}/{len(accepted)}] {record.timestamp_utc} {record.filename}", flush=True)
        destination = output / record.id
        snapshot_path = destination / "snapshot.json"
        prefix = f"/data/{output.name}/{record.id}"
        if snapshot_path.exists():
            try:
                previous = CatalogSnapshot.model_validate_json(snapshot_path.read_text(encoding="utf-8"))
                if previous.baseline.source.sha256 != record.id or previous.baseline.map_urls.get("co") != f"{prefix}/co.png":
                    raise ValueError("Cache version mismatch")
                if not all((destination / f"{key}.png").exists() for key in previous.baseline.pollutants):
                    raise ValueError("Incomplete raster cache")
            except (OSError, ValueError):
                snapshot_path = destination / "snapshot.json"
            else:
                record.snapshot_url = f"{prefix}/snapshot.json"
                record.detail_url = export_detail(accepted[record.id], previous.baseline, destination, prefix)
                continue
        contract, fields = NotebookDemoProcessor.build(accepted[record.id], record.id, is_mock=False, source_url=record.source_url)
        contract.map_urls = {key: f"{prefix}/{key}.png" for key in fields}
        snapshot = CatalogSnapshot(baseline=contract, features=focus_features(contract, fields))
        render_maps(contract, fields, destination)
        temporary = destination / "snapshot.tmp"
        temporary.write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(destination / "snapshot.json")
        record.snapshot_url = f"{prefix}/snapshot.json"
        record.detail_url = export_detail(accepted[record.id], contract, destination, prefix, fields)
    ready = sorted((e for e in entries if e.status == "ready"), key=lambda entry: entry.timestamp_utc or "")
    gaps = []
    for first, second in zip(ready, ready[1:]):
        hours = (pd.Timestamp(second.timestamp_utc) - pd.Timestamp(first.timestamp_utc)).total_seconds() / 3600
        if hours > 1:
            gaps.append(CatalogGap(after=first.timestamp_utc, before=second.timestamp_utc, missing_hours=max(1, int(hours) - 1)))
    catalog = GeosCfCatalog(generated_at=datetime.now(timezone.utc).isoformat(), entries=entries, gaps=gaps, ready_count=len(ready))
    temporary = output / "index.tmp"
    temporary.write_text(catalog.model_dump_json(indent=2), encoding="utf-8")
    temporary.replace(output / "index.json")
    return catalog
