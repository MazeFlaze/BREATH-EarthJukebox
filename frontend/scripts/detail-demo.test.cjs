const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../public/audio/' + name + '.mjs')).href);
const geometry = { rows: 721, cols: 1440, lat_first: 90, lat_step: -.25, lon_first: -180, lon_step: .25 };
const options = { resolution: 45, profile: 'focus', axis: 'horizontal', bands: 8, audioMax: 100 };

test('All 1,038,240 native samples partition once at every grid level, preserving zero/missing and weighted mean', async () => {
  const { prepareDetail } = await load('geos-cf-data');
  const values = new Float32Array(geometry.rows * geometry.cols).fill(7);
  values[0] = NaN; values[1441] = 0;
  for (const resolution of [45, 22.5, 11.25, 5, 1, 'native']) {
    const view = prepareDetail(values, geometry, { ...options, resolution, profile: 'spectral' });
    assert.equal(view.included, values.length); assert.equal(view.validTotal, values.length - 1);
    assert.equal(view.totals.reduce((a, b) => a + b, 0), values.length);
    if (resolution === 'native') {
      assert.equal(view.rows, 721); assert.equal(view.cols, 1440);
      assert.ok(Number.isNaN(view.grid[0])); assert.equal(view.grid[1441], 0);
      assert.equal(view.frames.lanes, 721); assert.equal(view.frames.steps, 1440);
    } else assert.ok(view.grid.every(v => v > 6 && v <= 7));
  }
});

test('Focus quantiles use original cells, not means of displayed bins; ROI and direction keep coverage and global register positions', async () => {
  const { prepareDetail } = await load('geos-cf-data');
  const values = new Float32Array(geometry.rows * geometry.cols).fill(NaN);
  values[10 * 1440 + 10] = 0; values[10 * 1440 + 11] = 2;
  values[11 * 1440 + 10] = 4; values[11 * 1440 + 11] = 6;
  const crop = [10, 12, 10, 12];
  for (const axis of ['horizontal', 'vertical']) {
    const view = prepareDetail(values, geometry, { ...options, axis, crop, bands: 8, resolution: 45 });
    assert.equal(view.included, 4); assert.equal(view.validTotal, 4);
    assert.equal(view.frames.p90[0], Math.fround(5.4)); assert.equal(view.frames.spread[0], Math.fround(.03));
    assert.equal(view.rows, 1); assert.equal(view.cols, 1);
    assert.ok(view.frames.mean[0] > 3 && view.frames.mean[0] < 3.1); // lower latitude gets higher area weight.
  }
  const full = prepareDetail(values, geometry, { ...options, profile: 'spectral', resolution: 'native' });
  const roi = prepareDetail(values, geometry, { ...options, profile: 'spectral', resolution: 'native', crop });
  assert.equal(roi.frames.positions[0], full.frames.positions[10]);
  assert.equal(roi.frames.stepPositions[0], full.frames.stepPositions[10]);
  assert.throws(() => prepareDetail(values, geometry, { ...options, crop: [1, 1, 0, 1] }));
});

function smallFrames(missing = false) {
  return { steps: 4, lanes: 2, mean: Float32Array.from([0, missing ? NaN : 10, 30, 40, 50, 70, 80, 90]),
    p90: new Float32Array(8).fill(90), spread: new Float32Array(8).fill(.2), contrast: new Float32Array(8).fill(.3),
    coverage: Float32Array.from([1, missing ? 0 : 1, 1, 1, 1, 1, 1, 1]),
    profile: 'focus', axis: 'horizontal', audioMax: 100 };
}

test('Streaming clock lasts exactly 3/5/7 minutes, pause does not advance; seek/reverse do not mutate source features', async () => {
  const { DetailSynth } = await load('geos-cf-dsp');
  const frames = smallFrames(), before = [...frames.mean];
  for (const duration of [180, 300, 420]) {
    const synth = new DetailSynth(frames, 12000, duration);
    const left = new Float32Array(128), right = new Float32Array(128);
    synth.process(left, right); assert.equal(synth.cursor, 0);
    synth.seek(3); synth.cursor = synth.total - 73; synth.paused = false;
    synth.process(left, right); assert.equal(synth.cursor, duration * 12000);
    assert.ok(left.slice(73).every(x => x === 0));
    synth.setControls({ reverse: true }); synth.seek(0); assert.equal(synth.sourceStep(), 3);
    synth.seek(2); assert.equal(synth.sourceStep(), 1);
  }
  assert.deepEqual([...frames.mean], before);
});

test('Continuous output is deterministic, preserves data bus across music toggles, and bounds even boosted output', async () => {
  const { DetailSynth } = await load('geos-cf-dsp');
  const frames = smallFrames(), a = new DetailSynth(frames, 48000, 300), b = new DetailSynth(frames, 48000, 300);
  a.paused = false; b.paused = false;
  const l = new Float32Array(128), r = new Float32Array(128), l2 = new Float32Array(128), r2 = new Float32Array(128);
  a.process(l, r); b.process(l2, r2); assert.deepEqual(l, l2);
  b.setControls({ music: true, monitor: 4, volume: 1, stems: [1, 1, 1, 1] });
  for (let n = 0; n < 500; n++) b.process(l2, r2);
  assert.ok(b.peak <= .900001); assert.ok(l2.every(Number.isFinite));
  // Identical data targets regardless of Harmonic switch; no per-frame amplitude normalization.
  a.updateTargets(); b.updateTargets();
  const c = new DetailSynth(frames, 48000, 300, { music: true }); c.updateTargets();
  assert.equal(a.targets[0], c.targets[0]); assert.equal(a.targets[4], c.targets[4]);
  b.setControls({ from: 1, to: 1 }); b.updateTargets(); assert.equal(b.targets[0], 0);
});

