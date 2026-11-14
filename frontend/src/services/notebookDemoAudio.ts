import type { AudioMode, DemoAudioConfig, DemoState, FrozenEvent } from "@/types/notebookDemo";

export interface StereoPCM { left: Float32Array; right: Float32Array }
export interface RenderedPlan { carrier: StereoPCM; music: StereoPCM; peak: number }

// NumPy/Python round uses ties-to-even; pulse onset must agree at half samples.
function roundEven(x: number): number {
  const floor = Math.floor(x);
  return x - floor === 0.5 ? floor + (floor % 2) : Math.round(x);
}
const midiHz = (note: number) => 440 * 2 ** ((note - 69) / 12);
const stereo = (n: number) => ({ left: new Float64Array(n), right: new Float64Array(n) });

/** Same scientific buffer in either audio mode. Music never normalizes the carrier. */
export function renderDemoPlan(plan: readonly FrozenEvent[], cfg: DemoAudioConfig): RenderedPlan {
  if (!plan.length || cfg.seconds_per_bar < 0.85) throw new Error("Invalid event sequence or bar duration");
  const sr = cfg.sample_rate;
  const n = plan.length * roundEven(sr * cfg.seconds_per_bar);
  const carrier = stereo(n), music = stereo(n);
  const addPulse = (time: number, hz: number, amplitude: number, seconds: number) => {
    const start = roundEven(time * sr), length = roundEven(seconds * sr);
    if (start < 0 || start + length > n) throw new Error("Scientific pulse outside bar");
    const attack = Math.max(1, Math.min(Math.floor(length / 3), Math.floor(cfg.attack_seconds * sr)));
    const release = Math.max(1, Math.min(Math.floor(length / 3), Math.floor(cfg.release_seconds * sr)));
    for (let i = 0; i < length; i++) {
      let envelope = 1;
      if (i < attack) envelope = i / attack;
      if (i >= length - release) envelope = (length - 1 - i) / Math.max(1, release - 1);
      const sample = amplitude * Math.sin(2 * Math.PI * hz * i / sr) * envelope;
      carrier.left[start + i] += sample;
      carrier.right[start + i] += sample;
    }
  };
  const addNote = (time: number, seconds: number, note: number, amplitude: number,
    timbre: "pad" | "bass" | "lead", pollutant: string, pan = 0, tail = 0) => {
    const start = Math.max(0, roundEven(time * sr));
    const length = Math.min(n - start, roundEven((seconds + tail) * sr));
    if (length < 8) return;
    const attack = Math.min(Math.max(1, Math.floor((timbre === "pad" ? 0.10 : 0.015) * sr)), Math.floor(length / 3));
    const release = Math.min(Math.max(1, Math.floor((timbre === "pad" ? 0.15 : 0.06) * sr)), Math.floor(length / 3));
    const leftGain = Math.cos((pan + 1) * Math.PI / 4), rightGain = Math.sin((pan + 1) * Math.PI / 4);
    const hz = midiHz(note);
    for (let i = 0; i < length; i++) {
      const t = i / sr, phase = 2 * Math.PI * hz * t, osc = Math.sin(phase);
      let sample: number;
      if (timbre === "bass") sample = osc + 0.12 * Math.sin(2 * phase);
      else if (timbre === "pad") sample = 0.75 * osc + 0.17 * Math.sin(2.005 * phase);
      else switch (pollutant) {
        case "pm25_rh35": sample = 0.85 * osc + 0.10 * Math.sin(2 * phase); break;
        case "pm10_rh35": sample = 0.65 * osc + 0.23 * Math.sin(3 * phase); break;
        case "co": sample = 0.92 * osc + 0.06 * Math.sin(2 * phase); break;
        case "no2": sample = 0.62 * osc + 0.19 * Math.sin(4 * phase); break;
        case "o3": sample = 0.78 * Math.sin(phase + 0.12 * Math.sin(2 * Math.PI * 5 * t)) + 0.12 * Math.sin(2 * phase); break;
        case "so2": sample = 0.60 * osc + 0.14 * Math.sin(5 * phase); break;
        default: throw new Error("Unknown pollutant timbre");
      }
      let envelope = 1;
      if (i < attack) envelope = i / attack;
      if (i >= length - release) envelope = (length - 1 - i) / Math.max(1, release - 1);
      sample *= amplitude * envelope;
      music.left[start + i] += leftGain * sample;
      music.right[start + i] += rightGain * sample;
    }
  };
  plan.forEach((event, j) => {
    const base = j * cfg.seconds_per_bar, bar = cfg.seconds_per_bar;
    const pulses = event.scientific.pulses;
    if (pulses === null) {
      cfg.missing_offsets.forEach(offset => addPulse(base + offset, cfg.missing_hz, cfg.data_gain * 0.7, cfg.missing_seconds));
    } else if (pulses > 0) {
      if (!Number.isInteger(pulses) || pulses > 5) throw new Error("Invalid pulse count");
      for (let i = 0; i < pulses; i++) {
        const offset = pulses === 1 ? cfg.pulse_single_offset
          : cfg.pulse_first_offset + i * (cfg.pulse_last_offset - cfg.pulse_first_offset) / (pulses - 1);
        addPulse(base + offset, cfg.pulse_hz, cfg.data_gain, cfg.pulse_seconds);
      }
    }
    if (!event.artistic_mood) return;
    event.chord_midi?.forEach(note => addNote(base, bar - 0.07, note, 0.018, "pad", event.scientific.pollutant, 0, 0.08));
    if (event.bass_midi !== null) addNote(base + 0.03, bar - 0.16, event.bass_midi, 0.038, "bass", event.scientific.pollutant);
    const count = event.melody_note_count;
    if (event.melody_midi !== null) for (let i = 0; i < count; i++) {
      const start = base + 0.13 + i * ((bar - 0.30) / Math.max(1, count));
      const duration = Math.min(0.25, (bar - 0.30) / Math.max(1, count) * 0.86);
      addNote(start, duration, event.melody_midi, 0.045, "lead", event.scientific.pollutant, j % 2 ? 0.12 : -0.12);
    }
    event.texture_pcm.forEach((texture, hit) => {
      const start = Math.floor((base + 0.18 + hit * 0.15) * sr);
      texture.forEach((sample, i) => {
        if (start + i < n) { music.left[start + i] += sample; music.right[start + i] += sample; }
      });
    });
  });
  let peak = 0;
  for (let i = 0; i < n; i++) {
    music.left[i] *= cfg.music_gain; music.right[i] *= cfg.music_gain;
    peak = Math.max(peak, Math.abs(carrier.left[i] + music.left[i]), Math.abs(carrier.right[i] + music.right[i]));
  }
  if (!Number.isFinite(peak) || peak >= 0.93) throw new Error("Audio exceeds notebook headroom");
  return {
    carrier: { left: Float32Array.from(carrier.left), right: Float32Array.from(carrier.right) },
    music: { left: Float32Array.from(music.left), right: Float32Array.from(music.right) }, peak,
  };
}

