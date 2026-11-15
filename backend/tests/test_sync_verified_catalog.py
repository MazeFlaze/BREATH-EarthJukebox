"""Tests for backward-probing verified NASA GEOS-CF catalog sync CLI."""
from datetime import datetime, timedelta, timezone
from importlib import import_module
import os
import subprocess
import sys
from pathlib import Path

import httpx
import numpy as np
import pytest
import xarray as xr

try:
    from backend.src.api.schemas.geos_cf_catalog_schema import CatalogEntry, GeosCfCatalog
    from backend.src.core.config import settings
    from backend.src.processors.notebook_demo_processor import POLLUTANTS
    from backend.src.providers import geos_cf_provenance as provenance
    from backend.src.services.scientific_catalog_service import ScientificCatalog
except ImportError:
    from src.api.schemas.geos_cf_catalog_schema import CatalogEntry, GeosCfCatalog
    from src.core.config import settings
    from src.processors.notebook_demo_processor import POLLUTANTS
    from src.providers import geos_cf_provenance as provenance
    from src.services.scientific_catalog_service import ScientificCatalog


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def _import_sync_cli(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.syspath_prepend(str(REPO_ROOT))
    return import_module("backend.scripts.sync_verified_catalog")


def _build_full_grid_netcdf_bytes(scratch_dir: Path, dt: datetime, fill_value: float = 1.0) -> bytes:
    """Create an authentic-format full-grid 721x1440 GEOS-CF AQC NetCDF-4 byte payload."""
    scratch_dir.mkdir(parents=True, exist_ok=True)
    values = np.full((1, 721, 1440), np.float32(fill_value), dtype=np.float32)
    ts64 = np.datetime64(dt.strftime("%Y-%m-%dT%H:%M:%S"))
    ds = xr.Dataset(
        {
            key: (
                ("time", "lat", "lon"),
                values,
                {"units": "ug m-3" if key.startswith("PM") else "mol mol-1"},
            )
            for key in provenance.VARIABLES
        },
        coords={
            "time": [ts64],
            "lat": np.arange(-90.0, 90.25, 0.25),
            "lon": np.arange(-180.0, 180.0, 0.25),
        },
        attrs={"institution": "NASA GMAO", "VersionID": "v2"},
    )
    scratch = scratch_dir / f"payload-{dt.strftime('%Y%m%d_%H%M')}.nc4"
    ds.to_netcdf(scratch, engine="netcdf4")
    payload = scratch.read_bytes()
    scratch.unlink()
    return payload


def _seed_verified_granule(
    archive_dir: Path,
    scratch_dir: Path,
    cli,
    dt: datetime,
    fill_value: float,
) -> Path:
    provider = cli.GEOSCFProvider(raw_storage_dir=archive_dir, preserve_raw=True)
    nc_path = archive_dir / provider.format_granule_filename(dt)
    nc_path.parent.mkdir(parents=True, exist_ok=True)
    nc_path.write_bytes(_build_full_grid_netcdf_bytes(scratch_dir, dt, fill_value=fill_value))
    prov_mod = import_module(cli.GEOSCFProvider.__module__.rsplit(".", 1)[0] + ".geos_cf_provenance")
    prov_mod.write_receipt(nc_path, provider.build_remote_url(dt))
    return nc_path


def _patch_provider_http(monkeypatch: pytest.MonkeyPatch, cli, handler) -> None:
    provider_module = import_module(cli.GEOSCFProvider.__module__)
    real_client = httpx.Client
    monkeypatch.setattr(
        provider_module.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(provider_module.time, "sleep", lambda *_: None)


def test_latest_midpoint_utc_computes_expected_30z_boundary(monkeypatch):
    cli = _import_sync_cli(monkeypatch)
    assert cli.latest_midpoint_utc(datetime(2026, 11, 15, 10, 15, tzinfo=timezone.utc)) == datetime(
        2026, 11, 15, 9, 30, tzinfo=timezone.utc
    )
    assert cli.latest_midpoint_utc(datetime(2026, 11, 15, 10, 30, tzinfo=timezone.utc)) == datetime(
        2026, 11, 15, 10, 30, tzinfo=timezone.utc
    )
    assert cli.latest_midpoint_utc(datetime(2026, 11, 15, 10, 45, tzinfo=timezone.utc)) == datetime(
        2026, 11, 15, 10, 30, tzinfo=timezone.utc
    )
    assert cli.latest_midpoint_utc(datetime(2026, 11, 15, 0, 5, tzinfo=timezone.utc)) == datetime(
        2026, 11, 14, 23, 30, tzinfo=timezone.utc
    )


def test_sync_probes_past_missing_edge_reuses_cache_and_prunes_after_index(
    tmp_path, monkeypatch, capsys
):
    cli = _import_sync_cli(monkeypatch)
    archive_dir = tmp_path / "archive"
    output = tmp_path / "catalog"
    scratch_dir = tmp_path / "scratch"
    end_utc = datetime(2026, 11, 15, 0, 30, tzinfo=timezone.utc)

    # Ensure MAX_RAW_FILES_TO_KEEP on cli's settings module cannot evict granules during fetch loop.
    cli_config = import_module(cli.GEOSCFProvider.__module__.rsplit(".", 2)[0] + ".core.config")
    monkeypatch.setattr(cli_config.settings, "MAX_RAW_FILES_TO_KEEP", 1)
    monkeypatch.setattr(cli.settings, "MAX_RAW_FILES_TO_KEEP", 1)

    stale_dt = end_utc - timedelta(hours=40)
    stale_nc = _seed_verified_granule(archive_dir, scratch_dir, cli, stale_dt, fill_value=0.5)
    stale_receipt = provenance.receipt_path(stale_nc)
    assert stale_nc.exists() and stale_receipt.exists()

    # Cached valid granule inside the 3h target window (skipped at 00:30Z -> window is 23:30, 22:30, 21:30).
    cached_dt = end_utc - timedelta(hours=2)  # 2026-11-14T22:30:00Z
    cached_nc = _seed_verified_granule(archive_dir, scratch_dir, cli, cached_dt, fill_value=2.0)

    # Seed stale 64-hex output dir and unrelated marker file.
    old_hash = "0" * 64
    old_hash_dir = output / old_hash
    old_hash_dir.mkdir(parents=True)
    (old_hash_dir / "detail.json").write_text("{}", encoding="utf-8")
    keep_note = output / "keep-note.txt"
    keep_note.write_text("preserve me\n", encoding="utf-8")

    hour_newest_missing = end_utc  # 2026-11-15T00:30:00Z -> HTTP 404
    hour_fetch_1 = end_utc - timedelta(hours=1)  # 2026-11-14T23:30:00Z -> HTTP 200
    hour_fetch_2 = end_utc - timedelta(hours=3)  # 2026-11-14T21:30:00Z -> HTTP 200

    payloads = {
        hour_fetch_1.strftime("%Y%m%d_%H%Mz"): _build_full_grid_netcdf_bytes(
            scratch_dir, hour_fetch_1, fill_value=3.0
        ),
        hour_fetch_2.strftime("%Y%m%d_%H%Mz"): _build_full_grid_netcdf_bytes(
            scratch_dir, hour_fetch_2, fill_value=1.0
        ),
    }

    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        requested_urls.append(url)
        if hour_newest_missing.strftime("%Y%m%d_%H%Mz") in url:
            return httpx.Response(404)
        for token, data in payloads.items():
            if token in url:
                return httpx.Response(200, content=data, headers={"Content-Length": str(len(data))})
        return httpx.Response(404)

    _patch_provider_http(monkeypatch, cli, handler)

    provider_inits: list[dict] = []
    fetch_calls: list[tuple[str, bool]] = []
    real_provider_cls = cli.GEOSCFProvider

    class SpyGEOSCFProvider(real_provider_cls):
        def __init__(self, *args, **kwargs):
            provider_inits.append(kwargs)
            super().__init__(*args, **kwargs)

        def fetch_granule(self, timestamp: str, target_dir: Path | None = None, auto_cleanup: bool = True) -> Path:
            fetch_calls.append((timestamp, auto_cleanup))
            return super().fetch_granule(timestamp, target_dir=target_dir, auto_cleanup=auto_cleanup)

    monkeypatch.setattr(cli, "GEOSCFProvider", SpyGEOSCFProvider)

    # Verify pruning runs ONLY after index.json is updated with the 3 new entries.
    prune_observations: list[int] = []
    real_prune = cli.prune_catalog_output

    def tracked_prune(out_dir: Path, keep_hashes: set[str]) -> list[str]:
        current = GeosCfCatalog.model_validate_json((out_dir / "index.json").read_text(encoding="utf-8"))
        prune_observations.append(current.ready_count)
        assert {e.id for e in current.entries if e.status == "ready"} == keep_hashes
        return real_prune(out_dir, keep_hashes)

    monkeypatch.setattr(cli, "prune_catalog_output", tracked_prune)

    catalog = cli.sync_catalog(
        latest_hours=3,
        max_probe_hours=6,
        archive_dir=archive_dir,
        output=output,
        reference_contract=None,
        scientific_only=True,
        append=False,
        end_utc=end_utc,
    )

    assert provider_inits == [{"raw_storage_dir": archive_dir, "preserve_raw": True}]
    assert [auto for _, auto in fetch_calls] == [False, False, False, False]
    assert prune_observations == [3]
    assert not any(cached_dt.strftime("%Y%m%d_%H%Mz") in u for u in requested_urls)
    assert any(hour_newest_missing.strftime("%Y%m%d_%H%Mz") in u for u in requested_urls)
    assert any(hour_fetch_1.strftime("%Y%m%d_%H%Mz") in u for u in requested_urls)
    assert any(hour_fetch_2.strftime("%Y%m%d_%H%Mz") in u for u in requested_urls)

    assert catalog.ready_count == 3
    index_data = GeosCfCatalog.model_validate_json((output / "index.json").read_text(encoding="utf-8"))
    assert index_data.ready_count == 3
    assert [e.timestamp_utc for e in index_data.entries] == [
        "2026-11-14T21:30:00Z",
        "2026-11-14T22:30:00Z",
        "2026-11-14T23:30:00Z",
    ]
    assert ScientificCatalog(output).read().ready_count == 3

    for entry in index_data.entries:
        snap_dir = output / entry.id
        assert (snap_dir / "detail.json").exists()
        for key in POLLUTANTS:
            assert (snap_dir / f"native-{key}.f32").exists()
        assert entry.snapshot_url is None
        assert not (snap_dir / "snapshot.json").exists()

    assert not list(output.rglob("*.png"))
    assert not stale_nc.exists()
    assert not stale_receipt.exists()
    assert cached_nc.exists() and provenance.receipt_path(cached_nc).exists()
    assert not old_hash_dir.exists()
    assert keep_note.read_text(encoding="utf-8") == "preserve me\n"
    assert f"Synced=3; Ready=3; Output={output}" in capsys.readouterr().out


def test_sync_append_retains_existing_granules_and_catalog_directories(tmp_path, monkeypatch):
    cli = _import_sync_cli(monkeypatch)
    archive_dir = tmp_path / "archive"
    output = tmp_path / "catalog"
    scratch_dir = tmp_path / "scratch"

    older_dt = datetime(2026, 11, 13, 8, 30, tzinfo=timezone.utc)
    older_nc = _seed_verified_granule(archive_dir, scratch_dir, cli, older_dt, fill_value=1.5)
    older_hash = provenance.checksum_file(older_nc)

    # Pre-seed older catalog directory and an extra existing hash directory.
    extra_hash_dir = output / ("b" * 64)
    extra_hash_dir.mkdir(parents=True)
    (extra_hash_dir / "detail.json").write_text("{}", encoding="utf-8")

    newer_dt = datetime(2026, 11, 15, 0, 30, tzinfo=timezone.utc)
    newer_payload = _build_full_grid_netcdf_bytes(scratch_dir, newer_dt, fill_value=2.5)

    def handler(request: httpx.Request) -> httpx.Response:
        if newer_dt.strftime("%Y%m%d_%H%Mz") in str(request.url):
            return httpx.Response(200, content=newer_payload, headers={"Content-Length": str(len(newer_payload))})
        return httpx.Response(404)

    _patch_provider_http(monkeypatch, cli, handler)

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "sync_verified_catalog",
            "--latest-hours",
            "1",
            "--max-probe-hours",
            "3",
            "--archive-dir",
            str(archive_dir),
            "--output",
            str(output),
            "--scientific-only",
            "--append",
            "--end-utc",
            "2026-11-15T00:30:00Z",
        ],
    )
    cli.main()

    index_data = GeosCfCatalog.model_validate_json((output / "index.json").read_text(encoding="utf-8"))
    assert index_data.ready_count == 2
    assert [e.timestamp_utc for e in index_data.entries] == [
        "2026-11-13T08:30:00Z",
        "2026-11-15T00:30:00Z",
    ]
    assert older_nc.exists() and provenance.receipt_path(older_nc).exists()
    assert (output / older_hash / "detail.json").exists()
    assert extra_hash_dir.exists()
    newer_entry = [e for e in index_data.entries if e.timestamp_utc == "2026-11-15T00:30:00Z"][0]
    assert (output / newer_entry.id / "detail.json").exists()


