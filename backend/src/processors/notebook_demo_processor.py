"""Notebook A adapter composed with the existing NetCDF reader; no API defaults change."""

import hashlib
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr

from ..api.schemas.notebook_demo_schema import (
    DemoBounds, DemoFrozenEvent, DemoPollutant, DemoScientificEvent,
    DemoSource, NotebookDemoContract,
)
from .netcdf_processor import NetCDFProcessor


POLLUTANTS: dict[str, DemoPollutant] = {
    "pm25_rh35": DemoPollutant(label="PM2.5 RH35", source_variable="PM25_RH35", source_unit="ug m-3", unit="µg/m³", factor=1, audio_max=100, display_max=100),
    "pm10_rh35": DemoPollutant(label="PM10 RH35", source_variable="PM10_RH35", source_unit="ug m-3", unit="µg/m³", factor=1, audio_max=150, display_max=150),
    "co": DemoPollutant(label="CO", source_variable="CO", source_unit="mol mol-1", unit="ppmv", factor=1e6, audio_max=2, display_max=2),
    "no2": DemoPollutant(label="NO₂", source_variable="NO2", source_unit="mol mol-1", unit="ppbv", factor=1e9, audio_max=80, display_max=80),
    "o3": DemoPollutant(label="O₃", source_variable="O3", source_unit="mol mol-1", unit="ppbv", factor=1e9, audio_max=100, display_max=100),
    "so2": DemoPollutant(label="SO₂", source_variable="SO2", source_unit="mol mol-1", unit="ppbv", factor=1e9, audio_max=50, display_max=50),
}
REGIONS = {
    "A": DemoBounds(lat=(20.5, 21.5), lon=(105.25, 106.25)),
    "B": DemoBounds(lat=(10.25, 11.25), lon=(106.25, 107.25)),
}
# Notebook cell 92: ordered mood grammar, not a health classification.
PRESETS: list[dict[str, Any]] = [
    dict(name="SERENITY", names=["Cmaj7", "Fmaj7", "Cmaj7", "G"], chords=[[60,64,67,71],[53,57,60,64],[60,64,67,71],[55,59,62]], scale=[60,62,64,67,69,72,74], density=0),
    dict(name="UNCERTAINTY", names=["Am7", "Dm7", "Em", "Am"], chords=[[57,60,64,67],[50,53,57,60],[52,55,59],[57,60,64]], scale=[57,60,62,64,67,69,72], density=0),
    dict(name="DISTURBANCE", names=["Dm", "Bb", "Gm", "A7"], chords=[[50,53,57],[58,62,65],[55,58,62],[57,61,64,67]], scale=[62,65,67,69,72,74], density=1),
    dict(name="ALERT", names=["Cm", "Ab", "Fm", "G7"], chords=[[48,51,55],[56,60,63],[53,56,60],[55,59,62,65]], scale=[60,63,65,67,70,72], density=1),
]


def pulse_count(value: float | None, maximum: float) -> int | None:
    if value is None:
        return None
    if not math.isfinite(value) or value < 0 or maximum <= 0:
        raise ValueError("Expected a non-negative concentration and positive calibration")
    return 0 if value == 0 else math.ceil(5 * min(value / maximum, 1))


def next_mood(score: float, previous: int | None) -> int:
    boundaries = (0.25, 0.5, 0.75)
    if previous is None:
        return sum(score >= boundary for boundary in boundaries)
    state = previous
    while state < 3 and score >= boundaries[state] + 0.035:
        state += 1
    while state > 0 and score < boundaries[state - 1] - 0.035:
        state -= 1
    return state


