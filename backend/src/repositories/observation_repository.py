from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_
from ..models.entities import ObservationSample


class ObservationRepository:
    """Repository managing indexed scientific observation samples."""

    @staticmethod
    def get_sample(
        db: Session,
        dataset_source_id: str,
        variable: str,
        timestamp_utc: datetime,
        grid_lat: float,
        grid_lon: float,
    ) -> Optional[ObservationSample]:
        return (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == dataset_source_id,
                ObservationSample.variable == variable,
                ObservationSample.timestamp_utc == timestamp_utc,
                ObservationSample.grid_latitude == grid_lat,
                ObservationSample.grid_longitude == grid_lon,
            )
            .first()
        )

    @staticmethod
    def get_samples_for_grid_and_time_range(
        db: Session,
        dataset_source_id: str,
        variable: str,
        grid_lat: float,
        grid_lon: float,
        start_time: datetime,
        end_time: datetime,
    ) -> List[ObservationSample]:
        return (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == dataset_source_id,
                ObservationSample.variable == variable,
                ObservationSample.grid_latitude == grid_lat,
                ObservationSample.grid_longitude == grid_lon,
                ObservationSample.timestamp_utc >= start_time,
                ObservationSample.timestamp_utc <= end_time,
            )
            .order_by(ObservationSample.timestamp_utc)
            .all()
        )

    @staticmethod
    def upsert_sample(
        db: Session,
        dataset_source_id: str,
        dataset_asset_id: str,
        grid_lat: float,
        grid_lon: float,
        timestamp_utc: datetime,
        variable: str,
        value: Optional[float],
        unit: str,
        quality_status: str = "valid",
    ) -> ObservationSample:
        existing = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == dataset_source_id,
                ObservationSample.variable == variable,
                ObservationSample.timestamp_utc == timestamp_utc,
                ObservationSample.grid_latitude == grid_lat,
                ObservationSample.grid_longitude == grid_lon,
            )
            .first()
        )
        if existing:
            existing.value = value
            existing.unit = unit
            existing.quality_status = quality_status
            existing.dataset_asset_id = dataset_asset_id
            db.commit()
            db.refresh(existing)
            return existing

        sample = ObservationSample(
            dataset_source_id=dataset_source_id,
            dataset_asset_id=dataset_asset_id,
            grid_latitude=grid_lat,
            grid_longitude=grid_lon,
            timestamp_utc=timestamp_utc,
            variable=variable,
            value=value,
            unit=unit,
            quality_status=quality_status,
        )
        db.add(sample)
        db.commit()
        db.refresh(sample)
        return sample
