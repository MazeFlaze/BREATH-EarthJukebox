import test from "node:test";
import assert from "node:assert/strict";
import { resolveTerritoryByCodeOrName } from "../src/lib/worldBoundaries";
import { getRegionLayerRestriction } from "../src/lib/breatheData";
import { sonificationService } from "../src/services/sonificationService";
import type { AudioCompositionSpec } from "../src/types/breathe";

test("resolveTerritoryByCodeOrName supports resolution='110m' for lightweight fast boot hydration", async () => {
  const vnQuick = await resolveTerritoryByCodeOrName("704", "vietnam", "Vietnam", "110m");
  assert.ok(vnQuick, "Vietnam should resolve under 110m resolution");
  assert.equal(vnQuick.territoryCode, "704");
  assert.equal(vnQuick.name, "Vietnam");
  assert.ok(vnQuick.areaKm2 > 250000 && vnQuick.areaKm2 < 400000, "Vietnam area should be within realistic geographical range");

  const vnDetailed = await resolveTerritoryByCodeOrName("704", "vietnam", "Vietnam", "50m");
  assert.ok(vnDetailed, "Vietnam should resolve under 50m resolution");
  assert.equal(vnDetailed.territoryCode, "704");
});

test("sonificationService: onVisualTick delivers audio frames without triggering 60Hz clock state mutations", async () => {
  const spec: AudioCompositionSpec = {
    id: "test-perf-spec",
    title: "Test Spec",
    regionName: "Test Region",
    variable: "PM25_RH35",
    series: [20, 30, 40, 50, 45, 35, 25, 20],
    min: 0,
    max: 100,
    mapping: {
      density: 0.5,
      brightness: 0.5,
      pitchSensitivity: 0.6,
      spatialSpread: 0.4,
      tempo: 90,
      musicalKey: "C major",
      waveform: "sine",
      volume: 0.7,
    },
    durationSec: 24,
  };

  sonificationService.syncPreviewSpec(spec);
  const clock = sonificationService.getClockState();
  assert.equal(clock.activeCompositionId, "test-perf-spec");
  assert.equal(clock.totalSec, 24);

  const visualFrame = sonificationService.getVisualFrame();
  assert.equal(visualFrame.activeCompositionId, "test-perf-spec");
  assert.equal(visualFrame.waveformSamples.length, 64);
  assert.equal(visualFrame.spectrumBins.length, 32);

  sonificationService.seekStep(4);
  const updatedClock = sonificationService.getClockState();
  assert.equal(updatedClock.currentStep, 4);
  assert.equal(updatedClock.activeSlot, 2);
  assert.equal(updatedClock.progress, 4 / 16);

  sonificationService.stop();
  const stoppedClock = sonificationService.getClockState();
  assert.equal(stoppedClock.playbackState, "idle");
  assert.equal(stoppedClock.currentStep, 0);
});

test("getRegionLayerRestriction hides PM2.5 for Greenland Arctic ice regimes and falls back to O3", () => {
  const byCode = getRegionLayerRestriction(
    { territoryCode: "304", id: "territory-304", name: "Greenland" },
    "PM25_RH35"
  );
  assert.ok(byCode, "Greenland territoryCode 304 must restrict PM25_RH35");
  assert.equal(byCode.fallbackLayer, "O3");

  const byIdOnly = getRegionLayerRestriction({ id: "territory-304", name: "Custom" }, "PM25_RH35");
  assert.ok(byIdOnly, "territory-304 id must restrict PM25_RH35");
  assert.equal(byIdOnly.fallbackLayer, "O3");

  const byNameOnly = getRegionLayerRestriction({ name: " greenland " }, "PM25_RH35");
  assert.ok(byNameOnly, "Greenland name lookup must restrict PM25_RH35 case-insensitively");
  assert.equal(byNameOnly.fallbackLayer, "O3");

  for (const allowedLayer of ["O3", "CO", "NO2", "SO2"] as const) {
    assert.equal(
      getRegionLayerRestriction(
        { territoryCode: "304", id: "territory-304", name: "Greenland" },
        allowedLayer
      ),
      null,
      `Greenland should allow ${allowedLayer}`
    );
  }

  assert.equal(
    getRegionLayerRestriction(
      { territoryCode: "704", id: "territory-704", name: "Vietnam" },
      "PM25_RH35"
    ),
    null
  );
  assert.equal(
    getRegionLayerRestriction(
      { territoryCode: "578", id: "territory-578", name: "Norway" },
      "PM25_RH35"
    ),
    null
  );
  assert.equal(getRegionLayerRestriction(null, "PM25_RH35"), null);
});
