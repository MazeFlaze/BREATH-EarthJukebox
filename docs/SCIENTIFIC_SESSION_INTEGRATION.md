# Demo → backend → Explore / Studio integration

User-approved scope: preserve local demo; backend computes scientific/arrangement plans, browser renders audio; Explore → Studio shares the session; no animated interpolation. The user subsequently authorized commits and a pull request for the integrated product. No deployment or automatic PR merge is authorized.

## Merge and preservation

- Branch: `feat/issue-22-demo-checkpoint`; original HEAD `f697186fd395a9f17bb15e89922c46a003a962c4`.
- Fetched main: `b14671fc5e0263f65f72748d843e0685a83aeff7`.
- Before publication, fetched main again at `36b19c5`. Preserved its runtime API proxy, portable test discovery, cancellation/performance fixes and standalone deployment configuration. Scientific requests now reuse its URL resolver. Merge resolutions combine `auto_cleanup` with `preserve_raw`, retain hourly validation plus configurable range steps, and keep both environment configuration groups.
- Initially applied `git merge --no-commit --no-ff origin/main` for review. After user authorization, merge commit `0a00333` recorded the resolved conflicts; backend integration is recorded in `374a01c`.
- Kept the new main CI/CD workflow, migrated demo parity into its frontend job, retained `test` and `test:demo`, and preserved backend test assertions. Removed duplicate/unused imports in the conflicting backend test. Added a locked-TypeScript contract-test runner so CI does not need to download tsx on demand.
- Local changes restored from retained stash. ZIP: `.local-backups/before-main-integration-20261115-130039.zip`. `/demo` stays ignored. Do not drop the backup/stash before reviewing this integration.
- `npm ci` synchronized main's existing lockfile; no dependency was added. Test DBs are isolated from the user's database and archive. NASA download/export scripts were not run.

## Implementation decisions

- Add versioned scientific endpoints; do not change existing `/jukebox/region` statistics from arithmetic mean to cosine weighting. Existing consumers keep their meaning.
- Read existing native exports and validate catalog, SHA, byte length, source UTC, units, calibration and coverage. Do not rebuild preprocessing or sample scientific values from PNGs.
- Port the tested native-band calculations to NumPy: weighted Mean, raw quantiles, coverage, contrast, spatial/temporal derivatives, windows, notes and A/B held progress. Preserve native bin/ROI policies and fixed audio_max.
- Transport compact features as little-endian base64 arrays. Missing IEEE NaN never becomes invalid JSON or zero. Native map views are separate, bounded to three in the browser.
- Use stateless POST `/scientific/frames` during playback so server restarts/worker changes do not require a shared plan cache. Fail on changed source/calibration; keep frozen missing slots missing.
- Deliver server arrangement to the existing ContextSynth/AudioWorklet. Reuse the main sonification service's AudioContext, stop competing schedulers and keep page roots isolated from high-frequency clock updates.
- Add an explicit verified-session entry in existing Explore/Studio pages. The existing map workspace remains accessible. Reuse its geographic editor for an explicitly labelled enclosing rectangle. Native scientific raster is rendered with the promoted EPSG:4326 canvas, preserving projection integrity.
- Preserve selection, plan, cursor, controls and audio across client navigation Explore → Studio. No new route or dependency on ignored demo files.
- Export source-bound recipe JSON separately from the legacy gallery project schema; do not present it as an uploaded/shared artwork.

Contract: [SCIENTIFIC_SESSION_CONTRACT.md](SCIENTIFIC_SESSION_CONTRACT.md).

## Integration files (separate from files brought in by main)

Backend additions:

- `src/api/schemas/scientific_session_schema.py`: selection, plan, binary-array and frame models.
- `src/api/routes/scientific_sessions.py`: additive scientific endpoints.
- `src/services/scientific_catalog_service.py`: read-only verified artifact adapter.
- `src/services/scientific_session_service.py`: canonical plan construction, bounded convenience cache and stateless frames.
- `src/processors/scientific_session_processor.py`: NumPy feature and arrangement implementation.
- `tests/test_scientific_sessions.py`: cross-language and API/integrity regression tests.

