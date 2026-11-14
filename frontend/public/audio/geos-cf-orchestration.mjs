// Local research mapping: musical choices are not physical calibration or source attribution.
export const ORCHESTRATION_VERSION = 'context-spatial-pentatonic-v1';
export const STEM_NAMES = ['Field / mean', 'Highlights / P90 excess', 'Spread / IQR', 'Edges / spatial derivatives'];
const clip = x => Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
const score = (x, max) => clip(x / max);
const pentatonic = [0, 2, 4, 7, 9];
export function musicalNote(value, base = 48, octaves = 2) {
  const index = Math.round(clip(value) * octaves * 5);
  return base + Math.floor(index / 5) * 12 + pentatonic[index % 5];
}
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
function addTone(mix, pan, lane, sample) { mix[0] += sample * pan[lane][0]; mix[1] += sample * pan[lane][1]; }

/** Build feature-only windows. No raw values are rewritten or normalized to the current ROI.
 * @param {import('../../src/types/geosCfDetail').DetailFrames} frames
 * @param {number} duration
 * @returns {import('../../src/types/geosCfDetail').ContextPlan}
 */
export function createContextPlan(frames, duration) {
  const { steps, lanes, audioMax, mean } = frames;
  const gradient = new Float32Array(mean.length), curvature = new Float32Array(mean.length);
  const degrees = frames.axis === 'horizontal' ? 360 : 180;
  const position = step => frames.stepPositions?.[step] * degrees;
  const distance = (a, b) => {
    const d = Math.abs(position(a) - position(b));
    return Number.isFinite(d) && d > 0 ? d : degrees / Math.max(1, steps);
  };
  for (let step = 0; step < steps; step++) for (let lane = 0; lane < lanes; lane++) {
    const i = step * lanes + lane, v = mean[i];
    if (!Number.isFinite(v)) continue;
    const before = step > 0 && Number.isFinite(mean[i - lanes]);
    const after = step + 1 < steps && Number.isFinite(mean[i + lanes]);
    const dl = before ? distance(step, step - 1) : 0, dr = after ? distance(step, step + 1) : 0;
    const left = before ? (v - mean[i - lanes]) / dl / audioMax : 0;
    const right = after ? (mean[i + lanes] - v) / dr / audioMax : 0;
    // Fixed artistic reference: 2% of audio_max per degree, 1% per degree squared.
    gradient[i] = clip(Math.abs(before && after ? (left * dl + right * dr) / (dl + dr) : before ? left : right) / .02);
    curvature[i] = before && after ? clip(Math.abs(2 * (right - left) / (dl + dr)) / .01) : 0;
  }
  const windowSteps = Math.max(1, Math.floor(.8 * steps / duration));
  const windows = [];
  for (let startStep = 0; startStep < steps; startStep += windowSteps) {
    const endStep = Math.min(steps, startStep + windowSteps), voices = [];
    for (let lane = 0; lane < lanes; lane++) {
      let count = 0, sum = 0, peak = 0, excess = 0, spread = 0, edge = 0;
      for (let step = startStep; step < endStep; step++) {
        const i = step * lanes + lane;
        if (!Number.isFinite(mean[i])) continue;
        count++; sum += mean[i];
        peak = Math.max(peak, frames.p90?.[i] || 0);
        excess = Math.max(excess, score((frames.p90?.[i] || 0) - mean[i], audioMax));
        spread = Math.max(spread, clip(frames.spread?.[i]));
        edge = Math.max(edge, .7 * gradient[i] + .3 * curvature[i]);
      }
      voices.push({ lane, valid: count > 0, mean: count ? sum / count : null, p90: peak,
        excess, spread, edge, note: musicalNote(Math.sqrt(score(peak, audioMax))) });
    }
    windows.push({ startStep, endStep, voices });
  }
  return { version: ORCHESTRATION_VERSION, windowSteps, windows, gradient, curvature };
}

/** Same selection is used by the UI inspector and the audio thread. Ties keep lane order.
 * @param {import('../../src/types/geosCfDetail').ContextWindow} window
 * @param {number} from
 * @param {number} to
 */
export function selectContextEvents(window, from, to) {
  const selected = window.voices.filter(v => v.valid && v.lane >= from && v.lane <= to);
  return {
    highlights: selected.filter(v => v.excess > .002).sort((a, b) => b.excess - a.excess || a.lane - b.lane).slice(0, 3),
    edges: selected.filter(v => v.edge > .025).sort((a, b) => b.edge - a.edge || a.lane - b.lane).slice(0, 2),
  };
}

