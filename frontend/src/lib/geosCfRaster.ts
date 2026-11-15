import * as maplibregl from "maplibre-gl";
import { frameFor, getLayerDefinition, timeSlots } from "@/lib/breatheData";
import {
  computeBounds,
  findInteriorPoint,
  getGeometryPolygons,
  pointInPolygon,
  pointInPolygonCoords,
  serializePolygonRingsForApi,
} from "@/lib/geoUtils";
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
  const drBg = r - BG_MASK_RGB[0];
  const dgBg = g - BG_MASK_RGB[1];
  const dbBg = b - BG_MASK_RGB[2];
  const bgDistSq = drBg * drBg + dgBg * dgBg + dbBg * dbBg;
  if (bgDistSq < 180) return null;

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
  return bestIdx / (LUT_BINS - 1);
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
  return loadRasterPixels(frame.imageUrl, 1280);
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
  try {
    for (let i = 0; i < TILE_WORKER_COUNT; i += 1) {
      const worker = new Worker("/workers/raster-tile-worker.js");
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

    const original = await loadRasterPixels(frame.imageUrl, 1280);
    const raster = original ? displayRaster(original) : null;
    if (!raster) return "EMPTY";

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
        const [r, g, b, a] = sampleEquirectangularSmooth(raster, lat, lons[px]);
        const t = decodeColormapNormalized(r, g, b, a, layer.cmap);
        const dst = rowOffset + px * 4;
        if (t !== null) {
          const [or, og, ob, oa] = intensityToEditorialRgba(t);
          if (oa > 0) {
            hasOpaque = true;
            out[dst] = or;
            out[dst + 1] = og;
            out[dst + 2] = ob;
            out[dst + 3] = oa;
          }
        }
      }
    }
    return hasOpaque ? out : "EMPTY";
  }

  return "EMPTY";
}

