from typing import Any, Dict, Optional, Tuple
from fastapi import HTTPException

from ..api.schemas.jukebox_schema import (
    NormalizationMeta,
    ProvenanceMeta,
)
from ..processors.observation_normalizer import (
    CalibratedNormalizationConfig,
    ObservationNormalizer,
)
from ..providers.geos_cf import GEOSCFProvider

SUPPORTED_TEMPORAL_INTERVALS: Dict[str, str] = {
    "1h": "1h",
    "2h": "2h",
    "3h": "3h",
    "6h": "6h",
    "12h": "12h",
    "24h": "24h",
}


def validate_dataset_and_variable(
    provider: GEOSCFProvider,
    dataset_id: str,
    variable: str,
) -> Dict[str, Any]:
    """Validates dataset ID and atmospheric variable against the active provider catalog."""
    if dataset_id != provider.DATASET_ID:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{dataset_id}' not supported. Available: ['{provider.DATASET_ID}']",
        )
    variables_catalog = provider.list_variables()
    if variable not in variables_catalog:
        raise HTTPException(
            status_code=400,
            detail=f"Variable '{variable}' not found. Supported variables: {list(variables_catalog.keys())}",
        )
    return variables_catalog[variable]


def build_normalization_meta(variable: str, method: str) -> Optional[NormalizationMeta]:
    """Builds NormalizationMeta from either fixed reference ranges or EDA-calibrated curves."""
    try:
        cfg = ObservationNormalizer.get_config(variable, method=method)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    if cfg is None:
        return None

    display_spec = ObservationNormalizer.to_display_unit(variable, None)
    if isinstance(cfg, CalibratedNormalizationConfig):
        effective_method = (
            "quantile_linear"
            if (method == "quantile_linear" or cfg.method == "quantile_linear")
            else "log_scale"
        )
        return NormalizationMeta(
            method=effective_method,
            min=cfg.p01,
            max=cfg.p99,
            configVersion=cfg.configVersion,
            p01=cfg.p01,
            p50=cfg.p50,
            p99=cfg.p99,
            displayUnit=cfg.display_unit,
        )

    return NormalizationMeta(
        method=cfg.method,
        min=cfg.min,
        max=cfg.max,
        configVersion=cfg.configVersion,
        displayUnit=display_spec.display_unit,
    )


def build_provenance_meta(provider: GEOSCFProvider) -> ProvenanceMeta:
    """Constructs standardized scientific provenance metadata from provider settings."""
    meta = provider.get_source_metadata()
    return ProvenanceMeta(
        provider=meta["provider"],
        sourceUrl=meta["sourceUrl"],
        productVersion=meta["productVersion"],
        spatialResolution=meta.get("spatialResolution"),
        temporalResolution=meta.get("temporalResolution"),
    )


def normalize_and_convert(
    variable: str,
    value: Optional[float],
    method: str,
    raw_unit: Optional[str] = None,
) -> Tuple[Optional[float], Optional[float], str]:
    """Computes normalized audio control [0, 1] and traceable display unit value."""
    norm_val = ObservationNormalizer.normalize(variable, value, method=method)
    conv = ObservationNormalizer.to_display_unit(variable, value, raw_unit=raw_unit)
    return norm_val, conv.display_value, conv.display_unit
