import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildProxyTargetUrl,
  checkBackendHealth,
  fetchBackendLocations,
  fetchBackendTemporalSeries,
  fetchDatasetAvailability,
  resolveBackendRequestUrl,
  resolveProxyBackendBase,
} from "../src/services/backendApi";
import {
  resetBackendCircuitBreaker,
  samplePointSeries,
  samplePointSeriesDetailed,
} from "../src/lib/geosCfRaster";
import { dataService } from "../src/services/dataService";

describe("Frontend Runtime Proxy & Fullstack API Wiring Tests", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetBackendCircuitBreaker();
    dataService.resetBackendCheck();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    resetBackendCircuitBreaker();
    dataService.resetBackendCheck();
  });

  describe("1. Next.js API Proxy URL builders", () => {
    it("prioritizes BACKEND_API_URL -> NEXT_PUBLIC_BACKEND_URL -> NEXT_PUBLIC_API_URL -> localhost", () => {
      assert.equal(resolveProxyBackendBase({}), "http://localhost:8000");
      assert.equal(
        resolveProxyBackendBase({
          BACKEND_API_URL: "http://backend:8000/api/v1/",
          NEXT_PUBLIC_BACKEND_URL: "http://ignored:8000",
        }),
        "http://backend:8000"
      );
      assert.equal(
        resolveProxyBackendBase({
          BACKEND_API_URL: "undefined",
          NEXT_PUBLIC_API_URL: "https://api.breathe.example///",
        }),
        "https://api.breathe.example"
      );
    });

    it("preserves nested path segments and query string parameters", () => {
      const target = buildProxyTargetUrl(
        ["datasets", "geos-cf-v2-aqc", "availability"],
        "?format=json&offset=1",
        "http://backend:8000/"
      );
      assert.equal(
        target,
        "http://backend:8000/api/v1/datasets/geos-cf-v2-aqc/availability?format=json&offset=1"
      );
    });
  });

  describe("2. resolveBackendRequestUrl() hybrid browser/SSR routing", () => {
    it("uses relative /api/v1 proxy path in browser when NEXT_PUBLIC_* is unset", () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      (globalThis as { window?: unknown }).window = {};

      assert.equal(resolveBackendRequestUrl("/api/v1/health"), "/api/v1/health");
      assert.equal(
        resolveBackendRequestUrl("/jukebox/temporal?variable=NO2"),
        "/api/v1/jukebox/temporal?variable=NO2"
      );
    });

    it("uses BACKEND_API_URL or localhost in Node/SSR when window is undefined", () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      delete (globalThis as { window?: unknown }).window;

      process.env.BACKEND_API_URL = "http://backend-internal:8000";
      assert.equal(
        resolveBackendRequestUrl("/api/v1/health"),
        "http://backend-internal:8000/api/v1/health"
      );
    });

    it("honors explicit NEXT_PUBLIC_BACKEND_URL in both browser and server", () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "https://direct-api.example/api/v1/";
      (globalThis as { window?: unknown }).window = {};
      assert.equal(
        resolveBackendRequestUrl("/api/v1/health"),
        "https://direct-api.example/api/v1/health"
      );
    });
  });

  describe("3. Health, Availability, Locations & Temporal API clients", () => {
    it("parses healthy /api/v1/health payload via runtime proxy in browser", async () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      (globalThis as { window?: unknown }).window = {};

      let requestedUrl = "";
      globalThis.fetch = async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            status: "healthy",
            service: "BREATHE Backend API",
            version: "1.0.0",
            timestamp: "2026-11-15T00:00:00Z",
            dataset_loaded: true,
            observations_count: 8,
            active_variable: "Particulate Matter (PM2.5)",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const health = await checkBackendHealth();
      assert.equal(requestedUrl, "/api/v1/health");
      assert.ok(health);
      assert.equal(health.status, "healthy");
      assert.equal(health.observations_count, 8);
    });

    it("fetches dataset availability and locations cleanly", async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = "http://mock-backend:8000";
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/availability")) {
          return new Response(
            JSON.stringify({
              datasetId: "geos-cf-v2-aqc",
              availableTimes: ["2026-11-15T00:30:00Z", "2026-11-15T03:30:00Z"],
              timeRange: {
                start: "2026-11-15T00:30:00Z",
                end: "2026-11-15T03:30:00Z",
              },
              totalGranules: 2,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify([
            {
              id: "hanoi",
              name: "Hanoi",
              lat: 21.0285,
              lon: 105.8542,
              region: "Southeast Asia",
              isPreset: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const avail = await fetchDatasetAvailability("geos-cf-v2-aqc");
      const locs = await fetchBackendLocations();
      assert.equal(avail?.totalGranules, 2);
      assert.equal(avail?.availableTimes[0], "2026-11-15T00:30:00Z");
      assert.equal(locs?.[0]?.id, "hanoi");
    });

    it("prefers /api/v1/jukebox/temporal in samplePointSeries before offline PNG fallback", async () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      (globalThis as { window?: unknown }).window = {};

      let capturedUrl = "";
      globalThis.fetch = async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return new Response(
          JSON.stringify({
            mode: "temporal",
            datasetId: "geos-cf-v2-aqc",
            variable: "PM25_RH35",
            unit: "ug m-3",
            displayUnit: "µg/m³",
            dataType: "model_analysis",
            isMock: false,
            points: [
              { order: 0, timestamp: "2026-11-12T00:30:00Z", displayValue: 18.24, value: 18.24, quality: "valid" },
              { order: 1, timestamp: "2026-11-12T03:30:00Z", displayValue: 22.51, value: 22.51, quality: "valid" },
              { order: 2, timestamp: "2026-11-12T06:30:00Z", displayValue: 27.19, value: 27.19, quality: "valid" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const detailed = await samplePointSeriesDetailed("PM25_RH35", 21.03, 105.85, 10);
      assert.ok(capturedUrl.startsWith("/api/v1/jukebox/temporal?"));
      assert.equal(detailed.sourceKind, "backend-temporal");
      assert.deepEqual(detailed.values, [18.2, 22.5, 27.2]);

      // Cached hit should reuse without second network error if offline
      globalThis.fetch = async () => {
        throw new Error("Should read from cache");
      };
      const cached = await samplePointSeries("PM25_RH35", 21.03, 105.85, 10);
      assert.deepEqual(cached, [18.2, 22.5, 27.2]);
    });

    it("wires DataService.getDataset through /api/v1 proxy even when NEXT_PUBLIC_BACKEND_URL is unset", async () => {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      (globalThis as { window?: unknown }).window = {};

      let calledUrl = "";
      globalThis.fetch = async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response(
          JSON.stringify({
            id: "geos-cf-live-dataset",
            title: "Live Dataset",
            source: "NASA GMAO",
            sourceUrl: "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/",
            variable: "PM2.5",
            unit: "µg/m³",
            description: "Live API response",
            observations: [],
            isMock: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const ds = await dataService.getDataset();
      assert.equal(calledUrl, "/api/v1/observations/air-quality");
      assert.equal(ds.id, "geos-cf-live-dataset");

      // Null safety check on temporal fetch error
      globalThis.fetch = async () => new Response("error", { status: 500 });
      const errTemporal = await fetchBackendTemporalSeries({
        lat: 0,
        lon: 0,
        variable: "PM25_RH35",
        start: "2026-11-12T00:30:00Z",
        end: "2026-11-12T21:30:00Z",
      });
      assert.equal(errTemporal, null);
    });
  });
});
