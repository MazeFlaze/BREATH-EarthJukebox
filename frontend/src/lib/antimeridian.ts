const ANTIMERIDIAN_LON = 180;
const FULL_WRAP_DEG = 360;
const EPS = 1e-9;

function clampLon(lon: number): number {
  if (lon > ANTIMERIDIAN_LON) return ANTIMERIDIAN_LON;
  if (lon < -ANTIMERIDIAN_LON) return -ANTIMERIDIAN_LON;
  return lon;
}

function pointsClose(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-11 && Math.abs(a[1] - b[1]) <= 1e-11;
}

function pushUniquePoint(segment: number[][], point: number[]): void {
  const prev = segment[segment.length - 1];
  if (!prev || !pointsClose(prev, point)) {
    segment.push(point);
  }
}

function hasAntimeridianJump(coords: number[][]): boolean {
  for (let i = 1; i < coords.length; i += 1) {
    if (Math.abs(coords[i][0] - coords[i - 1][0]) > ANTIMERIDIAN_LON) {
      return true;
    }
  }
  return false;
}

function signedRingArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum * 0.5;
}

function unwrapRing(ring: number[][]): number[][] {
  if (ring.length === 0) return [];
  const unwrapped: number[][] = [[ring[0][0], ring[0][1]]];
  let prevX = ring[0][0];
  for (let i = 1; i < ring.length; i += 1) {
    let x = ring[i][0];
    while (x - prevX > ANTIMERIDIAN_LON) x -= FULL_WRAP_DEG;
    while (prevX - x > ANTIMERIDIAN_LON) x += FULL_WRAP_DEG;
    unwrapped.push([x, ring[i][1]]);
    prevX = x;
  }
  return unwrapped;
}

function clipOpenRingHalfPlane(
  vertices: number[][],
  isInside: (p: number[]) => boolean,
  intersect: (a: number[], b: number[]) => number[],
): number[][] {
  if (vertices.length === 0) return [];
  const output: number[][] = [];
  let prev = vertices[vertices.length - 1];
  let prevInside = isInside(prev);

  for (const curr of vertices) {
    const currInside = isInside(curr);
    if (currInside) {
      if (!prevInside) {
        output.push(intersect(prev, curr));
      }
      output.push(curr);
    } else if (prevInside) {
      output.push(intersect(prev, curr));
    }
    prev = curr;
    prevInside = currInside;
  }

  return output;
}

function intersectVerticalEdge(a: number[], b: number[], boundaryX: number): number[] {
  const dx = b[0] - a[0];
  if (Math.abs(dx) <= 1e-12) return [boundaryX, a[1]];
  const t = (boundaryX - a[0]) / dx;
  return [boundaryX, a[1] + t * (b[1] - a[1])];
}

function clipRingToLongitudeBand(
  unwrappedRing: number[][],
  minX: number,
  maxX: number,
  shiftDeg: number,
): number[][] | null {
  const open =
    unwrappedRing.length > 1 && pointsClose(unwrappedRing[0], unwrappedRing[unwrappedRing.length - 1])
      ? unwrappedRing.slice(0, -1)
      : unwrappedRing;

  if (open.length < 3) return null;

  const afterMin = clipOpenRingHalfPlane(
    open,
    (p) => p[0] >= minX,
    (a, b) => intersectVerticalEdge(a, b, minX),
  );
  if (afterMin.length < 3) return null;

  const afterMax = clipOpenRingHalfPlane(
    afterMin,
    (p) => p[0] <= maxX,
    (a, b) => intersectVerticalEdge(a, b, maxX),
  );
  if (afterMax.length < 3) return null;

  const shifted: number[][] = [];
  for (const pt of afterMax) {
    pushUniquePoint(shifted, [clampLon(pt[0] - shiftDeg), pt[1]]);
  }
  if (shifted.length > 1 && pointsClose(shifted[0], shifted[shifted.length - 1])) {
    shifted.pop();
  }
  if (shifted.length < 3) return null;

  shifted.push([shifted[0][0], shifted[0][1]]);
  if (shifted.length < 4 || Math.abs(signedRingArea(shifted)) <= 1e-12) {
    return null;
  }

  return shifted;
}

