const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../public/audio/' + name + '.mjs')).href);
function frames() {
  const steps = 1440, lanes = 8, mean = new Float32Array(steps * lanes);
  const p90 = new Float32Array(mean.length), spread = new Float32Array(mean.length);
  for (let s = 0; s < steps; s++) for (let l = 0; l < lanes; l++) {
    const i = s * lanes + l;
    mean[i] = 8 + l + 5 * Math.sin(s / 8 + l); p90[i] = mean[i] + l + 2; spread[i] = (l + 1) / 100;
  }
  return { steps, lanes, mean, p90, spread, contrast: new Float32Array(mean.length), coverage: new Float32Array(mean.length).fill(1),
    positions: Float32Array.from({ length: lanes }, (_, i) => (i + .5) / lanes),
    stepPositions: Float32Array.from({ length: steps }, (_, i) => (i + .5) / steps), profile: 'focus', axis: 'horizontal', audioMax: 100 };
}
const controls = { music: true, arrangement: 'context', from: 0, to: 7, stems: [1, 1, 1, 1], volume: .55, monitor: 1, referenceGain: 0, space: .12 };
function render(DetailSynth, f, c = {}, seconds = 2, start = 0, duration = 300, sr = 12000) {
  const synth = new DetailSynth(f, sr, duration, { ...controls, ...c }); synth.seek(start); synth.paused = false;
  const output = new Float32Array(Math.round(seconds * sr)), l = new Float32Array(128), r = new Float32Array(128);
  for (let i = 0; i < output.length; i += 128) { synth.process(l, r); output.set(l.subarray(0, Math.min(128, output.length - i)), i); }
  return { synth, output };
}
const power = a => a.reduce((sum, x) => sum + x * x, 0) / a.length;

test('Spatial derivatives distinguish a linear slope from curvature and use actual angular separation', async () => {
  const { createContextPlan } = await load('geos-cf-orchestration');
  const f = frames();
  for (let s = 0; s < f.steps; s++) for (let l = 0; l < f.lanes; l++) f.mean[s * f.lanes + l] = 2 + s * .125;
  const plan = createContextPlan(f, 300);
  assert.ok(Math.abs(plan.gradient[80] - .25) < 1e-4); // 0.125 / .25 deg / 100 / .02
  assert.ok(plan.curvature[80] < 1e-5);
  const coarse = { ...f, stepPositions: Float32Array.from(f.stepPositions, x => x * 2) };
  assert.ok(Math.abs(createContextPlan(coarse, 300).gradient[80] - .125) < 1e-4);
  f.mean[80] = NaN; const missing = createContextPlan(f, 300);
  assert.equal(missing.gradient[80], 0); assert.equal(missing.curvature[80], 0);
});

test('Feature windows partition every slice; selection is deterministic, capped, and respects voice selection without rewriting data', async () => {
  const { createContextPlan, selectContextEvents, musicalNote } = await load('geos-cf-orchestration');
  const f = frames(), before = f.mean.slice();
  for (const duration of [180, 300, 420]) {
    const plan = createContextPlan(f, duration);
    let cursor = 0;
    for (const w of plan.windows) {
      assert.equal(w.startStep, cursor); cursor = w.endStep;
      const events = selectContextEvents(w, 2, 5);
      assert.ok(events.highlights.length <= 3 && events.edges.length <= 2);
      assert.ok([...events.highlights, ...events.edges].every(e => e.lane >= 2 && e.lane <= 5));
      assert.deepEqual(events, selectContextEvents(w, 2, 5));
      assert.ok(events.highlights.every(e => e.note >= 48 && e.note <= 72));
    }
    assert.equal(cursor, f.steps);
  }
  assert.equal(musicalNote(0), 48); assert.equal(musicalNote(1), 72);
  assert.deepEqual(f.mean, before);
  f.mean.fill(5); f.p90.fill(5); f.spread.fill(0);
  const quiet = createContextPlan(f, 300);
  assert.deepEqual(selectContextEvents(quiet.windows[0], 0, 7), { highlights: [], edges: [] });
});

