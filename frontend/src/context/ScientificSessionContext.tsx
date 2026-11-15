"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { GeosCfStreamAudio } from '@/services/geosCfStreamAudio';
import { prepareScientificSession, scientificCatalog, scientificFrame } from '@/services/scientificSession';
import { sonificationService } from '@/services/sonificationService';
import type { Catalog } from '@/services/geosCfCatalog';
import type { DetailControls, DetailTick } from '@/types/geosCfDetail';
import type { DemoState } from '@/types/notebookDemo';
import type { ScientificFrame, ScientificPlan, ScientificSelection } from '@/types/scientificSession';

const INITIAL: ScientificSelection = { schema_version: 'breathe-session-request-v1', pollutant: 'pm25_rh35', scope: 'global', traversal: 'time',
  start: '', end: '', resolution: 'native', axis: 'horizontal', bands: 8, duration: 300, regions: [] };
const EMPTY: DetailTick = { cursor: 0, step: 0, done: false, peak: 0, limited: 0 };
const MIX: DetailControls = { volume: .55, monitor: 1, music: true, arrangement: 'context', reverse: false, from: 0, to: 7,
  stems: [1, 1, 1, 1], referenceGain: 0, referenceSolo: false, space: .12 };

function useScientificState() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false), [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selection, setSelection] = useState<ScientificSelection>(INITIAL), [plan, setPlan] = useState<ScientificPlan | null>(null);
  const [frame, setFrame] = useState<ScientificFrame | null>(null), [busy, setBusy] = useState(false), [mapBusy, setMapBusy] = useState(false), [error, setError] = useState('');
  const [controls, setControls] = useState<DetailControls>(MIX), [state, setState] = useState<DemoState>('ready'), [tick, setTick] = useState<DetailTick>(EMPTY);
  const [muted, setMuted] = useState([false, false, false, false]), [solo, setSolo] = useState([false, false, false, false]);
  const audioControls = useMemo(() => ({ ...controls, stems: controls.stems.map((gain, i) => muted[i] || solo.some(Boolean) && !solo[i] ? 0 : gain) }), [controls, muted, solo]);
  const [reducedMotion, setReducedMotion] = useState(true);
  const player = useRef<GeosCfStreamAudio | null>(null), pending = useRef<AbortController | null>(null);
  const views = useRef(new Map<number, ScientificFrame>()), currentTick = useRef(tick); currentTick.current = tick;
  const slotIndex = plan ? plan.wire.slots.findIndex(slot => tick.step >= slot.first && tick.step < slot.end) : -1;
  const slot = plan?.wire.slots[slotIndex];
  const available = !!slot && !!frame && frame.timestamp === slot.timestamp && frame.source_sha256 === slot.source_sha256;
  const stop = useCallback(() => { player.current?.stop(); setTick(EMPTY); }, []);
  const exit = useCallback(() => { stop(); setEnabled(false); sonificationService.releaseScientificRenderer(); }, [stop]);

  useEffect(() => {
    const audio = new GeosCfStreamAudio(setTick, setState, setError, undefined,
      () => sonificationService.useScientificRenderer(() => audio.stop()));
    player.current = audio;
    return () => { audio.dispose(); sonificationService.releaseScientificRenderer(); player.current = null; };
  }, []);
  useEffect(() => { player.current?.controls(audioControls); }, [audioControls]);
  useEffect(() => { if (enabled) sonificationService.stop(); }, [enabled]);
  useEffect(() => { if (!pathname.startsWith('/explore') && pathname !== '/studio') stop(); }, [pathname, stop]);
  const refresh = useCallback(async () => {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    stop(); setPlan(null); setFrame(null); views.current.clear(); setBusy(true); setError('');
    try {
      const data = await scientificCatalog(abort.signal);
      if (abort.signal.aborted) return;
      const ready = data.entries.filter(e => e.status === 'ready').sort((a, b) => (a.timestamp_utc ?? '').localeCompare(b.timestamp_utc ?? ''));
      setCatalog(data); setSelection(previous => ({ ...previous, start: ready[0]?.timestamp_utc ?? '', end: ready.at(-1)?.timestamp_utc ?? '' }));
    } catch (cause) { if (!abort.signal.aborted) setError(String(cause)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }, [stop]);
  useEffect(() => { if (enabled && !catalog) void refresh(); }, [enabled, catalog, refresh]);
  useEffect(() => () => pending.current?.abort(), []);
  const updateSelection = useCallback((patch: Partial<ScientificSelection>) => {
    pending.current?.abort(); stop(); setBusy(false); setPlan(null); setFrame(null); views.current.clear(); setError('');
    setSelection(previous => ({ ...previous, ...patch }));
  }, [stop]);
  const prepare = useCallback(async () => {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    stop(); setPlan(null); setFrame(null); views.current.clear(); setBusy(true); setError('');
    try {
      const next = await prepareScientificSession({ ...selection, ...(selection.traversal === 'space' ? { end: selection.start } : {}) }, abort.signal);
      if (abort.signal.aborted) return;
      setPlan(next); setControls(previous => ({ ...previous, from: 0, to: next.wire.lanes - 1 }));
      setTick({ ...EMPTY, step: controls.reverse ? next.wire.steps - 1 : 0 });
    } catch (cause) { if (!abort.signal.aborted) setError(String(cause)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }, [selection, stop, controls.reverse]);
  const horizon = useCallback((index: number) => {
    if (!plan) return 0;
    const target = plan.wire.slots[index];
    return (controls.reverse ? plan.wire.steps - target.first : target.end) / plan.wire.steps * plan.wire.selection.duration;
  }, [plan, controls.reverse]);
  useEffect(() => {
    const abort = new AbortController();
    if (!plan || slotIndex < 0) return;
    setMapBusy(true);
    const load = async (index: number) => {
      const cached = views.current.get(index);
      if (cached) return cached;
      const result = await scientificFrame(plan, index, abort.signal);
      if (abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      views.current.set(index, result);
      while (views.current.size > 3) views.current.delete(views.current.keys().next().value!);
      return result;
    };
    void load(slotIndex).then(result => {
      if (abort.signal.aborted) return;
      setFrame(result); setMapBusy(false);
      const next = slotIndex + (controls.reverse ? -1 : 1);
      if (next >= 0 && next < plan.wire.slots.length) void load(next).catch(() => {});
    }).catch(cause => { if (!abort.signal.aborted) { setError(String(cause)); setMapBusy(false); player.current?.pause(); } });
    return () => abort.abort();
  }, [plan, slotIndex, controls.reverse]);
  useEffect(() => { if (plan && available && !mapBusy) player.current?.horizon(horizon(slotIndex)); }, [plan, available, mapBusy, horizon, slotIndex]);
  const seek = useCallback((step: number) => {
    if (!plan) return;
    const target = Math.max(0, Math.min(plan.wire.steps - 1, Math.round(step)));
    const index = plan.wire.slots.findIndex(s => target >= s.first && target < s.end);
    const timeline = controls.reverse ? plan.wire.steps - 1 - target : target;
    const ready = frame?.timestamp === plan.wire.slots[index].timestamp && !mapBusy;
    player.current?.horizon(ready ? horizon(index) : 0); player.current?.seek(timeline);
    setTick(previous => ({ ...previous, step: target, cursor: timeline / plan.wire.steps * plan.wire.selection.duration, done: false }));
  }, [plan, controls.reverse, frame, mapBusy, horizon]);
  const reverse = useCallback(() => {
    player.current?.stop(); setControls(previous => ({ ...previous, reverse: !previous.reverse }));
    setTick({ ...EMPTY, step: !controls.reverse && plan ? plan.wire.steps - 1 : 0 });
  }, [plan, controls.reverse]);
  const play = useCallback(async (preview = false) => {
    if (!plan || !available || mapBusy) return;
    try {
      setError(''); sonificationService.stop();
      if (!preview && state === 'playing') player.current?.pause();
      else if (!preview && state === 'paused') await player.current?.resume();
      else await player.current?.play(plan.frames, plan.wire.selection.duration, audioControls,
        controls.reverse ? plan.wire.steps - 1 - currentTick.current.step : currentTick.current.step, preview ? 20 : undefined, horizon(slotIndex));
    } catch (cause) { setError(String(cause)); }
  }, [plan, available, mapBusy, state, controls, audioControls, horizon, slotIndex]);
  const reset = useCallback(() => { player.current?.stop(); setTick({ ...EMPTY, step: controls.reverse && plan ? plan.wire.steps - 1 : 0 }); }, [plan, controls.reverse]);
  const value = useMemo(() => ({ enabled, setEnabled, exit, catalog, selection, updateSelection, plan, frame, busy, mapBusy, available, error,
    controls, setControls, muted, setMuted, solo, setSolo, state, refresh, prepare, play, stop: reset, seek, reverse, reducedMotion, setReducedMotion }),
  [enabled, exit, catalog, selection, updateSelection, plan, frame, busy, mapBusy, available, error, controls, muted, solo, state, refresh, prepare, play, reset, seek, reverse, reducedMotion]);
  return { value, tick };
}
type ScientificState = ReturnType<typeof useScientificState>['value'];
const SessionContext = createContext<ScientificState | null>(null);
const ClockContext = createContext<DetailTick>(EMPTY);
export function ScientificSessionProvider({ children }: { children: React.ReactNode }) {
  const { value, tick } = useScientificState();
  return <SessionContext.Provider value={value}><ClockContext.Provider value={tick}>{children}</ClockContext.Provider></SessionContext.Provider>;
}
export function useScientificSession() {
  const value = useContext(SessionContext);
  if (!value) throw Error('ScientificSessionProvider missing');
  return value;
}
export function useScientificClock() { return useContext(ClockContext); }