def freeze_events(events: list[DemoScientificEvent], mode: str) -> list[DemoFrozenEvent]:
    """Canonical order in; independent regions never share hysteresis or bass context."""
    scores = [e.score for e in events if e.score is not None]
    sequence_mean = float(np.mean(scores)) if scores else None
    state = None
    previous_score = None
    result = []
    for index, event in enumerate(events):
        if mode == "region":
            state = previous_score = None
        score = event.score
        delta = None if score is None or previous_score is None else round(score - previous_score, 10)
        chord = melody = bass = chord_name = mood = None
        count = 0
        if score is not None:
            state = next_mood(score, state)
            preset = PRESETS[state]
            chord_index = index % 4 if mode == "global" else 0
            chord = preset["chords"][chord_index]
            chord_name = preset["names"][chord_index]
            scale = preset["scale"]
            melody = scale[min(len(scale) - 1, int(score * len(scale)))]
            bass_score = score if mode == "region" else sequence_mean
            bass = chord[0] - 12 + (7 if bass_score is not None and bass_score >= 0.5 else 0)
            contrast = abs(delta) if delta is not None else 0
            count = min(4, 1 + int(contrast > 0.08) + int(contrast > 0.22) + preset["density"])
            mood = preset["name"]
            previous_score = score
        else:
            state = previous_score = None
        # Preserve the notebook's seeded NumPy texture without relying on a JS RNG.
        textures = []
        original_id = f"{'grid' if mode == 'global' else 'region'}:{event.pollutant}:{event.scan_id}"
        for hit in range(max(0, count - 1)):
            seed = int.from_bytes(hashlib.sha256(f"{original_id}/{hit}".encode()).digest()[:8], "little")
            n = int(0.045 * 22050)
            noise = np.random.default_rng(seed).standard_normal(n)
            textures.append((0.0035 * noise * np.sin(np.linspace(0, np.pi, n)) ** 2).tolist())
        result.append(DemoFrozenEvent(
            event_id=f"{event.source_sha256}:{mode}:{event.pollutant}:{event.scan_id}:multi6-fixed-demo-v1-NOT-AQI",
            canonical_index=index, scientific=event, artistic_mood=mood,
            chord_name=chord_name, chord_midi=chord, melody_midi=melody,
            bass_midi=bass, melody_note_count=count, delta_canonical_score=delta,
            variation_kind="spatial_contrast" if mode == "global" else "region_comparison",
            texture_pcm=textures,
        ))
    return result


