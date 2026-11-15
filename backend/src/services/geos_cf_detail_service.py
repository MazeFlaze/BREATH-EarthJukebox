"""Export only local, already inventoried NASA sources through existing preprocessing."""
from pathlib import Path
import numpy as np
import xarray as xr
from ..api.schemas.geos_cf_detail_schema import DetailField, GeosCfDetail
from ..api.schemas.notebook_demo_schema import NotebookDemoContract
from ..processors.netcdf_processor import NetCDFProcessor
from ..processors.notebook_demo_processor import NotebookDemoProcessor
from ..providers.geos_cf_provenance import checksum_file


def export_detail(path: Path, contract: NotebookDemoContract, output: Path, prefix: str,
                  fields: dict[str, xr.DataArray] | None = None) -> str:
    if contract.isMock or contract.source.grid_shape != (721, 1440):
        raise ValueError("Native detail requires a verified full-grid source")
    target = output / "detail.json"
    if target.exists():
        try:
            cached = GeosCfDetail.model_validate_json(target.read_text(encoding="utf-8"))
            if (cached.source.sha256 == contract.source.sha256 and cached.source.timestamp_utc == contract.source.timestamp_utc
                    and cached.source.collection == contract.source.collection and cached.calibration_version == contract.calibration_version
                    and set(cached.fields) == set(contract.pollutants)
                    and all(meta.unit == contract.pollutants[key].unit and meta.audio_max == contract.pollutants[key].audio_max
                            and meta.url == f"{prefix}/native-{key}.f32"
                            and (output / f"native-{key}.f32").stat().st_size == 721 * 1440 * 4
                            and checksum_file(output / f"native-{key}.f32") == meta.sha256
                            for key, meta in cached.fields.items())):
                return f"{prefix}/detail.json"
        except (ValueError, OSError):
            pass
    if fields is None:
        with NetCDFProcessor.open_dataset(path) as dataset:
            timestamp, fields = NotebookDemoProcessor.prepare_fields(dataset)
        if timestamp != contract.source.timestamp_utc:
            raise ValueError("Detail timestamp differs from catalog")
    output.mkdir(parents=True, exist_ok=True)
    metadata = {}
    for key, field in fields.items():
        if field.shape != (721, 1440):
            raise ValueError("Unexpected detail grid")
        # Cache display units, north first. IEEE NaN preserves missing vs valid zero.
        values = np.asarray(field.values[::-1, :], dtype="<f4")
        valid = values[np.isfinite(values)]
        filename = f"native-{key}.f32"
        temporary = output / f"{filename}.tmp"
        temporary.write_bytes(values.tobytes(order="C"))
        temporary.replace(output / filename)
        spec = contract.pollutants[key]
        metadata[key] = DetailField(url=f"{prefix}/{filename}", sha256=checksum_file(output / filename),
            unit=spec.unit, audio_max=spec.audio_max, valid_count=int(valid.size),
            minimum=float(valid.min()) if valid.size else None, maximum=float(valid.max()) if valid.size else None)
    manifest = GeosCfDetail(source=contract.source, calibration_version=contract.calibration_version, fields=metadata)
    temporary = output / "detail.tmp"
    temporary.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    temporary.replace(target)
    return f"{prefix}/detail.json"
