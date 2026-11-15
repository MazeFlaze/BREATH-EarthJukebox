"use client";

import { useEffect, useId, useState } from "react";

interface GlobeLoadingOverlayProps {
  visible: boolean;
  isLightBasemap: boolean;
  label?: string;
}

const EARTH_SLOTS = [0, 1, 2] as const;

/**
 * Minimal, distraction-free loading gate scoped to the map viewport until MapLibre GL settles.
 * Renders three sequential BREATHE Pine Earth globes synced to the Discord-style typing cadence.
 */
export function GlobeLoadingOverlay({
  visible,
  isLightBasemap,
  label = "Loading 3D Earth globe",
}: GlobeLoadingOverlayProps) {
  const uid = useId().replace(/:/g, "");
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      return;
    }
    const timer = window.setTimeout(() => setRendered(false), 460);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!rendered) return null;

  return (
    <div
      className={`b-globe-loading-gate ${isLightBasemap ? "is-light" : "is-dark"} ${
        visible ? "is-animating" : "is-revealed"
      }`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      aria-label={label}
    >
      <span className="b-sr-only">{label}</span>
      <div className="b-earth-loader-row" aria-hidden="true">
        {EARTH_SLOTS.map((idx) => {
          const oceanId = `${uid}-pine-ocean-${idx}`;
          const clipId = `${uid}-pine-clip-${idx}`;
          return (
            <div key={idx} className="b-earth-hopper">
              <div className="b-earth-sprite">
                <svg viewBox="0 0 40 40" className="b-earth-svg" aria-hidden="true">
                  <defs>
                    <radialGradient id={oceanId} cx="35%" cy="30%" r="70%">
                      <stop offset="0%" stopColor="#3a8576" />
                      <stop offset="65%" stopColor="#23695f" />
                      <stop offset="100%" stopColor="#14443e" />
                    </radialGradient>
                    <clipPath id={clipId}>
                      <circle cx="20" cy="20" r="17" />
                    </clipPath>
                  </defs>
                  <circle cx="20" cy="20" r="17" fill={`url(#${oceanId})`} />
                  <g clipPath={`url(#${clipId})`}>
                    <path
                      d="M9,11 C13,9 18,11 19,15 C20,18 17,22 15,27 C13,29 10,25 9,21 C7,17 6,13 9,11 Z"
                      fill="#accabc"
                      opacity="0.92"
                    />
                    <path
                      d="M23,10 C28,9 33,13 32,18 C31,21 26,20 25,24 C24,27 29,28 28,32 C24,33 21,28 22,22 C22,17 20,12 23,10 Z"
                      fill="#d8be66"
                      opacity="0.72"
                    />
                    <path
                      d="M6,18 Q20,13 35,20"
                      fill="none"
                      stroke="#fffefa"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      opacity="0.45"
                    />
                  </g>
                  <circle
                    cx="20"
                    cy="20"
                    r="17"
                    fill="none"
                    stroke="#fffefa"
                    strokeOpacity="0.45"
                    strokeWidth="1.2"
                  />
                </svg>
              </div>
              <div className="b-earth-shadow" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