test('Missing cue differs from valid zero; 20-second previews end on the sample clock', async () => {
  const { DetailSynth } = await load('geos-cf-dsp');
  const missing = new DetailSynth(smallFrames(true), 12000, 300, { from: 1, to: 1 });
  const zeroFrames = smallFrames(); zeroFrames.mean.fill(0);
  const zero = new DetailSynth(zeroFrames, 12000, 300);
  missing.paused = false; zero.paused = false;
  const l = new Float32Array(128), r = new Float32Array(128), zl = new Float32Array(128), zr = new Float32Array(128);
  missing.process(l, r); zero.process(zl, zr);
  assert.ok(l.some(x => x !== 0)); assert.ok(zl.every(x => x === 0));
  missing.end = missing.cursor + 20 * 12000;
  while (missing.cursor < missing.end) missing.process(l, r);
  assert.equal(missing.cursor, 128 + 20 * 12000);
});

test('Native spectral bank supports 1440 voices without PCM growth, ignores music, and caps its top frequency below Nyquist', async () => {
  const { DetailSynth } = await load('geos-cf-dsp');
  const lanes = 1440, frames = { ...smallFrames(), profile: 'spectral', axis: 'vertical', steps: 2, lanes,
    mean: new Float32Array(lanes * 2).fill(60), coverage: new Float32Array(lanes * 2).fill(1) };
  const a = new DetailSynth(frames, 12000, 300), b = new DetailSynth(frames, 12000, 300, { music: true });
  assert.equal(a.osc.length, lanes * 12); assert.equal(a.amplitudes.length, lanes * 4);
  assert.ok(Math.abs(a.osc[(lanes - 1) * 12 + 2] - 2 * Math.cos(2 * Math.PI * 4800 / 12000)) < 1e-12);
  a.paused = false; b.paused = false;
  const left = new Float32Array(128), right = new Float32Array(128), other = new Float32Array(128), otherR = new Float32Array(128);
  for (let n = 0; n < 20; n++) { a.process(left, right); b.process(other, otherR); }
  assert.deepEqual(left, other); assert.ok(a.peak <= .900001); assert.ok(left.every(Number.isFinite));
});

test('Actual native cache matches baseline scientific means and covers all six verified fields', async t => {
  const catalogPath = path.resolve(__dirname, '../public/data/geos-cf-catalog/index.json');
  if (!fs.existsSync(catalogPath)) { t.skip('Native NASA cache is intentionally local-only'); return; }
  const { prepareDetail } = await load('geos-cf-data');
  const index = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const entry = index.entries.find(e => e.status === 'ready' && e.detail_url && e.snapshot_url);
  if (!entry) { t.skip('No verified snapshot+detail baseline export'); return; }
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public' + entry.detail_url), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public' + entry.snapshot_url), 'utf8')).baseline;
  for (const key of Object.keys(manifest.fields)) {
    const data = fs.readFileSync(path.resolve(__dirname, '../public' + manifest.fields[key].url));
    const values = Float32Array.from({ length: data.length / 4 }, (_, i) => data.readFloatLE(i * 4));
    const view = prepareDetail(values, manifest, { ...options, audioMax: manifest.fields[key].audio_max });
    assert.equal(view.included, 1038240); assert.equal(view.validTotal, manifest.fields[key].valid_count);
    for (const event of baseline.global_plans[key]) {
      const b = event.scientific.bounds, r = Math.round((90 - b.lat[1]) / 45), c = Math.round((b.lon[0] + 180) / 45);
      assert.ok(Math.abs(view.grid[r * 8 + c] - event.scientific.value) <= Math.max(1e-6, event.scientific.value * 2e-6));
    }
  }
});

test('Actual worklet disposes oscillator bank and ends preview at the audio clock after seek', async () => {
  let Processor;
  global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
  global.sampleRate = 12000;
  global.registerProcessor = (name, implementation) => { Processor = implementation; };
  await load('geos-cf-stream.worklet');
  const instance = new Processor(), send = data => instance.port.onmessage({ data });
  send({ type: 'load', frames: smallFrames(), duration: 300, controls: {} });
  send({ type: 'limit', seconds: 20 }); send({ type: 'seek', step: 1 });
  assert.equal(instance.synth.end, instance.synth.cursor + 20 * 12000);
  send({ type: 'playing', value: true });
  const output = [[new Float32Array(128), new Float32Array(128)]];
  assert.equal(instance.process([], output), true);
  send({ type: 'dispose' });
  assert.equal(instance.synth, null); assert.equal(instance.process([], output), false);
  delete global.AudioWorkletProcessor; delete global.sampleRate; delete global.registerProcessor;
});
