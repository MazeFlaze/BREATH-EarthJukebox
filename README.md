# BREATHE – Earth Information Jukebox

> **Hear what the atmosphere is telling us.**  
> Built for the **NASA Space Apps Challenge 2026** – *The Earth Information Jukebox*  
> An interactive Earth science platform and real-time sonification instrument translating verified NASA atmospheric observations into synchronized visuals and multi-stem soundscapes.

---

## 1. What BREATHE Does

**BREATHE** converts multi-dimensional NASA atmospheric datasets into an interactive audiovisual experience. Users explore global and regional pollutant dynamics across space and UTC time while listening to physical concentrations, extreme peaks, spatial spread, and temporal/spatial gradients mapped into harmonic Web Audio synthesis.

### Core Experiences
- **Overview (`/`):** Ambient introduction and entry point into the BREATHE experience.
- **Explore (`/explore`, `/explore/region`):** Interactive 3D globe and 2D flat map powered by **MapLibre GL**, UTC timeline scrubbing, custom polygon/rectangle/freehand region selection, and verified scientific playback sessions across global grids, single regions, or side-by-side **A/B comparisons**.
- **Studio (`/studio`):** Real-time sound design workspace with four independent audio stems (*Field / mean*, *Highlights / P90 excess*, *Spread / IQR*, and *Edges / spatial derivatives*), musical key/tempo/waveform/spatial-spread controls, live waveform/spectrogram/particle-field/rhythm-grid visualizations, and reproducible session recipe export (`breathe-recipe-v1` JSON).
- **Gallery (`/gallery`):** Browse, search, filter, bookmark, and replay curated and user-saved atmospheric soundscapes.
- **Learn (`/learn`):** Guided side-by-side environmental comparisons explaining atmospheric physics and data-to-sound mappings.

### Supported Atmospheric Data
- **Verified NASA Source:** **NASA GMAO GEOS-CF v2** (`aqc_tavg_1hr_glo_L1440x721_slv`, `0.25°` global grid, `:30` UTC hourly slots) via NASA NCCS / OPeNDAP.
- **Variables:** `PM2.5` (`PM25_RH35`), `PM10` (`PM10_RH35`), `CO`, `NO2`, `O3`, and `SO2` (plus dedicated AOD dataset endpoints kept scientifically distinct from surface pollutants).

---

## 2. Architecture & Repository Structure

BREATHE is decoupled into a **Next.js / Web Audio** client, a **FastAPI / NumPy / xarray** scientific backend, and shared architectural contracts:

```text
BREATHE-EarthJukebox/
├── frontend/                   # Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
│   ├── public/audio/           # AudioWorklet DSP synthesizer & orchestration engine
│   ├── public/images/          # NASA Blue Marble, cloud, and GEOS-CF visual layers
│   ├── public/workers/         # MapLibre & raster tile workers
│   ├── scripts/                # Cross-language parity & contract test runners
│   └── src/                    # App routes, MapLibre GeoMap, Recharts, Web Audio services
│
├── backend/                    # Python 3.12, FastAPI, Pydantic v2, Pandas, xarray, netCDF4
│   ├── migrations/             # Alembic database migrations (SQLite / PostgreSQL)
│   ├── scripts/                # NASA ingestion, catalog export, EDA & verified sync CLIs
│   ├── src/                    # API routes, Pydantic schemas, scientific processors, services
│   └── tests/                  # Pytest unit, API, provenance & numeric parity test suites
│
├── docs/                       # Specifications & integration contracts
│   ├── ARCHITECTURE.md         # System design & decoupled responsibilities
│   ├── DATA_CONTRACT.md        # Observation & dataset schema definitions
│   ├── SONIFICATION_CONTRACT.md# Acoustic transfer functions & Web Audio lifecycle
│   ├── SCIENTIFIC_SESSION_CONTRACT.md     # Versioned /api/v1/scientific contract
│   ├── SCIENTIFIC_SESSION_INTEGRATION.md  # Integration notes & acceptance evidence
│   ├── PROJECT_OVERVIEW.md     # Vision & user journey
│   ├── SRS.md                  # Software Requirements Specification
│   └── AZURE_DEPLOYMENT_GUIDE.md # Scale-to-zero Azure Container Apps & Neon guide
│
├── scripts/                    # Deployment helpers (deploy-azure.sh)
├── .github/workflows/          # CI/CD (breathe-ci-cd.yml) & catalog sync workflows
├── .agents/                    # Multi-stack agent blueprints, rules & domain skills
├── docker-compose.yml          # Containerized full-stack local setup
└── README.md
```

