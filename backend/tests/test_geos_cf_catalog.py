"""Archive integrity tests use isolated fixtures and mocked HTTP, never NASA downloads."""
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import numpy as np
import pytest
import xarray as xr

try:
    from backend.src.providers import geos_cf_provenance as provenance
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.services import geos_cf_catalog_service as catalog
    from backend.src.services.ingestion_service import IngestionService
    from backend.src.api.schemas.notebook_demo_schema import NotebookDemoContract
except ImportError:
    from src.providers import geos_cf_provenance as provenance
    from src.providers.geos_cf import GEOSCFProvider
    from src.services import geos_cf_catalog_service as catalog
    from src.services.ingestion_service import IngestionService
    from src.api.schemas.notebook_demo_schema import NotebookDemoContract

TIMESTAMP = "2026-11-12T00:30:00Z"
NAME = "GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261112_0030z.R0.nc4"
URL = provenance.NCCS_PREFIX + "Y2026/M11/D12/" + NAME
INFO = {"timestamp_utc": TIMESTAMP, "variables": list(provenance.VARIABLES), "grid_shape": [721, 1440]}


def add_receipt(path: Path, timestamp: str = TIMESTAMP) -> None:
    receipt = provenance.DownloadReceipt(source_url=URL, sha256=provenance.checksum_file(path),
        size_bytes=path.stat().st_size, timestamp_utc=timestamp, downloaded_at=TIMESTAMP)
    provenance.receipt_path(path).write_text(receipt.model_dump_json(), encoding="utf-8")


def test_receipt_is_bound_to_bytes_size_timestamp_and_origin(tmp_path):
    path = tmp_path / NAME
    path.write_bytes(b"local fixture, not NASA")
    add_receipt(path)
    checksum = provenance.checksum_file(path)
    assert provenance.valid_receipt(path, checksum, TIMESTAMP, URL)
    assert not provenance.valid_receipt(path, checksum, "2026-11-12T01:30:00Z")
    assert not provenance.valid_receipt(path, checksum, TIMESTAMP, URL + "other")
    path.write_bytes(b"tampered")
    assert not provenance.valid_receipt(path, checksum, TIMESTAMP)


def test_inventory_deduplicates_and_rejects_unverified_missing_invalid(tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "inspect_asset", lambda _: INFO)
    first = tmp_path / "one" / NAME
    first.parent.mkdir(); first.write_bytes(b"verified fixture")
    add_receipt(first)
    copy = tmp_path / "two" / NAME
    copy.parent.mkdir(); copy.write_bytes(first.read_bytes()); add_receipt(copy)
    orphan = tmp_path / "unknown.nc4"; orphan.write_bytes(b"no receipt")
    removed = tmp_path / "removed.nc4"; removed.write_bytes(b"missing fixture")
    add_receipt(removed); removed.unlink()
    entries, accepted = catalog.inventory([tmp_path, first.parent])
    assert sorted(e.status for e in entries) == ["duplicate", "missing", "ready", "unverified"]
    assert len(accepted) == 1
    monkeypatch.setattr(catalog, "inspect_asset", lambda _: (_ for _ in ()).throw(ValueError("synthetic_or_test_fixture")))
    entries, accepted = catalog.inventory([first.parent])
    assert entries[0].status == "invalid" and not accepted


def test_different_revisions_for_same_hour_are_excluded(tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "inspect_asset", lambda _: INFO)
    for name, content in [("a.nc4", b"revision0"), ("b.nc4", b"revision1")]:
        path = tmp_path / name; path.write_bytes(content); add_receipt(path)
    entries, accepted = catalog.inventory([tmp_path])
    assert [e.status for e in entries] == ["conflict", "conflict"]
    assert not accepted