def test_sync_total_probe_failure_exits_nonzero_without_modifying_existing_catalog(
    tmp_path, monkeypatch, capsys
):
    cli = _import_sync_cli(monkeypatch)
    archive_dir = tmp_path / "archive"
    archive_dir.mkdir(parents=True)
    output = tmp_path / "catalog"
    existing_hash = "c" * 64
    existing_dir = output / existing_hash
    existing_dir.mkdir(parents=True)
    (existing_dir / "detail.json").write_text('{"preserved":true}', encoding="utf-8")

    existing_catalog = GeosCfCatalog(
        generated_at="2026-11-14T00:00:00Z",
        entries=[
            CatalogEntry(
                id=existing_hash,
                filename="GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261114_0030z.R0.nc4",
                timestamp_utc="2026-11-14T00:30:00Z",
                sha256=existing_hash,
                size_bytes=1024,
                status="ready",
                provenance="download_receipt",
            )
        ],
        gaps=[],
        ready_count=1,
    )
    index_path = output / "index.json"
    original_bytes = existing_catalog.model_dump_json(indent=2).encode("utf-8")
    index_path.write_bytes(original_bytes)

    _patch_provider_http(monkeypatch, cli, lambda _: httpx.Response(404))

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "sync_verified_catalog",
            "--latest-hours",
            "2",
            "--max-probe-hours",
            "3",
            "--archive-dir",
            str(archive_dir),
            "--output",
            str(output),
            "--scientific-only",
            "--end-utc",
            "2026-11-15T00:30:00Z",
        ],
    )
    with pytest.raises(SystemExit) as exc:
        cli.main()

    assert exc.value.code != 0
    assert index_path.read_bytes() == original_bytes
    assert (existing_dir / "detail.json").exists()
    assert capsys.readouterr().err.strip()


