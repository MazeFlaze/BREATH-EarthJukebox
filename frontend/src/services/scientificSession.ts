import type { Catalog } from './geosCfCatalog';
import type { EncodedArray, ScientificFrame, ScientificMapView, ScientificPlan, ScientificPlanWire, ScientificSelection } from '@/types/scientificSession';

export function scientificApiBase() {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim();
  const base = raw && !['undefined', 'null'].includes(raw) ? raw.replace(/\/+$/, '').replace(/\/api\/v1$/i, '') : 'http://localhost:8000';
  return base + '/api/v1/scientific';
}
async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(scientificApiBase() + path, { signal, cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Error(`Scientific API ${response.status}: ${typeof data.detail === 'string' ? data.detail : 'Invalid selection or unavailable data'}`);
  }
  return response.json() as Promise<T>;
}
export function decodeArray(array: EncodedArray): Float32Array | Float64Array | Uint32Array | Int32Array {
  const binary = atob(array.data), width = array.dtype === 'float64-le' ? 8 : 4;
  if (!Number.isInteger(array.length) || array.length < 0 || binary.length !== array.length * width) throw Error('Invalid scientific binary array length');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), data = new DataView(bytes.buffer);
  if (array.dtype === 'float64-le') return Float64Array.from({ length: array.length }, (_, i) => data.getFloat64(i * width, true));
  if (array.dtype === 'uint32-le') return Uint32Array.from({ length: array.length }, (_, i) => data.getUint32(i * width, true));
  if (array.dtype === 'int32-le') return Int32Array.from({ length: array.length }, (_, i) => data.getInt32(i * width, true));
  if (array.dtype !== 'float32-le') throw Error('Unknown scientific array dtype');
  return Float32Array.from({ length: array.length }, (_, i) => data.getFloat32(i * width, true));
}
export async function scientificCatalog(signal: AbortSignal) {
  const catalog = await request<Catalog>('/catalog', signal);
  if (catalog.schema_version !== 'geos-cf-local-catalog-v1' || catalog.download_policy !== 'manual_only') throw Error('Unsupported scientific catalog');
  return catalog;
}
export async function prepareScientificSession(selection: ScientificSelection, signal: AbortSignal): Promise<ScientificPlan> {
  const wire = await request<ScientificPlanWire>('/sessions', signal, selection);
  if (wire.schema_version !== 'breathe-session-plan-v1' || wire.isMock !== false || !/^[a-f0-9]{64}$/.test(wire.id)
    || !(wire.steps > 0) || !(wire.lanes > 0) || wire.steps * wire.lanes > 1_200_000 || !(wire.audio_max > 0)) throw Error('Unsupported scientific plan');
  const get = (key: string, count: number): Float32Array => {
    const value = decodeArray(wire.arrays[key]);
    if (!(value instanceof Float32Array) || value.length !== count) throw Error('Scientific plan shape mismatch: ' + key);
    return value;
  };
  const size = wire.steps * wire.lanes;
  const frames = { steps: wire.steps, lanes: wire.lanes, mean: get('mean', size), p90: get('p90', size), spread: get('spread', size),
    coverage: get('coverage', size), contrast: get('contrast', size), positions: get('positions', wire.lanes), stepPositions: get('stepPositions', wire.steps),
    lanePanPositions: get('lanePanPositions', wire.lanes), laneBins: Array.from({ length: wire.lanes }, (_, i) => ({ start: i, end: i + 1 })),
    profile: 'focus' as const, axis: wire.selection.axis, audioMax: wire.audio_max,
    featureDomain: wire.selection.traversal === 'time' ? 'temporal' as const : 'spatial' as const,
    contextPlan: { ...wire.arrangement, gradient: get('contextGradient', size), curvature: get('contextCurvature', size), stepWindows: decodeArray(wire.arrays.stepWindows) as Int32Array },
  };
  if (wire.slots.at(-1)?.end !== wire.steps || wire.lane_counts.reduce((a, b) => a + b, 0) !== wire.lanes) throw Error('Invalid scientific timeline');
  return { wire, frames };
}
export async function scientificFrame(plan: ScientificPlan, index: number, signal: AbortSignal): Promise<ScientificFrame> {
  const slot = plan.wire.slots[index];
  const wire = await request<{ schema_version: string; timestamp: string; source_sha256: string | null; missing: boolean;
    views: (Omit<ScientificMapView, 'grid' | 'validCounts' | 'totals'> & { arrays: Record<string, EncodedArray> })[] }>('/frames', signal,
    { selection: plan.wire.selection, timestamp: slot.timestamp, source_sha256: slot.source_sha256,
      calibration_version: plan.wire.calibration_version, unit: plan.wire.unit, audio_max: plan.wire.audio_max });
  if (wire.schema_version !== 'breathe-frame-view-v1' || wire.timestamp !== slot.timestamp || wire.source_sha256 !== slot.source_sha256 || wire.missing !== slot.missing) throw Error('Frame does not match scientific source');
  const views = wire.views.map(v => {
    const grid = decodeArray(v.arrays.grid), validCounts = decodeArray(v.arrays.validCounts), totals = decodeArray(v.arrays.totals);
    if (!(grid instanceof Float32Array) || !(validCounts instanceof Uint32Array) || !(totals instanceof Uint32Array)
      || grid.length !== v.rows * v.cols || validCounts.length !== grid.length || totals.length !== grid.length) throw Error('Invalid scientific raster shape');
    return { ...v, grid, validCounts, totals };
  });
  return { ...wire, views };
}
