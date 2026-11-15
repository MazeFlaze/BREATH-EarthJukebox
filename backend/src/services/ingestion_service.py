import hashlib
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
from sqlalchemy.orm import Session

from ..core.cache import app_cache
from ..core.config import settings
from ..models.entities import PRESET_LOCATIONS
from ..processors.netcdf_processor import NetCDFProcessor
from ..providers.geos_cf import GEOSCFProvider
from ..repositories.dataset_repository import DatasetRepository
from ..repositories.observation_repository import ObservationRepository
from ..repositories.location_repository import LocationRepository
from ..utils.logger import logger
from ..utils.storage import get_portable_storage_path


class IngestionService:
    """
    Orchestrates NASA NetCDF-4 dataset ingestion, asset registration,
    preset grid sample materialization, and cache invalidation.
    """

    def __init__(self, provider: Optional[GEOSCFProvider] = None):
        self.provider = provider or GEOSCFProvider(raw_storage_dir=settings.DATA_STORAGE_ROOT)

    @staticmethod
    def calculate_sha256(file_path: Path) -> str:
        """Calculates SHA-256 checksum of a file."""
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def ingest_local_file(
        self,
        file_path: Path,
        db: Session,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Ingests a local NetCDF file into the system:
        - Validates format and attributes
        - Computes checksum
        - Copies/moves to DATA_STORAGE_ROOT
        - Registers dataset source & asset in PostgreSQL
        - Materializes observation samples for the 10 preset locations
        - Invalidates affected cache
        """
        path_obj = Path(file_path).resolve()
        if not path_obj.exists():
            raise FileNotFoundError(f"File not found: {path_obj}")

        logger.info(f"Inspecting NetCDF file: {path_obj.name}")
        info = NetCDFProcessor.inspect_file(path_obj)
        checksum = self.calculate_sha256(path_obj)

        times = info.get("times", [])
        if times:
            time_start = pd.to_datetime(times[0], utc=True).to_pydatetime()
            time_end = pd.to_datetime(times[-1], utc=True).to_pydatetime()
        else:
            time_start = datetime.now(timezone.utc)
            time_end = time_start

        meta = self.provider.get_source_metadata()

        if dry_run:
            logger.info("Dry-run mode enabled; skipping database persistence.")
            return {
                "dry_run": True,
                "filename": path_obj.name,
                "checksum_sha256": checksum,
                "time_start": time_start.isoformat(),
                "time_end": time_end.isoformat(),
                "variables": list(info["variables"].keys()),
                "status": "validated",
            }

        # Ensure target file exists in raw storage root
        target_path = settings.DATA_STORAGE_ROOT / path_obj.name
        if path_obj != target_path:
            settings.DATA_STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path_obj, target_path)

        # 1. Upsert dataset source
        source = DatasetRepository.upsert_source(
            db=db,
            source_id=meta["datasetId"],
            provider=meta["provider"],
            product=meta["product"],
            product_version=meta["productVersion"],
            data_type=meta["dataType"],
            temporal_resolution=meta["temporalResolution"],
            spatial_resolution=meta["spatialResolution"],
            source_url=meta["sourceUrl"],
            metadata_json=info,
        )

        # 2. Register asset
        asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{meta['datasetId']}:{target_path.name}"))
        asset = DatasetRepository.register_asset(
            db=db,
            asset_id=asset_id,
            dataset_source_id=source.id,
            original_filename=target_path.name,
            storage_path=get_portable_storage_path(target_path),
            checksum_sha256=checksum,
            time_start=time_start,
            time_end=time_end,
            variable_inventory=info["variables"],
            ingest_status="completed",
        )

        # 3. Materialize samples for the 10 preset locations across primary variables
        materialized_count = 0
        preset_locs = LocationRepository.list_locations(db, presets_only=True)
        if not preset_locs:
            for p_dict in PRESET_LOCATIONS:
                LocationRepository.upsert_location(
                    db=db,
                    location_id=p_dict["id"],
                    name=p_dict["name"],
                    lat=p_dict["latitude"],
                    lon=p_dict["longitude"],
                    region=p_dict["region"],
                    is_preset=p_dict["is_preset"],
                )
            preset_locs = LocationRepository.list_locations(db, presets_only=True)

        # Pre-fetch existing samples for this source and timestamp to avoid round-trips
        from ..models.entities import ObservationSample
        existing_samples_map = {
            (s.variable, round(float(s.grid_latitude), 4), round(float(s.grid_longitude), 4)): s
            for s in db.query(ObservationSample).filter(
                ObservationSample.dataset_source_id == source.id,
                ObservationSample.timestamp_utc == time_start,
            ).all()
        }

        with NetCDFProcessor.open_dataset(target_path) as ds:
            for var_name, var_info in self.provider.list_variables().items():
                if var_name not in ds.data_vars:
                    continue

                for loc in preset_locs:
                    try:
                        pt_data = NetCDFProcessor.extract_point_value(
                            ds=ds,
                            variable=var_name,
                            lat=loc.latitude,
                            lon=loc.longitude,
                            timestamp=time_start,
                        )
                        grid_lat = pt_data["grid_coordinates"]["lat"]
                        grid_lon = pt_data["grid_coordinates"]["lon"]
                        sample_key = (var_name, round(float(grid_lat), 4), round(float(grid_lon), 4))

                        if sample_key in existing_samples_map:
                            sample = existing_samples_map[sample_key]
                            sample.value = pt_data["value"]
                            sample.unit = pt_data["unit"]
                            sample.quality_status = pt_data["quality"]
                            sample.dataset_asset_id = asset.id
                        else:
                            sample = ObservationSample(
                                dataset_source_id=source.id,
                                dataset_asset_id=asset.id,
                                grid_latitude=grid_lat,
                                grid_longitude=grid_lon,
                                timestamp_utc=time_start,
                                variable=var_name,
                                value=pt_data["value"],
                                unit=pt_data["unit"],
                                quality_status=pt_data["quality"],
                            )
                            db.add(sample)
                            existing_samples_map[sample_key] = sample

                        materialized_count += 1
                    except Exception as e:
                        logger.warning(f"Could not materialize sample for {loc.name} / {var_name}: {e}")

        db.commit()

        # 4. Invalidate cache
        app_cache.invalidate_dataset(source.id)

        logger.info(f"Ingested asset {asset.id} with {materialized_count} materialized preset samples.")
        return {
            "status": "completed",
            "source_id": source.id,
            "asset_id": asset.id,
            "filename": target_path.name,
            "checksum_sha256": checksum,
            "materialized_samples": materialized_count,
            "time_start": time_start.isoformat(),
            "time_end": time_end.isoformat(),
        }

    def ingest_remote_range(
        self,
        start_time: str,
        end_time: str,
        db: Session,
        variables: Optional[List[str]] = None,
        dry_run: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Pulls authentic granules from NASA NCCS DataShare over a time range
        and ingests each into the system.
        """
        start_dt = pd.to_datetime(start_time, utc=True).to_pydatetime()
        end_dt = pd.to_datetime(end_time, utc=True).to_pydatetime()
        hours = pd.date_range(start=start_dt, end=end_dt, freq="1h")

        results = []
        for h in hours:
            py_dt = h.to_pydatetime()
            iso_time = py_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            logger.info(f"Processing remote NASA retrieval for {iso_time}")

            if dry_run:
                url = self.provider.build_remote_url(py_dt)
                results.append({"timestamp": iso_time, "url": url, "dry_run": True})
                continue

            try:
                local_file = self.provider.fetch_granule(iso_time)
                res = self.ingest_local_file(local_file, db=db, dry_run=False)
                results.append(res)
            except Exception as e:
                logger.error(f"Failed remote ingest for {iso_time}: {e}")
                results.append({"timestamp": iso_time, "status": "failed", "error": str(e)})

        return results

    def ingest_directory(
        self,
        db: Session,
        raw_dir: Optional[Path] = None,
        pattern: str = "GEOS.cf.ana.*.nc4",
        skip_existing: bool = True,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Batch-ingests local NetCDF-4 granules in raw_dir into SQLite/PostgreSQL so preset
        locations are pre-materialized in observation_samples for DB-first temporal queries.
        """
        target_dir = Path(raw_dir) if raw_dir is not None else settings.DATA_STORAGE_ROOT
        files = sorted(target_dir.glob(pattern))
        meta = self.provider.get_source_metadata()

        ingested = 0
        skipped = 0
        failed = 0
        total_samples = 0

        for fp in files:
            asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{meta['datasetId']}:{fp.name}"))
            if skip_existing and not dry_run:
                existing = DatasetRepository.get_asset(db, asset_id)
                if existing and existing.ingest_status == "completed":
                    skipped += 1
                    continue

            try:
                res = self.ingest_local_file(fp, db=db, dry_run=dry_run)
                ingested += 1
                total_samples += int(res.get("materialized_samples", 0))
            except Exception as e:
                logger.warning(f"Batch ingest skipped/failed for {fp.name}: {e}")
                failed += 1

        return {
            "directory": str(target_dir),
            "files_found": len(files),
            "ingested": ingested,
            "skipped": skipped,
            "failed": failed,
            "materialized_samples": total_samples,
        }


ingestion_service = IngestionService()
