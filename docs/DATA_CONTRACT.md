# BREATHE – Shared Data Contract

> **Primary Owners:** N01 (Data Engineering) & N02 (Scientific Research)  
> **Status:** Stable Interface Baseline (v1.0.0)

---

## 1. Overview & Core Contract Principles

This specification defines the schema for atmospheric observation datasets consumed by the **BREATHE** application. Any ingestion pipeline, Python preprocessor, or API adapter built by Workstream N01 must produce data that strictly conforms to these interfaces.

### Core Scientific Rules
1. **AOD is NOT AQI:** Aerosol Optical Depth (AOD) must never be labeled as Air Quality Index (AQI). AOD is dimensionless and represents total atmospheric column extinction.
2. **Explicit Mock Tagging:** Every synthetic observation or dataset created during development must carry `isMock: true`.
3. **UTC Timestamps:** All timestamps must conform to ISO 8601 UTC formatting (`YYYY-MM-DDTHH:mm:ssZ`).

---

## 2. Shared TypeScript Interfaces

### Observation

Defined in [src/types/observation.ts](file:///d:/explode/BREATHE-EarthJukebox/src/types/observation.ts):

```typescript
export interface Observation {
  /** Unique observation identifier (e.g., 'obs-aod-2026-08-01-001') */
  id: string;

  /** ISO 8601 formatted UTC timestamp */
  timestamp: string;

  /** Visual representation URL (satellite composite, heat map layer, or placeholder) */
  imageUrl: string;

  /** Numeric measurement value */
  value: number;

  /** Scientific unit of measurement */
  unit: string;

  /** Atmospheric variable name */
  variable: string;

  /** Scientific description and context for this observation */
  description: string;

  /** Explicit flag indicating whether this is development mock data (Default: false) */
  isMock?: boolean;

  /** Optional geographic bounding or center point */
  coordinates?: {
    lat: number;
    lon: number;
    regionName?: string;
  };

  /** Provenance metadata when verified NASA data is used */
  provenance?: {
    satellite?: string;     // e.g. "Terra / Aqua", "Sentinel-5P", "Suomi NPP"
    instrument?: string;    // e.g. "MODIS", "VIIRS", "TROPOMI"
    processingLevel?: string; // e.g. "Level 3 Daily Global"
    citationUrl?: string;   // Traceable URL to NASA Earthdata catalog entry
  };
}
```

### Dataset

Defined in [src/types/dataset.ts](file:///d:/explode/BREATHE-EarthJukebox/src/types/dataset.ts):

```typescript
export interface Dataset {
  /** Unique dataset identifier */
  id: string;

  /** Human-readable dataset title */
  title: string;

  /** Data provider / mission / instrument source attribution */
  source: string;

  /** Traceable URL to source dataset or NASA Earthdata catalog */
  sourceUrl: string;

  /** Scientific variable name */
  variable: string;

  /** Measurement unit across all observations */
  unit: string;

  /** Scientific explanation and mission context */
  description: string;

  /** Chronological series of atmospheric observations */
  observations: Observation[];

  /** Flag to indicate if entire dataset contains synthetic/mock observations */
  isMock?: boolean;

  /** Observed min/max values across the dataset */
  range?: {
    min: number;
    max: number;
  };
}
```

---

## 3. Atmospheric Variables & Unit Standards

| Variable Name | Unit String | Expected Range | Instrument / Mission | Scientific Meaning |
| :--- | :--- | :--- | :--- | :--- |
| **Aerosol Optical Depth (AOD at 550nm)** | `dimensionless` | `0.00 – 3.00+` | MODIS (Terra/Aqua), VIIRS (Suomi NPP) | Total column light attenuation by suspended particles. |
| **Carbon Dioxide (CO2)** | `ppm` | `380 – 430` | OCO-2, OCO-3 | Column-averaged dry-air mole fraction of atmospheric CO2 ($X_{CO2}$). |
| **Methane (CH4)** | `ppb` | `1800 – 2100` | TROPOMI, EMIT | Atmospheric methane column concentration. |
| **Surface Temperature Anomaly** | `K` or `°C` | `-5.0 – +5.0` | AIRS, MODIS L3 | Difference from 30-year climatological baseline. |

---

## 4. Ingestion Guidelines for Workstream N01 (Data Engineering)

1. **Python Preprocessing:** Data scripts in `scripts/` or local notebooks should output clean JSON matching `src/data/observations.json` schema.
2. **Missing Values:** Replace fill values (`-9999`, `NaN`, `null`) before writing to JSON. Drop uncalibrated observations or interpolate with flag.
3. **Chronological Sorting:** Observations must be sorted in ascending chronological order (`observations[0]` = earliest timestamp).
4. **Imagery Resolution:** Satellite images linked in `imageUrl` should have minimum dimensions of $1200 \times 675$ (16:9 ratio) for optimal rendering.
