import * as maplibregl from "maplibre-gl";
import { frameFor, getLayerDefinition, timeSlots } from "./breatheData";
import {
  computeBounds,
  computePrimaryFocusBounds,
  findInteriorPoint,
  getGeometryPolygons,
  pointInPolygon,
  pointInPolygonCoords,
  serializePolygonRingsForApi,
} from "./geoUtils";
import {
  fetchBackendTemporalSeries,
  resolveBackendRequestUrl,
} from "../services/backendApi";
import type { GeoBounds, GeoPoint, LayerDefinition, LayerKey, RegionStats } from "@/types/breathe";

type ColormapName = LayerDefinition["cmap"];
type Rgb = readonly [number, number, number];

const LUT_STOPS: Record<ColormapName, readonly Rgb[]> = {
  inferno: [
    [0, 0, 4], [11, 7, 36], [33, 12, 74], [61, 9, 101], [87, 16, 110], [113, 25, 110],
    [138, 34, 106], [163, 44, 97], [188, 55, 84], [210, 70, 68], [228, 90, 49], [241, 115, 29],
    [249, 142, 9], [252, 172, 17], [249, 203, 53], [242, 234, 105], [252, 255, 164],
  ],
  magma: [
    [0, 0, 4], [10, 8, 34], [29, 17, 71], [54, 16, 107], [81, 18, 124], [106, 28, 129],
    [131, 38, 129], [156, 46, 127], [183, 55, 121], [208, 65, 111], [231, 82, 99], [245, 107, 92],
    [252, 137, 97], [254, 167, 114], [254, 196, 136], [253, 226, 163], [252, 253, 191],
  ],
  viridis: [
    [68, 1, 84], [72, 24, 106], [71, 45, 123], [66, 64, 134], [59, 82, 139], [51, 99, 141],
    [44, 114, 142], [38, 130, 142], [33, 145, 140], [31, 160, 136], [40, 174, 128], [63, 188, 115],
    [94, 201, 98], [132, 212, 75], [173, 220, 48], [216, 226, 25], [253, 231, 37],
  ],
  cividis: [
    [0, 34, 78], [0, 46, 106], [26, 56, 111], [50, 67, 109], [67, 78, 108], [83, 90, 109],
    [97, 101, 111], [111, 112, 115], [125, 124, 120], [140, 136, 120], [155, 148, 118],
    [171, 160, 114], [188, 174, 108], [205, 187, 99], [222, 201, 88], [240, 216, 70], [254, 232, 56],
  ],
  plasma: [
    [13, 8, 135], [49, 5, 151], [76, 2, 161], [102, 0, 167], [126, 3, 168], [149, 17, 161],
    [170, 35, 149], [188, 53, 135], [204, 71, 120], [218, 90, 106], [230, 108, 92], [240, 128, 78],
    [248, 149, 64], [253, 172, 51], [253, 197, 39], [248, 223, 37], [240, 249, 33],
  ],
};

const BG_MASK_RGB: Rgb = [7, 11, 20];
const LUT_BINS = 128;

function expandLut(stops: readonly Rgb[]): Array<[number, number, number]> {
  const result: Array<[number, number, number]> = [];
  const segs = stops.length - 1;
  for (let i = 0; i < LUT_BINS; i += 1) {
    const pos = (i / (LUT_BINS - 1)) * segs;
    const lo = Math.floor(pos);
    const hi = Math.min(segs, lo + 1);
    const f = pos - lo;
    const c0 = stops[lo];
    const c1 = stops[hi];
    result.push([
      Math.round(c0[0] + (c1[0] - c0[0]) * f),
      Math.round(c0[1] + (c1[1] - c0[1]) * f),
      Math.round(c0[2] + (c1[2] - c0[2]) * f),
    ]);
  }
  return result;
}

const EXPANDED_LUTS: Record<ColormapName, Array<[number, number, number]>> = {
  inferno: expandLut(LUT_STOPS.inferno),
  magma: expandLut(LUT_STOPS.magma),
  viridis: expandLut(LUT_STOPS.viridis),
  cividis: expandLut(LUT_STOPS.cividis),
  plasma: expandLut(LUT_STOPS.plasma),
};

export interface DecodedRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const rasterCache = new Map<string, Promise<DecodedRaster | null>>();
const displayRasterCache = new WeakMap<DecodedRaster, DecodedRaster>();

interface ScalarGrid {
  width: number;
  height: number;
  norms: Float32Array;
}

const scalarGridCache = new Map<string, Promise<ScalarGrid | null>>();
const MAX_SCALAR_GRID_CACHE = 16;

const HASH_SLOTS = 4096;
const decodeMemoByCmap: Partial<Record<ColormapName, { keys: Int32Array; vals: Float32Array }>> = {};

function getDecodeMemo(cmap: ColormapName): { keys: Int32Array; vals: Float32Array } {
  let memo = decodeMemoByCmap[cmap];
  if (!memo) {
    const keys = new Int32Array(HASH_SLOTS);
    keys.fill(-1);
    memo = { keys, vals: new Float32Array(HASH_SLOTS) };
    decodeMemoByCmap[cmap] = memo;
  }
  return memo;
}

/** Fill isolated black render gaps without changing the raster used for measurements. */
function displayRaster(source: DecodedRaster): DecodedRaster {
  const cached = displayRasterCache.get(source);
  if (cached) return cached;
  const data = source.data.slice();
  const original = source.data;
  const width = source.width;
  const height = source.height;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      if (Math.max(original[index], original[index + 1], original[index + 2]) >= 30) continue;
      let count = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = ((y + dy) * width + x + dx) * 4;
          if (Math.max(original[neighbor], original[neighbor + 1], original[neighbor + 2]) < 45) continue;
          count += 1;
          red += original[neighbor];
          green += original[neighbor + 1];
          blue += original[neighbor + 2];
        }
      }
      if (count >= 5) {
        data[index] = Math.round(red / count);
        data[index + 1] = Math.round(green / count);
        data[index + 2] = Math.round(blue / count);
        data[index + 3] = 255;
      }
    }
  }
  const result = { width, height, data };
  displayRasterCache.set(source, result);
  return result;
}

function loadRasterPixels(url: string, maxWidth = 1024): Promise<DecodedRaster | null> {
  const key = `${url}@${maxWidth}`;
  const existing = rasterCache.get(key);
  if (existing) return existing;

  const promise = new Promise<DecodedRaster | null>((resolve) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        resolve({ width, height, data: imageData.data });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

  rasterCache.set(key, promise);
  return promise;
}

/**
 * Inverts a GEOS-CF RGB pixel back to normalized scalar intensity t in [0, 1].
 * Returns null for ocean/masked `#070b14` background cells.
 */
function decodeColormapNormalized(
  r: number,
  g: number,
  b: number,
  a: number,
  cmap: ColormapName
): number | null {
  if (a < 24) return null;
  const packed = (r << 16) | (g << 8) | b;
  const memo = getDecodeMemo(cmap);
  const slot = ((packed * 2654435761) >>> 20) & (HASH_SLOTS - 1);
  if (memo.keys[slot] === packed) {
    const cached = memo.vals[slot];
    return cached < 0 ? null : cached;
  }

  const drBg = r - BG_MASK_RGB[0];
  const dgBg = g - BG_MASK_RGB[1];
  const dbBg = b - BG_MASK_RGB[2];
  const bgDistSq = drBg * drBg + dgBg * dgBg + dbBg * dbBg;
  if (bgDistSq < 180) {
    memo.keys[slot] = packed;
    memo.vals[slot] = -1;
    return null;
  }

  const lut = EXPANDED_LUTS[cmap];
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < LUT_BINS; i += 1) {
    const [lr, lg, lb] = lut[i];
    const dr = r - lr;
    const dg = g - lg;
    const db = b - lb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const norm = bestIdx / (LUT_BINS - 1);
  memo.keys[slot] = packed;
  memo.vals[slot] = norm;
  return norm;
}

/**
 * Smooths display scalar norms using a separable 2D Gaussian/binomial filter [1, 4, 6, 4, 1] / 16
 * with adaptive hole-infilling for inland missing data gaps.
 * Dissolves 0.25-deg nearest-neighbor pcolormesh grid blocks and small inland missing spots into
 * silky continuous gradients, while strictly preserving ocean masking boundaries (-1).
 */
export function smoothDisplayNorms(
  norms: Float32Array,
  width: number,
  height: number
): Float32Array {
  // Infill isolated inland no-data gaps (holes) where cells are surrounded by valid data
  // Ocean has few/no valid neighbors, while inland gaps are surrounded by valid land cells
  const infilled = new Float32Array(norms);
  for (let pass = 0; pass < 4; pass += 1) {
    let filledCount = 0;
    for (let y = 1; y < height - 1; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const centerIdx = rowOffset + x;
        if (infilled[centerIdx] !== undefined && infilled[centerIdx]! >= 0) continue;
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const nRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            let nx = x + dx;
            if (nx < 0) nx += width;
            else if (nx >= width) nx -= width;
            const v = infilled[nRow + nx];
            if (v !== undefined && v >= 0) {
              sum += v;
              count += 1;
            }
          }
        }
        if (count >= 4) {
          infilled[centerIdx] = sum / count;
          filledCount += 1;
        }
      }
    }
    if (filledCount === 0) break;
  }

  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const weights = [1, 4, 6, 4, 1];

  // Horizontal pass: kernel [1, 4, 6, 4, 1] / 16 on infilled data
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const centerIdx = rowOffset + x;
      const centerVal = infilled[centerIdx];
      if (centerVal === undefined || centerVal < 0) {
        temp[centerIdx] = -1;
        continue;
      }
      let sum = 0;
      let wSum = 0;
      for (let k = -2; k <= 2; k += 1) {
        let nx = x + k;
        if (nx < 0) nx += width;
        else if (nx >= width) nx -= width;
        const v = infilled[rowOffset + nx];
        if (v !== undefined && v >= 0) {
          const w = weights[k + 2] ?? 1;
          sum += v * w;
          wSum += w;
        }
      }
      temp[centerIdx] = wSum > 0 ? sum / wSum : centerVal;
    }
  }

  // Vertical pass: kernel [1, 4, 6, 4, 1] / 16
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const centerIdx = y * width + x;
      const centerVal = temp[centerIdx];
      if (centerVal === undefined || centerVal < 0) {
        out[centerIdx] = -1;
        continue;
      }
      let sum = 0;
      let wSum = 0;
      for (let k = -2; k <= 2; k += 1) {
        const ny = y + k;
        if (ny >= 0 && ny < height) {
          const v = temp[ny * width + x];
          if (v !== undefined && v >= 0) {
            const w = weights[k + 2] ?? 1;
            sum += v * w;
            wSum += w;
          }
        }
      }
      out[centerIdx] = wSum > 0 ? sum / wSum : centerVal;
    }
  }

  return out;
}

