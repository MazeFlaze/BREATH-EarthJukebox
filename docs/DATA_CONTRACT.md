# BREATHE – Shared Data & API Contract

> **Primary Owners:** N01 (Data Engineering), N02 (Scientific Research), & N04 (Frontend)  
> **Status:** Production Interface Specification (`v2.1.0` — Fullstack Runtime Proxy + GEOS-CF v2 Pipeline)

---

## 1. Overview & Core Scientific Invariants

This contract governs every payload exchanged across the **Python FastAPI Backend**, the **Next.js App Router API Proxy** (`/api/v1/[...path]`), the **Client Web Audio Sonification Engine**, and **Static Offline NASA GEOS-CF v2 Fallback Assets**.

### Scientific & Engineering Rules
1. **Strict Physical Separation (`AOD` $\neq$ `AQI` $\neq$ `PM2.5`):**
   - **Aerosol Optical Depth (AOD 550nm)** is **dimensionless** column light extinction and must never be conflated with Air Quality Index (**AQI**) or ground-level mass concentration (**PM2.5** in `µg/m³`).
   - Trace gases (`NO2`, `O3`, `SO2`, `CO`) are stored natively in GEOS-CF v2 NetCDF-4 files as `mol mol-1` and converted for human display/sonification via `1e9` (`ppbv`).
2. **Explicit Provenance & Mock Flagging:**
   - Verified NASA GMAO GEOS-CF v2 observations and NetCDF-4 queries MUST carry `isMock: false`.
   - Synthetic development/prototype datasets MUST carry `isMock: true`.
3. **UTC Time & Spatial Projection Integrity:**
   - All timestamps follow ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`, centered at `:30Z` for hourly GEOS-CF `tavg_1hr` granules).
   - GEOS-CF v2 offline equirectangular PNG overlays strictly cover `EPSG:4326` `[-180, 180] x [-90, 90]` at `1920x1080` so `(lat, lon)` pixel lookup matches backend NetCDF-4 grid cell sampling.

---

## 2. Schema Definitions (TypeScript & Pydantic v2)

### A. Observation & Dataset Catalog (`observation_schema.py` ↔ `observation.ts` / `dataset.ts`)

| Model | Fields | Source File |
| :--- | :--- | :--- |
| `Observation` / `ObservationSchema` | `id`, `timestamp`, `imageUrl`, `value`, `unit`, `variable`, `description`, `isMock`, `coordinates { lat, lon, regionName }`, `provenance { satellite, instrument, processingLevel, citationUrl }` | `backend/src/api/schemas/observation_schema.py`, `frontend/src/types/observation.ts` |
| `Dataset` / `DatasetSchema` | `id`, `title`, `source`, `sourceUrl`, `variable`, `unit`, `description`, `observations[]`, `isMock`, `range { min, max }` | `backend/src/api/schemas/observation_schema.py`, `frontend/src/types/dataset.ts` |

### B. Dataset Metadata, Availability & Locations (`dataset_metadata_schema.py` ↔ `backendApi.ts`)

| Schema | Key Fields | Purpose |
| :--- | :--- | :--- |
| `DatasetSummary` | `id`, `title`, `provider`, `product`, `version`, `dataType`, `temporalResolution`, `spatialResolution`, `isMock` | Catalog of live (`geos-cf-v2-aqc`) and prototype datasets |
| `VariableMeta` | `variable`, `name`, `unit`, `displayUnit`, `description`, `type` | Unit & physical meaning lookup |
| `DatasetAvailability` | `datasetId`, `availableTimes: string[]`, `timeRange: { start, end }`, `totalGranules: number` | Active ingested/cached UTC timestamps discovered from backend storage |
| `LocationItem` | `id`, `name`, `lat`, `lon`, `region`, `isPreset` | Global preset stations & saved spatial anchors |

### C. Spatial, Temporal & Region Jukebox (`jukebox_schema.py` ↔ `geosCfRaster.ts` / `backendApi.ts`)

| Schema | Key Fields | Purpose |
| :--- | :--- | :--- |
| `SpatialJukeboxRequest` | `datasetId`, `timestamp`, `variable`, `locations[]`, `normalizationMethod` | Spatial scan across ordered cities/points at one timestamp |
| `TemporalJukeboxQuery` | Query params: `dataset_id`, `lat`, `lon`, `variable`, `start`, `end`, `interval`, `normalization_method`, `offline_only` | Single-location diurnal time series (`GET /api/v1/jukebox/temporal`) |
| `JukeboxResponse` | `mode ("spatial" \| "temporal")`, `datasetId`, `variable`, `unit`, `displayUnit`, `dataType`, `isMock`, `normalization`, `points[]`, `provenance` | Playlist points with `value`, `displayValue`, `normalizedValue [0..1]`, `quality` |
| `RegionJukeboxRequest` | `datasetId`, `timestamp`, `variable`, `bounds { latMin, latMax, lonMin, lonMax }`, `polygon?`, `polygons?`, `includeSeries`, `seriesStepHours`, `normalizationMethod` | Single-ROI drag-box / country border / MultiPolygon spatial aggregation |
| `RegionJukeboxResponse` | `mode ("region")`, `maskMode ("bounds" \| "polygon")`, `variable`, `displayUnit`, `isMock`, `summary { min, mean, p90, max, display*, normalized*, validCount, totalCount, snappedToNearest, tierRatios }`, `series?`, `seriesTimestamps?`, `provenance` | Powers Explore/Studio `RegionStats` & diurnal audio curve (`series`) |

---

## 3. Atmospheric Variables & Unit Calibration (`geos_cf.py` & `render_geos_cf_maps.py`)

| Variable Code | Display Name | Native Unit | Display Unit (`factor`) | Colormap Calibration `[vmin, vmax]` |
| :--- | :--- | :--- | :--- | :--- |
| `PM25_RH35` | Surface Particulate Matter (≤ 2.5 µm, RH 35%) | `ug m-3` | `µg/m³` (`× 1`) | `inferno` `[0.0, 150.0]` |
| `NO2` | Nitrogen Dioxide (`NO2`) | `mol mol-1` | `ppbv` (`× 1e9`) | `magma` `[0.0, 45.0]` |
| `O3` | Tropospheric Ozone (`O3`) | `mol mol-1` | `ppbv` (`× 1e9`) | `viridis` `[10.0, 50.0]` |
| `CO` | Carbon Monoxide (`CO`) | `mol mol-1` | `ppbv` (`× 1e9`) | `cividis` `[50.0, 600.0]` |
| `SO2` | Sulfur Dioxide (`SO2`) | `mol mol-1` | `ppbv` (`× 1e9`) | `plasma` `[0.0, 25.0]` |
| `AOD` *(independent)* | Aerosol Optical Depth (550 nm) | `dimensionless` | `dimensionless` (`× 1`) | Never substituted for `PM25_RH35` |

---

## 4. Backend REST API Endpoints (`/api/v1`)

| Method & Path | Request / Query | Response Model | Frontend Consumer |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/health` | — | `BackendHealthStatus` (`status`, `dataset_loaded`, `observations_count`, `active_variable`) | `BreatheContext.tsx` (`checkBackendHealth`) |
| `GET /api/v1/datasets` | — | `List[DatasetSummary]` | API discovery / OpenAPI |
| `GET /api/v1/datasets/{dataset_id}/variables` | `dataset_id` | `List[VariableMeta]` | Metadata inspection |
| `GET /api/v1/datasets/{dataset_id}/availability` | `dataset_id` | `DatasetAvailability` | `BreatheContext.tsx` (`fetchDatasetAvailability`) |
| `GET /api/v1/locations` | — | `List[LocationItem]` | `BreatheContext.tsx` (`fetchBackendLocations`) |
| `POST /api/v1/jukebox/spatial` | `SpatialJukeboxRequest` | `JukeboxResponse` (`mode="spatial"`) | Multi-city spatial scan |
| `GET /api/v1/jukebox/temporal` | `lat`, `lon`, `variable`, `start`, `end`, `interval` | `JukeboxResponse` (`mode="temporal"`) | `geosCfRaster.ts` (`samplePointSeries`) for Learning Lab |
| `POST /api/v1/jukebox/region` | `RegionJukeboxRequest` | `RegionJukeboxResponse` | `geosCfRaster.ts` (`fetchBackendRegionStats`, `samplePolygonSeries`) |
| `GET /api/v1/observations/air-quality` | — | `DatasetSchema` | `dataService.ts` (`getDataset`) |
| `GET /api/v1/observations/aod` | — | `DatasetSchema` | `dataService.ts` AOD fallback |

