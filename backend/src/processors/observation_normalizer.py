import math
from typing import Any, Dict, Literal, Optional, Union
from pydantic import BaseModel, Field, model_validator


class NormalizationConfig(BaseModel):
    """Configuration for fixed-range linear acoustic normalization."""

    method: str = "fixed_reference_range"
    min: float
    max: float
    configVersion: str
    description: str


class CalibratedNormalizationConfig(BaseModel):
    """Configuration for EDA-calibrated perceptual (log1p or quantile-linear) normalization."""

    method: Literal["log_scale", "quantile_linear"]
    p01: float
    p50: float
    p99: float
    raw_unit: str
    display_unit: str
    configVersion: str
    description: str

    @model_validator(mode="after")
    def validate_quantiles(self) -> "CalibratedNormalizationConfig":
        if not (self.p01 <= self.p50 <= self.p99):
            raise ValueError(
                f"Quantiles must satisfy p01 <= p50 <= p99, got ({self.p01}, {self.p50}, {self.p99})."
            )
        if self.p99 <= self.p01:
            raise ValueError(f"p99 ({self.p99}) must be strictly greater than p01 ({self.p01}).")
        return self


class DisplayUnitConversion(BaseModel):
    """Traceable unit conversion payload retaining original native units alongside display units."""

    variable: str
    raw_value: Optional[float]
    raw_unit: str
    display_value: Optional[float]
    display_unit: str
    conversion_factor: float = Field(gt=0.0)


# Traceable mapping from native scientific units to human-readable display units
DISPLAY_UNIT_SPECS: Dict[str, Dict[str, Any]] = {
    "PM25_RH35": {"raw_unit": "ug m-3", "display_unit": "µg/m³", "factor": 1.0},
    "PM10_RH35": {"raw_unit": "ug m-3", "display_unit": "µg/m³", "factor": 1.0},
    "CO": {"raw_unit": "mol mol-1", "display_unit": "ppbv", "factor": 1.0e9},
    "NO2": {"raw_unit": "mol mol-1", "display_unit": "ppbv", "factor": 1.0e9},
    "O3": {"raw_unit": "mol mol-1", "display_unit": "ppbv", "factor": 1.0e9},
    "SO2": {"raw_unit": "mol mol-1", "display_unit": "ppbv", "factor": 1.0e9},
    "AOD": {"raw_unit": "dimensionless", "display_unit": "dimensionless", "factor": 1.0},
}


# Stable, scientifically motivated reference ranges for audio sonification mapping
# Values correspond to typical clean background (min) to severe pollution (max).
# Control values are clamped to [0.0, 1.0] for the audio synthesizer without altering raw values.
REFERENCE_RANGES: Dict[str, NormalizationConfig] = {
    "PM25_RH35": NormalizationConfig(
        method="fixed_reference_range",
        min=0.0,
        max=250.0,
        configVersion="1.0.0-who-air-quality",
        description="WHO/EPA air quality reference scale (0 to 250 µg/m³)"
    ),
    "PM10_RH35": NormalizationConfig(
        method="fixed_reference_range",
        min=0.0,
        max=500.0,
        configVersion="1.0.0-who-air-quality",
        description="Particulate Matter PM10 reference scale (0 to 500 µg/m³)"
    ),
    "CO": NormalizationConfig(
        method="fixed_reference_range",
        min=0.0,
        max=1.0e-6,  # 1 ppm = 1000 ppb = 1e-6 mol/mol
        configVersion="1.0.0-gmao-mole-fraction",
        description="Carbon Monoxide mole fraction (0 to 1 ppm / 1e-6 mol/mol)"
    ),
    "NO2": NormalizationConfig(
        method="fixed_reference_range",
        min=0.0,
        max=1.0e-7,  # 100 ppb = 1e-7 mol/mol
        configVersion="1.0.0-gmao-mole-fraction",
        description="Nitrogen Dioxide mole fraction (0 to 100 ppb / 1e-7 mol/mol)"
    ),
    "O3": NormalizationConfig(
        method="fixed_reference_range",
        min=0.0,
        max=1.0e-7,  # 100 ppb = 1e-7 mol/mol
        configVersion="1.0.0-gmao-mole-fraction",
        description="Ozone mole fraction (0 to 100 ppb / 1e-7 mol/mol)"
    ),
    "SO2": NormalizationConfig(
        method="fixed_reference_range",
        min=0.0,
        max=5.0e-8,  # 50 ppb = 5e-8 mol/mol
        configVersion="1.0.0-gmao-mole-fraction",
        description="Sulfur Dioxide mole fraction (0 to 50 ppb / 5e-8 mol/mol)"
    ),
}


