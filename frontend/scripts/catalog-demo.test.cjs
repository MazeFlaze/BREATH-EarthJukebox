const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function load(name) {
  const source = path.resolve(__dirname, `../src/services/${name}.ts`);
  const compiled = ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = new Module(source); module.filename = source; module.paths = require.resolve.paths("typescript");
  const nativeRequire = module.require.bind(module);
  module.require = request => request.startsWith("./") ? load(request.slice(2)) : nativeRequire(request);
  module._compile(compiled, source);
  return module.exports;
}
const { traverse } = load("geosCfTraversal");
const { SnapshotCache, temporalSeries } = load("geosCfCatalog");
const { renderDemoPlan, renderFocusPlan, focusParameters, FOCUS_STEMS, NotebookDemoAudio } = load("notebookDemoAudio");
const { buildSweepFrames, renderSweepPlan, sweepVoice, SWEEP_MIX_GAIN, cellPosition } = load("geosCfSweep");
const contract = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../public/data/notebook-demo/contract.json"), "utf8"));
const baseline = contract.global_plans.pm25_rh35;
const rc = e => [(90 - e.scientific.bounds.lat[1]) / 45, (e.scientific.bounds.lon[0] + 180) / 45];
const feature = e => ({ ...e, focus_feature: { cell_id: rc(e).join(":"), p90: 20, iqr: 4, spread_score: .04, neighbor_contrast: .15, coverage: 1 } });

test("Horizontal sweeps advance west-east through whole columns; vertical sweeps advance north-south through whole rows", () => {
  const before = JSON.stringify(baseline);
  for (const axis of ["horizontal", "vertical"]) {
    const frames = buildSweepFrames(baseline, axis);
    assert.equal(frames.length, axis === "horizontal" ? 8 : 4);
    assert.equal(new Set(frames.flatMap(f => f.cells.map(e => e.event_id))).size, 32);
    for (const [n, frame] of frames.entries()) {
      assert.equal(frame.index, n); assert.equal(frame.cells.length, axis === "horizontal" ? 4 : 8);
      frame.cells.forEach((event, lane) => {
        assert.equal(baseline.find(e => e.event_id === event.event_id), event);
        const pos = cellPosition(event);
        assert.equal(axis === "horizontal" ? pos.col : pos.row, n);
        assert.equal(axis === "horizontal" ? pos.row : pos.col, lane);
      });
    }
    assert.deepEqual(buildSweepFrames(baseline, axis, true), [...frames].reverse());
    assert.equal(new Set(frames[0].cells.map(e => sweepVoice(e, axis).hz)).size, frames[0].cells.length);
  }
  assert.equal(JSON.stringify(baseline), before);
  assert.throws(() => buildSweepFrames(baseline.slice(1), "horizontal"));
  const duplicate = [...baseline]; duplicate[1] = duplicate[0]; assert.throws(() => buildSweepFrames(duplicate, "horizontal"));
  const mixed = structuredClone(baseline); mixed[0].scientific.timestamp_utc = "2026-11-13T00:30:00Z";
  assert.throws(() => buildSweepFrames(mixed, "horizontal"));
});

test("Sweep voices start together on the audio clock, retain pulse timing, and stay below headroom for all six real plans", () => {
  for (const axis of ["horizontal", "vertical"]) for (const events of Object.values(contract.global_plans)) {
    const frames = buildSweepFrames(events.map(feature), axis);
    const rendered = renderSweepPlan(frames, contract.audio);
    assert.ok(rendered.peak < .93);
    const size = Math.round(contract.audio.sample_rate * contract.audio.seconds_per_bar);
    for (const event of frames[0].cells) {
      const voice = sweepVoice(event, axis);
      const carrier = rendered.tracks.find(t => t.lane === voice.lane && t.name === "carrier");
      const reference = renderDemoPlan([event], { ...contract.audio, pulse_hz: voice.hz, missing_hz: voice.hz * 2 ** (1 / 12) }).carrier;
      assert.equal(carrier.pcm.left.length, size * frames.length);
      const left = Math.cos((voice.pan + 1) * Math.PI / 4);
      assert.deepEqual(carrier.pcm.left.slice(0, size), Float32Array.from(reference.left, x => x * SWEEP_MIX_GAIN * left));
    }
  }
});

