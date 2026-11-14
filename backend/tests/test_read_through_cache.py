import pytest
from datetime import datetime, timezone
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
    enabling subsequent queries to read through the database.
    """
    app_cache.clear()
    req_time = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)

    # Clean up test points if previously cached
    with SessionLocal() as db:
        db.query(ObservationSample).filter(
            ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
            ObservationSample.variable == "PM25_RH35",
            ObservationSample.timestamp_utc == req_time,
            ObservationSample.grid_latitude.in_([50.0, 52.5]),
        ).delete(synchronize_session=False)
        db.commit()

        initial_count = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
                ObservationSample.variable == "PM25_RH35",
                ObservationSample.timestamp_utc == req_time,
            )
            .count()
        )

    # Use custom test locations not queried by other test files
    payload = {
        "datasetId": "geos-cf-v2-aqc",
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "locations": [
            {"id": "unique_test_point_1", "lat": 50.11, "lon": 8.68},
            {"id": "unique_test_point_2", "lat": 52.52, "lon": 13.40},
        ],
    }

    # 1. First request
    res1 = client.post("/api/v1/jukebox/spatial", json=payload)
    assert res1.status_code == 200, res1.text
    data1 = res1.json()
    assert len(data1["points"]) == 2

    # Verify points were persisted to DB
    with SessionLocal() as db:
        samples_after = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == "geos-cf-v2-aqc",
                ObservationSample.variable == "PM25_RH35",
                ObservationSample.timestamp_utc == req_time,
            )
            .all()
        )
        assert len(samples_after) >= initial_count + 1

    # 2. Clear memory cache to force database lookup
    app_cache.clear()

    # 3. Second request should succeed reading through DB
    res2 = client.post("/api/v1/jukebox/spatial", json=payload)
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["points"]) == 2
    assert data2["points"][0]["value"] == data1["points"][0]["value"]


def test_temporal_query_read_through_database_caching():
    """
    Verifies that temporal queries persist observations into DB
    and read through DB for cached points.
    """
    app_cache.clear()

    params = {
        "datasetId": "geos-cf-v2-aqc",
        "lat": 21.03,
        "lon": 105.85,
        "variable": "PM25_RH35",
        "start": "2026-11-13T01:30:00Z",
        "end": "2026-11-13T01:30:00Z",
        "interval": "1h",
    }

    res1 = client.get("/api/v1/jukebox/temporal", params=params)
    assert res1.status_code == 200, res1.text
    data1 = res1.json()
    assert len(data1["points"]) >= 1

    # Clear RAM cache
    app_cache.clear()

    # Second query must match first
    res2 = client.get("/api/v1/jukebox/temporal", params=params)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["points"][0]["value"] == data1["points"][0]["value"]