function ringLonBounds(ring: number[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of ring) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  return { minX, maxX, minY, maxY };
}

function boxesOverlap(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  return a.maxX >= b.minX - EPS && a.minX <= b.maxX + EPS && a.maxY >= b.minY - EPS && a.minY <= b.maxY + EPS;
}

function clipHolesForBand(
  unwrappedHoles: number[][][],
  clippedOuterNormalized: number[][],
  minBandX: number,
  maxBandX: number,
  shiftDeg: number,
): number[][][] {
  const outerBox = ringLonBounds(clippedOuterNormalized);
  const clippedHoles: number[][][] = [];

  for (const hole of unwrappedHoles) {
    if (hole.length < 4) continue;
    const hBox = ringLonBounds(hole);
    // Align each hole into the same 360-deg wrap interval as this outer slice
    const kMin = Math.floor((minBandX - hBox.maxX) / FULL_WRAP_DEG);
    const kMax = Math.ceil((maxBandX - hBox.minX) / FULL_WRAP_DEG);

    for (let m = kMin; m <= kMax; m += 1) {
      const mShift = m * FULL_WRAP_DEG;
      const shiftedHole = hole.map((pt) => [pt[0] + mShift, pt[1]]);
      const clippedHole = clipRingToLongitudeBand(shiftedHole, minBandX, maxBandX, shiftDeg);
      if (!clippedHole) continue;
      if (boxesOverlap(outerBox, ringLonBounds(clippedHole))) {
        clippedHoles.push(clippedHole);
      }
    }
  }

  return clippedHoles;
}

function splitPolygonCoords(coords: number[][][]): number[][][][] {
  if (coords.length === 0) return [];
  const anyJump = coords.some((ring) => hasAntimeridianJump(ring));
  if (!anyJump) return [coords];

  const outerUnwrapped = unwrapRing(coords[0]);
  if (outerUnwrapped.length < 4) return [coords];

  // Skip polar-winding caps whose unwrapped start/end longitudes differ by ~360 deg
  const closureDelta = Math.abs(
    outerUnwrapped[outerUnwrapped.length - 1][0] - outerUnwrapped[0][0],
  );
  if (closureDelta > 1e-5) {
    return [coords];
  }

  const { minX, maxX } = ringLonBounds(outerUnwrapped);
  const bandStart = Math.floor((minX + ANTIMERIDIAN_LON + EPS) / FULL_WRAP_DEG);
  const bandEnd = Math.floor((maxX + ANTIMERIDIAN_LON - EPS) / FULL_WRAP_DEG);
  if (bandEnd < bandStart) return [coords];

  const unwrappedHoles = coords.slice(1).map((hole) => unwrapRing(hole));
  const parts: number[][][][] = [];

  for (let band = bandStart; band <= bandEnd; band += 1) {
    const shiftDeg = band * FULL_WRAP_DEG;
    const minBandX = -ANTIMERIDIAN_LON + shiftDeg;
    const maxBandX = ANTIMERIDIAN_LON + shiftDeg;
    const clippedOuter = clipRingToLongitudeBand(outerUnwrapped, minBandX, maxBandX, shiftDeg);
    if (!clippedOuter) continue;

    const clippedHoles =
      unwrappedHoles.length > 0
        ? clipHolesForBand(unwrappedHoles, clippedOuter, minBandX, maxBandX, shiftDeg)
        : [];

    parts.push([clippedOuter, ...clippedHoles]);
  }

  return parts.length > 0 ? parts : [coords];
}

/**
 * Splits a LineString at `±180°` longitude jumps without discarding segments.
 * Zero-distance `[-180, lat] -> [180, lat]` seam bridges are cleanly broken into separate parts.
 */
