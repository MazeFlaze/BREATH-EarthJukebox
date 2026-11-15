import type { FocusFeature, FrozenEvent, NotebookDemoContract, Pollutant } from "@/types/notebookDemo";

export interface CatalogEntry {
  id: string; filename: string; timestamp_utc: string | null; sha256: string | null;
  status: "ready" | "duplicate" | "unverified" | "invalid" | "missing" | "conflict";
  provenance: "download_receipt" | "notebook_reference" | "unverified";
  reason: string | null; variables: string[]; grid_shape: number[];
  snapshot_url: string | null; source_url: string | null;
  detail_url?: string | null;
}
export interface Catalog {
  schema_version: "geos-cf-local-catalog-v1"; generated_at: string;
  entries: CatalogEntry[]; gaps: { after: string; before: string; missing_hours: number }[];
  ready_count: number; download_policy: "manual_only";
}
export interface CatalogSnapshot {
  schema_version: "geos-cf-catalog-snapshot-v1";
  focus_mapping_version: "focus-artistic-log99-v1";
  baseline: NotebookDemoContract;
  features: Record<Pollutant, Record<string, FocusFeature>>;
}

/** At most three full snapshots retained, independent of archive length. */
export class SnapshotCache {
  private items = new Map<string, CatalogSnapshot>();
  async load(entry: CatalogEntry): Promise<CatalogSnapshot> {
    if (this.items.has(entry.id)) {
      const value = this.items.get(entry.id)!;
      this.items.delete(entry.id); this.items.set(entry.id, value); return value;
    }
    if (entry.status !== "ready" || !entry.snapshot_url?.startsWith("/data/")) throw new Error("Snapshot chưa được xác minh hoặc không còn trên đĩa");
    const response = await fetch(entry.snapshot_url);
    if (!response.ok) throw new Error(`Không tải được snapshot: HTTP ${response.status}`);
    const data = await response.json() as CatalogSnapshot;
    if (data.schema_version !== "geos-cf-catalog-snapshot-v1" || data.focus_mapping_version !== "focus-artistic-log99-v1"
      || data.baseline.isMock || data.baseline.source.sha256 !== entry.sha256
      || data.baseline.source.timestamp_utc !== entry.timestamp_utc) throw new Error("Snapshot và catalog không khớp");
    this.items.set(entry.id, data);
    while (this.items.size > 3) this.items.delete(this.items.keys().next().value!);
    return data;
  }
  clear() { this.items.clear(); }
  get size() { return this.items.size; }
}

export function enrich(snapshot: CatalogSnapshot, pollutant: Pollutant, mode: "global" | "region"): FrozenEvent[] {
  const plan = mode === "global" ? snapshot.baseline.global_plans[pollutant] : snapshot.baseline.region_plans[pollutant];
  return plan.map(event => ({ ...event, focus_feature: snapshot.features[pollutant][event.scientific.scan_id] }));
}

/** Fixed location, chronological UTC. Missing hours are explicit events with no source hash. */
export async function temporalSeries(entries: CatalogEntry[], cache: SnapshotCache, pollutant: Pollutant, cell: string,
  isCurrent: () => boolean = () => true): Promise<FrozenEvent[]> {
  const sorted = [...entries].sort((a, b) => a.timestamp_utc!.localeCompare(b.timestamp_utc!));
  if (sorted.length < 2) throw new Error("Cần ít nhất hai snapshot thật trong khoảng đã chọn");
  if ((Date.parse(sorted[sorted.length - 1].timestamp_utc!) - Date.parse(sorted[0].timestamp_utc!)) / 3600000 > 47) throw new Error("Chọn cửa sổ tối đa 48 giờ cho một lượt nghe Temporal");
  const result: FrozenEvent[] = [];
  let previous: FrozenEvent | undefined;
  for (const entry of sorted) {
    if (!isCurrent()) throw new Error("Temporal preparation cancelled");
    const snapshot = await cache.load(entry);
    if (!isCurrent()) throw new Error("Temporal preparation cancelled");
    const mode = cell === "A" || cell === "B" ? "region" : "global";
    const source = enrich(snapshot, pollutant, mode).find(event => event.scientific.scan_id === cell);
    if (!source) throw new Error("Không tìm thấy cùng vùng trong tất cả snapshot");
    const timestamp = Date.parse(source.scientific.timestamp_utc);
    if (previous) {
      for (let t = Date.parse(previous.scientific.timestamp_utc) + 3600000; t < timestamp; t += 3600000) {
        result.push({ ...source, event_id: `gap:${pollutant}:${cell}:${t}`, canonical_index: result.length,
          scientific: { ...source.scientific, timestamp_utc: new Date(t).toISOString().replace(".000Z", "Z"),
            source_sha256: null, value: null, raw_value: null, score: null, pulses: null, valid_cells: 0, total_cells: 0, missing: true },
          artistic_mood: null, chord_name: null, chord_midi: null, melody_midi: null, bass_midi: null,
          melody_note_count: 0, texture_pcm: [], focus_feature: undefined, timeline_gap: true,
          chronological_delta: null, delta_canonical_score: null, variation_kind: "temporal_change" });
      }
    }
    const consecutive = previous && timestamp - Date.parse(previous.scientific.timestamp_utc) === 3600000;
    const delta = consecutive && previous && source.scientific.value !== null && previous.scientific.value !== null
      ? source.scientific.value - previous.scientific.value : null;
    result.push({ ...source, canonical_index: result.length, variation_kind: "temporal_change", delta_canonical_score: null,
      chronological_delta: delta, focus_feature: source.focus_feature ? { ...source.focus_feature,
        chronological_contrast: delta === null ? 0 : Math.min(1, Math.abs(delta) / snapshot.baseline.pollutants[pollutant].audio_max) } : undefined });
    previous = source;
  }
  return result;
}
