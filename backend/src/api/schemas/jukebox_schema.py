from typing import List, Optional, Literal
from pydantic import BaseModel, Field, field_validator


class CoordinatePair(BaseModel):
    """Geographic coordinate pair in decimal degrees."""
    lat: float = Field(..., description="Latitude between -90.0 and 90.0")
    lon: float = Field(..., description="Longitude between -180.0 and 180.0")

    @field_validator("lat")
    @classmethod
    def validate_lat(cls, v: float) -> float:
        if not (-90.0 <= v <= 90.0):
            raise ValueError(f"Latitude {v} out of bounds [-90.0, 90.0]")
        return v


class LocationInput(BaseModel):
    """Input specification for a single location in a spatial scan."""
    id: Optional[str] = Field(None, description="Optional location identifier (e.g. 'hanoi')")
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude between -90.0 and 90.0")
    lon: float = Field(..., description="Longitude")


class SpatialJukeboxRequest(BaseModel):
    """
    Request payload for Feature A: Spatial Jukebox mode.
    Plays atmospheric conditions across an ordered sequence of geographic locations at a single timestamp.
    """
    datasetId: str = Field(..., description="Target dataset identifier (e.g. 'geos-cf-v2-aqc')")
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp (e.g. '2026-11-13T01:30:00Z')")
    variable: str = Field(..., description="Atmospheric variable to sonify (e.g. 'PM25_RH35')")
    locations: List[LocationInput] = Field(..., min_length=1, max_length=100, description="Ordered locations sequence")


class NormalizationMeta(BaseModel):
    """Audio normalization reference bounds and version."""
    method: str = Field(..., description="Normalization strategy (e.g. 'fixed_reference_range')")
    min: float = Field(..., description="Reference minimum physical bound")
    max: float = Field(..., description="Reference maximum physical bound")
    configVersion: str = Field(..., description="Version of normalization mapping table")


class ProvenanceMeta(BaseModel):
    """Traceable scientific provenance from NASA mission/model."""
    provider: str = Field(..., description="Originating scientific body (e.g. 'NASA GMAO')")
    sourceUrl: str = Field(..., description="Canonical data source URL")
    productVersion: str = Field(..., description="Model/product version identifier")
    spatialResolution: Optional[str] = Field(None, description="Model grid resolution (e.g. '0.25x0.25')")
    temporalResolution: Optional[str] = Field(None, description="Temporal cadence (e.g. '1hr')")


class JukeboxPoint(BaseModel):
    """A single sound observation point in the jukebox playlist."""
    order: int = Field(..., description="0-indexed position in playlist playback order")
    locationId: Optional[str] = Field(None, description="Location identifier if provided")
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp")
    requestedCoordinates: CoordinatePair = Field(..., description="Original user/preset requested coordinates")
    gridCoordinates: CoordinatePair = Field(..., description="Resolved nearest scientific model grid coordinates")
    value: Optional[float] = Field(None, description="Raw physical measurement value, null if missing")
    normalizedValue: Optional[float] = Field(None, description="Normalized [0.0, 1.0] audio frequency control signal")
    quality: str = Field("valid", description="Quality flag: 'valid', 'missing', or 'uncalibrated'")


class JukeboxResponse(BaseModel):
    """
    Standardized playlist-ready response payload for both Spatial and Temporal Jukebox modes.
    Conforms strictly to the Sonification Data Contract for N03 (Audio) and N04 (Frontend).
    """
    mode: Literal["spatial", "temporal"] = Field(..., description="Jukebox playback mode")
    datasetId: str = Field(..., description="Dataset identifier")
    variable: str = Field(..., description="Scientific atmospheric variable")
    unit: str = Field(..., description="Physical measurement unit")
    dataType: str = Field(..., description="Scientific classification (e.g. 'model_analysis', 'satellite_observation')")
    isMock: bool = Field(False, description="Flag indicating whether data is synthetic prototype data")
    normalization: Optional[NormalizationMeta] = Field(None, description="Audio normalization bounds if calibrated")
    points: List[JukeboxPoint] = Field(..., description="Ordered playlist observation sequence")
    provenance: ProvenanceMeta = Field(..., description="Scientific provenance attribution")
