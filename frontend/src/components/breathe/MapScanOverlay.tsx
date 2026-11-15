"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import { AudioLines, Globe2, Lock, MapPin, Pause, Play, RotateCcw, X } from "lucide-react";
import { getLayerDefinition } from "@/lib/breatheData";
import { loadLayerRaster } from "@/lib/geosCfRaster";
import {
  advanceScanRipples,
  BASE_SWEEP_DURATION_SEC,
  buildScanFieldGrid,
  formatLonReadout,
  MAX_RIPPLES,
  pickColumnVoices,
  RIPPLE_LIFE_SEC,
  type ScanFieldGrid,
  type ScanHitRipple,
} from "@/lib/mapScanEngine";
import { sonificationService } from "@/services/sonificationService";
import type {
  GeoPoint,
  LayerKey,
  ScanScope,
  ScanSpeedMultiplier,
  SonificationMapping,
} from "@/types/breathe";

export interface MapScanOverlayProps {
  map: maplibregl.Map | null;
  mapReady: boolean;
  containerSize: { width: number; height: number };
  viewTick: number;
  layer: LayerKey;
  timeIndex: number;
  polygon: GeoPoint[];
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  mapping: SonificationMapping;
  isLightBasemap: boolean;
  hideTrigger?: boolean;
  onActiveChange?: (active: boolean) => void;
}

type ScanStatus = "idle" | "playing" | "paused";

interface ScanReadout {
  lonLabel: string;
  peakLabel: string;
  loading: boolean;
  progressPct: number;
}

const SPEED_OPTIONS: ScanSpeedMultiplier[] = [0.5, 1, 2];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Renders the 2D flat-map West-to-East vertical playhead scanline, live air-quality ripple effects,
 * and compact scientific HUD dock synchronized with Web Audio polyphonic chimes.
 */