def test_sync_tolerates_transient_http_and_validation_errors_while_probing(tmp_path, monkeypatch):
    cli = _import_sync_cli(monkeypatch)
    archive_dir = tmp_path / "archive"
    output = tmp_path / "catalog"
    scratch_dir = tmp_path / "scratch"
    end_utc = datetime(2026, 11, 15, 0, 30, tzinfo=timezone.utc)

    valid_dt = end_utc - timedelta(hours=2)
    valid_payload = _build_full_grid_netcdf_bytes(scratch_dir, valid_dt, fill_value=4.0)

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if end_utc.strftime("%Y%m%d_%H%Mz") in url:
            raise httpx.ConnectError("simulated transient network error", request=request)
        if (end_utc - timedelta(hours=1)).strftime("%Y%m%d_%H%Mz") in url:
            return httpx.Response(200, content=b"not a valid netcdf", headers={"Content-Length": "18"})
        if valid_dt.strftime("%Y%m%d_%H%Mz") in url:
            return httpx.Response(200, content=valid_payload, headers={"Content-Length": str(len(valid_payload))})
        return httpx.Response(404)

    _patch_provider_http(monkeypatch, cli, handler)

    catalog = cli.sync_catalog(
        latest_hours=1,
        max_probe_hours=4,
        archive_dir=archive_dir,
        output=output,
        reference_contract=tmp_path / "missing-contract.json",
        scientific_only=True,
        append=False,
        end_utc=end_utc,
    )
    assert catalog.ready_count == 1
    assert catalog.entries[0].timestamp_utc == "2026-11-14T22:30:00Z"


