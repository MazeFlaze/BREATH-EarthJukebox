# BREATHE – Earth Information Jukebox

> **Hear what the atmosphere is telling us.**  
> Built for the **NASA Space Apps Challenge 2026** – *The Earth Information Jukebox*  
> An interactive Earth science sonification experience translating atmospheric observations into dynamic sound.

---

## 1. Project Introduction & Problem Statement

Atmospheric data is inherently high-dimensional, temporal, and continuous. Traditional scientific dashboards rely almost entirely on 2D visual maps and charts, which can obscure subtle temporal gradients, rate-of-change events, and atmospheric optical density shifts.

Human auditory perception possesses remarkable temporal sensitivity and pattern recognition capabilities. **BREATHE** harnesses these perceptual strengths by coupling NASA Earth observations with dynamic, data-driven audio sonification via the browser's native **Web Audio API**. By hearing atmospheric optical depth, greenhouse gas concentrations, and climate shifts, users gain an intuitive, immersive understanding of how our planet's atmosphere breathes over time.

---

## 2. Concept & Main Features

- 🛰️ **NASA Earth Observation Exploration:** Browse high-resolution atmospheric layers derived from NASA Earth Information Center, MODIS, and VIIRS datasets.
- ⏱️ **Interactive Temporal Timeline:** Scrub across observation timestamps with synchronized visual, telemetry, and acoustic updates.
- 🎵 **Data-Driven Dynamic Sonification:** Listen to atmospheric measurements mapped to musical pitch, harmonic overtones, and timbral density in real time.
- 📈 **Synchronized Time-Series Telemetry:** Track values alongside an interactive Recharts area chart with active observation cursor highlighting.
- 🔬 **Scientific Context & Integrity:** Clear educational breakdowns of atmospheric metrics, emphasizing why Aerosol Optical Depth (AOD) is fundamentally distinct from Air Quality Index (AQI).
- 🏷️ **Traceable NASA Provenance:** Strict provenance metadata detailing mission satellites, instruments, and processing levels.

---

## 3. Technology Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router, React 18, TypeScript)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) (Custom deep-space atmospheric theme)
- **Audio Engine:** Browser native [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) (Oscillator, Gain, and Harmonic synthesis)
- **Data Visualization:** [Recharts](https://recharts.org/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Data Exchange:** Strongly typed JSON & CSV (no backend required for initial MVP)

---

## 4. Architecture Overview

```text
BREATHE/
├── public/                     # Static imagery, icons, and audio assets
├── docs/                       # Architectural & team contracts
│   ├── PROJECT_OVERVIEW.md     # Mission concept & user journey
│   ├── ARCHITECTURE.md         # Component boundaries & data flow
│   ├── DATA_CONTRACT.md        # Observation & Dataset schema
│   ├── SONIFICATION_CONTRACT.md# Audio mapping & lifecycle specs
│   ├── CONTRIBUTING.md         # Git workflow & file ownership
│   └── TEAM_TASKS.md           # 24-hour actionable team roadmap
├── src/
│   ├── app/                    # Next.js App Router (layout, page, styles)
│   ├── components/             # Reusable modular UI components
│   │   ├── layout/             # Header and Footer
│   │   ├── visualization/      # EarthVisualization, Timeline, DataChart
│   │   ├── audio/              # AudioPlayer, SoundControls
│   │   └── science/            # ScienceExplanation
│   ├── hooks/                  # useSonification React hook
│   ├── services/               # dataService and sonificationService
│   ├── types/                  # observation, dataset, audio interfaces
│   ├── data/                   # observations.json (Mock & Ingested data)
│   └── lib/                    # Shared utilities (formatters, interpolators)
```

---

## 5. Team Workstreams (6-Person Hackathon Team)

To avoid merge conflicts and maximize velocity during the 24-hour sprint, work is distributed across six specialized workstreams:

- **N01 – Data Engineering:** NASA data retrieval, preprocessing, CSV/JSON normalization (`src/data/`, `src/services/dataService.ts`).
- **N02 – Scientific Research:** Variable definition, validation, sonification transfer curve justification (`docs/DATA_CONTRACT.md`, `src/types/`).
- **N03 – Sonification:** Web Audio API synthesis, data-to-sound mapping, audio lifecycle (`src/services/sonificationService.ts`, `src/hooks/useSonification.ts`).
- **N04 – Frontend Development:** Application layout, visualization integration, responsive UI (`src/app/`, `src/components/`).
- **N05 – UI/UX & Storytelling:** Visual identity, narrative copy, design assets (`public/`, `src/app/globals.css`).
- **N06 – Integration, QA & Submission:** Cross-module testing, code review, submission packaging (`docs/TEAM_TASKS.md`, `README.md`).

For detailed task assignments and acceptance criteria, see [docs/TEAM_TASKS.md](file:///d:/explode/BREATHE-EarthJukebox/docs/TEAM_TASKS.md).

---

## 6. Installation & Development Commands

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.17.0+ or v20+ recommended)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd BREATHE-EarthJukebox
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or
   pnpm install
   ```

3. **Configure Environment:**
   ```bash
   cp .env.example .env.local
   ```

4. **Start the local development server:**
   ```bash
   npm run dev
   # or
   pnpm dev
   ```

5. **Open the application:**
   Navigate to [http://localhost:3000](http://localhost:3000) in your web browser.

### Quality Verification Commands

Run these commands to verify code quality and build integrity:

```bash
# Typecheck TypeScript files
npm run typecheck

# Lint source files with Next.js ESLint configuration
npm run lint

# Format code with Prettier
npm run format

# Production build
npm run build
```

---

## 7. Scientific Integrity & Data Attribution Policy

1. **Aerosol Optical Depth (AOD) ≠ Air Quality Index (AQI):**
   AOD is a dimensionless property measuring total light extinction through the vertical column of atmosphere. Under no circumstances should AOD values be displayed as AQI, which is a ground-level public health index.
2. **Mock vs. Verified NASA Data:**
   The repository includes development mock data in `src/data/observations.json` marked with `isMock: true`. The UI explicitly displays an amber warning badge when mock data is active. Mock values must never be cited or represented as real NASA observations.
3. **NASA Data Sources:**
   Verified data ingested by Workstream N01 links directly to NASA Earth Information Center, NASA Earthdata, and GIBS WMTS endpoints.

---

## 8. License

Distributed under the MIT License. See `LICENSE` for more information. Built for the NASA Space Apps Challenge 2026.
