from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
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
    def get_samples_near_coordinate_and_time_range(
        db: Session,
        dataset_source_id: str,
        variable: str,
        lat: float,
        lon: float,
        start_time: datetime,
        end_time: datetime,
        tolerance_deg: float = 0.6,
    ) -> Dict[str, ObservationSample]:
        """
        DB-first spatial-temporal lookup selecting the nearest stored grid cell within
        tolerance_deg per hourly timestamp (supports both 0.25-deg and ~1.0-deg grids).
        """
        norm_lon = ((lon + 180.0) % 360.0) - 180.0
        lat_min = max(-90.0, lat - tolerance_deg)
        lat_max = min(90.0, lat + tolerance_deg)

        lon_low = norm_lon - tolerance_deg
        lon_high = norm_lon + tolerance_deg
        if lon_low < -180.0:
            lon_filter = or_(
                ObservationSample.grid_longitude >= lon_low + 360.0,
                ObservationSample.grid_longitude <= lon_high,
            )
        elif lon_high > 180.0:
            lon_filter = or_(
                ObservationSample.grid_longitude >= lon_low,
                ObservationSample.grid_longitude <= lon_high - 360.0,
            )
        else:
            lon_filter = and_(
                ObservationSample.grid_longitude >= lon_low,
                ObservationSample.grid_longitude <= lon_high,
            )

        candidates = (
            db.query(ObservationSample)
            .filter(
                ObservationSample.dataset_source_id == dataset_source_id,
                ObservationSample.variable == variable,
                ObservationSample.grid_latitude >= lat_min,
                ObservationSample.grid_latitude <= lat_max,
                lon_filter,
                ObservationSample.timestamp_utc >= start_time,
                ObservationSample.timestamp_utc <= end_time,
            )
            .order_by(ObservationSample.timestamp_utc)
            .all()
        )

        best_by_time: Dict[str, ObservationSample] = {}
        best_dist_by_time: Dict[str, float] = {}
        for sample in candidates:
            t_val = sample.timestamp_utc
            if t_val.tzinfo is None:
                t_val = t_val.replace(tzinfo=timezone.utc)
            iso_k = t_val.strftime("%Y-%m-%dT%H:%M:%SZ")

            d_lat = sample.grid_latitude - lat
            d_lon = ((sample.grid_longitude - norm_lon + 180.0) % 360.0) - 180.0
            dist_sq = (d_lat * d_lat) + (d_lon * d_lon)

            if iso_k not in best_by_time or dist_sq < best_dist_by_time[iso_k]:
                best_by_time[iso_k] = sample
                best_dist_by_time[iso_k] = dist_sq

        return best_by_time

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
        auto_commit: bool = True,
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
            if auto_commit:
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
        if auto_commit:
            db.commit()
            db.refresh(sample)
        return sample