class NotebookDemoProcessor:
    """Explicit notebook policy; do not substitute point-cache samples for area means."""

    @staticmethod
    def prepare_fields(ds: xr.Dataset) -> tuple[str, dict[str, xr.DataArray]]:
        if ds.sizes.get("time") != 1:
            raise ValueError("Demo A requires exactly one timestamp per asset")
        timestamp = pd.Timestamp(ds.time.values[0]).tz_localize("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
        names = {name.casefold(): name for name in ds.data_vars}
        fields = {}
        for key, spec in POLLUTANTS.items():
            if key not in names:
                raise ValueError(f"Missing required pollutant: {key}")
            da = ds[names[key]]
            def canonical(text: str) -> str:
                return re.sub(r"\s+", " ", str(text).lower().replace("µ", "u").replace("μ", "u")).strip()
            hints = ("ug m-3", "ug/m3", "ug m^-3", "ug m**-3", "ug/m³") if key.startswith("pm") else ("mol mol-1", "mol/mol", "mol mol^-1")
            units = canonical(da.attrs.get("units", ""))
            description = canonical(da.attrs.get("long_name", ""))
            # A conflicting explicit unit cannot be rescued by a long_name hint.
            if not any(h in (units or description) for h in hints):
                raise ValueError(f"Unverified source unit for {key}: {units or description}")
            for dim in ("time", "lev"):
                if dim in da.dims:
                    if da.sizes[dim] != 1:
                        raise ValueError(f"{key}: {dim} must be singleton")
                    da = da.isel({dim: 0}, drop=True)
            if set(da.dims) != {"lat", "lon"}:
                raise ValueError(f"Unexpected dimensions for {key}: {da.dims}")
            da = da.transpose("lat", "lon").sortby("lat")
            if float(da.lon.max()) > 180:
                da = da.assign_coords(lon=((da.lon + 180) % 360) - 180)
            da = da.sortby("lon")
            if not all(np.all(np.isfinite(da[c])) and np.all(np.diff(da[c]) > 0) for c in ("lat", "lon")):
                raise ValueError("Coordinates must be finite and strictly increasing")
            if fields:
                first = next(iter(fields.values()))
                if not (np.array_equal(first.lat, da.lat) and np.array_equal(first.lon, da.lon)):
                    raise ValueError("Pollutants must share the same grid")
            # Existing sentinel threshold, with notebook's additional negative policy.
            valid = np.isfinite(da) & (np.abs(da) < NetCDFProcessor.FILL_VALUE_THRESHOLD) & (da >= 0)
            fields[key] = (da.where(valid).load() * spec.factor).astype("float64")
        return timestamp, fields

    @staticmethod
    def aggregate(da: xr.DataArray, bounds: DemoBounds, include_north: bool = False) -> tuple[float | None, int, int]:
        south, north = bounds.lat
        west, east = bounds.lon
        mask_lat = (da.lat >= south) & ((da.lat <= north) if include_north else (da.lat < north))
        region = da.where(mask_lat, drop=True).where((da.lon >= west) & (da.lon < east), drop=True)
        valid = int(region.count().item()) if region.size else 0
        value = float(region.weighted(np.cos(np.deg2rad(region.lat))).mean(("lat", "lon")).item()) if valid else None
        return value, valid, int(region.size)

    @classmethod
    def build(cls, path: Path, checksum: str, *, is_mock: bool, source_url: str | None) -> tuple[NotebookDemoContract, dict[str, xr.DataArray]]:
        if not is_mock and (not source_url or not source_url.startswith("https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/")):
            raise ValueError("A NASA asset requires its explicit NCCS source URL")
        with NetCDFProcessor.open_dataset(path) as ds:
            timestamp, fields = cls.prepare_fields(ds)
        match = re.search(r"\.(\d{8})_(\d{4})z\.", path.name.lower())
        if not is_mock:
            if not match:
                raise ValueError("NASA filename must include the timestamp")
            expected = pd.to_datetime("".join(match.groups()), format="%Y%m%d%H%M", utc=True)
            if abs((pd.Timestamp(timestamp) - expected).total_seconds()) > 60:
                raise ValueError("Filename and NetCDF timestamps disagree")
        global_plans = {}
        region_plans = {}
        for key, da in fields.items():
            spec = POLLUTANTS[key]
            def event(scan_id: str, bounds: DemoBounds, north: bool = False) -> DemoScientificEvent:
                value, valid, total = cls.aggregate(da, bounds, north)
                return DemoScientificEvent(
                    pollutant=key, scan_id=scan_id, bounds=bounds,
                    timestamp_utc=timestamp, source_sha256=checksum,
                    raw_value=None if value is None else value / spec.factor,
                    value=value, unit=spec.unit,
                    score=None if value is None else min(max(value / spec.audio_max, 0), 1),
                    pulses=pulse_count(value, spec.audio_max), valid_cells=valid,
                    total_cells=total, missing=value is None,
                )
            events = []
            for row in range(4):
                south, north = 45 - row * 45, 90 - row * 45
                for col in (range(8) if row % 2 == 0 else reversed(range(8))):
                    bounds = DemoBounds(lat=(south, north), lon=(-180 + col * 45, -135 + col * 45))
                    events.append(event(f"G{len(events) + 1:02d}", bounds, row == 0))
            if sum(e.total_cells for e in events) != da.size:
                raise ValueError("Scan bins must partition every source grid cell exactly once")
            global_plans[key] = freeze_events(events, "global")
            region_plans[key] = freeze_events([event(name, bounds) for name, bounds in REGIONS.items()], "region")
        first = next(iter(fields.values()))
        contract = NotebookDemoContract(
            isMock=is_mock, source=DemoSource(
                provider="SYNTHETIC FIXTURE / NOT NASA" if is_mock else "NASA GMAO",
                collection="aqc_tavg_1hr_glo_L1440x721_slv", source_file=path.name,
                source_url=source_url, sha256=checksum, timestamp_utc=timestamp,
                grid_shape=first.shape,
            ), pollutants=POLLUTANTS, global_plans=global_plans, region_plans=region_plans,
            map_urls={key: f"/data/notebook-demo/{key}.png" for key in POLLUTANTS},
        )
        return contract, fields