---

## 3. Quick Start Guide

### Option A: Docker Compose (Full Stack)

```bash
# 1. Clone the repository
git clone https://github.com/MazeFlaze/BREATH-EarthJukebox.git
cd BREATH-EarthJukebox

# 2. Create local environment file required by docker-compose.yml
cp .env.example .env.local

# 3. Build and start both backend (port 8000) and frontend (port 3000)
docker compose up --build
```

- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend Swagger UI:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

### Option B: Run Locally (Development)

#### 1. Backend (Python Scientific API)
Requires Python `3.10+` (`3.12` recommended; NetCDF4/HDF5 system libraries on Linux if building from source).

```bash
# Create and activate virtual environment from repository root
python3 -m venv backend/.venv
source backend/.venv/bin/activate      # Windows PowerShell: backend\.venv\Scripts\Activate.ps1

# Install Python dependencies
pip install -r backend/requirements.txt

# Configure backend environment
cp backend/.env.example backend/.env

# Start FastAPI server
python -m uvicorn backend.src.main:app --reload --port 8000
```

- **API Base URL:** [http://localhost:8000](http://localhost:8000)
- **Interactive OpenAPI Docs:** [http://localhost:8000/docs](http://localhost:8000/docs) | **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

Optional: Sync the latest 24 hours of verified NASA GEOS-CF v2 granules into the local scientific catalog:
```bash
npm run sync:catalog
# Or directly:
python -m backend.scripts.sync_verified_catalog --latest-hours 24 --scientific-only
```

#### 2. Frontend (Next.js Web Client)
Requires Node.js `20+`. The frontend can connect to the local backend via its `/api/v1` proxy (`BACKEND_API_URL`) or fall back to bundled datasets when configured.

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

- **App URL:** [http://localhost:3000](http://localhost:3000)

---

## 4. API Overview

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Service health check and active dataset metadata |
| `GET` | `/api/v1/datasets`, `/api/v1/locations` | Available atmospheric datasets and preset stations |
| `GET` | `/api/v1/observations/air-quality`, `/aod` | Processed atmospheric observation series & AOD records |
| `POST` | `/api/v1/jukebox/spatial` | Spatial sequence across locations at a single UTC timestamp |
| `GET` | `/api/v1/jukebox/temporal` | Hourly time series for a single coordinate across a UTC window |
| `POST` | `/api/v1/jukebox/region` | Drag-box / polygon ROI statistics with perceptual normalization |
| `GET` | `/api/v1/scientific/catalog` | Validated local/mounted GEOS-CF v2 catalog manifest |
| `POST` | `/api/v1/scientific/sessions` | Prepares immutable scientific session plan & `float32-le` binary arrays |
| `POST` | `/api/v1/scientific/frames` | Stateless frame delivery with SHA-256 & calibration verification |

---

## 5. Verification & Testing

### Frontend Checks (run inside `frontend/`)
```bash
npm run lint            # ESLint checks
npm run typecheck       # TypeScript type validation (tsc --noEmit)
npm run test:contracts  # Locked TypeScript contract & map unit tests
npm run test:demo       # Scientific audio & cross-language parity tests
npm run build           # Production Next.js build
```

### Backend Tests (run inside `backend/`)
```bash
PYTHONPATH=src:. pytest -v tests/
```

---

## 6. Scientific Rigor & Data Attribution Policy

1. **AOD ≠ Surface Concentrations ≠ AQI:**  
   Column **Aerosol Optical Depth (AOD)** is a dimensionless measure of vertical sunlight extinction through the entire atmospheric column. It is never conflated with surface pollutant concentrations (`PM2.5`, `PM10`, `NO2`, `SO2`, `CO`, `O3`) or ground-level **Air Quality Index (AQI)**.
2. **Verified Provenance & Exact `NaN` Handling:**  
   Verified scientific sessions compute cosine-latitude-weighted means and unweighted native-sample quantiles (P90, IQR), verify source SHA-256 checksums on every frame read, and preserve missing observations as IEEE `NaN` in binary arrays without synthetic interpolation.
3. **Explicit Mock vs. Verified Demarcation:**  
   Offline/development fixtures carry explicit `isMock: true` flags and UI badges, and are never substituted for verified NASA observations inside scientific session endpoints.

---

## 7. Team Workstreams

| Workstream | Role | Primary Directory | Core Technologies |
| :--- | :--- | :--- | :--- |
| **N01 – Data Engineering** | NASA GEOS-CF ingestion, NetCDF4 & catalog sync | `backend/scripts/`, `providers/` | Python, xarray, netCDF4, Pandas, HTTPX |
| **N02 – Scientific Research** | Physical units, cosine weighting, quantiles, contracts | `docs/`, `backend/src/processors/` | Atmospheric Physics, NumPy, SciPy |
| **N03 – Sonification** | AudioWorklet DSP synthesizer & 4-stem orchestration | `frontend/public/audio/`, `services/` | Web Audio API, AudioWorklet, DSP |
| **N04 – Frontend Development** | App Router, MapLibre globe/map, Studio & charts | `frontend/src/` | Next.js 14, React 18, TypeScript, Recharts |
| **N05 – UI/UX & Storytelling** | Visual system, landing experience, Learn & Gallery | `frontend/public/`, `src/app/` | Tailwind CSS, MapLibre GL, Design System |
| **N06 – Integration & QA** | API contracts, CI/CD, Azure/Docker & parity tests | Root, `.github/workflows/`, `tests/` | Pytest, Node Test Runner, Docker, Azure |

---

## 8. Use of Super Intelligence (SI) / AI Disclosure

In accordance with NASA Space Apps Challenge 2026 guidelines:
- **Code & Documentation:** Large language model coding assistants were used to accelerate architecture planning, full-stack code generation/refactoring, test authoring, and documentation.
- **Scientific Data & Audio:** All verified atmospheric datasets come directly from official **NASA GMAO GEOS-CF v2** archives (not AI-generated data). All sonification audio is synthesized deterministically in the browser via Web Audio API digital signal processing rather than generative AI audio models.
- **Visual Assets:** Scientific atmospheric layers and globe imagery are rendered from NASA data and open map sources. Any decorative visual media generated or edited using external AI tools must carry a visible SI-generated watermark and must never include or alter NASA branding or logos.

---

## 9. Deployment & Versioning

- **CI/CD & Cloud Hosting:** Configured via [breathe-ci-cd.yml](.github/workflows/breathe-ci-cd.yml) and [scripts/deploy-azure.sh](scripts/deploy-azure.sh) for scale-to-zero **Azure Container Apps** with **Neon Serverless PostgreSQL** and read-only Azure File Share mounting for the verified GEOS-CF catalog (see [docs/AZURE_DEPLOYMENT_GUIDE.md](docs/AZURE_DEPLOYMENT_GUIDE.md)).
- **Current Version:** `1.0.0` (NASA Space Apps Challenge 2026 release candidate).

---

## 10. License

Distributed under the MIT License. Built for the **NASA Space Apps Challenge 2026**.
