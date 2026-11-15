import test from "node:test";
import assert from "node:assert/strict";
import { syncMapViewportLock, type LockableMapViewport } from "../src/lib/mapInteractionLock";

function createFakeMap(opts: { moving?: boolean; pitch?: number; bearing?: number } = {}) {
  const states: Record<string, boolean> = {
    dragPan: true,
    scrollZoom: true,
    boxZoom: true,
    doubleClickZoom: true,
    touchZoomRotate: true,
    touchPitch: true,
    dragRotate: true,
    keyboard: true,
  };

  let stopCalls = 0;
  let setPitchCalls = 0;
  let setBearingCalls = 0;
  let pitch = opts.pitch ?? 0;
  let bearing = opts.bearing ?? 0;

  const makeHandler = (name: keyof typeof states) => ({
    enable: () => {
      states[name] = true;
    },
    disable: () => {
      states[name] = false;
    },
  });

  const map: LockableMapViewport = {
    dragPan: makeHandler("dragPan"),
    scrollZoom: makeHandler("scrollZoom"),
    boxZoom: makeHandler("boxZoom"),
    doubleClickZoom: makeHandler("doubleClickZoom"),
    touchZoomRotate: makeHandler("touchZoomRotate"),
    touchPitch: makeHandler("touchPitch"),
    dragRotate: makeHandler("dragRotate"),
    keyboard: makeHandler("keyboard"),
    isMoving: () => Boolean(opts.moving),
    stop: () => {
      stopCalls += 1;
    },
    getPitch: () => pitch,
    setPitch: (next: number) => {
      setPitchCalls += 1;
      pitch = next;
    },
    getBearing: () => bearing,
    setBearing: (next: number) => {
      setBearingCalls += 1;
      bearing = next;
    },
  };

  return {
    map,
    states,
    getCounts: () => ({ stopCalls, setPitchCalls, setBearingCalls, pitch, bearing }),
  };
}

test("syncMapViewportLock halts active motion, flattens orientation, and disables all viewport handlers when locked", () => {
  const fake = createFakeMap({ moving: true, pitch: 25, bearing: -14 });

  syncMapViewportLock(fake.map, { locked: true, allowDragPan: true });

  assert.deepEqual(fake.states, {
    dragPan: false,
    scrollZoom: false,
    boxZoom: false,
    doubleClickZoom: false,
    touchZoomRotate: false,
    touchPitch: false,
    dragRotate: false,
    keyboard: false,
  });

  const counts = fake.getCounts();
  assert.equal(counts.stopCalls, 1);
  assert.equal(counts.setPitchCalls, 1);
  assert.equal(counts.setBearingCalls, 1);
  assert.equal(counts.pitch, 0);
  assert.equal(counts.bearing, 0);
});

test("syncMapViewportLock avoids redundant stop/orientation calls when map is already stationary and flat", () => {
  const fake = createFakeMap({ moving: false, pitch: 0, bearing: 0 });

  syncMapViewportLock(fake.map, { locked: true, allowDragPan: false });

  const counts = fake.getCounts();
  assert.equal(counts.stopCalls, 0);
  assert.equal(counts.setPitchCalls, 0);
  assert.equal(counts.setBearingCalls, 0);
  assert.equal(fake.states.dragPan, false);
  assert.equal(fake.states.scrollZoom, false);
});

test("syncMapViewportLock restores pan/zoom handlers on unlock while keeping dragRotate disabled and honoring allowDragPan", () => {
  const fake = createFakeMap();

  syncMapViewportLock(fake.map, { locked: true, allowDragPan: true });
  syncMapViewportLock(fake.map, { locked: false, allowDragPan: true });

  assert.deepEqual(fake.states, {
    dragPan: true,
    scrollZoom: true,
    boxZoom: true,
    doubleClickZoom: true,
    touchZoomRotate: true,
    touchPitch: true,
    dragRotate: false,
    keyboard: true,
  });

  syncMapViewportLock(fake.map, { locked: false, allowDragPan: false });
  assert.equal(fake.states.dragPan, false);
  assert.equal(fake.states.scrollZoom, true);
  assert.equal(fake.states.dragRotate, false);
});

test("syncMapViewportLock handles null and undefined maps safely", () => {
  assert.doesNotThrow(() => {
    syncMapViewportLock(null, { locked: true, allowDragPan: false });
    syncMapViewportLock(undefined, { locked: false, allowDragPan: true });
  });
});
