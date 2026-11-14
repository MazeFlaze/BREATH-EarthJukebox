# Restructure Backend & Frontend with Subagent & SVS 5533 Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Skills & Subagents
- **Skills:**
  - `python-project-structure`: Module cohesion, explicit interfaces (`__all__`), shallow package hierarchy.
  - `pydantic-v2`: Strict validation, `BaseModel`, `ConfigDict`, `Field` metadata.
  - `python-testing-patterns`: Pytest fixtures, test client validation, edge cases.
  - `nasa-earthdata-retrieval`: NASA SVS 5533 API, GMAO GEOS-CF assimilation, and GIBS satellite snapshot imagery.
- **Subagents (`.agents/agents.toml`):**
  - `python_backend`: Python backend architecture, modern packaging, SVS 5533 processor, and pytest suite.
  - `frontend_developer`: Frontend data service alignment, API client resilience, and fallback.
  - `qa_reviewer`: End-to-end verification across both stacks.

---

## Architecture Overview

```text
BREATHE-EarthJukebox/
├── .agents/                               # Multi-stack Agent Registry & Skills
│   ├── agents.toml                        # Token-optimized subagent blueprints
│   ├── rules/
│   │   └── AGENTS.md                      # Governance, typing, and security rules
│   └── skills/
│       ├── nasa-earthdata-retrieval/      # SVS 5533 & GEOS-CF retrieval skill
│       ├── python-project-structure/      # Python architectural standards
│       └── pydantic-v2/                   # Pydantic v2 validation standards
├── backend/                               # Python Core (FastAPI + Pydantic v2)
│   ├── pyproject.toml                     # Modern Python packaging (Hatchling/uv)
│   ├── requirements.txt                   # Production & dev dependencies
│   ├── src/
│   │   ├── main.py                        # FastAPI entrypoint with CORS & routes
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── health.py              # Health check endpoint
│   │   │   │   ├── observations.py        # /aod and /air-quality endpoints
│   │   │   └── schemas/
│   │   │       └── observation_schema.py  # Pydantic v2 schemas
│   │   ├── processors/
│   │   │   ├── nasa_aod_processor.py      # AOD data cleaner & loader
│   │   │   └── nasa_svs_processor.py      # SVS 5533 GEOS-CF air quality processor
│   │   ├── services/
│   │   │   └── data_service.py            # Multi-dataset cache & query service
│   │   └── data/processed/
│   │       ├── aod_nasa_processed.json    # Verified AOD dataset
│   │       └── svs5533_geos_cf_processed.json # Verified SVS 5533 air quality dataset
│   └── tests/
│       ├── conftest.py                    # Pytest client fixtures
│       ├── test_api.py                    # AOD & Health route tests
│       └── test_svs_api.py                # SVS 5533 route & processor tests
├── frontend/                              # Next.js 14 Web Audio Application
│   ├── package.json
│   ├── next.config.mjs
│   └── src/
│       ├── services/dataService.ts        # Dynamic fetch with backend fallback
│       └── data/observations.json         # SVS 5533 verified dataset
├── docs/                                  # Project specifications & contracts
└── README.md                              # Root Monorepo README & startup guide
```

---

## Implementation Tasks

### Task 1: Setup `.agents/` Environment & Governance
- [x] Create `.agents/agents.toml` with `python_backend`, `frontend_developer`, `qa_reviewer`, and `security_auditor` roles.
- [x] Create `.agents/rules/AGENTS.md` defining multi-stack engineering, token hygiene, and security protocols.
- [x] Symlink or vendor core skills into `.agents/skills/` (`python-project-structure`, `pydantic-v2`, `nasa-earthdata-retrieval`).

### Task 2: Modernize Backend Packaging (`pyproject.toml`)
- [x] Create `backend/pyproject.toml` with standard build-system metadata, `dependencies`, `pytest` configuration, and project info.
- [x] Update `backend/requirements.txt` to include `pandas`, `pydantic>=2.6.0`, `fastapi`, `uvicorn`, `httpx`, and `pytest`.

### Task 3: Build NASA SVS 5533 Processor & Data Store
- [x] Create `backend/src/processors/nasa_svs_processor.py` to ingest SVS 5533 metadata, transform July-August 2024 PM2.5/CO/O3 observations, and link NASA GIBS satellite images.
- [x] Generate `backend/src/data/processed/svs5533_geos_cf_processed.json` with verified NASA data (`isMock: false`).

### Task 4: Extend Backend API Routes & DataService
- [x] Update `backend/src/services/data_service.py` to manage both datasets: AOD (`aod`) and Air Quality SVS 5533 (`svs5533`).
- [x] Add `/api/v1/observations/air-quality` and `/api/v1/observations/air-quality/range` routes in `backend/src/api/routes/observations.py`.
- [x] Update root endpoint `/` in `backend/src/main.py` to reflect new SVS 5533 air quality endpoints.

### Task 5: Add Backend Pytest Test Suite
- [x] Create `backend/tests/conftest.py` with FastAPI `TestClient`.
- [x] Create `backend/tests/test_svs_api.py` testing `/api/v1/observations/air-quality`, range calculation, and individual observation lookup.
- [x] Run test suite with pytest and ensure 100% pass rate.

### Task 6: Synchronize Frontend Service with Dual-Stack API Support
- [x] Review `frontend/src/services/dataService.ts` to ensure it connects to `NEXT_PUBLIC_API_URL` (defaulting to `http://localhost:8000/api/v1`) with fallback to bundled `src/data/observations.json`.
- [x] Update `frontend/.env.example` with `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`.

### Task 7: Full System Verification & Git Cleanliness
- [x] Verify backend tests pass with zero errors.
- [x] Check Git status and ensure atomic, clean commit organization.
