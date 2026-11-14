"""Build the local web catalog from manually downloaded files. This command never downloads."""
import argparse
from pathlib import Path

from backend.src.core.config import settings
from backend.src.services.geos_cf_catalog_service import export_catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, action="append", help="Repeat for multiple local archive roots")
    parser.add_argument("--output", type=Path, default=Path("frontend/public/data/geos-cf-catalog"))
    parser.add_argument("--reference-contract", type=Path, default=Path("frontend/public/data/notebook-demo/contract.json"))
    args = parser.parse_args()
    catalog = export_catalog(args.raw_dir or [settings.NASA_ARCHIVE_ROOT, settings.DATA_STORAGE_ROOT], args.output, args.reference_contract)
    print(f"Ready={catalog.ready_count}; excluded={len(catalog.entries) - catalog.ready_count}; gaps={len(catalog.gaps)}")


if __name__ == "__main__":
    main()
