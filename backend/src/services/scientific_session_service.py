"""Bounded, local-only session planning; no changes to existing region API semantics."""
import base64
import hashlib
import json
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from fastapi import HTTPException

from ..api.schemas.geos_cf_catalog_schema import CatalogEntry
from ..api.schemas.scientific_session_schema import EncodedArray, FrameRequest, FrameView, SessionPlan, SessionRequest, SessionSlot
from ..processors.scientific_session_processor import FEATURES, context_plan, join_views, prepare_view
from .scientific_catalog_service import ScientificCatalog

__all__ = ["ScientificSessionService", "scientific_sessions"]


def encode(array: np.ndarray) -> EncodedArray:
    dtype = "int32-le" if array.dtype.kind == "i" else "uint32-le" if array.dtype.kind == "u" else "float64-le" if array.dtype.itemsize == 8 else "float32-le"
    numpy_type = {"int32-le": "<i4", "uint32-le": "<u4", "float64-le": "<f8", "float32-le": "<f4"}[dtype]
    data = np.ascontiguousarray(array, dtype=numpy_type)
    return EncodedArray(dtype=dtype, length=data.size, data=base64.b64encode(data.tobytes()).decode("ascii"))


class ScientificSessionService:
    def __init__(self, catalog: ScientificCatalog | None = None):
        self.catalog = catalog or ScientificCatalog()
        self._cache: OrderedDict[str, tuple[float, SessionPlan, list[CatalogEntry]]] = OrderedDict()
        self._lock = threading.Lock()
        self._planning = threading.BoundedSemaphore(1)

    def _views(self, entry: CatalogEntry, request: SessionRequest) -> tuple[Any, list[dict[str, Any]]]:
        manifest, values = self.catalog.field(entry, request.pollutant)
        maximum = manifest.fields[request.pollutant].audio_max
        bounds = [None] if request.scope == "global" else request.regions
        return manifest, [prepare_view(values, request, maximum, region) for region in bounds]

    def create(self, request: SessionRequest) -> SessionPlan:
        if not self._planning.acquire(blocking=False):
            raise HTTPException(429, "Another scientific plan is being prepared; retry after it finishes", headers={"Retry-After": "5"})
        try:
            return self._build(request)
        finally:
            self._planning.release()

    def _build(self, request: SessionRequest) -> SessionPlan:
        entries = sorted([e for e in self.catalog.read().entries if e.status == "ready" and e.timestamp_utc
                          and request.start <= e.timestamp_utc <= request.end], key=lambda e: e.timestamp_utc or "")
        if not entries:
            raise HTTPException(404, "No verified snapshots in the selected UTC range")
        digest = hashlib.sha256(json.dumps({"version": "breathe-session-plan-v1", "selection": request.model_dump(),
                                            "sources": [e.model_dump() for e in entries]}, sort_keys=True).encode()).hexdigest()
        # Re-verify sources when rebuilding, rather than assuming mutable artifact files are still valid.
        first_manifest, views = self._views(entries[0], request)
        template = join_views(views)
        hours = int((datetime.fromisoformat(request.end.replace("Z", "+00:00")) - datetime.fromisoformat(request.start.replace("Z", "+00:00"))).total_seconds() / 3600) + 1
        if template["steps"] * template["lanes"] * hours > 1_200_000:
            raise HTTPException(413, "Session feature budget exceeded; shorten UTC range or reduce bands/resolution")
        pieces, slots = [], []
        lookup = {e.timestamp_utc: e for e in entries}
        start = datetime.fromisoformat(request.start.replace("Z", "+00:00"))
        offset = 0
        field = first_manifest.fields[request.pollutant]
        for hour in range(hours):
            timestamp = (start + timedelta(hours=hour)).strftime("%Y-%m-%dT%H:%M:%SZ")
            entry = lookup.get(timestamp)
            if entry:
                manifest, selected = (first_manifest, views) if entry.id == entries[0].id else self._views(entry, request)
                meta = manifest.fields[request.pollutant]
                if (manifest.calibration_version, meta.unit, meta.audio_max) != (first_manifest.calibration_version, field.unit, field.audio_max):
                    raise HTTPException(409, "Calibration or display unit changes inside selected range")
                piece = join_views(selected)
                if (piece["steps"], piece["lanes"]) != (template["steps"], template["lanes"]):
                    raise HTTPException(409, "Native geometry changes inside selected range")
            else:
                piece = {**template, **{key: np.full_like(template[key], np.nan if key in ("mean", "p90") else 0) for key in FEATURES},
                         "spatialGradient": np.zeros_like(template["mean"]), "spatialCurvature": np.zeros_like(template["mean"])}
            pieces.append(piece)
            slots.append(SessionSlot(timestamp=timestamp, source_sha256=entry.id if entry else None, missing=entry is None, first=offset, end=offset + piece["steps"]))
            offset += piece["steps"]
        frames = {**template, **{key: np.concatenate([p[key] for p in pieces]) for key in (*FEATURES, "spatialGradient", "spatialCurvature", "stepPositions")},
                  "steps": offset, "featureDomain": "temporal" if request.traversal == "time" else "spatial"}
        if request.traversal == "time":
            frames["coordinates"] = np.asarray([datetime.fromisoformat(s.timestamp.replace("Z", "+00:00")).timestamp() / 3600 for s in slots], dtype="<f8")
        if request.traversal == "series":
            frames["segmentStarts"] = [s.first for s in slots]
        arrangement = context_plan(frames, request.duration)
        identity = hashlib.sha256(digest.encode())
        for key, value in sorted(frames.items()):
            if isinstance(value, np.ndarray):
                identity.update(key.encode()); identity.update(value.tobytes())
        identity.update(first_manifest.calibration_version.encode())
        digest = identity.hexdigest()
        plan = SessionPlan(id=digest, selection=request, unit=field.unit, audio_max=field.audio_max, calibration_version=first_manifest.calibration_version,
                           steps=offset, lanes=template["lanes"], lane_counts=[v["frames"]["lanes"] for v in views], slots=slots,
                           arrays={key: encode(value) for key, value in frames.items() if isinstance(value, np.ndarray)}, arrangement=arrangement,
                           sources=[{"timestamp": e.timestamp_utc or "", "sha256": e.id, "source_url": e.source_url or ""} for e in entries],
                           warnings=["Artistic mapping, not AQI or a health threshold", "Cosine-latitude mean; unweighted native quantiles",
                                     "No concentration interpolation or inferred winds", "Source-bound stateless frame delivery; no synthetic fallback"])
        with self._lock:
            self._cache[digest] = (time.monotonic(), plan, entries)
            self._cache.move_to_end(digest)
            # Keep at most two plans and roughly 32 MiB of encoded arrays; never retain native grids.
            while len(self._cache) > 2 or len(self._cache) > 1 and sum(sum(len(a.data) for a in item[1].arrays.values()) for item in self._cache.values()) > 32 * 1024 * 1024:
                self._cache.popitem(last=False)
        return plan

    def view(self, plan_id: str, slot_index: int) -> FrameView:
        with self._lock:
            item = self._cache.get(plan_id)
        if not item or time.monotonic() - item[0] > 1800:
            raise HTTPException(410, "Scientific plan expired; prepare the selection again")
        _, plan, entries = item
        if slot_index < 0 or slot_index >= len(plan.slots):
            raise HTTPException(404, "Timestamp slot not found")
        slot = plan.slots[slot_index]
        if slot.missing:
            return FrameView(timestamp=slot.timestamp, source_sha256=None, missing=True, views=[])
        entry = next(e for e in entries if e.id == slot.source_sha256)
        manifest, views = self._views(entry, plan.selection)
        field = manifest.fields[plan.selection.pollutant]
        if (manifest.calibration_version, field.unit, field.audio_max) != (plan.calibration_version, plan.unit, plan.audio_max):
            raise HTTPException(409, "Frame no longer matches prepared calibration")
        return FrameView(timestamp=slot.timestamp, source_sha256=slot.source_sha256, missing=False,
                         views=[{**{key: v[key] for key in ("rows", "cols", "rowBins", "colBins", "laneBins")},
                                 "arrays": {key: encode(v[key]) for key in ("grid", "validCounts", "totals")}} for v in views])


    def frame(self, request: FrameRequest) -> FrameView:
        """Stateless playback path works across restarts and different workers.

        Missing slots stay missing even if a later export fills that hour.
        Changed sources fail explicitly; nearest-time substitution is forbidden.
        """
        if request.source_sha256 is None:
            return FrameView(timestamp=request.timestamp, source_sha256=None, missing=True, views=[])
        entry = next((e for e in self.catalog.read().entries if e.status == "ready"
                      and e.id == request.source_sha256 and e.timestamp_utc == request.timestamp), None)
        if entry is None:
            raise HTTPException(409, "Prepared source is no longer in the verified catalog; re-prepare explicitly")
        manifest, views = self._views(entry, request.selection)
        field = manifest.fields[request.selection.pollutant]
        if (manifest.calibration_version, field.unit, field.audio_max) != (request.calibration_version, request.unit, request.audio_max):
            raise HTTPException(409, "Frame calibration differs from the immutable scientific plan")
        return FrameView(timestamp=request.timestamp, source_sha256=entry.id, missing=False,
                         views=[{**{key: v[key] for key in ("rows", "cols", "rowBins", "colBins", "laneBins")},
                                 "arrays": {key: encode(v[key]) for key in ("grid", "validCounts", "totals")}} for v in views])


scientific_sessions = ScientificSessionService()