test("Reverse and seek preserve sweep voice PCM and the same fixed mix gain", () => {
  const frames = buildSweepFrames(baseline.map(feature), "horizontal");
  const before = JSON.stringify(frames);
  const forward = renderSweepPlan(frames, contract.audio), reversed = renderSweepPlan([...frames].reverse(), contract.audio);
  const size = Math.round(contract.audio.sample_rate * contract.audio.seconds_per_bar), selected = 3;
  const seek = renderSweepPlan(frames.slice(selected), contract.audio);
  for (const track of forward.tracks) {
    const other = reversed.tracks.find(t => t.lane === track.lane && t.name === track.name);
    const sought = seek.tracks.find(t => t.lane === track.lane && t.name === track.name);
    for (let n = 0; n < frames.length; n++) for (const side of ["left", "right"])
      assert.deepEqual(track.pcm[side].slice(n * size, (n + 1) * size), other.pcm[side].slice((frames.length - 1 - n) * size, (frames.length - n) * size));
    assert.deepEqual(track.pcm.left.slice(selected * size), sought.pcm.left);
  }
  assert.equal(JSON.stringify(frames), before);
});

test("Simultaneous missing and valid-zero voices remain distinct; half-sample rounding agrees with A", () => {
  const events = baseline.map(feature);
  const first = events[0] = structuredClone(events[0]);
  Object.assign(first.scientific, { value: null, pulses: null, score: null, missing: true });
  const otherIndex = events.findIndex(e => cellPosition(e).row === 1 && cellPosition(e).col === 0);
  events[otherIndex] = structuredClone(events[otherIndex]);
  Object.assign(events[otherIndex].scientific, { value: 0, score: 0, pulses: 0, missing: false });
  const frames = buildSweepFrames(events, "horizontal").slice(0, 1);
  const rendered = renderSweepPlan(frames, { ...contract.audio, sample_rate: 11025 });
  assert.equal(rendered.tracks[0].pcm.left.length, 9922);
  assert.ok(rendered.tracks.find(t => t.lane === "row0" && t.name === "carrier").pcm.left.some(x => x !== 0));
  assert.ok(rendered.tracks.find(t => t.lane === "row1" && t.name === "carrier").pcm.left.every(x => x === 0));
  assert.ok(rendered.tracks.filter(t => t.lane === "row0" && t.name !== "carrier").every(t => t.pcm.left.every(x => x === 0)));
});

test("Sweep transport schedules every lane together; lane solo/mute includes carrier, while stem/mode affects music only", async () => {
  const gains = [], sources = []; let clock = 0, tick, completed = 0, resumed = Promise.resolve();
  global.requestAnimationFrame = callback => { tick = callback; return 1; }; global.cancelAnimationFrame = () => {};
  global.AudioContext = class {
    get currentTime() { return clock; } destination = {};
    resume() { return resumed; }
    createGain() { const node = { target: null, gain: { value: 0, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } }, connect(target) { this.target = target; }, disconnect() {} }; gains.push(node); return node; }
    createBuffer(channels, length, rate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / rate, getChannelData: n => data[n] }; }
    createBufferSource() { const node = { route: null, startAt: null, connect(target) { this.route = target; }, disconnect() {}, start(time) { this.startAt = time; }, stop() {} }; sources.push(node); return node; }
    close() { return Promise.resolve(); }
  };
  const frames = buildSweepFrames(baseline.map(feature), "horizontal").slice(0, 2);
  const rendered = renderSweepPlan(frames, contract.audio);
  const audio = new NotebookDemoAudio(() => {}, () => {}, () => completed++);
  await audio.playPrepared(frames.map(f => f.cells[0]), contract.audio, () => rendered.tracks);
  assert.equal(sources.length, 20); assert.equal(new Set(sources.map(s => s.startAt)).size, 1);
  const initialMaster = gains[0].gain.value;
  audio.setLane("row1", { solo: true });
  rendered.tracks.forEach((track, n) => assert.equal(sources[n].route.target.gain.value, track.lane === "row1" ? 1 : 0));
  audio.setLane("row1", { gain: .4 });
  rendered.tracks.forEach((track, n) => { if (track.lane === "row1") assert.equal(sources[n].route.target.gain.value, .4); });
  audio.setMode("scientific"); assert.equal(gains[1].gain.value, 0); assert.equal(gains[0].gain.value, initialMaster);
  const carrier = sources[rendered.tracks.findIndex(t => t.lane === "row1" && t.name === "carrier")];
  assert.equal(carrier.route.target.target, gains[0]);
  audio.setLane("row1", { muted: true }); assert.equal(carrier.route.target.gain.value, 0);
  audio.pause(); await audio.resume();
  assert.equal(sources.length, 40);
  clock = 9; tick(); assert.equal(completed, 1); tick(); assert.equal(completed, 1);
  let unlock; resumed = new Promise(resolve => { unlock = resolve; });
  const count = sources.length;
  const pending = audio.playPrepared(frames.map(f => f.cells[0]), contract.audio, () => rendered.tracks);
  audio.stop(); unlock(); await pending; assert.equal(sources.length, count);
  audio.dispose();
});

