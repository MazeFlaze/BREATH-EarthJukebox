import type * as maplibregl from "maplibre-gl";
import { decodeRasterSample, getEditorialAccentRgb, type DecodedRaster } from "@/lib/geosCfRaster";
import { computeBounds, normalizeLon, pointInGeometry } from "@/lib/geoUtils";
import type {
  GeoBounds,
  GeoPoint,
  LayerDefinition,
  ScanScope,
  SonificationMapping,
} from "@/types/breathe";

export const SCAN_COLS = 96;
export const SCAN_ROWS = 16;
export const BASE_SWEEP_DURATION_SEC = 12;
export const RIPPLE_LIFE_SEC = 0.72;
export const MAX_RIPPLES = 72;

export interface ScanSampleCell {
  col: number;
  row: number;
  x: number;
  y: number;
  lat: number;
  lon: number;
  norm: number;
  value: number;
  rgb: [number, number, number];
  inScope: boolean;
  inSelection: boolean;
}

export interface ScanColumnSummary {
  col: number;
  x: number;
  centerLon: number;
  peakValue: number | null;
  meanValue: number | null;
  peakNorm: number;
}

export interface ScanFieldGrid {
  cols: number;
  rows: number;
  width: number;
  height: number;
  unit: string;
  short: string;
  columns: ScanSampleCell[][];
  summaries: ScanColumnSummary[];
  inScopeHitCount: number;
}

export interface ScanVoiceTrigger {
  row: number;
  norm: number;
  value: number;
  x: number;
  y: number;
  rgb: [number, number, number];
  isAccent: boolean;
}

export interface ScanHitRipple {
  id: number;
  x: number;
  y: number;
  rgb: [number, number, number];
  norm: number;
  isAccent: boolean;
  age: number;
  maxLife: number;
  baseRadius: number;
  maxRadius: number;
}

export function formatLonReadout(lon: number): string {
  const safe = normalizeLon(lon);
  const hemi = safe >= 0 ? "E" : "W";
  return `${Math.abs(safe).toFixed(1)}°${hemi}`;
}

function pointWithinBounds(lat: number, lon: number, bounds: GeoBounds): boolean {
  if (lat < bounds.south || lat > bounds.north) return false;
  if (bounds.west <= bounds.east) {
    return lon >= bounds.west && lon <= bounds.east;
  }
  return lon >= bounds.west || lon <= bounds.east;
}

/**
 * Samples the active visible 2D map viewport into a 96 x 16 lat/lon acoustic matrix synced to the
 * decoded NASA GEOS-CF v2 raster frame and optional territory/drawn polygon mask.
 */
export function buildScanFieldGrid(params: {
  map: maplibregl.Map;
  width: number;
  height: number;
  raster: DecodedRaster;
  layer: LayerDefinition;
  scope: ScanScope;
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  polygon?: GeoPoint[];
}): ScanFieldGrid {
  const { map, width, height, raster, layer, scope, boundaryGeometry, polygon } = params;
  const cols = SCAN_COLS;
  const rows = SCAN_ROWS;

  const regionTarget = boundaryGeometry ?? (polygon && polygon.length >= 3 ? polygon : null);
  const hasRegion = Boolean(regionTarget);
  const regionBounds =
    hasRegion && !boundaryGeometry && polygon && polygon.length >= 3 ? computeBounds(polygon) : null;

  const xPad = Math.max(8, width * 0.015);
  const yTop = Math.max(18, height * 0.08);
  const yBottom = Math.max(yTop + 20, height * 0.91);
  const usableW = Math.max(16, width - xPad * 2);
  const usableH = Math.max(16, yBottom - yTop);

  const columns: ScanSampleCell[][] = [];
  const summaries: ScanColumnSummary[] = [];
  let inScopeHitCount = 0;

  for (let col = 0; col < cols; col += 1) {
    const x = xPad + (col / (cols - 1)) * usableW;
    const colCells: ScanSampleCell[] = [];
    let peakValue: number | null = null;
    let peakNorm = 0;
    let sumValue = 0;
    let validCount = 0;

    let midLon = 0;
    try {
      midLon = normalizeLon(map.unproject([x, (yTop + yBottom) * 0.5]).lng);
    } catch {
      midLon = 0;
    }

    for (let row = 0; row < rows; row += 1) {
      // row 0 = bottom (South), row 15 = top (North) for ascending audio pitch mapping
      const fracBottom = row / (rows - 1);
      const y = yBottom - fracBottom * usableH;

      let lat = 0;
      let lon = midLon;
      let validProj = true;
      try {
        const lngLat = map.unproject([x, y]);
        lat = lngLat.lat;
        lon = normalizeLon(lngLat.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 84) {
          validProj = false;
        }
      } catch {
        validProj = false;
      }

      const decoded = validProj ? decodeRasterSample(raster, layer, lat, lon) : null;
      const norm = decoded ? decoded.norm : 0;
      const value = decoded ? decoded.value : layer.vmin;

      let inSelection = false;
      if (hasRegion && validProj) {
        if (!regionBounds || pointWithinBounds(lat, lon, regionBounds)) {
          inSelection = pointInGeometry(lat, lon, regionTarget);
        }
      }

      const inScope = scope === "region" ? inSelection : true;
      const rgb = getEditorialAccentRgb(norm);

      if (decoded && inScope) {
        validCount += 1;
        sumValue += value;
        if (peakValue === null || value > peakValue) peakValue = value;
        if (norm > peakNorm) peakNorm = norm;
        if (norm >= 0.2) inScopeHitCount += 1;
      }

      colCells.push({
        col,
        row,
        x,
        y,
        lat,
        lon,
        norm,
        value,
        rgb,
        inScope,
        inSelection,
      });
    }

    columns.push(colCells);
    summaries.push({
      col,
      x,
      centerLon: midLon,
      peakValue,
      meanValue: validCount > 0 ? sumValue / validCount : null,
      peakNorm,
    });
  }

  return {
    cols,
    rows,
    width,
    height,
    unit: layer.unit,
    short: layer.short,
    columns,
    summaries,
    inScopeHitCount,
  };
}

