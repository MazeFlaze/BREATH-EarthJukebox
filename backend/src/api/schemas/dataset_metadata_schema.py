from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class VariableMeta(BaseModel):
    """Metadata for an atmospheric variable."""
    variable: str = Field(..., description="Variable code (e.g. 'PM25_RH35')")
    name: str = Field(..., description="Human-readable variable title")
    unit: str = Field(..., description="Physical unit in NetCDF")
    displayUnit: str = Field(..., description="Formatted display unit (e.g. 'µg/m³')")
    description: str = Field(..., description="Scientific description")
    type: str = Field(..., description="Variable type ('mass_concentration' or 'mole_fraction')")


class DatasetSummary(BaseModel):
    """Summary of an available atmospheric dataset."""
    id: str = Field(..., description="Dataset identifier")
    title: str = Field(..., description="Title")
    provider: str = Field(..., description="NASA scientific body")
    product: str = Field(..., description="NASA product name")
    version: str = Field(..., description="Product version")
    dataType: str = Field(..., description="Classification (model_analysis vs satellite_observation)")
    temporalResolution: str = Field(..., description="Temporal cadence")
    spatialResolution: str = Field(..., description="Spatial grid")
    isMock: bool = Field(False, description="Whether dataset is synthetic prototype")


class DatasetAvailability(BaseModel):
    """Temporal and spatial coverage of a dataset."""
    datasetId: str = Field(..., description="Dataset identifier")
    availableTimes: List[str] = Field(..., description="List of available UTC ISO timestamps")
    timeRange: Dict[str, Optional[str]] = Field(..., description="Start and end of available temporal window")
    totalGranules: int = Field(..., description="Number of locally or cataloged granules")


class LocationItem(BaseModel):
    """A preset or saved geographic location."""
    id: str = Field(..., description="Location code")
    name: str = Field(..., description="City or region name")
    lat: float = Field(..., description="Latitude")
    lon: float = Field(..., description="Longitude")
    region: str = Field(..., description="Continental / geopolitical region")
    isPreset: bool = Field(True, description="Whether location is a system preset")
