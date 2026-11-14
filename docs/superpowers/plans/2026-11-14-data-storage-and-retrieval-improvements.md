# BREATHE NASA Data Storage & Retrieval Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Skills & Subagents
- **Skills:**
  - `python-project-structure`: Module cohesion, clean interfaces, domain separation.
  - `python-testing-patterns`: Pytest fixtures, test client, isolated test database, mocking remote I/O.
  - `nasa-earthdata-retrieval`: NASA GEOS-CF assimilation products, coordinates resolution, OPeNDAP protocols.
- **Subagents (`.agents/agents.toml`):**
  - `python_backend`: Implement read-through caching, OPeNDAP subsetting, disk retention, and Pytest coverage.
  - `qa_reviewer`: End-to-end regression testing and verification.

---

## Architecture Overview & Target State

```text
Incoming API Query (/jukebox/spatial or /jukebox/temporal)
             │
             ▼
      [MemoryTTLCache] ──(Hit)──> Return HTTP Response (0.5ms)
             │ (Miss)
             ▼
     [Database: SQLite / PostgreSQL]
   (Table: observation_samples) ──(Hit)──> Save to RAM Cache & Return (1ms)
             │ (Miss)
             ▼
   [Local NetCDF-4 Raw Storage] ──(Found)──> Extract Grid via xarray
             │ (Not Found locally)
             ▼
   [NASA Upstream: OPeNDAP Slice / NCCS Download]
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ 1. Extract observation point & validate CF units       │
  │ 2. Read-Through Insert into observation_samples (DB)   │
  │ 3. Enforce Raw File LRU Retention (prevent disk leak)  │
  │ 4. Cache response in MemoryTTLCache                    │
  │ 5. Return HTTP Response                                │
  └────────────────────────────────────────────────────────┘
```

---

## Tasks

- [x] **Task 1: Read-Through Database Caching in `SpatialQueryService` & `TemporalQueryService`**
  - [x] Write failing test in `backend/tests/test_read_through_cache.py` verifying that:
    - First query reads from disk and inserts into `observation_samples`.
    - Subsequent query fetches directly from `observation_samples` without opening NetCDF file.
  - [x] Update `SpatialQueryService` in `backend/src/services/spatial_query_service.py`:
    - For each requested location, check `ObservationRepository.get_sample`.
    - Extract only missing points from NetCDF / remote.
    - Write extracted points into `ObservationRepository.upsert_sample`.
  - [x] Update `TemporalQueryService` in `backend/src/services/temporal_query_service.py`:
    - Query `ObservationRepository.get_samples_for_grid_and_time_range` for the requested time window and grid coordinates.
    - Reconstruct available points from DB; only load NetCDF for missing hours.
    - Write newly loaded hourly points into `ObservationRepository.upsert_sample`.
  - [x] Run pytest to verify `test_read_through_cache.py` passes.

- [x] **Task 2: Automatic Disk Retention Policy (LRU Eviction) in `GEOSCFProvider`**
  - [x] Add `MAX_RAW_FILES_TO_KEEP: int = 10` in `backend/src/core/config.py`.
  - [x] Add `cleanup_old_granules(max_files: Optional[int])` method in `backend/src/providers/geos_cf.py`:
    - Scans `raw_storage_dir` for `GEOS.cf.ana.*.nc4` files.
    - Sorts by modification time / timestamp.
    - Deletes oldest files exceeding `max_files`, logging each deletion.
  - [x] Trigger `cleanup_old_granules()` inside `GEOSCFProvider.fetch_granule()` upon successful download.
  - [x] Write tests in `backend/tests/test_retention.py` verifying oldest files are deleted when exceeding limit.

- [x] **Task 3: Remote OPeNDAP Subsetting Protocol in `GEOSCFProvider`**
  - [x] Add `extract_point_opendap(timestamp_utc, lat, lon, variable)` in `backend/src/providers/geos_cf.py`:
    - Constructs DODS / OPeNDAP URL for the specific timestamp.
    - Uses `xr.open_dataset(opendap_url)` to slice single lat/lon coordinate without downloading full 6.5MB file.
    - Handles timeouts and connection errors gracefully.
  - [x] Add fallback logic: If OPeNDAP request fails or times out, fallback to `fetch_granule` (full HTTP download).
  - [x] Write unit tests with mocked OPeNDAP response in `backend/tests/test_opendap.py`.

- [x] **Task 4: Auto-Bootstrap Seed of Existing Local NetCDF Data & Real SVS 5533 Extraction**
  - [x] Add auto-ingest scan in `init_db()` or application startup:
    - Scans `backend/src/data/raw/*.nc4` on startup.
    - If `dataset_assets` count is 0, automatically ingests existing files using `ingestion_service.ingest_local_file()`.
    - Populates `dataset_sources`, `dataset_assets`, and `observation_samples` for the 10 preset locations.
  - [x] Verify `breathe.db` now contains non-zero rows in `dataset_sources`, `dataset_assets`, and `observation_samples`.

- [x] **Task 5: End-to-End Verification & Documentation**
  - [x] Run full test suite with `uv run pytest` across all tests (50 tests passing).
  - [x] Run frontend production build `npm run build` in `frontend/` (compiled successfully).