/** Audio-clock transport: React is a display subscriber, never the note clock. */
export class NotebookDemoAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sources: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private buffers: AudioBuffer[] = [];
  private timer = 0;
  private generation = 0;
  private started = 0;
  private offset = 0;
  private config: DemoAudioConfig | null = null;
  private plan: readonly FrozenEvent[] = [];
  private volume = 0.55;
  private blend = 1;
  private mode: AudioMode = "scientific";
  private disposed = false;
  state: DemoState = "ready";

  constructor(private onTick: (event: FrozenEvent, fraction: number) => void,
    private onState: (state: DemoState) => void) {}

  private report(state: DemoState) { this.state = state; this.onState(state); }
  private ensureContext() {
    if (this.disposed) throw new Error("Audio controller disposed");
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.mode === "harmonic" ? this.blend : 0;
      this.musicGain.connect(this.master);
    }
    return this.ctx;
  }
  private clearVoices() {
    cancelAnimationFrame(this.timer);
    this.sources.forEach(({ source, gain }) => {
      const now = this.ctx?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.012);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      try { source.stop(now + 0.015); } catch { source.disconnect(); gain.disconnect(); }
    });
    this.sources = [];
  }
  setMode(mode: AudioMode) {
    this.mode = mode;
    if (this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(mode === "harmonic" ? this.blend : 0, this.ctx.currentTime, 0.025);
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.025);
  }
  setBlend(value: number) { this.blend = Math.max(0, Math.min(1, value)); this.setMode(this.mode); }

  async play(plan: readonly FrozenEvent[], config: DemoAudioConfig) {
    const ctx = this.ensureContext();
    // Resume inside the user's click before expensive PCM preparation.
    const resume = ctx.resume();
    this.stop();
    const generation = this.generation;
    this.plan = plan; this.config = config;
    const rendered = renderDemoPlan(plan, config);
    this.buffers = [rendered.carrier, rendered.music].map(pcm => {
      const buffer = ctx.createBuffer(2, pcm.left.length, config.sample_rate);
      buffer.getChannelData(0).set(pcm.left); buffer.getChannelData(1).set(pcm.right);
      return buffer;
    });
    await resume;
    if (this.disposed || generation !== this.generation) return;
    this.startSources();
  }
  private startSources() {
    if (!this.ctx || !this.config || !this.buffers.length) return;
    const ctx = this.ctx, duration = this.buffers[0].duration;
    this.started = ctx.currentTime + 0.07;
    const generation = this.generation;
    this.sources = this.buffers.map((buffer, index) => {
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, this.started);
      gain.gain.linearRampToValueAtTime(1, this.started + 0.012);
      source.connect(gain); gain.connect(index ? this.musicGain! : this.master!);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(this.started, this.offset);
      return { source, gain };
    });
    this.report("playing");
    const tick = () => {
      if (generation !== this.generation || !this.config) return;
      const elapsed = Math.min(duration, Math.max(0, ctx.currentTime - this.started) + this.offset);
      const index = Math.min(this.plan.length - 1, Math.floor(elapsed / this.config.seconds_per_bar));
      this.onTick(this.plan[index], elapsed / duration);
      if (elapsed >= duration) { this.stop(); return; }
      this.timer = requestAnimationFrame(tick);
    };
    tick();
  }
  pause() {
    if (this.state !== "playing" || !this.ctx) return;
    this.offset += Math.max(0, this.ctx.currentTime - this.started);
    this.generation++; this.clearVoices(); this.report("paused");
  }
  async resume() {
    if (this.state !== "paused" || !this.ctx) return;
    const generation = this.generation;
    await this.ctx.resume();
    if (!this.disposed && generation === this.generation) this.startSources();
  }
  stop() { this.generation++; this.clearVoices(); this.offset = 0; this.report("ready"); }
  dispose() {
    this.stop(); this.disposed = true;
    this.master?.disconnect(); this.musicGain?.disconnect();
    if (this.ctx) void this.ctx.close();
    this.ctx = null; this.buffers = [];
  }
}
