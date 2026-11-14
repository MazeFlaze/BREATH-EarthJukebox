# AGENTS.md — BREATHE Project Multi-Stack Governance Rules

> **Single Source of Truth for Autonomous AI Agents and Multi-Stack Engineering in BREATHE.**
> All agents working on this repository must strictly adhere to the standards below.

---

## 1. Core Operating Principles

1. **Evidence Over Assertion**:
   - Never declare a bug fixed or an endpoint working without running concrete verification (`pytest`, `curl`, `npm run typecheck`, `npm run build`) and inspecting real execution output.
2. **Zero-Assumption & Read-First Policy**:
   - Always read existing schemas and contracts (`docs/DATA_CONTRACT.md`, `backend/src/api/schemas/`, `frontend/src/types/`) before modifying code.
3. **Scientific Integrity**:
   - Aerosol Optical Depth (AOD) is dimensionless and must NEVER be conflated with Air Quality Index (AQI) or ground-level Particulate Matter ($PM_{2.5}$).
   - Synthetic development mock data MUST have `isMock: true`. Verified NASA data carries `isMock: false` with complete provenance.

---

## 2. Technical Stack Boundaries

- **Backend (`backend/`)**:
  - Python 3.10+ with FastAPI, Pydantic v2, and Uvicorn.
  - Strict type annotations, `BaseModel` schemas for all request/response models.
  - Pytest unit and integration tests located in `backend/tests/`.
- **Frontend (`frontend/`)**:
  - Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS.
  - Browser native Web Audio API for client-side sonification.
  - Resilient `dataService.ts` fetching from `http://localhost:8000/api/v1` with fallback to bundled local JSON.

---

## 3. Security & Hygiene Protocols

1. **No Hardcoded Secrets**: Ensure `.env` is ignored by git; document variables in `.env.example`.
2. **Data Sanitization**: External responses from NASA SVS, CMR, or GIBS must pass through Pydantic validators before being cached or served.
