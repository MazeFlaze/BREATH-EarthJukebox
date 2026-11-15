# Scientific sessions: backend planning and browser rendering

Status: additive v1 integration, synchronized with main `36b19c5`. Existing region/spatial/temporal APIs, map editor and gallery project format are unchanged. The local `/demo` remains ignored and is an R&D reference, not a dependency of the integrated frontend.

## Ownership

The backend reads verified native artifacts produced by the existing **manual** NASA download/catalog exporter. It prepares grid/band features, canonical spatial/temporal order, gaps, derivatives and arrangement windows. The browser decodes these arrays, renders the map, applies user mixer controls and synthesizes audio through the existing AudioWorklet renderer. The worklet consumes the server's arrangement; it does not regenerate it. The existing main sonification service lends its AudioContext to the renderer and stops the other scheduler before playback.

Explore owns data selection, geometry, UTC range and traversal. Studio receives the same in-memory scientific session and exposes the shared mixer and explanation. Both routes have an explicit entry into verified scientific playback and a return to the existing map workspace. Route navigation between Explore and Studio retains plan, controls and playback; a full browser reload requires preparation again. No publishing, upload, new account flow, or background NASA download is introduced.

## HTTP API

Base: `/api/v1/scientific`. Responses are `Cache-Control: no-store`.

| Method/path | Request | Result |
|---|---|---|
| GET `/catalog` | none | Existing validated `geos-cf-local-catalog-v1` catalog, including unavailable entries and gaps |
| POST `/sessions` | `breathe-session-request-v1` | Immutable `breathe-session-plan-v1`, feature arrays, arrangement windows and source identities |
| POST `/frames` | Selection, timestamp, nullable source SHA, calibration version, unit, audio_max from prepared plan | `breathe-frame-view-v1`, native/coarse raster and geometry for each region |
| GET `/sessions/{id}/views/{slot}` | Transient cached plan reference | Convenience view endpoint; 410 after expiry/eviction. The frontend uses stateless POST `/frames` instead. |

Example selection:

```json
{
  "schema_version": "breathe-session-request-v1",
  "pollutant": "pm25_rh35",
  "scope": "global",
  "traversal": "time",
  "start": "2026-11-12T00:30:00Z",
  "end": "2026-11-12T23:30:00Z",
  "resolution": "native",
  "axis": "horizontal",
  "bands": 8,
  "duration": 300,
  "regions": []
}
```

- Pollutants: `pm25_rh35`, `pm10_rh35`, `co`, `no2`, `o3`, `so2`. Existing API uppercase names are not silently substituted into this contract.
- Scope `global`, `region`, `compare` requires 0, 1, 2 rectangles respectively. Bounds use `{south,north,west,east}` in EPSG:4326 with finite ordered coordinates. Antimeridian crossing must be explicitly split; a reversed rectangle is rejected.
- Traversal `time` summarizes all native samples per band at each UTC; `space` scans one timestamp and requires start=end; `series` scans each timestamp in chronological order.
- Resolution: 45, 22.5, 11.25, 5, 1 degrees or `native` (0.25°). Bands: 8 or 16 per region, limited by available rows/columns. Horizontal scans whole columns west→east; vertical scans whole rows north→south.
- Range: at most 48 hourly :30 UTC slots. Duration: 180, 300, 420 seconds for the entire session, excluding buffering. The request must contain at least one verified snapshot. Leading/interior/trailing missing hours in the requested range remain explicit slots.
- At most 1,200,000 feature elements per array. Exceeding this returns 413; select fewer hours/bands or a coarser spatial sweep. One concurrent preparation per worker; excess requests return 429 with Retry-After. The browser shows an indeterminate real preparation state, not fabricated percentage progress.

## Plan response

`id` is content-addressed from selection, source records, feature arrays and calibration. `slots` are canonical ascending UTC records `{timestamp,source_sha256,first,end,missing}` with half-open step indices. Reverse never changes source identity or recomputes chronological derivatives. `lane_counts` partitions A/B voices, panned left/right for recognition.

`arrays` values have `{dtype,length,data}`. `data` is base64 of contiguous little-endian bytes. Supported dtypes: `float32-le`, `float64-le`, `uint32-le`, `int32-le`. Dimensions come from `steps` and `lanes`; feature arrays are step-major, length `steps*lanes`. IEEE NaN preserves missing Mean/P90 without emitting invalid JSON numbers. Zero remains valid. No native million-cell field is serialized as a million JSON numbers.

