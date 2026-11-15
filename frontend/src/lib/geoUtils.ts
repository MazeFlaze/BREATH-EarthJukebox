import type { GeoBounds, GeoPoint } from "@/types/breathe";

const EARTH_RADIUS_KM = 6371.0088;

export function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

export function normalizeLon(lon: number): number {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

/**
 * Computes approximate spherical polygon area in square kilometers
 * using the spherical excess / shoelace projected onto local parallels.
 */
export function approximateAreaKm2(points: GeoPoint[]): number {
  if (points.length < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    total += (p2.lon - p1.lon) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
  }
  const area = Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
  return Math.round(area);
}

export function computeBounds(points: GeoPoint[]): GeoBounds {
  if (!points.length) {
    return { west: 103, south: 19, east: 108.5, north: 23.4 };
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return { west, south, east, north };
}

export function computeCentroid(points: GeoPoint[]): GeoPoint {
  if (!points.length) return { lat: 21, lon: 105.75 };
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  return { lat, lon };
}

export function pointInPolygon(lat: number, lon: number, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon;
    const yi = polygon[i].lat;
    const xj = polygon[j].lon;
    const yj = polygon[j].lat;
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonToGeoJSONFeature(
  points: GeoPoint[],
  properties: Record<string, unknown> = {}
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (points.length < 3) return null;
  const ring = points.map((p) => [p.lon, p.lat] as [number, number]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

function perpendicularDistance(point: GeoPoint, start: GeoPoint, end: GeoPoint): number {
  const dx = end.lon - start.lon;
  const dy = end.lat - start.lat;
  const magSq = dx * dx + dy * dy;
  if (magSq === 0) {
    return Math.hypot(point.lon - start.lon, point.lat - start.lat);
  }
  const u = Math.max(0, Math.min(1, ((point.lon - start.lon) * dx + (point.lat - start.lat) * dy) / magSq));
  const projLon = start.lon + u * dx;
  const projLat = start.lat + u * dy;
  return Math.hypot(point.lon - projLon, point.lat - projLat);
}

/**
 * Ramer-Douglas-Peucker simplification for smooth freehand geographic drawings.
 */
export function simplifyPolygon(points: GeoPoint[], epsilonDeg = 0.08): GeoPoint[] {
  if (points.length <= 4) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }
  if (maxDist > epsilonDeg) {
    const left = simplifyPolygon(points.slice(0, index + 1), epsilonDeg);
    const right = simplifyPolygon(points.slice(index), epsilonDeg);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[end]];
}

/**
 * Parses coordinate queries such as "21.02, 105.85", "21.02° N 105.85° E", or "-33.86 151.20".
 */
export function parseCoordinateQuery(raw: string): GeoPoint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:°\s*([NSns]))?\s*[,\s;]+\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*([EWew]))?$/
  );
  if (!match) return null;
  let lat = Number(match[1]);
  const ns = match[2]?.toUpperCase();
  let lon = Number(match[3]);
  const ew = match[4]?.toUpperCase();
  if (ns === "S") lat = -Math.abs(lat);
  if (ns === "N") lat = Math.abs(lat);
  if (ew === "W") lon = -Math.abs(lon);
  if (ew === "E") lon = Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return { lat, lon };
}

export function formatBounds(bounds: GeoBounds): string {
  const latStr = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
  const lonStr = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;
  return `${latStr(bounds.south)}–${latStr(bounds.north)} · ${lonStr(bounds.west)}–${lonStr(bounds.east)}`;
}

