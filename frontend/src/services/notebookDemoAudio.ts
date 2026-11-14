import type { AudioMode, DemoAudioConfig, DemoState, FocusStem, FrozenEvent, MusicProfile, StemControl } from "@/types/notebookDemo";

export interface StereoPCM { left: Float32Array; right: Float32Array }
export interface RenderedPlan { carrier: StereoPCM; music: StereoPCM; peak: number }
export interface AudioTrack { name: string; pcm: StereoPCM; lane?: string }

// NumPy/Python round uses ties-to-even; pulse onset must agree at half samples.
export function roundEven(x: number): number {
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

export const FOCUS_MAPPING_VERSION = "focus-artistic-log99-v1";
export const FOCUS_STEMS: FocusStem[] = ["lead", "pad", "bass", "texture"];
/** Fixed artistic transfer on the unchanged A score; never per-frame recalibration. */
export const focusLens = (score: number) => Math.log1p(99 * Math.max(0, Math.min(1, score))) / Math.log(100);

export function focusParameters(event: FrozenEvent) {
  const feature = event.focus_feature;
  const level = focusLens(event.scientific.score ?? 0);
  const spread = focusLens(feature?.spread_score ?? 0);
  const contrast = focusLens(event.variation_kind === "temporal_change" ? feature?.chronological_contrast ?? 0 : feature?.neighbor_contrast ?? 0);
  const registers = { pm25_rh35: 57, pm10_rh35: 52, co: 45, no2: 64, o3: 69, so2: 60 };
  const lon = (event.scientific.bounds.lon[0] + event.scientific.bounds.lon[1]) / 2;
  return { level, spread, contrast, midi: registers[event.scientific.pollutant] + 24 * level,
    bassMidi: registers[event.scientific.pollutant] - 12,
    pan: Math.max(-0.7, Math.min(0.7, lon / 180 * 0.7)), hits: 1 + Math.floor(3 * contrast) };
}

export function renderFocusPlan(plan: readonly FrozenEvent[], cfg: DemoAudioConfig, spatial?: { midi: number; pan: number }) {
  const baseline = renderDemoPlan(plan, cfg);
  const n = baseline.carrier.left.length, sr = cfg.sample_rate;
  const buffers = { lead: stereo(n), pad: stereo(n), bass: stereo(n), texture: stereo(n) };
  const add = (stem: FocusStem, startSeconds: number, duration: number, midi: number, gain: number,
    brightness: number, pan: number, seed = 1) => {
    const start = roundEven(startSeconds * sr), length = Math.min(n - start, roundEven(duration * sr));
    const attack = Math.min(Math.floor(length / 3), Math.floor(sr * (stem === "pad" ? 0.10 : 0.012)));
    const release = Math.min(Math.floor(length / 3), Math.floor(sr * (stem === "pad" ? 0.12 : 0.045)));
    const left = Math.cos((pan + 1) * Math.PI / 4), right = Math.sin((pan + 1) * Math.PI / 4);
    let random = seed | 1;
    for (let i = 0; i < length; i++) {
      const phase = 2 * Math.PI * midiHz(midi) * i / sr;
      let envelope = 1;
      if (i < attack) envelope = i / Math.max(1, attack);
      if (i >= length - release) envelope = (length - 1 - i) / Math.max(1, release - 1);
      let sample = Math.sin(phase) + brightness * 0.22 * Math.sin(3 * phase);
      if (stem === "texture") {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        sample = ((random >>> 0) / 2147483648 - 1) * Math.exp(-i / (sr * 0.025));
      }
      sample *= gain * envelope * cfg.music_gain;
      buffers[stem].left[start + i] += sample * left;
      buffers[stem].right[start + i] += sample * right;
    }
  };
  plan.forEach((event, index) => {
    if (event.scientific.missing) return;
    const p = focusParameters(event), base = index * cfg.seconds_per_bar;
    if (spatial) { p.midi = spatial.midi + 2 * p.level; p.bassMidi = spatial.midi - 24; p.pan = spatial.pan; }
    const cell = event.focus_feature?.cell_id ?? event.scientific.scan_id;
    let seed = 2166136261;
    for (const char of event.scientific.pollutant + cell) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    // Lead = absolute concentration (continuous pitch), pad brightness = within-cell IQR.
    add("lead", base + 0.10, 0.30, p.midi, 0.055, 0.1 + p.level * 0.4, p.pan);
    const root = spatial ? spatial.midi - 12 : (event.scientific.score ?? 0) >= 0.25 ? 45 : 48;
    for (const interval of spatial ? [0] : [0, 7, 12]) add("pad", base, 0.78, root + interval, 0.012, p.spread, p.pan * 0.3);
    // Bass register identifies the pollutant family; its articulation follows contrast.
    add("bass", base + 0.03, 0.50 - 0.25 * p.contrast, p.bassMidi, 0.03, 0.1, 0);
    for (let hit = 0; hit < p.hits; hit++) add("texture", base + 0.18 + hit * 0.16, 0.07,
      48, 0.006 + p.contrast * 0.008, p.spread, p.pan, seed + hit);
  });
  const stems = {} as Record<FocusStem, StereoPCM>;
  for (const name of FOCUS_STEMS) stems[name] = { left: Float32Array.from(buffers[name].left), right: Float32Array.from(buffers[name].right) };
  let peak = 0;
  for (let i = 0; i < n; i++) for (const side of ["left", "right"] as const) {
    // Bound every possible mute/solo/gain combination by sum of absolute amplitudes.
    const bound = Math.abs(baseline.carrier[side][i]) + FOCUS_STEMS.reduce((sum, stem) => sum + Math.abs(stems[stem][side][i]), 0);
    peak = Math.max(peak, bound);
  }
  if (!Number.isFinite(peak) || peak >= 0.93) throw new Error("Focus stems exceed headroom");
  return { carrier: baseline.carrier, stems, peak };
}

/** Audio-clock transport: React is a display subscriber, never the note clock. */
export class NotebookDemoAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private stemNodes = new Map<FocusStem, GainNode>();
  private stemControls = Object.fromEntries(FOCUS_STEMS.map(name => [name, { gain: 1, muted: false, solo: false }])) as Record<FocusStem, StemControl>;
  private bufferNames: string[] = [];
  private bufferLanes: (string | undefined)[] = [];
  private laneControls = new Map<string, StemControl>();
  private laneNodes = new Map<string, GainNode[]>();
  private sources: { source: AudioBufferSourceNode; gain: GainNode; route?: GainNode }[] = [];
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
    private onState: (state: DemoState) => void, private onComplete?: () => void) {}

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
      for (const name of FOCUS_STEMS) {
        const gain = this.ctx.createGain(); gain.connect(this.musicGain); this.stemNodes.set(name, gain);
      }
      this.applyStems();
    }
    return this.ctx;
  }
  private clearVoices() {
    cancelAnimationFrame(this.timer);
    this.sources.forEach(({ source, gain, route }) => {
      const now = this.ctx?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.012);
      source.onended = () => { source.disconnect(); gain.disconnect(); route?.disconnect(); };
      try { source.stop(now + 0.015); } catch { source.disconnect(); gain.disconnect(); route?.disconnect(); }
    });
    this.sources = [];
    this.laneNodes.clear();
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
  setStem(name: FocusStem, update: Partial<StemControl>) {
    this.stemControls[name] = { ...this.stemControls[name], ...update };
    this.stemControls[name].gain = Math.max(0, Math.min(1, this.stemControls[name].gain));
    this.applyStems();
  }
  setLane(name: string, update: Partial<StemControl>) {
    const control = { gain: 1, muted: false, solo: false, ...this.laneControls.get(name), ...update };
    control.gain = Math.max(0, Math.min(1, control.gain));
    this.laneControls.set(name, control); this.applyLanes();
  }
  private applyLanes() {
    const solo = [...this.laneNodes.keys()].some(name => this.laneControls.get(name)?.solo);
    for (const [name, nodes] of this.laneNodes) {
      const control = this.laneControls.get(name);
      const gain = control?.muted || (solo && !control?.solo) ? 0 : control?.gain ?? 1;
      nodes.forEach(node => node.gain.setTargetAtTime(gain, this.ctx!.currentTime, 0.025));
    }
  }
  private applyStems() {
    const solo = FOCUS_STEMS.some(name => this.stemControls[name].solo);
    for (const name of FOCUS_STEMS) {
      const control = this.stemControls[name];
      const gain = control.muted || (solo && !control.solo) ? 0 : control.gain;
      const node = this.stemNodes.get(name);
      if (node && this.ctx) node.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.025);
    }
  }

  async play(plan: readonly FrozenEvent[], config: DemoAudioConfig, profile: MusicProfile = "baseline") {
    return this.playPrepared(plan, config, () => {
      if (profile === "focus") {
        const rendered = renderFocusPlan(plan, config);
        return [{ name: "carrier", pcm: rendered.carrier }, ...FOCUS_STEMS.map(name => ({ name, pcm: rendered.stems[name] }))];
      }
      const rendered = renderDemoPlan(plan, config);
      return [{ name: "carrier", pcm: rendered.carrier }, { name: "music", pcm: rendered.music }];
    });
  }
  /** Lazily render after unlocking audio. A transport step may represent several simultaneous cells. */
  async playPrepared(plan: readonly FrozenEvent[], config: DemoAudioConfig, render: () => AudioTrack[]) {
    const ctx = this.ensureContext();
    // Resume inside the user's click before expensive PCM preparation.
    const resume = ctx.resume();
    this.stop();
    const generation = this.generation;
    this.plan = plan; this.config = config;
    const tracks = render();
    const frames = plan.length * roundEven(config.seconds_per_bar * config.sample_rate);
    if (!plan.length || !tracks.length || tracks.some(track => track.pcm.left.length !== frames || track.pcm.right.length !== frames)) throw new Error("Audio tracks and transport steps disagree");
    this.bufferNames = tracks.map(track => track.name); this.bufferLanes = tracks.map(track => track.lane);
    this.buffers = tracks.map(({ pcm }) => {
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
      const stem = this.stemNodes.get(this.bufferNames[index] as FocusStem);
      const destination = this.bufferNames[index] === "carrier" ? this.master! : stem ?? this.musicGain!;
      const lane = this.bufferLanes[index];
      let route: GainNode | undefined;
      source.connect(gain);
      if (lane) {
        route = ctx.createGain(); gain.connect(route); route.connect(destination);
        this.laneNodes.set(lane, [...this.laneNodes.get(lane) ?? [], route]);
      } else gain.connect(destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); route?.disconnect(); };
      source.start(this.started, this.offset);
      return { source, gain, route };
    });
    this.applyLanes(); this.report("playing");
    const tick = () => {
      if (generation !== this.generation || !this.config) return;
      const elapsed = Math.min(duration, Math.max(0, ctx.currentTime - this.started) + this.offset);
      const index = Math.min(this.plan.length - 1, Math.floor(elapsed / this.config.seconds_per_bar));
      this.onTick(this.plan[index], elapsed / duration);
      if (elapsed >= duration) { this.stop(); this.onComplete?.(); return; }
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
    this.stemNodes.forEach(node => node.disconnect()); this.stemNodes.clear();
    if (this.ctx) void this.ctx.close();
    this.ctx = null; this.buffers = [];
  }
}
