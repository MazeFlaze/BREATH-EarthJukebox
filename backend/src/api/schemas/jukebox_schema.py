from typing import List, Optional, Literal
from pydantic import BaseModel, Field, field_validator, model_validator

NormalizationMethodType = Literal["fixed_reference_range", "log_scale", "quantile_linear", "calibrated"]


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
    normalizationMethod: NormalizationMethodType = Field(
        "fixed_reference_range",
        description="Normalization strategy ('fixed_reference_range' default or 'log_scale'/'calibrated')",
    )


class NormalizationMeta(BaseModel):
    """Audio normalization reference bounds and version."""
    method: str = Field(..., description="Normalization strategy (e.g. 'fixed_reference_range' or 'log_scale')")
    min: float = Field(..., description="Reference minimum physical bound (or p01 for calibrated modes)")
    max: float = Field(..., description="Reference maximum physical bound (or p99 for calibrated modes)")
    configVersion: str = Field(..., description="Version of normalization mapping table")
    p01: Optional[float] = Field(None, description="Empirical P01 anchor when calibrated")
    p50: Optional[float] = Field(None, description="Empirical P50 median scale anchor when calibrated")
    p99: Optional[float] = Field(None, description="Empirical P99 anchor when calibrated")
    displayUnit: Optional[str] = Field(None, description="Human-readable display unit (e.g. 'ppbv', 'µg/m³')")


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
    displayValue: Optional[float] = Field(None, description="Human-readable converted value (e.g. ppbv for trace gases)")
    displayUnit: Optional[str] = Field(None, description="Human-readable display unit")
    quality: str = Field("valid", description="Quality flag: 'valid', 'missing', or 'uncalibrated'")


class JukeboxResponse(BaseModel):
    """
    Standardized playlist-ready response payload for both Spatial and Temporal Jukebox modes.
    Conforms strictly to the Sonification Data Contract for N03 (Audio) and N04 (Frontend).
    """
    mode: Literal["spatial", "temporal"] = Field(..., description="Jukebox playback mode")
    datasetId: str = Field(..., description="Dataset identifier")
    variable: str = Field(..., description="Scientific atmospheric variable")
    unit: str = Field(..., description="Native physical measurement unit")
    displayUnit: Optional[str] = Field(None, description="Human-readable display unit (e.g. 'ppbv', 'µg/m³')")
    dataType: str = Field(..., description="Scientific classification (e.g. 'model_analysis', 'satellite_observation')")
    isMock: bool = Field(False, description="Flag indicating whether data is synthetic prototype data")
    normalization: Optional[NormalizationMeta] = Field(None, description="Audio normalization bounds if calibrated")
    points: List[JukeboxPoint] = Field(..., description="Ordered playlist observation sequence")
    provenance: ProvenanceMeta = Field(..., description="Scientific provenance attribution")


class BoundingBoxInput(BaseModel):
    """Geographic rectangular bounding box selected via map drag-and-drop ROI tool."""
    latMin: float = Field(..., ge=-90.0, le=90.0, description="Southern latitude bound")
    latMax: float = Field(..., ge=-90.0, le=90.0, description="Northern latitude bound")
    lonMin: float = Field(..., ge=-360.0, le=360.0, description="Western longitude bound")
    lonMax: float = Field(..., ge=-360.0, le=360.0, description="Eastern longitude bound")

    @model_validator(mode="after")
    def validate_lat_order(self) -> "BoundingBoxInput":
        if self.latMin > self.latMax:
            raise ValueError(f"latMin ({self.latMin}) must be <= latMax ({self.latMax}).")
        return self


class RegionJukeboxRequest(BaseModel):
    """Request payload for Single-ROI (bounding box, center, or polygon/MultiPolygon border) spatial aggregation."""
    datasetId: str = Field("geos-cf-v2-aqc", description="Target dataset identifier")
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp")
    variable: str = Field("PM25_RH35", description="Atmospheric variable to aggregate")
    bounds: Optional[BoundingBoxInput] = Field(None, description="Explicit drag-box or border bounding box")
    center: Optional[CoordinatePair] = Field(None, description="Optional ROI center when bounds omitted")
    deltaDeg: float = Field(0.5, gt=0.0, le=30.0, description="Half-width in degrees when center is used")
    polygon: Optional[List[CoordinatePair]] = Field(
        None,
        min_length=3,
        max_length=2500,
        description="Optional single outer polygon boundary [(lat, lon), ...] for non-rectangular ROI masking",
    )
    polygons: Optional[List[List[CoordinatePair]]] = Field(
        None,
        min_length=1,
        max_length=64,
        description="Optional list of outer polygon rings (MultiPolygon islands/parts) for territory masking",
    )
    normalizationMethod: NormalizationMethodType = Field(
        "log_scale",
        description="Normalization strategy (defaults to EDA-calibrated 'log_scale' for perceptual audio)",
    )

    @field_validator("polygons")
    @classmethod
    def validate_polygon_rings(
        cls, rings: Optional[List[List[CoordinatePair]]]
    ) -> Optional[List[List[CoordinatePair]]]:
        if rings is None:
            return None
        total_vertices = 0
        for idx, ring in enumerate(rings):
            if len(ring) < 3:
                raise ValueError(f"Polygon ring at index {idx} must contain at least 3 vertices.")
            total_vertices += len(ring)
        if total_vertices > 5000:
            raise ValueError(f"Total polygon vertex count ({total_vertices}) exceeds maximum limit of 5000.")
        return rings

    @model_validator(mode="after")
    def validate_bounds_or_center(self) -> "RegionJukeboxRequest":
        if self.bounds is None and self.center is None and self.polygon is None and self.polygons is None:
            raise ValueError("One of 'bounds', 'center', 'polygon', or 'polygons' must be provided for ROI query.")
        return self


class RegionTierRatios(BaseModel):
    """Within-ROI air quality concentration tier proportions summing to 1.0 when valid cells > 0."""
    low: float
    moderate: float
    high: float


class RegionSummaryMetrics(BaseModel):
    """Spatial aggregation summary with native units, ppbv display units, and acoustic [0, 1] scores."""
    mean: Optional[float] = None
    p90: Optional[float] = None
    max: Optional[float] = None
    displayMean: Optional[float] = None
    displayP90: Optional[float] = None
    displayMax: Optional[float] = None
    normalizedMean: Optional[float] = None
    normalizedP90: Optional[float] = None
    normalizedMax: Optional[float] = None
    validCount: int
    missingCount: int
    totalCount: int
    snappedToNearest: bool = False
    tierRatios: RegionTierRatios


class RegionJukeboxResponse(BaseModel):
    """Response payload for Single-ROI spatial aggregation and sonification."""
    mode: Literal["region"] = "region"
    maskMode: Literal["bounds", "polygon"] = "bounds"
    datasetId: str
    variable: str
    timestamp: str
    unit: str
    displayUnit: str
    dataType: str
    isMock: bool = False
    bounds: BoundingBoxInput
    normalization: Optional[NormalizationMeta] = None
    summary: RegionSummaryMetrics
    provenance: ProvenanceMeta
