# Contributing to BREATHE – Earth Information Jukebox

Thank you for contributing to BREATHE for the **NASA Space Apps Challenge 2026**!

---

## 1. Workstream Matrix
Work is organized across 6 decoupled streams to eliminate merge conflicts:
- **N01 (Data Engineering):** NASA CMR, SVS, GIBS data pipelines (`backend/scripts/`, `backend/src/processors/`).
- **N02 (Scientific Research):** Variable verification, unit checks, scientific narrative (`docs/DATA_CONTRACT.md`).
- **N03 (Sonification):** Web Audio API acoustic synthesis, harmonics, frequency mapping (`frontend/src/services/sonificationService.ts`).
- **N04 (Frontend Development):** Layout, Recharts charts, timelines, Next.js routing (`frontend/src/app/`, `frontend/src/components/`).
- **N05 (UI/UX & Storytelling):** Atmospheric styling, accessibility, icons (`frontend/src/app/globals.css`, `frontend/public/`).
- **N06 (QA & Integration):** Cross-module testing, review gates, CI/CD (`backend/tests/`, `.github/`).

---

## 2. Git & PR Workflow
1. Branch from `main`: `git checkout -b <type>/<short-description>` (e.g. `feat/tempo-ozone-ingest`).
2. Atomic Commits following Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
3. Always link commits to an existing GitHub Issue (`closes #<issue>`).
4. Ensure all CI checks pass (`pytest` in backend, `tsc`/`lint` in frontend) before requesting merge.