test("All traversal combinations visit 32 fixed cells once, with edge-adjacent steps and immutable data", () => {
  const before = JSON.stringify(baseline);
  for (const pattern of ["horizontal", "vertical", "rings"]) for (const clockwise of [true, false]) for (const inward of [true, false]) {
    const events = traverse(baseline, { pattern, clockwise, inward });
    assert.equal(events.length, 32); assert.equal(new Set(events.map(e => e.event_id)).size, 32);
    for (const event of events) assert.equal(event, baseline.find(e => e.event_id === event.event_id));
    for (let n = 1; n < events.length; n++) {
      const a = rc(events[n - 1]), b = rc(events[n]);
      assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, `${pattern}/${clockwise}/${inward}: step ${n}`);
    }
    if (pattern === "rings") {
      const [r, c] = rc(events[0]);
      assert.equal(r === 0 || r === 3 || c === 0 || c === 7, inward);
      assert.notDeepEqual(events.map(e => e.event_id), traverse(baseline, { pattern, clockwise: !clockwise, inward }).map(e => e.event_id));
    }
  }
  assert.equal(JSON.stringify(baseline), before);
  assert.throws(() => traverse(baseline.slice(0, 31), { pattern: "rings", clockwise: true, inward: true }));
});

test("Focus retains exact scientific carrier and headroom with four active stems across six pollutants", () => {
  for (const events of Object.values(contract.global_plans)) {
    const plan = events.map(feature);
    const focus = renderFocusPlan(plan, contract.audio);
    assert.deepEqual(focus.carrier, renderDemoPlan(plan, contract.audio).carrier);
    assert.ok(focus.peak < .93);
    for (const stem of FOCUS_STEMS) assert.ok(focus.stems[stem].left.some(x => x !== 0), stem);
  }
});

test("Focus distinguishes low-score gas cells without changing A calibration; reverse/seek keeps cell-level mapping", () => {
  for (const key of ["co", "no2", "so2"]) {
    const events = contract.global_plans[key].map(feature);
    assert.ok(new Set(events.map(e => focusParameters(e).midi)).size > 20);
  }
  const event = feature(baseline[8]);
  const changed = structuredClone(event); changed.focus_feature.spread_score = .8; changed.focus_feature.neighbor_contrast = .9;
  const a = renderFocusPlan([event], contract.audio), b = renderFocusPlan([changed], contract.audio);
  assert.deepEqual(a.carrier, b.carrier); assert.deepEqual(a.stems.lead, b.stems.lead);
  assert.notDeepEqual(a.stems.pad, b.stems.pad); assert.notDeepEqual(a.stems.texture, b.stems.texture);
  const sequence = baseline.slice(0, 3).map(feature), copy = JSON.stringify(sequence);
  const forward = renderFocusPlan(sequence, contract.audio);
  const reversed = renderFocusPlan([...sequence].reverse(), contract.audio);
  const frames = Math.round(contract.audio.sample_rate * contract.audio.seconds_per_bar);
  for (const name of FOCUS_STEMS) for (let n = 0; n < 3; n++) {
    assert.deepEqual(forward.stems[name].left.slice(n * frames, (n + 1) * frames), reversed.stems[name].left.slice((2 - n) * frames, (3 - n) * frames));
  }
  assert.equal(JSON.stringify(sequence), copy);
});

test("Missing Focus events have a cue and no music; zero is distinct", () => {
  const missing = structuredClone(feature(baseline[0]));
  Object.assign(missing.scientific, { missing: true, pulses: null, value: null, score: null });
  const rendered = renderFocusPlan([missing], contract.audio);
  assert.ok(rendered.carrier.left.some(x => x !== 0));
  for (const stem of FOCUS_STEMS) assert.ok(rendered.stems[stem].left.every(x => x === 0));
});

function entry(n) {
  return { id: `fixture-${n}`, status: "ready", sha256: `fixture-${n}`, timestamp_utc: `2026-11-12T${String(n).padStart(2, "0")}:30:00Z`, snapshot_url: `/data/fixture-${n}.json` };
}
function snapshot(n) {
  const data = structuredClone(contract), meta = entry(n);
  data.source.timestamp_utc = meta.timestamp_utc; data.source.sha256 = meta.sha256;
  for (const plans of [data.global_plans, data.region_plans]) for (const events of Object.values(plans)) for (const event of events) {
    event.scientific.timestamp_utc = meta.timestamp_utc; event.scientific.source_sha256 = meta.sha256;
    event.scientific.value = n + 1; event.scientific.score = (n + 1) / 100;
  }
  const features = Object.fromEntries(Object.keys(data.pollutants).map(key => [key, Object.fromEntries([...data.global_plans[key], ...data.region_plans[key]].map(e => [e.scientific.scan_id, feature(e).focus_feature]))]));
  return { schema_version: "geos-cf-catalog-snapshot-v1", focus_mapping_version: "focus-artistic-log99-v1", baseline: data, features };
}

