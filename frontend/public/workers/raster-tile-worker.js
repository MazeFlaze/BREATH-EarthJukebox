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
  const drBg = r - bgMaskRgb[0];
  const dgBg = g - bgMaskRgb[1];
  const dbBg = b - bgMaskRgb[2];
  if (drBg * drBg + dgBg * dgBg + dbBg * dbBg < 180) return null;

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
  return bestIdx / (lutBins - 1);
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

function sampleEquirectangularSmooth(raster, lat, lon) {
  const x = (((((lon + 180) % 360) + 360) % 360) / 360) * raster.width - 0.5;
  const y = Math.max(0, Math.min(raster.height - 1, ((90 - lat) / 180) * raster.height - 0.5));
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
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  return [
    data[a] * w00 + data[b] * w10 + data[c] * w01 + data[d] * w11,
    data[a + 1] * w00 + data[b + 1] * w10 + data[c + 1] * w01 + data[d + 1] * w11,
    data[a + 2] * w00 + data[b + 2] * w10 + data[c + 2] * w01 + data[d + 2] * w11,
    data[a + 3] * w00 + data[b + 3] * w10 + data[c + 3] * w01 + data[d + 3] * w11,
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

function intensityToEditorialRgba(t) {
  const clamped = Math.max(0, Math.min(1, t));
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
  const original = await loadRasterPixels(imageUrl, 1280);
  const raster = original ? displayRaster(original) : null;
  if (!raster) return { empty: true, out: null };

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
      const [r, g, b, a] = sampleEquirectangularSmooth(raster, lat, lons[px]);
      const t = decodeColormapNormalized(r, g, b, a, cmap);
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