/**
 * Decodes a GEOS-CF frame once into a compact normalized Float32Array (-1 = masked)
 * while keeping display gap-filling isolated from measurement rasters.
 */
function getScalarGrid(
  url: string,
  cmap: ColormapName,
  forDisplay: boolean
): Promise<ScalarGrid | null> {
  const key = `${url}::${cmap}::${forDisplay ? 1 : 0}`;
  const existing = scalarGridCache.get(key);
  if (existing) {
    scalarGridCache.delete(key);
    scalarGridCache.set(key, existing);
    return existing;
  }

  if (scalarGridCache.size >= MAX_SCALAR_GRID_CACHE) {
    const oldest = scalarGridCache.keys().next().value;
    if (oldest !== undefined) scalarGridCache.delete(oldest);
  }

  const promise = (async (): Promise<ScalarGrid | null> => {
    const original = await loadRasterPixels(url, 2048);
    const raster = original ? (forDisplay ? displayRaster(original) : original) : null;
    if (!raster) return null;
    const total = raster.width * raster.height;
    const norms = new Float32Array(total);
    const data = raster.data;
    for (let i = 0; i < total; i += 1) {
      const idx = i * 4;
      const t = decodeColormapNormalized(data[idx], data[idx + 1], data[idx + 2], data[idx + 3], cmap);
      norms[i] = t === null ? -1 : t;
    }
    const processedNorms = forDisplay ? smoothDisplayNorms(norms, raster.width, raster.height) : norms;
    return { width: raster.width, height: raster.height, norms: processedNorms };
  })().catch(() => {
    scalarGridCache.delete(key);
    return null;
  });

  scalarGridCache.set(key, promise);
  return promise;
}

