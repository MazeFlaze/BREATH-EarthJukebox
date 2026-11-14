import { Waveform } from "./SoundVisuals";

export function ArtworkVisual({ kind, className = "" }: { kind: "waves" | "spectrogram" | "rings" | "bars" | "lines"; className?: string }) {
  return <div className={`b-artwork-visual b-artwork-${kind} ${className}`} aria-hidden="true">
    {(kind === "waves" || kind === "lines") && <svg viewBox="0 0 600 260" preserveAspectRatio="none">{Array.from({ length: 19 }, (_, row) => <path key={row} d={Array.from({ length: 61 }, (_, i) => {
      const x = i * 10;
      const y = 130 + (row - 9) * 5 + Math.sin(i * 0.19 + row * 0.13) * (25 + row * 0.8) + Math.sin(i * 0.47 + row * 0.4) * 5;
      return `${i ? "L" : "M"}${x} ${y}`;
    }).join(" ")} />)}</svg>}
    {kind === "rings" && <div className="b-artwork-rings">{Array.from({ length: 16 }, (_, i) => <span key={i} style={{ width: `${50 + i * 7}%`, height: `${50 + i * 7}%`, transform: `translate(-50%, -50%) rotate(${i * 9}deg)` }} />)}</div>}
    {kind === "spectrogram" && <div className="b-artwork-spectrum">{Array.from({ length: 48 }, (_, i) => <span key={i} style={{ height: `${15 + Math.abs(Math.sin(i * 0.32) * Math.cos(i * 0.09)) * 84}%`, opacity: 0.2 + Math.abs(Math.sin(i * 0.17)) * 0.7 }} />)}</div>}
    {kind === "bars" && <Waveform seed={5} />}
    <span className="b-artwork-grain" />
  </div>;
}
