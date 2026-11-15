// Web Worker for off-thread BREATHE Earth & NASA GEOS-CF v2 Web Mercator tile reprojection.
// Mirrors pixel sampling and colormapping from src/lib/geosCfRaster.ts without blocking the UI thread.

const TILE_SIZE = 256;

/** @type {Record<string, Array<[number, number, number]>> | null} */
let expandedLuts = null;
let lutBins = 128;
/** @type {[number, number, number]} */
let bgMaskRgb = [7, 11, 20];
/** @type {{ northernVietnam: { url: string; bounds: { west: number; south: number; east: number; north: number } }; ninhThuan: { url: string; bounds: { west: number; south: number; east: number; north: number } } } | null} */
let regionCrops = null;

/** @type {Map<string, Promise<{ width: number; height: number; data: Uint8ClampedArray } | null>>} */
const rasterCache = new Map();
/** @type {WeakMap<object, { width: number; height: number; data: Uint8ClampedArray }>} */
const displayRasterCache = new WeakMap();
/** @type {Map<string, Promise<{ width: number; height: number; norms: Float32Array } | null>>} */
const scalarGridCache = new Map();
const MAX_SCALAR_GRID_CACHE = 16;

const HASH_SLOTS = 4096;
/** @type {Record<string, { keys: Int32Array; vals: Float32Array }>} */
const decodeMemoByCmap = {};

function getDecodeMemo(cmap) {
  let memo = decodeMemoByCmap[cmap];
  if (!memo) {
    const keys = new Int32Array(HASH_SLOTS);
    keys.fill(-1);
    const vals = new Float32Array(HASH_SLOTS);
    memo = { keys, vals };
    decodeMemoByCmap[cmap] = memo;
  }
  return memo;
}

/**
 * Fetches and decodes a raster asset once inside this worker via OffscreenCanvas.
 * @param {string} url
 * @param {number} targetWidth
 */
