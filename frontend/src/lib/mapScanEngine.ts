import type * as maplibregl from "maplibre-gl";
import { decodeRasterSample, getEditorialAccentRgb, type DecodedRaster } from "./geosCfRaster";
import { computeBounds, normalizeLon, pointInGeometry } from "./geoUtils";
import type {
  GeoBounds,
  GeoPoint,
  LayerDefinition,
  ScanScope,
  SonificationMapping,
} from "../types/breathe";

export const SCAN_COLS = 96;
export const SCAN_ROWS = 16;
export const BASE_SWEEP_DURATION_SEC = 12;
export const RIPPLE_LIFE_SEC = 0.72;
export const MAX_RIPPLES = 72;

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface ColumnRaySegment {
  yTop: number;
  yBottom: number;
}

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
  scope: ScanScope;
  pixelBounds?: PixelBounds;
  polygonRingsPixels?: PixelPoint[][];
  columnSegments?: ColumnRaySegment[][];
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

export function extractGeoRings(
  geometryOrPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoPoint[]
): Array<Array<[number, number]>> {
  if (Array.isArray(geometryOrPolygon)) {
    return [geometryOrPolygon.map((p) => [p.lon, p.lat] as [number, number])];
  }
  if (geometryOrPolygon.type === "Polygon") {
    return geometryOrPolygon.coordinates as Array<Array<[number, number]>>;
  }
  if (geometryOrPolygon.type === "MultiPolygon") {
    const rings: Array<Array<[number, number]>> = [];
    for (const poly of geometryOrPolygon.coordinates) {
      for (const ring of poly) {
        rings.push(ring as Array<[number, number]>);
      }
    }
    return rings;
  }
  return [];
}

export function computePolygonRingsPixels(
  map: maplibregl.Map,
  geometryOrPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoPoint[]
): PixelPoint[][] {
  const geoRings = extractGeoRings(geometryOrPolygon);
  const pixelRings: PixelPoint[][] = [];

  for (const ring of geoRings) {
    if (ring.length < 3) continue;
    const projected: PixelPoint[] = [];
    for (const [lon, lat] of ring) {
      try {
        const p = map.project([lon, lat]);
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          projected.push({ x: p.x, y: p.y });
        }
      } catch {
        // Ignore unprojectable coordinates
      }
    }
    if (projected.length >= 3) {
      pixelRings.push(projected);
    }
  }

  return pixelRings;
}

export function computePixelBounds(rings: PixelPoint[][]): PixelBounds | null {
  if (!rings.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const ring of rings) {
    for (const pt of ring) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX >= maxX) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: Math.max(1, maxY - minY),
  };
}

export function computeRaySegmentsForX(
  rings: PixelPoint[][],
  x: number
): ColumnRaySegment[] {
  const yIntersections: number[] = [];

  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;

    for (let i = 0; i < n; i += 1) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % n];

      // Jordan curve non-zero crossing convention for vertical ray at x:
      // Half-open interval on x guarantees vertices are never double-counted.
      if ((p1.x <= x && p2.x > x) || (p2.x <= x && p1.x > x)) {
        const t = (x - p1.x) / (p2.x - p1.x);
        const y = p1.y + t * (p2.y - p1.y);
        yIntersections.push(y);
      }
    }
  }

  if (yIntersections.length < 2) return [];

  yIntersections.sort((a, b) => a - b);

  // Deduplicate very close intersections (within 0.75px)
  const cleaned: number[] = [];
  for (let i = 0; i < yIntersections.length; i += 1) {
    if (cleaned.length === 0 || yIntersections[i] - cleaned[cleaned.length - 1] > 0.75) {
      cleaned.push(yIntersections[i]);
    }
  }

  const segments: ColumnRaySegment[] = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    const top = cleaned[i];
    const bottom = cleaned[i + 1];
    if (bottom - top >= 0.5) {
      segments.push({ yTop: top, yBottom: bottom });
    }
  }

  return segments;
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
 * When scope === "region", restricts the sweep and sampling grid strictly inside the polygon's pixel bounds.
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

  let polygonRingsPixels: PixelPoint[][] | undefined;
  let pixelBounds: PixelBounds | undefined;
  let columnSegments: ColumnRaySegment[][] | undefined;

  if (hasRegion && scope === "region" && regionTarget) {
    const projectedRings = computePolygonRingsPixels(map, regionTarget);
    const bounds = computePixelBounds(projectedRings);
    if (bounds && bounds.width >= 8 && bounds.height >= 8) {
      polygonRingsPixels = projectedRings;
      pixelBounds = bounds;
      columnSegments = [];
    }
  }

  const isAdaptiveRegion = Boolean(scope === "region" && pixelBounds && polygonRingsPixels);

  const xStart = isAdaptiveRegion ? pixelBounds!.minX : 0;
  const xEnd = isAdaptiveRegion ? pixelBounds!.maxX : width;
  const usableW = Math.max(8, xEnd - xStart);

  const yTopScreen = isAdaptiveRegion ? pixelBounds!.minY : 0;
  const yBottomScreen = isAdaptiveRegion ? pixelBounds!.maxY : height;
  const usableH = Math.max(8, yBottomScreen - yTopScreen);

  const columns: ScanSampleCell[][] = [];
  const summaries: ScanColumnSummary[] = [];
  let inScopeHitCount = 0;

  for (let col = 0; col < cols; col += 1) {
    const x = xStart + (col / (cols - 1)) * usableW;
    const colCells: ScanSampleCell[] = [];
    let peakValue: number | null = null;
    let peakNorm = 0;
    let sumValue = 0;
    let validCount = 0;

    let midLon = 0;
    try {
      midLon = normalizeLon(map.unproject([x, (yTopScreen + yBottomScreen) * 0.5]).lng);
    } catch {
      midLon = 0;
    }

    if (isAdaptiveRegion && columnSegments && polygonRingsPixels) {
      const segs = computeRaySegmentsForX(polygonRingsPixels, x);
      columnSegments.push(segs);
    }

    for (let row = 0; row < rows; row += 1) {
      // row 0 = bottom (South), row 15 = top (North) for ascending audio pitch mapping
      const fracBottom = row / (rows - 1);
      const y = yBottomScreen - fracBottom * usableH;

      let lat = 0;
      let lon = midLon;
      let validProj = true;
      try {
        const lngLat = map.unproject([x, y]);
        lat = Math.max(-84.5, Math.min(84.5, lngLat.lat));
        lon = normalizeLon(lngLat.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
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
    scope,
    pixelBounds,
    polygonRingsPixels,
    columnSegments,
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
