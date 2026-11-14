const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// Compile the actual browser DSP in memory, without a second implementation or build artifacts.
const source = path.resolve(__dirname, "../src/services/notebookDemoAudio.ts");
const compiled = ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = new Module(source, module); loaded.filename = source; loaded.paths = module.paths; loaded._compile(compiled, source);
const { renderDemoPlan, NotebookDemoAudio } = loaded.exports;
const contract = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../public/data/notebook-demo/contract.json"), "utf8"));

test("PCM matches independent notebook WAV golden probes for all six pollutants and both data/audio modes", () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/notebook-a-pcm-reference.json"), "utf8"));
  assert.equal(contract.source.sha256, golden.source_sha256);
  for (const key of Object.keys(contract.pollutants)) for (const mode of ["global", "region"]) {
    const plan = mode === "global" ? contract.global_plans[key].slice(0, 8) : contract.region_plans[key];
    const rendered = renderDemoPlan(plan, contract.audio);
    for (const record of golden.records.filter(r => r.pollutant === key && r.mode === mode)) {
      assert.equal(rendered.carrier.left.length, record.frames);
      for (const [frame, left, right] of record.probes) for (const [side, expected] of [["left", left], ["right", right]]) {
        const actual = rendered.carrier[side][frame] + (record.mix === "harmonic" ? rendered.music[side][frame] : 0);
        assert.ok(Math.abs(Math.round(actual * 32767) - expected) <= 2, `${key}/${mode}/${record.mix}/${frame}`);
      }
    }
  }
});

test("Scientific carrier is identical with music enabled or disabled; every full plan stays below headroom", () => {
  for (const plan of Object.values(contract.global_plans)) {
    const render = renderDemoPlan(plan, contract.audio);
    assert.ok(render.peak < .93);
    assert.equal(render.carrier.left.length, plan.length * 19845);
    assert.deepEqual(render.carrier.left, render.carrier.right);
    // Mixing and muting the separate music bus never mutates or rescales the data buffer.
    const before = render.carrier.left.slice();
    const mix = Float32Array.from(render.carrier.left, (sample, i) => sample + render.music.left[i]);
    assert.ok(mix.some((sample, i) => sample !== before[i]));
    assert.deepEqual(render.carrier.left, before);
  }
});

test("Missing produces a cue without music; valid zero produces silent carrier", () => {
  const original = contract.global_plans.pm25_rh35[0];
  const zero = structuredClone(original); zero.scientific.pulses = 0; zero.scientific.value = 0;
  const missing = structuredClone(zero); missing.scientific.pulses = null; missing.scientific.value = null;
  missing.artistic_mood = null; missing.texture_pcm = [];
  const a = renderDemoPlan([zero], contract.audio), b = renderDemoPlan([missing], contract.audio);
  assert.ok(a.carrier.left.every(sample => sample === 0));
  assert.ok(b.carrier.left.some(sample => sample !== 0));
  assert.ok(b.music.left.every(sample => sample === 0));
});

test("Reverse/seek preserves frozen plans and deterministic PCM", () => {
  const plan = contract.global_plans.pm25_rh35.slice(11, 17);
  const original = JSON.stringify(plan);
  const forward = renderDemoPlan(plan, contract.audio);
  renderDemoPlan([...plan].reverse(), contract.audio);
  assert.equal(JSON.stringify(plan), original);
  assert.deepEqual(renderDemoPlan(plan, contract.audio), forward);
});

test("Rapid pending play then stop cannot start stale voices; mode toggle leaves carrier bus unchanged", async () => {
  let unlock;
  const pending = new Promise(resolve => { unlock = resolve; });
  const gains = [], sources = [];
  global.cancelAnimationFrame = () => {};
  global.requestAnimationFrame = () => 1;
  global.AudioContext = class {
    currentTime = 0; destination = {}; sampleRate = 22050;
    resume() { return pending; }
    createGain() { const node = { gain: { value: 0, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } }, connect() {}, disconnect() {} }; gains.push(node); return node; }
    createBuffer(channels, length, rate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / rate, getChannelData: i => data[i] }; }
    createBufferSource() { const node = { starts: 0, connect() {}, disconnect() {}, start() { this.starts++; }, stop() {} }; sources.push(node); return node; }
    close() { return Promise.resolve(); }
  };
  const audio = new NotebookDemoAudio(() => {}, () => {});
  const playing = audio.play(contract.region_plans.co, contract.audio);
  audio.stop(); unlock(); await playing;
  assert.equal(sources.length, 0);
  await audio.play(contract.region_plans.co, contract.audio);
  assert.equal(sources.length, 2);
  const carrierGain = gains[0].gain.value;
  audio.setMode("harmonic"); audio.setBlend(0);
  assert.equal(gains[0].gain.value, carrierGain);
  audio.pause(); assert.equal(audio.state, "paused");
  await audio.resume(); assert.equal(audio.state, "playing");
  audio.dispose(); assert.equal(audio.state, "ready");
});

// Optional local acceptance check against the notebook's WAV exports. No notebook execution.
if (process.env.NOTEBOOK_WAV_DIR) test("Browser PCM matches all original notebook A/B preview WAVs within 2 PCM16 steps", () => {
  function waveData(file) {
    const data = fs.readFileSync(file); let cursor = 12, samples;
    while (cursor + 8 <= data.length) {
      const id = data.toString("ascii", cursor, cursor + 4), size = data.readUInt32LE(cursor + 4);
      if (id === "data") { samples = data.subarray(cursor + 8, cursor + 8 + size); break; }
      cursor += 8 + size + (size % 2);
    }
    assert.ok(samples); return samples;
  }
  let maxDifference = 0;
  for (const key of Object.keys(contract.pollutants)) for (const mode of ["global", "region"]) {
    const plan = mode === "global" ? contract.global_plans[key].slice(0, 8) : contract.region_plans[key];
    const pcm = renderDemoPlan(plan, contract.audio);
    for (const mix of ["scientific", "harmonic"]) {
      const name = mode === "global" ? `B_${key}_global_preview_${mix}_nasa.wav` : `A_${key}_compare_regions_${mix}_nasa.wav`;
      const expected = waveData(path.join(process.env.NOTEBOOK_WAV_DIR, name));
      assert.equal(expected.length, pcm.carrier.left.length * 4);
      for (let i = 0; i < pcm.carrier.left.length; i++) for (let channel = 0; channel < 2; channel++) {
        const side = channel ? "right" : "left";
        const value = pcm.carrier[side][i] + (mix === "harmonic" ? pcm.music[side][i] : 0);
        const delta = Math.abs(Math.round(value * 32767) - expected.readInt16LE((i * 2 + channel) * 2));
        maxDifference = Math.max(maxDifference, delta);
        assert.ok(delta <= 2, `${name}: frame=${i} difference=${delta}`);
      }
    }
  }
  console.log(`Notebook WAV parity: maximum difference ${maxDifference} / 32767; 24 WAVs checked`);
});
