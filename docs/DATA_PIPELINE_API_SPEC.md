# BREATHE – Data Pipeline & Jukebox API Specification

> **Workstream:** N01 (Data Engineering) & N02 (Scientific Research)  
> **Target Audience:** N03 (Sonification Lead), N04 (Frontend Lead), Judges & Developers  
> **Status:** Production-Ready MVP Baseline (v3.0.0)

---

## 1. Overview & Architectural Role

The **BREATHE Data Engineering subsystem** is responsible for retrieving, processing, normalizing, storing, and serving authentic NASA Earth Observation data for acoustic sonification.

The system supports two core interactive sonification experiences:
1. **Spatial Jukebox Mode**: Sonifies atmospheric conditions across an ordered sequence of geographic locations at a single selected timestamp.
2. **Temporal Jukebox Mode**: Sonifies the time-series evolution of an atmospheric variable at a single geographic location over an ordered chronological sequence.

Both modes share the unified observation model:
$$\text{Observation} = f(\text{latitude}, \text{longitude}, \text{time}, \text{variable}, \text{dataset})$$

---

## 2. Atmospheric Products & Physical Units

| Variable Code | Full Name | Source Instrument / Model | Physical Source Unit | Display Unit | Variable Type | Audio Normalization Scale ($[0.0, 1.0]$) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`PM25_RH35`** | Fine Particulate Matter ($\le 2.5\,\mu\text{m}$) | NASA GMAO GEOS-CF v2 Analysis | $\text{ug m}^{-3}$ | $\mu\text{g}/\text{m}^3$ | Mass Concentration | $[0.0, 250.0]\,\mu\text{g}/\text{m}^3$ (WHO/EPA AQI) |
| **`PM10_RH35`** | Coarse Particulate Matter ($\le 10\,\mu\text{m}$) | NASA GMAO GEOS-CF v2 Analysis | $\text{ug m}^{-3}$ | $\mu\text{g}/\text{m}^3$ | Mass Concentration | $[0.0, 500.0]\,\mu\text{g}/\text{m}^3$ |
| **`CO`** | Carbon Monoxide | NASA GMAO GEOS-CF v2 Analysis | $\text{mol mol}^{-1}$ | $\text{mol}/\text{mol}$ | Gas Mole Fraction | $[0.0, 1.0\times 10^{-6}]\,\text{mol}/\text{mol}$ ($\approx 0 - 1000\,\text{ppb}$) |
| **`NO2`** | Nitrogen Dioxide | NASA GMAO GEOS-CF v2 Analysis | $\text{mol mol}^{-1}$ | $\text{mol}/\text{mol}$ | Gas Mole Fraction | $[0.0, 1.0\times 10^{-7}]\,\text{mol}/\text{mol}$ ($\approx 0 - 100\,\text{ppb}$) |
| **`O3`** | Tropospheric Ozone | NASA GMAO GEOS-CF v2 Analysis | $\text{mol mol}^{-1}$ | $\text{mol}/\text{mol}$ | Gas Mole Fraction | $[0.0, 1.0\times 10^{-7}]\,\text{mol}/\text{mol}$ ($\approx 0 - 100\,\text{ppb}$) |
| **`SO2`** | Sulfur Dioxide | NASA GMAO GEOS-CF v2 Analysis | $\text{mol mol}^{-1}$ | $\text{mol}/\text{mol}$ | Gas Mole Fraction | $[0.0, 5.0\times 10^{-8}]\,\text{mol}/\text{mol}$ ($\approx 0 - 50\,\text{ppb}$) |

### Critical Scientific Rigor Rules:
1. **$PM_{2.5}$ Mass Concentration $\neq$ Column Optical Depth (AOD)**:
   - Particulate Matter ($PM_{2.5}$) is a mass concentration at surface level ($\mu\text{g}/\text{m}^3$).
   - Aerosol Optical Depth (AOD) is a vertical column integral of solar light attenuation (dimensionless).
   - They must never be conflated, combined without physical hygroscopic growth models, or mislabeled.
