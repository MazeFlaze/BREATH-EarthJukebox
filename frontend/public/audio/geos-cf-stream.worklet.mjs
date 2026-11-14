import { DetailSynth } from './geos-cf-dsp.mjs';
class GeosCfStream extends AudioWorkletProcessor {
  constructor() {
    super(); this.synth = null; this.blocks = 0; this.disposed = false;
    this.port.onmessage = ({ data }) => {
      try {
        if (data.type === 'dispose') { this.disposed = true; this.synth = null; return; }
        if (data.type === 'load') { this.synth = new DetailSynth(data.frames, sampleRate, data.duration, data.controls); this.port.postMessage({ type: 'ready' }); }
        else if (this.synth) {
          if (data.type === 'seek') {
            this.synth.seek(data.step);
            if (this.previewSeconds) this.synth.end = Math.min(this.synth.total, this.synth.cursor + Math.round(this.previewSeconds * sampleRate));
          }
          if (data.type === 'limit') { this.previewSeconds = data.seconds; this.synth.end = Math.min(this.synth.total, this.synth.cursor + Math.round(data.seconds * sampleRate)); }
          if (data.type === 'controls') this.synth.setControls(data.controls);
          if (data.type === 'playing') this.synth.paused = !data.value;
        }
      } catch (cause) { this.port.postMessage({ type: 'error', error: String(cause) }); }
    };
  }
  process(inputs, outputs) {
    if (this.disposed) return false;
    const output = outputs[0];
    if (this.synth && output?.length >= 2) {
      this.synth.process(output[0], output[1]);
      if (++this.blocks % 32 === 0) this.port.postMessage({ type: 'tick', cursor: this.synth.cursor / sampleRate,
        step: this.synth.sourceStep(), done: this.synth.cursor >= this.synth.end, peak: this.synth.peak, limited: this.synth.limited });
    }
    return true;
  }
}
registerProcessor('geos-cf-detail-stream', GeosCfStream);
