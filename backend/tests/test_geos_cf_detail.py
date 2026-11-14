"""Isolated binary-cache fixtures never qualify as NASA inventory entries."""
from pathlib import Path
import numpy as np
import pytest
import xarray as xr
from pydantic import ValidationError

try:
    from backend.src.api.schemas.geos_cf_detail_schema import GeosCfDetail
    from backend.src.api.schemas.notebook_demo_schema import NotebookDemoContract
    from backend.src.services.geos_cf_detail_service import export_detail
except ImportError:
    from src.api.schemas.geos_cf_detail_schema import GeosCfDetail
    from src.api.schemas.notebook_demo_schema import NotebookDemoContract
    from src.services.geos_cf_detail_service import export_detail


def contract():
    root = Path(__file__).resolve().parents[2]
    return NotebookDemoContract.model_validate_json((root / 'frontend/public/data/notebook-demo/contract.json').read_text(encoding='utf-8'))


def test_detail_cache_preserves_native_shape_missing_zero_and_checksums(tmp_path):
    baseline = contract()
    values = np.ones((721, 1440), dtype=np.float32)
    values[0, 0] = np.nan; values[-1, -1] = 0
    da = xr.DataArray(values, dims=('lat', 'lon'), coords={'lat': np.arange(-90, 90.25, .25), 'lon': np.arange(-180, 180, .25)})
    fields = {key: da for key in baseline.pollutants}
    url = export_detail(tmp_path / 'unavailable.nc4', baseline, tmp_path, '/data/fixture', fields)
    assert url == '/data/fixture/detail.json'
    manifest = GeosCfDetail.model_validate_json((tmp_path / 'detail.json').read_text(encoding='utf-8'))
    assert len(manifest.fields) == 6 and manifest.source.sha256 == baseline.source.sha256
    decoded = np.fromfile(tmp_path / 'native-co.f32', dtype='<f4').reshape(721, 1440)
    assert decoded[0, -1] == 0 and np.isnan(decoded[-1, 0])
    assert manifest.fields['co'].valid_count == 1038239
    assert manifest.fields['co'].minimum == 0
    # Complete hash-qualified cache can be reused without reopening raw data.
    assert export_detail(tmp_path / 'unavailable.nc4', baseline, tmp_path, '/data/fixture') == url
    (tmp_path / 'native-co.f32').write_bytes(b'corrupt')
    export_detail(tmp_path / 'unavailable.nc4', baseline, tmp_path, '/data/fixture', fields)
    assert (tmp_path / 'native-co.f32').stat().st_size == 721 * 1440 * 4


def test_detail_export_rejects_mock_and_partial_grid(tmp_path):
    baseline = contract(); baseline.isMock = True
    with pytest.raises(ValueError): export_detail(tmp_path / 'source', baseline, tmp_path, '/data/test', {})
    baseline.isMock = False; baseline.source.grid_shape = (2, 2)
    with pytest.raises(ValueError): export_detail(tmp_path / 'source', baseline, tmp_path, '/data/test', {})
    with pytest.raises(ValidationError): GeosCfDetail(source=contract().source, calibration_version='test', fields={}, isMock=True)
