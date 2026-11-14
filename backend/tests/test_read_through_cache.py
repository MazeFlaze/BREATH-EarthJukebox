import pytest
from datetime import datetime, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient

try:
    from backend.src.main import app
    from backend.src.core.database import SessionLocal
    from backend.src.models.entities import ObservationSample
    from backend.src.core.cache import app_cache
except ImportError:
    from src.main import app
    from src.core.database import SessionLocal
    from src.models.entities import ObservationSample
    from src.core.cache import app_cache

client = TestClient(app)


def test_spatial_query_read_through_database_caching():
    """
    Verifies that spatial queries persist extracted points into observation_samples,
    enabling subsequent queries to read through the database without opening NetCDF files.
    """
    app_cache.clear()
    req_time = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)

    # 1. Clean up sample for grid cell (21.0, 105.75) corresponding to Hanoi
    with SessionLocal() as db:
        db.query(ObservationSample).filter(
            ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
            ObservationSample.variable == "PM25_RH35",
            ObservationSample.timestamp_utc == req_time,
            ObservationSample.grid_latitude == 21.0,
            ObservationSample.grid_longitude == 105.75,
        ).delete(synchronize_session=False)
        db.commit()

        sample_before = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
                ObservationSample.variable == "PM25_RH35",
                ObservationSample.timestamp_utc == req_time,
                ObservationSample.grid_latitude == 21.0,
                ObservationSample.grid_longitude == 105.75,
            )
            .first()
        )
        assert sample_before is None

    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "locations": [
            {"id": "hanoi", "lat": 21.03, "lon": 105.85},
        ],
    }

    # 2. First request: extracts from NetCDF and persists to DB
    res1 = client.post("/api/v1/jukebox/spatial", json=payload)
    assert res1.status_code == 200, res1.text
    data1 = res1.json()
    assert len(data1["points"]) == 1
    assert data1["points"][0]["value"] is not None

    # Verify point was persisted to observation_samples
    with SessionLocal() as db:
        sample_after = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
                ObservationSample.variable == "PM25_RH35",
                ObservationSample.timestamp_utc == req_time,
                ObservationSample.grid_latitude == 21.0,
                ObservationSample.grid_longitude == 105.75,
            )
            .first()
        )
        assert sample_after is not None
        assert sample_after.value == data1["points"][0]["value"]

    # 3. Clear memory cache to force database lookup
    app_cache.clear()

    # 4. Second request should hit the database without calling extract_spatial_slice
    try:
        patch_target = "src.processors.netcdf_processor.NetCDFProcessor.extract_spatial_slice"
    except Exception:
        patch_target = "backend.src.processors.netcdf_processor.NetCDFProcessor.extract_spatial_slice"

    with patch(patch_target) as mock_extract:
        res2 = client.post("/api/v1/jukebox/spatial", json=payload)
        assert res2.status_code == 200
        data2 = res2.json()
        assert len(data2["points"]) == 1
        assert data2["points"][0]["value"] == sample_after.value
        mock_extract.assert_not_called()


def test_temporal_query_read_through_database_caching():
    """
    Verifies that temporal queries persist observations into DB
    and subsequent queries read through DB without opening NetCDF files.
    """
    app_cache.clear()
    req_time = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)

    # 1. Clean up sample for grid cell (21.0, 105.75)
    with SessionLocal() as db:
        db.query(ObservationSample).filter(
            ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
            ObservationSample.variable == "PM25_RH35",
            ObservationSample.timestamp_utc == req_time,
            ObservationSample.grid_latitude == 21.0,
            ObservationSample.grid_longitude == 105.75,
        ).delete(synchronize_session=False)
        db.commit()

    params = {
        "datasetId": "geos-cf-v2-aqc",
        "lat": 21.03,
        "lon": 105.85,
        "variable": "PM25_RH35",
        "start": "2026-11-13T01:30:00Z",
        "end": "2026-11-13T01:30:00Z",
        "interval": "1h",
    }

    # 2. First query: extracts and persists
    res1 = client.get("/api/v1/jukebox/temporal", params=params)
    assert res1.status_code == 200, res1.text
    data1 = res1.json()
    assert len(data1["points"]) >= 1
    assert data1["points"][0]["value"] is not None

    # Verify point is in DB
    with SessionLocal() as db:
        sample = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
                ObservationSample.variable == "PM25_RH35",
                ObservationSample.timestamp_utc == req_time,
                ObservationSample.grid_latitude == 21.0,
                ObservationSample.grid_longitude == 105.75,
            )
            .first()
        )
        assert sample is not None

    # 3. Clear RAM cache
    app_cache.clear()

    # 4. Second query must read from DB without opening NetCDF
    try:
        patch_target = "src.processors.netcdf_processor.NetCDFProcessor.open_dataset"
    except Exception:
        patch_target = "backend.src.processors.netcdf_processor.NetCDFProcessor.open_dataset"

    with patch(patch_target) as mock_open:
        res2 = client.get("/api/v1/jukebox/temporal", params=params)
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["points"][0]["value"] == data1["points"][0]["value"]
        mock_open.assert_not_called()