function sampleScalarSmooth(grid: ScalarGrid, lat: number, lon: number): number {
  const x = ((((lon + 180) % 360) + 360) % 360) / 360 * grid.width - 0.5;
  const y = Math.max(0, Math.min(grid.height - 1, ((90 - lat) / 180) * grid.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ax = ((x0 % grid.width) + grid.width) % grid.width;
  const bx = (ax + 1) % grid.width;
  const by = Math.min(grid.height - 1, y0 + 1);
  const norms = grid.norms;
  const v00 = norms[y0 * grid.width + ax];
  const v10 = norms[y0 * grid.width + bx];
  const v01 = norms[by * grid.width + ax];
  const v11 = norms[by * grid.width + bx];
  if (v00 < 0 && v10 < 0 && v01 < 0 && v11 < 0) return -1;

  let weightSum = 0;
  let valSum = 0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  if (v00 >= 0) { valSum += v00 * w00; weightSum += w00; }
  if (v10 >= 0) { valSum += v10 * w10; weightSum += w10; }
  if (v01 >= 0) { valSum += v01 * w01; weightSum += w01; }
  if (v11 >= 0) { valSum += v11 * w11; weightSum += w11; }
  return weightSum >= 0.45 ? valSum / weightSum : -1;
}

function sampleEquirectangularPixel(
  raster: DecodedRaster,
  lat: number,
  lon: number
): [number, number, number, number] {
  const xNorm = (((lon + 180) % 360) + 360) % 360 / 360;
  const yNorm = Math.max(0, Math.min(1, (90 - lat) / 180));
  const px = Math.min(raster.width - 1, Math.max(0, Math.floor(xNorm * raster.width)));
  const py = Math.min(raster.height - 1, Math.max(0, Math.floor(yNorm * raster.height)));
  const idx = (py * raster.width + px) * 4;
  return [
    raster.data[idx],
    raster.data[idx + 1],
    raster.data[idx + 2],
    raster.data[idx + 3],
  ];
}

/** Bilinear display sampling prevents global raster cells becoming square blocks on regional maps. */
function sampleEquirectangularSmooth(
  raster: DecodedRaster,
  lat: number,
  lon: number
): [number, number, number, number] {
  const x = (((lon + 180) % 360) + 360) % 360 / 360 * raster.width - 0.5;
  const y = Math.max(0, Math.min(raster.height - 1, (90 - lat) / 180 * raster.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ax = ((x0 % raster.width) + raster.width) % raster.width;
  const bx = (ax + 1) % raster.width;
  const by = Math.min(raster.height - 1, y0 + 1);
  const a = (y0 * raster.width + ax) * 4;
  const b = (y0 * raster.width + bx) * 4;
  const c = (by * raster.width + ax) * 4;
  const d = (by * raster.width + bx) * 4;
  const data = raster.data;
  return [0, 1, 2, 3].map((channel) =>
    (data[a + channel] * (1 - fx) + data[b + channel] * fx) * (1 - fy)
    + (data[c + channel] * (1 - fx) + data[d + channel] * fx) * fy
  ) as [number, number, number, number];
}

function sampleBoundsImage(
  raster: DecodedRaster,
  lat: number,
  lon: number,
  bounds: GeoBounds
): [number, number, number, number] | null {
  if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) {
    return null;
  }
  const xNorm = (lon - bounds.west) / (bounds.east - bounds.west);
  const yNorm = (bounds.north - lat) / (bounds.north - bounds.south);
  const px = Math.min(raster.width - 1, Math.max(0, Math.floor(xNorm * raster.width)));
  const py = Math.min(raster.height - 1, Math.max(0, Math.floor(yNorm * raster.height)));
  const idx = (py * raster.width + px) * 4;
  return [
    raster.data[idx],
    raster.data[idx + 1],
    raster.data[idx + 2],
    raster.data[idx + 3],
  ];
}

/**
 * Harmonizes normalized concentration t in [0, 1] onto BREATHE's pine-sage-amber ramp
 * so overlays read accurately on dark satellite Earth without neon clashing.
 */
function intensityToEditorialRgba(t: number): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  // Keep low concentrations transparent so coastlines and borders stay legible.
  // This is display emphasis only; polygon statistics still sample the full raster.
  if (clamped < 0.18) return [0, 0, 0, 0];
  if (clamped < 0.3) {
    const k = (clamped - 0.18) / 0.12;
    return [
      Math.round(28 + k * 24),
      Math.round(82 + k * 54),
      Math.round(74 + k * 46),
      Math.round(k * 112),
    ];
  }
  if (clamped < 0.62) {
    const k = (clamped - 0.3) / 0.32;
    return [
      Math.round(52 + k * 138),
      Math.round(136 + k * 56),
      Math.round(120 - k * 8),
      Math.round(112 + k * 58),
    ];
  }
  if (clamped < 0.85) {
    const k = (clamped - 0.62) / 0.23;
    return [
      Math.round(190 + k * 34),
      Math.round(192 - k * 22),
      Math.round(112 - k * 42),
      Math.round(170 + k * 32),
    ];
  }
  const k = (clamped - 0.85) / 0.15;
  return [
    Math.round(224 - k * 14),
    Math.round(170 - k * 68),
    Math.round(70 - k * 22),
    Math.round(202 + k * 24),
  ];
}

function writeEditorialRgba(t: number, out: Uint8ClampedArray, dst: number): boolean {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped < 0.18) return false;
  let r: number;
  let g: number;
  let b: number;
  let a: number;
  if (clamped < 0.3) {
    const k = (clamped - 0.18) / 0.12;
    r = Math.round(28 + k * 24);
    g = Math.round(82 + k * 54);
    b = Math.round(74 + k * 46);
    a = Math.round(k * 112);
  } else if (clamped < 0.62) {
    const k = (clamped - 0.3) / 0.32;
    r = Math.round(52 + k * 138);
    g = Math.round(136 + k * 56);
    b = Math.round(120 - k * 8);
    a = Math.round(112 + k * 58);
  } else if (clamped < 0.85) {
    const k = (clamped - 0.62) / 0.23;
    r = Math.round(190 + k * 34);
    g = Math.round(192 - k * 22);
    b = Math.round(112 - k * 42);
    a = Math.round(170 + k * 32);
  } else {
    const k = (clamped - 0.85) / 0.15;
    r = Math.round(224 - k * 14);
    g = Math.round(170 - k * 68);
    b = Math.round(70 - k * 22);
    a = Math.round(202 + k * 24);
  }
  if (a <= 0) return false;
  out[dst] = r;
  out[dst + 1] = g;
  out[dst + 2] = b;
  out[dst + 3] = a;
  return true;
}

/**
 * Returns opaque pine-sage-amber RGB values for 2D scanline hit particles & glow filaments,
 * preserving the map's concentration color progression down into moderate low-plume ranges.
 */
export function getEditorialAccentRgb(t: number): [number, number, number] {
  const safeT = Math.max(0.22, Math.min(1, t));
  const [r, g, b] = intensityToEditorialRgba(safeT);
  return [r, g, b];
}

/** Loads and caches the decoded NASA GEOS-CF v2 raster image for a given variable and UTC slot. */
export async function loadLayerRaster(
  layerKey: LayerKey,
  timeIndex: number
): Promise<DecodedRaster | null> {
  const layer = getLayerDefinition(layerKey);
  if (!layer.available) return null;
  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  const frame = frameFor(layerKey, safeIndex);
  if (!frame) return null;
  return loadRasterPixels(frame.imageUrl, 2048);
}

/**
 * Decodes physical concentration and normalized intensity [0, 1] at a coordinate from a loaded raster.
 * Returns null over masked open-ocean / no-data cells.
 */
export function decodeRasterSample(
  raster: DecodedRaster,
  layer: LayerDefinition,
  lat: number,
  lon: number
): { value: number; norm: number } | null {
  const [r, g, b, a] = sampleEquirectangularSmooth(raster, lat, lon);
  const norm = decodeColormapNormalized(r, g, b, a, layer.cmap);
  if (norm === null) return null;
  return {
    value: layer.vmin + norm * (layer.vmax - layer.vmin),
    norm,
  };
}

const REGION_CROPS = {
  northernVietnam: {
    url: "/images/earth-northern-vietnam.jpg",
    bounds: { west: 100, south: 18, east: 110, north: 25 } satisfies GeoBounds,
  },
  ninhThuan: {
    url: "/images/earth-ninh-thuan.jpg",
    bounds: { west: 106.5, south: 10.2, east: 111, north: 13.3 } satisfies GeoBounds,
  },
};

function edgeFeatherAlpha(lat: number, lon: number, bounds: GeoBounds): number {
  const dx = Math.min(lon - bounds.west, bounds.east - lon) / Math.max(0.5, (bounds.east - bounds.west) * 0.14);
  const dy = Math.min(lat - bounds.south, bounds.north - lat) / Math.max(0.5, (bounds.north - bounds.south) * 0.14);
  return Math.max(0, Math.min(1, Math.min(dx, dy)));
}

const TILE_SIZE = 256;
const TILE_WORKER_COUNT = 2;
const MAX_TILE_CACHE_ENTRIES = 224;

type TileCacheEntry = Uint8ClampedArray | "EMPTY";

interface WorkerPendingJob {
  resolve: (value: TileCacheEntry) => void;
  reject: (reason: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, WorkerPendingJob>;
}

const tileLruCache = new Map<string, TileCacheEntry>();
const inFlightTileJobs = new Map<string, Promise<TileCacheEntry>>();
let tileWorkerSlots: WorkerSlot[] | null = null;
let tileWorkerDisabled = false;
let nextTileJobId = 1;
let registeredProtocol = false;

function getCachedTile(key: string): TileCacheEntry | undefined {
  const existing = tileLruCache.get(key);
  if (existing === undefined) return undefined;
  tileLruCache.delete(key);
  tileLruCache.set(key, existing);
  return existing;
}

function setCachedTile(key: string, entry: TileCacheEntry): void {
  if (tileLruCache.has(key)) {
    tileLruCache.delete(key);
  } else if (tileLruCache.size >= MAX_TILE_CACHE_ENTRIES) {
    const oldestKey = tileLruCache.keys().next().value;
    if (oldestKey !== undefined) tileLruCache.delete(oldestKey);
  }
  tileLruCache.set(key, entry);
}

function getTileWorkerPool(): WorkerSlot[] | null {
  if (tileWorkerDisabled || typeof window === "undefined") return null;
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap !== "function"
  ) {
    tileWorkerDisabled = true;
    return null;
  }
  if (tileWorkerSlots) return tileWorkerSlots;

  const slots: WorkerSlot[] = [];
  const RASTER_WORKER_VERSION = "20261115-smooth-v2";
  try {
    for (let i = 0; i < TILE_WORKER_COUNT; i += 1) {
      const worker = new Worker(`/workers/raster-tile-worker.js?v=${RASTER_WORKER_VERSION}`);
      const pending = new Map<number, WorkerPendingJob>();
      const slot: WorkerSlot = { worker, pending };

      worker.onmessage = (event: MessageEvent<{
        id: number;
        status: "ok" | "error";
        empty?: boolean;
        buffer?: ArrayBuffer;
        message?: string;
      }>) => {
        const payload = event.data;
        if (!payload || typeof payload.id !== "number") return;
        const job = slot.pending.get(payload.id);
        if (!job) return;
        slot.pending.delete(payload.id);

        if (payload.status === "error") {
          job.reject(new Error(payload.message ?? "Tile worker failed"));
          return;
        }
        if (payload.empty || !payload.buffer) {
          job.resolve("EMPTY");
          return;
        }
        job.resolve(new Uint8ClampedArray(payload.buffer));
      };

      worker.onerror = () => {
        tileWorkerDisabled = true;
        for (const s of slots) {
          for (const [, job] of s.pending) {
            job.reject(new Error("Tile worker crashed"));
          }
          s.pending.clear();
          s.worker.terminate();
        }
        tileWorkerSlots = null;
      };

      worker.postMessage({
        type: "init",
        expandedLuts: EXPANDED_LUTS,
        lutBins: LUT_BINS,
        bgMaskRgb: BG_MASK_RGB,
        regionCrops: REGION_CROPS,
      });

      slots.push(slot);
    }

    tileWorkerSlots = slots;
    return tileWorkerSlots;
  } catch {
    tileWorkerDisabled = true;
    for (const slot of slots) {
      slot.worker.terminate();
    }
    tileWorkerSlots = null;
    return null;
  }
}

function pickWorkerSlot(slots: WorkerSlot[], kind: "base" | "overlay"): WorkerSlot {
  if (slots.length === 1) return slots[0];
  const preferredIdx = kind === "base" ? 0 : 1;
  const preferred = slots[preferredIdx];
  const alternate = slots[1 - preferredIdx];
  if (preferred.pending.size >= 6 && alternate.pending.size < preferred.pending.size) {
    return alternate;
  }
  return preferred;
}

function dispatchWorkerTile(
  kind: "base" | "overlay",
  payload: { z: number; x: number; y: number; cmap?: ColormapName; imageUrl?: string }
): Promise<TileCacheEntry> | null {
  const slots = getTileWorkerPool();
  if (!slots) return null;

  const slot = pickWorkerSlot(slots, kind);
  const id = nextTileJobId;
  nextTileJobId += 1;

  return new Promise<TileCacheEntry>((resolve, reject) => {
    slot.pending.set(id, { resolve, reject });
    try {
      slot.worker.postMessage({
        type: "renderTile",
        id,
        kind,
        ...payload,
      });
    } catch (err) {
      slot.pending.delete(id);
      reject(err instanceof Error ? err : new Error("Worker dispatch error"));
    }
  });
}

let baseSatelliteWarmPromise: Promise<void> | null = null;
let baseSatelliteWarmed = false;

/** Indicates whether base NASA Blue Marble + cloud rasters were already warmed once this session. */
export function isBaseSatelliteWarmed(): boolean {
  return baseSatelliteWarmed;
}

/**
 * Non-blockingly preloads NASA Blue Marble & cloud rasters inside the tile worker pool
 * (or main-thread fallback if workers are unavailable) so first switching to Satellite
 * never stalls UI animations or audio playback.
 */
export async function preloadBaseSatelliteAssets(): Promise<void> {
  if (baseSatelliteWarmed) return;
  if (baseSatelliteWarmPromise) return baseSatelliteWarmPromise;

  baseSatelliteWarmPromise = (async () => {
    const slots = getTileWorkerPool();
    if (slots && slots.length > 0) {
      await Promise.allSettled(
        slots.map(
          (slot) =>
            new Promise<void>((resolve, reject) => {
              const id = nextTileJobId;
              nextTileJobId += 1;
              slot.pending.set(id, {
                resolve: () => resolve(),
                reject,
              });
              try {
                slot.worker.postMessage({ type: "preloadBase", id });
              } catch (err) {
                slot.pending.delete(id);
                reject(err instanceof Error ? err : new Error("Worker preload error"));
              }
            })
        )
      );
    } else {
      await Promise.allSettled([
        loadRasterPixels("/images/earth-blue-marble.png", 1600),
        loadRasterPixels("/images/earth-clouds-hires.jpg", 1024),
      ]);
    }
    baseSatelliteWarmed = true;
  })().finally(() => {
    if (!baseSatelliteWarmed) {
      baseSatelliteWarmPromise = null;
    }
  });

  return baseSatelliteWarmPromise;
}

/** Pre-decodes a target GEOS-CF timestamp frame inside the worker pool ahead of playback scrub. */
export function prefetchOverlayFrame(layerKey: LayerKey, timeIndex: number): void {
  const layer = getLayerDefinition(layerKey);
  if (!layer.available || layerKey === "AOD") return;
  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  const frame = frameFor(layerKey, safeIndex);
  if (!frame) return;

  const slots = getTileWorkerPool();
  if (slots && slots.length > 0) {
    const targetSlot = slots[slots.length > 1 ? 1 : 0];
    try {
      targetSlot.worker.postMessage({
        type: "preloadOverlay",
        imageUrl: frame.imageUrl,
        cmap: layer.cmap,
      });
    } catch {
      // Ignore transient worker postMessage errors during unmount/prefetch
    }
    return;
  }

  void getScalarGrid(frame.imageUrl, layer.cmap, true);
}

async function renderTileOnMainThread(
  kind: string,
  parts: string[]
): Promise<TileCacheEntry> {
  const out = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);

  if (kind === "base") {
    const z = Number(parts[2] ?? 0);
    const x = Number(parts[3] ?? 0);
    const y = Number(parts[4] ?? 0);
    const scale = 2 ** z;

    const [baseRaster, cloudsRaster, northVnRaster, ninhThuanRaster] = await Promise.all([
      loadRasterPixels("/images/earth-blue-marble.png", 1600),
      loadRasterPixels("/images/earth-clouds-hires.jpg", 1024),
      z >= 3 ? loadRasterPixels(REGION_CROPS.northernVietnam.url, 1024) : Promise.resolve(null),
      z >= 4 ? loadRasterPixels(REGION_CROPS.ninhThuan.url, 1024) : Promise.resolve(null),
    ]);

    if (!baseRaster) {
      for (let i = 0; i < out.length; i += 4) {
        out[i] = 22;
        out[i + 1] = 45;
        out[i + 2] = 44;
        out[i + 3] = 255;
      }
      return out;
    }

    const lons = new Float64Array(TILE_SIZE);
    for (let px = 0; px < TILE_SIZE; px += 1) {
      const normX = (x + (px + 0.5) / TILE_SIZE) / scale;
      lons[px] = normX * 360 - 180;
    }
    for (let py = 0; py < TILE_SIZE; py += 1) {
      const normY = (y + (py + 0.5) / TILE_SIZE) / scale;
      const n = Math.PI * (1 - 2 * normY);
      const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
      const rowOffset = py * TILE_SIZE * 4;
      for (let px = 0; px < TILE_SIZE; px += 1) {
        const lon = lons[px];
        let [r, g, b] = sampleEquirectangularPixel(baseRaster, lat, lon);

        if (northVnRaster) {
          const crop = sampleBoundsImage(northVnRaster, lat, lon, REGION_CROPS.northernVietnam.bounds);
          if (crop) {
            const a = edgeFeatherAlpha(lat, lon, REGION_CROPS.northernVietnam.bounds) * 0.72;
            r = Math.round(r * (1 - a) + crop[0] * a);
            g = Math.round(g * (1 - a) + crop[1] * a);
            b = Math.round(b * (1 - a) + crop[2] * a);
          }
        }
        if (ninhThuanRaster) {
          const crop = sampleBoundsImage(ninhThuanRaster, lat, lon, REGION_CROPS.ninhThuan.bounds);
          if (crop) {
            const a = edgeFeatherAlpha(lat, lon, REGION_CROPS.ninhThuan.bounds) * 0.78;
            r = Math.round(r * (1 - a) + crop[0] * a);
            g = Math.round(g * (1 - a) + crop[1] * a);
            b = Math.round(b * (1 - a) + crop[2] * a);
          }
        }
        if (cloudsRaster) {
          const cl = sampleEquirectangularPixel(cloudsRaster, lat, lon);
          const cloudMix = (cl[0] / 255) * 0.14;
          r = Math.min(255, Math.round(r + 220 * cloudMix));
          g = Math.min(255, Math.round(g + 225 * cloudMix));
          b = Math.min(255, Math.round(b + 220 * cloudMix));
        }

        const dst = rowOffset + px * 4;
        out[dst] = Math.round(r * 0.88 + 8);
        out[dst + 1] = Math.round(g * 0.92 + 12);
        out[dst + 2] = Math.round(b * 0.86 + 10);
        out[dst + 3] = 255;
      }
    }
    return out;
  }

  if (kind === "overlay") {
    const layerKey = (parts[1] ?? "PM25_RH35") as LayerKey;
    const timeIndex = Number(parts[2] ?? 0);
    const z = Number(parts[3] ?? 0);
    const x = Number(parts[4] ?? 0);
    const y = Number(parts[5] ?? 0);
    const layer = getLayerDefinition(layerKey);
    const frame = frameFor(layerKey, timeIndex);
    if (!layer.available || !frame) return "EMPTY";

    const grid = await getScalarGrid(frame.imageUrl, layer.cmap, true);
    if (!grid) return "EMPTY";

    const scale = 2 ** z;
    const lons = new Float64Array(TILE_SIZE);
    for (let px = 0; px < TILE_SIZE; px += 1) {
      lons[px] = ((x + (px + 0.5) / TILE_SIZE) / scale) * 360 - 180;
    }
    let hasOpaque = false;
    for (let py = 0; py < TILE_SIZE; py += 1) {
      const normY = (y + (py + 0.5) / TILE_SIZE) / scale;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * normY))) * 180) / Math.PI;
      const rowOffset = py * TILE_SIZE * 4;
      for (let px = 0; px < TILE_SIZE; px += 1) {
        const t = sampleScalarSmooth(grid, lat, lons[px]);
        if (t >= 0) {
          if (writeEditorialRgba(t, out, rowOffset + px * 4)) {
            hasOpaque = true;
          }
        }
      }
    }
    return hasOpaque ? out : "EMPTY";
  }

  return "EMPTY";
}