def test_mock_reference_cannot_qualify_a_source_as_nasa(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    reference = NotebookDemoContract.model_validate_json((root / "frontend/public/data/notebook-demo/contract.json").read_text(encoding="utf-8"))
    path = tmp_path / NAME; path.write_bytes(b"isolated test bytes")
    reference.source.sha256 = provenance.checksum_file(path)
    monkeypatch.setattr(catalog, "inspect_asset", lambda _: INFO)
    reference.isMock = True
    entries, accepted = catalog.inventory([tmp_path], reference)
    assert entries[0].status == "unverified" and not accepted
    reference.isMock = False
    entries, accepted = catalog.inventory([tmp_path], reference)
    assert entries[0].status == "ready" and len(accepted) == 1


def full_grid() -> xr.Dataset:
    values = np.broadcast_to(np.float32(1), (1, 721, 1440))
    return xr.Dataset({key: (("time", "lat", "lon"), values, {"units": "ug m-3" if key.startswith("PM") else "mol mol-1"}) for key in provenance.VARIABLES},
        coords={"time": [np.datetime64("2026-11-12T00:30")], "lat": np.arange(-90, 90.25, .25), "lon": np.arange(-180, 180, .25)})


@pytest.mark.parametrize("failure", ["fixture", "grid", "unit", "time"])
def test_structure_validation_does_not_trust_nasa_label(monkeypatch, failure):
    ds = full_grid()
    ds.attrs["institution"] = "NASA GMAO"
    if failure == "fixture": ds.attrs["title"] = "Test granule"
    if failure == "grid": ds = ds.isel(lat=slice(0, 6))
    if failure == "unit": ds["CO"].attrs["units"] = "ppbv"
    if failure == "time": ds = ds.assign_coords(time=[np.datetime64("2026-11-12T01:30")])
    monkeypatch.setattr(provenance.NetCDFProcessor, "open_dataset", lambda _: ds)
    with pytest.raises(ValueError): provenance.inspect_asset(Path(NAME))


def test_full_grid_structure_accepts_correct_units_and_time(monkeypatch):
    monkeypatch.setattr(provenance.NetCDFProcessor, "open_dataset", lambda _: full_grid())
    assert provenance.inspect_asset(Path(NAME)) == INFO


def test_manual_download_preserves_archive_and_reuses_only_receipted_cache(tmp_path, monkeypatch, capsys):
    from importlib import import_module
    provider_module = import_module(GEOSCFProvider.__module__)
    real_client = httpx.Client
    requests = []
    def response(request):
        requests.append(request.url)
        return httpx.Response(200, content=b"fixture payload", headers={"Content-Length": "15"})
    monkeypatch.setattr(provider_module.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(response), **kwargs))
    monkeypatch.setattr(provenance, "inspect_asset", lambda _: INFO)
    old = tmp_path / "GEOS.cf.ana.old.nc4"; old.write_bytes(b"old")
    provider = GEOSCFProvider(raw_storage_dir=tmp_path, preserve_raw=True, max_retries=1)
    path = provider.fetch_granule(TIMESTAMP)
    assert old.exists() and provenance.receipt_path(path).exists()
    provider.fetch_granule(TIMESTAMP)
    assert len(requests) == 1
    assert "MiB" in capsys.readouterr().out
    assert provider.cleanup_old_granules(max_files=1) == []
    path.write_bytes(b"modified cache")
    provider.fetch_granule(TIMESTAMP)
    assert len(requests) == 2


def test_invalid_download_never_replaces_old_file_or_adds_receipt(tmp_path, monkeypatch):
    from importlib import import_module
    provider_module = import_module(GEOSCFProvider.__module__)
    real_client = httpx.Client
    monkeypatch.setattr(provider_module.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"bad")), **kwargs))
    monkeypatch.setattr(provenance, "inspect_asset", lambda _: (_ for _ in ()).throw(ValueError("bad grid")))
    old = tmp_path / NAME; old.write_bytes(b"keep original")
    with pytest.raises(RuntimeError): GEOSCFProvider(raw_storage_dir=tmp_path, max_retries=1).fetch_granule(TIMESTAMP)
    assert old.read_bytes() == b"keep original"
    assert not provenance.receipt_path(old).exists()
    assert not list((tmp_path / ".validation").iterdir())


def test_dry_run_is_inclusive_hourly_and_never_fetches(tmp_path, capsys):
    service = IngestionService()
    service.provider = GEOSCFProvider(raw_storage_dir=tmp_path, preserve_raw=True)
    service.provider.fetch_granule = MagicMock(side_effect=AssertionError("No network"))
    rows = service.ingest_remote_range(TIMESTAMP, "2026-11-12T23:30:00Z", db=MagicMock(), dry_run=True)
    assert len(rows) == 24 and rows[-1]["timestamp"] == "2026-11-12T23:30:00Z"
    assert "[24/24]" in capsys.readouterr().out
    service.provider.fetch_granule.assert_not_called()
    with pytest.raises(ValueError): service.ingest_remote_range("2026-11-12T00:00Z", TIMESTAMP, MagicMock(), dry_run=True)
    with pytest.raises(ValueError): service.ingest_remote_range(TIMESTAMP, TIMESTAMP, MagicMock(), variables=["AQI"], dry_run=True)