def test_cli_flags_and_module_entrypoint_parse_cleanly(tmp_path, monkeypatch):
    cli = _import_sync_cli(monkeypatch)
    args = cli.parse_args(
        [
            "--latest-hours",
            "3",
            "--max-probe-hours",
            "12",
            "--archive-dir",
            str(tmp_path / "arch"),
            "--output",
            str(tmp_path / "out"),
            "--reference-contract",
            str(tmp_path / "contract.json"),
            "--scientific-only",
            "--append",
            "--end-utc",
            "2026-11-15T00:30:00Z",
        ]
    )
    assert args.latest_hours == 3
    assert args.max_probe_hours == 12
    assert args.archive_dir == tmp_path / "arch"
    assert args.output == tmp_path / "out"
    assert args.reference_contract == tmp_path / "contract.json"
    assert args.scientific_only is True
    assert args.append is True
    assert args.end_utc == "2026-11-15T00:30:00Z"

    existing_contract = tmp_path / "contract.json"
    existing_contract.write_text("{}", encoding="utf-8")
    assert cli.resolve_reference_contract(existing_contract) == existing_contract
    assert cli.resolve_reference_contract(tmp_path / "absent.json") is None

    python_exe = sys.executable
    root_help = subprocess.run(
        [python_exe, "-m", "backend.scripts.sync_verified_catalog", "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    for flag in (
        "--latest-hours",
        "--max-probe-hours",
        "--archive-dir",
        "--output",
        "--reference-contract",
        "--scientific-only",
        "--append",
        "--end-utc",
    ):
        assert flag in root_help.stdout

    env = {**os.environ, "PYTHONPATH": "src:."}
    backend_help = subprocess.run(
        [python_exe, "scripts/sync_verified_catalog.py", "--help"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "--scientific-only" in backend_help.stdout


def test_sync_restores_previous_index_when_export_produces_zero_ready(tmp_path, monkeypatch):
    cli = _import_sync_cli(monkeypatch)
    archive_dir = tmp_path / "archive"
    scratch_dir = tmp_path / "scratch"
    output = tmp_path / "catalog"
    output.mkdir(parents=True, exist_ok=True)
    dt = datetime(2026, 11, 14, 22, 30, tzinfo=timezone.utc)
    _seed_verified_granule(archive_dir, scratch_dir, cli, dt, fill_value=2.0)

    previous_hash = "d" * 64
    stale_dir = output / previous_hash
    stale_dir.mkdir(parents=True)
    (stale_dir / "detail.json").write_text('{"keep":true}', encoding="utf-8")
    existing_index = output / "index.json"
    existing_bytes = b'{"ready_count":1,"preserved":true}'
    existing_index.write_bytes(existing_bytes)

    def zero_ready_export(roots, dest, reference_path=None, *, scientific_only=False):
        (dest / "index.json").write_text('{"ready_count":0}', encoding="utf-8")
        return GeosCfCatalog(generated_at="2026-11-15T00:00:00Z", entries=[], gaps=[], ready_count=0)

    monkeypatch.setattr(cli, "export_catalog", zero_ready_export)
    with pytest.raises(SystemExit) as exc:
        cli.sync_catalog(
            latest_hours=1,
            max_probe_hours=1,
            archive_dir=archive_dir,
            output=output,
            reference_contract=tmp_path / "missing-contract.json",
            scientific_only=True,
            append=False,
            end_utc=dt,
        )
    assert exc.value.code == 1
    assert existing_index.read_bytes() == existing_bytes
    assert stale_dir.is_dir()
