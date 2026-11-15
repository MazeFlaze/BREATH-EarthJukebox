import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getBackendBaseUrl,
  fetchBackendRegionStats,
  samplePolygonSeries,
  resetBackendCircuitBreaker,
  getBackendCircuitBreakerUntil,
} from "../src/lib/geosCfRaster";
import type { GeoBounds, GeoPoint } from "@/types/breathe";

describe("Frontend Region API Contract & Raster Decode Tests", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetBackendCircuitBreaker();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    resetBackendCircuitBreaker();
  });

  describe("1. getBackendBaseUrl() resolution & normalization", () => {
    it("defaults to http://localhost:8000 when no env vars are set", () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");
    });

    it("prioritizes NEXT_PUBLIC_BACKEND_URL over NEXT_PUBLIC_API_URL", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://backend-service:8000";
      process.env.NEXT_PUBLIC_API_URL = "http://api-service:8000";
      assert.equal(getBackendBaseUrl(), "http://backend-service:8000");
    });

    it("falls back to NEXT_PUBLIC_API_URL when NEXT_PUBLIC_BACKEND_URL is missing or empty", () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      process.env.NEXT_PUBLIC_API_URL = "https://breathe-api.azurewebsites.net";
      assert.equal(getBackendBaseUrl(), "https://breathe-api.azurewebsites.net");

      process.env.NEXT_PUBLIC_BACKEND_URL = "   ";
      assert.equal(getBackendBaseUrl(), "https://breathe-api.azurewebsites.net");
    });

    it("strips trailing slashes cleanly", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:8000/";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");

      process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:8000///";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");
    });

    it("strips redundant /api/v1 and /api/v1/ suffix", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:8000/api/v1";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");

      process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:8000/api/v1/";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");

      process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:8000/api/v1///";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");
    });

    it("preserves URL sub-paths while removing trailing /api/v1", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "https://gateway.example.com/proxy/api/v1/";
      assert.equal(getBackendBaseUrl(), "https://gateway.example.com/proxy");
    });

    it("sanitizes literal 'undefined' and 'null' environment strings", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "undefined";
      process.env.NEXT_PUBLIC_API_URL = "null";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");

      process.env.NEXT_PUBLIC_BACKEND_URL = "  null  ";
      delete process.env.NEXT_PUBLIC_API_URL;
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");
    });

    it("strips case-insensitive /API/V1 suffix", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:8000/API/V1/";
      assert.equal(getBackendBaseUrl(), "http://localhost:8000");
    });
  });

  describe("2. fetchBackendRegionStats() contract & mapping", () => {
    const sampleBounds: GeoBounds = { west: 104, south: 14, east: 106, north: 16 };
    const samplePolygon: GeoPoint[] = [
      { lat: 14, lon: 104 },
      { lat: 16, lon: 104 },
      { lat: 16, lon: 106 },
      { lat: 14, lon: 106 },
    ];

    it("correctly maps summary.displayMin into RegionStats.min", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      let capturedUrl = "";
      let capturedBody: any = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            mode: "region",
            variable: "NO2",
            displayUnit: "ppbv",
            summary: {
              displayMean: 12.34,
              displayMin: 4.56,
              displayMax: 25.78,
              displayP90: 21.09,
              validCount: 42,
              totalCount: 50,
            },
            isMock: false,
            provenance: { sourceName: "GEOS-CF v2 NetCDF-4" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await fetchBackendRegionStats("NO2", 0, sampleBounds, samplePolygon);

      assert.equal(capturedUrl, "http://mock-backend:8000/api/v1/jukebox/region");
      assert.equal(capturedBody.datasetId, "geos-cf-v2-aqc");
      assert.equal(capturedBody.variable, "NO2");
      assert.equal(result.variable, "NO2");
      assert.equal(result.unit, "ppbv");
      assert.equal(result.mean, 12.3);
      assert.equal(result.min, 4.6);
      assert.equal(result.max, 25.8);
      assert.equal(result.p90, 21.1);
      assert.equal(result.sampleCount, 42);
      assert.equal(result.coveragePct, 84);
      assert.equal(result.sourceKind, "backend-netcdf");
      assert.equal(result.sourceLabel, "GEOS-CF v2 NetCDF-4");
    });

    it("preserves 0.0 value for displayMin without coercing to null", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            displayUnit: "ppbv",
            summary: {
              displayMean: 5.0,
              displayMin: 0.0,
              displayMax: 15.0,
              validCount: 10,
              totalCount: 10,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const result = await fetchBackendRegionStats("NO2", 0, sampleBounds, samplePolygon);
      assert.equal(result.min, 0.0);
    });

    it("falls back to summary.min when displayMin is null or undefined", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            displayUnit: "ppbv",
            summary: {
              displayMean: 10.0,
              displayMin: null,
              min: 2.34,
              validCount: 10,
              totalCount: 10,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const result = await fetchBackendRegionStats("NO2", 0, sampleBounds, samplePolygon);
      assert.equal(result.min, 2.3);
    });

    it("sets min to null when both displayMin and min are missing/null", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            displayUnit: "ppbv",
            summary: {
              displayMean: 10.0,
              displayMin: null,
              min: null,
              validCount: 10,
              totalCount: 10,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const result = await fetchBackendRegionStats("NO2", 0, sampleBounds, samplePolygon);
      assert.equal(result.min, null);
    });

    it("gracefully falls back to offline raster sampling on network 500 error", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () =>
        new Response("Internal Server Error", { status: 500 });

      const result = await fetchBackendRegionStats("NO2", 0, sampleBounds, samplePolygon);

      // Verify circuit breaker was triggered
      assert.ok(getBackendCircuitBreakerUntil() > Date.now());
      // Offline fallback returns valid structure without throwing
      assert.equal(result.variable, "NO2");
      assert.ok(result.sourceKind === "geos-cf-raster" || result.sourceKind === "unavailable");
    });

    it("gracefully falls back to offline raster sampling on network timeout or abort", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      };

      const result = await fetchBackendRegionStats("NO2", 0, sampleBounds, samplePolygon);

      assert.ok(getBackendCircuitBreakerUntil() > Date.now());
      assert.equal(result.variable, "NO2");
      assert.ok(result.sourceKind === "geos-cf-raster" || result.sourceKind === "unavailable");
    });

    it("ensures latMin <= latMax and lonMin <= lonMax even when bounds are inverted", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      let capturedBody: any = null;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            summary: { displayMean: 15.0, displayMin: 5.0, validCount: 10, totalCount: 10 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const invertedBounds: GeoBounds = { west: 108, south: 22, east: 102, north: 14 };
      await fetchBackendRegionStats("NO2", 0, invertedBounds, samplePolygon);

      assert.ok(capturedBody.bounds.latMin <= capturedBody.bounds.latMax);
      assert.ok(capturedBody.bounds.lonMin <= capturedBody.bounds.lonMax);
      assert.equal(capturedBody.bounds.latMin, 14);
      assert.equal(capturedBody.bounds.latMax, 22);
      assert.equal(capturedBody.bounds.lonMin, 102);
      assert.equal(capturedBody.bounds.lonMax, 108);
    });

    it("handles undefined bounds parameter safely by falling back to polygon bounds", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      let capturedBody: any = null;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            summary: { displayMean: 10.0, displayMin: 2.0, validCount: 5, totalCount: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      await fetchBackendRegionStats("NO2", 0, undefined as any, samplePolygon);

      assert.ok(capturedBody.bounds.latMin <= capturedBody.bounds.latMax);
      assert.equal(capturedBody.bounds.latMin, 14);
      assert.equal(capturedBody.bounds.latMax, 16);
    });
  });

  describe("3. samplePolygonSeries() diurnal series & fallback", () => {
    const sampleBounds: GeoBounds = { west: 104, south: 14, east: 106, north: 16 };
    const samplePolygon: GeoPoint[] = [
      { lat: 14, lon: 104 },
      { lat: 16, lon: 104 },
      { lat: 16, lon: 106 },
      { lat: 14, lon: 106 },
    ];

    it("returns NetCDF-4 diurnal series when backend returns series: [1, 2, 3, 4, 5, 6, 7, 8]", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      let capturedBody: any = null;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            mode: "region",
            variable: "PM25",
            series: [1, 2, 3, 4, 5, 6, 7, 8],
            summary: { displayMean: 4.5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const series = await samplePolygonSeries("PM25_RH35", samplePolygon, undefined, sampleBounds);

      assert.equal(capturedBody.includeSeries, true);
      assert.equal(capturedBody.variable, "PM25_RH35");
      assert.deepEqual(series, [1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("gracefully falls back when backend returns array with NaN or non-number elements", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            mode: "region",
            variable: "PM25",
            series: [1, 2, NaN, 4, 5, 6, 7, 8],
            summary: { displayMean: 10.0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const series = await samplePolygonSeries("PM25_RH35", samplePolygon, undefined, sampleBounds);

      assert.equal(series.length, 8);
      assert.ok(series.every((v) => typeof v === "number" && !Number.isNaN(v)));
    });

    it("gracefully resolves 8-point offline raster series when backend fails or times out", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () => {
        throw new Error("Connection refused (ECONNREFUSED)");
      };

      const series = await samplePolygonSeries("PM25_RH35", samplePolygon, undefined, sampleBounds);

      assert.ok(getBackendCircuitBreakerUntil() > Date.now());
      assert.equal(series.length, 8);
      assert.ok(series.every((v) => typeof v === "number" && !Number.isNaN(v)));
    });

    it("gracefully falls back to 8-point offline series when backend returns null or empty series", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            mode: "region",
            variable: "PM25",
            series: null,
            summary: { displayMean: 10.0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const series = await samplePolygonSeries("PM25_RH35", samplePolygon, undefined, sampleBounds);

      assert.equal(series.length, 8);
      assert.ok(series.every((v) => typeof v === "number" && !Number.isNaN(v)));
    });

    it("returns 8 zeros immediately for un-modeled or AOD layers without network call", async () => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        throw new Error("Should not be called");
      };

      const series = await samplePolygonSeries("AOD", samplePolygon);

      assert.equal(fetchCalled, false);
      assert.deepEqual(series, [0, 0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe("4. Raster decode resolution (2048px cap)", () => {
    it("ensures geosCfRaster.ts uses 2048 instead of 1280 for raster decode caps", () => {
      const filePath = path.resolve(__dirname, "../src/lib/geosCfRaster.ts");
      const content = fs.readFileSync(filePath, "utf-8");

      assert.ok(!content.includes("loadRasterPixels(url, 1280)"), "geosCfRaster must not use 1280 in getScalarGrid");
      assert.ok(!content.includes("loadRasterPixels(frame.imageUrl, 1280)"), "geosCfRaster must not use 1280 in loadLayerRaster");
      assert.ok(content.includes("loadRasterPixels(url, 2048)"), "geosCfRaster must use 2048 in getScalarGrid");
      assert.ok(content.includes("loadRasterPixels(frame.imageUrl, 2048)"), "geosCfRaster must use 2048 in loadLayerRaster");
    });

    it("ensures raster-tile-worker.js uses 2048 instead of 1280 for raster decode caps", () => {
      const workerPath = path.resolve(__dirname, "../public/workers/raster-tile-worker.js");
      const content = fs.readFileSync(workerPath, "utf-8");

      assert.ok(!content.includes("loadRasterPixels(imageUrl, 1280)"), "raster-tile-worker.js must not use 1280");
      assert.ok(content.includes("loadRasterPixels(imageUrl, 2048)"), "raster-tile-worker.js must use 2048");
    });
  });
});
