export type PlaybackState = "idle" | "playing" | "paused" | "stopped" | "error";

export type OscillatorWaveform = "sine" | "triangle" | "sawtooth" | "square";

export interface SonificationInput {
  /** Primary metric measurement to map to pitch and density. */
  value: number;
  min: number;
  max: number;
  timestamp?: string;
  label?: string;
  variable?: string;
}

export interface SonificationConfig {
  /** Base output gain (0.0 to 1.0) */
  volume: number;
  /** Primary oscillator timbre */
  waveform: OscillatorWaveform;
  /** Minimum frequency in Hz (lower bound of audible scale) */
  minFrequencyHz: number;
  /** Maximum frequency in Hz (upper bound of audible scale) */
  maxFrequencyHz: number;
  /** Secondary harmonic oscillator toggle (rich atmospheric density) */
  enableHarmonics: boolean;
}

export interface AudioTelemetry {
  currentFrequencyHz: number;
  normalizedValue: number;
  gainLevel: number;
  timestamp: string;
}

export interface AudioClockState {
  activeCompositionId: string | null;
  activeTitle: string;
  playbackState: PlaybackState;
  currentStep: number;
  activeSlot: number;
  progress: number;
  elapsedSec: number;
  totalSec: number;
  rms: number;
  spectralCentroid: number;
  activeFrequencyHz: number;
  waveformSamples: number[];
  spectrumBins: number[];
  scheduleMatrix: number[][];
}
