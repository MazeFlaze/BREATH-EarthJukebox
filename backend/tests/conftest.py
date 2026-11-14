import numpy as np
import pandas as pd
import pytest
import xarray as xr
from pathlib import Path

try:
    from backend.src.core.config import settings
    from backend.src.core.database import init_db, SessionLocal
    from backend.src.services.ingestion_service import IngestionService
except ImportError:
    from src.core.config import settings
    from src.core.database import init_db, SessionLocal
    from src.services.ingestion_service import IngestionService


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """
    Session-level fixture:
    1. Initializes database schema and seeds preset locations.
    2. Ensures a valid test NetCDF asset exists for 2026-11-13 01:30Z so API integration tests pass 100% in CI.
    """
    init_db()

    target_dir = settings.DATA_STORAGE_ROOT
    target_dir.mkdir(parents=True, exist_ok=True)
    sample_file = target_dir / "GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261113_0130z.R0.nc4"

    if not sample_file.exists():
        times = pd.date_range("2026-11-13 01:30:00", periods=1)
        lats = np.array([-90.0, 1.25, 13.75, 21.0, 35.75, 90.0], dtype=np.float32)
        lons = np.array([-180.0, 100.5, 103.75, 105.75, 139.75, 180.0], dtype=np.float32)

        data_shape = (1, len(lats), len(lons))
        pm25 = np.full(data_shape, 104.0, dtype=np.float32)
        pm10 = np.full(data_shape, 45.0, dtype=np.float32)
        co = np.full(data_shape, 1.8e-7, dtype=np.float32)
        no2 = np.full(data_shape, 1.2e-8, dtype=np.float32)
        o3 = np.full(data_shape, 3.5e-8, dtype=np.float32)
        so2 = np.full(data_shape, 5.0e-9, dtype=np.float32)

        ds = xr.Dataset(
            data_vars={
                "PM25_RH35": (["time", "lat", "lon"], pm25, {"units": "ug m-3", "long_name": "PM2.5"}),
                "PM10_RH35": (["time", "lat", "lon"], pm10, {"units": "ug m-3", "long_name": "PM10"}),
                "CO": (["time", "lat", "lon"], co, {"units": "mol mol-1", "long_name": "CO"}),
                "NO2": (["time", "lat", "lon"], no2, {"units": "mol mol-1", "long_name": "NO2"}),
                "O3": (["time", "lat", "lon"], o3, {"units": "mol mol-1", "long_name": "O3"}),
                "SO2": (["time", "lat", "lon"], so2, {"units": "mol mol-1", "long_name": "SO2"}),
            },
            coords={
                "time": times,
                "lat": lats,
                "lon": lons,
            },
            attrs={
                "title": "GEOS-CF Test Granule",
                "institution": "NASA GMAO",
                "Contact": "https://gmao.gsfc.nasa.gov",
                "VersionID": "v2",
            },
        )
        ds.to_netcdf(sample_file, engine="netcdf4")

    # Ingest into DB if not already indexed
    with SessionLocal() as db:
        service = IngestionService()
        try:
            service.ingest_local_file(sample_file, db=db)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Test fixture sample ingest failed: %s", exc)

    yield
