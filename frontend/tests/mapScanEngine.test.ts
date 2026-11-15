import test from "node:test";
import assert from "node:assert/strict";
import {
  computePixelBounds,
  computePolygonRingsPixels,
  computeRaySegmentsForX,
  buildScanFieldGrid,
  type PixelPoint,
} from "../src/lib/mapScanEngine";

test("computePixelBounds computes correct bounding box for tilted polygon", () => {
  // Tilted quadrilateral (like high-latitude Mercator box)
  const ring: PixelPoint[] = [
    { x: 100, y: 150 },
    { x: 260, y: 120 },
    { x: 280, y: 380 },
    { x: 110, y: 410 },
  ];

  const bounds = computePixelBounds([ring]);
  assert.ok(bounds, "Bounds should be computed");
  assert.equal(bounds.minX, 100);
  assert.equal(bounds.maxX, 280);
  assert.equal(bounds.minY, 120);
  assert.equal(bounds.maxY, 410);
  assert.equal(bounds.width, 180);
  assert.equal(bounds.height, 290);
});

test("computeRaySegmentsForX returns single interval for convex tilted box", () => {
  // Rectangle tilted slightly
  const ring: PixelPoint[] = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 300 },
    { x: 100, y: 300 },
  ];

  // Inside the box at X = 150
  const segs = computeRaySegmentsForX([ring], 150);
  assert.equal(segs.length, 1, "Should have 1 segment inside");
  assert.equal(Math.round(segs[0].yTop), 100);
  assert.equal(Math.round(segs[0].yBottom), 300);

  // Outside the box at X = 50 or X = 250
  const segsOutsideLeft = computeRaySegmentsForX([ring], 50);
  assert.equal(segsOutsideLeft.length, 0, "Should be empty outside on left");

  const segsOutsideRight = computeRaySegmentsForX([ring], 250);
  assert.equal(segsOutsideRight.length, 0, "Should be empty outside on right");
});

test("computeRaySegmentsForX handles concave U-shaped polygon with 2 distinct segments", () => {
  // U-shape polygon:
  // (100,100) ------- (300,100)
  //   |                 |
  // (100,300)         (300,300)
  //   |                 |
  // (100,400)         (300,400)
  //   \                 /
  //    (150,400)-(250,400) (bottom bridge)
  // With a notch in the middle:
  // Top boundary has gap from x=180 to x=220 down to y=280:
  // (100,100)-(180,100)-(180,280)-(220,280)-(220,100)-(300,100)-(300,400)-(100,400)
  const uShape: PixelPoint[] = [
    { x: 100, y: 100 },
    { x: 180, y: 100 },
    { x: 180, y: 280 },
    { x: 220, y: 280 },
    { x: 220, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 400 },
    { x: 100, y: 400 },
  ];

  // Inside the notch at X = 200:
  // Above y=280 is outside! Only y in [280, 400] is inside.
  const segsNotch = computeRaySegmentsForX([uShape], 200);
  assert.equal(segsNotch.length, 1);
  assert.equal(Math.round(segsNotch[0].yTop), 280);
  assert.equal(Math.round(segsNotch[0].yBottom), 400);

  // In the left prong at X = 140:
  // Spans full [100, 400]
  const segsProng = computeRaySegmentsForX([uShape], 140);
  assert.equal(segsProng.length, 1);
  assert.equal(Math.round(segsProng[0].yTop), 100);
  assert.equal(Math.round(segsProng[0].yBottom), 400);
});

test("computeRaySegmentsForX handles multi-island (disjoint rings)", () => {
  // Island 1: X in [100, 200], Y in [100, 200]
  const island1: PixelPoint[] = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];
  // Island 2: X in [100, 200], Y in [300, 400]
  const island2: PixelPoint[] = [
    { x: 100, y: 300 },
    { x: 200, y: 300 },
    { x: 200, y: 400 },
    { x: 100, y: 400 },
  ];

  // At X = 150, ray intersects both islands -> 2 segments!
  const segs = computeRaySegmentsForX([island1, island2], 150);
  assert.equal(segs.length, 2, "Should return 2 segments for 2 islands");
  assert.equal(Math.round(segs[0].yTop), 100);
  assert.equal(Math.round(segs[0].yBottom), 200);
  assert.equal(Math.round(segs[1].yTop), 300);
  assert.equal(Math.round(segs[1].yBottom), 400);
});

test("computePolygonRingsPixels projects GeoJSON coordinates via mock map", () => {
  const mockMap = {
    project: ([lon, lat]: [number, number]) => ({
      x: (lon + 180) * 2,
      y: (90 - lat) * 2,
    }),
  } as unknown as import("maplibre-gl").Map;

  const polygonPoints = [
    { lat: 10, lon: 20 },
    { lat: 10, lon: 30 },
    { lat: 20, lon: 30 },
    { lat: 20, lon: 20 },
  ];

  const rings = computePolygonRingsPixels(mockMap, polygonPoints);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 4);
  assert.equal(rings[0][0].x, (20 + 180) * 2);
  assert.equal(rings[0][0].y, (90 - 10) * 2);

  const bounds = computePixelBounds(rings);
  assert.ok(bounds);
  assert.equal(bounds.minX, (20 + 180) * 2);
  assert.equal(bounds.maxX, (30 + 180) * 2);
});

test("buildScanFieldGrid in viewport scope uses full width and height edge-to-edge", () => {
  const mockMap = {
    unproject: ([x, y]: [number, number]) => ({
      lng: (x / 1000) * 360 - 180,
      lat: 80 - (y / 500) * 160,
    }),
  } as unknown as import("maplibre-gl").Map;

  const mockRaster = {
    width: 10,
    height: 10,
    data: new Uint8ClampedArray(10 * 10 * 4).fill(128),
  };

  const grid = buildScanFieldGrid({
    map: mockMap,
    width: 1000,
    height: 500,
    raster: mockRaster as any,
    layer: {
      id: "pm25",
      name: "PM2.5",
      short: "PM2.5",
      unit: "µg/m³",
      description: "Fine particulate matter",
      vmin: 0,
      vmax: 100,
      cmap: "inferno",
      available: true,
      palette: [],
    } as any,
    scope: "viewport",
  });

  assert.equal(grid.scope, "viewport");
  assert.equal(grid.columns.length, 96);
  // West-most column starts at x = 0
  assert.equal(Math.round(grid.summaries[0].x), 0);
  // East-most column ends at x = width (1000)
  assert.equal(Math.round(grid.summaries[grid.cols - 1].x), 1000);
  // Row 0 is at bottom (y = height = 500)
  assert.equal(Math.round(grid.columns[0][0].y), 500);
  // Row 15 is at top (y = 0)
  assert.equal(Math.round(grid.columns[0][grid.rows - 1].y), 0);
});

