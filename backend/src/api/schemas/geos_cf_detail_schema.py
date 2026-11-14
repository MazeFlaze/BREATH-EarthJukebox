"""Source-bound native caches for the local streaming demo; not a new calibration."""
from typing import Literal
from pydantic import Field
from .notebook_demo_schema import DemoModel, DemoSource


class DetailField(DemoModel):
    url: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    dtype: Literal["float32-le"] = "float32-le"
    unit: str
    audio_max: float = Field(gt=0)
    valid_count: int = Field(ge=0)
    minimum: float | None
    maximum: float | None


class GeosCfDetail(DemoModel):
    schema_version: Literal["geos-cf-detail-v1"] = "geos-cf-detail-v1"
    isMock: Literal[False] = False
    source: DemoSource
    rows: Literal[721] = 721
    cols: Literal[1440] = 1440
    lat_first: Literal[90] = 90
    lat_step: Literal[-0.25] = -0.25
    lon_first: Literal[-180] = -180
    lon_step: Literal[0.25] = 0.25
    order: Literal["north-to-south,west-to-east"] = "north-to-south,west-to-east"
    missing: Literal["NaN"] = "NaN"
    calibration_version: str
    fields: dict[str, DetailField]