---

## 5. Runtime Proxy, Resilience & Offline Asset Policy

1. **Same-Origin Next.js Proxy (`frontend/src/app/api/v1/[...path]/route.ts`):**
   - Browser clients default to relative `/api/v1/...` calls when `NEXT_PUBLIC_BACKEND_URL` / `NEXT_PUBLIC_API_URL` are unset.
   - Next.js server routes `/api/v1/*` at runtime to `BACKEND_API_URL` (Docker Compose: `http://backend:8000`; Azure Container Apps: `https://<backend-fqdn>`; local default: `http://localhost:8000`), avoiding build-time URL lock-in and CORS fragility.
   - Setting `NEXT_PUBLIC_BACKEND_URL` explicitly bypasses the proxy cleanly when direct browser-to-API access is desired.
2. **Offline Fallback & Circuit Breaker (`geosCfRaster.ts`):**
   - `fetchBackendRegionStats` (3500 ms timeout) and `samplePolygonSeries` (5000 ms timeout) enter a 30 s cooldown upon backend error/timeout and automatically sample committed 1920x1080 equirectangular PNGs indexed by `frontend/public/images/geos-cf/manifest.json`.
   - `samplePointSeries` attempts `GET /api/v1/jukebox/temporal` first before falling back seamlessly to offline PNG pixel sampling.
3. **Data Pipeline & Repository Asset Governance (`backend/scripts/run_data_pipeline.py`):**
   - Unified orchestrator discovers the latest available NASA NCCS GEOS-CF v2 UTC date (`--date latest`), ingests NetCDF-4 granules into SQLite/PostgreSQL, refreshes `backend/src/data/eda_outputs/eda_summary_metrics.json`, and updates offline PNG maps (`render_geos_cf_maps.py`).
   - Heavy NetCDF-4 binaries (`*.nc4`) and regenerable EDA plots (`backend/src/data/eda_outputs/*.png`) are gitignored; the 40 equirectangular map PNGs (`frontend/public/images/geos-cf/*.png`) remain committed to preserve instant offline M4 map/sonification operation.
