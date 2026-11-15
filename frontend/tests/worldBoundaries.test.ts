import test from "node:test";
import assert from "node:assert/strict";
import { loadWorldBoundaries, resolveTerritoryByCodeOrName } from "../src/lib/worldBoundaries";
import {
  splitGeometryAtAntimeridian,
  splitLineStringAtAntimeridian,
} from "../src/lib/antimeridian";
import { pointInGeometry } from "../src/lib/geoUtils";

function countAntimeridianJumps(coords: number[][]): number {
  let jumps = 0;
  for (let i = 1; i < coords.length; i += 1) {
    if (Math.abs(coords[i][0] - coords[i - 1][0]) > 180) {
      jumps += 1;
    }
  }
  return jumps;
}

function forEachRing(
  geometry: GeoJSON.Geometry,
  visitor: (ring: number[][]) => void,
): void {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) visitor(ring);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) visitor(ring);
    }
  }
}

test("loadWorldBoundaries eliminates antimeridian jumps across coastlines, borders, and country polygons", async () => {
  const bundle = await loadWorldBoundaries();

  let coastlineJumps = 0;
  for (const line of bundle.coastlines.geometry.coordinates) {
    assert.ok(line.length >= 2, `Coastline segment too short (${line.length} pts)`);
    coastlineJumps += countAntimeridianJumps(line);
  }
  assert.equal(coastlineJumps, 0, `Expected 0 coastline antimeridian jumps, got ${coastlineJumps}`);

  let borderJumps = 0;
  for (const line of bundle.borders.geometry.coordinates) {
    assert.ok(line.length >= 2, `Border segment too short (${line.length} pts)`);
    borderJumps += countAntimeridianJumps(line);
  }
  assert.equal(borderJumps, 0, `Expected 0 border antimeridian jumps, got ${borderJumps}`);

  let polygonJumps = 0;
  for (const feat of bundle.countries.features) {
    if (!feat.geometry) continue;
    forEachRing(feat.geometry, (ring) => {
      assert.ok(ring.length >= 4, `Polygon ring too short (${ring.length} pts) in ${feat.properties?.name}`);
      const first = ring[0];
      const last = ring[ring.length - 1];
      assert.ok(
        Math.abs(first[0] - last[0]) <= 1e-7 && Math.abs(first[1] - last[1]) <= 1e-7,
        `Unclosed polygon ring in ${feat.properties?.name}`,
      );
      polygonJumps += countAntimeridianJumps(ring);
    });
  }
  assert.equal(polygonJumps, 0, `Expected 0 polygon antimeridian jumps, got ${polygonJumps}`);
});

test("loadWorldBoundaries preserves Eurasia/Africa coastlines and excludes Antarctica (010)", async () => {
  const bundle = await loadWorldBoundaries();
  const lines = bundle.coastlines.geometry.coordinates;

  assert.ok(lines.length >= 1000, `Expected >= 1000 coastline segments, got ${lines.length}`);

  const hasAdriaticSegment = lines.some((line) =>
    line.some(([lon, lat]) => Math.abs(lon - 19.34) < 0.2 && Math.abs(lat - 41.86) < 0.2),
  );
  assert.ok(hasAdriaticSegment, "Expected Eurasia/Africa Adriatic coastline segment to be preserved");

  const hasAntarcticaPolarLat = lines.some((line) => line.some(([, lat]) => lat < -75));
  assert.equal(hasAntarcticaPolarLat, false, "Expected Antarctica polar coastline lines (< -75 lat) to be excluded");
});

test("resolveTerritoryByCodeOrName fixes Fiji (242) antimeridian wrap for area and point-in-polygon", async () => {
  const fiji = await resolveTerritoryByCodeOrName("242");
  assert.ok(fiji, "Expected Fiji territory to resolve");

  assert.ok(
    fiji.areaKm2 >= 15_000 && fiji.areaKm2 <= 25_000,
    `Expected realistic Fiji area (15k-25k km2), got ${fiji.areaKm2}`,
  );
  assert.equal(
    pointInGeometry(-16.51, 0, fiji.boundaryGeometry),
    false,
    "Atlantic Ocean (0 lon) must NOT be inside Fiji",
  );
  assert.equal(
    pointInGeometry(-16.47, -179.95, fiji.boundaryGeometry),
    true,
    "Eastern Taveuni (-16.47, -179.95) must be inside Fiji",
  );
  assert.equal(
    pointInGeometry(-16.53, 179.99, fiji.boundaryGeometry),
    true,
    "Western Taveuni (-16.53, 179.99) must be inside Fiji",
  );
});

test("resolveTerritoryByCodeOrName fixes Russia (643) area and mainland focus center", async () => {
  const russia = await resolveTerritoryByCodeOrName("643");
  assert.ok(russia, "Expected Russia territory to resolve");

  assert.ok(
    russia.areaKm2 >= 16_000_000,
    `Expected realistic Russia area (>= 16M km2), got ${russia.areaKm2}`,
  );
  assert.ok(
    russia.center.lat < 70,
    `Expected mainland Russia focus center lat < 70, got ${russia.center.lat}`,
  );
});

test("splitLineStringAtAntimeridian splits crossings and drops degenerate seam bridges", () => {
  const splitCrossing = splitLineStringAtAntimeridian([
    [179.5, 10],
    [-179.5, 12],
  ]);
  assert.deepEqual(splitCrossing, [
    [
      [179.5, 10],
      [180, 11],
    ],
    [
      [-180, 11],
      [-179.5, 12],
    ],
  ]);

  const splitFijiStyle = splitLineStringAtAntimeridian([
    [-180, -16.54],
    [179.99, -16.53],
    [-180, -16.54],
    [180, -16.54],
  ]);
  assert.deepEqual(splitFijiStyle, [
    [
      [180, -16.54],
      [179.99, -16.53],
      [180, -16.54],
    ],
  ]);
});

test("splitGeometryAtAntimeridian promotes crossing Polygon with holes to MultiPolygon", () => {
  const crossingWithHole: GeoJSON.Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [178, 10],
        [-178, 10],
        [-178, 14],
        [178, 14],
        [178, 10],
      ],
      [
        [179, 11],
        [179, 13],
        [-179, 13],
        [-179, 11],
        [179, 11],
      ],
    ],
  };

  const split = splitGeometryAtAntimeridian(crossingWithHole);
  assert.equal(split.type, "MultiPolygon");
  if (split.type !== "MultiPolygon") return;

  assert.equal(split.coordinates.length, 2);
  for (const poly of split.coordinates) {
    assert.equal(poly.length, 2, "Expected both western and eastern halves to retain clipped hole");
    for (const ring of poly) {
      assert.equal(countAntimeridianJumps(ring), 0);
      assert.ok(ring.length >= 4);
    }
  }

  assert.equal(pointInGeometry(12, 178.5, split), true);
  assert.equal(pointInGeometry(12, -178.5, split), true);
  assert.equal(pointInGeometry(12, 179.5, split), false, "Point inside eastern hole must stay excluded");
  assert.equal(pointInGeometry(12, -179.5, split), false, "Point inside western hole must stay excluded");
});

