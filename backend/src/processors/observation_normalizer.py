from typing import Optional, Dict, Any
from pydantic import BaseModel


class NormalizationConfig(BaseModel):
    method: str = "fixed_reference_range"
    min: float
    max: float
    configVersion: str
    description: str


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


class ObservationNormalizer:
    """
    Handles normalization of scientific measurements into bounded [0.0, 1.0]
    audio control values for the sonification engine.
    """

    @classmethod
    def get_config(cls, variable: str) -> Optional[NormalizationConfig]:
        """Returns the reference range configuration for a given variable, if registered."""
        return REFERENCE_RANGES.get(variable)

    @classmethod
    def normalize(cls, variable: str, value: Optional[float]) -> Optional[float]:
        """
        Normalizes a physical measurement value into [0.0, 1.0] using fixed reference bounds.
        Returns None if value is None or if no approved reference range is configured.
        """
        if value is None:
            return None

        cfg = cls.get_config(variable)
        if not cfg:
            return None

        range_span = cfg.max - cfg.min
        if range_span <= 0:
            return 0.0

        clamped_val = max(cfg.min, min(cfg.max, value))
        normalized = (clamped_val - cfg.min) / range_span
        return round(float(normalized), 4)