test('Context audio changes the spectrum, is repeatable after seek, and all four stems work independently', async () => {
  const { DetailSynth } = await load('geos-cf-dsp');
  const f = frames(), a = render(DetailSynth, f), b = render(DetailSynth, f);
  assert.deepEqual(a.output, b.output); assert.ok(power(a.output) > 1e-6);
  assert.ok(render(DetailSynth, f, { stems: [0, 0, 0, 0] }).output.every(x => x === 0));
  for (let stem = 0; stem < 4; stem++) {
    const solo = [0, 0, 0, 0]; solo[stem] = 1;
    assert.ok(power(render(DetailSynth, f, { stems: solo }).output) > 1e-9, `stem ${stem} is audible in PCM`);
  }
  assert.deepEqual(render(DetailSynth, f, {}, 1, 100).output, render(DetailSynth, f, {}, 1, 100).output);
  // A fixed high-location field: lower adjacent-sample variation verifies that the new bank
  // actually moves energy away from the old high carrier; this is not a pleasantness test.
  f.mean.fill(25); f.p90.fill(25); f.spread.fill(0); f.positions.fill(.99);
  const warm = render(DetailSynth, f, { space: 0 }).output;
  const old = render(DetailSynth, f, { arrangement: 'legacy', music: false }).output;
  const variation = a => { let sum = 0; for (let i = 1; i < a.length; i++) sum += (a[i] - a[i - 1]) ** 2; return sum / a.length / power(a); };
  assert.ok(variation(warm) < variation(old) * .3);
  const low = power(render(DetailSynth, f, { space: 0 }).output); f.mean.fill(50);
  assert.ok(power(render(DetailSynth, f, { space: 0 }).output) > low * 1.9);
});

test('Missing stays distinct from zero; mute, reference solo, reverse, pause and preview retain their meanings', async () => {
  const { DetailSynth } = await load('geos-cf-dsp');
  const f = frames(); f.mean.fill(0); f.p90.fill(0); f.spread.fill(0);
  assert.equal(power(render(DetailSynth, f).output), 0);
  f.mean.fill(NaN); f.coverage.fill(0);
  assert.ok(power(render(DetailSynth, f).output) > 0);
  const g = frames();
  const ref = render(DetailSynth, g, { referenceSolo: true }).output;
  const refMuted = render(DetailSynth, g, { referenceSolo: true, stems: [0, 0, 0, 0] }).output;
  assert.deepEqual(ref, refMuted);
  const synth = new DetailSynth(g, 12000, 180, { ...controls, reverse: true });
  const l = new Float32Array(128), r = new Float32Array(128);
  synth.process(l, r); assert.equal(synth.cursor, 0); synth.paused = false;
  synth.seek(100); assert.equal(synth.sourceStep(), 1339);
  synth.end = synth.cursor + 20 * 12000;
  while (synth.cursor < synth.end) synth.process(l, r);
  assert.equal(synth.cursor, 100 * synth.stepSamples + 240000);
  synth.setControls({ from: 4, to: 4 }); synth.seek(1439); synth.end = synth.total;
  while (synth.cursor < synth.end) synth.process(l, r);
  assert.ok(l.every(Number.isFinite)); assert.ok(synth.peak <= .900001);
});

test('All six local NASA fields render contextual audio with headroom and source-independent fixed mapping', async t => {
  const root = path.resolve(__dirname, '../public');
  const catalogPath = path.join(root, 'data/geos-cf-catalog/index.json');
  if (!fs.existsSync(catalogPath)) { t.skip('NASA export is local-only'); return; }
  const entry = JSON.parse(fs.readFileSync(catalogPath)).entries.find(e => e.status === 'ready' && e.detail_url);
  if (!entry) { t.skip('No verified source'); return; }
  const manifest = JSON.parse(fs.readFileSync(root + entry.detail_url));
  const { prepareDetail } = await load('geos-cf-data'), { DetailSynth } = await load('geos-cf-dsp');
  for (const [key, field] of Object.entries(manifest.fields)) {
    const raw = fs.readFileSync(root + field.url), values = Float32Array.from({ length: raw.length / 4 }, (_, i) => raw.readFloatLE(i * 4));
    for (const axis of ['horizontal', 'vertical']) {
      const view = prepareDetail(values, manifest, { resolution: 'native', profile: 'focus', axis, bands: 16, audioMax: field.audio_max });
      assert.equal(view.included, 1038240);
      // Several distinct regions including late slices, selected near the center of the scan.
      const result = render(DetailSynth, view.frames, { to: 15 }, 1, Math.floor(view.frames.steps * .6));
      assert.ok(result.output.every(Number.isFinite), key);
      assert.ok(result.synth.peak > 0 && result.synth.peak < .88, `${key} ${axis}: ${result.synth.peak}`);
      assert.equal(result.synth.limited, 0);
    }
  }
});