async function tileEntryToProtocolResponse(
  entry: TileCacheEntry,
  signal?: AbortSignal
): Promise<maplibregl.GetResourceResponse<maplibregl.AddProtocolResponseData>> {
  if (entry === "EMPTY" || signal?.aborted) {
    return { data: new ArrayBuffer(0) };
  }

  if (typeof ImageData !== "undefined") {
    const imgData = new ImageData(new Uint8ClampedArray(entry), TILE_SIZE, TILE_SIZE);
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(imgData);
        if (signal?.aborted) {
          bitmap.close();
          return { data: new ArrayBuffer(0) };
        }
        return { data: bitmap };
      } catch {
        // Fall through to canvas PNG encoding
      }
    }
    if (signal?.aborted) {
      return { data: new ArrayBuffer(0) };
    }
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { data: new ArrayBuffer(0) };
    ctx.putImageData(imgData, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || signal?.aborted) return { data: new ArrayBuffer(0) };
    return { data: await blob.arrayBuffer() };
  }

  return { data: new ArrayBuffer(0) };
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Registers custom `breathe-earth://` raster protocol in MapLibre GL v6
 * to reproject bundled EPSG:4326 Earth & GEOS-CF maps cleanly into Web Mercator tiles
 * off the UI thread with an LRU tile cache.
 */
