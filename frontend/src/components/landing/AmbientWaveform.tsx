import React, { useEffect, useRef } from 'react';
import { EnvironmentalSignals } from '@/types/landing/breathe';

interface AmbientWaveformProps {
  signals: EnvironmentalSignals;
  isPlaying: boolean;
}

export const AmbientWaveformField: React.FC<AmbientWaveformProps> = ({
  signals,
  isPlaying,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const signalsRef = useRef(signals);
  const playingRef = useRef(isPlaying);

  useEffect(() => {
    signalsRef.current = signals;
  }, [signals]);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let animId = 0;
    let phase = 0;

    const particles = Array.from({ length: 48 }, (_, i) => ({
      x: (i * 0.6180339887) % 1,
      y: 0.18 + ((i * 0.381966) % 0.64),
      radius: 0.65 + (i % 3) * 0.45,
      speedOffset: 0.4 + (i % 5) * 0.18,
      phaseOffset: i * 0.73,
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const s = signalsRef.current;
      const active = playingRef.current;

      const windFactor = 0.3 + (s.wind / 60) * 1.35;
      const humFactor = 0.25 + (s.humidity / 100) * 0.75;
      const tempFactor = 0.75 + ((s.temperature + 5) / 50) * 1.25;
      const pmCount = Math.max(10, Math.round(12 + (s.pm25 / 100) * 34));

      if (!prefersReducedMotion) {
        // Organic, unhurried breath-like cadence
        phase += (active ? 0.013 : 0.006) * windFactor;
      }

      // Breath-like gather and dissolve envelope
      const breathSwell = prefersReducedMotion ? 0.7 : 0.55 + 0.45 * Math.sin(phase * 0.42);

      // Fine white threads drifting, gathering, and dissolving like breath
      const threads = 6;
      for (let t = 0; t < threads; t++) {
        ctx.beginPath();
        const baseAlpha = active ? 0.34 : 0.18;
        const alpha = Math.max(0.05, baseAlpha - t * 0.04) * (0.7 + 0.3 * breathSwell);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = t === 0 ? 1.05 : 0.6;

        const spread = 1 - breathSwell * 0.42;
        const amp = (11 + t * 5.2) * humFactor * spread * (active ? 1.2 : 0.85);
        const freq = (0.009 + t * 0.0024) * tempFactor;
        const verticalDrift = (t - (threads - 1) / 2) * (3.5 * spread);

        for (let x = 0; x <= w; x += 5) {
          const edgeFade = Math.sin((x / w) * Math.PI);
          const y =
            h / 2 +
            verticalDrift * edgeFade +
            Math.sin(x * freq + phase * (0.85 + t * 0.12) + t * 0.9) * amp * edgeFade +
            Math.cos(x * freq * 0.48 - phase * 0.42 + t) * (amp * 0.38) * edgeFade;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Translucent airborne dust particles gathering and dissolving
      for (let i = 0; i < pmCount; i++) {
        const p = particles[i];
        const driftX = prefersReducedMotion
          ? p.x * w
          : ((p.x + phase * 0.022 * p.speedOffset) % 1) * w;
        const driftY =
          p.y * h +
          Math.sin(phase * 0.65 * p.speedOffset + p.phaseOffset) * (10 * humFactor);
        const particleAlpha =
          (active ? 0.34 : 0.2) *
          (0.55 + 0.45 * Math.sin(phase * 0.5 + p.phaseOffset));

        ctx.beginPath();
        ctx.arc(driftX, driftY, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.05, particleAlpha)})`;
        ctx.fill();
      }

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="w-full h-36 pointer-events-none select-none"
    />
  );
};

export const MiniWaveform: React.FC<AmbientWaveformProps> = ({
  signals,
  isPlaying,
}) => {
  const barCount = 18;
  const windNorm = signals.wind / 60;
  const humNorm = signals.humidity / 100;
  const tempNorm = (signals.temperature + 5) / 50;
  const pmNorm = signals.pm25 / 100;

  return (
    <div
      className="w-24 h-16 rounded-2xl bg-white/5 flex items-center justify-center gap-[3px] px-2.5 shrink-0 overflow-hidden"
      aria-hidden="true"
    >
      {Array.from({ length: barCount }, (_, i) => {
        const normPos = i / (barCount - 1);
        const envelope = Math.sin(normPos * Math.PI);
        const harmonic =
          0.35 +
          0.45 *
            Math.abs(
              Math.sin(
                i * (0.45 + tempNorm * 0.5) + (isPlaying ? windNorm * 3.1 : 0.6)
              )
            ) +
          pmNorm * 0.2;
        const heightPct = Math.round(
          Math.max(16, Math.min(86, envelope * harmonic * (60 + humNorm * 40)))
        );

        return (
          <span
            key={i}
            style={{ height: `${heightPct}%` }}
            className={`w-[2px] rounded-full transition-all duration-300 ${
              isPlaying ? 'bg-white/85' : 'bg-white/45'
            }`}
          />
        );
      })}
    </div>
  );
};
