"""Versioned scientific planning API; browser playback controls are not source data."""
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

__all__ = ["SessionRequest", "SessionPlan", "FrameRequest", "FrameView", "EncodedArray", "SessionSlot"]


class SessionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SessionBounds(SessionModel):
    south: float = Field(ge=-90, le=90)
    north: float = Field(ge=-90, le=90)
    west: float = Field(ge=-180, le=180)
    east: float = Field(ge=-180, le=180)

    @model_validator(mode="after")
    def ordered(self) -> "SessionBounds":
        if self.south >= self.north or self.west >= self.east:
            raise ValueError("Bounds must be ordered; split antimeridian-crossing regions explicitly")
        return self


class SessionRequest(SessionModel):
    schema_version: Literal["breathe-session-request-v1"] = "breathe-session-request-v1"
    pollutant: Literal["pm25_rh35", "pm10_rh35", "co", "no2", "o3", "so2"]
    scope: Literal["global", "region", "compare"] = "global"
    traversal: Literal["time", "space", "series"] = "time"
    start: str
    end: str
    resolution: Literal[45, 22.5, 11.25, 5, 1, "native"] = "native"
    axis: Literal["horizontal", "vertical"] = "horizontal"
    bands: Literal[8, 16] = 8
    duration: Literal[180, 300, 420] = 300
    regions: list[SessionBounds] = Field(default_factory=list, max_length=2)

    @field_validator("start", "end")
    @classmethod
    def hourly_utc(cls, value: str) -> str:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if not value.endswith("Z") or parsed.minute != 30 or parsed.second:
            raise ValueError("Use verified hourly :30 UTC timestamps")
        return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")

    @model_validator(mode="after")
    def compatible(self) -> "SessionRequest":
        hours = (datetime.fromisoformat(self.end.replace("Z", "+00:00")) - datetime.fromisoformat(self.start.replace("Z", "+00:00"))).total_seconds() / 3600
        if hours < 0 or hours > 47:
            raise ValueError("Select an ordered range of at most 48 hourly slots")
        if self.traversal == "space" and self.start != self.end:
            raise ValueError("Spatial traversal requires exactly one timestamp")
        if len(self.regions) != {"global": 0, "region": 1, "compare": 2}[self.scope]:
            raise ValueError("Scope and region count differ")
        return self


class EncodedArray(SessionModel):
    dtype: Literal["float32-le", "float64-le", "uint32-le", "int32-le"]
    length: int = Field(ge=0)
    data: str  # base64; NaN is retained in binary, never sent as invalid JSON numbers


class FrameRequest(SessionModel):
    selection: SessionRequest
    timestamp: str
    source_sha256: str | None = Field(pattern=r"^[a-f0-9]{64}$")
    calibration_version: str = Field(min_length=1, max_length=200)
    unit: str = Field(min_length=1, max_length=100)
    audio_max: float = Field(gt=0)

    @model_validator(mode="after")
    def in_selection(self) -> "FrameRequest":
        SessionRequest.hourly_utc(self.timestamp)
        if not self.selection.start <= self.timestamp <= self.selection.end:
            raise ValueError("Frame UTC is outside the prepared selection")
        return self


class SessionSlot(SessionModel):
    timestamp: str
    source_sha256: str | None = None
    first: int
    end: int
    missing: bool


class Bin(SessionModel):
    key: int
    start: int
    end: int
    low: float
    high: float


class Voice(SessionModel):
    lane: int
    valid: bool
    mean: float | None
    p90: float
    excess: float
    spread: float
    edge: float
    note: int


class Window(SessionModel):
    startStep: int
    endStep: int
    voices: list[Voice]


class Arrangement(SessionModel):
    version: str
    windowSteps: int
    windows: list[Window]


class SessionPlan(SessionModel):
    schema_version: Literal["breathe-session-plan-v1"] = "breathe-session-plan-v1"
    id: str
    isMock: Literal[False] = False
    selection: SessionRequest
    calibration_version: str
    mapping_version: Literal["detail-continuous-log99-v1"] = "detail-continuous-log99-v1"
    unit: str
    audio_max: float
    steps: int
    lanes: int
    lane_counts: list[int]
    slots: list[SessionSlot]
    arrays: dict[str, EncodedArray]
    arrangement: Arrangement
    sources: list[dict[str, str]]
    warnings: list[str]


class MapView(SessionModel):
    rows: int
    cols: int
    rowBins: list[Bin]
    colBins: list[Bin]
    laneBins: list[dict[str, int]]
    arrays: dict[str, EncodedArray]


class FrameView(SessionModel):
    schema_version: Literal["breathe-frame-view-v1"] = "breathe-frame-view-v1"
    timestamp: str
    source_sha256: str | None
    missing: bool
    views: list[MapView]
