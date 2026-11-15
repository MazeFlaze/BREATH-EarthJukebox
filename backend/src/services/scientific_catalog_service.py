"""Read verified exports. No network, download, ingestion, or scientific fallback."""
from pathlib import Path

import numpy as np
from fastapi import HTTPException

from ..api.schemas.geos_cf_catalog_schema import CatalogEntry, GeosCfCatalog
from ..api.schemas.geos_cf_detail_schema import GeosCfDetail
from ..core.config import settings
from ..providers.geos_cf_provenance import checksum_file

__all__ = ["ScientificCatalog"]


class ScientificCatalog:
    def __init__(self, root: Path | None = None):
        self.root = (root or settings.GEOS_CF_CATALOG_ROOT).resolve()

    def _path(self, relative: str) -> Path:
        target = (self.root / relative).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("Artifact escapes catalog root")
        return target

    def read(self) -> GeosCfCatalog:
        try:
            catalog = GeosCfCatalog.model_validate_json(self._path("index.json").read_bytes())
            timestamps: set[str] = set()
            for entry in catalog.entries:
                if entry.status != "ready":
                    continue
                if (not entry.sha256 or len(entry.sha256) != 64 or entry.id != entry.sha256
                        or any(c not in "0123456789abcdef" for c in entry.id)
                        or not entry.timestamp_utc or entry.timestamp_utc in timestamps
                        or entry.provenance == "unverified"):
                    raise ValueError("Ready source lacks unique verified provenance")
                timestamps.add(entry.timestamp_utc)
            return catalog
        except FileNotFoundError as exc:
            raise HTTPException(503, "Verified catalog is not exported/mounted. Run the existing exporter manually.") from exc
        except (ValueError, OSError) as exc:
            raise HTTPException(409, "Catalog is invalid; re-export verified local artifacts") from exc

    def field(self, entry: CatalogEntry, pollutant: str) -> tuple[GeosCfDetail, np.ndarray]:
        try:
            manifest = GeosCfDetail.model_validate_json(self._path(f"{entry.id}/detail.json").read_bytes())
            if manifest.source.sha256 != entry.id or manifest.source.timestamp_utc != entry.timestamp_utc:
                raise ValueError("Source identity differs")
            field = manifest.fields[pollutant]
            path = self._path(f"{entry.id}/native-{pollutant}.f32")
            if path.stat().st_size != manifest.rows * manifest.cols * 4 or checksum_file(path) != field.sha256:
                raise ValueError("Native checksum or size differs")
            values = np.fromfile(path, dtype="<f4").reshape(manifest.rows, manifest.cols)
            finite = np.isfinite(values)
            if np.isinf(values).any() or (values[finite] < 0).any() or int(finite.sum()) != field.valid_count:
                raise ValueError("Native coverage or values differ")
            return manifest, values
        except FileNotFoundError as exc:
            raise HTTPException(404, "Native artifact is missing; export catalog manually") from exc
        except (KeyError, ValueError, OSError) as exc:
            raise HTTPException(409, "Native artifact failed scientific integrity verification") from exc
