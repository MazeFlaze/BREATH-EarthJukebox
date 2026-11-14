import pytest
from fastapi.testclient import TestClient

try:
    from backend.src.main import app
except ImportError:
    from src.main import app

client = TestClient(app)


def test_temporal_jukebox_valid_series():
    """
    Test Temporal Jukebox mode:
    Given single location, variable, start and end timestamp,
    returns ordered chronological time series.
    """
    response = client.get(
        "/api/v1/jukebox/temporal",
        params={
            "dataset_id": "geos-cf-v2-aqc",
            "lat": 21.03,
            "lon": 105.85,
            "variable": "PM25_RH35",
            "start": "2026-11-13T00:30:00Z",
            "end": "2026-11-13T02:30:00Z",
            "interval": "1h",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["mode"] == "temporal"
    assert data["datasetId"] == "geos-cf-v2-aqc"
    assert data["variable"] == "PM25_RH35"
    assert data["unit"] == "ug m-3"
    assert data["isMock"] is False
    assert len(data["points"]) == 3  # 00:30, 01:30, 02:30

    # Verify chronological ascending timestamps
    timestamps = [p["timestamp"] for p in data["points"]]
    assert timestamps == [
        "2026-11-13T00:30:00Z",
        "2026-11-13T01:30:00Z",
        "2026-11-13T02:30:00Z",
    ]

    # Point 1 (01:30Z) is available locally in raw storage
    pt_available = data["points"][1]
    assert pt_available["timestamp"] == "2026-11-13T01:30:00Z"
    assert pt_available["quality"] == "valid"
    assert pt_available["value"] is not None and pt_available["value"] > 0
    assert pt_available["value"] == pytest.approx(104.0, abs=1.0)

    # Point 0 & 2 are missing locally (explicit missing state, not fabricated)
    pt_missing = data["points"][0]
    assert pt_missing["value"] is None
    assert pt_missing["quality"] == "missing"


def test_temporal_jukebox_invalid_range_start_after_end():
    """Verify 400 when start timestamp is after end timestamp."""
    response = client.get(
        "/api/v1/jukebox/temporal",
        params={
            "dataset_id": "geos-cf-v2-aqc",
            "lat": 21.03,
            "lon": 105.85,
            "variable": "PM25_RH35",
            "start": "2026-11-14T00:00:00Z",
            "end": "2026-11-13T00:00:00Z",
        },
    )
    assert response.status_code == 400
    assert "earlier than or equal" in response.json()["detail"].lower()


def test_temporal_jukebox_exceeds_max_range():
    """Verify 400 when requested time window exceeds MAX_HOURS_PER_QUERY (168h)."""
    response = client.get(
        "/api/v1/jukebox/temporal",
        params={
            "dataset_id": "geos-cf-v2-aqc",
            "lat": 21.03,
            "lon": 105.85,
            "variable": "PM25_RH35",
            "start": "2026-11-01T00:00:00Z",
            "end": "2026-11-20T00:00:00Z",
        },
    )
    assert response.status_code == 400
    assert "exceeds maximum limit" in response.json()["detail"]


def test_temporal_jukebox_invalid_coords():
    """Verify 422 on latitude out of bounds."""
    response = client.get(
        "/api/v1/jukebox/temporal",
        params={
            "dataset_id": "geos-cf-v2-aqc",
            "lat": 95.0,
            "lon": 105.85,
            "variable": "PM25_RH35",
            "start": "2026-11-13T00:00:00Z",
            "end": "2026-11-13T03:00:00Z",
        },
    )
    assert response.status_code == 422
