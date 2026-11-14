from datetime import datetime, timezone
from typing import Dict, Any, List
from sqlalchemy import (
    Column,
    String,
    Float,
    Integer,
    Boolean,
    DateTime,
    Text,
    JSON,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from ..core.database import Base


class DatasetSource(Base):
    """
    Metadata entity tracking upstream scientific dataset providers and products.
    """
    __tablename__ = "dataset_sources"

    id = Column(String(64), primary_key=True, index=True)
    provider = Column(String(128), nullable=False)
    product = Column(String(128), nullable=False)
    product_version = Column(String(32), nullable=False, default="v2")
    data_type = Column(String(64), nullable=False, default="model_analysis")
    temporal_resolution = Column(String(64), nullable=False, default="1hr")
    spatial_resolution = Column(String(64), nullable=False, default="0.25x0.25")
    source_url = Column(String(512), nullable=False)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    assets = relationship("DatasetAsset", back_populates="dataset_source", cascade="all, delete-orphan")
    samples = relationship("ObservationSample", back_populates="dataset_source", cascade="all, delete-orphan")


class DatasetAsset(Base):
    """
    Physical or remote granule file tracking storage path, temporal range, and checksum.
    """
    __tablename__ = "dataset_assets"

    id = Column(String(64), primary_key=True, index=True)
    dataset_source_id = Column(String(64), ForeignKey("dataset_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    original_filename = Column(String(256), nullable=False)
    storage_path = Column(String(512), nullable=False)
    checksum_sha256 = Column(String(64), nullable=False)
    time_start = Column(DateTime(timezone=True), nullable=False, index=True)
    time_end = Column(DateTime(timezone=True), nullable=False)
    variable_inventory = Column(JSON, nullable=True)
    ingest_status = Column(String(32), nullable=False, default="completed")
    error_message = Column(Text, nullable=True)
    ingested_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    dataset_source = relationship("DatasetSource", back_populates="assets")
    samples = relationship("ObservationSample", back_populates="dataset_asset", cascade="all, delete-orphan")


class Location(Base):
    """
    Named geographic locations and presets for spatial jukebox playlists.
    """
    __tablename__ = "locations"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    region = Column(String(128), nullable=False)
    is_preset = Column(Boolean, default=True)


class ObservationSample(Base):
    """
    Indexed scientific observation sample extracted from NetCDF grids.
    Stores values by grid coordinates (not user location name) for maximum reuse.
    """
    __tablename__ = "observation_samples"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_source_id = Column(String(64), ForeignKey("dataset_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_asset_id = Column(String(64), ForeignKey("dataset_assets.id", ondelete="CASCADE"), nullable=False, index=True)
    grid_latitude = Column(Float, nullable=False)
    grid_longitude = Column(Float, nullable=False)
    timestamp_utc = Column(DateTime(timezone=True), nullable=False, index=True)
    variable = Column(String(64), nullable=False, index=True)
    value = Column(Float, nullable=True)
    unit = Column(String(32), nullable=False)
    quality_status = Column(String(32), nullable=False, default="valid")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    dataset_source = relationship("DatasetSource", back_populates="samples")
    dataset_asset = relationship("DatasetAsset", back_populates="samples")

    __table_args__ = (
        UniqueConstraint(
            "dataset_source_id",
            "variable",
            "timestamp_utc",
            "grid_latitude",
            "grid_longitude",
            name="uq_obs_sample_grid_time",
        ),
        Index("ix_obs_var_time_grid", "variable", "timestamp_utc", "grid_latitude", "grid_longitude"),
        Index("ix_obs_grid", "grid_latitude", "grid_longitude"),
    )


# Standard 10 Global Presets for the Jukebox experience
PRESET_LOCATIONS: List[Dict[str, Any]] = [
    {"id": "hanoi", "name": "Hanoi", "latitude": 21.03, "longitude": 105.85, "region": "Southeast Asia", "is_preset": True},
    {"id": "bangkok", "name": "Bangkok", "latitude": 13.75, "longitude": 100.50, "region": "Southeast Asia", "is_preset": True},
    {"id": "singapore", "name": "Singapore", "latitude": 1.35, "longitude": 103.82, "region": "Southeast Asia", "is_preset": True},
    {"id": "tokyo", "name": "Tokyo", "latitude": 35.68, "longitude": 139.69, "region": "East Asia", "is_preset": True},
    {"id": "new_york", "name": "New York City", "latitude": 40.71, "longitude": -74.01, "region": "North America", "is_preset": True},
    {"id": "london", "name": "London", "latitude": 51.51, "longitude": -0.13, "region": "Europe", "is_preset": True},
    {"id": "paris", "name": "Paris", "latitude": 48.86, "longitude": 2.35, "region": "Europe", "is_preset": True},
    {"id": "sydney", "name": "Sydney", "latitude": -33.87, "longitude": 151.21, "region": "Oceania", "is_preset": True},
    {"id": "cairo", "name": "Cairo", "latitude": 30.04, "longitude": 31.24, "region": "Middle East / North Africa", "is_preset": True},
    {"id": "sao_paulo", "name": "São Paulo", "latitude": -23.55, "longitude": -46.63, "region": "South America", "is_preset": True},
]
