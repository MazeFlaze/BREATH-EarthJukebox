from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
import pytest

try:
    from backend.src.providers.geos_cf import GEOSCFProvider
    from backend.src.core.config import settings
    from backend.src.processors.netcdf_processor import NetCDFProcessor
except ImportError:
    from src.providers.geos_cf import GEOSCFProvider
    from src.core.config import settings
    from src.processors.netcdf_processor import NetCDFProcessor


def test_build_opendap_url():
    """Verifies that OPeNDAP DODS URLs match NASA GMAO naming conventions."""
    provider = GEOSCFProvider()
    test_dt = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)
    url = provider.build_opendap_url(test_dt)

    assert "https://opendap.nccs.nasa.gov/dods/gmao/geos-cf/v2/ana" in url
    assert "Y2026/M11/D13" in url
    assert "GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261113_0130z.R0" in url
    assert not url.endswith(".nc4")


def test_extract_point_opendap_mocked_success():
    """Verifies that extract_point_opendap correctly extracts observation point via xarray."""
    provider = GEOSCFProvider()
    test_dt = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)

    mock_pt_data = {
        "requested_coordinates": {"lat": 21.03, "lon": 105.85},
        "grid_coordinates": {"lat": 21.0, "lon": 105.75},
        "timestamp": "2026-11-13T01:30:00Z",
        "variable": "PM25_RH35",
        "unit": "ug m-3",
        "value": 104.0,
        "quality": "valid",
    }

    with patch.object(settings, "ENABLE_REMOTE_OPENDAP", True):
        with patch("xarray.open_dataset") as mock_open:
            mock_ds = MagicMock()
            mock_open.return_value.__enter__.return_value = mock_ds

            with patch.object(NetCDFProcessor, "extract_point_value", return_value=mock_pt_data):
                res = provider.extract_point_opendap(test_dt, 21.03, 105.85, "PM25_RH35")

                assert res is not None
                assert res["value"] == 104.0
                assert res["unit"] == "ug m-3"
                assert res["quality"] == "valid"


def test_extract_point_opendap_graceful_fallback_on_error():
    """Verifies that extract_point_opendap returns None gracefully when remote fails."""
    provider = GEOSCFProvider()
    test_dt = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)

    with patch.object(settings, "ENABLE_REMOTE_OPENDAP", True):
        with patch("xarray.open_dataset", side_effect=ConnectionError("OPeNDAP connection refused")):
            res = provider.extract_point_opendap(test_dt, 21.03, 105.85, "PM25_RH35")
            assert res is None