2. **Gas Mole Fractions**:
   - Trace gases are provided in $\text{mol}/\text{mol}$ in GEOS-CF.
   - Conversion: $1\,\text{mol}/\text{mol} = 10^9\,\text{ppbv} = 10^6\,\text{ppmv}$.
   - The API reports the exact source unit (`mol mol-1`) and provides calibrated normalization metadata for audio synthesis.
3. **Hourly Time-Averaged Fields**:
   - GEOS-CF product `aqc_tavg_1hr_glo_L1440x721_slv` is a **1-hour time-averaged assimilation**, centered at minute 30 of the hour (`HH:30:00Z`). It represents continuous hourly atmospheric assimilation, not an instantaneous snapshot.

---

## 3. Spatial Jukebox API (`POST /api/v1/jukebox/spatial`)

### Request
- **Method**: `POST`
- **Path**: `/api/v1/jukebox/spatial`
- **Content-Type**: `application/json`

```json
{
  "datasetId": "geos-cf-v2-aqc",
  "timestamp": "2026-11-13T01:30:00Z",
  "variable": "PM25_RH35",
  "locations": [
    {"id": "hanoi", "lat": 21.03, "lon": 105.85},
    {"id": "bangkok", "lat": 13.75, "lon": 100.50},
    {"id": "singapore", "lat": 1.35, "lon": 103.82},
    {"id": "tokyo", "lat": 35.68, "lon": 139.69}
  ]
}
```

### Response (`200 OK`)
```json
{
  "mode": "spatial",
  "datasetId": "geos-cf-v2-aqc",
  "variable": "PM25_RH35",
  "unit": "ug m-3",
  "dataType": "model_analysis",
  "isMock": false,
  "normalization": {
    "method": "fixed_reference_range",
    "min": 0.0,
    "max": 250.0,
    "configVersion": "1.0.0-who-air-quality"
  },
  "points": [
    {
      "order": 0,
      "locationId": "hanoi",
      "timestamp": "2026-11-13T01:30:00Z",
      "requestedCoordinates": { "lat": 21.03, "lon": 105.85 },
      "gridCoordinates": { "lat": 21.0, "lon": 105.75 },
      "value": 104.0,
      "normalizedValue": 0.416,
      "quality": "valid"
    },
    {
      "order": 1,
      "locationId": "bangkok",
      "timestamp": "2026-11-13T01:30:00Z",
      "requestedCoordinates": { "lat": 13.75, "lon": 100.5 },
      "gridCoordinates": { "lat": 13.75, "lon": 100.5 },
      "value": 69.5,
      "normalizedValue": 0.278,
      "quality": "valid"
    },
    {
      "order": 2,
      "locationId": "singapore",
      "timestamp": "2026-11-13T01:30:00Z",
      "requestedCoordinates": { "lat": 1.35, "lon": 103.82 },
      "gridCoordinates": { "lat": 1.25, "lon": 103.75 },
      "value": 34.25,
      "normalizedValue": 0.137,
      "quality": "valid"
    },
    {
      "order": 3,
      "locationId": "tokyo",
      "timestamp": "2026-11-13T01:30:00Z",
      "requestedCoordinates": { "lat": 35.68, "lon": 139.69 },
      "gridCoordinates": { "lat": 35.75, "lon": 139.75 },
      "value": 38.0625,
      "normalizedValue": 0.1523,
      "quality": "valid"
    }
  ],
  "provenance": {
    "provider": "NASA GMAO",
    "sourceUrl": "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana",
    "productVersion": "v2",
    "spatialResolution": "0.25x0.25 (L1440x721)",
    "temporalResolution": "1hr (hourly time-averaged)"
  }
}
```

---

## 4. Temporal Jukebox API (`GET /api/v1/jukebox/temporal`)

### Request
- **Method**: `GET`
- **Path**: `/api/v1/jukebox/temporal`
- **Query Parameters**:
  - `dataset_id`: `geos-cf-v2-aqc`
  - `lat`: `21.03`
  - `lon`: `105.85`
  - `variable`: `PM25_RH35`
  - `start`: `2026-11-13T00:30:00Z`
  - `end`: `2026-11-13T02:30:00Z`
  - `interval`: `1h`