Feature keys: `mean`, `p90`, `spread`, `coverage`, `contrast`; voice coordinates `positions`, `lanePanPositions`; step coordinates `stepPositions`, and UTC-hour `coordinates` for temporal data. Spatial derivative arrays and `segmentStarts` semantics are fixed during canonical preparation. Arrangement delivery includes `contextGradient`, `contextCurvature`, `stepWindows` and `{version,windowSteps,windows}`. Each window has `{startStep,endStep,voices}`; voices carry Mean, P90, excess, spread, edge and MIDI note. No window crosses a spatial timestamp boundary.

The browser filters highlights/edges by selected bands using the existing deterministic selector, caps highlights at three and edges at two, and applies gain/mute/solo independently. This is renderer control, not a rewrite of source features. Scientific mode uses the continuous log99 reference; it is not notebook pulse baseline A. Legacy Harmonic is not shown in the integrated scientific workflow.

## Scientific invariants

- Use existing exported display-unit values: PM2.5/PM10 µg/m³, CO ppmv, NO₂/O₃/SO₂ ppbv. Native files are checksum-verified against validated detail manifests on reads. Preserve source SHA, timestamp, calibration and audio_max throughout a session.
- Mean is cosine-latitude weighted. P90 and IQR are unweighted quantiles of original valid native samples; never quantiles of coarse grid means. `spread = IQR/audio_max`.
- Bounding rectangles include south/west and exclude north/east, except 90°N. Empty rectangles snap to the nearest native center using the demo policy. Rendered footprint follows selected bins. Country/polygon selections may supply an **explicit enclosing rectangle** through the existing map editor; this endpoint does not claim country polygon masking. Existing polygon-aware region API remains available in the original workspace.
- Derivatives use angular degrees for spatial scans and actual UTC hours for temporal evolution, with unchanged artistic 0.02/0.01 references. No derivative spans missing data or a new spatial snapshot.
- No interpolation, inferred wind, health threshold, AQI conversion or replacement by nearest timestamp. Artistic saturation does not overwrite source concentrations. IQR is spatial dispersion, not model uncertainty.

## Frames, clock and failure handling

Stateless frame requests work across backend workers/restarts and do not require a shared session cache. They revalidate catalog source SHA/UTC and manifest calibration/unit/audio_max. Source removal/change returns 409 or missing native file 404; the player pauses and requires explicit re-preparation. A missing slot recorded in the prepared plan remains missing even if a later manual export fills it.

The browser retains at most three map views, prefetches the next source and gates the worklet horizon until React commits the matching frame. Buffering freezes the audio cursor; no new timestamp is attached to an old raster. Pause, seek, reverse, preview and Stop share this clock. The map is a native EPSG:4326 canvas, not an un-reprojected MapLibre Mercator image source. High-frequency clock state is isolated from page roots/GeoMap.

Status codes: 422 invalid request; 404 no selected verified data/native file/slot; 409 source or calibration mismatch/corrupt catalog; 410 expired convenience cache; 413 feature budget; 429 preparation capacity; 503 catalog not exported/mounted. There is no synthetic or PNG-derived scientific fallback for this contract.

## Deployment and verification

`GEOS_CF_CATALOG_ROOT` points to the existing exporter output containing index.json and SHA-named directories with detail.json/native fields. Development defaults to `frontend/public/data/geos-cf-catalog`; production must mount/copy this output into the backend container and set the variable. Merely deploying Python code does not provision NASA data. Export/download remain manual. Scientific requests reuse `resolveBackendRequestUrl`: explicit `NEXT_PUBLIC_BACKEND_URL`/`NEXT_PUBLIC_API_URL` when configured, otherwise the browser's same-origin `/api/v1` proxy backed by runtime `BACKEND_API_URL`. Server-side local fallback is http://localhost:8000.

`breathe-recipe-v1` download includes the full scientific plan, source references, current slot/cell, mixer, mute/solo and explanation. It is local JSON export, not the gallery's older project schema and not a server share link. WAV/video export, durable recipe persistence, polygon-native band aggregation and animated concentration interpolation are outside this integration.

Regression evidence and manual acceptance are recorded in `SCIENTIFIC_SESSION_INTEGRATION.md`. Cross-language parity fixture explicitly carries `isMock:true`; it is never used as a scientific API fallback.
