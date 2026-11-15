"use client";
import { useEffect, useRef } from 'react';
import type { ScientificMapView } from '@/types/scientificSession';
import styles from './scientific.module.css';

/** Promoted native demo renderer: EPSG:4326 canvas, never supplied as a Mercator ImageSource. */
export function ScientificRaster({ view, maximum, step, axis, selected, choose, sweeping, from, to, anchor }: {
  view: ScientificMapView; maximum: number; step: number; axis: 'horizontal' | 'vertical'; selected: [number, number];
  choose: (row: number, col: number, confirm?: boolean) => void; sweeping: boolean; from: number; to: number; anchor: [number, number] | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context) return;
    const image = context.createImageData(view.cols, view.rows);
    for (let i = 0; i < view.grid.length; i++) {
      const value = view.grid[i], t = Math.log1p(99 * Math.max(0, Math.min(1, value / maximum))) / Math.log(100);
      image.data.set(Number.isFinite(value) ? [Math.round(30 + 190 * t), Math.round(40 + 200 * t), Math.round(90 - 40 * t), 255] : [90, 90, 90, 255], i * 4);
    }
    context.putImageData(image, 0, 0);
  }, [view, maximum]);
  const horizontal = axis === 'horizontal';
  const first = view.laneBins[Math.max(0, Math.min(from, view.laneBins.length - 1))]?.start ?? 0;
  const last = view.laneBins[Math.max(0, Math.min(to, view.laneBins.length - 1))]?.end ?? (horizontal ? view.rows : view.cols);
  return <div className={styles.raster} style={{ aspectRatio: `${view.cols}/${view.rows}` }}>
    <canvas ref={canvas} width={view.cols} height={view.rows} role="img" aria-label="Verified native data map. Arrow keys select a cell; Enter confirms ROI corner." tabIndex={0}
      onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); choose(Math.min(view.rows - 1, Math.floor((e.clientY - rect.top) / rect.height * view.rows)), Math.min(view.cols - 1, Math.floor((e.clientX - rect.left) / rect.width * view.cols)), true); }}
      onKeyDown={e => { let [r, c] = selected;
        if (e.key === 'ArrowLeft') c--; else if (e.key === 'ArrowRight') c++; else if (e.key === 'ArrowUp') r--; else if (e.key === 'ArrowDown') r++; else if (!['Enter', ' '].includes(e.key)) return;
        e.preventDefault(); choose(Math.max(0, Math.min(view.rows - 1, r)), Math.max(0, Math.min(view.cols - 1, c)), ['Enter', ' '].includes(e.key)); }} />
    <svg viewBox={`0 0 ${view.cols} ${view.rows}`} preserveAspectRatio="none" aria-hidden="true">
      {sweeping && <rect x={horizontal ? step : first} y={horizontal ? first : step} width={horizontal ? 1 : last - first} height={horizontal ? last - first : 1} fill="#d2ff96" fillOpacity=".65" />}
      <rect x={selected[1]} y={selected[0]} width="1" height="1" fill="none" stroke="white" strokeWidth={Math.max(.12, view.cols / 800)} />
      {anchor && <circle cx={anchor[1] + .5} cy={anchor[0] + .5} r={Math.max(.5, view.cols / 150)} fill="white" />}
    </svg>
  </div>;
}
