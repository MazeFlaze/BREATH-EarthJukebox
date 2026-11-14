"""Versioned, additive contract for the notebook A demo (not the legacy API)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DemoModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DemoBounds(DemoModel):
    lat: tuple[float, float]
    lon: tuple[float, float]

    @model_validator(mode="after")
    def validate_bounds(self) -> "DemoBounds":
        if not (-90 <= self.lat[0] < self.lat[1] <= 90 and -180 <= self.lon[0] < self.lon[1] <= 180):
            raise ValueError("Demo bounds must be ordered within the global EPSG:4326 extent")
        return self


class DemoPollutant(DemoModel):
    label: str
    source_variable: str
    source_unit: str
    unit: str
    factor: float = Field(gt=0)
    audio_max: float = Field(gt=0)
    display_max: float = Field(gt=0)


class DemoScientificEvent(DemoModel):
    pollutant: str
    scan_id: str
    timestamp_utc: str
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    bounds: DemoBounds
    raw_value: float | None = Field(ge=0)
    value: float | None = Field(ge=0)
    unit: str
    score: float | None = Field(ge=0, le=1)
    pulses: int | None = Field(ge=0, le=5)
    valid_cells: int = Field(ge=0)
    total_cells: int = Field(ge=0)
    missing: bool

    @model_validator(mode="after")
    def consistent_missing(self) -> "DemoScientificEvent":
        if self.valid_cells > self.total_cells:
            raise ValueError("Valid cells cannot exceed total cells")
        if self.missing != (self.value is None):
            raise ValueError("Missing flag and value disagree")
        if self.missing != (self.valid_cells == 0):
            raise ValueError("Missing data must agree with the valid cell count")
        if self.missing and any(v is not None for v in (self.raw_value, self.score, self.pulses)):
            raise ValueError("Missing data must not acquire a score or pulses")
        if not self.missing and any(v is None for v in (self.raw_value, self.score, self.pulses)):
            raise ValueError("Valid data requires raw value, score and pulses")
        return self


class DemoFrozenEvent(DemoModel):
    event_id: str
    canonical_index: int = Field(ge=0)
    scientific: DemoScientificEvent
    artistic_mood: str | None
    chord_name: str | None
    chord_midi: list[int] | None
    melody_midi: int | None
    bass_midi: int | None
    melody_note_count: int = Field(ge=0, le=4)
    delta_canonical_score: float | None
    variation_kind: Literal["spatial_contrast", "region_comparison"]
    texture_pcm: list[list[float]] = Field(default_factory=list)


class DemoSource(DemoModel):
    provider: str
    collection: str
    source_file: str
    source_url: str | None
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    timestamp_utc: str
    grid_shape: tuple[int, int]


class DemoAudioConfig(DemoModel):
    sample_rate: int = 22050
    seconds_per_bar: float = Field(default=0.9, ge=0.85)
    data_gain: float = 0.16
    music_gain: float = 0.7
    pulse_hz: float = 440
    missing_hz: float = 165
    pulse_seconds: float = 0.068
    pulse_single_offset: float = 0.48
    pulse_first_offset: float = 0.19
    pulse_last_offset: float = 0.67
    missing_offsets: tuple[float, float] = (0.29, 0.48)
    missing_seconds: float = 0.075
    attack_seconds: float = 0.012
    release_seconds: float = 0.04


class NotebookDemoContract(DemoModel):
    schema_version: Literal["breathe-notebook-demo-v1"] = "breathe-notebook-demo-v1"
    calibration_version: Literal["multi6-fixed-demo-v1-NOT-AQI"] = "multi6-fixed-demo-v1-NOT-AQI"
    mapping_version: Literal["six-aqc-data-carrier-plus-harmony-v1"] = "six-aqc-data-carrier-plus-harmony-v1"
    isMock: bool
    source: DemoSource
    audio: DemoAudioConfig = Field(default_factory=DemoAudioConfig)
    pollutants: dict[str, DemoPollutant]
    global_plans: dict[str, list[DemoFrozenEvent]]
    region_plans: dict[str, list[DemoFrozenEvent]]
    map_urls: dict[str, str]
    temporal_status: Literal["unavailable_single_verified_timestamp"] = "unavailable_single_verified_timestamp"
    aggregation: Literal["cos_lat_weighted_mean_half_open_grid_centres"] = "cos_lat_weighted_mean_half_open_grid_centres"
    mood_boundaries: tuple[float, float, float] = (0.25, 0.5, 0.75)
    mood_hysteresis: float = 0.035
