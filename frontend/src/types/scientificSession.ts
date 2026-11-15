import type { DetailAxis, DetailBin, DetailFrames, DetailResolution, ContextWindow } from './geosCfDetail';
import type { Pollutant } from './notebookDemo';

export interface SessionBounds { south: number; north: number; west: number; east: number }
export interface ScientificSelection {
  schema_version: 'breathe-session-request-v1'; pollutant: Pollutant;
  scope: 'global' | 'region' | 'compare'; traversal: 'time' | 'space' | 'series';
  start: string; end: string; resolution: DetailResolution; axis: DetailAxis;
  bands: 8 | 16; duration: 180 | 300 | 420; regions: SessionBounds[];
}
export interface EncodedArray { dtype: 'float32-le' | 'float64-le' | 'uint32-le' | 'int32-le'; length: number; data: string }
export interface ScientificSlot { timestamp: string; source_sha256: string | null; first: number; end: number; missing: boolean }
export interface ScientificPlanWire {
  schema_version: 'breathe-session-plan-v1'; id: string; isMock: false;
  selection: ScientificSelection; calibration_version: string; mapping_version: string;
  unit: string; audio_max: number; steps: number; lanes: number; lane_counts: number[];
  slots: ScientificSlot[]; arrays: Record<string, EncodedArray>;
  arrangement: { version: string; windowSteps: number; windows: ContextWindow[] };
  sources: { timestamp: string; sha256: string; source_url: string }[]; warnings: string[];
}
export interface ScientificPlan { wire: ScientificPlanWire; frames: DetailFrames }
export interface ScientificMapView {
  rows: number; cols: number; rowBins: DetailBin[]; colBins: DetailBin[];
  laneBins: { start: number; end: number }[]; grid: Float32Array; validCounts: Uint32Array; totals: Uint32Array;
}
export interface ScientificFrame { timestamp: string; source_sha256: string | null; missing: boolean; views: ScientificMapView[] }
