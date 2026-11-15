export type Pollutant = "pm25_rh35" | "pm10_rh35" | "co" | "no2" | "o3" | "so2";
export type DataMode = "global" | "region" | "temporal" | "journey";
export type AudioMode = "scientific" | "harmonic";
export type Direction = "forward" | "reverse";
export type DemoState = "ready" | "playing" | "paused";

export interface FrozenEvent {
  event_id: string;
  canonical_index: number;
  scientific: {
    pollutant: Pollutant;
    scan_id: string;
    timestamp_utc: string;
    source_sha256: string | null;
    bounds: { lat: [number, number]; lon: [number, number] };
    raw_value: number | null;
    value: number | null;
    unit: string;
    score: number | null;
    pulses: number | null;
    valid_cells: number;
    total_cells: number;
    missing: boolean;
  };
  artistic_mood: string | null;
  chord_name: string | null;
  chord_midi: number[] | null;
  melody_midi: number | null;
  bass_midi: number | null;
  melody_note_count: number;
  delta_canonical_score: number | null;
  variation_kind: "spatial_contrast" | "region_comparison" | "temporal_change";
  texture_pcm: number[][];
  focus_feature?: FocusFeature;
  timeline_gap?: boolean;
  chronological_delta?: number | null;
}

export interface FocusFeature {
  cell_id: string;
  p90: number | null;
  iqr: number | null;
  spread_score: number;
  neighbor_contrast: number;
  coverage: number;
  chronological_contrast?: number;
}
export type MusicProfile = "baseline" | "focus";
export type FocusStem = "lead" | "pad" | "bass" | "texture";
export interface StemControl { gain: number; muted: boolean; solo: boolean }

export interface DemoAudioConfig {
  sample_rate: number;
  seconds_per_bar: number;
  data_gain: number;
  music_gain: number;
  pulse_hz: number;
  missing_hz: number;
  pulse_seconds: number;
  pulse_single_offset: number;
  pulse_first_offset: number;
  pulse_last_offset: number;
  missing_offsets: [number, number];
  missing_seconds: number;
  attack_seconds: number;
  release_seconds: number;
}

export interface NotebookDemoContract {
  schema_version: "breathe-notebook-demo-v1";
  calibration_version: string;
  mapping_version: string;
  isMock: boolean;
  source: {
    provider: string; collection: string; source_file: string;
    source_url: string | null; sha256: string; timestamp_utc: string;
    grid_shape: [number, number];
  };
  audio: DemoAudioConfig;
  pollutants: Record<Pollutant, {
    label: string; source_variable: string; source_unit: string; unit: string;
    factor: number; audio_max: number; display_max: number;
  }>;
  global_plans: Record<Pollutant, FrozenEvent[]>;
  region_plans: Record<Pollutant, FrozenEvent[]>;
  map_urls: Record<Pollutant, string>;
  temporal_status: "unavailable_single_verified_timestamp";
  aggregation: string;
  mood_boundaries: [number, number, number];
  mood_hysteresis: number;
}
