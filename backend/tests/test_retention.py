import time
from pathlib import Path
import pytest

try:
    from backend.src.providers.geos_cf import GEOSCFProvider
except ImportError:
    from src.providers.geos_cf import GEOSCFProvider


def test_lru_disk_retention_policy(tmp_path: Path):
    """
    Verifies that GEOSCFProvider.cleanup_old_granules properly evicts
    oldest NetCDF files when exceeding max_files limit.
    """
    provider = GEOSCFProvider(raw_storage_dir=tmp_path)

    # Create 5 mock NetCDF files with increasing timestamps
    files = []
    for i in range(5):
        f = tmp_path / f"GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261113_{i:02d}30z.R0.nc4"
        f.write_text("dummy netcdf content")
        # Ensure distinct mtime
        time.sleep(0.02)
        files.append(f)

    assert len(list(tmp_path.glob("GEOS.cf.ana.*.nc4"))) == 5

    # Run cleanup with max_files = 3
    evicted = provider.cleanup_old_granules(max_files=3)

    assert len(evicted) == 2
    # Oldest 2 files should be evicted
    assert files[0].name in evicted
    assert files[1].name in evicted

    # Remaining files should be the newest 3
    remaining = [f.name for f in tmp_path.glob("GEOS.cf.ana.*.nc4")]
    assert len(remaining) == 3
    assert files[2].name in remaining
    assert files[3].name in remaining
    assert files[4].name in remaining
