"use client";
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useBreathe } from '@/context/BreatheContext';
import { useScientificClock, useScientificSession } from '@/context/ScientificSessionContext';
import { ScientificRaster } from './ScientificRaster';
import { selectContextEvents } from '../../../public/audio/geos-cf-orchestration.mjs';
import { describeScientificStatus } from '@/services/scientificStatus';
import type { ScientificSelection, SessionBounds } from '@/types/scientificSession';
import type { DetailResolution } from '@/types/geosCfDetail';
import type { Pollutant } from '@/types/notebookDemo';
import styles from './scientific.module.css';

const GeoMap = dynamic(() => import('@/components/breathe/GeoMap').then(module => module.GeoMap), { ssr: false });
const POLLUTANTS: [Pollutant, string][] = [['pm25_rh35', 'PM2.5'], ['pm10_rh35', 'PM10'], ['co', 'CO'], ['no2', 'NO₂'], ['o3', 'O₃'], ['so2', 'SO₂']];
const REGIONS: SessionBounds[] = [{ south: 20.5, north: 22, west: 105, east: 106.5 }, { south: 10.25, north: 11.25, west: 106.25, east: 107.25 }];
const fmt = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('vi-VN', { maximumSignificantDigits: 6 });
const clock = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;

export function ScientificEntry() {
  const session = useScientificSession();
  return <div className="b-container" style={{ paddingTop: 16 }}><button className="b-button b-button-primary" onClick={() => session.setEnabled(true)}>Open verified scientific session</button></div>;
}

