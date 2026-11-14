import type { NotebookDemoContract, Pollutant } from './notebookDemo';
export type DetailAxis = 'horizontal' | 'vertical';
export type DetailProfile = 'focus' | 'spectral';
export type DetailResolution = 45 | 22.5 | 11.25 | 5 | 1 | 'native';
export type NativeCrop = [number, number, number, number];
export interface DetailManifest {
  schema_version: 'geos-cf-detail-v1'; isMock: false; source: NotebookDemoContract['source'];
  rows: 721; cols: 1440; lat_first: 90; lat_step: -0.25; lon_first: -180; lon_step: 0.25;
  order: 'north-to-south,west-to-east'; calibration_version: string; missing: 'NaN';
  fields: Record<Pollutant, { url: string; sha256: string; dtype: 'float32-le'; unit: string; audio_max: number; valid_count: number; minimum: number | null; maximum: number | null }>;
}
export interface DetailBin { key: number; start: number; end: number; low: number; high: number }
export interface DetailFrames {
  steps: number; lanes: number; mean: Float32Array; p90: Float32Array; spread: Float32Array;
  coverage: Float32Array; contrast: Float32Array; positions: Float32Array; stepPositions: Float32Array;
  laneBins: { start: number; end: number }[]; profile: DetailProfile; axis: DetailAxis; audioMax: number;
}
export interface DetailView {
  mappingVersion: string; rows: number; cols: number; rowBins: DetailBin[]; colBins: DetailBin[];
  grid: Float32Array; validCounts: Uint32Array; totals: Uint32Array; included: number; validTotal: number; frames: DetailFrames;
}
export interface DetailOptions { resolution: DetailResolution; profile: DetailProfile; axis: DetailAxis; bands: 8 | 16; crop?: NativeCrop; audioMax: number }
export interface DetailControls {
  volume: number; monitor: number; music: boolean; from: number; to: number; reverse: boolean; stems: number[];
  arrangement?: 'context' | 'legacy'; referenceGain?: number; referenceSolo?: boolean; space?: number;
}
export interface DetailTick { cursor: number; step: number; done: boolean; peak: number; limited: number }
export interface ContextVoice {
  lane: number; valid: boolean; mean: number | null; p90: number; excess: number; spread: number; edge: number; note: number;
}
export interface ContextWindow { startStep: number; endStep: number; voices: ContextVoice[] }
export interface ContextPlan { version: string; windowSteps: number; windows: ContextWindow[]; gradient: Float32Array; curvature: Float32Array }