Backend edits: `src/main.py`, `src/core/config.py`, `.env.example`; conflict resolution in `tests/test_subissue14_m4.py`.

Frontend additions:

- `src/types/scientificSession.ts`, `src/services/scientificSession.ts`: typed contract and binary/source validation.
- `src/context/ScientificSessionContext.tsx`: shared transport, request cancellation, mixer, frame prefetch/cache and horizon.
- `src/components/scientific/ScientificWorkspace.tsx`, `ScientificRaster.tsx`, `scientific.module.css`: integrated controls/map/explanation.
- `scripts/scientific-parity-fixture.mjs`, `scientific-session.test.cjs`, `register-typescript-tests.cjs`: deterministic fixtures/contract checks.

Frontend edits: `src/app/layout.tsx`, `src/app/explore/page.tsx`, `src/app/studio/page.tsx`, `src/services/sonificationService.ts`, `src/services/geosCfStreamAudio.ts`, `src/types/geosCfDetail.ts`, `public/audio/geos-cf-orchestration.mjs`, `package.json`.

CI: `.github/workflows/breathe-ci-cd.yml`, removal of superseded `.github/workflows/ci.yml`. Docs: this file and `SCIENTIFIC_SESSION_CONTRACT.md`. Earlier uncommitted unified-demo changes remain preserved in addition to this list; use `git diff` and `git diff --cached` together because merge changes are staged while later integration edits are unstaged.

## Verification

2026-11-15, authorized by user:

- Typecheck and lint passed (no ESLint warnings/errors).
- Production build passed, including `/explore`, `/studio` and the retained ignored local demo.
- Entire backend suite: 105 passed. Scientific session suite: 12 passed, including stateless frames after clearing plan cache and rejection of source/calibration drift.
- Existing frontend contracts/maps: 41 passed using the installed TypeScript compiler (`npm run test:contracts`).
- Existing demo/audio parity: 30 passed. New scientific adapter: 3 passed. Local unified-demo regression: 5 passed (not required by CI because it references ignored demo source).
- Python/browser numeric parity covers raw Mean/P90/IQR, grid bins, coverage, derivative scores, arrangement windows and notes at global/coarse and ROI/native settings, both axes. Synthetic parity input is explicitly marked isMock.

Publication revalidation after latest-main synchronization: entire backend suite 111 passed; frontend contracts 56 passed; typecheck/lint and production build passed. Audio/adapter coverage includes 30 existing cases plus four adapter cases, including same-origin routing. HTTP smoke through the production Next.js proxy returned 24 catalog sources, a 24-step plan and a 721×1440 frame with matching SHA. CI YAML parsed with unique jobs. CI retains main's frontend build job, adds parity and invokes portable test discovery with the already locked TypeScript compiler. Local-only unified-demo tests are explicitly ignored because their source route is excluded from Git.

Production browser acceptance (Edge headless, isolated profile): preview ends at exactly 20s; Pause/Resume; SPA Explore → Studio retains plan/cursor and one AudioContext; changing UTC changes raster; recipe contains 24 source references. Full 180s playback completed across all 24 real UTC slots with output guard 0. Delayed real POST `/frames` response freezes the sample clock and resumes with matching source. Reverse, global/ROI/A–B, Scientific/context, all three traversals, native vertical 16 bands, six pollutants, seven-minute preparation, keyboard ROI and one native point passed. Desktop 1440px and mobile 390px had no page overflow. Runtime exceptions and network loading failures: zero in the completed run. Screenshots were visually inspected.