export function registerBreatheMapProtocol(ml: typeof maplibregl) {
  if (registeredProtocol || typeof document === "undefined") return;
  registeredProtocol = true;

  // Warm the worker pool up front so base + overlay tile jobs start without worker boot latency
  getTileWorkerPool();

  ml.addProtocol(
    "breathe-earth",
    async (params: maplibregl.RequestParameters, abortController: AbortController) => {
      if (abortController.signal.aborted) {
        return { data: new ArrayBuffer(0) };
      }

      const cleanUrl = params.url.replace("breathe-earth://", "");
      const cached = getCachedTile(cleanUrl);
      if (cached !== undefined) {
        return tileEntryToProtocolResponse(cached, abortController.signal);
      }

      let tileJob = inFlightTileJobs.get(cleanUrl);
      if (!tileJob) {
        const parts = cleanUrl.split("/");
        const kind = parts[0];

        const computeTile = async (): Promise<TileCacheEntry> => {
          let workerPromise: Promise<TileCacheEntry> | null = null;
          if (kind === "base") {
            workerPromise = dispatchWorkerTile("base", {
              z: Number(parts[2] ?? 0),
              x: Number(parts[3] ?? 0),
              y: Number(parts[4] ?? 0),
            });
          } else if (kind === "overlay") {
            const layerKey = (parts[1] ?? "PM25_RH35") as LayerKey;
            const timeIndex = Number(parts[2] ?? 0);
            const layer = getLayerDefinition(layerKey);
            const frame = frameFor(layerKey, timeIndex);
            if (!layer.available || !frame) {
              setCachedTile(cleanUrl, "EMPTY");
              return "EMPTY";
            }
            workerPromise = dispatchWorkerTile("overlay", {
              z: Number(parts[3] ?? 0),
              x: Number(parts[4] ?? 0),
              y: Number(parts[5] ?? 0),
              cmap: layer.cmap,
              imageUrl: frame.imageUrl,
            });
          } else {
            return "EMPTY";
          }

          let entry: TileCacheEntry;
          if (workerPromise) {
            try {
              entry = await workerPromise;
            } catch {
              entry = await renderTileOnMainThread(kind, parts);
            }
          } else {
            entry = await renderTileOnMainThread(kind, parts);
          }

          setCachedTile(cleanUrl, entry);
          return entry;
        };

        tileJob = computeTile().finally(() => {
          inFlightTileJobs.delete(cleanUrl);
        });
        inFlightTileJobs.set(cleanUrl, tileJob);
      }

      const resolved = await waitWithAbort(tileJob, abortController.signal);
      if (!resolved || abortController.signal.aborted) {
        return { data: new ArrayBuffer(0) };
      }

      return tileEntryToProtocolResponse(resolved, abortController.signal);
    }
  );
}

interface PolygonSampleCells {
  cellKeys: Int32Array;
  cosWeights: Float32Array;
}

const geometryCellCache = new WeakMap<object, Map<string, PolygonSampleCells>>();
const polygonCellCache = new Map<string, PolygonSampleCells>();
const MAX_POLYGON_CELL_CACHE = 24;

function buildPolygonSampleCells(
  width: number,
  height: number,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): PolygonSampleCells {
  const keys: number[] = [];
  const weights: number[] = [];
  const visited = new Set<number>();

  const scanBounds = (b: GeoBounds, hitTest: (lat: number, lon: number) => boolean) => {
    const xMin = Math.max(0, Math.floor(((b.west + 180) / 360) * width));
    const xMax = Math.min(width - 1, Math.ceil(((b.east + 180) / 360) * width));
    const yMin = Math.max(0, Math.floor(((90 - b.north) / 180) * height));
    const yMax = Math.min(height - 1, Math.ceil(((90 - b.south) / 180) * height));
    const spanX = Math.max(1, xMax - xMin);
    const spanY = Math.max(1, yMax - yMin);
    const stepX = Math.max(1, Math.floor(spanX / 36));
    const stepY = Math.max(1, Math.floor(spanY / 36));

    for (let py = yMin; py <= yMax; py += stepY) {
      const lat = 90 - ((py + 0.5) / height) * 180;
      const cosW = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
      for (let px = xMin; px <= xMax; px += stepX) {
        const cellKey = py * width + px;
        if (visited.has(cellKey)) continue;
        const lon = ((px + 0.5) / width) * 360 - 180;
        if (!hitTest(lat, lon)) continue;
        visited.add(cellKey);
        keys.push(cellKey);
        weights.push(cosW);
      }
    }
  };

  if (boundaryGeometry) {
    const polys = getGeometryPolygons(boundaryGeometry);
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const c of outer) {
        if (c[0] < west) west = c[0];
        if (c[0] > east) east = c[0];
        if (c[1] < south) south = c[1];
        if (c[1] > north) north = c[1];
      }
      if (east - west > 175) continue;
      scanBounds({ west, south, east, north }, (lat, lon) => pointInPolygonCoords(lat, lon, rings));
    }
  } else {
    const bounds = computeBounds(polygon);
    scanBounds(bounds, (lat, lon) => pointInPolygon(lat, lon, polygon));
  }

  return {
    cellKeys: Int32Array.from(keys),
    cosWeights: Float32Array.from(weights),
  };
}

function getPolygonSampleCells(
  width: number,
  height: number,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): PolygonSampleCells {
  const sizeKey = `${width}x${height}`;
  if (boundaryGeometry) {
    let bySize = geometryCellCache.get(boundaryGeometry);
    const cached = bySize?.get(sizeKey);
    if (cached) return cached;

    const computed = buildPolygonSampleCells(width, height, polygon, boundaryGeometry);
    if (!bySize) {
      bySize = new Map();
      geometryCellCache.set(boundaryGeometry, bySize);
    }
    bySize.set(sizeKey, computed);
    return computed;
  }

  const sig = `${sizeKey}::${polygon.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(";")}`;
  const cached = polygonCellCache.get(sig);
  if (cached) {
    polygonCellCache.delete(sig);
    polygonCellCache.set(sig, cached);
    return cached;
  }

  const computed = buildPolygonSampleCells(width, height, polygon);
  if (polygonCellCache.size >= MAX_POLYGON_CELL_CACHE) {
    const oldest = polygonCellCache.keys().next().value;
    if (oldest !== undefined) polygonCellCache.delete(oldest);
  }
  polygonCellCache.set(sig, computed);
  return computed;
}

/**
 * Samples polygon-bounded atmospheric statistics directly from bundled NASA GEOS-CF v2 PNGs,
 * applying cos(lat) area weighting and inverting the matplotlib LUT back to physical units.
 */