async function tileEntryToProtocolResponse(
  entry: TileCacheEntry
): Promise<maplibregl.GetResourceResponse<maplibregl.AddProtocolResponseData>> {
  if (entry === "EMPTY") {
    return { data: new ArrayBuffer(0) };
  }

  if (typeof ImageData !== "undefined") {
    const imgData = new ImageData(new Uint8ClampedArray(entry), TILE_SIZE, TILE_SIZE);
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(imgData);
        return { data: bitmap };
      } catch {
        // Fall through to canvas PNG encoding
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { data: new ArrayBuffer(0) };
    ctx.putImageData(imgData, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return { data: new ArrayBuffer(0) };
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
        return tileEntryToProtocolResponse(cached);
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

      return tileEntryToProtocolResponse(resolved);
    }
  );
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

  const raster = await loadRasterPixels(frame.imageUrl, 1280);
  if (!raster) {
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

  const values: number[] = [];
  let weightedSum = 0;
  let weightTotal = 0;
  let checkedCells = 0;
  const visited = new Set<number>();

  const scanBounds = (
    b: GeoBounds,
    hitTest: (lat: number, lon: number) => boolean
  ) => {
    const xMin = Math.max(0, Math.floor(((b.west + 180) / 360) * raster.width));
    const xMax = Math.min(raster.width - 1, Math.ceil(((b.east + 180) / 360) * raster.width));
    const yMin = Math.max(0, Math.floor(((90 - b.north) / 180) * raster.height));
    const yMax = Math.min(raster.height - 1, Math.ceil(((90 - b.south) / 180) * raster.height));

    const spanX = Math.max(1, xMax - xMin);
    const spanY = Math.max(1, yMax - yMin);
    const stepX = Math.max(1, Math.floor(spanX / 36));
    const stepY = Math.max(1, Math.floor(spanY / 36));

    for (let py = yMin; py <= yMax; py += stepY) {
      const lat = 90 - ((py + 0.5) / raster.height) * 180;
      const cosW = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
      for (let px = xMin; px <= xMax; px += stepX) {
        const cellKey = py * raster.width + px;
        if (visited.has(cellKey)) continue;
        const lon = ((px + 0.5) / raster.width) * 360 - 180;
        if (!hitTest(lat, lon)) continue;
        visited.add(cellKey);
        checkedCells += 1;
        const idx = cellKey * 4;
        const t = decodeColormapNormalized(
          raster.data[idx],
          raster.data[idx + 1],
          raster.data[idx + 2],
          raster.data[idx + 3],
          layer.cmap
        );
        if (t === null) continue;
        const val = layer.vmin + t * (layer.vmax - layer.vmin);
        values.push(val);
        weightedSum += val * cosW;
        weightTotal += cosW;
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

  // Fallback to interior point sample for micro-territories smaller than one raster cell
  if (values.length === 0) {
    const samplePt = findInteriorPoint(boundaryGeometry ?? polygon);
    if (samplePt) {
      const [r, g, b, a] = sampleEquirectangularPixel(raster, samplePt.lat, samplePt.lon);
      const t = decodeColormapNormalized(r, g, b, a, layer.cmap);
      if (t !== null) {
        const val = layer.vmin + t * (layer.vmax - layer.vmin);
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
 * Computes the 8-timestamp diurnal mean time series for any drawn polygon and active variable.
 */
export async function samplePolygonSeries(
  layerKey: LayerKey,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Promise<number[]> {
  const layer = getLayerDefinition(layerKey);
  if (!layer.available || layerKey === "AOD") {
    return timeSlots.map(() => 0);
  }
  const results = await Promise.all(
    timeSlots.map((_, idx) => samplePolygonStats(layerKey, idx, polygon, boundaryGeometry))
  );
  return results.map((stat) => (stat.mean !== null ? stat.mean : layer.vmin));
}

let backendUnavailableUntil = 0;

/**
 * Queries FastAPI /api/v1/jukebox/region when configured & healthy, otherwise falls back cleanly
 * to offline GEOS-CF raster polygon/MultiPolygon sampling without user-facing errors.
 */
export async function fetchBackendRegionStats(
  layerKey: LayerKey,
  timeIndex: number,
  bounds: GeoBounds,
  polygon: GeoPoint[],
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Promise<RegionStats> {
  const layer = getLayerDefinition(layerKey);
  if (!layer.available || layerKey === "AOD") {
    return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  const timestamp = timeSlots[safeIndex] ?? "2026-11-12T00:30:00Z";

  if (!baseUrl || Date.now() < backendUnavailableUntil) {
    return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const serializedRings = serializePolygonRingsForApi(boundaryGeometry ?? polygon, 320);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/jukebox/region`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        datasetId: "geos-cf-v2-aqc",
        timestamp,
        variable: layerKey,
        bounds: {
          latMin: Number(bounds.south.toFixed(4)),
          latMax: Number(bounds.north.toFixed(4)),
          lonMin: Number(bounds.west.toFixed(4)),
          lonMax: Number(bounds.east.toFixed(4)),
        },
        ...(serializedRings && serializedRings.length > 0 ? { polygons: serializedRings } : {}),
        normalizationMethod: "log_scale",
      }),
    });
    clearTimeout(timer);

    if (!response.ok) {
      backendUnavailableUntil = Date.now() + 30000;
      return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
    }

    const payload = (await response.json()) as {
      summary?: {
        displayMean?: number | null;
        displayP90?: number | null;
        displayMax?: number | null;
        validCount?: number;
        totalCount?: number;
      };
      displayUnit?: string;
      isMock?: boolean;
      provenance?: { sourceName?: string };
    };

    const summary = payload.summary;
    if (!summary || summary.displayMean == null) {
      return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
    }

    const coveragePct =
      summary.totalCount && summary.totalCount > 0 && summary.validCount != null
        ? Math.round((summary.validCount / summary.totalCount) * 100)
        : 100;

    return {
      variable: layerKey,
      unit: payload.displayUnit ?? layer.unit,
      mean: Number(summary.displayMean.toFixed(1)),
      min: null,
      max: summary.displayMax != null ? Number(summary.displayMax.toFixed(1)) : null,
      p90: summary.displayP90 != null ? Number(summary.displayP90.toFixed(1)) : null,
      sampleCount: summary.validCount ?? 0,
      coveragePct,
      timestamp,
      sourceKind: "backend-netcdf",
      sourceLabel: payload.provenance?.sourceName ?? "Backend NetCDF-4 ROI",
      isMock: Boolean(payload.isMock),
      loading: false,
    };
  } catch {
    backendUnavailableUntil = Date.now() + 30000;
    return samplePolygonStats(layerKey, timeIndex, polygon, boundaryGeometry);
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
}

/**
 * Renders a genuine map-derived thumbnail into a 2D canvas:
 * NASA Blue Marble + regional crop + GEOS-CF pollutant field + geographic polygon outline + sonic signature.
 */
export async function renderMapSnapshotToCanvas(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const layer = getLayerDefinition(options.variable);
  const frame = frameFor(layer.available ? options.variable : "PM25_RH35", options.timeIndex);

  const [baseRaster, overlayRaster, boundaries] = await Promise.all([
    loadRasterPixels("/images/earth-blue-marble.png", 1200),
    frame ? loadRasterPixels(frame.imageUrl, 960) : Promise.resolve(null),
    import("./worldBoundaries").then((m) => m.loadWorldBoundaries()).catch(() => null),
  ]);

  const spanLon = Math.min(115, Math.max(5.5, 165 / Math.pow(1.62, Math.max(1, options.zoom - 1.5))));
  const spanLat = spanLon * (height / width) * Math.max(0.5, Math.cos((options.center.lat * Math.PI) / 180));
  const west = options.center.lon - spanLon / 2;
  const east = options.center.lon + spanLon / 2;
  const north = Math.min(84, options.center.lat + spanLat / 2);
  const south = Math.max(-84, options.center.lat - spanLat / 2);

  if (baseRaster) {
    const imgData = ctx.createImageData(width, height);
    const out = imgData.data;
    for (let py = 0; py < height; py += 1) {
      const lat = north - (py / (height - 1)) * (north - south);
      for (let px = 0; px < width; px += 1) {
        const lon = west + (px / (width - 1)) * (east - west);
        // Deep cartographic substrate so borders + NASA GEOS-CF plumes stay crisp at any zoom
        let r = 20;
        let g = 46;
        let b = 44;

        if (!boundaries) {
          const [br, bg, bb] = sampleEquirectangularPixel(baseRaster, lat, lon);
          r = Math.round(br * 0.45 + 12);
          g = Math.round(bg * 0.55 + 22);
          b = Math.round(bb * 0.52 + 20);
        }

        if (overlayRaster && layer.available) {
          const [or, og, ob, oa] = sampleEquirectangularPixel(overlayRaster, lat, lon);
          const t = decodeColormapNormalized(or, og, ob, oa, layer.cmap);
          if (t !== null) {
            const [er, eg, eb, eAlpha] = intensityToEditorialRgba(t);
            const alpha = (eAlpha / 255) * 0.8;
            r = Math.round(r * (1 - alpha) + er * alpha);
            g = Math.round(g * (1 - alpha) + eg * alpha);
            b = Math.round(b * (1 - alpha) + eb * alpha);
          }
        }

        const dst = (py * width + px) * 4;
        out[dst] = r;
        out[dst + 1] = g;
        out[dst + 2] = b;
        out[dst + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else {
    ctx.fillStyle = "#16312f";
    ctx.fillRect(0, 0, width, height);
  }

  // Crisp vector land polygons + international border lines in thumbnail viewport
  if (boundaries) {
    const projX = (lon: number) => ((lon - west) / (east - west)) * width;
    const projY = (lat: number) => ((north - lat) / (north - south)) * height;

    ctx.save();
    ctx.fillStyle = "rgba(224, 238, 228, 0.08)";
    ctx.strokeStyle = "rgba(224, 238, 228, 0.34)";
    ctx.lineWidth = 0.85;

    const strokeRing = (ring: number[][]) => {
      if (ring.length < 2) return;
      ctx.beginPath();
      ring.forEach(([lon, lat], idx) => {
        const px = projX(lon);
        const py = projY(lat);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    for (const feat of boundaries.countries.features) {
      const geom = feat.geometry;
      if (geom.type === "Polygon" && geom.coordinates[0]) {
        strokeRing(geom.coordinates[0]);
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          if (poly[0]) strokeRing(poly[0]);
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
  if (!resolvedGeom && options.territoryCode && boundaries) {
    const wbMod = await import("./worldBoundaries").catch(() => null);
    const feat = wbMod?.findTerritoryFeature(boundaries, options.territoryCode);
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
        ring.forEach(([lon, lat], idx) => {
          const px = ((lon - west) / (east - west)) * width;
          const py = ((north - lat) / (north - south)) * height;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
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
      const px = ((pt.lon - west) / (east - west)) * width;
      const py = ((north - pt.lat) / (north - south)) * height;
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
}
