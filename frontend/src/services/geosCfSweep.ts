import type { DemoAudioConfig, FrozenEvent } from "@/types/notebookDemo";
import { FOCUS_STEMS, renderFocusPlan, roundEven } from "./notebookDemoAudio";
import type { AudioTrack } from "./notebookDemoAudio";

export type SweepAxis = "horizontal" | "vertical";
export interface SweepFrame {
  id: string;
  axis: SweepAxis;
  index: number;
  cells: FrozenEvent[];
}
export const SWEEP_MAPPING_VERSION = "spatial-sweep-polyphonic-v1";
// Fixed across axes, frames, mute/solo and archive timestamps. No per-frame normalization.
export const SWEEP_MIX_GAIN = 0.25;
const ROW_MIDI = [84, 76, 67, 57]; // North to south: high to low.
const COL_MIDI = [48, 52, 55, 59, 62, 65, 69, 74]; // West to east: low to high, with stereo position.

export function cellPosition(event: FrozenEvent) {
  const { lat, lon } = event.scientific.bounds;
  const row = (90 - lat[1]) / 45,
    col = (lon[0] + 180) / 45;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row > 3 ||
    col < 0 ||
    col > 7 ||
    lat[1] - lat[0] !== 45 ||
    lon[1] - lon[0] !== 45
  )
    throw new Error("Sweep requires the verified 4 × 8 grid");
  return { row, col };
}

export function sweepVoice(event: FrozenEvent, axis: SweepAxis) {
  const { row, col } = cellPosition(event);
  const midi = axis === "horizontal" ? ROW_MIDI[row] : COL_MIDI[col];
  return {
    lane: axis === "horizontal" ? `row${row}` : `col${col}`,
    midi,
    hz: 440 * 2 ** ((midi - 69) / 12),
    pan: (((col + 0.5) / 8) * 2 - 1) * 0.8,
    label: axis === "horizontal" ? `Hàng ${row + 1} · Bắc → Nam` : `Cột ${col + 1} · Tây → Đông`,
  };
}

/** Group existing references. Reverse changes frame order, never voice identity or data. */
export function buildSweepFrames(
  events: readonly FrozenEvent[],
  axis: SweepAxis,
  reverse = false
): SweepFrame[] {
  if (events.length !== 32) throw new Error("Sweep requires all 32 cells");
  const seen = new Set<string>(),
    source = events[0].scientific;
  const frames: SweepFrame[] = Array.from(
    { length: axis === "horizontal" ? 8 : 4 },
    (_, index) => ({
      id: `${source.source_sha256}:${source.timestamp_utc}:${source.pollutant}:${axis}:${index}:${SWEEP_MAPPING_VERSION}`,
      axis,
      index,
      cells: [],
    })
  );
  for (const event of events) {
    const { row, col } = cellPosition(event),
      key = `${row}:${col}`;
    if (
      seen.has(key) ||
      event.scientific.source_sha256 !== source.source_sha256 ||
      event.scientific.timestamp_utc !== source.timestamp_utc ||
      event.scientific.pollutant !== source.pollutant
    )
      throw new Error("Duplicate cells or mixed snapshot in sweep");
    seen.add(key);
    frames[axis === "horizontal" ? col : row].cells.push(event);
  }
  frames.forEach((frame) =>
    frame.cells.sort((a, b) => {
      const x = cellPosition(a),
        y = cellPosition(b);
      return axis === "horizontal" ? x.row - y.row : x.col - y.col;
    })
  );
  return reverse ? frames.reverse() : frames;
}

export function renderSweepPlan(frames: readonly SweepFrame[], cfg: DemoAudioConfig) {
  if (!frames.length || new Set(frames.map((f) => f.axis)).size !== 1)
    throw new Error("Invalid sweep frames");
  const perBar = roundEven(cfg.sample_rate * cfg.seconds_per_bar),
    length = frames.length * perBar;
  const tracks = new Map<string, AudioTrack>();
  for (const [step, frame] of frames.entries()) {
    const expected = frame.axis === "horizontal" ? 4 : 8;
    if (
      frame.cells.length !== expected ||
      new Set(frame.cells.map((e) => sweepVoice(e, frame.axis).lane)).size !== expected
    )
      throw new Error("Incomplete or duplicate sweep voices");
    for (const event of frame.cells) {
      const voice = sweepVoice(event, frame.axis);
      // Preserve pulse counts/onsets. Register and missing-cue pitch belong to the explicit B mapping.
      const spatial = renderFocusPlan(
        [event],
        { ...cfg, pulse_hz: voice.hz, missing_hz: voice.hz * 2 ** (1 / 12) },
        voice
      );
      for (const name of ["carrier", ...FOCUS_STEMS]) {
        const key = `${voice.lane}:${name}`;
        if (!tracks.has(key))
          tracks.set(key, {
            name,
            lane: voice.lane,
            pcm: { left: new Float32Array(length), right: new Float32Array(length) },
          });
        const target = tracks.get(key)!.pcm;
        const pcm =
          name === "carrier"
            ? spatial.carrier
            : spatial.stems[name as (typeof FOCUS_STEMS)[number]];
        const left = name === "carrier" ? Math.cos(((voice.pan + 1) * Math.PI) / 4) : 1;
        const right = name === "carrier" ? Math.sin(((voice.pan + 1) * Math.PI) / 4) : 1;
        for (let i = 0; i < perBar; i++) {
          target.left[step * perBar + i] = pcm.left[i] * SWEEP_MIX_GAIN * left;
          target.right[step * perBar + i] = pcm.right[i] * SWEEP_MIX_GAIN * right;
        }
      }
    }
  }
  let peak = 0;
  const rendered = [...tracks.values()];
  for (let i = 0; i < length; i++)
    for (const side of ["left", "right"] as const)
      peak = Math.max(
        peak,
        rendered.reduce((sum, track) => sum + Math.abs(track.pcm[side][i]), 0)
      );
  if (!Number.isFinite(peak) || peak >= 0.93) throw new Error("Sweep exceeds fixed headroom");
  return { tracks: rendered, peak, mapping_version: SWEEP_MAPPING_VERSION };
}