export async function samplePolygonStats(
  layerKey: LayerKey,
  timeIndex: number,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Promise<RegionStats> {
  const layer = getLayerDefinition(layerKey);
  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  const timestamp = timeSlots[safeIndex] ?? "2026-11-12T00:30:00Z";

  if (!layer.available || layerKey === "AOD") {
    return {
      variable: layerKey,
      unit: layer.unit,
      mean: null,
      min: null,
      max: null,
      p90: null,
      sampleCount: 0,
      coveragePct: 0,
      timestamp,
      sourceKind: "unavailable",
      sourceLabel: "Awaiting verified NASA MODIS/VIIRS AOD granule",
      isMock: false,
      loading: false,
      error: null,
    };
  }

  const frame = frameFor(layerKey, safeIndex);
  if (!frame || (!boundaryGeometry && polygon.length < 3)) {
    return {
      variable: layerKey,
      unit: layer.unit,
      mean: null,
      min: null,
      max: null,
      p90: null,
      sampleCount: 0,
      coveragePct: 0,
      timestamp,
      sourceKind: "unavailable",
      sourceLabel: "No GEOS-CF frame available",
      isMock: false,
      loading: false,
    };
  }

  const grid = await getScalarGrid(frame.imageUrl, layer.cmap, false);
  if (!grid) {
    return {
      variable: layerKey,
      unit: layer.unit,
      mean: null,
      min: null,
      max: null,
      p90: null,
      sampleCount: 0,
      coveragePct: 0,
      timestamp,
      sourceKind: "unavailable",
      sourceLabel: "Raster unavailable offline",
      isMock: false,
      loading: false,
    };
  }

  const { cellKeys, cosWeights } = getPolygonSampleCells(
    grid.width,
    grid.height,
    polygon,
    boundaryGeometry
  );

  const values: number[] = [];
  let weightedSum = 0;
  let weightTotal = 0;
  let checkedCells = cellKeys.length;
  const span = layer.vmax - layer.vmin;
  const norms = grid.norms;

  for (let i = 0; i < cellKeys.length; i += 1) {
    const t = norms[cellKeys[i]];
    if (t < 0) continue;
    const val = layer.vmin + t * span;
    const cosW = cosWeights[i];
    values.push(val);
    weightedSum += val * cosW;
    weightTotal += cosW;
  }

  // Fallback to interior point sample for micro-territories smaller than one raster cell
  if (values.length === 0) {
    const samplePt = findInteriorPoint(boundaryGeometry ?? polygon);
    if (samplePt) {
      const xNorm = ((((samplePt.lon + 180) % 360) + 360) % 360) / 360;
      const yNorm = Math.max(0, Math.min(1, (90 - samplePt.lat) / 180));
      const px = Math.min(grid.width - 1, Math.max(0, Math.floor(xNorm * grid.width)));
      const py = Math.min(grid.height - 1, Math.max(0, Math.floor(yNorm * grid.height)));
      const t = norms[py * grid.width + px];
      if (t >= 0) {
        const val = layer.vmin + t * span;
        values.push(val);
        weightedSum = val;
        weightTotal = 1;
        checkedCells = Math.max(1, checkedCells);
      }
    }
  }

  if (values.length === 0) {
    return {
      variable: layerKey,
      unit: layer.unit,
      mean: null,
      min: null,
      max: null,
      p90: null,
      sampleCount: 0,
      coveragePct: 0,
      timestamp,
      sourceKind: "geos-cf-raster",
      sourceLabel: "NASA GEOS-CF v2 raster-sampled (masked over open water)",
      isMock: false,
      loading: false,
    };
  }

  values.sort((a, b) => a - b);
  const mean = weightedSum / weightTotal;
  const min = values[0];
  const max = values[values.length - 1];
  const p90 = values[Math.min(values.length - 1, Math.floor(values.length * 0.9))];
  const coveragePct = checkedCells > 0 ? Math.round((values.length / checkedCells) * 100) : 100;

  return {
    variable: layerKey,
    unit: layer.unit,
    mean: Number(mean.toFixed(1)),
    min: Number(min.toFixed(1)),
    max: Number(max.toFixed(1)),
    p90: Number(p90.toFixed(1)),
    sampleCount: values.length,
    coveragePct,
    timestamp,
    sourceKind: "geos-cf-raster",
    sourceLabel: "NASA GEOS-CF v2 raster-sampled",
    isMock: false,
    loading: false,
  };
}

/**
 * Resolves the base URL for the backend API, prioritizing NEXT_PUBLIC_BACKEND_URL ->
 * NEXT_PUBLIC_API_URL -> http://localhost:8000. Normalizes trailing slashes and redundant /api/v1 paths.
 */
export function getBackendBaseUrl(): string {
  const sanitize = (val?: string): string | undefined => {
    if (!val) return undefined;
    const trimmed = val.trim();
    if (!trimmed || trimmed === "undefined" || trimmed === "null") return undefined;
    return trimmed;
  };
  const raw =
    sanitize(process.env.NEXT_PUBLIC_BACKEND_URL) ||
    sanitize(process.env.NEXT_PUBLIC_API_URL) ||
    "http://localhost:8000";
  return raw.replace(/\/+$/, "").replace(/\/api\/v1\/?$/i, "").replace(/\/+$/, "");
}

let backendUnavailableUntil = 0;

export function resetBackendCircuitBreaker(): void {
  backendUnavailableUntil = 0;
  pointSeriesCache.clear();
}

export function getBackendCircuitBreakerUntil(): number {
  return backendUnavailableUntil;
}

export interface BackendRegionResponse {
  summary?: {
    mean?: number | null;
    min?: number | null;
    max?: number | null;
    p90?: number | null;
    displayMean?: number | null;
    displayMin?: number | null;
    displayMax?: number | null;
    displayP90?: number | null;
    validCount?: number;
    totalCount?: number;
  };
  displayUnit?: string;
  isMock?: boolean;
  provenance?: { sourceName?: string };
  series?: number[] | null;
}

/**
 * Links an optional caller AbortSignal to a per-request timeout AbortController so either
 * external cancellation or timeout aborts the request cleanly without listener leaks.
 */
function createLinkedAbortController(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => {
    clearTimeout(timer);
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/**
 * Computes the 8-timestamp diurnal mean time series for any drawn polygon and active variable.
 * Queries backend /api/v1/jukebox/region with includeSeries: true when online, falling back
 * seamlessly to offline raster colormap sampling if unreachable, timed out, or returning empty.
 */
export async function samplePolygonSeries(
  layerKey: LayerKey,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  bounds?: GeoBounds,
  targetTimestamp?: string,
  signal?: AbortSignal
): Promise<number[]> {
  if (signal?.aborted) {
    return [];
  }

  const layer = getLayerDefinition(layerKey);
  if (!layer.available || layerKey === "AOD") {
    return timeSlots.map(() => 0);
  }

  const runOfflineFallback = async (): Promise<number[]> => {
    if (signal?.aborted) return [];
    const results = await Promise.all(
      timeSlots.map((_, idx) =>
        signal?.aborted ? null : samplePolygonStats(layerKey, idx, polygon, boundaryGeometry)
      )
    );
    if (signal?.aborted) return [];
    return results
      .filter((stat): stat is RegionStats => stat !== null)
      .map((stat) => (stat.mean !== null ? stat.mean : layer.vmin));
  };

  if (Date.now() >= backendUnavailableUntil) {
    let cleanupAbort: (() => void) | undefined;
    try {
      const effectiveBounds =
        bounds ??
        (polygon.length > 0
          ? computeBounds(polygon)
          : boundaryGeometry
            ? computePrimaryFocusBounds(boundaryGeometry).bounds
            : computeBounds(polygon));

      const latMin = Number(Math.min(effectiveBounds.south, effectiveBounds.north).toFixed(4));
      const latMax = Number(Math.max(effectiveBounds.south, effectiveBounds.north).toFixed(4));
      const lonMin = Number(Math.min(effectiveBounds.west, effectiveBounds.east).toFixed(4));
      const lonMax = Number(Math.max(effectiveBounds.west, effectiveBounds.east).toFixed(4));

      const linkedAbort = createLinkedAbortController(5000, signal);
      cleanupAbort = linkedAbort.cleanup;
      const serializedRings = serializePolygonRingsForApi(boundaryGeometry ?? polygon, 320);
      const response = await fetch(resolveBackendRequestUrl("/api/v1/jukebox/region"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: linkedAbort.signal,
        body: JSON.stringify({
          datasetId: "geos-cf-v2-aqc",
          timestamp: targetTimestamp ?? timeSlots[0] ?? "2026-11-12T00:30:00Z",
          variable: layerKey,
          includeSeries: true,
          seriesStepHours: 3,
          bounds: {
            latMin,
            latMax,
            lonMin,
            lonMax,
          },
          ...(serializedRings && serializedRings.length > 0 ? { polygons: serializedRings } : {}),
          normalizationMethod: "log_scale",
        }),
      });

      if (signal?.aborted) {
        return [];
      }

      if (response.ok) {
        backendUnavailableUntil = 0;
        const payload = (await response.json()) as BackendRegionResponse;
        if (signal?.aborted) {
          return [];
        }
        if (
          Array.isArray(payload.series) &&
          (payload.series.length === timeSlots.length || payload.series.length > 0) &&
          payload.series.every((val) => typeof val === "number" && !Number.isNaN(val))
        ) {
          return payload.series;
        }
      } else {
        backendUnavailableUntil = Date.now() + 30000;
      }
    } catch {
      if (signal?.aborted) {
        return [];
      }
      backendUnavailableUntil = Date.now() + 30000;
    } finally {
      cleanupAbort?.();
    }
  }

  if (signal?.aborted) {
    return [];
  }
  return runOfflineFallback();
}

export interface PointSeriesResult {
  values: number[];
  sourceKind: "backend-temporal" | "geos-cf-raster";
}

const pointSeriesCache = new Map<string, PointSeriesResult>();

/**
 * Samples a diurnal GEOS-CF curve at a geographic coordinate, preferring FastAPI
 * /api/v1/jukebox/temporal when online and falling back cleanly to local raster PNGs.
 */
export async function samplePointSeriesDetailed(
  layerKey: LayerKey,
  lat: number,
  lon: number,
  fallbackValue?: number
): Promise<PointSeriesResult> {
  const layer = getLayerDefinition(layerKey);
  if (!layer.available || layerKey === "AOD") {
    return { values: [], sourceKind: "geos-cf-raster" };
  }
  const cacheKey = `${layerKey}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const cached = pointSeriesCache.get(cacheKey);
  if (cached) return cached;

  const fallback = fallbackValue ?? layer.vmin;

  if (Date.now() >= backendUnavailableUntil) {
    const start = timeSlots[0] ?? "2026-11-12T00:30:00Z";
    const end = timeSlots[timeSlots.length - 1] ?? "2026-11-12T21:30:00Z";
    const remote = await fetchBackendTemporalSeries({
      lat,
      lon,
      variable: layerKey,
      start,
      end,
      interval: "3h",
      normalizationMethod: "log_scale",
      offlineOnly: true,
    });
    if (remote && remote.points.length > 0) {
      const apiValues = remote.points
        .map((pt) => pt.displayValue ?? pt.value)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .map((v) => Number(v.toFixed(1)));
      if (apiValues.length >= 2) {
        const result: PointSeriesResult = {
          values: apiValues,
          sourceKind: "backend-temporal",
        };
        if (pointSeriesCache.size >= 24) {
          const oldest = pointSeriesCache.keys().next().value;
          if (oldest !== undefined) pointSeriesCache.delete(oldest);
        }
        pointSeriesCache.set(cacheKey, result);
        return result;
      }
    }
  }

  const span = layer.vmax - layer.vmin;
  const values: number[] = [];
  let validCount = 0;

  for (let idx = 0; idx < timeSlots.length; idx += 1) {
    if (idx > 0) await yieldToMain();
    const frame = frameFor(layerKey, idx);
    if (!frame) {
      values.push(fallback);
      continue;
    }
    const grid = await getScalarGrid(frame.imageUrl, layer.cmap, false);
    if (!grid) {
      values.push(fallback);
      continue;
    }
    const t = sampleScalarSmooth(grid, lat, lon);
    if (t < 0) {
      values.push(fallback);
      continue;
    }
    validCount += 1;
    values.push(Number((layer.vmin + t * span).toFixed(1)));
  }

  if (validCount === 0) return { values: [], sourceKind: "geos-cf-raster" };
  const result: PointSeriesResult = { values, sourceKind: "geos-cf-raster" };
  if (pointSeriesCache.size >= 24) {
    const oldest = pointSeriesCache.keys().next().value;
    if (oldest !== undefined) pointSeriesCache.delete(oldest);
  }
  pointSeriesCache.set(cacheKey, result);
  return result;
}

/**
 * Lazily samples an 8-slot diurnal GEOS-CF curve at a geographic coordinate,
 * yielding between frames to keep UI interactions responsive.
 */
export async function samplePointSeries(
  layerKey: LayerKey,
  lat: number,
  lon: number,
  fallbackValue?: number
): Promise<number[]> {
  const result = await samplePointSeriesDetailed(layerKey, lat, lon, fallbackValue);
  return result.values;
}

/**
 * Queries FastAPI /api/v1/jukebox/region when configured & healthy, otherwise falls back cleanly
 * to offline GEOS-CF raster polygon/MultiPolygon sampling without user-facing errors.
 */
export async function fetchBackendRegionStats(
  layerKey: LayerKey,
  timeIndex: number,
  bounds: GeoBounds,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  signal?: AbortSignal
): Promise<RegionStats> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const layer = getLayerDefinition(layerKey);
  if (!layer.available || layerKey === "AOD") {
    return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
  }

  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  const timestamp = timeSlots[safeIndex] ?? "2026-11-12T00:30:00Z";

  if (Date.now() < backendUnavailableUntil) {
    return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
  }

  let cleanupAbort: (() => void) | undefined;
  try {
    const effectiveBounds =
      bounds ??
      (polygon.length > 0
        ? computeBounds(polygon)
        : boundaryGeometry
          ? computePrimaryFocusBounds(boundaryGeometry).bounds
          : computeBounds(polygon));

    const latMin = Number(Math.min(effectiveBounds.south, effectiveBounds.north).toFixed(4));
    const latMax = Number(Math.max(effectiveBounds.south, effectiveBounds.north).toFixed(4));
    const lonMin = Number(Math.min(effectiveBounds.west, effectiveBounds.east).toFixed(4));
    const lonMax = Number(Math.max(effectiveBounds.west, effectiveBounds.east).toFixed(4));

    const linkedAbort = createLinkedAbortController(3500, signal);
    cleanupAbort = linkedAbort.cleanup;
    const serializedRings = serializePolygonRingsForApi(boundaryGeometry ?? polygon, 320);
    const response = await fetch(resolveBackendRequestUrl("/api/v1/jukebox/region"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: linkedAbort.signal,
      body: JSON.stringify({
        datasetId: "geos-cf-v2-aqc",
        timestamp,
        variable: layerKey,
        bounds: {
          latMin,
          latMax,
          lonMin,
          lonMax,
        },
        ...(serializedRings && serializedRings.length > 0 ? { polygons: serializedRings } : {}),
        normalizationMethod: "log_scale",
      }),
    });

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (!response.ok) {
      backendUnavailableUntil = Date.now() + 30000;
      return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
    }

    backendUnavailableUntil = 0;

    const payload = (await response.json()) as BackendRegionResponse;
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const summary = payload.summary;
    const rawMean = summary?.displayMean ?? summary?.mean;
    if (!summary || rawMean == null || Number.isNaN(rawMean)) {
      return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
    }

    const rawMin = summary.displayMin ?? summary.min;
    const min = rawMin != null && !Number.isNaN(rawMin) ? Number(rawMin.toFixed(1)) : null;
    const rawMax = summary.displayMax ?? summary.max;
    const max = rawMax != null && !Number.isNaN(rawMax) ? Number(rawMax.toFixed(1)) : null;
    const rawP90 = summary.displayP90 ?? summary.p90;
    const p90 = rawP90 != null && !Number.isNaN(rawP90) ? Number(rawP90.toFixed(1)) : null;

    const coveragePct =
      summary.totalCount && summary.totalCount > 0 && summary.validCount != null
        ? Math.round((summary.validCount / summary.totalCount) * 100)
        : 100;

    return {
      variable: layerKey,
      unit: payload.displayUnit ?? layer.unit,
      mean: Number(rawMean.toFixed(1)),
      min,
      max,
      p90,
      sampleCount: summary.validCount ?? 0,
      coveragePct,
      timestamp,
      sourceKind: "backend-netcdf",
      sourceLabel: payload.provenance?.sourceName ?? "Backend NetCDF-4 ROI",
      isMock: Boolean(payload.isMock),
      loading: false,
    };
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw err instanceof Error ? err : new DOMException("Aborted", "AbortError");
    }
    backendUnavailableUntil = Date.now() + 30000;
    return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
  } finally {
    cleanupAbort?.();
  }
}

export interface SnapshotOptions {
  center: GeoPoint;
  zoom: number;
  polygon: GeoPoint[];
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  territoryCode?: string;
  variable: LayerKey;
  timeIndex: number;
  seriesPreview?: number[];
  signal?: AbortSignal;
}

const MAX_SNAPSHOT_CACHE = 18;
const snapshotCanvasCache = new Map<string, HTMLCanvasElement>();
const inFlightSnapshots = new Map<string, Promise<HTMLCanvasElement | null>>();
const ringBboxCache = new WeakMap<object, GeoBounds>();
const objectIdCache = new WeakMap<object, number>();
let nextStableObjId = 1;

function getStableObjectId(obj: object): number {
  let id = objectIdCache.get(obj);
  if (id === undefined) {
    id = nextStableObjId++;
    objectIdCache.set(obj, id);
  }
  return id;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getRingBbox(ring: number[][]): GeoBounds {
  const cached = ringBboxCache.get(ring);
  if (cached) return cached;
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (let i = 0; i < ring.length; i += 1) {
    const lon = ring[i][0];
    const lat = ring[i][1];
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const bbox: GeoBounds = { west, south, east, north };
  ringBboxCache.set(ring, bbox);
  return bbox;
}

function buildSnapshotCacheKey(
  width: number,
  height: number,
  resolvedLayerKey: LayerKey,
  options: SnapshotOptions
): string {
  const geomPart = options.boundaryGeometry
    ? `g${getStableObjectId(options.boundaryGeometry)}`
    : options.polygon.length > 0
      ? `p${getStableObjectId(options.polygon)}-${options.polygon.length}`
      : "p0";
  const seriesPart =
    options.seriesPreview && options.seriesPreview.length > 0
      ? options.seriesPreview.map((v) => v.toFixed(1)).join(",")
      : "";
  return [
    `${width}x${height}`,
    resolvedLayerKey,
    options.timeIndex,
    options.center.lat.toFixed(3),
    options.center.lon.toFixed(3),
    options.zoom.toFixed(2),
    options.territoryCode ?? "",
    geomPart,
    seriesPart,
  ].join("|");
}

function getCachedSnapshot(key: string): HTMLCanvasElement | undefined {
  const existing = snapshotCanvasCache.get(key);
  if (!existing) return undefined;
  snapshotCanvasCache.delete(key);
  snapshotCanvasCache.set(key, existing);
  return existing;
}

function setCachedSnapshot(key: string, canvas: HTMLCanvasElement): void {
  if (snapshotCanvasCache.has(key)) {
    snapshotCanvasCache.delete(key);
  } else if (snapshotCanvasCache.size >= MAX_SNAPSHOT_CACHE) {
    const oldest = snapshotCanvasCache.keys().next().value;
    if (oldest !== undefined) snapshotCanvasCache.delete(oldest);
  }
  snapshotCanvasCache.set(key, canvas);
}

const SNAPSHOT_LON_SHIFTS = [0, -360, 360] as const;

function strokeVisibleRingShifts(
  ctx: CanvasRenderingContext2D,
  ring: number[][],
  west: number,
  south: number,
  east: number,
  north: number,
  projX: (lon: number) => number,
  projY: (lat: number) => number,
  maxVertices: number
): void {
  if (ring.length < 3) return;
  const rb = getRingBbox(ring);
  if (rb.north < south || rb.south > north) return;
  const stride = ring.length > maxVertices ? Math.ceil(ring.length / maxVertices) : 1;

  for (let s = 0; s < SNAPSHOT_LON_SHIFTS.length; s += 1) {
    const shift = SNAPSHOT_LON_SHIFTS[s];
    if (rb.east + shift < west || rb.west + shift > east) continue;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < ring.length; i += stride) {
      const px = projX(ring[i][0] + shift);
      const py = projY(ring[i][1]);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

async function computeSnapshotCanvas(
  width: number,
  height: number,
  options: SnapshotOptions
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  const layer = getLayerDefinition(options.variable);
  const effectiveKey: LayerKey = layer.available ? options.variable : "PM25_RH35";
  const effectiveLayer = getLayerDefinition(effectiveKey);
  const frame = frameFor(effectiveKey, options.timeIndex);

  const [wbMod, scalarGrid] = await Promise.all([
    import("./worldBoundaries").catch(() => null),
    frame && effectiveLayer.available
      ? getScalarGrid(frame.imageUrl, effectiveLayer.cmap, false)
      : Promise.resolve(null),
  ]);

  const boundaries = wbMod
    ? (wbMod.getCachedWorldBoundaries() ?? (await wbMod.loadWorldBoundariesQuick()))
    : null;

  const baseRaster = !boundaries
    ? await loadRasterPixels("/images/earth-blue-marble.png", 1200)
    : null;

  // Yield cleanly before canvas pixel/vector composition to avoid >50ms UI stalls when multiple cards mount
  await yieldToMain();

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const ctx = outCanvas.getContext("2d");
  if (!ctx) return null;

  const spanLon = Math.min(115, Math.max(5.5, 165 / Math.pow(1.62, Math.max(1, options.zoom - 1.5))));
  const spanLat = spanLon * (height / width) * Math.max(0.5, Math.cos((options.center.lat * Math.PI) / 180));
  const west = options.center.lon - spanLon / 2;
  const east = options.center.lon + spanLon / 2;
  const north = Math.min(84, options.center.lat + spanLat / 2);
  const south = Math.max(-84, options.center.lat - spanLat / 2);
  const lonSpan = Math.max(1e-6, east - west);
  const latSpan = Math.max(1e-6, north - south);

  if ((scalarGrid && effectiveLayer.available) || baseRaster) {
    const imgData = ctx.createImageData(width, height);
    const out = imgData.data;
    const lons = new Float64Array(width);
    for (let px = 0; px < width; px += 1) {
      lons[px] = west + (px / Math.max(1, width - 1)) * lonSpan;
    }
    const pxScratch = new Uint8ClampedArray(4);

    for (let py = 0; py < height; py += 1) {
      const lat = north - (py / Math.max(1, height - 1)) * latSpan;
      const rowOffset = py * width * 4;
      for (let px = 0; px < width; px += 1) {
        const lon = lons[px];
        let r = 20;
        let g = 46;
        let b = 44;

        if (!boundaries && baseRaster) {
          const [br, bg, bb] = sampleEquirectangularPixel(baseRaster, lat, lon);
          r = Math.round(br * 0.45 + 12);
          g = Math.round(bg * 0.55 + 22);
          b = Math.round(bb * 0.52 + 20);
        }

        if (scalarGrid && effectiveLayer.available) {
          const t = sampleScalarSmooth(scalarGrid, lat, lon);
          if (t >= 0.18 && writeEditorialRgba(t, pxScratch, 0)) {
            const alpha = (pxScratch[3] / 255) * 0.8;
            r = Math.round(r * (1 - alpha) + pxScratch[0] * alpha);
            g = Math.round(g * (1 - alpha) + pxScratch[1] * alpha);
            b = Math.round(b * (1 - alpha) + pxScratch[2] * alpha);
          }
        }

        const dst = rowOffset + px * 4;
        out[dst] = r;
        out[dst + 1] = g;
        out[dst + 2] = b;
        out[dst + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else {
    ctx.fillStyle = boundaries ? "#142e2c" : "#16312f";
    ctx.fillRect(0, 0, width, height);
  }

  const projX = (lon: number) => ((lon - west) / lonSpan) * width;
  const projY = (lat: number) => ((north - lat) / latSpan) * height;

  // Viewport-culled vector land polygons + international border lines
  if (boundaries) {
    ctx.save();
    ctx.fillStyle = "rgba(224, 238, 228, 0.08)";
    ctx.strokeStyle = "rgba(224, 238, 228, 0.34)";
    ctx.lineWidth = 0.85;

    for (const feat of boundaries.countries.features) {
      const geom = feat.geometry;
      if (geom.type === "Polygon" && geom.coordinates[0]) {
        strokeVisibleRingShifts(ctx, geom.coordinates[0], west, south, east, north, projX, projY, 220);
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          if (poly[0]) {
            strokeVisibleRingShifts(ctx, poly[0], west, south, east, north, projX, projY, 220);
          }
        }
      }
    }
    ctx.restore();
  }

  // Subtle coordinate graticule
  ctx.strokeStyle = "rgba(246, 245, 240, 0.14)";
  ctx.lineWidth = 0.75;
  for (let i = 1; i <= 3; i += 1) {
    const gx = (width * i) / 4;
    const gy = (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }

  // Highlighted geographic boundary (full MultiPolygon territory border when available, or drawn ring)
  let resolvedGeom = options.boundaryGeometry;
  if (!resolvedGeom && options.territoryCode && boundaries && wbMod) {
    const feat = wbMod.findTerritoryFeature(boundaries, options.territoryCode);
    if (feat && (feat.geometry.type === "Polygon" || feat.geometry.type === "MultiPolygon")) {
      resolvedGeom = feat.geometry;
    }
  }

  if (resolvedGeom) {
    const polys = getGeometryPolygons(resolvedGeom);
    ctx.save();
    ctx.beginPath();
    for (const rings of polys) {
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const rb = getRingBbox(ring);
        if (rb.north < south || rb.south > north) continue;
        const shift = SNAPSHOT_LON_SHIFTS.find(
          (s) => rb.east + s >= west && rb.west + s <= east
        );
        if (shift === undefined) continue;
        const stride = ring.length > 360 ? Math.ceil(ring.length / 360) : 1;
        let started = false;
        for (let i = 0; i < ring.length; i += stride) {
          const px = projX(ring[i][0] + shift);
          const py = projY(ring[i][1]);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
      }
    }
    ctx.fillStyle = "rgba(224, 235, 228, 0.22)";
    ctx.fill("evenodd");
    ctx.lineWidth = 1.65;
    ctx.strokeStyle = "#f6f5f0";
    ctx.stroke();
    ctx.restore();
  } else if (options.polygon.length >= 3) {
    ctx.save();
    ctx.beginPath();
    options.polygon.forEach((pt, idx) => {
      const px = projX(pt.lon);
      const py = projY(pt.lat);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(224, 235, 228, 0.2)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f6f5f0";
    ctx.stroke();
    ctx.restore();
  }

  // Bottom vignette + data-derived acoustic silhouette
  const grad = ctx.createLinearGradient(0, height * 0.52, 0, height);
  grad.addColorStop(0, "rgba(18, 38, 36, 0)");
  grad.addColorStop(1, "rgba(18, 38, 36, 0.82)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, height * 0.52, width, height * 0.48);

  if (options.seriesPreview && options.seriesPreview.length > 1) {
    const vals = options.seriesPreview;
    const minV = Math.min(...vals);
    const maxV = Math.max(minV + 0.01, Math.max(...vals));
    ctx.save();
    ctx.beginPath();
    const baseLine = height - 12;
    const chartH = 22;
    vals.forEach((v, idx) => {
      const x = 14 + (idx / (vals.length - 1)) * (width - 88);
      const norm = (v - minV) / (maxV - minV);
      const y = baseLine - norm * chartH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(224, 235, 228, 0.86)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  return outCanvas;
}

/**
 * Renders a genuine map-derived thumbnail into a 2D canvas:
 * NASA GEOS-CF scalar grid + viewport-culled Quick/cached vector boundaries + geographic outline + sonic signature.
 */
export async function renderMapSnapshotToCanvas(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions
): Promise<void> {
  if (options.signal?.aborted) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const layer = getLayerDefinition(options.variable);
  const resolvedLayerKey: LayerKey = layer.available ? options.variable : "PM25_RH35";
  const cacheKey = buildSnapshotCacheKey(width, height, resolvedLayerKey, options);

  const cached = getCachedSnapshot(cacheKey);
  if (cached) {
    ctx.drawImage(cached, 0, 0);
    return;
  }

  // Paint instant dark substrate while async assets decode so the frame never flashes blank
  ctx.fillStyle = "#142e2c";
  ctx.fillRect(0, 0, width, height);

  let job = inFlightSnapshots.get(cacheKey);
  if (!job) {
    job = computeSnapshotCanvas(width, height, options)
      .then((rendered) => {
        if (rendered) {
          setCachedSnapshot(cacheKey, rendered);
        }
        return rendered;
      })
      .finally(() => {
        inFlightSnapshots.delete(cacheKey);
      });
    inFlightSnapshots.set(cacheKey, job);
  }

  const rendered = await job;
  if (options.signal?.aborted || !rendered) return;
  ctx.drawImage(rendered, 0, 0);
}