function ScientificPlayback({ variant }: { variant: 'explore' | 'studio' }) {
  const s = useScientificSession(), tick = useScientificClock();
  const [selected, setSelected] = useState<[number, number][]>([[0, 0], [0, 0]]);
  const [roi, setRoi] = useState(false), [anchor, setAnchor] = useState<[number, number, number] | null>(null);
  const [region, setRegion] = useState(0);
  const { selection: q, plan, controls: c } = s;
  useEffect(() => { setSelected([[0, 0], [0, 0]]); setAnchor(null); setRoi(false); }, [plan]);
  const slotIndex = plan?.wire.slots.findIndex(slot => tick.step >= slot.first && tick.step < slot.end) ?? -1;
  const slot = plan?.wire.slots[slotIndex];
  const maps = s.available && !s.mapBusy ? s.frame?.views ?? [] : [];
  const view = maps[region] ?? maps[0], cell = selected[region] ?? [0, 0];
  const row = Math.min(cell[0], (view?.rows ?? 1) - 1), col = Math.min(cell[1], (view?.cols ?? 1) - 1);
  const laneOffset = plan?.wire.lane_counts.slice(0, region).reduce((a, n) => a + n, 0) ?? 0;
  const localLane = view ? Math.max(0, view.laneBins.findIndex(bin => (q.axis === 'horizontal' ? row : col) >= bin.start && (q.axis === 'horizontal' ? row : col) < bin.end)) : 0;
  const feature = plan ? tick.step * plan.wire.lanes + laneOffset + localLane : 0;
  const context = plan?.frames.contextPlan;
  const window = context?.windows[context.stepWindows?.[tick.step] ?? 0];
  const events = window ? selectContextEvents(window, c.from, c.to) : null;
  const patch = (value: Partial<ScientificSelection>) => s.updateSelection(value);
  const choose = (index: number, r: number, col: number, confirm = false) => {
    setRegion(index); setSelected(previous => previous.map((p, i) => i === index ? [r, col] : p));
    const v = maps[index];
    if (roi && confirm) {
      if (!anchor || anchor[0] !== index) { setAnchor([index, r, col]); return; }
      const [r0, r1] = [Math.min(r, anchor[1]), Math.max(r, anchor[1])], [c0, c1] = [Math.min(col, anchor[2]), Math.max(col, anchor[2])];
      const regionBounds = { south: Math.max(-90, v.rowBins[r1].low), north: Math.min(90, v.rowBins[r0].high), west: Math.max(-180, v.colBins[c0].low), east: Math.min(180, v.colBins[c1].high) };
      patch({ scope: q.scope === 'compare' ? 'compare' : 'region', regions: q.scope === 'compare' ? q.regions.map((p, i) => i === index ? regionBounds : p) : [regionBounds] });
      setRoi(false); setAnchor(null); return;
    }
    if (!roi && q.traversal !== 'time' && plan && slot) {
      const progress = (q.axis === 'horizontal' ? col : r) / (q.axis === 'horizontal' ? v.cols : v.rows);
      s.seek(slot.first + Math.floor(progress * (slot.end - slot.first)));
    }
  };
  const point = () => {
    if (!view) return;
    const lat = 90 - Math.round((view.rowBins[row].start + view.rowBins[row].end - 1) / 2) * .25;
    const lon = -180 + Math.round((view.colBins[col].start + view.colBins[col].end - 1) / 2) * .25;
    patch({ scope: 'region', resolution: 'native', regions: [{ south: Math.max(-90, lat - .01), north: Math.min(90, lat + .01), west: Math.max(-180, lon - .01), east: Math.min(180, lon + .01) }] });
  };
  const download = () => {
    if (!plan) return;
    const blob = new Blob([JSON.stringify({ schema_version: 'breathe-recipe-v1', plan: plan.wire, controls: c, muted: s.muted, solo: s.solo,
      cursor: tick, source_slot: slot, selected_region: region, selected_cell: [row, col], rendered_grid_value: view ? view.grid[row * view.cols + col] : null,
      context_window: window, selected_events: events, isMock: false }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${plan.wire.id}.breathe-recipe.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    {s.busy && <p role="status" className={styles.message}>Preparing verified data and arrangement on the backend…</p>}
    {plan && <div className={styles.grid}><section className={styles.card}><h2>{q.scope === 'compare' ? 'A / B · one clock' : 'Verified data map'}</h2>
      <p className={styles.mono}>{slot?.timestamp ?? '—'} · {plan.wire.unit} · fixed log99 color scale · grey = missing</p>
      <div className={styles.timestamps}>{plan.wire.slots.map((slot, i) => <button className="b-button b-button-secondary" key={slot.timestamp} aria-pressed={i === slotIndex} onClick={() => s.seek(slot.first)}>{slot.timestamp.slice(11, 16)}{slot.missing ? ' · missing' : ''}</button>)}</div>
      {(s.mapBusy || !s.available) && <p role="status">Preparing the correct source frame…</p>}
      {s.available && slot?.missing && <p role="status">No NASA snapshot for this hour. Missing cue; no substituted raster.</p>}
      <div className={styles.maps}>{maps.map((v, i) => { const offset = plan.wire.lane_counts.slice(0, i).reduce((a, n) => a + n, 0), count = plan.wire.lane_counts[i];
        const length = q.axis === 'horizontal' ? v.cols : v.rows;
        const localStep = slot ? Math.min(length - 1, Math.floor((tick.step - slot.first) / (slot.end - slot.first) * length)) : 0;
        return <div key={i}><p>Region {i === 0 ? 'A' : 'B'} · {v.rows} × {v.cols}</p><ScientificRaster view={v} maximum={plan.wire.audio_max} step={localStep} axis={q.axis} selected={selected[i] ?? [0, 0]} choose={(r, col, confirm) => choose(i, r, col, confirm)} sweeping={q.traversal !== 'time' && !s.reducedMotion && c.from < offset + count && c.to >= offset} from={c.from - offset} to={c.to - offset} anchor={anchor?.[0] === i ? [anchor[1], anchor[2]] : null} /></div>; })}</div>
      <div className={styles.actions}><button className="b-button b-button-primary" disabled={!s.available || s.mapBusy} onClick={() => void s.play()}>{s.state === 'playing' ? 'Pause' : s.state === 'paused' ? 'Resume' : 'Play'}</button>
        <button className="b-button b-button-secondary" onClick={s.stop}>Stop</button><button className="b-button b-button-secondary" disabled={!s.available || s.mapBusy} onClick={() => void s.play(true)}>Preview 20 seconds</button>
        <button className="b-button b-button-secondary" onClick={s.reverse}>{c.reverse ? '← Reverse' : '→ Forward'}</button><span>{clock(tick.cursor)} / {clock(q.duration)}</span></div>
      <label>Playback position<input aria-label="Scientific playback position" type="range" min="0" max={plan.wire.steps - 1} value={tick.step} onChange={e => s.seek(+e.target.value)} /></label>
      {tick.buffering && <p role="status">Buffering: audio clock is waiting for the correct map frame.</p>}
      <div className={styles.actions}><button className="b-button b-button-secondary" onClick={() => s.seek(tick.step - 1)}>Previous</button><button className="b-button b-button-secondary" onClick={() => s.seek(tick.step + 1)}>Next</button><button className="b-button b-button-secondary" disabled={!view} aria-pressed={roi} onClick={() => { setRoi(!roi); setAnchor(null); }}>{roi ? anchor ? 'Choose second corner' : 'Choose first corner' : 'Select ROI with two corners'}</button><button className="b-button b-button-secondary" disabled={!view} onClick={point}>Listen to selected native point</button></div>
      <label><input type="checkbox" checked={s.reducedMotion} onChange={e => s.setReducedMotion(e.target.checked)} /> Reduce motion / hide sweep overlay</label>
      <p>Selected grid value: <strong>{fmt(view?.grid[row * view.cols + col])} {plan.wire.unit}</strong>. Band Mean: {fmt(plan.frames.mean[feature])}; P90: {fmt(plan.frames.p90[feature])}; IQR/audio_max: {fmt(plan.frames.spread[feature])}; coverage: {fmt(plan.frames.coverage[feature])}.</p>
      <p>{q.traversal === 'time' ? 'Each UTC slot summarizes all native samples in its bands. No spatial sweep within the timestamp.' : 'Each step is an entire column or row. Spatial derivatives do not cross timestamp boundaries.'}</p>
      <p className={styles.mono}>Source SHA256: {slot?.source_sha256 ?? 'missing'}<br />Calibration: {plan.wire.calibration_version}<br />Mapping: {context?.version}</p>
    </section><aside className={styles.card}><h2>{variant === 'studio' ? 'Arrangement & mixer' : 'Listening preview'}</h2>
      <div className={styles.actions}><button className="b-button b-button-secondary" aria-pressed={!c.music} onClick={() => s.setControls({ ...c, music: false })}>Scientific</button><button className="b-button b-button-secondary" aria-pressed={c.music} onClick={() => s.setControls({ ...c, music: true })}>Context orchestration</button></div>
      <div className={styles.mixer}>{(['volume', 'monitor', 'referenceGain', 'space'] as const).map(key => <label key={key}>{({ volume: 'Volume', monitor: 'Monitor', referenceGain: 'Scientific reference mix', space: 'Short space' })[key]} · {fmt(c[key])}<input type="range" min="0" max={key === 'monitor' ? 2 : key === 'space' ? .3 : 1} step=".01" value={c[key] ?? 0} onChange={e => s.setControls({ ...c, [key]: +e.target.value })} /></label>)}
        {['Field / Mean', 'Highlights / P90 excess', 'Spread / IQR', 'Edges'].map((name, i) => <div key={name}><label>{name}<input aria-label={name} type="range" min="0" max="1" step=".01" value={c.stems[i]} onChange={e => s.setControls({ ...c, stems: c.stems.map((n, j) => j === i ? +e.target.value : n) })} /></label><button aria-pressed={s.muted[i]} onClick={() => s.setMuted(s.muted.map((v, j) => j === i ? !v : v))}>Mute</button> <button aria-pressed={s.solo[i]} onClick={() => s.setSolo(s.solo.map((v, j) => j === i ? !v : v))}>Solo</button></div>)}
        <label>First band<input type="number" min="1" max={plan.wire.lanes} value={c.from + 1} onChange={e => s.setControls({ ...c, from: Math.max(0, Math.min(c.to, +e.target.value - 1)) })} /></label>
        <label>Last band<input type="number" min={c.from + 1} max={plan.wire.lanes} value={c.to + 1} onChange={e => s.setControls({ ...c, to: Math.max(c.from, Math.min(plan.wire.lanes - 1, +e.target.value - 1)) })} /></label>
      </div><p>Solo music with Scientific reference mix = 0. IQR is spatial dispersion, not model uncertainty. A/B pan left/right identifies regions.</p><p>Peak {fmt(tick.peak)} · output guard {tick.limited}</p>
      <h2>Why did the sound change?</h2><p>Mean → soft field; P90−Mean → up to three highlights; IQR → low sustain; gradient/curvature → up to two edges. Derivative domain: {q.traversal === 'time' ? 'UTC hours' : 'angular degrees'}.</p>
      <p>Highlights: {events?.highlights.map(v => `band ${v.lane + 1}, MIDI ${v.note}`).join(' / ') || 'none'}<br />Edges: {events?.edges.map(v => `band ${v.lane + 1}, score ${v.edge.toFixed(3)}`).join(' / ') || 'none'}</p>
      <button className="b-button b-button-secondary" onClick={download}>Download source-bound recipe JSON</button><p className={styles.mono}>Plan: {plan.wire.id}</p>
    </aside></div>}
  </>;
}

function ScientificSelectionPanel({ variant }: { variant: 'explore' | 'studio' }) {
  const s = useScientificSession(), b = useBreathe(), q = s.selection;
  const [picker, setPicker] = useState(false);
  const ready = (s.catalog?.entries ?? []).filter(e => e.status === 'ready').sort((a, b) => (a.timestamp_utc ?? '').localeCompare(b.timestamp_utc ?? ''));
  const notice = describeScientificStatus(s.error, ready.length, Boolean(s.catalog));
  const patch = (value: Partial<ScientificSelection>) => s.updateSelection(value);
  const bounds = (i: number, value: SessionBounds) => {
    const regions = [...q.regions]; regions[i] = value; patch({ regions });
  };
  return <>
    <header className={styles.heading}><div><h1>{variant === 'explore' ? 'Explore verified data' : 'Scientific Sonification Studio'}</h1><p>One scientific session · six pollutants · source-bound playback</p></div>
      <div className={styles.actions}><Link className="b-button b-button-primary" href={variant === 'explore' ? '/studio' : '/explore'}>{variant === 'explore' ? 'Continue to Studio →' : '← Explore data'}</Link>
        <button className="b-button b-button-secondary" onClick={s.exit}>Return to map workspace</button></div></header>
    {notice && (
      <div
        role={notice.kind === 'empty' ? 'status' : 'alert'}
        className={`${styles.notice} ${notice.kind === 'empty' ? '' : styles.noticeError}`.trim()}
      >
        <h2 className={styles.noticeTitle}>{notice.title}</h2>
        <p className={styles.noticeDetail}>{notice.detail}</p>
        <div className={styles.noticeActions}>
          {notice.canRetry && (
            <button
              type="button"
              className="b-button b-button-primary"
              disabled={s.busy}
              onClick={() => void s.refresh()}
            >
              Retry catalog
            </button>
          )}
          <button type="button" className="b-button b-button-secondary" onClick={s.exit}>
            Return to map workspace
          </button>
        </div>
      </div>
    )}
    <section className={styles.card} aria-label="Scientific selection">
      <div className={styles.controls}>
        <label>Pollutant<select value={q.pollutant} onChange={e => patch({ pollutant: e.target.value as Pollutant })}>{POLLUTANTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Scope<select value={q.scope} onChange={e => { const scope = e.target.value as ScientificSelection['scope']; patch({ scope, regions: scope === 'global' ? [] : scope === 'region' ? [q.regions[0] ?? REGIONS[0]] : [q.regions[0] ?? REGIONS[0], q.regions[1] ?? REGIONS[1]] }); }}><option value="global">Whole map</option><option value="region">Region / point</option><option value="compare">Compare A / B</option></select></label>
        <label>Traversal<select value={q.traversal} onChange={e => patch({ traversal: e.target.value as ScientificSelection['traversal'] })}><option value="time">Evolve by timestamp</option><option value="space">Spatial sweep · one timestamp</option><option value="series">Sweep each timestamp</option></select></label>
        <label>From UTC<select value={q.start} onChange={e => patch({ start: e.target.value })}>{ready.map(e => <option key={e.id}>{e.timestamp_utc}</option>)}</select></label>
        <label>To UTC<select disabled={q.traversal === 'space'} value={q.traversal === 'space' ? q.start : q.end} onChange={e => patch({ end: e.target.value })}>{ready.map(e => <option key={e.id}>{e.timestamp_utc}</option>)}</select></label>
        <label>Duration / whole range<select value={q.duration} onChange={e => patch({ duration: +e.target.value as 180 | 300 | 420 })}>{[180, 300, 420].map(n => <option key={n} value={n}>{n / 60} minutes</option>)}</select></label>
        <label>Display grid<select value={q.resolution} onChange={e => patch({ resolution: e.target.value === 'native' ? 'native' : +e.target.value as DetailResolution })}>{[45, 22.5, 11.25, 5, 1, 'native'].map(n => <option key={n} value={n}>{n === 'native' ? 'Native · 0.25°' : `${n}°`}</option>)}</select></label>
        <label>Band / sweep direction<select value={q.axis} onChange={e => patch({ axis: e.target.value as 'horizontal' | 'vertical' })}><option value="horizontal">Horizontal · columns left to right</option><option value="vertical">Vertical · rows top to bottom</option></select></label>
        <label>Bands per region<select value={q.bands} onChange={e => patch({ bands: +e.target.value as 8 | 16 })}><option value="8">Up to 8</option><option value="16">Up to 16</option></select></label>
      </div>
      {q.regions.map((r, i) => <fieldset className={styles.region} key={i}><legend>Region {i === 0 ? 'A' : 'B'} · rectangular bounds</legend><div className={styles.controls}>{(['south', 'north', 'west', 'east'] as const).map(key => <label key={key}>{key}<input type="number" step="0.25" value={r[key]} onChange={e => bounds(i, { ...r, [key]: +e.target.value })} /></label>)}</div></fieldset>)}
      <div className={styles.actions}><span>{ready.length} verified snapshots · manual download only</span><button className="b-button b-button-secondary" disabled={s.busy} onClick={() => void s.refresh()}>Refresh catalog</button>
        <button className="b-button b-button-secondary" onClick={() => setPicker(!picker)}>Choose bounds on existing map</button>
        <button className="b-button b-button-primary" disabled={s.busy || !q.start} onClick={() => void s.prepare()}>Prepare scientific session</button></div>
      {picker && <><p>Use the existing geographic editor, then apply its enclosing rectangle. This scientific session uses rectangular bounds, not a country polygon mask.</p><div className={styles.picker}><GeoMap mode="flat" layer={b.activeLayer} timeIndex={b.timeIndex} center={b.selection.center} zoom={2} polygon={b.selection.polygon} boundaryGeometry={b.selection.boundaryGeometry} onPolygonChange={points => b.setPolygon(points, 'Scientific bounds', 'custom')} onSelectTerritory={b.selectTerritory} tool="rectangle" /></div><button className="b-button b-button-secondary" onClick={() => { patch({ scope: 'region', regions: [b.selection.bounds] }); setPicker(false); }}>Use enclosing map bounds for region A</button></>}
      <p>Mean is cosine-latitude weighted. P90 and IQR use native samples. Zero and missing remain distinct. Model estimates and artistic mapping are not AQI or health thresholds.</p>
    </section>
  </>;
}

/** Selection/GeoMap trees never subscribe to the sample clock. */
export function ScientificWorkspace({ variant }: { variant: 'explore' | 'studio' }) {
  const s = useScientificSession();
  return <div className={`b-container ${styles.workspace}`} data-reduced-motion={s.reducedMotion}>
    <ScientificSelectionPanel variant={variant} />
    <ScientificPlayback variant={variant} />
  </div>;
}
