"""Scientific regression tests for the additive notebook-A policy."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from pydantic import ValidationError

try:
    from backend.src.api.schemas.notebook_demo_schema import DemoBounds, DemoScientificEvent, NotebookDemoContract
    from backend.src.processors.notebook_demo_processor import (
        NotebookDemoProcessor, POLLUTANTS, freeze_events, next_mood, pulse_count,
    )
except ImportError:
    from src.api.schemas.notebook_demo_schema import DemoBounds, DemoScientificEvent, NotebookDemoContract
    from src.processors.notebook_demo_processor import (
        NotebookDemoProcessor, POLLUTANTS, freeze_events, next_mood, pulse_count,
    )


def six_fields() -> xr.Dataset:
    values = np.array([[[0.0, -1.0], [10.0, 1e15]]])
    return xr.Dataset({spec.source_variable: (("time", "lat", "lon"), values.copy(), {"units": spec.source_unit})
                       for spec in POLLUTANTS.values()},
                      coords={"time": pd.date_range("2026-11-12 00:30", periods=1), "lat": [0, 60], "lon": [0, 90]})


def test_weighted_mean_and_half_open_partition():
    field = xr.DataArray([[0.0, 0.0], [10.0, 10.0]], dims=("lat", "lon"), coords={"lat": [0, 60], "lon": [0, 90]})
    value, valid, total = NotebookDemoProcessor.aggregate(field, DemoBounds(lat=(0, 90), lon=(0, 180)))
    assert value == pytest.approx(10 / 3)  # unweighted 5 would be incorrect
    assert (valid, total) == (4, 4)
    left = NotebookDemoProcessor.aggregate(field, DemoBounds(lat=(0, 90), lon=(0, 90)))
    right = NotebookDemoProcessor.aggregate(field, DemoBounds(lat=(0, 90), lon=(90, 180)))
    assert left[2] + right[2] == total
    # A sub-grid empty region remains missing; never silently sample another place.
    assert NotebookDemoProcessor.aggregate(field, DemoBounds(lat=(10, 11), lon=(10, 11))) == (None, 0, 0)


def test_mask_before_conversion_and_reject_conflicting_units():
    ds = six_fields()
    timestamp, fields = NotebookDemoProcessor.prepare_fields(ds)
    assert timestamp == "2026-11-12T00:30:00Z"
    assert fields["co"].values[1, 0] == 1e7  # ppmv, not ppbv
    assert fields["co"].values[0, 0] == 0
    assert np.isnan(fields["co"].values[0, 1])
    assert np.isnan(fields["co"].values[1, 1])
    ds["CO"].attrs.update(units="ppbv", long_name="mol mol-1")
    with pytest.raises(ValueError, match="Unverified source unit"):
        NotebookDemoProcessor.prepare_fields(ds)


@pytest.mark.parametrize(("value", "expected"), [(None, None), (0, 0), (0.001, 1), (20, 1), (20.01, 2), (100, 5), (1000, 5)])
def test_pulses_preserve_missing_zero_and_saturation(value, expected):
    assert pulse_count(value, 100) == expected


def test_hysteresis_and_missing_reset():
    assert next_mood(0.26, 0) == 0
    assert next_mood(0.30, 0) == 1
    assert next_mood(0.48, 2) == 2
    assert next_mood(0.46, 2) == 1
    def event(value, scan):
        return DemoScientificEvent(pollutant="pm25_rh35", scan_id=scan, timestamp_utc="2026-11-12T00:30:00Z",
            source_sha256="a" * 64, bounds=DemoBounds(lat=(0, 1), lon=(0, 1)),
            raw_value=value, value=value, unit="µg/m³", score=None if value is None else value / 100,
            pulses=pulse_count(value, 100), valid_cells=0 if value is None else 1, total_cells=1, missing=value is None)
    events = [event(30, "G01"), event(None, "G02"), event(24, "G03")]
    plan = freeze_events(events, "global")
    assert plan[1].artistic_mood is None and plan[1].chord_midi is None
    assert plan[2].artistic_mood == "SERENITY" and plan[2].delta_canonical_score is None
    independent = freeze_events([event(30, "A"), event(24, "B")], "region")
    assert independent[1].artistic_mood == "SERENITY"
    assert independent[1].delta_canonical_score is None
    with pytest.raises(ValidationError):
        DemoScientificEvent.model_validate({**event(None, "G02").model_dump(), "score": 0})


def test_packaged_contract_is_a_complete_partition_and_frozen():
    path = Path(__file__).resolve().parents[2] / "frontend/public/data/notebook-demo/contract.json"
    contract = NotebookDemoContract.model_validate_json(path.read_text(encoding="utf-8"))
    assert not contract.isMock
    assert contract.source.sha256 == "8c041bb77c65fe609bea34a2992e8a9c4c3b7efa7419f4b4acd5cde3e9a78198"
    for key, events in contract.global_plans.items():
        assert len(events) == 32
        assert [e.scientific.scan_id for e in events] == [f"G{i:02d}" for i in range(1, 33)]
        assert sum(e.scientific.total_cells for e in events) == 721 * 1440
        assert len({e.event_id for e in events}) == 32
        for event in events:
            assert event.scientific.pulses == pulse_count(event.scientific.value, contract.pollutants[key].audio_max)
            assert event.scientific.source_sha256 == contract.source.sha256
        assert list(reversed(list(reversed(events)))) == events
        assert len(contract.region_plans[key]) == 2
    # Independent values captured in the notebook's original A/B output.
    assert contract.region_plans["pm25_rh35"][0].scientific.value == pytest.approx(60.085567, abs=1e-6)
    assert contract.region_plans["co"][0].scientific.value == pytest.approx(0.454668, abs=1e-6)
    assert all(e.scientific.pulses == 1 for e in contract.global_plans["no2"])
    assert json.loads(path.read_text(encoding="utf-8"))["temporal_status"] == "unavailable_single_verified_timestamp"
