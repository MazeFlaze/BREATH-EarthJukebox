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

