import pytest
from fastapi.testclient import TestClient

try:
    from backend.src.main import app
except ImportError:
    from src.main import app

client = TestClient(app)


def test_list_datasets_provenance_and_mock_demarcation():
    """Verify list of datasets clearly separates verified NASA data from synthetic prototypes."""
    response = client.get("/api/v1/datasets")
    assert response.status_code == 200
    datasets = response.json()
    assert len(datasets) >= 3

    geos_cf = next((d for d in datasets if d["id"] == "geos-cf-v2-aqc"), None)
    assert geos_cf is not None
    assert geos_cf["isMock"] is False
    assert geos_cf["provider"] == "NASA GMAO"
    assert geos_cf["dataType"] == "model_analysis"

    svs5533 = next((d for d in datasets if d["id"] == "nasa-svs5533-geos-cf-2024"), None)
    assert svs5533 is not None
    assert svs5533["isMock"] is True

    aod = next((d for d in datasets if d["id"] == "mock-nasa-aod-series-2026"), None)
    assert aod is not None
    assert aod["isMock"] is True


def test_dataset_variables_endpoint():
    """Verify GEOS-CF variable catalog reports correct physical units."""
    response = client.get("/api/v1/datasets/geos-cf-v2-aqc/variables")
    assert response.status_code == 200
    variables = response.json()
    var_map = {v["variable"]: v for v in variables}

    assert "PM25_RH35" in var_map
    assert var_map["PM25_RH35"]["unit"] == "ug m-3"
    assert var_map["PM25_RH35"]["type"] == "mass_concentration"

    assert "CO" in var_map
    assert var_map["CO"]["unit"] == "mol mol-1"
    assert var_map["CO"]["type"] == "mole_fraction"


def test_dataset_availability_endpoint():
    """Verify GEOS-CF availability reports available times and total granules."""
    response = client.get("/api/v1/datasets/geos-cf-v2-aqc/availability")
    assert response.status_code == 200
    avail = response.json()
    assert avail["datasetId"] == "geos-cf-v2-aqc"
    assert "availableTimes" in avail
    assert len(avail["availableTimes"]) >= 1
    assert "2026-11-13T01:30:00Z" in avail["availableTimes"]


def test_locations_endpoint():
    """Verify locations endpoint returns preset list including Hanoi, Bangkok, Tokyo, Singapore."""
    response = client.get("/api/v1/locations")
    assert response.status_code == 200
    locations = response.json()
    assert len(locations) >= 10

    loc_ids = [l["id"] for l in locations]
    assert "hanoi" in loc_ids
    assert "bangkok" in loc_ids
    assert "singapore" in loc_ids
    assert "tokyo" in loc_ids