/**
 * Selects up to `maxVoices` salient vertical concentration peaks for a scan column, applying
 * density gating and onset detection so collisions sound rhythmic and harmonic rather than noisy.
 */
export function pickColumnVoices(
  colCells: ScanSampleCell[],
  prevColCells: ScanSampleCell[] | undefined,
  mapping: SonificationMapping,
  maxVoices = 4
): ScanVoiceTrigger[] {
  const gateThreshold = Math.max(0.14, 0.27 - mapping.density * 0.13);
  const scored: Array<{ cell: ScanSampleCell; score: number; isAccent: boolean }> = [];

  for (let i = 0; i < colCells.length; i += 1) {
    const cell = colCells[i];
    if (!cell.inScope || cell.norm < gateThreshold) continue;

    const belowNorm = i > 0 ? colCells[i - 1].norm : 0;
    const aboveNorm = i < colCells.length - 1 ? colCells[i + 1].norm : 0;
    const isLocalMax = cell.norm >= belowNorm && cell.norm >= aboveNorm;
    const prevNorm = prevColCells?.[i]?.norm ?? 0;
    const delta = cell.norm - prevNorm;
    const isAccent = cell.norm >= 0.56 || delta >= 0.14;

    const score =
      cell.norm + (isLocalMax ? 0.09 : 0) + (cell.inSelection ? 0.04 : 0) + (delta > 0.1 ? 0.03 : 0);
    scored.push({ cell, score, isAccent });
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);

  // Pick vertically spaced peaks first (avoid clustering all 4 voices into adjacent bins)
  const chosen: Array<{ cell: ScanSampleCell; isAccent: boolean }> = [];
  for (const item of scored) {
    if (chosen.length >= maxVoices) break;
    const tooClose = chosen.some((c) => Math.abs(c.cell.row - item.cell.row) <= 1);
    if (!tooClose || scored.length <= maxVoices) {
      chosen.push({ cell: item.cell, isAccent: item.isAccent });
    }
  }

  if (chosen.length < maxVoices) {
    for (const item of scored) {
      if (chosen.length >= maxVoices) break;
      if (!chosen.some((c) => c.cell.row === item.cell.row)) {
        chosen.push({ cell: item.cell, isAccent: item.isAccent });
      }
    }
  }

  return chosen
    .sort((a, b) => a.cell.row - b.cell.row)
    .map(({ cell, isAccent }) => ({
      row: cell.row,
      norm: cell.norm,
      value: cell.value,
      x: cell.x,
      y: cell.y,
      rgb: cell.rgb,
      isAccent,
    }));
}

export function advanceScanRipples(ripples: ScanHitRipple[], dtSec: number): ScanHitRipple[] {
  if (ripples.length === 0) return ripples;
  const next: ScanHitRipple[] = [];
  for (let i = 0; i < ripples.length; i += 1) {
    const r = ripples[i];
    const age = r.age + dtSec;
    if (age < r.maxLife) {
      next.push({ ...r, age });
    }
  }
  return next.length > MAX_RIPPLES ? next.slice(next.length - MAX_RIPPLES) : next;
}