test("Temporal fixes location, exposes missing hours with no fabricated hash, and preserves chronological delta in reverse", async () => {
  const calls = [];
  const cache = { async load(e) { calls.push(e.id); return snapshot(+e.id.split("-")[1]); } };
  const events = await temporalSeries([entry(3), entry(0), entry(4)], cache, "co", "G10");
  assert.equal(events.length, 5); assert.equal(events[0].scientific.scan_id, "G10");
  assert.equal(events[1].timeline_gap, true); assert.equal(events[2].timeline_gap, true);
  for (const gap of events.slice(1, 3)) {
    assert.equal(gap.scientific.source_sha256, null); assert.equal(gap.scientific.value, null); assert.equal(gap.scientific.pulses, null);
    assert.equal(gap.chronological_delta, null); assert.equal(gap.artistic_mood, null);
  }
  assert.equal(events[3].chronological_delta, null); assert.equal(events[4].chronological_delta, 1);
  assert.equal([...events].reverse()[0].chronological_delta, 1);
  assert.deepEqual(calls, ["fixture-0", "fixture-3", "fixture-4"]);
  await assert.rejects(temporalSeries([entry(0)], cache, "co", "G10"));
  await assert.rejects(temporalSeries([entry(0), { ...entry(1), timestamp_utc: "2026-11-15T00:30:00Z" }], cache, "co", "G10"));
});

test("Snapshot cache is lazy, bounded to three, and rejects mismatched provenance; cancelled Temporal stops loading", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async url => { calls++; return { ok: true, json: async () => snapshot(+url.match(/fixture-(\d+)/)[1]) }; };
    const cache = new SnapshotCache();
    for (let n = 0; n < 6; n++) await cache.load(entry(n));
    assert.equal(cache.size, 3); assert.equal(calls, 6);
    await cache.load(entry(5)); assert.equal(calls, 6);
    await cache.load(entry(0)); assert.equal(calls, 7); assert.equal(cache.size, 3);
    await assert.rejects(cache.load({ ...entry(9), sha256: "wrong" }));
    await assert.rejects(cache.load({ ...entry(10), status: "missing" }));
    const before = calls;
    await assert.rejects(temporalSeries([entry(0), entry(1)], cache, "co", "G10", () => false));
    assert.equal(calls, before);
  } finally { global.fetch = originalFetch; }
});

test("Focus mute, solo, gain and mode switching affect only music; stale play cannot restart after stop", async () => {
  const gains = [], sources = [];
  global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
  let resume = Promise.resolve();
  global.AudioContext = class {
    currentTime = 0; destination = {};
    resume() { return resume; }
    createGain() { const node = { gain: { value: 0, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } }, connect() {}, disconnect() {} }; gains.push(node); return node; }
    createBuffer(channels, length, rate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / rate, getChannelData: n => data[n] }; }
    createBufferSource() { const node = { connect() {}, disconnect() {}, start() {}, stop() {} }; sources.push(node); return node; }
    close() { return Promise.resolve(); }
  };
  const audio = new NotebookDemoAudio(() => {}, () => {});
  await audio.play(baseline.slice(0, 2).map(feature), contract.audio, "focus");
  assert.equal(sources.length, 5);
  const master = gains[0].gain.value;
  audio.setMode("harmonic"); audio.setStem("lead", { solo: true });
  assert.equal(gains[2].gain.value, 1); for (const n of [3, 4, 5]) assert.equal(gains[n].gain.value, 0);
  audio.setStem("lead", { gain: .25 }); assert.equal(gains[2].gain.value, .25);
  audio.setStem("lead", { muted: true }); assert.equal(gains[2].gain.value, 0);
  audio.setMode("scientific"); assert.equal(gains[1].gain.value, 0); assert.equal(gains[0].gain.value, master);
  let unlock; resume = new Promise(resolve => { unlock = resolve; });
  const pending = audio.play(baseline.slice(0, 1), contract.audio, "focus");
  const before = sources.length; audio.stop(); unlock(); await pending; assert.equal(sources.length, before);
  audio.dispose();
});