export function MapScanOverlay({
  map,
  mapReady,
  containerSize,
  viewTick,
  layer,
  timeIndex,
  polygon,
  boundaryGeometry,
  mapping,
  isLightBasemap,
  hideTrigger = false,
  onActiveChange,
}: MapScanOverlayProps) {
  const layerDef = getLayerDefinition(layer);
  const hasRegion = Boolean(boundaryGeometry || polygon.length >= 3);

  const [status, setStatus] = useState<ScanStatus>("idle");
  const [scope, setScope] = useState<ScanScope>("viewport");
  const [speed, setSpeed] = useState<ScanSpeedMultiplier>(1);
  const [readout, setReadout] = useState<ScanReadout>({
    lonLabel: "—",
    peakLabel: "Sampling…",
    loading: false,
    progressPct: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<ScanFieldGrid | null>(null);
  const progressRef = useRef(0);
  const lastColRef = useRef(-1);
  const ripplesRef = useRef<ScanHitRipple[]>([]);
  const nextRippleIdRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameMsRef = useRef(0);

  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const isLightRef = useRef(isLightBasemap);
  isLightRef.current = isLightBasemap;
  const statusRef = useRef(status);
  statusRef.current = status;
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  const effectiveScope: ScanScope = scope === "region" && hasRegion ? "region" : "viewport";

  useEffect(() => {
    if (scope === "region" && !hasRegion) {
      setScope("viewport");
    }
  }, [scope, hasRegion]);

  // Auto-stop gracefully if switching onto an unavailable layer (e.g. AOD placeholder)
  useEffect(() => {
    if (!layerDef.available && status !== "idle") {
      sonificationService.endSpatialScan();
      ripplesRef.current = [];
      progressRef.current = 0;
      lastColRef.current = -1;
      onActiveChangeRef.current?.(false);
      setStatus("idle");
    }
  }, [layerDef.available, status]);

  useEffect(() => {
    onActiveChangeRef.current?.(status !== "idle");
  }, [status]);

  // Cleanup on unmount (e.g. leaving 2D mode back to 3D globe or navigating routes)
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      sonificationService.endSpatialScan();
      onActiveChangeRef.current?.(false);
    };
  }, []);

  // Build / rebuild 96 x 16 spatial scan grid whenever map view, pollutant layer, UTC slot, or scope changes
  useEffect(() => {
    if (status === "idle" || !map || !mapReady || !layerDef.available) {
      gridRef.current = null;
      return;
    }

    let cancelled = false;
    setReadout((prev) => ({ ...prev, loading: !gridRef.current }));

    void loadLayerRaster(layer, timeIndex).then((raster) => {
      if (cancelled || !raster || !map) return;
      const grid = buildScanFieldGrid({
        map,
        width: containerSize.width,
        height: containerSize.height,
        raster,
        layer: layerDef,
        scope: effectiveScope,
        boundaryGeometry,
        polygon,
      });
      gridRef.current = grid;

      const curCol = Math.min(
        grid.cols - 1,
        Math.max(0, Math.floor(progressRef.current * (grid.cols - 1)))
      );
      const summary = grid.summaries[curCol];
      if (summary) {
        setReadout({
          lonLabel: formatLonReadout(summary.centerLon),
          peakLabel:
            summary.peakValue !== null && summary.peakNorm >= 0.14
              ? `${summary.peakValue.toFixed(1)} ${grid.unit}`
              : "Clear air",
          loading: false,
          progressPct: Math.round(progressRef.current * 100),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    status,
    map,
    mapReady,
    layer,
    layerDef,
    timeIndex,
    effectiveScope,
    viewTick,
    containerSize.width,
    containerSize.height,
    boundaryGeometry,
    polygon,
  ]);

  const drawCanvasFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = containerSize.width;
    const height = containerSize.height;
    if (width < 2 || height < 2) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (statusRef.current === "idle") {
      ctx.restore();
      return;
    }

    const light = isLightRef.current;
    const grid = gridRef.current;
    const p = progressRef.current;
    const yTop = Math.max(18, height * 0.08);
    const yBottom = Math.max(yTop + 20, height * 0.91);
    const xStart = grid?.summaries[0]?.x ?? Math.max(8, width * 0.015);
    const xEnd = grid?.summaries[grid.cols - 1]?.x ?? width - xStart;
    const beamX = xStart + p * (xEnd - xStart);

    // 1. Subtle trailing sage/pine wake behind playhead
    const wakeW = 36;
    const wakeGrad = ctx.createLinearGradient(beamX - wakeW, 0, beamX, 0);
    if (light) {
      wakeGrad.addColorStop(0, "rgba(35, 105, 95, 0)");
      wakeGrad.addColorStop(1, "rgba(35, 105, 95, 0.14)");
    } else {
      wakeGrad.addColorStop(0, "rgba(191, 212, 182, 0)");
      wakeGrad.addColorStop(1, "rgba(191, 212, 182, 0.2)");
    }
    ctx.fillStyle = wakeGrad;
    ctx.fillRect(Math.max(0, beamX - wakeW), yTop, wakeW, yBottom - yTop);

    // 2. Concentric collision ripples spawned at active air-quality hits
    const ripples = ripplesRef.current;
    for (let i = 0; i < ripples.length; i += 1) {
      const rp = ripples[i];
      const frac = Math.min(1, rp.age / rp.maxLife);
      const eased = 1 - Math.pow(1 - frac, 2.3);
      const radius = rp.baseRadius + (rp.maxRadius - rp.baseRadius) * eased;
      const alpha = Math.max(0, (1 - frac) * (0.58 + rp.norm * 0.36));
      const [rr, rg, rb] = rp.rgb;

      if (frac < 0.34) {
        const coreAlpha = (1 - frac / 0.34) * (0.45 + rp.norm * 0.3);
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 4 + rp.norm * 4.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rr}, ${rg}, ${rb}, ${coreAlpha.toFixed(3)})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(rp.x, rp.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = rp.isAccent ? 2.1 : 1.35;
      ctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, ${alpha.toFixed(3)})`;
      ctx.stroke();

      if (rp.isAccent && radius > 7) {
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, radius * 0.54, 0, Math.PI * 2);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, ${(alpha * 0.62).toFixed(3)})`;
        ctx.stroke();
      }
    }

    // 3. Live vertical concentration filament hugging the moving scanline
    if (grid && grid.columns.length > 0) {
      const floatCol = p * (grid.cols - 1);
      const colLo = Math.min(grid.cols - 1, Math.max(0, Math.floor(floatCol)));
      const colHi = Math.min(grid.cols - 1, colLo + 1);
      const blend = floatCol - colLo;
      const cellsLo = grid.columns[colLo];
      const cellsHi = grid.columns[colHi];
      const gateThreshold = Math.max(0.14, 0.27 - mappingRef.current.density * 0.13);

      ctx.beginPath();
      for (let row = 0; row < grid.rows; row += 1) {
        const c0 = cellsLo[row];
        const c1 = cellsHi[row];
        const norm = c0.inScope || c1.inScope ? c0.norm * (1 - blend) + c1.norm * blend : 0;
        const active = (c0.inScope || c1.inScope) && norm >= gateThreshold * 0.72;
        const offsetX = active ? 2 + norm * 22 : 0;
        const px = beamX + offsetX;
        const py = c0.y;
        if (row === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = light ? "rgba(20, 77, 70, 0.7)" : "rgba(213, 227, 203, 0.84)";
      ctx.lineWidth = 1.65;
      ctx.stroke();

      // Active row collision ticks right across the vertical beam
      for (let row = 0; row < grid.rows; row += 1) {
        const cell = cellsLo[row];
        if (!cell.inScope || cell.norm < gateThreshold) continue;
        const [cr, cg, cb] = cell.rgb;
        const tickHalf = 4 + cell.norm * 8.5;
        ctx.beginPath();
        ctx.moveTo(beamX - tickHalf * 0.45, cell.y);
        ctx.lineTo(beamX + tickHalf, cell.y);
        ctx.lineWidth = cell.norm >= 0.56 ? 2.4 : 1.5;
        ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${(0.55 + cell.norm * 0.4).toFixed(3)})`;
        ctx.stroke();
      }
    }

    // 4. Primary vertical playhead beam + soft edge halo
    ctx.beginPath();
    ctx.moveTo(beamX, yTop);
    ctx.lineTo(beamX, yBottom);
    ctx.lineWidth = 4;
    ctx.strokeStyle = light ? "rgba(255, 254, 250, 0.76)" : "rgba(12, 20, 18, 0.72)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(beamX, yTop);
    ctx.lineTo(beamX, yBottom);
    ctx.lineWidth = 1.65;
    ctx.strokeStyle = light ? "#144d46" : "#f2f0e8";
    ctx.stroke();

    ctx.restore();
  }, [containerSize.width, containerSize.height]);

  // 60fps animation & Web Audio column collision loop
  useEffect(() => {
    if (status !== "playing") {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      drawCanvasFrame();
      return;
    }

    const reduced = prefersReducedMotion();
    lastFrameMsRef.current = performance.now();

    const tick = (nowMs: number) => {
      if (statusRef.current !== "playing") return;
      const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - lastFrameMsRef.current) / 1000));
      lastFrameMsRef.current = nowMs;

      const durationSec = BASE_SWEEP_DURATION_SEC / speedRef.current;
      let nextProgress = progressRef.current + dtSec / durationSec;
      let looped = false;
      if (nextProgress >= 1) {
        nextProgress %= 1;
        looped = true;
      }
      progressRef.current = nextProgress;

      ripplesRef.current = advanceScanRipples(ripplesRef.current, dtSec);

      const grid = gridRef.current;
      if (grid && grid.columns.length > 0) {
        const colIdx = Math.min(
          grid.cols - 1,
          Math.max(0, Math.floor(nextProgress * grid.cols))
        );
        if (looped || colIdx !== lastColRef.current) {
          const prevIdx = colIdx > 0 ? colIdx - 1 : undefined;
          lastColRef.current = colIdx;

          const colCells = grid.columns[colIdx];
          const prevCells = prevIdx !== undefined ? grid.columns[prevIdx] : undefined;
          const voices = pickColumnVoices(colCells, prevCells, mappingRef.current, 4);

          if (voices.length > 0) {
            const pan = (colIdx / Math.max(1, grid.cols - 1)) * 2 - 1;
            sonificationService.triggerSpatialScanColumn(voices, mappingRef.current, pan);

            if (!reduced) {
              const created: ScanHitRipple[] = voices.map((v) => ({
                id: nextRippleIdRef.current++,
                x: v.x,
                y: v.y,
                rgb: v.rgb,
                norm: v.norm,
                isAccent: v.isAccent,
                age: 0,
                maxLife: RIPPLE_LIFE_SEC,
                baseRadius: v.isAccent ? 4 : 3,
                maxRadius: (v.isAccent ? 28 : 20) + v.norm * 16,
              }));
              const merged = [...ripplesRef.current, ...created];
              ripplesRef.current =
                merged.length > MAX_RIPPLES ? merged.slice(merged.length - MAX_RIPPLES) : merged;
            }
          }

          const summary = grid.summaries[colIdx];
          if (summary) {
            setReadout({
              lonLabel: formatLonReadout(summary.centerLon),
              peakLabel:
                summary.peakValue !== null && summary.peakNorm >= 0.14
                  ? `${summary.peakValue.toFixed(1)} ${grid.unit}`
                  : "Clear air",
              loading: false,
              progressPct: Math.round(nextProgress * 100),
            });
          }
        }
      }

      drawCanvasFrame();
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [status, drawCanvasFrame]);

  // Keep canvas synced during paused resizes
  useEffect(() => {
    if (status === "paused" || status === "idle") {
      drawCanvasFrame();
    }
  }, [status, drawCanvasFrame, containerSize.width, containerSize.height]);

  const handleStartScan = () => {
    if (!layerDef.available) return;
    sonificationService.beginSpatialScan();
    progressRef.current = 0;
    lastColRef.current = -1;
    ripplesRef.current = [];
    onActiveChangeRef.current?.(true);
    setStatus("playing");
  };

  const handleTogglePlay = () => {
    if (status === "playing") {
      sonificationService.endSpatialScan();
      setStatus("paused");
    } else {
      sonificationService.beginSpatialScan();
      setStatus("playing");
    }
  };

  const handleRestart = () => {
    sonificationService.beginSpatialScan();
    progressRef.current = 0;
    lastColRef.current = -1;
    ripplesRef.current = [];
    setStatus("playing");
  };

  const handleClose = () => {
    sonificationService.endSpatialScan();
    progressRef.current = 0;
    lastColRef.current = -1;
    ripplesRef.current = [];
    onActiveChangeRef.current?.(false);
    setStatus("idle");
  };

  const handleCycleSpeed = () => {
    setSpeed((cur) => {
      const idx = SPEED_OPTIONS.indexOf(cur);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
  };

  const triggerTitle = useMemo(() => {
    if (!layerDef.available) {
      return "Select PM2.5, NO2, SO2, CO, or O3 to launch the 2D scanline sonifier";
    }
    return `Sweep vertical audio beam across ${layerDef.short} from West to East`;
  }, [layerDef.available, layerDef.short]);

  return (
    <>
      <canvas ref={canvasRef} className="b-scan-canvas" aria-hidden="true" />

      {!hideTrigger && (
        <div className="b-scan-dock-wrap">
          {status === "idle" ? (
            <button
              type="button"
              className="b-scan-trigger-btn"
              onClick={handleStartScan}
              disabled={!layerDef.available}
              title={triggerTitle}
            >
              <AudioLines size={14} aria-hidden="true" />
              <span>2D Scan · {layerDef.short}</span>
            </button>
          ) : (
            <div className="b-scan-bar" role="region" aria-label="2D Air Quality Scan Sonifier">
              <button
                type="button"
                className="b-scan-play-btn"
                onClick={handleTogglePlay}
                aria-label={status === "playing" ? "Pause 2D scan" : "Resume 2D scan"}
                title={status === "playing" ? "Pause sweep" : "Resume sweep"}
              >
                {status === "playing" ? <Pause size={13} /> : <Play size={13} />}
              </button>

              <button
                type="button"
                className="b-scan-icon-btn"
                onClick={handleRestart}
                aria-label="Restart scan from West edge"
                title="Restart from West edge"
              >
                <RotateCcw size={12} />
              </button>

              <div className="b-scan-pill-group" role="group" aria-label="Scan sampling scope">
                <button
                  type="button"
                  className={effectiveScope === "viewport" ? "is-active" : undefined}
                  onClick={() => setScope("viewport")}
                  title="Scan all visible air quality across 2D viewport"
                >
                  <Globe2 size={11} /> Viewport
                </button>
                <button
                  type="button"
                  className={effectiveScope === "region" ? "is-active" : undefined}
                  onClick={() => setScope("region")}
                  disabled={!hasRegion}
                  title={
                    hasRegion
                      ? "Filter scan triggers strictly inside active territory or drawn border"
                      : "Select a country or draw a region to enable Region filter"
                  }
                >
                  <MapPin size={11} /> Region
                </button>
              </div>

              <button
                type="button"
                className="b-scan-speed-btn b-tabular"
                onClick={handleCycleSpeed}
                title="Cycle sweep speed (0.5x / 1x / 2x)"
                aria-label={`Sweep speed ${speed}x`}
              >
                {speed}×
              </button>

              <div className="b-scan-readout b-tabular" aria-live="off">
                <strong>{readout.loading ? "Sampling…" : readout.peakLabel}</strong>
                <span>{readout.lonLabel}</span>
              </div>

              <span
                className="b-scan-lock-badge"
                title="2D viewport locked during scan — close scan to pan or zoom"
              >
                <Lock size={10} aria-hidden="true" />
                <span>2D Locked</span>
              </span>

              <button
                type="button"
                className="b-scan-icon-btn"
                onClick={handleClose}
                aria-label="Close 2D scan sonifier and unlock map"
                title="Stop scan and unlock 2D map"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
