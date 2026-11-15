"""NumPy counterpart of the verified native-band demo, with unchanged calibration.

Mean uses cos(latitude); quantiles use native valid samples, not grid means.
Float32 feature boundaries intentionally match the browser research engine.
"""
import math
from typing import Any

import numpy as np

from ..api.schemas.scientific_session_schema import SessionBounds, SessionRequest

__all__ = ["prepare_view", "join_views", "context_plan", "FEATURES"]
FEATURES = ("mean", "p90", "spread", "coverage", "contrast")


def _crop(bounds: SessionBounds | None, rows: int, cols: int) -> tuple[int, int, int, int]:
    if bounds is None:
        return 0, rows, 0, cols
    def clamp(n: int, limit: int) -> int:
        return max(0, min(limit, n))
    r0 = clamp(0 if bounds.north == 90 else math.floor((90 - bounds.north) * 4 + 1e-8) + 1, rows - 1)
    r1 = clamp(math.floor((90 - bounds.south) * 4 + 1e-8) + 1, rows)
    c0 = clamp(math.ceil((bounds.west + 180) * 4 - 1e-8), cols - 1)
    c1 = clamp(math.ceil((bounds.east + 180) * 4 - 1e-8), cols)
    if r1 <= r0:
        r0 = clamp(math.floor((90 - (bounds.north + bounds.south) / 2) * 4 + .5), rows - 1)
        r1 = r0 + 1
    if c1 <= c0:
        c0 = clamp(math.floor(((bounds.west + bounds.east) / 2 + 180) * 4 + .5), cols - 1)
        c1 = c0 + 1
    return r0, r1, c0, c1


def _bins(start: int, end: int, stride: int, latitude: bool) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for i in range(start, end):
        key = i if stride == 1 else max(0, math.ceil(i / stride) - 1) if latitude else i // stride
        if not result or result[-1]["key"] != key:
            result.append({"key": key, "start": i, "end": i + 1})
        else:
            result[-1]["end"] = i + 1
    for b in result:
        b["low"] = max(-90, 90 - (b["end"] - 1) * .25 - .125) if latitude else max(-180, -180 + b["start"] * .25 - .125)
        b["high"] = min(90, 90 - b["start"] * .25 + .125) if latitude else min(180, -180 + (b["end"] - 1) * .25 + .125)
    return result


