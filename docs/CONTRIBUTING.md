# BREATHE – Contribution & Integration Guide

> **Target:** 6-Person Hackathon Team (24-Hour Velocity)  
> **Goal:** Rapid parallel progress without merge conflicts or regressions.

---

## 1. Branch Naming Conventions

All work must occur on dedicated, scoped topic branches branching from `main`.

| Prefix | Scope / Workstream | Example |
| :--- | :--- | :--- |
| `feat/` | New features or components | `feat/audio-waveform-selector` |
| `data/` | N01 Data ingestion & preprocessing | `data/nasa-gibs-aod-ingest` |
| `science/` | N02 Scientific validation & copy | `science/aod-vs-aqi-docs` |
| `audio/` | N03 Sonification algorithms & Web Audio | `audio/binaural-panning` |
| `ui/` | N05 Visual design & styling polish | `ui/atmospheric-halo-glow` |
| `fix/` | Bug fixes or interface adjustments | `fix/timeline-step-boundary` |
| `docs/` | Documentation & presentation | `docs/presentation-slides` |

---

## 2. Commit Message Convention

Follow standard Conventional Commits format:
```text
<type>(<scope>): <short description in imperative present tense>
```

**Allowed Types:**
- `feat`: A new feature for the user or engine.
- `fix`: A bug fix.
- `data`: NASA dataset updates or transformations.
- `audio`: Sound synthesis or mapping updates.
- `docs`: Documentation updates.
- `style`: Formatting, CSS, or visual tweaks.
- `refactor`: Code refactoring without behavioral changes.
- `test`: Adding or updating verification tests.

**Examples:**
```text
feat(audio): add exponential frequency glide between observations
data(n01): normalize MODIS AOD 550nm time series into JSON
fix(timeline): prevent out-of-bounds error on last observation
docs(science): clarify column AOD distinction from ground-level AQI
```

---

## 3. File Ownership Matrix

To minimize merge conflicts during rapid hackathon sprints, adhere to strict file ownership:

| Directory / File | Primary Owner | Secondary / Reviewer |
| :--- | :--- | :--- |
| `src/data/` | **N01 – Data Engineering** | N02 |
| `src/services/dataService.ts` | **N01 – Data Engineering** | N04 |
| `src/types/observation.ts`, `src/types/dataset.ts` | **N02 – Scientific Research** | N01, N04 |
| `src/types/audio.ts` | **N03 – Sonification** | N04 |
| `src/services/sonificationService.ts` | **N03 – Sonification** | N04 |
| `src/hooks/useSonification.ts` | **N03 – Sonification** | N04 |
| `src/components/audio/` | **N03 & N04** | N05 |
| `src/components/visualization/` | **N04 – Frontend** | N05 |
| `src/app/` | **N04 – Frontend** | N05 |
| `src/components/science/` | **N02 & N05** | N04 |
| `public/` | **N05 – UI/UX & Storytelling** | N04 |
| `docs/TEAM_TASKS.md`, `README.md` | **N06 – Integration & QA** | All |

*Rule:* If you must modify a file owned by another workstream, coordinate with the owner in chat first!

---

## 4. Pull Request & Integration Workflow

1. **Pull Latest Main:** Before opening a PR, ensure your branch is up-to-date:
   ```bash
   git fetch origin
   git merge origin/main
   ```
2. **Static Check:** Verify locally before requesting review:
   ```bash
   npm run typecheck
   npm run lint
   ```
3. **PR Description:** Include:
   - Workstream ID (e.g. `[N01]`)
   - Summary of changes
   - Manual testing steps executed
   - Confirmation that no secrets or mock data were misrepresented as verified NASA data.
4. **Approval Gate:** Every PR requires at least 1 review approval (preferably N06 or the file owner).