function loadRasterPixels(url, targetWidth) {
  const safeUrl = new URL(url, self.location.origin).href;
  const key = `${safeUrl}::${targetWidth}`;
  const cached = rasterCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetch(safeUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${safeUrl}`);
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, targetWidth / bitmap.width);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("OffscreenCanvas 2D context unavailable");
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      return { width, height, data };
    } finally {
      bitmap.close();
    }
  })().catch((err) => {
    rasterCache.delete(key);
    throw err;
  });

  rasterCache.set(key, promise);
  return promise;
}

/**
 * Fill isolated black render gaps without modifying source measurement buffers.
 * @param {{ width: number; height: number; data: Uint8ClampedArray }} source
 */
function displayRaster(source) {
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

function decodeColormapNormalized(r, g, b, a, cmap) {
  if (a < 24 || !expandedLuts) return null;
  const packed = (r << 16) | (g << 8) | b;
  const memo = getDecodeMemo(cmap);
  const slot = ((packed * 2654435761) >>> 20) & (HASH_SLOTS - 1);
  if (memo.keys[slot] === packed) {
    const cached = memo.vals[slot];
    return cached < 0 ? null : cached;
  }

  const drBg = r - bgMaskRgb[0];
  const dgBg = g - bgMaskRgb[1];
  const dbBg = b - bgMaskRgb[2];
  if (drBg * drBg + dgBg * dgBg + dbBg * dbBg < 180) {
    memo.keys[slot] = packed;
    memo.vals[slot] = -1;
    return null;
  }

  const lut = expandedLuts[cmap];
  if (!lut) return null;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lutBins; i += 1) {
    const entry = lut[i];
    const dr = r - entry[0];
    const dg = g - entry[1];
    const db = b - entry[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const norm = bestIdx / (lutBins - 1);
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
function smoothDisplayNorms(norms, width, height) {
  // Infill isolated inland no-data gaps (holes) where cells are surrounded by valid data
  // Ocean has few/no valid neighbors, while inland gaps are surrounded by valid land cells
  const infilled = new Float32Array(norms);
  for (let pass = 0; pass < 4; pass += 1) {
    let filledCount = 0;
    for (let y = 1; y < height - 1; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const centerIdx = rowOffset + x;
        if (infilled[centerIdx] >= 0) continue;
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
            if (v >= 0) {
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
      if (centerVal < 0) {
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
        if (v >= 0) {
          const w = weights[k + 2];
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
      if (centerVal < 0) {
        out[centerIdx] = -1;
        continue;
      }
      let sum = 0;
      let wSum = 0;
      for (let k = -2; k <= 2; k += 1) {
        const ny = y + k;
        if (ny >= 0 && ny < height) {
          const v = temp[ny * width + x];
          if (v >= 0) {
            const w = weights[k + 2];
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
 * Decodes each (imageUrl, cmap) display frame once into a compact normalized Float32Array (-1 masked)
 * so Mercator overlay tiles only perform O(1) bilinear scalar interpolation per pixel.
 */
function getDisplayScalarGrid(imageUrl, cmap) {
  const safeUrl = new URL(imageUrl, self.location.origin).href;
  const key = `${safeUrl}::${cmap}`;
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

  const promise = (async () => {
    const original = await loadRasterPixels(imageUrl, 2048);
    const raster = original ? displayRaster(original) : null;
    if (!raster) return null;
    const total = raster.width * raster.height;
    const norms = new Float32Array(total);
    const data = raster.data;
    for (let i = 0; i < total; i += 1) {
      const idx = i * 4;
      const t = decodeColormapNormalized(data[idx], data[idx + 1], data[idx + 2], data[idx + 3], cmap);
      norms[i] = t === null ? -1 : t;
    }
    const smoothedNorms = smoothDisplayNorms(norms, raster.width, raster.height);
    return { width: raster.width, height: raster.height, norms: smoothedNorms };
  })().catch((err) => {
    scalarGridCache.delete(key);
    throw err;
  });

  scalarGridCache.set(key, promise);
  return promise;
}

function sampleScalarSmooth(grid, lat, lon) {
  const x = (((((lon + 180) % 360) + 360) % 360) / 360) * grid.width - 0.5;
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

function sampleEquirectangularPixel(raster, lat, lon) {
  const xNorm = ((((lon + 180) % 360) + 360) % 360) / 360;
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

function sampleBoundsImage(raster, lat, lon, bounds) {
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

function edgeFeatherAlpha(lat, lon, bounds) {
  const dx = Math.min(lon - bounds.west, bounds.east - lon) / Math.max(0.5, (bounds.east - bounds.west) * 0.14);
  const dy = Math.min(lat - bounds.south, bounds.north - lat) / Math.max(0.5, (bounds.north - bounds.south) * 0.14);
  return Math.max(0, Math.min(1, Math.min(dx, dy)));
}

function writeEditorialRgba(t, out, dst) {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped < 0.18) return false;
  let r;
  let g;
  let b;
  let a;
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

async function renderBaseTile(z, x, y) {
  const scale = 2 ** z;
  const [baseRaster, cloudsRaster, northVnRaster, ninhThuanRaster] = await Promise.all([
    loadRasterPixels("/images/earth-blue-marble.png", 1600),
    loadRasterPixels("/images/earth-clouds-hires.jpg", 1024).catch(() => null),
    z >= 3 && regionCrops ? loadRasterPixels(regionCrops.northernVietnam.url, 1024).catch(() => null) : Promise.resolve(null),
    z >= 4 && regionCrops ? loadRasterPixels(regionCrops.ninhThuan.url, 1024).catch(() => null) : Promise.resolve(null),
  ]);

  const out = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  if (!baseRaster) {
    throw new Error("Base Earth raster unavailable in worker");
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

      if (northVnRaster && regionCrops) {
        const crop = sampleBoundsImage(northVnRaster, lat, lon, regionCrops.northernVietnam.bounds);
        if (crop) {
          const a = edgeFeatherAlpha(lat, lon, regionCrops.northernVietnam.bounds) * 0.72;
          r = Math.round(r * (1 - a) + crop[0] * a);
          g = Math.round(g * (1 - a) + crop[1] * a);
          b = Math.round(b * (1 - a) + crop[2] * a);
        }
      }
      if (ninhThuanRaster && regionCrops) {
        const crop = sampleBoundsImage(ninhThuanRaster, lat, lon, regionCrops.ninhThuan.bounds);
        if (crop) {
          const a = edgeFeatherAlpha(lat, lon, regionCrops.ninhThuan.bounds) * 0.78;
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

  return { empty: false, out };
}

async function renderOverlayTile(imageUrl, cmap, z, x, y) {
  const grid = await getDisplayScalarGrid(imageUrl, cmap);
  if (!grid) return { empty: true, out: null };

  const out = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
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

  return hasOpaque ? { empty: false, out } : { empty: true, out: null };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "init") {
    expandedLuts = msg.expandedLuts ?? null;
    lutBins = typeof msg.lutBins === "number" ? msg.lutBins : 128;
    bgMaskRgb = Array.isArray(msg.bgMaskRgb) ? msg.bgMaskRgb : [7, 11, 20];
    regionCrops = msg.regionCrops ?? null;
    return;
  }

  if (msg.type === "preloadBase") {
    const { id } = msg;
    try {
      await Promise.all([
        loadRasterPixels("/images/earth-blue-marble.png", 1600),
        loadRasterPixels("/images/earth-clouds-hires.jpg", 1024).catch(() => null),
      ]);
      self.postMessage({ id, status: "ok", empty: true });
    } catch (err) {
      self.postMessage({
        id,
        status: "error",
        message: err instanceof Error ? err.message : "Base preload error",
      });
    }
    return;
  }

  if (msg.type === "preloadOverlay") {
    if (typeof msg.imageUrl === "string" && typeof msg.cmap === "string") {
      getDisplayScalarGrid(msg.imageUrl, msg.cmap).catch(() => undefined);
    }
    return;
  }

  if (msg.type !== "renderTile") return;
  const { id, kind, z, x, y, cmap, imageUrl } = msg;

  try {
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
      self.postMessage({ id, status: "ok", empty: true });
      return;
    }

    if (kind === "base") {
      const result = await renderBaseTile(z, x, y);
      self.postMessage(
        { id, status: "ok", empty: false, buffer: result.out.buffer },
        [result.out.buffer]
      );
      return;
    }

    if (kind === "overlay" && typeof imageUrl === "string" && typeof cmap === "string") {
      const result = await renderOverlayTile(imageUrl, cmap, z, x, y);
      if (result.empty || !result.out) {
        self.postMessage({ id, status: "ok", empty: true });
        return;
      }
      self.postMessage(
        { id, status: "ok", empty: false, buffer: result.out.buffer },
        [result.out.buffer]
      );
      return;
    }

    self.postMessage({ id, status: "ok", empty: true });
  } catch (err) {
    self.postMessage({
      id,
      status: "error",
      message: err instanceof Error ? err.message : "Tile worker error",
    });
  }
};
