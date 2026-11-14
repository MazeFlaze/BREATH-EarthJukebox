from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from ..models.entities import DatasetSource, DatasetAsset


class DatasetRepository:
    """Repository handling database operations for dataset sources and physical assets."""

    @staticmethod
    def get_source(db: Session, source_id: str) -> Optional[DatasetSource]:
        return db.query(DatasetSource).filter(DatasetSource.id == source_id).first()

    @staticmethod
    def get_asset(db: Session, asset_id: str) -> Optional[DatasetAsset]:
        return db.query(DatasetAsset).filter(DatasetAsset.id == asset_id).first()

    @staticmethod
    def list_sources(db: Session) -> List[DatasetSource]:
        return db.query(DatasetSource).order_by(DatasetSource.id).all()

    @staticmethod
    def upsert_source(
        db: Session,
        source_id: str,
        provider: str,
        product: str,
        product_version: str = "v2",
        data_type: str = "model_analysis",
        temporal_resolution: str = "1hr",
        spatial_resolution: str = "0.25x0.25",
        source_url: str = "",
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> DatasetSource:
        source = db.query(DatasetSource).filter(DatasetSource.id == source_id).first()
        if not source:
            source = DatasetSource(
                id=source_id,
                provider=provider,
                product=product,
                product_version=product_version,
                data_type=data_type,
                temporal_resolution=temporal_resolution,
                spatial_resolution=spatial_resolution,
                source_url=source_url,
                metadata_json=metadata_json or {},
            )
            db.add(source)
        else:
            source.provider = provider
            source.product = product
            source.product_version = product_version
            source.data_type = data_type
            source.temporal_resolution = temporal_resolution
            source.spatial_resolution = spatial_resolution
            source.source_url = source_url
            if metadata_json:
                source.metadata_json = metadata_json
        db.commit()
        db.refresh(source)
        return source

    @staticmethod
    def get_asset_by_time(db: Session, source_id: str, target_time: datetime) -> Optional[DatasetAsset]:
        """Finds asset whose time range covers target_time."""
        return (
            db.query(DatasetAsset)
            .filter(
                DatasetAsset.dataset_source_id == source_id,
                DatasetAsset.time_start <= target_time,
                DatasetAsset.time_end >= target_time,
                DatasetAsset.ingest_status == "completed",
            )
            .first()
        )

    @staticmethod
    def get_assets_in_range(
        db: Session,
        source_id: str,
        start_time: datetime,
        end_time: datetime,
    ) -> List[DatasetAsset]:
        """Returns all completed assets overlapping [start_time, end_time] ordered chronologically."""
        return (
            db.query(DatasetAsset)
            .filter(
                DatasetAsset.dataset_source_id == source_id,
                DatasetAsset.time_start <= end_time,
                DatasetAsset.time_end >= start_time,
                DatasetAsset.ingest_status == "completed",
            )
            .order_by(DatasetAsset.time_start)
            .all()
        )

    @staticmethod
    def register_asset(
        db: Session,
        asset_id: str,
        dataset_source_id: str,
        original_filename: str,
        storage_path: str,
        checksum_sha256: str,
        time_start: datetime,
        time_end: datetime,
        variable_inventory: Optional[Dict[str, Any]] = None,
        ingest_status: str = "completed",
        error_message: Optional[str] = None,
    ) -> DatasetAsset:
        existing = db.query(DatasetAsset).filter(DatasetAsset.id == asset_id).first()
        if existing:
            existing.storage_path = storage_path
            existing.checksum_sha256 = checksum_sha256
            existing.time_start = time_start
            existing.time_end = time_end
            existing.variable_inventory = variable_inventory
            existing.ingest_status = ingest_status
            existing.error_message = error_message
            existing.ingested_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(existing)
            return existing

        asset = DatasetAsset(
            id=asset_id,
            dataset_source_id=dataset_source_id,
            original_filename=original_filename,
            storage_path=storage_path,
            checksum_sha256=checksum_sha256,
            time_start=time_start,
            time_end=time_end,
            variable_inventory=variable_inventory,
            ingest_status=ingest_status,
            error_message=error_message,
        )
        db.add(asset)
        db.commit()
        db.refresh(asset)
        return asset