# Empirical GEOS-CF v2 EDA-calibrated perceptual parameters (native units) from docs/EDA_REPORT_GEOS_CF.md Section 8A
CALIBRATED_RANGES: Dict[str, CalibratedNormalizationConfig] = {
    "PM25_RH35": CalibratedNormalizationConfig(
        method="log_scale",
        p01=4.03,
        p50=7.63,
        p99=71.05,
        raw_unit="ug m-3",
        display_unit="µg/m³",
        configVersion="2.0.0-geos-cf-eda-log1p",
        description="EDA-calibrated scale-invariant log1p PM2.5 [P01=4.03, P50=7.63, P99=71.05 ug m-3]",
    ),
    "CO": CalibratedNormalizationConfig(
        method="log_scale",
        p01=5.72e-8,
        p50=9.45e-8,
        p99=3.93e-7,
        raw_unit="mol mol-1",
        display_unit="ppbv",
        configVersion="2.0.0-geos-cf-eda-log1p",
        description="EDA-calibrated scale-invariant log1p CO [57.2 to 393.1 ppbv in mol mol-1]",
    ),
    "NO2": CalibratedNormalizationConfig(
        method="log_scale",
        p01=1.11e-10,
        p50=3.26e-10,
        p99=2.08e-8,
        raw_unit="mol mol-1",
        display_unit="ppbv",
        configVersion="2.0.0-geos-cf-eda-log1p",
        description="EDA-calibrated scale-invariant log1p NO2 [0.11 to 20.77 ppbv in mol mol-1]",
    ),
    "SO2": CalibratedNormalizationConfig(
        method="log_scale",
        p01=9.00e-11,
        p50=2.50e-10,
        p99=9.58e-9,
        raw_unit="mol mol-1",
        display_unit="ppbv",
        configVersion="2.0.0-geos-cf-eda-log1p",
        description="EDA-calibrated scale-invariant log1p SO2 [0.09 to 9.58 ppbv in mol mol-1]",
    ),
    "O3": CalibratedNormalizationConfig(
        method="quantile_linear",
        p01=1.95e-8,
        p50=3.26e-8,
        p99=4.26e-8,
        raw_unit="mol mol-1",
        display_unit="ppbv",
        configVersion="2.0.0-geos-cf-eda-quantile",
        description="EDA-calibrated symmetric quantile-linear O3 [19.54 to 42.62 ppbv in mol mol-1]",
    ),
}


