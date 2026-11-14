// Bounded-memory continuous synthesis shared by AudioWorklet and offline verification.
import { lens } from './geos-cf-data.mjs';
import { ContextSynth } from './geos-cf-orchestration.mjs';
export class DetailSynth {
  constructor(frames, sampleRate, duration, controls = {}) {
    if (![180, 300, 420].includes(duration) || !frames.steps || !frames.lanes || frames.mean.length !== frames.steps * frames.lanes) throw Error('Invalid streaming plan');
    this.frames = frames; this.sr = sampleRate; this.duration = duration;
    this.total = Math.round(duration * sampleRate); this.end = this.total; this.stepSamples = this.total / frames.steps;
    this.cursor = 0; this.paused = true; this.lastStep = -1; this.peak = 0; this.limited = 0;
    this.controls = { volume: .55, monitor: 1, music: false, from: 0, to: frames.lanes - 1, stems: [1, 1, 1, 1], ...controls };
    this.amplitudes = new Float64Array(frames.lanes * 4); this.targets = new Float64Array(this.amplitudes.length);
    this.osc = new Float64Array(frames.lanes * 12);
    this.noise = new Int32Array(frames.lanes);
    this.smooth = 1 - Math.exp(-1 / (sampleRate * .008));
    this.contextSynth = null;
    this.resetOscillators();
  }
  resetOscillators() {
    const { lanes, profile, axis } = this.frames;
    for (let lane = 0; lane < lanes; lane++) {
      const position = this.frames.positions?.[lane] ?? (axis === 'horizontal' ? lanes - 1 - lane : lane) / Math.max(1, lanes - 1);
      const frequency = profile === 'spectral' ? 120 * (Math.min(6000, this.sr * .4) / 120) ** position : 180 * 2 ** (position * 45 / 12);
      this.noise[lane] = Math.imul(lane + 1, 2654435761) | 1;
      for (let partial = 0; partial < 4; partial++) {
        const hz = frequency * [1, 1.5, .5, .25][partial];
        const phase = 2 * Math.PI * hz * this.cursor / this.sr + (lane * 2.3999632297 + partial);
        const omega = 2 * Math.PI * hz / this.sr, i = lane * 12 + partial * 3;
        this.osc[i] = Math.sin(phase); this.osc[i + 1] = Math.sin(phase - omega); this.osc[i + 2] = 2 * Math.cos(omega);
      }
    }
  }
  seek(step) {
    this.cursor = Math.min(this.total - 1, Math.max(0, Math.round(step * this.stepSamples)));
    this.end = this.total;
    this.lastStep = -1; this.amplitudes.fill(0); this.resetOscillators();
    this.contextSynth?.reset(this.cursor);
  }
  setControls(update) {
    this.controls = { ...this.controls, ...update }; this.lastStep = -1;
    if (this.contextSynth) this.contextSynth.currentWindow = -1;
  }
  sourceStep() {
    const step = Math.min(this.frames.steps - 1, Math.floor(this.cursor / this.stepSamples));
    return this.controls.reverse ? this.frames.steps - 1 - step : step;
  }
  updateTargets() {
    const f = this.frames, step = this.sourceStep(), c = this.controls;
    let missing = 0;
    const count = Math.max(1, Math.min(f.lanes - 1, c.to) - Math.max(0, c.from) + 1);
    // Fixed for the selected voice range; never normalize against a frame's data values.
    const scale = .35 / Math.sqrt(count) * Math.max(0, Math.min(4, c.monitor)) * Math.max(0, Math.min(1, c.volume));
    for (let lane = 0; lane < f.lanes; lane++) {
      const index = step * f.lanes + lane, selected = lane >= c.from && lane <= c.to;
      const valid = Number.isFinite(f.mean[index]);
      const level = valid ? lens(f.mean[index] / f.audioMax) : 0;
      const active = selected && valid ? scale : 0;
      const i = lane * 4;
      this.targets[i] = active * level;
      this.targets[i + 1] = f.profile === 'focus' && c.music ? active * lens((f.p90[index] || 0) / f.audioMax) * .13 * c.stems[0] : 0;
      this.targets[i + 2] = f.profile === 'focus' && c.music ? active * lens(f.spread[index]) * .18 * c.stems[1] : 0;
      this.targets[i + 3] = f.profile === 'focus' && c.music ? active * lens(f.contrast[index]) * .18 * c.stems[2] : 0;
      if (selected) missing += 1 - f.coverage[index];
    }
    this.missingFraction = missing / count;
  }
  process(left, right) {
    left.fill(0); right.fill(0);
    if (this.paused || this.cursor >= this.end) return;
    if (this.frames.profile === 'focus' && this.controls.music && this.controls.arrangement === 'context') {
      this.contextSynth ??= new ContextSynth(this.frames, this.sr, this.duration);
      if (this.contextSynth.cursor !== this.cursor) this.contextSynth.reset(this.cursor);
      this.contextSynth.end = this.end;
      const previousLimited = this.contextSynth.limited;
      this.contextSynth.process(left, right, this.controls);
      this.cursor = this.contextSynth.cursor;
      this.peak = Math.max(this.peak, this.contextSynth.peak); this.limited += this.contextSynth.limited - previousLimited;
      return;
    }
    const f = this.frames, spectral = f.profile === 'spectral', alpha = this.smooth;
    let offset = 0;
    while (offset < left.length && this.cursor < this.end) {
      const timelineStep = Math.min(f.steps - 1, Math.floor(this.cursor / this.stepSamples));
      if (this.lastStep !== timelineStep) { this.lastStep = timelineStep; this.updateTargets(); }
      const length = Math.min(left.length - offset, Math.ceil((timelineStep + 1) * this.stepSamples) - this.cursor, this.end - this.cursor);
      for (let lane = 0; lane < f.lanes; lane++) {
        // Horizontal location follows the current longitude; vertical location follows voice column.
        const panPosition = f.axis === 'horizontal' ? f.stepPositions?.[this.sourceStep()] ?? this.sourceStep() / Math.max(1, f.steps - 1) : f.positions?.[lane] ?? lane / Math.max(1, f.lanes - 1);
        const angle = (.2 + .6 * panPosition) * Math.PI / 2, lg = Math.cos(angle), rg = Math.sin(angle);
        const ai = lane * 4;
        for (let partial = 0; partial < (spectral ? 1 : 4); partial++) {
          const oi = lane * 12 + partial * 3;
          let y = this.osc[oi], previous = this.osc[oi + 1], gain = this.amplitudes[ai + partial];
          const coefficient = this.osc[oi + 2], target = this.targets[ai + partial];
          for (let n = 0; n < length; n++) {
            gain += (target - gain) * alpha;
            const sample = y * gain;
            left[offset + n] += sample * lg; right[offset + n] += sample * rg;
            const next = coefficient * y - previous; previous = y; y = next;
          }
          this.osc[oi] = y; this.osc[oi + 1] = previous; this.amplitudes[ai + partial] = gain;
        }
        if (!spectral && this.controls.music && this.controls.stems[3] > 0) {
          let random = this.noise[lane];
          const contrast = lens(f.contrast[this.sourceStep() * f.lanes + lane]);
          const gain = this.targets[ai] * contrast * .06 * this.controls.stems[3];
          for (let n = 0; n < length; n++) {
            random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
            const sample = ((random >>> 0) / 2147483648 - 1) * gain;
            left[offset + n] += sample * lg; right[offset + n] += sample * rg;
          }
          this.noise[lane] = random;
        }
      }
      for (let n = 0; n < length; n++) {
        const elapsed = (this.cursor + n) % this.stepSamples / this.sr;
        const cue = elapsed < .04 ? Math.sin(2 * Math.PI * 165 * (this.cursor + n) / this.sr) * Math.sin(Math.PI * elapsed / .04) * .035 * this.missingFraction * this.controls.volume : 0;
        const fade = Math.min(1, (this.end - this.cursor - n) / (this.sr * .015));
        for (let channel = 0; channel < 2; channel++) {
          const output = channel === 0 ? left : right;
          const raw = (output[offset + n] + cue) * fade, abs = Math.abs(raw);
          if (abs > .88) this.limited++;
          const sample = abs > .88 ? Math.sign(raw) * (.88 + .02 * Math.tanh((abs - .88) / .02)) : raw;
          output[offset + n] = Number.isFinite(sample) ? sample : 0;
          this.peak = Math.max(this.peak, Math.abs(output[offset + n]));
        }
      }
      this.cursor += length; offset += length;
    }
  }
}
