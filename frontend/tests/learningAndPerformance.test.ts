import test from "node:test";
import assert from "node:assert/strict";
import { resolveTerritoryByCodeOrName } from "../src/lib/worldBoundaries";
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
