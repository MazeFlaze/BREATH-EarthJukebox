import pytest
from fastapi.testclient import TestClient

try:
    from backend.src.main import app
except ImportError:
    from src.main import app

client = TestClient(app)


def test_spatial_jukebox_valid_playlist():
    """
    Test Spatial Jukebox mode:
    Given single timestamp and variable, returns ordered sequence across locations.
    """
    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "locations": [
            {"id": "hanoi", "lat": 21.03, "lon": 105.85},
            {"id": "bangkok", "lat": 13.75, "lon": 100.50},
            {"id": "singapore", "lat": 1.35, "lon": 103.82},
            {"id": "tokyo", "lat": 35.68, "lon": 139.69},
        ],
    }
    response = client.post("/api/v1/jukebox/spatial", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["mode"] == "spatial"
    assert data["datasetId"] == "geos-cf-v2-aqc"
    assert data["variable"] == "PM25_RH35"
    assert data["unit"] == "ug m-3"
    assert data["dataType"] == "model_analysis"
    assert data["isMock"] is False
    assert len(data["points"]) == 4

    # 1. Verify exact order preservation
    expected_ids = ["hanoi", "bangkok", "singapore", "tokyo"]
    for i, pt in enumerate(data["points"]):
        assert pt["order"] == i
        assert pt["locationId"] == expected_ids[i]
        assert pt["timestamp"] == "2026-11-13T01:30:00Z"
        assert pt["quality"] == "valid"
        assert pt["value"] is not None
        assert pt["value"] > 0
        # Normalization check [0.0, 1.0]
        assert pt["normalizedValue"] is not None
        assert 0.0 <= pt["normalizedValue"] <= 1.0
        # Grid coordinates check
        assert abs(pt["gridCoordinates"]["lat"] - pt["requestedCoordinates"]["lat"]) < 0.25
        assert abs(pt["gridCoordinates"]["lon"] - pt["requestedCoordinates"]["lon"]) < 0.25

    # Check Hanoi real values (~104 ug/m3)
    hanoi_pt = data["points"][0]
    assert hanoi_pt["value"] is not None and hanoi_pt["value"] > 0
    assert hanoi_pt["value"] == pytest.approx(104.0, abs=1.0)
    assert abs(hanoi_pt["gridCoordinates"]["lat"] - 21.0) <= 0.25
    assert abs(hanoi_pt["gridCoordinates"]["lon"] - 105.75) <= 0.25


def test_spatial_jukebox_preserves_custom_reversed_order():
    """Verify reverse order is preserved when user requests Tokyo before Hanoi."""
    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "locations": [
            {"id": "tokyo", "lat": 35.68, "lon": 139.69},
            {"id": "hanoi", "lat": 21.03, "lon": 105.85},
        ],
    }
    response = client.post("/api/v1/jukebox/spatial", json=payload)
    assert response.status_code == 200
    points = response.json()["points"]
    assert points[0]["locationId"] == "tokyo"
    assert points[1]["locationId"] == "hanoi"


def test_spatial_jukebox_invalid_dataset():
    """Verify 404 on unknown dataset."""
    payload = {
        "datasetId": "non-existent-dataset",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "locations": [{"id": "hanoi", "lat": 21.03, "lon": 105.85}],
    }
    response = client.post("/api/v1/jukebox/spatial", json=payload)
    assert response.status_code == 404
    assert "not supported" in response.json()["detail"]


def test_spatial_jukebox_invalid_variable():
    """Verify 400 on invalid atmospheric variable."""
    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "INVALID_VAR_NAME",
        "locations": [{"id": "hanoi", "lat": 21.03, "lon": 105.85}],
    }
    response = client.post("/api/v1/jukebox/spatial", json=payload)
    assert response.status_code == 400
    assert "not found" in response.json()["detail"].lower()


def test_spatial_jukebox_invalid_coordinates():
    """Verify 422 on latitude out of bounds."""
    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "locations": [{"id": "invalid", "lat": 120.0, "lon": 105.85}],
    }
    response = client.post("/api/v1/jukebox/spatial", json=payload)
    assert response.status_code == 422
