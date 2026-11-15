from pathlib import Path
from typing import Optional, Union
from ..core.config import settings


def get_portable_storage_path(file_path: Union[str, Path]) -> str:
    """
    Returns a portable relative storage path for database persistence.
    Example: 'data/raw/GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20260915_0130z.R0.nc4'
    """
    filename = Path(file_path).name
    return f"data/raw/{filename}"


def resolve_asset_path(
    storage_path: Optional[str] = None,
    original_filename: Optional[str] = None,
) -> Optional[Path]:
    """
    Resolves the actual physical file path across local dev, Docker container (/app),
    or volume mounts.

    Resolution strategy:
    1. If storage_path is directly an existing file (e.g. valid absolute or relative path).
    2. Check filename of storage_path inside settings.DATA_STORAGE_ROOT.
    3. Check original_filename inside settings.DATA_STORAGE_ROOT.
    4. Return None if the file cannot be located on the filesystem.
    """
    root = settings.DATA_STORAGE_ROOT

    if storage_path:
        p = Path(storage_path)
        if p.exists() and p.is_file():
            return p
        cand = root / p.name
        if cand.exists() and cand.is_file():
            return cand

    if original_filename:
        cand = root / original_filename
        if cand.exists() and cand.is_file():
            return cand

    return None