export function splitLineStringAtAntimeridian(coords: number[][]): number[][][] {
  if (coords.length < 2) return [];

  const segments: number[][][] = [];
  let current: number[][] = [[clampLon(coords[0][0]), coords[0][1]]];

  const flushCurrent = (): void => {
    if (current.length >= 2) {
      segments.push(current);
    }
    current = [];
  };

  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const x1 = clampLon(prev[0]);
    const y1 = prev[1];
    const x2 = clampLon(curr[0]);
    const y2 = curr[1];
    const dx = x2 - x1;

    if (Math.abs(dx) <= ANTIMERIDIAN_LON) {
      pushUniquePoint(current, [x2, y2]);
      continue;
    }

    const seamExit = dx > ANTIMERIDIAN_LON ? -ANTIMERIDIAN_LON : ANTIMERIDIAN_LON;
    const seamEntry = -seamExit;
    const x2Unwrapped = dx > ANTIMERIDIAN_LON ? x2 - FULL_WRAP_DEG : x2 + FULL_WRAP_DEG;
    const denom = x2Unwrapped - x1;

    if (Math.abs(denom) <= 1e-12) {
      flushCurrent();
      current = [[x2, y2]];
      continue;
    }

    const t = Math.max(0, Math.min(1, (seamExit - x1) / denom));
    const crossLat = y1 + t * (y2 - y1);

    if (t > EPS) {
      pushUniquePoint(current, [seamExit, crossLat]);
    }
    flushCurrent();

    current = [[seamEntry, crossLat]];
    if (t < 1 - EPS) {
      pushUniquePoint(current, [x2, y2]);
    } else if (Math.abs(x2 - seamEntry) > EPS) {
      pushUniquePoint(current, [x2, y2]);
    }
  }

  flushCurrent();
  return segments;
}

/**
 * Splits every LineString in a MultiLineString at `±180°` antimeridian crossings.
 */
export function splitMultiLineStringAtAntimeridian(lines: number[][][]): number[][][] {
  const result: number[][][] = [];
  for (const line of lines) {
    const parts = splitLineStringAtAntimeridian(line);
    for (const part of parts) {
      result.push(part);
    }
  }
  return result;
}

/**
 * Splits GeoJSON geometries cleanly across `±180°` so no edge spans `> 180°` longitude.
 * A single `Polygon` spanning the antimeridian promotes to a `MultiPolygon` when cut into `>= 2` parts.
 */
export function splitGeometryAtAntimeridian(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): GeoJSON.Polygon | GeoJSON.MultiPolygon;
export function splitGeometryAtAntimeridian(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): GeoJSON.LineString | GeoJSON.MultiLineString;
export function splitGeometryAtAntimeridian(geometry: GeoJSON.Geometry): GeoJSON.Geometry;
export function splitGeometryAtAntimeridian(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  if (geometry.type === "LineString") {
    const parts = splitLineStringAtAntimeridian(geometry.coordinates);
    if (parts.length <= 1) {
      return {
        type: "LineString",
        coordinates: parts[0] ?? geometry.coordinates,
      };
    }
    return {
      type: "MultiLineString",
      coordinates: parts,
    };
  }

  if (geometry.type === "MultiLineString") {
    return {
      type: "MultiLineString",
      coordinates: splitMultiLineStringAtAntimeridian(geometry.coordinates),
    };
  }

  if (geometry.type === "Polygon") {
    const parts = splitPolygonCoords(geometry.coordinates);
    if (parts.length === 1) {
      return {
        type: "Polygon",
        coordinates: parts[0],
      };
    }
    return {
      type: "MultiPolygon",
      coordinates: parts,
    };
  }

  if (geometry.type === "MultiPolygon") {
    const parts: number[][][][] = [];
    for (const poly of geometry.coordinates) {
      for (const splitPoly of splitPolygonCoords(poly)) {
        parts.push(splitPoly);
      }
    }
    return {
      type: "MultiPolygon",
      coordinates: parts,
    };
  }

  if (geometry.type === "GeometryCollection") {
    return {
      type: "GeometryCollection",
      geometries: geometry.geometries.map((child) => splitGeometryAtAntimeridian(child)),
    };
  }

  return geometry;
}
