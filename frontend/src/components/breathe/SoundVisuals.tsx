"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useAudioClockMeta, useSonification } from "@/hooks/useSonification";
import {
  buildStaticWaveform,
  computeScheduleMatrix,
  sonificationService,
} from "@/services/sonificationService";
import type { AudioCompositionSpec } from "@/types/breathe";

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function Waveform({
  compact = false,
  spec,
  seed: _seed,
}: {
  compact?: boolean;
  spec?: AudioCompositionSpec;
  seed?: number;
}) {
  void _seed;
  const meta = useAudioClockMeta();
  const count = compact ? 34 : 52;
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);

  const staticBars = useMemo(() => {
    if (spec) {
      return buildStaticWaveform(spec, count).map((v) => Math.max(0.14, Math.abs(v)));
    }
    const matrix = meta.scheduleMatrix;
    return Array.from({ length: count }, (_, i) => {
      const stepIdx = Math.min(15, Math.floor((i / Math.max(1, count)) * 16));
      const amp =
        (matrix[0]?.[stepIdx] ?? 0.25) * 0.45 +
        (matrix[1]?.[stepIdx] ?? 0.25) * 0.35 +
        (matrix[2]?.[stepIdx] ?? 0.2) * 0.25;
      return Math.max(0.14, Math.min(1, amp));
    });
  }, [spec, count, meta.scheduleMatrix]);

  useEffect(() => {
    const applyStatic = () => {
      const wave = spec ? staticBars : sonificationService.getVisualFrame().waveformSamples;
      for (let i = 0; i < count; i += 1) {
        const el = barRefs.current[i];
        if (!el) continue;
        const amp = Math.max(0.14, Math.abs(wave[i] ?? staticBars[i] ?? 0.2));
        el.style.height = `${Math.round(16 + Math.min(1, amp) * 80)}%`;
        el.style.opacity = String(Number((0.46 + amp * 0.44).toFixed(4)));
        el.classList.remove("is-played");
      }
    };

    applyStatic();
    let wasPlaying = false;

    return sonificationService.onVisualTick((frame) => {
      const playingThis =
        frame.playbackState === "playing" && (!spec || frame.activeCompositionId === spec.id);
      if (!playingThis) {
        if (wasPlaying) {
          wasPlaying = false;
          applyStatic();
        }
        return;
      }

      wasPlaying = true;
      for (let i = 0; i < count; i += 1) {
        const el = barRefs.current[i];
        if (!el) continue;
        const amp = Math.max(0.14, Math.abs(frame.waveformSamples[i] ?? 0));
        const pct = i / Math.max(1, count - 1);
        el.style.height = `${Math.round(16 + Math.min(1, amp) * 80)}%`;
        el.style.opacity = String(Number((0.58 + amp * 0.42).toFixed(4)));
        el.classList.toggle("is-played", pct <= frame.progress);
      }
    });
  }, [count, spec, staticBars]);

  return (
    <div
      className={compact ? "b-waveform b-waveform-compact" : "b-waveform"}
      role="img"
      aria-label="Real-time atmospheric waveform visualizer"
    >
      {staticBars.map((amp, i) => {
        const heightPct = Math.round(16 + Math.min(1, amp) * 80);
        const opacity = Number((0.46 + amp * 0.44).toFixed(4));
        return (
          <span
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            style={{
              height: `${heightPct}%`,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}

function drawSpectrogramCanvas(
  canvas: HTMLCanvasElement,
  history: number[][],
  compact: boolean
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#18302f";
  ctx.fillRect(0, 0, w, h);

  const cols = history.length;
  const bins = history[0]?.length ?? 20;
  const cellW = w / cols;
  const cellH = h / bins;

  for (let x = 0; x < cols; x += 1) {
    const col = history[x];
    for (let b = 0; b < bins; b += 1) {
      const val = col[b] ?? 0;
      const y = h - (b + 1) * cellH;
      const r = Math.round(28 + val * 185);
      const g = Math.round(62 + val * 138);
      const bl = Math.round(58 + val * 98);
      const a = Math.max(0.12, Math.min(0.95, val * 0.92));
      ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${a})`;
      ctx.fillRect(x * cellW, y, cellW + 0.6, cellH + 0.4);
    }
  }

  if (!compact) {
    ctx.fillStyle = "rgba(246, 245, 240, 0.56)";
    ctx.font = "500 10px Inter, sans-serif";
    ctx.fillText("2.4 kHz", 8, 14);
    ctx.fillText("800 Hz", 8, h * 0.52);
    ctx.fillText("180 Hz", 8, h - 8);
  }
}

export function Spectrogram({
  spec,
  compact = false,
}: {
  spec?: AudioCompositionSpec;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meta = useAudioClockMeta();

  const staticSpectrum = useMemo(() => {
    const matrix = spec ? computeScheduleMatrix(spec) : meta.scheduleMatrix;
    const cols = 48;
    const bins = 20;
    const result: number[][] = [];
    for (let x = 0; x < cols; x += 1) {
      const mIdx = Math.min(15, Math.floor((x / cols) * 16));
      const base = matrix[0]?.[mIdx] ?? 0.3;
      const mid = matrix[1]?.[mIdx] ?? 0.3;
      const high = matrix[2]?.[mIdx] ?? 0.2;
      const col: number[] = [];
      for (let b = 0; b < bins; b += 1) {
        const normB = b / (bins - 1);
        const energy =
          base * Math.exp(-Math.pow((normB - 0.18) * 3.8, 2)) +
          mid * 0.8 * Math.exp(-Math.pow((normB - 0.52) * 3.4, 2)) +
          high * 0.72 * Math.exp(-Math.pow((normB - 0.84) * 3.6, 2));
        col.push(Math.max(0.05, Math.min(1, energy)));
      }
      result.push(col);
    }
    return result;
  }, [spec, meta.scheduleMatrix]);

  const scrollHistoryRef = useRef<number[][]>(staticSpectrum.slice());

  useEffect(() => {
    scrollHistoryRef.current = staticSpectrum.slice();
    const initialCanvas = canvasRef.current;
    if (initialCanvas) {
      drawSpectrogramCanvas(initialCanvas, scrollHistoryRef.current, compact);
    }

    let wasPlaying = false;
    return sonificationService.onVisualTick((frame) => {
      const playingThis =
        frame.playbackState === "playing" && (!spec || frame.activeCompositionId === spec.id);
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (!playingThis) {
        if (wasPlaying) {
          wasPlaying = false;
          scrollHistoryRef.current = staticSpectrum.slice();
          drawSpectrogramCanvas(canvas, scrollHistoryRef.current, compact);
        }
        return;
      }

      if (frame.spectrumBins.length > 0) {
        wasPlaying = true;
        const sampled: number[] = [];
        for (let b = 0; b < 20; b += 1) {
          const idx = Math.floor((b / 20) * Math.min(28, frame.spectrumBins.length));
          sampled.push(frame.spectrumBins[idx] ?? 0);
        }
        const history = scrollHistoryRef.current;
        if (history.length >= 48) {
          history.shift();
        }
        history.push(sampled);
        drawSpectrogramCanvas(canvas, history, compact);
      }
    });
  }, [spec, staticSpectrum, compact]);

  return (
    <div
      className="b-spectrogram b-spec-canvas-host"
      role="img"
      aria-label="Frequency spectrum visualization driven by atmospheric Web Audio FFT"
    >
      <canvas
        ref={canvasRef}
        width={compact ? 260 : 480}
        height={compact ? 30 : 98}
        className="b-spec-canvas"
      />
    </div>
  );
}

export function RhythmGrid({
  rows = ["PM2.5", "Timbre", "ΔRate"],
  spec,
  interactive = true,
}: {
  rows?: string[];
  spec?: AudioCompositionSpec;
  interactive?: boolean;
}) {
  const { clock, seekStep } = useSonification();
  const isPlayingHere =
    clock.playbackState === "playing" &&
    (!spec || clock.activeCompositionId === spec.id);

  const matrix = useMemo(() => {
    if (spec) return computeScheduleMatrix(spec);
    return clock.scheduleMatrix;
  }, [spec, clock.scheduleMatrix]);

  const stepLabels = ["00:30", "03:30", "06:30", "09:30", "12:30", "15:30", "18:30", "21:30"];

  return (
    <div className="b-rhythm-grid" role="grid" aria-label="16-step atmospheric rhythm matrix">
      {rows.map((row, rowIndex) => (
        <div key={row} className="b-rhythm-row">
          <small>{row}</small>
          <div className="b-rhythm-cells">
            {Array.from({ length: 16 }, (_, stepIdx) => {
              const strength = matrix[rowIndex]?.[stepIdx] ?? 0.25;
              const isCurrentStep = isPlayingHere && clock.currentStep === stepIdx;
              const slotName = stepLabels[Math.floor(stepIdx / 2)] ?? "00:30";
              return (
                <button
                  key={stepIdx}
                  type="button"
                  disabled={!interactive}
                  onClick={() => interactive && seekStep(stepIdx)}
                  title={`${row} · ${slotName} UTC · energy ${Math.round(strength * 100)}%`}
                  className={isCurrentStep ? "is-active-step" : undefined}
                  style={{
                    background:
                      strength > 0.56
                        ? "#23695f"
                        : strength > 0.34
                        ? "#9ec1b1"
                        : "#e7ebe7",
                    opacity: isCurrentStep ? 1 : 0.72 + strength * 0.28,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ParticleField({ spec }: { spec?: AudioCompositionSpec }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meta = useAudioClockMeta();

  const density = spec?.mapping.density ?? 0.6;
  const brightness = spec?.mapping.brightness ?? 0.5;
  const isPlayingThis =
    meta.playbackState === "playing" && (!spec || meta.activeCompositionId === spec.id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const count = Math.round(18 + density * 46);
    const particles = Array.from({ length: count }, (_, i) => ({
      x: ((i * 73) % 100) / 100 * w,
      y: ((i * 41) % 100) / 100 * h,
      baseR: 1.6 + (i % 4) * 1.1,
      phase: (i * 0.61) % (Math.PI * 2),
      speed: 0.4 + (i % 5) * 0.16,
    }));

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    const draw = (timeMs: number) => {
      const t = timeMs / 1000;
      const frame = sonificationService.getVisualFrame();
      const playingNow =
        frame.playbackState === "playing" && (!spec || frame.activeCompositionId === spec.id);
      const rms = playingNow ? frame.rms : 0.14;
      const bright = playingNow ? frame.spectralCentroid : brightness;

      ctx.fillStyle = "#123331";
      ctx.fillRect(0, 0, w, h);

      const grad = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.44);
      grad.addColorStop(0, `rgba(172, 202, 188, ${0.14 + rms * 0.28})`);
      grad.addColorStop(1, "rgba(18, 51, 49, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        const motionFactor = reducedMotion ? 0.1 : 1 + rms * 2.2;
        const px = (p.x + Math.sin(t * p.speed + p.phase) * 18 * motionFactor + w) % w;
        const py = (p.y + Math.cos(t * p.speed * 0.8 + p.phase) * 12 * motionFactor + h) % h;
        const rad = p.baseR * (1 + rms * 1.4);
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fillStyle =
          bright > 0.58
            ? `rgba(218, 226, 178, ${0.42 + rms * 0.45})`
            : `rgba(172, 202, 188, ${0.42 + rms * 0.45})`;
        ctx.fill();
      }

      if (!reducedMotion && (playingNow || timeMs < 500)) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    raf = window.requestAnimationFrame(draw);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [density, brightness, isPlayingThis, spec]);

  return (
    <div
      className="b-particle-field"
      role="img"
      aria-label="Atmospheric dispersion particle visualization linked to sound RMS energy"
    >
      <canvas ref={canvasRef} width={460} height={116} className="b-particles-canvas" />
    </div>
  );
}

export function AudioTransport({
  title,
  value = 72,
  min = 10,
  max = 150,
  label,
  spec,
  compact = false,
  hideContext = false,
  onStepSlot,
}: {
  title: string;
  value?: number;
  min?: number;
  max?: number;
  label?: string;
  spec?: AudioCompositionSpec;
  compact?: boolean;
  hideContext?: boolean;
  onStepSlot?: (delta: number) => void;
}) {
  const {
    playbackState,
    clock,
    config,
    play,
    playComposition,
    pause,
    seekStep,
    setVolume,
  } = useSonification();

  const isPlayingThis =
    playbackState === "playing" &&
    (!spec || !clock.activeCompositionId || clock.activeCompositionId === spec.id);

  const toggle = () => {
    if (isPlayingThis) {
      pause();
      return;
    }
    if (spec) {
      playComposition(spec);
    } else {
      play({ value, min, max, label: title });
    }
  };

  const handleStep = (delta: number) => {
    if (onStepSlot) {
      onStepSlot(delta);
    }
    seekStep(clock.currentStep + delta * 2);
  };

  const activeTime = isPlayingThis ? formatClock(clock.elapsedSec) : "0:00";
  const totalTime = formatClock(spec?.durationSec ?? 30);

  const transportClassName = [
    "b-transport",
    compact ? "b-transport-compact" : "",
    hideContext ? "b-transport-minimal" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={transportClassName}>
      <div className="b-transport-controls">
        {!compact && (
          <button
            type="button"
            className="b-icon-button"
            onClick={() => handleStep(-1)}
            aria-label="Previous atmospheric step"
            title="Previous step"
          >
            <SkipBack size={13} />
          </button>
        )}

        <button
          type="button"
          className="b-play-button"
          onClick={toggle}
          aria-label={isPlayingThis ? `Pause ${title}` : `Play ${title}`}
        >
          {isPlayingThis ? <Pause size={15} /> : <Play size={15} />}
        </button>

        {!compact && (
          <button
            type="button"
            className="b-icon-button"
            onClick={() => handleStep(1)}
            aria-label="Next atmospheric step"
            title="Next step"
          >
            <SkipForward size={13} />
          </button>
        )}
      </div>

      {!hideContext && (
        <div className="b-transport-content">
          <strong title={title}>{title}</strong>
          <Waveform compact spec={spec} />
          {label && <small className="b-muted">{label}</small>}
        </div>
      )}

      <span className="b-transport-time">
        {activeTime} / {totalTime}
      </span>

      {!compact && (
        <label className="b-volume" aria-label="Master volume">
          <Volume2 size={14} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={spec?.mapping.volume ?? config.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      )}
    </div>
  );
}