def prepare_view(values: np.ndarray, request: SessionRequest, maximum: float,
                 bounds: SessionBounds | None) -> dict[str, Any]:
    r0, r1, c0, c1 = _crop(bounds, *values.shape)
    stride = 1 if request.resolution == "native" else round(float(request.resolution) * 4)
    rb, cb = _bins(r0, r1, stride, True), _bins(c0, c1, stride, False)
    rows, cols = len(rb), len(cb)
    weights = np.maximum(0, np.cos(np.deg2rad(90 - np.arange(values.shape[0]) * .25)))
    grid = np.full((rows, cols), np.nan, dtype="<f4")
    counts = np.zeros((rows, cols), dtype="<u4")
    totals = np.zeros((rows, cols), dtype="<u4")

    def sample(r: dict, c: dict) -> tuple[np.ndarray, float, int]:
        field = values[r["start"]:r["end"], c["start"]:c["end"]]
        valid = np.isfinite(field) & (field >= 0)
        distribution = field[valid].astype(np.float64)
        w = np.broadcast_to(weights[r["start"]:r["end"], None], field.shape)[valid]
        denominator = w.sum()
        mean = float(np.dot(distribution, w) / denominator) if denominator > 0 else math.nan
        return distribution, mean, field.size

    if stride == 1:
        grid[:] = values[r0:r1, c0:c1]
        counts[:] = np.isfinite(grid) & (grid >= 0)
        grid[counts == 0] = np.nan
        totals.fill(1)
    else:
        for row, r in enumerate(rb):
            for col, c in enumerate(cb):
                distribution, mean, total = sample(r, c)
                grid[row, col], counts[row, col], totals[row, col] = mean, distribution.size, total
    horizontal = request.axis == "horizontal"
    temporal = request.traversal == "time"
    steps = 1 if temporal else cols if horizontal else rows
    perpendicular = rows if horizontal else cols
    lanes = min(request.bands, perpendicular)
    lane_bins = [{"start": i * perpendicular // lanes, "end": (i + 1) * perpendicular // lanes} for i in range(lanes)]
    features = {key: np.zeros((steps, lanes), dtype="<f4") for key in FEATURES}
    # Native spatial scans contain many short distributions. Batch-sort each band's
    # original samples once instead of invoking a Python quantile loop per cell.
    if stride == 1 and not temporal:
        for lane, group in enumerate(lane_bins):
            if horizontal:
                block = values[r0 + group["start"]:r0 + group["end"], c0:c1].T.astype(np.float64)
                w = weights[r0 + group["start"]:r0 + group["end"]][None, :]
            else:
                block = values[r0:r1, c0 + group["start"]:c0 + group["end"]].astype(np.float64)
                w = weights[r0:r1, None]
            valid = np.isfinite(block) & (block >= 0)
            count = valid.sum(axis=1)
            denominator = (valid * w).sum(axis=1)
            mean = np.full(steps, np.nan)
            np.divide((np.where(valid, block, 0) * w).sum(axis=1), denominator, out=mean, where=denominator > 0)
            ordered = np.sort(np.where(valid, block, np.inf), axis=1)
            quantiles = []
            nonempty = np.flatnonzero(count)
            for probability in (.25, .75, .9):
                quantile = np.full(steps, np.nan)
                position = (count[nonempty] - 1) * probability
                lower = np.floor(position).astype(int)
                fraction = position - lower
                quantile[nonempty] = ordered[nonempty, lower] * (1 - fraction) + ordered[nonempty, np.ceil(position).astype(int)] * fraction
                quantiles.append(quantile)
            features["mean"][:, lane] = mean
            features["p90"][:, lane] = quantiles[2]
            features["spread"][:, lane] = np.where(count > 0, (quantiles[1] - quantiles[0]) / maximum, 0)
            features["coverage"][:, lane] = count / block.shape[1]
    for step in range(0 if stride == 1 and not temporal else steps):
        for lane, group in enumerate(lane_bins):
            r = ({"start": rb[group["start"]]["start"], "end": rb[group["end"] - 1]["end"]} if horizontal
                 else {"start": r0, "end": r1} if temporal else rb[step])
            c = (({"start": c0, "end": c1} if temporal else cb[step]) if horizontal
                 else {"start": cb[group["start"]]["start"], "end": cb[group["end"] - 1]["end"]})
            distribution, mean, total = sample(r, c)
            features["mean"][step, lane] = mean
            features["p90"][step, lane] = np.quantile(distribution, .9) if distribution.size else np.nan
            features["spread"][step, lane] = float(np.quantile(distribution, .75) - np.quantile(distribution, .25)) / maximum if distribution.size else 0
            features["coverage"][step, lane] = distribution.size / total
    for step in range(steps):
        for lane in range(lanes):
            neighbors = [float(features["mean"][other, lane]) for other in (step - 1, step + 1)
                         if 0 <= other < steps and np.isfinite(features["mean"][other, lane])]
            value = float(features["mean"][step, lane])
            if neighbors and math.isfinite(value):
                features["contrast"][step, lane] = min(1, abs(value - sum(neighbors) / len(neighbors)) / maximum)
    perpendicular_bins = rb if horizontal else cb
    positions = np.asarray([((perpendicular_bins[g["start"]]["high"] + perpendicular_bins[g["end"] - 1]["low"]) / 2 + 90) / 180 if horizontal
                            else ((perpendicular_bins[g["start"]]["low"] + perpendicular_bins[g["end"] - 1]["high"]) / 2 + 180) / 360 for g in lane_bins], dtype="<f4")
    step_positions = np.asarray([.5] if temporal else [((b["low"] + b["high"]) / 2 + (180 if horizontal else 90)) / (360 if horizontal else 180) for b in (cb if horizontal else rb)], dtype="<f4")
    frames = {**features, "positions": positions, "stepPositions": step_positions, "steps": steps, "lanes": lanes,
              "audioMax": maximum, "axis": request.axis}
    return {"rows": rows, "cols": cols, "rowBins": rb, "colBins": cb, "laneBins": lane_bins,
            "grid": grid, "validCounts": counts, "totals": totals, "frames": frames}


def _clip(value: float) -> float:
    return max(0., min(1., value)) if math.isfinite(value) else 0.


def _derivatives(frames: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    mean = frames["mean"]
    gradient, curvature = np.zeros_like(mean), np.zeros_like(mean)
    temporal = frames.get("featureDomain") == "temporal"
    degrees = 360 if frames["axis"] == "horizontal" else 180
    positions = frames.get("coordinates") if temporal else frames["stepPositions"].astype(np.float64) * degrees
    boundaries = set(frames.get("segmentStarts", []))
    for step in range(frames["steps"]):
        for lane in range(frames["lanes"]):
            value = float(mean[step, lane])
            if not math.isfinite(value):
                continue
            before = step > 0 and step not in boundaries and np.isfinite(mean[step - 1, lane])
            after = step + 1 < frames["steps"] and step + 1 not in boundaries and np.isfinite(mean[step + 1, lane])
            dl = abs(float(positions[step] - positions[step - 1])) if before else 0
            dr = abs(float(positions[step + 1] - positions[step])) if after else 0
            fallback = 1 if temporal else degrees / max(1, frames["steps"])
            dl = dl if dl > 0 else fallback if before else 0
            dr = dr if dr > 0 else fallback if after else 0
            left = (value - float(mean[step - 1, lane])) / dl / frames["audioMax"] if before else 0
            right = (float(mean[step + 1, lane]) - value) / dr / frames["audioMax"] if after else 0
            gradient[step, lane] = _clip(abs((left * dl + right * dr) / (dl + dr) if before and after else left if before else right) / .02)
            curvature[step, lane] = _clip(abs(2 * (right - left) / (dl + dr)) / .01) if before and after else 0
    return gradient, curvature


def join_views(views: list[dict[str, Any]]) -> dict[str, Any]:
    steps = max(v["frames"]["steps"] for v in views)
    prepared, gradients, curvatures = [], [], []
    for view in views:
        f = view["frames"]
        indices = np.minimum(f["steps"] - 1, np.arange(steps) * f["steps"] // steps)
        prepared.append({k: f[k][indices] for k in FEATURES})
        g, c = _derivatives(f)
        gradients.append(g[indices]); curvatures.append(c[indices])
    first = views[0]["frames"]
    return {**first, **{key: np.concatenate([p[key] for p in prepared], axis=1) for key in FEATURES},
            "steps": steps, "lanes": sum(v["frames"]["lanes"] for v in views),
            "positions": np.concatenate([v["frames"]["positions"] for v in views]),
            "lanePanPositions": first["positions"] if len(views) == 1 else np.concatenate([np.full(v["frames"]["lanes"], .15 if i == 0 else .85, dtype="<f4") for i, v in enumerate(views)]),
            "stepPositions": first["stepPositions"] if len(views) == 1 else np.full(steps, .5, dtype="<f4"),
            "spatialGradient": np.concatenate(gradients, axis=1), "spatialCurvature": np.concatenate(curvatures, axis=1)}


def context_plan(frames: dict[str, Any], duration: int) -> dict[str, Any]:
    temporal = frames.get("featureDomain") == "temporal"
    gradient, curvature = _derivatives(frames) if temporal else (frames["spatialGradient"], frames["spatialCurvature"])
    steps, lanes, maximum = frames["steps"], frames["lanes"], frames["audioMax"]
    window_steps = max(1, math.floor(.8 * steps / duration))
    windows, start = [], 0
    step_windows = np.zeros(steps, dtype="<i4")
    while start < steps:
        end = min([steps, start + window_steps] + [b for b in frames.get("segmentStarts", []) if start < b < start + window_steps])
        voices = []
        for lane in range(lanes):
            valid = np.isfinite(frames["mean"][start:end, lane])
            mean = frames["mean"][start:end, lane][valid].astype(np.float64)
            p90 = np.nan_to_num(frames["p90"][start:end, lane][valid].astype(np.float64), nan=0)
            peak = max(0., float(p90.max())) if p90.size else 0.
            note_index = math.floor(math.sqrt(_clip(peak / maximum)) * 10 + .5)
            voices.append({"lane": lane, "valid": bool(mean.size), "mean": float(mean.mean()) if mean.size else None,
                           "p90": peak, "excess": _clip(float(((p90 - mean) / maximum).max())) if mean.size else 0.,
                           "spread": _clip(float(frames["spread"][start:end, lane][valid].max())) if mean.size else 0.,
                           "edge": max([.7 * float(gradient[s, lane]) + .3 * float(curvature[s, lane]) for s in range(start, end) if np.isfinite(frames["mean"][s, lane])] or [0.]),
                           "note": 48 + note_index // 5 * 12 + [0, 2, 4, 7, 9][note_index % 5]})
        step_windows[start:end] = len(windows)
        windows.append({"startStep": start, "endStep": end, "voices": voices})
        start = end
    frames.update(contextGradient=gradient, contextCurvature=curvature, stepWindows=step_windows)
    return {"version": "context-temporal-hourly-pentatonic-v1" if temporal else "context-spatial-pentatonic-v1",
            "windowSteps": window_steps, "windows": windows}
