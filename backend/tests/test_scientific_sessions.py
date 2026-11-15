"""Synthetic isolated fixtures; cross-language parity with the existing demo implementation."""
import base64
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

try:
    from backend.src.api.schemas.geos_cf_catalog_schema import CatalogEntry
    from backend.src.api.schemas.scientific_session_schema import SessionRequest
    from backend.src.api.routes import scientific_sessions as routes
    from backend.src.processors.scientific_session_processor import _crop, context_plan, join_views, prepare_view
    from backend.src.services.scientific_catalog_service import ScientificCatalog
    from backend.src.services.scientific_session_service import ScientificSessionService
    from backend.src.main import app
except ImportError:
    from src.api.schemas.geos_cf_catalog_schema import CatalogEntry
    from src.api.schemas.scientific_session_schema import SessionRequest
    from src.api.routes import scientific_sessions as routes
    from src.processors.scientific_session_processor import _crop, context_plan, join_views, prepare_view
    from src.services.scientific_catalog_service import ScientificCatalog
    from src.services.scientific_session_service import ScientificSessionService
    from src.main import app

FIXTURE = {"isMock": True, "description": "Generated numerical parity fixture, not NASA data"}
START, END = "2026-11-12T00:30:00Z", "2026-11-12T02:30:00Z"


def values():
    indices = np.arange(721 * 1440)
    result = ((indices % 17) / 4).astype("<f4")
    result[indices % 31 == 0] = np.nan
    return result.reshape(721, 1440)


@pytest.mark.parametrize("axis,resolution,traversal,scope", [
    ("horizontal", 5, "time", "global"), ("vertical", "native", "space", "region"),
    ("horizontal", 1, "space", "region"), ("vertical", "native", "time", "region"),
])
def test_native_band_and_arrangement_parity_with_browser(axis, resolution, traversal, scope):
    region = {"south": 19.75, "north": 22.25, "west": 104.75, "east": 106.75}
    request = SessionRequest(pollutant="pm25_rh35", start=START, end=START, axis=axis, resolution=resolution,
                             traversal=traversal, scope=scope, regions=[] if scope == "global" else [region])
    bounds = request.regions[0] if request.regions else None
    view = prepare_view(values(), request, 100, bounds)
    frames = join_views([view]); context = context_plan(frames, 300)
    options = {"resolution": resolution, "axis": axis, "profile": "focus", "bands": 8, "audioMax": 100,
               "temporalSummary": traversal == "time"}
    if bounds:
        options["crop"] = _crop(bounds, 721, 1440)
    script = Path(__file__).resolve().parents[2] / "frontend/scripts/scientific-parity-fixture.mjs"
    result = subprocess.run(["node", str(script), json.dumps({**FIXTURE, "options": options})], capture_output=True, text=True, check=True)
    browser = json.loads(result.stdout)
    for key in ("grid", "mean", "p90", "spread", "coverage", "contrast", "positions", "stepPositions"):
        actual = view[key] if key == "grid" else frames[key]
        expected = np.asarray([np.nan if x is None else x for x in browser[key]])
        np.testing.assert_allclose(actual.ravel(), expected, rtol=2e-6, atol=2e-6, equal_nan=True, err_msg=key)
    assert view["rowBins"] == browser["rowBins"] and view["colBins"] == browser["colBins"]
    assert view["laneBins"] == browser["laneBins"]
    np.testing.assert_allclose(frames["contextGradient"].ravel(), browser["gradient"], atol=2e-6)
    np.testing.assert_allclose(frames["contextCurvature"].ravel(), browser["curvature"], atol=2e-6)
    for actual, expected in zip(context["windows"], browser["windows"], strict=True):
        assert (actual["startStep"], actual["endStep"]) == (expected["startStep"], expected["endStep"])
        for a, e in zip(actual["voices"], expected["voices"], strict=True):
            for key in a:
                assert a[key] == pytest.approx(e[key], abs=2e-6) if isinstance(a[key], (float, int)) else a[key] == e[key]


