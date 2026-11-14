---
name: nasa-earthdata-retrieval
description: Retrieve, preprocess, and normalize NASA Earth Observation datasets (SVS, GEOS-CF, GIBS, Earthdata CMR) into structured time-series observations for sonification and visualization.
---

# NASA Earthdata & SVS Retrieval Skill

This skill provides verified procedures, API endpoints, and executable scripts to discover, retrieve, and normalize NASA Earth science datasets—specifically tailored for **The Earth Information Jukebox** (NASA Space Apps Challenge) and atmospheric composition visualizations like **NASA SVS #5533 (GEOS-CF Air Quality Model Runs)**.

---

## 1. Core Data Sources & Protocols

### A. NASA Scientific Visualization Studio (SVS)
- **Base Web Entry:** `https://svs.gsfc.nasa.gov/<id>` (e.g. SVS 5533: `https://svs.gsfc.nasa.gov/5533`)
- **Direct JSON Metadata API:** `https://svs.gsfc.nasa.gov/api/<id>`
  - Returns complete metadata: title, description, time range, contributing missions, instruments, scientific paper citations, and media groups.
- **Media Assets Base URL:** `https://svs.gsfc.nasa.gov/vis/a000000/a005500/a00<id>/<filename>`
  - Provides full-resolution MP4 (e.g. 5.7K, 4K, 1080p) and keyframe PNG files with and without scientific labels.

### B. NASA Global Modeling and Assimilation Office (GMAO) GEOS-CF
- **Model Overview:** Goddard Earth Observing System Composition Forecasting (c24 resolution, ~25 km horizontal grid, 72 vertical layers, hourly cadence).
- **NCCS DataShare Portal:** `https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/`
  - Historical Assimilation directory: `.../geos-cf/v1/ana/Y<YYYY>/M<MM>/`
  - NetCDF4 files contain surface concentrations:
    - `PM25_RH35_GCC`: Surface Particulate Matter $\le 2.5\,\mu\text{m}$ ($\mu\text{g}/\text{m}^3$)
    - `CO`: Carbon Monoxide (mol/mol or ppbv)
    - `O3`: Tropospheric Ozone (ppbv)
    - `NO2` / `NOX`: Reactive nitrogen oxides (ppbv)
- **OPeNDAP Subsetting (No Large Downloads Needed):**
  - Endpoint: `https://opendap.nccs.nasa.gov/dods/gmao/geos-cf/`
  - Allows querying specific lat/lon points, bounding boxes, and time slices via Python `xarray` or `pydap`.

### C. NASA GIBS (Global Imagery Browse Services) Snapshot API
- **Direct REST Tile / Snapshot API (No API Key Required):**
  - Endpoint: `https://wvs.earthdata.nasa.gov/api/v1/snapshot`
  - Parameters:
    - `REQUEST=GetSnapshot`
    - `TIME=YYYY-MM-DDTHH:mm:ssZ`
    - `BBOX=min_lat,min_lon,max_lat,max_lon` (EPSG:4326)
    - `CRS=EPSG:4326`
    - `LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor` (or `VIIRS_SNPP_CorrectedReflectance_TrueColor`, `MODIS_Terra_AOD_Deep_Blue_Combined`)
    - `FORMAT=image/jpeg`
    - `WIDTH=1200&HEIGHT=675`
  - Provides instant, high-definition satellite imagery verifying wildfire smoke plumes, haze, and atmospheric optical depth.

---

## 2. Ingestion Workflow & Shared Data Contract

Any ingested dataset for the BREATHE Earth Jukebox must strictly conform to `docs/DATA_CONTRACT.md`:

```typescript
export interface Observation {
  id: string;
  timestamp: string;       // ISO 8601 UTC
  imageUrl: string;        // NASA GIBS or SVS Keyframe
  value: number;           // Scientific measurement
  unit: string;            // e.g. "µg/m³", "ppbv", "dimensionless"
  variable: string;        // e.g. "Particulate Matter (PM2.5)"
  description: string;     // Scientific narrative & atmospheric context
  isMock: boolean;         // Must be FALSE for verified NASA data
  coordinates?: {
    lat: number;
    lon: number;
    regionName?: string;
  };
  provenance?: {
    satellite?: string;
    instrument?: string;
    processingLevel?: string;
    citationUrl?: string;
  };
}
```

> [!IMPORTANT]
> **Scientific Integrity Rule:** Aerosol Optical Depth (AOD) is dimensionless (column extinction) and must NEVER be conflated with surface Air Quality Index (AQI) or Particulate Matter ($PM_{2.5}$). Clearly label the variable and its measurement unit.

---

## 3. Bundled Ingestion Script

To refresh or regenerate observations from NASA SVS 5533 and GEOS-CF:

```bash
python3 .agents/skills/nasa-earthdata-retrieval/scripts/fetch_svs_geos_dataset.py [optional_output_path]
```

Default output path: `src/data/observations.json`.

---

## 4. Sonification Mapping Reference for SVS 5533

When mapping GEOS-CF air quality measurements to sound in the Web Audio API or Tone.js:

1. **Particulate Matter ($PM_{2.5}$):**
   - Natural Range: $0 - 250+\,\mu\text{g}/\text{m}^3$ (Clean: $<12$, Moderate: $12-35$, Unhealthy: $55-150$, Hazardous: $>250$).
   - Sound Mapping: Sawtooth / Triangle wave with low-pass filter cutoff frequency proportional to $PM_{2.5}$ (lower cutoff = muddier/denser smoke sound).
2. **Carbon Monoxide ($CO$):**
   - Sound Mapping: Low drone frequency ($55 - 110\,\text{Hz}$, A1-A2), volume scaled to plume density.
3. **Photochemical Ozone ($O_3$):**
   - Sound Mapping: Arpeggiated sine synth with pitch tracking solar daylight cycle (peaks at mid-afternoon).
4. **Transport Velocity / Winds:**
   - Sound Mapping: Stereo pan ($L \leftrightarrow R$) mapping zonal winds ($U$) moving plumes eastward across North America.
