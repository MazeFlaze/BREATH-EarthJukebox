import type {
  AudioClockState,
  AudioTelemetry,
  OscillatorWaveform,
  PlaybackState,
  SonificationConfig,
  SonificationInput,
} from "@/types/audio";
import type { AudioCompositionSpec, SonificationMapping } from "@/types/breathe";

export interface ScanVoiceInput {
  row: number;
  norm: number;
  isAccent: boolean;
}

export interface AudioVisualFrame {
  playbackState: PlaybackState;
  activeCompositionId: string | null;
  progress: number;
  rms: number;
  spectralCentroid: number;
  waveformSamples: readonly number[];
  spectrumBins: readonly number[];
}

const STEPS = 16;

const KEY_SCALES: Record<string, number[]> = {
  "A minor": [220.0, 246.94, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25],
  "C major": [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 880.0],
  "D minor": [293.66, 329.63, 349.23, 392.0, 440.0, 466.16, 523.25, 587.33, 659.25, 698.46, 783.99, 880.0],
  "G major": [196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 369.99, 392.0, 440.0, 493.88, 587.33, 659.25],
  "E minor": [164.81, 185.0, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 369.99, 392.0, 440.0, 493.88],
};

/**
 * Returns 16 monotonically ascending scale frequencies spanning sub-bass roots through upper bells
 * so bottom-to-top latitude rows on the 2D scan bar always map harmoniously.
 */