// Small additive instrument bank: bounded memory, no samples/downloads, no random progression.
class Tone {
  constructor(sr, midi, harmonics) {
    this.sr = sr; this.midi = -1; this.harmonics = harmonics; this.parts = []; this.gain = 0;
    this.tune(midi);
  }
  tune(midi) {
    if (midi === this.midi) return;
    this.midi = midi;
    this.parts = this.harmonics.map((weight, i) => {
      const omega = 2 * Math.PI * hz(midi) * (i + 1) / this.sr;
      return { y: 0, previous: -Math.sin(omega), coefficient: 2 * Math.cos(omega), weight: hz(midi) * (i + 1) < this.sr * .4 ? weight : 0 };
    });
  }
  sample(target, alpha) {
    this.gain += (target - this.gain) * alpha;
    let sample = 0;
    for (const p of this.parts) {
      sample += p.y * p.weight;
      const next = p.coefficient * p.y - p.previous; p.previous = p.y; p.y = next;
    }
    return sample * this.gain;
  }
}

export class ContextSynth {
  constructor(frames, sr, duration) {
    this.frames = frames; this.sr = sr; this.duration = duration; this.plan = createContextPlan(frames, duration);
    this.cursor = 0; this.end = duration * sr; this.stepSamples = duration * sr / frames.steps;
    this.fields = Array.from({ length: frames.lanes }, (_, lane) => new Tone(sr, musicalNote(frames.positions?.[lane] ?? lane / Math.max(1, frames.lanes - 1), 48, 1), [.72, .19, .06]));
    this.spreads = this.fields.map(tone => new Tone(sr, tone.midi - 12, [.7, .16, .08]));
    this.highlights = Array.from({ length: 3 }, () => new Tone(sr, 60, [.76, .16, .05]));
    this.edges = Array.from({ length: 2 }, () => new Tone(sr, 48, [.8, .12, .04]));
    this.reference = Array.from({ length: frames.lanes }, (_, lane) => {
      const position = frames.positions?.[lane] ?? lane / Math.max(1, frames.lanes - 1);
      return new Tone(sr, 69 + 12 * Math.log2(180 * 2 ** (position * 45 / 12) / 440), [1]);
    });
    this.currentWindow = -1; this.peak = 0; this.limited = 0; this.masterGain = 0;
    this.low = [0, 0]; this.delay = [new Float32Array(Math.round(sr * .137)), new Float32Array(Math.round(sr * .173))]; this.delayIndex = [0, 0];
    this.mix = new Float64Array(2);
  }
  reset(cursor = 0) {
    this.cursor = cursor; this.currentWindow = -1;
    for (const tone of [...this.fields, ...this.spreads, ...this.highlights, ...this.edges, ...this.reference]) {
      const midi = tone.midi; tone.midi = -1; tone.tune(midi); tone.gain = 0;
    }
    this.low.fill(0); this.delay.forEach(d => d.fill(0)); this.delayIndex.fill(0); this.masterGain = 0;
  }
  process(left, right, controls) {
    const f = this.frames, c = controls, sr = this.sr, count = Math.max(1, c.to - c.from + 1);
    const master = clip(c.volume) * Math.max(0, Math.min(4, c.monitor));
    const alpha = 1 - Math.exp(-1 / (sr * .08)), quick = 1 - Math.exp(-1 / (sr * .006));
    const filter = 1 - Math.exp(-2 * Math.PI * 2200 / sr);
    const stems = c.referenceSolo ? [0, 0, 0, 0] : c.stems;
    let previousStep = -1, levels, spreads, missing, pan;
    for (let n = 0; n < left.length && this.cursor < this.end; n++, this.cursor++) {
      const timeline = Math.min(f.steps - 1, Math.floor(this.cursor / this.stepSamples));
      const step = c.reverse ? f.steps - 1 - timeline : timeline;
      const windowIndex = Math.floor(step / this.plan.windowSteps), window = this.plan.windows[windowIndex];
      if (this.currentWindow !== windowIndex) {
        this.currentWindow = windowIndex; this.events = selectContextEvents(window, c.from, c.to);
        this.highlights.forEach((tone, i) => { if (this.events.highlights[i]) tone.tune(this.events.highlights[i].note); });
        this.edges.forEach((tone, i) => { if (this.events.edges[i]) tone.tune(musicalNote(this.events.edges[i].edge, 48, 1)); });
      }
      if (previousStep !== step) {
        previousStep = step; missing = 0; levels = []; spreads = []; pan = [];
        for (let lane = 0; lane < f.lanes; lane++) {
          const i = step * f.lanes + lane, selected = lane >= c.from && lane <= c.to;
          levels[lane] = selected && Number.isFinite(f.mean[i]) ? Math.sqrt(score(f.mean[i], f.audioMax)) : 0;
          spreads[lane] = selected && Number.isFinite(f.mean[i]) ? Math.sqrt(clip(f.spread[i])) : 0;
          if (selected) missing += 1 - f.coverage[i];
          // Lane position provides separation; cursor position adds a smaller scan movement.
          const loc = f.positions?.[lane] ?? lane / Math.max(1, f.lanes - 1);
          const scan = f.stepPositions?.[step] ?? step / Math.max(1, f.steps - 1);
          const angle = (.15 + .7 * (.7 * loc + .3 * scan)) * Math.PI / 2;
          pan[lane] = [Math.cos(angle), Math.sin(angle)];
        }
        missing /= count;
      }
      const start = (c.reverse ? f.steps - window.endStep : window.startStep) * this.stepSamples;
      const length = (window.endStep - window.startStep) * this.stepSamples / sr;
      const age = Math.max(0, (this.cursor - start) / sr);
      const envelope = Math.max(0, Math.min(1, age / .015, (length - age) / .08));
      this.mix.fill(0);
      for (let lane = 0; lane < f.lanes; lane++) {
        addTone(this.mix, pan, lane, this.fields[lane].sample(.52 / Math.sqrt(count) * levels[lane] * stems[0], alpha));
        addTone(this.mix, pan, lane, this.spreads[lane].sample(.3 / Math.sqrt(count) * spreads[lane] * stems[2], alpha));
      }
      for (let i = 0; i < this.highlights.length; i++) {
        const tone = this.highlights[i];
        const event = this.events.highlights[i];
        const sample = tone.sample(event ? .24 * Math.sqrt(event.excess) * envelope * Math.exp(-age / .65) * stems[1] : 0, quick);
        if (event) addTone(this.mix, pan, event.lane, sample);
      }
      for (let i = 0; i < this.edges.length; i++) {
        const tone = this.edges[i];
        const event = this.events.edges[i];
        const sample = tone.sample(event ? .1 * Math.sqrt(event.edge) * envelope * Math.exp(-age / .3) * stems[3] : 0, quick);
        if (event) addTone(this.mix, pan, event.lane, sample);
      }
      const elapsed = (this.cursor % this.stepSamples) / sr;
      const cue = elapsed < .04 ? Math.sin(2 * Math.PI * 165 * this.cursor / sr) * Math.sin(Math.PI * elapsed / .04) * .035 * missing : 0;
      this.masterGain += (master - this.masterGain) * quick;
      let refL = 0, refR = 0;
      for (let lane = 0; lane < f.lanes; lane++) {
        const index = step * f.lanes + lane, x = score(f.mean[index], f.audioMax);
        const gain = .35 / Math.sqrt(count) * Math.log1p(99 * x) / Math.log(100) * (lane >= c.from && lane <= c.to ? c.referenceSolo ? 1 : clip(c.referenceGain) : 0);
        const sample = this.reference[lane].sample(gain, quick);
        refL += sample * pan[lane][0]; refR += sample * pan[lane][1];
      }
      for (let channel = 0; channel < 2; channel++) {
        this.low[channel] += filter * (this.mix[channel] - this.low[channel]);
        const delay = this.delay[channel], index = this.delayIndex[channel], echo = delay[index];
        delay[index] = this.low[channel] + echo * .22; this.delayIndex[channel] = (index + 1) % delay.length;
        const dry = this.low[channel], wet = clip(c.space ?? .12);
        const fade = Math.min(1, this.cursor / (sr * .02), (this.end - this.cursor) / (sr * .03));
        const raw = ((dry * (1 - wet) + echo * wet) + (channel ? refR : refL) + cue) * this.masterGain * fade;
        const abs = Math.abs(raw); if (abs > .88) this.limited++;
        const sample = abs > .88 ? Math.sign(raw) * (.88 + .02 * Math.tanh((abs - .88) / .02)) : raw;
        (channel ? right : left)[n] = Number.isFinite(sample) ? sample : 0;
        this.peak = Math.max(this.peak, Math.abs(sample));
      }
    }
  }
}
