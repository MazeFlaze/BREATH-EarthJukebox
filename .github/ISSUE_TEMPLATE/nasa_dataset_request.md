---
name: NASA Dataset Request
about: Request ingestion of a new NASA Earth Observation dataset or SVS visualization
title: "[DATA] Ingest NASA Dataset: <Mission / Sensor / Variable>"
labels: ["data-engineering", "nasa-science"]
assignees: []
---

### Dataset Overview
- **NASA Source / Catalog ID:** (e.g. SVS 5533, MOD04_L2, TEMPO_NO2)
- **Primary Atmospheric Variable:** (e.g. Surface PM2.5, Column AOD, Tropospheric O3, Methane CH4)
- **Measurement Unit:** (e.g. µg/m³, ppbv, dimensionless)
- **Time Range:** (e.g. 2024-07-01 to 2024-08-31)
- **Source URL:** (e.g. https://svs.gsfc.nasa.gov/5533 or https://search.earthdata.nasa.gov)

### Scientific Context & Provenance
- Satellites / Instruments: (e.g. Terra/Aqua MODIS, Sentinel-5P TROPOMI)
- Processing Level: (e.g. Level 3 Daily Global, Level 4 Assimilation)

### Data Contract Compliance
- [ ] Confirmed variable and unit do NOT conflate column AOD with surface AQI or PM2.5.
- [ ] Timestamps are formatted as ISO 8601 UTC.
- [ ] Coordinates (lat, lon, regionName) are identified.