export function getExtendedScaleFrequencies(musicalKey: string): number[] {
  const base = KEY_SCALES[musicalKey] ?? KEY_SCALES["A minor"];
  const subNotes = [base[0] * 0.5, base[2] * 0.5, base[4] * 0.5, (base[6] ?? base[0] * 1.5) * 0.5];
  const combined = [...subNotes, ...base];
  const deduped = Array.from(new Set(combined.map((f) => Number(f.toFixed(2))))).sort((a, b) => a - b);
  let octIdx = 0;
  while (deduped.length < 16) {
    const candidate = Number((base[octIdx % base.length] * (2 + Math.floor(octIdx / base.length))).toFixed(2));
    if (candidate > deduped[deduped.length - 1]) deduped.push(candidate);
    octIdx += 1;
  }
  return deduped.slice(0, 16);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function interpolateSeries(series: number[], count: number): number[] {
  if (!series.length) return new Array(count).fill(0.35);
  if (series.length === 1) return new Array(count).fill(series[0]);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const pos = (i / (count - 1)) * (series.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(series.length - 1, lo + 1);
    const f = pos - lo;
    out.push(series[lo] * (1 - f) + series[hi] * f);
  }
  return out;
}

/**
 * Deterministic 3 x 16 acoustic score matrix computed directly from real atmospheric series
 * and user mapping controls, ensuring previews and Web Audio scheduling stay locked in sync.
 */
export function computeScheduleMatrix(spec: AudioCompositionSpec): number[][] {
  const interp = interpolateSeries(spec.series, STEPS);
  const span = Math.max(1e-4, spec.max - spec.min);
  const norms = interp.map((v) => clamp01((v - spec.min) / span));
  const { density, brightness, pitchSensitivity } = spec.mapping;

  const rowPrimary: number[] = [];
  const rowTimbre: number[] = [];
  const rowDelta: number[] = [];

  for (let i = 0; i < STEPS; i += 1) {
    const n = norms[i];
    const prev = norms[(i - 1 + STEPS) % STEPS];
    const delta = Math.abs(n - prev);

    // Subdivisions tighten as concentration and density increase
    const gateThreshold = 0.72 - density * 0.64;
    const accent = i % 4 === 0 ? 0.16 : i % 2 === 0 ? 0.08 : 0;
    const rawPrimary = n * (0.45 + density * 0.55) + accent;
    rowPrimary.push(rawPrimary >= gateThreshold ? clamp01(rawPrimary) : clamp01(rawPrimary * 0.32));

    // Spectral brightness / harmonic presence envelope
    const wave = 0.5 + 0.5 * Math.sin((i / STEPS) * Math.PI * 2 + brightness * 1.8);
    rowTimbre.push(clamp01(0.18 + brightness * 0.65 * (0.45 + 0.55 * wave)));

    // Temporal rate-of-change triggers upper harmonic shimmer notes
    const rawDelta = Math.min(1, delta * 3.8) * (0.3 + pitchSensitivity * 0.7) + (i % 8 === 4 ? 0.25 : 0);
    rowDelta.push(rawDelta >= 0.36 - pitchSensitivity * 0.2 ? clamp01(rawDelta) : clamp01(rawDelta * 0.25));
  }

  return [rowPrimary, rowTimbre, rowDelta];
}

export function buildStaticWaveform(spec: AudioCompositionSpec, count = 64): number[] {
  const interp = interpolateSeries(spec.series, count);
  const span = Math.max(1e-4, spec.max - spec.min);
  const { density, brightness, pitchSensitivity } = spec.mapping;
  return interp.map((v, i) => {
    const norm = clamp01((v - spec.min) / span);
    const carrier = Math.sin(i * (0.35 + density * 0.55));
    const overtone = Math.sin(i * (0.9 + brightness * 1.4)) * (0.2 + brightness * 0.35);
    const env = 0.28 + 0.72 * Math.pow(norm, 0.75 + pitchSensitivity * 0.4);
    return clamp01(Math.abs((carrier + overtone) * 0.52) * env) * (i % 2 === 0 ? 1 : -1);
  });
}

export class SonificationService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private panner: StereoPannerNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneSubOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  private playbackState: PlaybackState = "idle";
  private activeSpec: AudioCompositionSpec | null = null;
  private activeInput: SonificationInput | null = null;
  private config: SonificationConfig = {
    volume: 0.72,
    waveform: "sine",
    minFrequencyHz: 185,
    maxFrequencyHz: 780,
    enableHarmonics: true,
  };

  private schedulerTimer: number | null = null;
  private rafId: number | null = null;
  private stepCursor = 0;
  private nextNoteTime = 0;
  private elapsedSec = 0;
  private lastFrameMs = 0;

  private timeDomainBuf: Float32Array<ArrayBuffer> | null = null;
  private freqDomainBuf: Uint8Array<ArrayBuffer> | null = null;
  private visualWaveform: number[] = new Array(64).fill(0);
  private visualSpectrum: number[] = new Array(32).fill(0);
  private visualFrame: AudioVisualFrame = {
    playbackState: "idle",
    activeCompositionId: null,
    progress: 0,
    rms: 0,
    spectralCentroid: 0.4,
    waveformSamples: this.visualWaveform,
    spectrumBins: this.visualSpectrum,
  };
  private clockState: AudioClockState = {
    activeCompositionId: null,
    activeTitle: "Northern Vietnam",
    playbackState: "idle",
    currentStep: 0,
    activeSlot: 0,
    progress: 0,
    elapsedSec: 0,
    totalSec: 30,
    rms: 0,
    spectralCentroid: 0.4,
    activeFrequencyHz: 261.63,
    waveformSamples: this.visualWaveform,
    spectrumBins: this.visualSpectrum,
    scheduleMatrix: [new Array(16).fill(0.2), new Array(16).fill(0.2), new Array(16).fill(0.2)],
  };

  private stateListeners = new Set<(state: PlaybackState) => void>();
  private telemetryListeners = new Set<(telemetry: AudioTelemetry) => void>();
  private clockListeners = new Set<(clock: AudioClockState) => void>();
  private visualListeners = new Set<(frame: AudioVisualFrame) => void>();

  public onStateChange(listener: (state: PlaybackState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.playbackState);
    return () => this.stateListeners.delete(listener);
  }

  public onTelemetry(listener: (telemetry: AudioTelemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  public onClockTick(listener: (clock: AudioClockState) => void): () => void {
    this.clockListeners.add(listener);
    listener(this.clockState);
    return () => this.clockListeners.delete(listener);
  }

  /**
   * Subscribes canvas/DOM-ref visualizers to 60fps analyser frames without triggering React state updates.
   */
  public onVisualTick(listener: (frame: AudioVisualFrame) => void): () => void {
    this.visualListeners.add(listener);
    listener(this.visualFrame);
    return () => this.visualListeners.delete(listener);
  }

  public getVisualFrame(): AudioVisualFrame {
    return this.visualFrame;
  }

  public getState(): PlaybackState {
    return this.playbackState;
  }

  public getConfig(): SonificationConfig {
    return { ...this.config };
  }

  public getClockState(): AudioClockState {
    return this.clockState;
  }

  private setState(next: PlaybackState) {
    this.playbackState = next;
    this.visualFrame.playbackState = next;
    this.clockState = { ...this.clockState, playbackState: next };
    this.stateListeners.forEach((fn) => fn(next));
    this.emitClock();
    this.emitVisuals();
  }

  private emitClock() {
    this.clockListeners.forEach((fn) => fn(this.clockState));
  }

  private emitVisuals() {
    this.visualListeners.forEach((fn) => fn(this.visualFrame));
  }

  private emitTelemetry(freq: number, normalizedValue: number) {
    const t: AudioTelemetry = {
      currentFrequencyHz: freq,
      normalizedValue,
      gainLevel: this.config.volume,
      timestamp: this.activeInput?.timestamp ?? new Date().toISOString(),
    };
    this.telemetryListeners.forEach((fn) => fn(t));
  }

  private ensureAudioGraph(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    if (!this.masterGain || !this.filterNode || !this.analyser || !this.panner) {
      const ctx = this.ctx;
      this.panner = ctx.createStereoPanner();
      this.filterNode = ctx.createBiquadFilter();
      this.filterNode.type = "lowpass";
      this.filterNode.frequency.value = 1800;
      this.filterNode.Q.value = 1.25;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.config.volume * 0.42;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;

      this.panner.connect(this.filterNode);
      this.filterNode.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.timeDomainBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.freqDomainBuf = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }

    return this.ctx;
  }

  private startDrone(ctx: AudioContext, freq: number) {
    if (!this.filterNode) return;
    this.stopDrone();

    const droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    droneGain.gain.linearRampToValueAtTime(0.08 * this.config.volume, ctx.currentTime + 0.35);
    droneGain.connect(this.filterNode);

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq * 0.5;
    osc1.connect(droneGain);

    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.value = freq * 0.75;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    osc2.connect(subGain);
    subGain.connect(droneGain);

    osc1.start();
    osc2.start();

    this.droneOsc = osc1;
    this.droneSubOsc = osc2;
    this.droneGain = droneGain;
  }

  private stopDrone() {
    const ctx = this.ctx;
    if (this.droneGain && ctx) {
      try {
        this.droneGain.gain.cancelScheduledValues(ctx.currentTime);
        this.droneGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      } catch {
        // Ignore stopped node transitions
      }
    }
    const o1 = this.droneOsc;
    const o2 = this.droneSubOsc;
    this.droneOsc = null;
    this.droneSubOsc = null;
    this.droneGain = null;
    setTimeout(() => {
      try {
        o1?.stop();
        o1?.disconnect();
        o2?.stop();
        o2?.disconnect();
      } catch {
        // Already stopped
      }
    }, 100);
  }

  private triggerStepVoice(when: number, step: number, spec: AudioCompositionSpec) {
    const ctx = this.ctx;
    if (!ctx || !this.panner || !this.filterNode) return;

    const matrix = this.clockState.scheduleMatrix;
    const primaryVel = matrix[0]?.[step] ?? 0.3;
    const timbreVel = matrix[1]?.[step] ?? 0.3;
    const deltaVel = matrix[2]?.[step] ?? 0.2;

    const interp = interpolateSeries(spec.series, STEPS);
    const span = Math.max(1e-4, spec.max - spec.min);
    const norm = clamp01((interp[step] - spec.min) / span);

    const scale = KEY_SCALES[spec.mapping.musicalKey] ?? KEY_SCALES["A minor"];
    const baseIdx = Math.min(
      scale.length - 1,
      Math.max(0, Math.round(norm * (scale.length - 1) * (0.45 + spec.mapping.pitchSensitivity * 0.55)))
    );
    const noteFreq = scale[baseIdx];

    // Live filter cutoff responds smoothly to aerosol brightness slider
    const cutoff = 420 + spec.mapping.brightness * 3600 + timbreVel * 900;
    this.filterNode.frequency.setTargetAtTime(cutoff, when, 0.06);

    // Stereo field reacts to spatialSpread slider
    const pan = (step % 2 === 0 ? -1 : 1) * spec.mapping.spatialSpread * 0.62 * (0.4 + norm * 0.6);
    this.panner.pan.setTargetAtTime(pan, when, 0.04);

    if (this.droneOsc && this.droneSubOsc) {
      this.droneOsc.frequency.setTargetAtTime(scale[0] * 0.5, when, 0.15);
      this.droneSubOsc.frequency.setTargetAtTime(scale[0] * 0.75, when, 0.15);
    }

    // Primary pulse voice
    if (primaryVel > 0.14) {
      const env = ctx.createGain();
      const peak = Math.max(0.03, primaryVel * 0.24);
      const decay = 0.16 + (1 - spec.mapping.density) * 0.22;
      env.gain.setValueAtTime(0.0001, when);
      env.gain.linearRampToValueAtTime(peak, when + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, when + decay);

      const osc = ctx.createOscillator();
      osc.type = spec.mapping.waveform || this.config.waveform;
      osc.frequency.setValueAtTime(noteFreq, when);
      osc.connect(env);
      env.connect(this.panner);
      osc.start(when);
      osc.stop(when + decay + 0.04);
    }

    // Secondary harmonic sparkle on atmospheric gradient peaks
    if (this.config.enableHarmonics && deltaVel > 0.24) {
      const shimmerIdx = Math.min(scale.length - 1, baseIdx + 2);
      const shimmerFreq = scale[shimmerIdx] * 1.5;
      const env2 = ctx.createGain();
      env2.gain.setValueAtTime(0.0001, when + 0.01);
      env2.gain.linearRampToValueAtTime(deltaVel * 0.1, when + 0.03);
      env2.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);

      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(shimmerFreq, when + 0.01);
      osc2.connect(env2);
      env2.connect(this.filterNode);
      osc2.start(when + 0.01);
      osc2.stop(when + 0.3);
    }

    const nextFreq = Number(noteFreq.toFixed(1));
    const nextSlot = Math.floor(step / 2) % Math.max(1, spec.series.length || 8);
    if (
      this.clockState.currentStep !== step ||
      this.clockState.activeSlot !== nextSlot ||
      this.clockState.activeFrequencyHz !== nextFreq
    ) {
      this.clockState = {
        ...this.clockState,
        activeFrequencyHz: nextFreq,
        currentStep: step,
        activeSlot: nextSlot,
      };
      this.emitClock();
    }
    this.emitTelemetry(noteFreq, norm);
  }

  private startLoops() {
    this.stopLoops();
    const ctx = this.ctx;
    if (!ctx) return;

    this.nextNoteTime = ctx.currentTime + 0.03;
    this.lastFrameMs = performance.now();
    let lastEmittedSecond = Math.floor(this.elapsedSec);

    this.schedulerTimer = window.setInterval(() => {
      if (this.playbackState !== "playing" || !this.ctx || !this.activeSpec) return;
      const lookahead = 0.14;
      const stepDurationSec = 60 / Math.max(48, Math.min(180, this.activeSpec.mapping.tempo)) / 2;
      while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
        this.triggerStepVoice(this.nextNoteTime, this.stepCursor, this.activeSpec);
        this.stepCursor = (this.stepCursor + 1) % STEPS;
        this.nextNoteTime += stepDurationSec;
      }
    }, 32);

    const tickVisuals = (nowMs: number) => {
      if (this.playbackState !== "playing") return;
      const dt = Math.min(0.1, (nowMs - this.lastFrameMs) / 1000);
      this.lastFrameMs = nowMs;
      const total = this.clockState.totalSec || 30;
      this.elapsedSec = (this.elapsedSec + dt) % total;
      const progress = this.elapsedSec / total;

      let rms = 0;
      let centroid = 0.4;

      if (this.analyser && this.timeDomainBuf && this.freqDomainBuf) {
        this.analyser.getFloatTimeDomainData(this.timeDomainBuf);
        this.analyser.getByteFrequencyData(this.freqDomainBuf);

        let sqSum = 0;
        const stepT = Math.max(1, Math.floor(this.timeDomainBuf.length / 64));
        for (let i = 0; i < 64; i += 1) {
          const sample = this.timeDomainBuf[Math.min(this.timeDomainBuf.length - 1, i * stepT)];
          this.visualWaveform[i] = Math.max(-1, Math.min(1, sample * 2.8));
          sqSum += sample * sample;
        }
        rms = Math.min(1, Math.sqrt(sqSum / 64) * 3.8);

        let weightedIdx = 0;
        let magSum = 0;
        const usable = Math.min(96, this.freqDomainBuf.length);
        const stepF = Math.max(1, Math.floor(usable / 32));
        for (let i = 0; i < 32; i += 1) {
          const mag = this.freqDomainBuf[Math.min(usable - 1, i * stepF)] / 255;
          this.visualSpectrum[i] = mag;
          weightedIdx += mag * i;
          magSum += mag;
        }
        centroid = magSum > 0.01 ? clamp01(weightedIdx / (magSum * 31)) : 0.35;
      }

      this.visualFrame.playbackState = this.playbackState;
      this.visualFrame.activeCompositionId = this.clockState.activeCompositionId;
      this.visualFrame.progress = progress;
      this.visualFrame.rms = rms;
      this.visualFrame.spectralCentroid = centroid;
      this.emitVisuals();

      this.clockState.elapsedSec = this.elapsedSec;
      this.clockState.progress = progress;
      this.clockState.rms = rms;
      this.clockState.spectralCentroid = centroid;

      const wholeSecond = Math.floor(this.elapsedSec);
      if (wholeSecond !== lastEmittedSecond) {
        lastEmittedSecond = wholeSecond;
        this.clockState = { ...this.clockState };
        this.emitClock();
      }
      this.rafId = window.requestAnimationFrame(tickVisuals);
    };

    this.rafId = window.requestAnimationFrame(tickVisuals);
  }

  private stopLoops() {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public syncPreviewSpec(spec: AudioCompositionSpec): void {
    this.activeSpec = spec;
    const matrix = computeScheduleMatrix(spec);
    const totalSec = spec.durationSec ?? 30;
    const idleWave = buildStaticWaveform(spec, 64);

    this.config.volume = spec.mapping.volume;
    this.config.waveform = spec.mapping.waveform;

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(spec.mapping.volume * 0.42, this.ctx.currentTime, 0.05);
    }

    if (this.playbackState !== "playing") {
      for (let i = 0; i < 64; i += 1) {
        this.visualWaveform[i] = idleWave[i] ?? 0;
      }
      this.visualFrame.progress = 0;
    }
    this.visualFrame.activeCompositionId = spec.id;

    this.clockState = {
      ...this.clockState,
      activeCompositionId: spec.id,
      activeTitle: spec.title,
      totalSec,
      scheduleMatrix: matrix,
      waveformSamples: this.visualWaveform,
    };
    this.emitClock();
    this.emitVisuals();
  }

  public playComposition(spec: AudioCompositionSpec): void {
    const isNewTrack = this.clockState.activeCompositionId !== spec.id;
    this.syncPreviewSpec(spec);

    const ctx = this.ensureAudioGraph();
    if (!ctx) {
      this.setState("error");
      return;
    }

    if (isNewTrack || this.playbackState === "idle") {
      this.stepCursor = 0;
      this.elapsedSec = 0;
    }

    this.config.volume = spec.mapping.volume;
    this.config.waveform = spec.mapping.waveform;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(spec.mapping.volume * 0.42, ctx.currentTime, 0.04);
    }

    const scale = KEY_SCALES[spec.mapping.musicalKey] ?? KEY_SCALES["A minor"];
    if (!this.droneOsc) {
      this.startDrone(ctx, scale[0]);
    }
    this.setState("playing");
    this.startLoops();
  }

  public seekStep(step: number): void {
    const safe = ((step % STEPS) + STEPS) % STEPS;
    this.stepCursor = safe;
    const total = this.clockState.totalSec || 30;
    this.elapsedSec = (safe / STEPS) * total;
    const progress = safe / STEPS;
    this.visualFrame.progress = progress;
    this.clockState = {
      ...this.clockState,
      currentStep: safe,
      activeSlot: Math.floor(safe / 2) % 8,
      elapsedSec: this.elapsedSec,
      progress,
    };
    if (this.playbackState === "playing" && this.activeSpec && this.ctx) {
      this.triggerStepVoice(this.ctx.currentTime + 0.01, safe, this.activeSpec);
    }
    this.emitClock();
    this.emitVisuals();
  }

  /** Legacy single-point tone API preserved for compatibility with AudioPlayer & tests. */
  public play(input: SonificationInput): void {
    this.activeInput = input;
    const min = input.min ?? 0;
    const max = Math.max(min + 1, input.max ?? 150);
    const val = Math.max(min, Math.min(max, input.value));
    const norm = clamp01((val - min) / (max - min));
    const syntheticSpec: AudioCompositionSpec = {
      id: `point-${input.label ?? "obs"}`,
      title: input.label ?? "Atmospheric Point Tone",
      regionName: input.label ?? "Observation",
      variable: "PM25_RH35",
      series: [
        val * 0.85,
        val * 0.92,
        val,
        val * 1.08,
        val * 1.03,
        val * 0.96,
        val * 0.9,
        val * 0.94,
      ],
      min,
      max,
      mapping: {
        density: clamp01(0.35 + norm * 0.55),
        brightness: clamp01(0.35 + norm * 0.45),
        pitchSensitivity: 0.62,
        spatialSpread: 0.4,
        tempo: 92,
        musicalKey: "A minor",
        waveform: this.config.waveform,
        volume: this.config.volume,
      },
      durationSec: 30,
    };
    this.playComposition(syntheticSpec);
  }

  public pause(): void {
    this.stopLoops();
    this.stopDrone();
    this.setState("paused");
  }

  public resume(input?: SonificationInput): void {
    if (input) {
      this.play(input);
      return;
    }
    if (this.activeSpec) {
      this.playComposition(this.activeSpec);
      return;
    }
    if (this.activeInput) {
      this.play(this.activeInput);
    }
  }

  public stop(): void {
    this.stopLoops();
    this.stopDrone();
    this.stepCursor = 0;
    this.elapsedSec = 0;
    const idleWave = this.activeSpec ? buildStaticWaveform(this.activeSpec, 64) : null;
    for (let i = 0; i < 64; i += 1) {
      this.visualWaveform[i] = idleWave ? (idleWave[i] ?? 0) : 0;
    }
    this.visualSpectrum.fill(0);
    this.visualFrame.progress = 0;
    this.visualFrame.rms = 0;
    this.clockState = {
      ...this.clockState,
      currentStep: 0,
      activeSlot: 0,
      progress: 0,
      elapsedSec: 0,
      rms: 0,
      waveformSamples: this.visualWaveform,
      spectrumBins: this.visualSpectrum,
    };
    this.setState("idle");
  }

  public setVolume(volume: number): void {
    const safe = Math.max(0, Math.min(1, volume));
    this.config.volume = safe;
    if (this.activeSpec) {
      this.activeSpec = { ...this.activeSpec, mapping: { ...this.activeSpec.mapping, volume: safe } };
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(safe * 0.42, this.ctx.currentTime, 0.04);
    }
  }

  public setWaveform(waveform: OscillatorWaveform): void {
    this.config.waveform = waveform;
    if (this.activeSpec) {
      this.activeSpec = { ...this.activeSpec, mapping: { ...this.activeSpec.mapping, waveform } };
    }
  }

  public updateConfig(partial: Partial<SonificationConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.volume !== undefined) this.setVolume(partial.volume);
    if (partial.waveform !== undefined) this.setWaveform(partial.waveform);
  }

  /**
   * Prepares Web Audio graph for 2D map sweep sonification, pausing any timeline composition
   * so continuous playback and interactive spatial chimes never compete.
   */
  public beginSpatialScan(): boolean {
    if (this.playbackState === "playing") {
      this.pause();
    }
    const ctx = this.ensureAudioGraph();
    return Boolean(ctx);
  }

  /**
   * Schedules a crisp polyphonic chime chord triggered when the 2D scanline intersects air-quality hotspots.
   * Vertical band indices map bottom-to-top pitch while horizontal progress drives stereo panning.
   */
  public triggerSpatialScanColumn(
    voices: ScanVoiceInput[],
    mapping: SonificationMapping,
    pan: number
  ): void {
    if (!voices.length) return;
    const ctx = this.ensureAudioGraph();
    if (!ctx || !this.filterNode || !this.masterGain) return;

    const when = ctx.currentTime + 0.008;
    const capped = voices.slice(0, 4);
    const scale = getExtendedScaleFrequencies(mapping.musicalKey);
    const peakNorm = Math.max(...capped.map((v) => v.norm));
    const cutoff = 520 + mapping.brightness * 3600 + peakNorm * 1400;

    this.filterNode.frequency.setTargetAtTime(cutoff, when, 0.03);
    this.masterGain.gain.setTargetAtTime(mapping.volume * 0.44, when, 0.03);

    const colPan = ctx.createStereoPanner();
    const clampedPan = Math.max(-0.82, Math.min(0.82, pan * (0.45 + mapping.spatialSpread * 0.55)));
    colPan.pan.setValueAtTime(clampedPan, when);
    colPan.connect(this.filterNode);

    const chordGainScale = 1 / Math.sqrt(capped.length);
    let longestStopTime = when + 0.2;
    let lastLeadFreq = scale[0];

    for (let i = 0; i < capped.length; i += 1) {
      const voice = capped[i];
      const pitchShift = Math.round((voice.row - 7.5) * (0.55 + mapping.pitchSensitivity * 0.45) + 7.5);
      const scaleIdx = Math.max(0, Math.min(scale.length - 1, pitchShift));
      const freq = scale[scaleIdx];
      lastLeadFreq = freq;

      const onset = when + i * 0.011;
      const decay = 0.16 + (1 - mapping.density) * 0.22 + voice.norm * 0.09;
      const peakGain = Math.max(0.025, (0.08 + voice.norm * 0.17) * chordGainScale);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, onset);
      env.gain.linearRampToValueAtTime(peakGain, onset + 0.009);
      env.gain.exponentialRampToValueAtTime(0.0001, onset + decay);

      const osc = ctx.createOscillator();
      osc.type = mapping.waveform || this.config.waveform;
      osc.frequency.setValueAtTime(freq, onset);
      osc.connect(env);
      env.connect(colPan);
      osc.start(onset);
      osc.stop(onset + decay + 0.03);
      longestStopTime = Math.max(longestStopTime, onset + decay + 0.05);

      if (voice.isAccent && this.config.enableHarmonics) {
        const shimmerEnv = ctx.createGain();
        shimmerEnv.gain.setValueAtTime(0.0001, onset + 0.004);
        shimmerEnv.gain.linearRampToValueAtTime(peakGain * 0.42, onset + 0.012);
        shimmerEnv.gain.exponentialRampToValueAtTime(0.0001, onset + 0.13);

        const shimmerOsc = ctx.createOscillator();
        shimmerOsc.type = "sine";
        shimmerOsc.frequency.setValueAtTime(freq * 2, onset + 0.004);
        shimmerOsc.connect(shimmerEnv);
        shimmerEnv.connect(colPan);
        shimmerOsc.start(onset + 0.004);
        shimmerOsc.stop(onset + 0.16);
      }
    }

    const cleanupDelayMs = Math.max(250, Math.ceil((longestStopTime - ctx.currentTime) * 1000) + 60);
    window.setTimeout(() => {
      try {
        colPan.disconnect();
      } catch {
        // Ignore disconnected node during teardown
      }
    }, cleanupDelayMs);

    this.clockState = {
      ...this.clockState,
      activeFrequencyHz: Number(lastLeadFreq.toFixed(1)),
    };
  }

  public endSpatialScan(): void {
    // Voices naturally decay within ~0.4s; no drone sustain to tear down.
  }

  public destroy(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this.filterNode = null;
    this.analyser = null;
    this.panner = null;
  }
}

export const sonificationService = new SonificationService();
