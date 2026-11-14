import type { OscillatorWaveform } from "./audio";

export type LayerKey = "PM25_RH35" | "AOD" | "NO2" | "SO2" | "CO" | "O3";

export type BasemapMode = "territories" | "choropleth" | "atlas" | "satellite";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LayerDefinition {
  key: LayerKey;
  label: string;
  short: string;
  unit: string;
  available: boolean;
  vmin: number;
  vmax: number;
  cmap: "inferno" | "magma" | "viridis" | "cividis" | "plasma";
  description: string;
  methodologyNote: string;
}

export interface GeographicSelection {
  id: string;
  name: string;
  polygon: GeoPoint[];
  bounds: GeoBounds;
  areaKm2: number;
  center: GeoPoint;
  sourceType: "preset" | "custom" | "gallery";
}

export interface RegionStats {
  variable: LayerKey;
  unit: string;
  mean: number | null;
  min: number | null;
  max: number | null;
  p90: number | null;
  sampleCount: number;
  coveragePct: number;
  timestamp: string;
  sourceKind: "backend-netcdf" | "geos-cf-raster" | "point-observation" | "unavailable";
  sourceLabel: string;
  isMock: boolean;
  loading?: boolean;
  error?: string | null;
}

export interface SonificationMapping {
  /** 0..1 intensity: primary variable concentration -> rhythmic pulse density */
  density: number;
  /** 0..1 intensity: aerosol / optical scattering proxy -> filter cutoff & harmonic timbre */
  brightness: number;
  /** 0..1 intensity: rate of temporal change -> pitch excursion */
  pitchSensitivity: number;
  /** 0..1 intensity: spatial variability -> stereo width / ambient spread */
  spatialSpread: number;
  tempo: number;
  musicalKey: string;
  waveform: OscillatorWaveform;
  volume: number;
}

export interface MapCameraState {
  center: GeoPoint;
  zoom: number;
  mode: "globe" | "flat";
  pitch: number;
  bearing: number;
}

export interface AudioCompositionSpec {
  id: string;
  title: string;
  regionName: string;
  variable: LayerKey;
  series: number[];
  min: number;
  max: number;
  mapping: SonificationMapping;
  durationSec?: number;
}

export interface GalleryWork {
  id: string;
  title: string;
  creator: string;
  regionId: string;
  region: string;
  polygon: GeoPoint[];
  center: GeoPoint;
  zoom: number;
  variable: LayerKey;
  timeIndex: number;
  timeRangeLabel: string;
  duration: string;
  tempo: number;
  musicalKey: string;
  mappings: {
    density: number;
    brightness: number;
    pitchSensitivity: number;
    spatialSpread: number;
  };
  seriesPreview: number[];
  description: string;
  dataSource: string;
  isIllustrative: boolean;
  isUserSaved?: boolean;
}

export interface BreatheProjectFile {
  version: "2.0";
  name: string;
  polygon: GeoPoint[];
  layer: LayerKey;
  timeIndex: number;
  tempo: number;
  key: string;
  waveform: OscillatorWaveform;
  mappings: number[];
}