class ObservationNormalizer:
    """
    Handles normalization of scientific measurements into bounded [0.0, 1.0]
    audio control values and traceable display unit conversion for the sonification engine.
    """

    DEFAULT_METHOD = "fixed_reference_range"
    SUPPORTED_METHODS = {"fixed_reference_range", "log_scale", "quantile_linear", "calibrated"}

    @classmethod
    def get_config(
        cls,
        variable: str,
        method: str = DEFAULT_METHOD,
    ) -> Optional[Union[NormalizationConfig, CalibratedNormalizationConfig]]:
        """
        Returns the normalization configuration for a given variable and method.
        Defaults to 'fixed_reference_range' for full backward compatibility.
        """
        if method not in cls.SUPPORTED_METHODS:
            raise ValueError(
                f"Unsupported normalization method '{method}'. Supported: {sorted(cls.SUPPORTED_METHODS)}"
            )

        if method == "fixed_reference_range":
            return REFERENCE_RANGES.get(variable)

        calibrated = CALIBRATED_RANGES.get(variable)
        if calibrated is not None:
            return calibrated
        # Safe fallback for variables not yet calibrated in EDA (e.g., PM10_RH35)
        return REFERENCE_RANGES.get(variable)

    @classmethod
    def _normalize_fixed_linear(cls, cfg: NormalizationConfig, value: float) -> float:
        range_span = cfg.max - cfg.min
        if range_span <= 0:
            return 0.0
        clamped_val = max(cfg.min, min(cfg.max, value))
        normalized = (clamped_val - cfg.min) / range_span
        return round(float(normalized), 4)

    @classmethod
    def _normalize_calibrated(
        cls,
        cfg: CalibratedNormalizationConfig,
        value: float,
        requested_method: str,
    ) -> float:
        epsilon = 1.0e-18
        span = cfg.p99 - cfg.p01
        if span <= 0.0:
            return 0.0

        # Honor explicit quantile_linear override or variable's calibrated quantile_linear (e.g. O3)
        use_linear_quantile = (
            requested_method == "quantile_linear"
            or (requested_method == "calibrated" and cfg.method == "quantile_linear")
            or (requested_method == "log_scale" and cfg.method == "quantile_linear")
        )
        if use_linear_quantile:
            clamped = max(cfg.p01, min(cfg.p99, value))
            return round(float((clamped - cfg.p01) / span), 4)

        # Scale-invariant Weber-Fechner log1p anchored at global median distance s = max(p50 - p01, eps)
        scale = max(cfg.p50 - cfg.p01, epsilon)
        denom = math.log1p(span / scale)
        if denom <= 0.0:
            return 0.0
        positive_diff = max(0.0, value - cfg.p01)
        normalized = math.log1p(positive_diff / scale) / denom
        return round(float(min(1.0, max(0.0, normalized))), 4)

    @classmethod
    def normalize(
        cls,
        variable: str,
        value: Optional[float],
        method: str = DEFAULT_METHOD,
        log_scale: bool = False,
    ) -> Optional[float]:
        """
        Normalizes a physical measurement value into [0.0, 1.0].
        Defaults to fixed_reference_range unless log_scale=True or method='log_scale'/'calibrated'/'quantile_linear'.
        Returns None if value is None, non-finite, or if no reference config exists.
        """
        if value is None:
            return None
        try:
            numeric_val = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(numeric_val):
            return None

        effective_method = "log_scale" if (log_scale and method == cls.DEFAULT_METHOD) else method
        cfg = cls.get_config(variable, method=effective_method)
        if cfg is None:
            return None

        if isinstance(cfg, CalibratedNormalizationConfig):
            return cls._normalize_calibrated(cfg, numeric_val, requested_method=effective_method)
        return cls._normalize_fixed_linear(cfg, numeric_val)

    @classmethod
    def to_display_unit(
        cls,
        variable: str,
        value: Optional[float],
        raw_unit: Optional[str] = None,
    ) -> DisplayUnitConversion:
        """
        Converts mole-fraction trace gases (mol mol-1) into human-readable ppbv (x1e9)
        while preserving original units and values for particulate matter or dimensionless AOD.
        """
        spec = DISPLAY_UNIT_SPECS.get(variable)
        resolved_raw_unit = raw_unit or (spec["raw_unit"] if spec else "unknown")
        normalized_raw = resolved_raw_unit.strip().lower()

        if normalized_raw in {"mol mol-1", "mol/mol"}:
            display_unit = "ppbv"
            factor = 1.0e9
        elif spec is not None and raw_unit is None:
            display_unit = spec["display_unit"]
            factor = float(spec["factor"])
        elif normalized_raw in {"ug m-3", "µg/m³", "ug/m3"}:
            display_unit = "µg/m³"
            factor = 1.0
        else:
            display_unit = resolved_raw_unit
            factor = 1.0

        clean_raw: Optional[float] = None
        display_val: Optional[float] = None
        if value is not None:
            try:
                numeric_val = float(value)
            except (TypeError, ValueError):
                numeric_val = float("nan")
            if math.isfinite(numeric_val):
                clean_raw = numeric_val
                scaled = numeric_val * factor
                display_val = round(scaled, 8) if factor != 1.0 else scaled

        return DisplayUnitConversion(
            variable=variable,
            raw_value=clean_raw,
            raw_unit=resolved_raw_unit,
            display_value=display_val,
            display_unit=display_unit,
            conversion_factor=factor,
        )
