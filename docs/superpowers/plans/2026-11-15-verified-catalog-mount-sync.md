# Verified Scientific Catalog Mount & 24h NASA Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `Scientific API 503: Verified catalog is not exported/mounted` across local development, Docker Compose, and Azure Container Apps production by mounting a read-only Azure File Share catalog, optimizing catalog export and SMB reads, providing a 24h latest-available NASA GEOS-CF v2 sync pipeline, and clarifying unavailable/empty catalog states in the Explore/Studio UI.

**Architecture:** Preserve the strict read-only runtime boundary of [`ScientificCatalog`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/backend/src/services/scientific_catalog_service.py#L15-L61) (`no network, download, ingestion, or scientific fallback`). Move catalog provisioning to explicit CLI/workflow sync (`backend/scripts/sync_verified_catalog.py` + `workflow_dispatch` GitHub Actions job) that probes NASA NCCS for the latest contiguous 24h `:30Z` window, downloads with `DownloadReceipt` provenance, exports `--scientific-only` artifacts (`index.json`, `detail.json`, `native-*.f32`), uploads snapshots before `index.json`, prunes stale snapshots by default (with `--append` opt-in), and mounts the Azure File Share read-only into `breathe-backend` at `/app/data/geos-cf-catalog` (`GEOS_CF_CATALOG_ROOT`).

**Tech Stack:** FastAPI, Pydantic v2, NumPy, xarray, httpx, Azure Container Apps & Azure Files CLI (`az`), Docker Compose, GitHub Actions, Next.js 14 App Router, TypeScript, Node test runner (`node --test`), Pytest.

**Spec / Decisions (from `/grill-me` interview on 2026-11-15):**
- Scope: Sync from `origin/main` (`f206ec8`) on branch `fix/verified-catalog-mount-sync` (leaving `stash@{0}` untouched); fix Production Azure + Local Dev + Docker Compose.
- Production Storage: Idempotent Azure Storage Account + Azure File Share (`geos-cf-catalog`) in existing Resource Group mounted `ReadOnly` at `/app/data/geos-cf-catalog` in `breathe-backend`.
- Provisioning Policy: Explicit manual CLI + GitHub Actions `workflow_dispatch` (no background cron, no runtime download inside HTTP requests).
- Dataset Window: Auto-probe backward from current UTC for the latest 24 contiguous available hourly `:30Z` NASA GEOS-CF v2 snapshots (~600–650 MB).
- Sync Retention: Clean replacement mirror by default (upload snapshots -> replace `index.json` -> prune stale snapshot dirs), with `--append` opt-in.
- Optimizations & UX: Add `--scientific-only` export mode + single-read SHA-256 verification in `ScientificCatalog.field()`, and clarify 503/empty-catalog guidance in `ScientificWorkspace.tsx` while preserving the HTTP `503` contract.

---

## Skills & Subagents

| Phase / Task | Local Skills | Agent Role (`.agents/agents.toml`) | Responsibility |
| :--- | :--- | :--- | :--- |
| Tasks 1–3 (Backend & Sync CLI) | `nasa-earthdata-retrieval`, `pydantic-v2`, `python-testing-patterns`, `test-driven-development` | `python_backend` | Single-read catalog I/O, `--scientific-only` export, 24h probe & sync CLI + pytest coverage |
| Task 4 (Frontend Error/Empty UX) | `test-driven-development`, `ui-styling` | `frontend_developer` | Friendly 503/empty-catalog panel + retry action in `ScientificWorkspace.tsx` + contract test |
| Task 5 (Docker, Azure Script, CI/CD) | `verification-before-completion` | Main Orchestrator (DevOps) | `Dockerfile`, `docker-compose.yml`, `deploy-azure.sh`, `breathe-ci-cd.yml`, `sync-verified-catalog.yml` |
| Task 6 (Full QA & Local 24h E2E) | `verification-before-completion`, `code-review-excellence` | `qa_reviewer` | Backend pytest, frontend lint/typecheck/tests/build, 24h NASA download/export & live HTTP smoke |

---

## Global Constraints

1. `ScientificCatalog.read()` MUST raise `HTTPException(503, "Verified catalog is not exported/mounted. Run the existing exporter manually.")` when `index.json` is missing and `HTTPException(409, ...)` when malformed/unverified.
2. `ScientificCatalog.field()` MUST verify file byte size (`rows * cols * 4`), SHA-256 checksum, finite/non-negative bounds, and `valid_count`, raising `404` when missing and `409` on integrity failure.
3. Every verified snapshot MUST originate from NCCS DataShare (`https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/`) with a matching `DownloadReceipt` (`.nc4.source.json`) or `notebook_reference`, full `721×1440` grid, `:30Z` UTC timestamp, and all six variables (`PM25_RH35`, `PM10_RH35`, `CO`, `NO2`, `O3`, `SO2`).
4. Default `export_geos_cf_catalog.py` behavior (generating `snapshot.json` + PNGs for local `/demo`) MUST remain intact when `--scientific-only` is omitted.
5. `breathe-backend` on Azure runs with `min-replicas 0`, `0.5 vCPU`, `1.0Gi` memory, non-root `appuser` (UID `1001`), and MUST NOT bake `.nc4` or `.f32` catalog binaries into the Docker image.
6. Local verified downloads MUST live in `backend/src/data/nasa-archive` (never polluting `backend/src/data/raw/` test fixtures or touching `stash@{0}`).

---

## Review Focus

1. **Single-read SMB optimization breaking validation:** Reading `native-{pollutant}.f32` once via `read_bytes()` must still raise HTTP `409` on truncated bytes, SHA-256 mismatch, `inf`, negative values, or wrong `valid_count`, and HTTP `404` on missing files — pinned in `backend/tests/test_scientific_sessions.py`.
2. **`--scientific-only` producing incomplete or schema-invalid exports:** Omitting `render_maps` / `snapshot.json` must still produce valid `index.json`, `detail.json`, and 6 `native-*.f32` files accepted by `ScientificCatalog` and `ScientificSessionService` (and subsequent full exports must regenerate missing PNGs) — pinned in `backend/tests/test_geos_cf_catalog.py`.
3. **NASA NCCS lag or intermediate missing hour during 24h backward probe:** Probing backward from current UTC must tolerate 404 hours during upstream publication lag, assemble the newest contiguous 24h `:30Z` target window where available, reuse verified cached granules without re-downloading, and exit non-zero if zero ready snapshots result — pinned in `backend/tests/test_sync_verified_catalog.py`.
4. **Live backend race during catalog sync (`404`/`409` mid-upload):** Remote/local mirror updates MUST upload new `<sha256>` directories before replacing `index.json`, and prune old `<sha256>` directories only AFTER `index.json` is replaced (skipping pruning when `--append` is passed) — pinned in `backend/tests/test_sync_verified_catalog.py` and `.github/workflows/sync-verified-catalog.yml`.
5. **Frontend error handling breaking contract tests:** Updating `ScientificWorkspace.tsx` error presentation for 503 and `0 verified snapshots` must NOT alter `scientificSession.ts` thrown error strings (`Scientific API 503: ...`) expected by `frontend/scripts/scientific-session.test.cjs` — pinned in `frontend/scripts/scientific-session.test.cjs`.

---

## File Map

- Modify: `backend/src/core/config.py:29-31` — Container-safe fallback for `GEOS_CF_CATALOG_ROOT`.
- Modify: `backend/src/services/scientific_catalog_service.py:1-61` — Single-read SHA-256 + `np.frombuffer` decoding in `ScientificCatalog.field()`.
- Modify: `backend/src/services/geos_cf_catalog_service.py:122-160` — Add `scientific_only: bool = False` fast path and `--raw-dir` / cache safety.
- Modify: `backend/scripts/export_geos_cf_catalog.py:1-20` — Add `--scientific-only` CLI flag.
- Create: `backend/scripts/sync_verified_catalog.py` — Backward 24h NCCS probe, verified download reuse, export, and ordered mirror/append cleanup.
- Modify: `backend/tests/test_scientific_sessions.py` — Single-read integrity & path safety tests.
- Modify: `backend/tests/test_geos_cf_catalog.py` — `--scientific-only` export & fallback-to-full-export tests.
- Create: `backend/tests/test_sync_verified_catalog.py` — Probe, cache reuse, pruning order, `--append`, and failure-mode tests.
- Modify: `frontend/src/components/scientific/ScientificWorkspace.tsx` — Structured `503` / empty-catalog banner with `Retry catalog` and `Return to map workspace`.
- Modify: `frontend/src/components/scientific/scientific.module.css` — Styling for actionable status/error card.
- Modify: `frontend/scripts/scientific-session.test.cjs` — Unit tests for `formatScientificError`.
- Modify: `backend/Dockerfile:41-52` — Create `/app/data/geos-cf-catalog` owned by `appuser`, set `ENV GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog`.
- Modify: `backend/.env.example` — Confirm `GEOS_CF_CATALOG_ROOT` / `NASA_ARCHIVE_ROOT` examples.
- Modify: `docker-compose.yml` — Mount `./frontend/public/data/geos-cf-catalog:/app/data/geos-cf-catalog:ro` and pass `GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog`.
- Modify: `scripts/deploy-azure.sh` — Idempotent Azure Storage Account + File Share (`geos-cf-catalog`) provisioning and ReadOnly Container App volume mount.
- Modify: `.github/workflows/breathe-ci-cd.yml` — Idempotent Azure File Share provisioning + preserve ReadOnly `/app/data/geos-cf-catalog` mount and `GEOS_CF_CATALOG_ROOT` on `deploy-backend`.
- Create: `.github/workflows/sync-verified-catalog.yml` — `workflow_dispatch` job to run `sync_verified_catalog.py` and atomically sync snapshots -> `index.json` -> prune obsolete hashes on Azure File Share.
- Modify: `package.json`, `docs/SCIENTIFIC_SESSION_INTEGRATION.md` — Add root convenience script and document local/Azure catalog sync workflow.

---

### Task 1: Single-Read Catalog Integrity & Container-Safe `GEOS_CF_CATALOG_ROOT`

**Files:**
- Modify: `backend/src/core/config.py:29-31`
- Modify: `backend/src/services/scientific_catalog_service.py:1-61`
- Test: `backend/tests/test_scientific_sessions.py`

**Interfaces:**
- Produces: `ScientificCatalog.field(self, entry: CatalogEntry, pollutant: str) -> tuple[GeosCfDetail, np.ndarray]` reading `.f32` bytes once over SMB/disk, plus `settings.GEOS_CF_CATALOG_ROOT` resolving safely inside both repo checkout and `/app` container layout.

- [ ] **Step 1: Write failing tests in `backend/tests/test_scientific_sessions.py`**

Add tests exercising:
1. `test_scientific_catalog_field_reads_native_file_once_and_verifies_integrity(tmp_path, monkeypatch)`:
   - Create a minimal valid catalog dir (`index.json`, `<sha>/detail.json`, `<sha>/native-pm25_rh35.f32` with `721 * 1440` `<f4` values including `0.0` and `NaN`).
   - Spy on `Path.read_bytes` (or verify `checksum_file` is NOT called separately when `read_bytes()` reads the `.f32` file) and assert `read_bytes` reads `native-pm25_rh35.f32` once, returning exact `GeosCfDetail` and `(721, 1440)` `ndarray` with expected `valid_count`.
   - Mutate one byte -> assert `HTTPException` with `status_code == 409`.
   - Truncate file -> assert `HTTPException` with `status_code == 409`.
   - Write `inf` or negative value with updated checksum -> assert `HTTPException` with `status_code == 409`.
   - Delete `.f32` -> assert `HTTPException` with `status_code == 404`.
2. `test_default_catalog_root_resolves_without_index_error()`:
   - Assert `_default_catalog_root(Path("/app/src/core/config.py")) == Path("/app/data/geos-cf-catalog")` and `_default_catalog_root(Path("/repo/backend/src/core/config.py")) == Path("/repo/frontend/public/data/geos-cf-catalog")`.

- [ ] **Step 2: Run targeted pytest to confirm failure**

Run: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/test_scientific_sessions.py -k "reads_native_file_once or default_catalog_root"`
Expected: FAIL (`_default_catalog_root` not defined; `checksum_file` still invokes double file read).

- [ ] **Step 3: Implement `_default_catalog_root` in `backend/src/core/config.py` and single-read `field()` in `backend/src/services/scientific_catalog_service.py`**

- In `backend/src/core/config.py`:
  - Add `def _default_catalog_root(config_file: Path | None = None) -> Path`: if repo layout exists (`(resolved.parents[3] / "frontend").exists()`), return `resolved.parents[3] / "frontend/public/data/geos-cf-catalog"`; otherwise return `resolved.parents[2] / "data/geos-cf-catalog"` (so `/app/src/core/config.py` resolves to `/app/data/geos-cf-catalog` instead of `/frontend/...`).
  - Set `GEOS_CF_CATALOG_ROOT: Path = _default_catalog_root()`.
- In `backend/src/services/scientific_catalog_service.py`:
  - Import `hashlib`.
  - In `field()`: read `raw = self._path(f"{entry.id}/native-{pollutant}.f32").read_bytes()` once; verify `len(raw) == manifest.rows * manifest.cols * 4` and `hashlib.sha256(raw).hexdigest() == field.sha256`; decode via `np.frombuffer(raw, dtype="<f4").reshape(manifest.rows, manifest.cols)` without modifying `prepare_view`'s read-only usage.

- [ ] **Step 4: Run targeted and full scientific session tests**

Run: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/test_scientific_sessions.py`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/config.py backend/src/services/scientific_catalog_service.py backend/tests/test_scientific_sessions.py
git commit -m "perf(catalog): read native catalog binaries once and resolve container catalog root safely"
```

---

### Task 2: Add `--scientific-only` Mode to Catalog Exporter

**Files:**
- Modify: `backend/src/services/geos_cf_catalog_service.py:122-160`
- Modify: `backend/scripts/export_geos_cf_catalog.py:1-20`
- Test: `backend/tests/test_geos_cf_catalog.py`

**Interfaces:**
- Produces: `export_catalog(roots: list[Path], output: Path, reference_path: Path | None = None, *, scientific_only: bool = False) -> GeosCfCatalog` and CLI flag `--scientific-only` in `backend/scripts/export_geos_cf_catalog.py`.

- [ ] **Step 1: Write failing tests in `backend/tests/test_geos_cf_catalog.py`**

Add tests covering:
1. `test_export_catalog_scientific_only_skips_pngs_and_passes_scientific_reader(tmp_path)`:
   - Create a verified full-grid NetCDF fixture with `add_receipt` (using existing `full_grid()` helper in `test_geos_cf_catalog.py`).
   - Call `export_catalog([raw_dir], out_dir, scientific_only=True)`.
   - Assert `out_dir / "index.json"` exists, `ready_count == 1`, `entry.detail_url` is populated and `entry.snapshot_url is None`.
   - Assert `<sha256>/detail.json` and all 6 `native-*.f32` exist, while NO `.png` and NO `snapshot.json` were created.
   - Instantiate `ScientificCatalog(out_dir)` and `ScientificSessionService(ScientificCatalog(out_dir))` and call `.create(SessionRequest(...))`; assert `200`-equivalent `SessionPlan` succeeds.
   - Call `export_catalog([raw_dir], out_dir, scientific_only=True)` again and verify cache hit without re-opening NetCDF (`monkeypatch` `NetCDFProcessor.open_dataset` to raise on second call).
2. `test_full_export_after_scientific_only_still_generates_png_and_snapshot(tmp_path)`:
   - Run `export_catalog(..., scientific_only=True)` then `export_catalog(..., scientific_only=False)`.
   - Assert `snapshot.json` and all 6 `.png` files are generated and `entry.snapshot_url` + `entry.detail_url` are populated.

- [ ] **Step 2: Run targeted pytest to confirm failure**

Run: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/test_geos_cf_catalog.py -k "scientific_only"`
Expected: FAIL (`TypeError: export_catalog() got an unexpected keyword argument 'scientific_only'`).

- [ ] **Step 3: Implement `scientific_only` branch in `geos_cf_catalog_service.py` and CLI flag in `export_geos_cf_catalog.py`**

- Extract small helper `_detail_contract(path: Path, record: CatalogEntry, output: Path, prefix: str) -> tuple[NotebookDemoContract, dict[str, xr.DataArray] | None]` in `geos_cf_catalog_service.py`:
  - First check if `output / "detail.json"` exists and passes schema + 6 `.f32` file size & SHA-256 verification matching `record.id`, `record.timestamp_utc`, `POLLUTANTS`, and `prefix` URLs. If valid -> return immediately without opening the `.nc4` file!
  - Otherwise open `path` once via `NetCDFProcessor.open_dataset(path)` + `NotebookDemoProcessor.prepare_fields(dataset)`, validate filename timestamp match, build minimal `NotebookDemoContract(isMock=False, source=DemoSource(...), pollutants=POLLUTANTS, global_plans={}, region_plans={}, map_urls={})`, and call `export_detail(path, contract, output, prefix, fields)`.
- In `export_catalog(..., *, scientific_only: bool = False)`:
  - When `scientific_only=True`: use `_detail_contract(...)`, set `record.detail_url` and leave `record.snapshot_url = None`.
  - When `scientific_only=False`: keep exact existing `snapshot.json` + `render_maps` + `export_detail` path untouched.
- In `backend/scripts/export_geos_cf_catalog.py`: add `--scientific-only` (`action="store_true"`) and pass `scientific_only=args.scientific_only`.

- [ ] **Step 4: Run targeted and full catalog tests**

Run: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/test_geos_cf_catalog.py`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/geos_cf_catalog_service.py backend/scripts/export_geos_cf_catalog.py backend/tests/test_geos_cf_catalog.py
git commit -m "feat(catalog): add --scientific-only mode to skip legacy PNG rendering"
```

---

### Task 3: Add 24h Latest-Available NASA Probe & Catalog Sync CLI (`sync_verified_catalog.py`)

**Files:**
- Create: `backend/scripts/sync_verified_catalog.py`
- Create: `backend/tests/test_sync_verified_catalog.py`

**Interfaces:**
- Consumes: `GEOSCFProvider`, `export_catalog`, `settings.NASA_ARCHIVE_ROOT`, `settings.GEOS_CF_CATALOG_ROOT`.
- Produces: `python -m backend.scripts.sync_verified_catalog` with:
  - `find_latest_available_timestamp(provider: GEOSCFProvider, *, now_utc: datetime | None = None, max_lookback_hours: int = 96, client: httpx.Client | None = None) -> datetime`
  - `resolve_target_hours(*, latest_hours: int, start: str | None, end: str | None, provider: GEOSCFProvider, now_utc: datetime | None = None, max_lookback_hours: int = 96) -> list[datetime]`
  - `prune_catalog_output(output: Path, keep_hashes: set[str]) -> list[str]` (removes only 64-hex directory names in `output` not in `keep_hashes`, invoked AFTER `index.json` is written)
  - `sync_catalog(...) -> GeosCfCatalog`

- [ ] **Step 1: Write failing tests in `backend/tests/test_sync_verified_catalog.py`**

Add tests using `httpx.MockTransport` and temp directories:
1. `test_find_latest_available_timestamp_steps_back_past_nccs_lag()`:
   - Mock `HEAD` returning `404` for newest 30 hours and `200` at hour `-30`, asserting `find_latest_available_timestamp` returns that exact `:30Z` UTC `datetime`.
2. `test_sync_catalog_reuses_existing_verified_granules_and_prunes_stale_after_index(tmp_path)`:
   - Pre-populate `output/<old_sha64>/detail.json` + stale `index.json`, and 1 already-downloaded verified granule in `archive_dir`.
   - Mock remaining downloads (or inject fetcher returning synthetic full-grid NetCDF + `write_receipt` in test), run `sync_catalog(..., append=False, scientific_only=True)`.
   - Assert existing verified granule was NOT re-downloaded, `index.json` has `ready_count == target_count`, and `<old_sha64>` directory was removed ONLY after `index.json` was written.
3. `test_sync_catalog_append_mode_preserves_existing_archive_and_output(tmp_path)`:
   - Run with `append=True`; assert older verified granules in `archive_dir` remain indexed alongside newly synced hours.
4. `test_sync_catalog_fails_nonzero_when_no_ready_snapshots(tmp_path)`:
   - Mock all NCCS requests returning `404`; assert `sync_catalog` / CLI `main()` exits non-zero without leaving an empty `index.json` that overwrites valid data.

- [ ] **Step 2: Run pytest to confirm failure**

Run: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/test_sync_verified_catalog.py`
Expected: FAIL (`ModuleNotFoundError: No module named 'backend.scripts.sync_verified_catalog'`).

- [ ] **Step 3: Implement `backend/scripts/sync_verified_catalog.py`**

Key requirements:
- CLI flags: `--latest-hours` (int, default `24`, max `48`), `--start` / `--end` (optional explicit ISO `:30Z` overrides), `--max-lookback-hours` (int, default `96`), `--archive-dir` (default `settings.NASA_ARCHIVE_ROOT`), `--output` (default `settings.GEOS_CF_CATALOG_ROOT`), `--reference-contract` (default `frontend/public/data/notebook-demo/contract.json`), `--scientific-only` (`action="store_true"`), `--append` (`action="store_true"`), `--dry-run` (`action="store_true"`).
- Use `GEOSCFProvider(raw_storage_dir=archive_dir, preserve_raw=True)`.
- Before downloading an hour, check if `archive_dir / provider.format_granule_filename(dt)` exists AND passes `valid_receipt` + `inspect_asset`; skip download if already verified locally!
- When `append=False`: only pass `archive_dir` files matching the requested window (or move/clean older raw `.nc4` + `.source.json` outside target window after export? Better: either stage/filter target files or clean old raw granules outside the target window only AFTER `export_catalog` succeeds so `archive_dir` stays tidy at ~24 files while keeping failed/partial retries safe!). Specifically: download target hours -> if `not append` and `len(downloaded_or_cached_paths) > 0`, archive/clean stale `.nc4`/`.source.json` not in target timestamps OR pass `[target_stage_dir]`? Keeping `archive_dir` clean by deleting raw `.nc4`/`.source.json` outside `target_timestamps` ONLY after verifying >= 1 target granule exists, then running `export_catalog([archive_dir], output, reference_contract, scientific_only=...)`, then `prune_catalog_output(output, {e.id for e in catalog.entries if e.status == "ready"})` ensures: (a) `index.json` updates before old dirs are deleted, (b) `archive_dir` doesn't grow unboundedly across runs, and (c) `--append` skips both raw cleanup and output pruning!

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/test_sync_verified_catalog.py`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/sync_verified_catalog.py backend/tests/test_sync_verified_catalog.py
git commit -m "feat(catalog): add 24h latest-available NASA probe and verified catalog sync CLI"
```

---

### Task 4: Clarify 503 & Empty-Catalog States in `ScientificWorkspace.tsx`

**Files:**
- Modify: `frontend/src/components/scientific/ScientificWorkspace.tsx`
- Modify: `frontend/src/components/scientific/scientific.module.css`
- Test: `frontend/scripts/scientific-session.test.cjs`

**Interfaces:**
- Consumes: `s.error`, `s.catalog`, `s.refresh()`, `s.exit()` from `useScientificSession()` (and existing `scientificSession.ts` throwing `Error("Scientific API 503: ...")`).
- Produces: Pure formatter `describeScientificStatus(error: string, readyCount: number, hasCatalog: boolean)` (placed in a small testable TS module or exported helper imported by both `ScientificWorkspace.tsx` and `scientific-session.test.cjs`) returning `{ title: string; detail: string; kind: 'unmounted' | 'empty' | 'error'; canRetry: boolean } | null`.

- [ ] **Step 1: Write failing unit tests in `frontend/scripts/scientific-session.test.cjs`**

Add tests asserting:
1. `describeScientificStatus('Error: Scientific API 503: Verified catalog is not exported/mounted...', 0, false)` returns `kind: 'unmounted'`, `canRetry: true`, clear message explaining the backend catalog is not yet mounted/populated (without stripping the diagnostic HTTP code), and `detail` still surfaces the technical detail cleanly.
2. `describeScientificStatus('', 0, true)` returns `kind: 'empty'`, `canRetry: true`, explaining 0 verified NASA snapshots are currently indexed.
3. `describeScientificStatus('Error: Scientific API 409: Calibration differs', 24, true)` returns `kind: 'error'`, preserving the message.
4. `describeScientificStatus('', 24, true)` returns `null`.
5. Keep ALL existing tests in `scientific-session.test.cjs` (including `prepareScientificSession` rejecting with `/503.*No verified catalog/`) passing unchanged.

- [ ] **Step 2: Run frontend contract & demo tests to confirm failure**

Run: `cd frontend && npm run test:demo`
Expected: FAIL (`describeScientificStatus` not found).

- [ ] **Step 3: Implement `describeScientificStatus` and update `ScientificWorkspace.tsx` + `scientific.module.css`**

- Create/export `describeScientificStatus` (e.g. in `frontend/src/services/scientificStatus.ts` so `scientific-session.test.cjs` can transpile/import it cleanly without JSX/React dependencies, matching how `scientific-session.test.cjs` compiles `scientificSession.ts`).
- In `frontend/src/components/scientific/ScientificWorkspace.tsx`:
  - Call `describeScientificStatus(s.error, ready.length, Boolean(s.catalog))`.
  - When non-null, render an accessible `role="alert"` / `role="status"` callout banner with clear title, friendly explanation + technical reference, **"Retry catalog"** button (`onClick={() => void s.refresh()}`, disabled when `s.busy`), and **"Return to map workspace"** button (`onClick={s.exit}`).

- [ ] **Step 4: Run frontend checks**

Run: `cd frontend && npm run test:demo && npm run test:contracts && npm run lint && npm run typecheck`
Expected: ALL PASS with zero warnings/errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/scientificStatus.ts frontend/src/components/scientific/ScientificWorkspace.tsx frontend/src/components/scientific/scientific.module.css frontend/scripts/scientific-session.test.cjs
git commit -m "fix(ui): clarify verified catalog unavailable and empty states with retry action"
```

---

### Task 5: Docker, Azure Infrastructure Script, and CI/CD Workflows for Azure File Share

**Files:**
- Modify: `backend/Dockerfile:41-52`
- Modify: `backend/.env.example`
- Modify: `docker-compose.yml`
- Modify: `scripts/deploy-azure.sh`
- Modify: `.github/workflows/breathe-ci-cd.yml`
- Create: `.github/workflows/sync-verified-catalog.yml`
- Modify: `package.json`, `docs/SCIENTIFIC_SESSION_INTEGRATION.md`

**Interfaces:**
- Consumes: `backend/scripts/sync_verified_catalog.py` (Task 3), `GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog`.
- Produces: Reproducible local Docker volume mount + idempotent Azure Storage Account / File Share (`geos-cf-catalog`) mount on `breathe-backend` + manual `workflow_dispatch` GitHub Actions sync pipeline.

- [ ] **Step 1: Update `backend/Dockerfile`, `backend/.env.example`, and `docker-compose.yml`**

- `backend/Dockerfile`:
  - Add `/app/data/geos-cf-catalog` to `mkdir -p ...` and `chown -R appuser:appuser ...` so non-root UID 1001 can mount/read cleanly.
  - Set `ENV GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog`.
- `docker-compose.yml`:
  - Under `services.backend.environment`: add `GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog`.
  - Under `services.backend.volumes`: add `./frontend/public/data/geos-cf-catalog:/app/data/geos-cf-catalog:ro`.
- `backend/.env.example`: verify `GEOS_CF_CATALOG_ROOT` note clearly documents both local default and Docker/Azure `/app/data/geos-cf-catalog`.

- [ ] **Step 2: Update `scripts/deploy-azure.sh` and `.github/workflows/breathe-ci-cd.yml` for idempotent Azure File Share mount**

- In both `scripts/deploy-azure.sh` and `.github/workflows/breathe-ci-cd.yml` (`deploy-backend` job):
  - Resolve `AZURE_STORAGE_ACCOUNT` (from `vars.AZURE_STORAGE_ACCOUNT`, or discover existing storage account in `${RESOURCE_GROUP}`, or derive deterministic valid lowercase alphanumeric name `stbreathe$(echo -n "${RESOURCE_GROUP}" | sha256sum | cut -c1-10)`), and `AZURE_FILE_SHARE_NAME` (default `geos-cf-catalog`).
  - Resolve `STORAGE_LOCATION` from existing `${ENVIRONMENT_NAME}` (`az containerapp env show ... --query location -o tsv`) falling back to `${LOCATION}` so Storage Account and Container Apps sit in the same Azure region.
  - Idempotently ensure Storage Account exists (`az storage account show` || `az storage account create --location "${STORAGE_LOCATION}" --sku Standard_LRS --kind StorageV2`) and File Share exists (`az storage share-rm show` || `az storage share-rm create --quota 10`).
  - Retrieve account key (`az storage account keys list ... --query "[0].value" -o tsv`), and register/update Container Apps Environment storage (`az containerapp env storage set --name "${ENVIRONMENT_NAME}" --resource-group "${RESOURCE_GROUP}" --storage-name geoscfcatalog --azure-file-account-name "${STORAGE_ACCOUNT}" --azure-file-account-key "${STORAGE_KEY}" --azure-file-share-name "${FILE_SHARE_NAME}" --access-mode ReadOnly`).
  - Pass `GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog` in `--set-env-vars` / `--env-vars`, AND apply the ReadOnly volume mount (`volumeMounts: [{ volumeName: "geos-cf-catalog", mountPath: "/app/data/geos-cf-catalog" }]`, `volumes: [{ name: "geos-cf-catalog", storageType: "AzureFile", storageName: "geoscfcatalog" }]`) via `az containerapp show -o json` -> Python YAML/JSON patch -> `az containerapp update --yaml` so every CI/CD deploy preserves the mount!
  - Note on frontend CD in `breathe-ci-cd.yml`: ensure `deploy-frontend` stays runnable when `ENABLE_FRONTEND_DEPLOY == 'true'` or `workflow_dispatch` (`both`).

- [ ] **Step 3: Create `.github/workflows/sync-verified-catalog.yml` (`workflow_dispatch`)**

- Inputs:
  - `hours` (string, default `'24'`)
  - `start_utc` (string, optional, e.g. `2026-11-12T00:30:00Z`)
  - `end_utc` (string, optional)
  - `append` (boolean, default `false`)
  - `scientific_only` (boolean, default `true`)
- Steps:
  1. Checkout, setup Python 3.12 + `libnetcdf-dev` + `libhdf5-dev` + `uv`, install `backend/requirements.txt`.
  2. Run `python -m backend.scripts.sync_verified_catalog` into `/tmp/geos-cf-catalog` (passing `--latest-hours` or `--start`/`--end`, `--scientific-only` if selected, `--append` if selected; fail fast if 0 ready snapshots).
  3. Login to Azure (`AZURE_CREDENTIALS`), resolve/create Storage Account + `geos-cf-catalog` File Share in `${AZURE_RESOURCE_GROUP:-rg-breathe}` (matching exact deterministic naming/discovery logic from `breathe-ci-cd.yml`), fetch storage key.
  4. Ordered zero-downtime File Share sync:
     - First upload each `<sha256>` directory (`az storage file upload-batch` for each ready directory, skipping `index.json` first).
     - Second upload `index.json` (`az storage file upload`).
     - Third, if `append == false`, list top-level 64-hex directories in the File Share and delete any not in `index.json` ready hashes (`az storage directory delete` / Python `azure` or CLI cleanup loop).
  5. Optional post-sync health probe against `https://<backend-fqdn>/api/v1/scientific/catalog` confirming HTTP `200` and `ready_count > 0`!

- [ ] **Step 4: Add root helper script & update docs**

- Add `"catalog:sync": "python3 -m backend.scripts.sync_verified_catalog"` (or invoking `backend/.venv/bin/python`) in root `package.json`.
- Update `docs/SCIENTIFIC_SESSION_INTEGRATION.md` with local sync + Azure File Share sync instructions.

- [ ] **Step 5: Validate config/workflow syntax and commit**

Run:
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/breathe-ci-cd.yml')); yaml.safe_load(open('.github/workflows/sync-verified-catalog.yml')); yaml.safe_load(open('docker-compose.yml'))"`
- `bash -n scripts/deploy-azure.sh`
Expected: Exit `0`, zero syntax errors.

```bash
git add backend/Dockerfile backend/.env.example docker-compose.yml scripts/deploy-azure.sh .github/workflows/breathe-ci-cd.yml .github/workflows/sync-verified-catalog.yml package.json docs/SCIENTIFIC_SESSION_INTEGRATION.md
git commit -m "ci(infra): mount Azure File Share catalog on backend and add 24h NASA sync workflow"
```

---

### Task 6: Full Verification, 24h Local Catalog Sync & End-to-End Smoke

**Files:**
- Local runtime artifacts (gitignored): `backend/src/data/nasa-archive/`, `frontend/public/data/geos-cf-catalog/`

- [ ] **Step 1: Run complete backend & frontend test suites and builds**

- Backend: `cd backend && PYTHONPATH=src:. .venv/bin/pytest -v tests/` (expect all pass, 0 failures).
- Frontend: `cd frontend && npm run lint && npm run typecheck && npm run test:contracts && npm run test:demo && npm run build` (expect exit 0, 0 errors).

- [ ] **Step 2: Populate local 24h latest-available verified NASA GEOS-CF v2 catalog**

Run from repo root:
```bash
backend/.venv/bin/python -m backend.scripts.sync_verified_catalog --latest-hours 24 --scientific-only
```
Verify `frontend/public/data/geos-cf-catalog/index.json` exists with `ready_count == 24` (or reported contiguous available count) and valid SHA-256 directories.

- [ ] **Step 3: Live local API & UI verification**

- Start FastAPI backend (`uvicorn src.main:app --port 8000`) and Next.js frontend (`npm run start -- --port 3000`).
- Verify `GET http://127.0.0.1:8000/api/v1/scientific/catalog` -> HTTP `200`, `ready_count > 0`, `Cache-Control: no-store`.
- Verify `GET http://127.0.0.1:3000/api/v1/scientific/catalog` (Next.js proxy) -> HTTP `200`.
- Verify `POST http://127.0.0.1:3000/api/v1/scientific/sessions` & `POST /api/v1/scientific/frames` -> HTTP `200` with matching SHA-256.
- Verify `/explore` -> click **Open verified scientific session** -> snapshots dropdown populated, no 503 error.

- [ ] **Step 4: Push branch & open PR to `main` (on explicit user approval)**

- Verify `git status` is clean (no raw/catalog artifacts tracked).
- Push `fix/verified-catalog-mount-sync` and open PR targeting `main`.
- After PR merge to `main`, run GitHub Actions `sync-verified-catalog.yml` (`workflow_dispatch`, `hours: 24`) and verify `deploy-backend` + `deploy-frontend` succeed and production `/explore` returns `200` on `/api/v1/scientific/catalog`.