Evidence: `.local-backups/scientific-qa/report.json`, `run.log`, desktop/mobile PNGs and source-bound recipe. Early harness attempts (before hydration and a malformed diagnostic selector) failed; these were harness errors, corrected before the completed run. After final clock-subtree isolation and native batch-sort optimization, parity/typecheck/lint/build passed; the focused final production run also passed the preview, navigation, buffering, all scopes/traversals/pollutants, keyboard ROI, one-point map and mobile checks with one context and zero runtime/network failures. Its evidence is in `.local-backups/scientific-qa-final/report.json`. Full 180s evidence remains in the earlier report; it was not repeated after this UI/performance-only change. No claim of full 5/7-minute playback or subjective musical approval is made.

Native spatial quantiles batch-sort original samples per band. Local measurement: 24 real snapshots × 721 rows × 16 bands (17,304 canonical steps) prepared in 4.795s, including checksum reads and arrangement. This is one local measurement, not a latency guarantee for other machines or production cold starts. Cross-language parity was rerun after the optimization.

Build completed without the old viewport metadata warning inherited by the demo checkpoint; production runtime still recommends optional `sharp` for Next image optimization. It was not installed. Existing Python tests emitted Starlette/httpx and Matplotlib deprecation warnings. `git diff --check` is clean for integration edits; the staged main merge retains existing trailing-whitespace/EOF warnings in unrelated files.

## Manual use and remaining limits

1. **Provision verified data before starting:**
   - **Local Dev:** run `npm run sync:catalog` (or `PYTHONPATH=backend/src:backend:. backend/.venv/bin/python -m backend.scripts.sync_verified_catalog --latest-hours 24 --scientific-only`), which probes backward from UTC for the latest 24 verified NASA GEOS-CF v2 `:30Z` snapshots into `backend/src/data/nasa-archive` and exports `index.json`, `detail.json`, and `native-*.f32` grids into `frontend/public/data/geos-cf-catalog`.
   - **Docker Compose:** mounts `./frontend/public/data/geos-cf-catalog:/app/data/geos-cf-catalog:ro` into `breathe-backend` with `GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog`.
   - **Azure Production:** [`.github/workflows/breathe-ci-cd.yml`](../.github/workflows/breathe-ci-cd.yml) and [`scripts/deploy-azure.sh`](../scripts/deploy-azure.sh) provision the `geos-cf-catalog` Azure File Share and mount it `ReadOnly` at `/app/data/geos-cf-catalog`. Trigger [`.github/workflows/sync-verified-catalog.yml`](../.github/workflows/sync-verified-catalog.yml) via `workflow_dispatch` to populate or refresh the share cleanly without restarting or embedding datasets in Docker images.
2. Start FastAPI (`GEOS_CF_CATALOG_ROOT` defaults to `frontend/public/data/geos-cf-catalog` in the repo checkout and `/app/data/geos-cf-catalog` inside containers) and Next.js. Open `/explore`, choose **Open verified scientific session**, select pollutant/scope/UTC/traversal and **Prepare scientific session**.
3. Play or Preview. Verify UTC/source/map agree. Pause/Resume, seek, reverse and select bands. Switch to Studio using the in-page link to retain the same plan and playback.
4. Studio: compare Scientific/context, reference mix, stem gain/mute/solo and volume. Download recipe JSON and inspect source identities/calibration/options.
5. For A/B or a native point, choose regions or use two map corners. After a data-selection change, prepare the new plan explicitly. Native bins use the actual sampled footprint.
6. Refresh catalog only after manually downloading/exporting additional data (`sync_verified_catalog` or the GitHub Actions workflow). Missing files or changed calibration must pause/report an error (or retryable 503/empty notice when unmounted), not substitute data.

Limits: 48 hourly slots, 8/16 bands per region and a 1.2M-element feature budget. Preparations are bounded to one per worker. Existing country/polygon masking stays in the original map workspace; the new band API accepts explicit rectangles. Session continuity is in memory across client navigation, not persisted across a full reload. Recipe JSON has no import/share persistence yet. No WAV/video export, new legacy Harmonic UI, spatial Native Spectral bank, wind inference or concentration interpolation is added. Subjective sound quality requires listening approval; headless checks validate engine behavior, not musical preference.
