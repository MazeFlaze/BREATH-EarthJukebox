"""Catalog records are separate from baseline A and never imply fabricated timestamps."""
from typing import Literal
from pydantic import Field
from .notebook_demo_schema import DemoModel, NotebookDemoContract


class FocusFeature(DemoModel):
    cell_id: str
    p90: float | None
    iqr: float | None
    spread_score: float = Field(ge=0, le=1)
    neighbor_contrast: float = Field(ge=0, le=1)
    coverage: float = Field(ge=0, le=1)


class CatalogSnapshot(DemoModel):
    schema_version: Literal["geos-cf-catalog-snapshot-v1"] = "geos-cf-catalog-snapshot-v1"
    focus_mapping_version: Literal["focus-artistic-log99-v1"] = "focus-artistic-log99-v1"
    baseline: NotebookDemoContract
    features: dict[str, dict[str, FocusFeature]]


class CatalogEntry(DemoModel):
    id: str
    filename: str
    timestamp_utc: str | None = None
    sha256: str | None = None
    size_bytes: int = 0
    status: Literal["ready", "duplicate", "unverified", "invalid", "missing", "conflict"]
    provenance: Literal["download_receipt", "notebook_reference", "unverified"] = "unverified"
    reason: str | None = None
    variables: list[str] = Field(default_factory=list)
    grid_shape: list[int] = Field(default_factory=list)
    snapshot_url: str | None = None
    detail_url: str | None = None
    source_url: str | None = None


class CatalogGap(DemoModel):
    after: str
    before: str
    missing_hours: int = Field(gt=0)


class GeosCfCatalog(DemoModel):
    schema_version: Literal["geos-cf-local-catalog-v1"] = "geos-cf-local-catalog-v1"
    generated_at: str
    entries: list[CatalogEntry]
    gaps: list[CatalogGap] = Field(default_factory=list)
    ready_count: int
    download_policy: Literal["manual_only"] = "manual_only"