export function formatCoords(point: GeoPoint): string {
  const lat = `${Math.abs(point.lat).toFixed(2)}°${point.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(point.lon).toFixed(2)}°${point.lon >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

export function zoomForBounds(bounds: GeoBounds): number {
  const latSpan = Math.max(0.2, bounds.north - bounds.south);
  const lonSpan = Math.max(0.2, bounds.east - bounds.west);
  const maxSpan = Math.max(latSpan, lonSpan);
  const z = Math.log2(240 / maxSpan);
  return Math.max(1.2, Math.min(8.5, Number(z.toFixed(2))));
}

function ringSphericalAreaKm2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    total += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/**
 * Computes spherical area (km^2) across all polygons of a GeoJSON Polygon/MultiPolygon,
 * subtracting interior hole rings.
 */
export function computeGeometryAreaKm2(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let area = 0;
  for (const poly of polygons) {
    if (!poly[0]) continue;
    area += ringSphericalAreaKm2(poly[0]);
    for (let h = 1; h < poly.length; h += 1) {
      area -= ringSphericalAreaKm2(poly[h]);
    }
  }
  return Math.round(Math.max(0, area));
}

export function pointInRingCoords(lat: number, lon: number, ring: number[][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonCoords(lat: number, lon: number, rings: number[][][]): boolean {
  if (!rings.length || !pointInRingCoords(lat, lon, rings[0])) return false;
  for (let h = 1; h < rings.length; h += 1) {
    if (pointInRingCoords(lat, lon, rings[h])) return false;
  }
  return true;
}

/**
 * Checks whether (lat, lon) lies inside a GeoJSON Polygon/MultiPolygon (with island & hole support)
 * or a plain GeoPoint[] array.
 */
export function pointInGeometry(
  lat: number,
  lon: number,
  geometryOrPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoPoint[] | null
): boolean {
  if (!geometryOrPolygon) return false;
  if (Array.isArray(geometryOrPolygon)) {
    return pointInPolygon(lat, lon, geometryOrPolygon);
  }
  if (geometryOrPolygon.type === "Polygon") {
    return pointInPolygonCoords(lat, lon, geometryOrPolygon.coordinates);
  }
  return geometryOrPolygon.coordinates.some((rings) => pointInPolygonCoords(lat, lon, rings));
}

export function getGeometryPolygons(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

interface RingMeta {
  west: number;
  south: number;
  east: number;
  north: number;
  lonSpan: number;
  areaScore: number;
  centerLat: number;
  centerLon: number;
  ring: number[][];
}

function summarizeRing(ring: number[][]): RingMeta | null {
  if (ring.length < 3) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const c of ring) {
    if (c[0] < west) west = c[0];
    if (c[0] > east) east = c[0];
    if (c[1] < south) south = c[1];
    if (c[1] > north) north = c[1];
  }
  const lonSpan = east - west;
  const latSpan = north - south;
  return {
    west,
    south,
    east,
    north,
    lonSpan,
    areaScore: lonSpan * latSpan,
    centerLat: (south + north) / 2,
    centerLon: (west + east) / 2,
    ring,
  };
}

/**
 * Computes camera-friendly bounds and center focused on the primary mainland territory + nearby
 * islands, avoiding over-zooming out when a country has faraway overseas territories or crosses 180 deg.
 */
export function computePrimaryFocusBounds(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { bounds: GeoBounds; center: GeoPoint; primaryRing: number[][] } {
  const polygons = getGeometryPolygons(geometry);
  const allMetas: RingMeta[] = [];
  for (const poly of polygons) {
    if (!poly[0]) continue;
    const meta = summarizeRing(poly[0]);
    if (meta) allMetas.push(meta);
  }

  const nonWrapping = allMetas.filter((m) => m.lonSpan <= 170);
  const candidates = nonWrapping.length > 0 ? nonWrapping : allMetas;
  if (candidates.length === 0) {
    return {
      bounds: { west: 102.1, south: 8.6, east: 109.5, north: 23.4 },
      center: { lat: 16.0, lon: 105.8 },
      primaryRing: [],
    };
  }

  let primary = candidates[0];
  for (const meta of candidates) {
    if (meta.areaScore > primary.areaScore) primary = meta;
  }

  const clustered = candidates.filter(
    (m) =>
      Math.abs(m.centerLon - primary.centerLon) <= Math.max(24, primary.lonSpan * 1.4) &&
      Math.abs(m.centerLat - primary.centerLat) <= Math.max(18, (primary.north - primary.south) * 1.4)
  );

  let west = primary.west;
  let south = primary.south;
  let east = primary.east;
  let north = primary.north;
  for (const m of clustered) {
    west = Math.min(west, m.west);
    south = Math.min(south, m.south);
    east = Math.max(east, m.east);
    north = Math.max(north, m.north);
  }

  return {
    bounds: {
      west: Number(west.toFixed(4)),
      south: Number(south.toFixed(4)),
      east: Number(east.toFixed(4)),
      north: Number(north.toFixed(4)),
    },
    center: {
      lat: Number(((south + north) / 2).toFixed(3)),
      lon: Number(((west + east) / 2).toFixed(3)),
    },
    primaryRing: primary.ring,
  };
}

/**
 * Picks a guaranteed interior sample point inside a polygon/MultiPolygon (for sub-pixel island regions).
 */
export function findInteriorPoint(
  geometryOrPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoPoint[]
): GeoPoint | null {
  if (Array.isArray(geometryOrPolygon)) {
    if (geometryOrPolygon.length < 3) return null;
    const c = computeCentroid(geometryOrPolygon);
    if (pointInPolygon(c.lat, c.lon, geometryOrPolygon)) return c;
    const b = computeBounds(geometryOrPolygon);
    for (let gy = 1; gy <= 4; gy += 1) {
      for (let gx = 1; gx <= 4; gx += 1) {
        const lat = b.south + (gy / 5) * (b.north - b.south);
        const lon = b.west + (gx / 5) * (b.east - b.west);
        if (pointInPolygon(lat, lon, geometryOrPolygon)) return { lat, lon };
      }
    }
    return c;
  }

  const focus = computePrimaryFocusBounds(geometryOrPolygon);
  if (pointInGeometry(focus.center.lat, focus.center.lon, geometryOrPolygon)) {
    return focus.center;
  }
  const pb = summarizeRing(focus.primaryRing);
  if (pb) {
    if (pointInGeometry(pb.centerLat, pb.centerLon, geometryOrPolygon)) {
      return { lat: pb.centerLat, lon: pb.centerLon };
    }
    for (let gy = 1; gy <= 5; gy += 1) {
      for (let gx = 1; gx <= 5; gx += 1) {
        const lat = pb.south + (gy / 6) * (pb.north - pb.south);
        const lon = pb.west + (gx / 6) * (pb.east - pb.west);
        if (pointInGeometry(lat, lon, geometryOrPolygon)) return { lat, lon };
      }
    }
    if (pb.ring.length > 0) {
      return { lat: pb.ring[0][1], lon: pb.ring[0][0] };
    }
  }
  return focus.center;
}

/**
 * Serializes a Polygon/MultiPolygon (or fallback GeoPoint[]) into compact [lat, lon] ring(s)
 * suitable for backend NetCDF polygon-mask ROI queries without overflowing JSON payload limits.
 */
export function serializePolygonRingsForApi(
  geometryOrPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoPoint[] | null,
  maxPointsTotal = 320
): Array<Array<{ lat: number; lon: number }>> | null {
  if (!geometryOrPolygon) return null;
  if (Array.isArray(geometryOrPolygon)) {
    if (geometryOrPolygon.length < 3) return null;
    const simplified =
      geometryOrPolygon.length > maxPointsTotal
        ? simplifyPolygon(geometryOrPolygon, 0.05)
        : geometryOrPolygon;
    return [simplified.map((p) => ({ lat: Number(p.lat.toFixed(4)), lon: Number(p.lon.toFixed(4)) }))];
  }

  const polys = getGeometryPolygons(geometryOrPolygon)
    .map((rings) => ({
      rings,
      area: rings[0] ? ringSphericalAreaKm2(rings[0]) : 0,
    }))
    .filter((item) => item.area > 0 && item.rings[0].length >= 3)
    .sort((a, b) => b.area - a.area);

  if (!polys.length) return null;
  const totalArea = polys.reduce((sum, p) => sum + p.area, 0);
  const selected = polys
    .filter((p, idx) => idx === 0 || (p.area >= totalArea * 0.01 && idx < 10))
    .slice(0, 10);

  const budgetPerPoly = Math.max(16, Math.floor(maxPointsTotal / selected.length));
  return selected
    .map(({ rings }) => {
      const pts: GeoPoint[] = rings[0].map(([lon, lat]) => ({
        lat: clampLat(lat),
        lon: normalizeLon(lon),
      }));
      let compact = pts;
      if (compact.length > budgetPerPoly) {
        compact = simplifyPolygon(compact, 0.04);
      }
      if (compact.length > budgetPerPoly) {
        const step = Math.ceil(compact.length / budgetPerPoly);
        compact = compact.filter((_, i) => i % step === 0);
      }
      return compact.length >= 3
        ? compact.map((p) => ({ lat: Number(p.lat.toFixed(4)), lon: Number(p.lon.toFixed(4)) }))
        : [];
    })
    .filter((ring) => ring.length >= 3);
}

/**
 * Computes minimum Web Mercator zoom so [-180..180, -82..82] fills the viewport
 * cleanly without top/bottom background gaps while allowing full-world 2D overview.
 */
export function computeMinFlatZoom(width: number, height: number): number {
  const safeW = Math.max(240, width);
  const safeH = Math.max(180, height);
  // Web Mercator height fraction covering [-82°, +82°] latitude
  const mercatorHeightFraction = 0.847;
  const zoomForWidth = Math.log2(safeW / 512);
  const zoomForHeight = Math.log2(safeH / (512 * mercatorHeightFraction));
  const raw = Math.max(0.55, Math.min(1.6, Math.max(zoomForWidth, zoomForHeight) + 0.02));
  return Number((Math.ceil(raw * 100) / 100).toFixed(2));
}

