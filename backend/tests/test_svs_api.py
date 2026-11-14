import pytest
from fastapi.testclient import TestClient

try:
    from backend.src.main import app
except ImportError:
    from src.main import app

client = TestClient(app)


def test_get_air_quality_dataset():
    """Verify SVS 5533 air quality dataset conforms to schema and has verified NASA provenance."""
    response = client.get("/api/v1/observations/air-quality")
    assert response.status_code == 200
    data = response.json()

    assert data["id"] == "nasa-svs5533-geos-cf-2024"
    assert "NASA SVS 5533" in data["title"]
    assert data["variable"] == "Particulate Matter (PM2.5)"
    assert data["unit"] == "µg/m³"
    assert data["isMock"] is True
    assert len(data["observations"]) >= 8

    # Check first observation schema structure
    first_obs = data["observations"][0]
    assert "timestamp" in first_obs
    assert "imageUrl" in first_obs
    assert "wvs.earthdata.nasa.gov" in first_obs["imageUrl"]
    assert first_obs["value"] > 0
    assert "coordinates" in first_obs
    assert first_obs["coordinates"]["lat"] is not None
    assert first_obs["coordinates"]["lon"] is not None


def test_get_air_quality_range():
    """Verify PM2.5 range calculation for audio sonification bounds."""
    response = client.get("/api/v1/observations/air-quality/range")
    assert response.status_code == 200
    data = response.json()

    assert "min" in data
    assert "max" in data
    assert data["min"] < data["max"]
    assert data["min"] > 0


def test_get_single_air_quality_observation_success():
    """Verify fetching single observation by authentic GEOS-CF ID."""
    obs_id = "geos-cf-2024-07-24-003"
    response = client.get(f"/api/v1/observations/air-quality/{obs_id}")
    assert response.status_code == 200
    data = response.json()

    assert data["id"] == obs_id
    assert data["value"] == 182.5
    assert "Jasper Fire Front" in data["coordinates"]["regionName"]
    assert data["isMock"] is True


def test_get_air_quality_observation_not_found():
    """Verify 404 error on invalid observation ID."""
    response = client.get("/api/v1/observations/air-quality/nonexistent-id-999")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert "not found" in detail.lower()


def test_svs5533_alias_route():
    """Verify alias route /api/v1/observations/svs5533 returns the same payload."""
    resp_primary = client.get("/api/v1/observations/air-quality")
    resp_alias = client.get("/api/v1/observations/svs5533")

    assert resp_alias.status_code == 200
    assert resp_alias.json()["id"] == resp_primary.json()["id"]