def test_remote_failure_rolls_back_and_continues_hourly(tmp_path, monkeypatch):
    service = IngestionService()
    service.provider = GEOSCFProvider(raw_storage_dir=tmp_path, preserve_raw=True)
    monkeypatch.setattr(service.provider, "fetch_granule", MagicMock(side_effect=[RuntimeError("unavailable"), tmp_path / NAME]))
    monkeypatch.setattr(service, "ingest_local_file", lambda *args, **kwargs: {"status": "completed"})
    db = MagicMock()
    rows = service.ingest_remote_range(TIMESTAMP, "2026-11-12T01:30:00Z", db)
    assert [r["status"] for r in rows] == ["failed", "completed"]
    db.rollback.assert_called_once()


def test_cli_returns_failure_for_partial_download_and_dry_run_does_not_init(monkeypatch, capsys, tmp_path):
    from importlib import import_module
    # Resolve from project root regardless of pytest's cwd.
    import sys
    root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(root))
    cli = import_module("backend.scripts.ingest_geos_cf")
    monkeypatch.setattr(sys, "argv", ["ingest", "--source", "nasa", "--start", TIMESTAMP, "--end", TIMESTAMP, "--archive-dir", str(tmp_path), "--dry-run"])
    init = MagicMock(); monkeypatch.setattr(cli, "init_db", init)
    monkeypatch.setattr(cli, "SessionLocal", MagicMock())
    monkeypatch.setattr(cli.ingestion_service, "ingest_remote_range", lambda **kwargs: [{"status": "failed", "timestamp": TIMESTAMP}])
    with pytest.raises(SystemExit) as result: cli.main()
    assert result.value.code == 1
    init.assert_not_called()
    assert "requested=1 planned=0 failed=1" in capsys.readouterr().out


def test_focus_features_keep_A_mean_and_use_distribution_and_fixed_neighbors():
    root = Path(__file__).resolve().parents[2]
    contract = NotebookDemoContract.model_validate_json((root / "frontend/public/data/notebook-demo/contract.json").read_text(encoding="utf-8"))
    before = contract.model_dump_json()
    # Explicit synthetic distribution for this unit test, never exported to web.
    da = xr.DataArray(np.array([[1., 3.], [5., 7.]]), dims=("lat", "lon"), coords={"lat": [46., 47.], "lon": [-179., -178.]})
    features = catalog.focus_features(contract, {"pm25_rh35": da})["pm25_rh35"]
    first = contract.global_plans["pm25_rh35"][0].scientific
    feature = features[first.scan_id]
    assert feature.iqr == 3 and feature.p90 == pytest.approx(6.4)
    assert feature.cell_id == "r0c0" and feature.spread_score == .03
    assert contract.model_dump_json() == before


def test_export_records_gaps_and_reuses_complete_hash_cache(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    reference = root / "frontend/public/data/notebook-demo/contract.json"
    baseline = NotebookDemoContract.model_validate_json(reference.read_text(encoding="utf-8"))
    records = [catalog.CatalogEntry(id=digest, sha256=digest, filename=NAME,
        timestamp_utc=timestamp, status="ready", provenance="download_receipt", source_url=URL)
        for digest, timestamp in [("a" * 64, TIMESTAMP), ("b" * 64, "2026-11-12T03:30:00Z")]]
    monkeypatch.setattr(catalog, "inventory", lambda *args: ([e.model_copy(deep=True) for e in records], {e.id: tmp_path / e.id for e in records}))
    builds = []
    def build(path, digest, **kwargs):
        builds.append(digest)
        contract = baseline.model_copy(deep=True)
        contract.source.sha256 = digest
        contract.source.timestamp_utc = next(e.timestamp_utc for e in records if e.id == digest)
        return contract, {key: None for key in contract.pollutants}
    monkeypatch.setattr(catalog.NotebookDemoProcessor, "build", build)
    monkeypatch.setattr(catalog, "focus_features", lambda *args: {})
    def maps(contract, fields, destination):
        destination.mkdir(parents=True)
        for key in fields: (destination / f"{key}.png").write_bytes(b"test raster placeholder")
    monkeypatch.setattr(catalog, "render_maps", maps)
    monkeypatch.setattr(catalog, "export_detail", lambda *args: "/data/test/detail.json")
    output = tmp_path / "catalog"
    first = catalog.export_catalog([], output, reference)
    assert first.ready_count == 2 and first.gaps[0].missing_hours == 2
    assert all(e.snapshot_url.startswith("/data/catalog/") for e in first.entries)
    assert len(builds) == 2
    second = catalog.export_catalog([], output, reference)
    assert len(builds) == 2 and second.ready_count == 2
    assert (output / "index.json").exists() and not (output / "index.tmp").exists()
