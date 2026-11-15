# BREATHE frontend

Next.js App Router frontend for the NASA Space Apps 2026 BREATHE prototype.

## Run

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Use `npm run typecheck` and `npm run build` to verify changes.

## Screens

| Route | Purpose |
| --- | --- |
| `/` | Overview and entry points |
| `/explore` | Globe, atmospheric layers, timeline, and sound preview |
| `/explore/region` | Editable polygon, rectangle, and freehand selection |
| `/studio` | Map, sound visualizations, and mapping controls |
| `/learn` | Lessons, concepts, and experiments |
| `/gallery` | Curated concept works |

## Data and media

- `src/data/observations.json` supplies the existing NASA GEOS-CF v2 point observations and global layer rasters. The UI displays point values only when the place and time match a record.
- Region averages are sampled from the bundled GEOS-CF raster when no backend region query is available. AOD remains unavailable until its own source is connected; gallery works and learning comparisons are illustrative.
- Explore and Studio use OpenFreeMap vector tiles (OpenStreetMap/OpenMapTiles) for coastlines, administrative boundaries, waterways, roads, landcover and place labels. MapLibre presents the same source as a globe or a flat Mercator map. Vector tiles and font glyphs require network access; Natural Earth boundaries remain available for territory selection.
- NASA GEOS-CF imagery is a separate atmospheric overlay with an opacity control. Low display intensities are transparent so the basemap remains legible; polygon statistics still use the full raster. The optional Satellite basemap uses bundled NASA SVS and GIBS imagery.
- MapLibre v6 needs a separately served module worker on Next.js 14. `postinstall`, `predev` and `prebuild` copy the installed worker to `public/maplibre-gl-worker.mjs`.
- No audio file is bundled. By default, the player creates a brief browser synthesized tone and labels sound visualizations as illustrative. Set `NEXT_PUBLIC_BREATHE_AUDIO_URL` and optionally `NEXT_PUBLIC_BREATHE_SPECTROGRAM_URL` in `.env.local` to use backend rendered media. Both accept a public path or absolute URL.

Studio projects can be downloaded as JSON, reopened, or shared as a URL. Region selection is kept in browser session storage when sent to Studio.