class FixtureCatalog:
    """Mocks only the already-verified reader boundary; never mounted as a production catalog."""
    isMock = True

    def __init__(self):
        self.entries = [CatalogEntry(id=char * 64, sha256=char * 64, filename="synthetic fixture", timestamp_utc=timestamp,
                                    status="ready", provenance="notebook_reference") for char, timestamp in [("a", START), ("b", END)]]

    def read(self):
        return SimpleNamespace(entries=self.entries)

    def field(self, entry, pollutant):
        field = SimpleNamespace(audio_max=100, unit="µg/m³")
        return SimpleNamespace(calibration_version="synthetic-test-calibration", fields={pollutant: field}), values()


def decode(array):
    return np.frombuffer(base64.b64decode(array.data), dtype="<f4")


def test_api_roundtrip_gap_binary_finiteness_compare_and_expiry():
    service = ScientificSessionService(FixtureCatalog())
    client = TestClient(app)
    payload = {"pollutant": "pm25_rh35", "start": START, "end": END, "scope": "compare", "regions": [
        {"south": 21, "north": 21.01, "west": 105, "east": 105.01},
        {"south": 20, "north": 22, "west": 105, "east": 107}]}
    with patch.object(routes, "scientific_sessions", service):
        response = client.post("/api/v1/scientific/sessions", json=payload)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        data = response.json()
        assert "NaN" not in response.text and data["lane_counts"][0] == 1
        assert [s["missing"] for s in data["slots"]] == [False, True, False]
        plan = service._cache[data["id"]][1]
        assert np.isnan(decode(plan.arrays["mean"]).reshape(3, -1)[1]).all()
        assert not decode(plan.arrays["contextGradient"]).any()  # No derivative across missing hour
        gap = client.get(f'/api/v1/scientific/sessions/{data["id"]}/views/1').json()
        assert gap["missing"] and gap["views"] == [] and gap["source_sha256"] is None
        frame = client.get(f'/api/v1/scientific/sessions/{data["id"]}/views/0')
        assert frame.status_code == 200 and frame.json()["views"][0]["rows"] == 1
        assert client.get(f'/api/v1/scientific/sessions/{data["id"]}/views/99').status_code == 404
        service._cache.clear()
        assert client.get(f'/api/v1/scientific/sessions/{data["id"]}/views/0').status_code == 410
        frame_request = {"selection": data["selection"], "timestamp": START, "source_sha256": "a" * 64,
                         "calibration_version": data["calibration_version"], "unit": data["unit"], "audio_max": data["audio_max"]}
        assert client.post('/api/v1/scientific/frames', json=frame_request).status_code == 200
        assert client.post('/api/v1/scientific/frames', json={**frame_request, "audio_max": 200}).status_code == 409
        assert client.post('/api/v1/scientific/frames', json={**frame_request, "source_sha256": "c" * 64}).status_code == 409


@pytest.mark.parametrize("patch_value", [{"start": "2026-11-12T00:00:00Z"}, {"end": "2026-11-15T00:30:00Z"},
    {"scope": "compare"}, {"bands": 32}, {"duration": 1}, {"extra": True}])
def test_request_rejects_unsupported_or_ambiguous_science(patch_value):
    with pytest.raises(ValidationError):
        SessionRequest.model_validate({"pollutant": "co", "start": START, "end": START, **patch_value})


def test_catalog_does_not_fallback_or_allow_path_escape(tmp_path):
    reader = ScientificCatalog(tmp_path)
    with pytest.raises(HTTPException) as missing:
        reader.read()
    assert missing.value.status_code == 503
    with pytest.raises(ValueError):
        reader._path("../outside")
    (tmp_path / "index.json").write_text('{"isMock":true}')
    with pytest.raises(HTTPException) as corrupt:
        reader.read()
    assert corrupt.value.status_code == 409