### Response (`200 OK`)
```json
{
  "mode": "temporal",
  "datasetId": "geos-cf-v2-aqc",
  "variable": "PM25_RH35",
  "unit": "ug m-3",
  "dataType": "model_analysis",
  "isMock": false,
  "normalization": {
    "method": "fixed_reference_range",
    "min": 0.0,
    "max": 250.0,
    "configVersion": "1.0.0-who-air-quality"
  },
  "points": [
    {
      "order": 0,
      "locationId": null,
      "timestamp": "2026-11-13T00:30:00Z",
      "requestedCoordinates": { "lat": 21.03, "lon": 105.85 },
      "gridCoordinates": { "lat": 21.0, "lon": 105.75 },
      "value": null,
      "normalizedValue": null,
      "quality": "missing"
    },
    {
      "order": 1,
      "locationId": null,
      "timestamp": "2026-11-13T01:30:00Z",
      "requestedCoordinates": { "lat": 21.03, "lon": 105.85 },
      "gridCoordinates": { "lat": 21.0, "lon": 105.75 },
      "value": 104.0,
      "normalizedValue": 0.416,
      "quality": "valid"
    },
    {
      "order": 2,
      "locationId": null,
      "timestamp": "2026-11-13T02:30:00Z",
      "requestedCoordinates": { "lat": 21.03, "lon": 105.85 },
      "gridCoordinates": { "lat": 21.0, "lon": 105.75 },
      "value": null,
      "normalizedValue": null,
      "quality": "missing"
    }
  ],
  "provenance": {
    "provider": "NASA GMAO",
    "sourceUrl": "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana",
    "productVersion": "v2",
    "spatialResolution": "0.25x0.25 (L1440x721)",
    "temporalResolution": "1hr (hourly time-averaged)"
  }
}
```

---

## 5. Metadata Endpoints

### A. List Datasets (`GET /api/v1/datasets`)
Returns all active datasets with explicit `isMock` tags:
- `geos-cf-v2-aqc`: `isMock: false` (Verified NASA GMAO GEOS-CF v2 analysis)
- `nasa-svs5533-geos-cf-2024`: `isMock: true` (Prototype wildfire demonstration)
- `mock-nasa-aod-series-2026`: `isMock: true` (Prototype AOD development series)

### B. List Dataset Variables (`GET /api/v1/datasets/{dataset_id}/variables`)
Returns variable schema, source physical unit, and display representation.

### C. Check Availability (`GET /api/v1/datasets/{dataset_id}/availability`)
Returns list of available timestamps and total available granules.

### D. List Presets (`GET /api/v1/locations`)
Returns the 10 preset world locations (Hanoi, Bangkok, Singapore, Tokyo, New York, London, Paris, Sydney, Cairo, São Paulo).

---

## 6. Integration Contract for Frontend (N04) & Sonification (N03)

### How Sonification (N03) Consumes the Data:
1. Call `POST /api/v1/jukebox/spatial` or `GET /api/v1/jukebox/temporal`.
2. Inspect `points`:
   - If `point.quality === "valid"`, use `point.normalizedValue` directly as the normalized parameter $N \in [0.0, 1.0]$.
   - Compute fundamental frequency:
     $$f_0 = f_{\min} + N \cdot (f_{\max} - f_{\min})$$
   - If `point.quality === "missing"` or `point.value === null`, the synthesizer schedules a rest or subtle missing-data acoustic cue (e.g. muted filtered noise or silent pause).
3. The raw physical value (`point.value`) and scientific unit (`response.unit`) are displayed in the HUD or tooltip without modification.

### Backward Compatibility Guarantees:
- Legacy `/api/v1/observations/aod` and `/range` remain fully intact.
- Legacy `/api/v1/observations/air-quality` remains intact with corrected `isMock: true` prototype labeling.
- New Jukebox endpoints live under `/api/v1/jukebox/*`.
