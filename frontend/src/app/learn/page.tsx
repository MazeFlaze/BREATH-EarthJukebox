"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Lightbulb,
  MapPin,
  Volume2,
} from "lucide-react";
import { MapArtworkThumbnail } from "@/components/breathe/MapArtworkThumbnail";
import { DataBadge, SiteFooter } from "@/components/breathe/SharedUI";
import { AudioTransport, RhythmGrid, Waveform } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { galleryWorks, observations } from "@/lib/breatheData";
import type { AudioCompositionSpec } from "@/types/breathe";

interface ComparisonProfile {
  id: string;
  title: string;
  subtitle: string;
  label: string;
  value: number;
  unit: string;
  badge: string;
  series: number[];
  isIllustrative: boolean;
}

const COMPARISON_PROFILES: ComparisonProfile[] = [
  {
    id: "beijing-lesson",
    title: "Beijing, China",
    subtitle: "Example average PM2.5 · July 2024",
    label: "Beijing, China (July baseline)",
    value: 78.4,
    unit: "µg/m³",
    badge: "Elevated",
    series: [62, 74, 86, 82, 58, 49, 68, 88, 94, 72, 60, 78],
    isIllustrative: true,
  },
  {
    id: "vancouver-lesson",
    title: "Vancouver, Canada",
    subtitle: "Example average PM2.5 · July 2024",
    label: "Vancouver, Canada (July baseline)",
    value: 14.2,
    unit: "µg/m³",
    badge: "Lower",
    series: [15, 19, 13, 11, 16, 20, 12, 10, 14, 18, 13, 15],
    isIllustrative: true,
  },
  ...observations.map((obs) => ({
    id: obs.id,
    title: obs.coordinates.regionName,
    subtitle: "NASA GEOS-CF v2 · 12 Nov 2026",
    label: `${obs.coordinates.regionName} (NASA GEOS-CF v2)`,
    value: Number(obs.value.toFixed(1)),
    unit: obs.unit,
    badge: obs.value > 75 ? "Elevated" : obs.value > 35 ? "Moderate" : "Lower",
    series: Array.from({ length: 12 }, (_, idx) =>
      Number((obs.value * (0.82 + 0.24 * Math.sin(idx * 0.65))).toFixed(1))
    ),
    isIllustrative: false,
  })),
];

function buildProfileSpec(profile: ComparisonProfile): AudioCompositionSpec {
  const norm = Math.min(1, profile.value / 130);
  return {
    id: `learn-${profile.id}`,
    title: profile.title,
    regionName: profile.title,
    variable: "PM25_RH35",
    series: profile.series,
    min: 0,
    max: 140,
    mapping: {
      density: Math.max(0.24, Math.min(0.95, 0.22 + norm * 0.72)),
      brightness: Math.max(0.28, Math.min(0.88, 0.26 + norm * 0.58)),
      pitchSensitivity: 0.6,
      spatialSpread: 0.35,
      tempo: Math.round(76 + norm * 38),
      musicalKey: norm > 0.5 ? "D minor" : "C major",
      waveform: "sine",
      volume: 0.7,
    },
    durationSec: 24,
  };
}

function MiniSeriesChart({ series, labelId }: { series: number[]; labelId: string }) {
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * 280},${Math.max(8, 92 - (v / 110) * 78)}`)
    .join(" ");
  const gradId = `learn-grad-${labelId}`;

  return (
    <div className="b-learning-chart">
      <div className="b-chart-grid" aria-hidden="true">
        <span>100</span>
        <span>50</span>
        <span>0</span>
      </div>
      <svg viewBox="0 0 280 96" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#23695f" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#23695f" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <polygon points={`0,92 ${pts} 280,92`} fill={`url(#${gradId})`} />
        <polyline points={pts} fill="none" stroke="#23695f" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="b-chart-dates b-tabular">
        <span>Jul 1</span>
        <span>Jul 8</span>
        <span>Jul 15</span>
        <span>Jul 22</span>
        <span>Jul 31</span>
      </div>
    </div>
  );
}

export default function LearnPage() {
  const router = useRouter();
  const { updateMapping, loadWorkContext } = useBreathe();

  const [tab, setTab] = useState<"lessons" | "experiments" | "concepts">("lessons");
  const [cityAId, setCityAId] = useState<string>("beijing-lesson");
  const [cityBId, setCityBId] = useState<string>("vancouver-lesson");
  const [activeAB, setActiveAB] = useState<"a" | "b">("a");

  const [expObsIdx, setExpObsIdx] = useState(0);
  const [expDensity, setExpDensity] = useState(0.68);
  const [expBrightness, setExpBrightness] = useState(0.54);
  const [expTempo, setExpTempo] = useState(96);

  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);

  const cityA = COMPARISON_PROFILES.find((c) => c.id === cityAId) ?? COMPARISON_PROFILES[0];
  const cityB = COMPARISON_PROFILES.find((c) => c.id === cityBId) ?? COMPARISON_PROFILES[1];

  const specA = useMemo(() => buildProfileSpec(cityA), [cityA]);
  const specB = useMemo(() => buildProfileSpec(cityB), [cityB]);

  const activeObs = observations[expObsIdx] ?? observations[0];
  const sandboxSpec = useMemo<AudioCompositionSpec>(
    () => ({
      id: `sandbox-${activeObs.id}`,
      title: `${activeObs.coordinates.regionName} Experiment`,
      regionName: activeObs.coordinates.regionName,
      variable: "PM25_RH35",
      series: [
        activeObs.value * 0.8,
        activeObs.value * 0.92,
        activeObs.value,
        activeObs.value * 1.12,
        activeObs.value * 1.04,
        activeObs.value * 0.9,
        activeObs.value * 0.85,
        activeObs.value * 0.95,
      ],
      min: 0,
      max: 140,
      mapping: {
        density: expDensity,
        brightness: expBrightness,
        pitchSensitivity: 0.62,
        spatialSpread: 0.45,
        tempo: expTempo,
        musicalKey: "A minor",
        waveform: "sine",
        volume: 0.72,
      },
      durationSec: 24,
    }),
    [activeObs, expDensity, expBrightness, expTempo]
  );

  const mysterySpec = useMemo<AudioCompositionSpec>(
    () => ({
      id: "concept-mystery-hanoi",
      title: "Mystery Basin Sample",
      regionName: "Unknown Region",
      variable: "PM25_RH35",
      series: [92, 108, 120, 125, 114, 104, 96, 110],
      min: 0,
      max: 140,
      mapping: {
        density: 0.78,
        brightness: 0.7,
        pitchSensitivity: 0.65,
        spatialSpread: 0.45,
        tempo: 112,
        musicalKey: "D minor",
        waveform: "sine",
        volume: 0.72,
      },
      durationSec: 20,
    }),
    []
  );

  const sendSandboxToStudio = () => {
    updateMapping({
      density: expDensity,
      brightness: expBrightness,
      tempo: expTempo,
    });
    router.push("/studio");
  };

  return (
    <div className="b-page">
      <div className="b-container b-learn-top b-workspace-intro">
        <div>
          <h1>Learning Lab</h1>
          <p>Contrast atmospheric baselines side by side and hear how data patterns map to rhythm and pitch.</p>
        </div>
        <DataBadge tone="illustrative" label="Illustrative example + NASA GEOS-CF v2" />
      </div>

      <div className="b-container b-learn-tabs" role="tablist" aria-label="Learning sections">
        {(["lessons", "experiments", "concepts"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "is-active" : undefined}
            onClick={() => setTab(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "lessons" && (
        <div className="b-learn-grid b-container">
          <div className="b-lesson-content">
            <h2>How two cities compare acoustically</h2>
            <p className="b-muted">
              Select two atmospheric profiles and listen to how concentration and temporal variability alter pulse density and pitch.
            </p>

            <div className="b-lesson-meta-line b-tabular">
              <Clock size={12} />
              <span>10 min · Beginner ·{" "}
                {cityA.isIllustrative || cityB.isIllustrative
                  ? "Illustrative baseline comparison"
                  : "Verified NASA GEOS-CF v2"}
              </span>
            </div>

            <div className="b-compare-selectors">
              <label>
                Region A
                <select value={cityAId} onChange={(e) => setCityAId(e.target.value)}>
                  {COMPARISON_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Region B
                <select value={cityBId} onChange={(e) => setCityBId(e.target.value)}>
                  {COMPARISON_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="b-city-list">
              <div className="b-city-row">
                <div className="b-city-info">
                  <MapPin size={15} />
                  <h3>{cityA.title}</h3>
                  <small>{cityA.subtitle}</small>
                  <strong>
                    {cityA.value.toFixed(1)} <span>{cityA.unit}</span>
                  </strong>
                  <em className={cityA.value < 35 ? "is-good" : undefined}>{cityA.badge}</em>
                </div>
                <MiniSeriesChart series={cityA.series} labelId={`a-${cityA.id}`} />
              </div>

              <div className="b-city-row">
                <div className="b-city-info">
                  <MapPin size={15} />
                  <h3>{cityB.title}</h3>
                  <small>{cityB.subtitle}</small>
                  <strong>
                    {cityB.value.toFixed(1)} <span>{cityB.unit}</span>
                  </strong>
                  <em className={cityB.value < 35 ? "is-good" : undefined}>{cityB.badge}</em>
                </div>
                <MiniSeriesChart series={cityB.series} labelId={`b-${cityB.id}`} />
              </div>
            </div>

            <div className="b-compare-player">
              <div>
                <strong>Hear the contrast</strong>
                <div className="b-segmented" role="group" aria-label="Switch A/B city profile">
                  <button
                    type="button"
                    className={activeAB === "a" ? "is-active" : undefined}
                    onClick={() => setActiveAB("a")}
                  >
                    {cityA.title.split(",")[0]}
                  </button>
                  <button
                    type="button"
                    className={activeAB === "b" ? "is-active" : undefined}
                    onClick={() => setActiveAB("b")}
                  >
                    {cityB.title.split(",")[0]}
                  </button>
                </div>
              </div>

              <AudioTransport
                compact
                title={`${(activeAB === "a" ? cityA : cityB).title} · ${(
                  activeAB === "a" ? cityA : cityB
                ).value.toFixed(1)} µg/m³`}
                spec={activeAB === "a" ? specA : specB}
              />
            </div>
          </div>

          <aside className="b-learn-aside">
            <h2>From data to sound</h2>
            <p>Each atmospheric quantity shapes a distinct musical parameter without conflating units.</p>

            <div className="b-method-steps">
              <div className="b-method-step">
                <span className="b-step-idx b-tabular">01</span>
                <div>
                  <strong>Surface PM2.5 (µg/m³) → Rhythm</strong>
                  <span>Higher particle loading increases pulse event density.</span>
                </div>
              </div>
              <div className="b-method-step">
                <span className="b-step-idx b-tabular">02</span>
                <div>
                  <strong>Temporal slope (Δ) → Pitch</strong>
                  <span>Diurnal rises and falls transpose pitch excursion.</span>
                </div>
              </div>
              <div className="b-method-step">
                <span className="b-step-idx b-tabular">03</span>
                <div>
                  <strong>Column AOD (dimensionless) → Timbre</strong>
                  <span>Independent optical column attenuation modulates brightness when available.</span>
                </div>
              </div>
            </div>

            <div className="b-think-card">
              <Lightbulb size={16} />
              <div>
                <strong>Think about it</strong>
                <p>
                  Why is surface PM2.5 (µg/m³) never equated to dimensionless Aerosol Optical Depth
                  (AOD) or index scores (AQI) in scientific sonification?
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === "experiments" && (
        <div className="b-container b-experiment">
          <div>
            <h2>Test mapping rules live</h2>
            <p>
              Pick a verified NASA GEOS-CF v2 station, dial how concentration governs pulse density
              and filter timbre, then transfer the mapping into Studio.
            </p>

            <label className="b-field-label" style={{ display: "grid", gap: 6, marginTop: 22 }}>
              <span>Station (NASA GEOS-CF v2)</span>
              <select
                className="b-text-input"
                value={expObsIdx}
                onChange={(e) => setExpObsIdx(Number(e.target.value))}
              >
                {observations.map((obs, idx) => (
                  <option key={obs.id} value={idx}>
                    {obs.coordinates.regionName} — {obs.value.toFixed(1)} {obs.unit}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Rhythm density</span>
              <strong className="b-tabular">{Math.round(expDensity * 100)}%</strong>
            </label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.02}
              value={expDensity}
              onChange={(e) => setExpDensity(Number(e.target.value))}
            />

            <label>
              <span>Timbre brightness</span>
              <strong className="b-tabular">{Math.round(expBrightness * 100)}%</strong>
            </label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.02}
              value={expBrightness}
              onChange={(e) => setExpBrightness(Number(e.target.value))}
            />

            <label>
              <span>Tempo</span>
              <strong className="b-tabular">{expTempo} BPM</strong>
            </label>
            <input
              type="range"
              min={60}
              max={152}
              step={2}
              value={expTempo}
              onChange={(e) => setExpTempo(Number(e.target.value))}
            />

            <button
              type="button"
              className="b-button b-button-primary"
              style={{ marginTop: 22 }}
              onClick={sendSandboxToStudio}
            >
              <span>Apply mapping in Studio</span>
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="b-sound-panel">
            <h2>{activeObs.coordinates.regionName}</h2>
            <p className="b-muted b-tabular" style={{ marginBottom: 12 }}>
              Surface PM2.5: {activeObs.value.toFixed(1)} {activeObs.unit}
            </p>
            <AudioTransport title={`${activeObs.coordinates.regionName} sandbox`} spec={sandboxSpec} />
            <Waveform spec={sandboxSpec} />
            <div style={{ marginTop: 12 }}>
              <RhythmGrid rows={["PM2.5", "Timbre", "ΔRate"]} spec={sandboxSpec} />
            </div>
          </div>
        </div>
      )}

      {tab === "concepts" && (
        <div className="b-container b-concepts">
          <div>
            <span>METRIC 01</span>
            <h2>PM2.5</h2>
            <p>
              Fine particulate matter ≤ 2.5 micrometers near Earth&apos;s surface measured at 35%
              relative humidity in µg/m³ by NASA GMAO GEOS-CF v2.
            </p>
          </div>
          <div>
            <span>METRIC 02</span>
            <h2>Column AOD</h2>
            <p>
              Dimensionless Aerosol Optical Depth integrates vertical light extinction through the
              full atmospheric column — never substitute AOD for ground µg/m³ or AQI.
            </p>
          </div>
          <div>
            <span>EAR TEST</span>
            <h2>Listen</h2>
            <p style={{ marginBottom: 10 }}>
              Audition the basin sample and identify its particle loading regime:
            </p>
            <AudioTransport compact title="Mystery basin signal" spec={mysterySpec} />
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`b-inline-tool ${quizAnswer === "dense" ? "is-active" : ""}`}
                onClick={() => setQuizAnswer("dense")}
              >
                <Volume2 size={12} /> Dense urban
              </button>
              <button
                type="button"
                className={`b-inline-tool ${quizAnswer === "clean" ? "is-active" : ""}`}
                onClick={() => setQuizAnswer("clean")}
              >
                Clean ocean
              </button>
            </div>
            {quizAnswer && (
              <p className="b-micro" style={{ marginTop: 8, color: "var(--green-dark)" }}>
                <CheckCircle2 size={12} style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
                {quizAnswer === "dense"
                  ? "Correct — dense step probability (0.78) reflects elevated ~115 µg/m³ loading."
                  : "Notice the dense rhythmic cells & higher tempo — characteristic of elevated PM2.5."}
              </p>
            )}
          </div>
        </div>
      )}

      <section className="b-container b-gallery-teaser">
        <div className="b-between">
          <div>
            <h2>Geographic sound works</h2>
          </div>
          <Link href="/gallery" className="b-text-arrow">
            <span>Browse all works</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        <p>Open any curated work directly inside Studio with its exact polygon and mapping restored.</p>

        <div className="b-teaser-grid">
          {galleryWorks.slice(0, 3).map((work) => (
            <Link
              key={work.id}
              href="/studio"
              onClick={() => loadWorkContext(work, "flat")}
            >
              <MapArtworkThumbnail
                center={work.center}
                zoom={work.zoom}
                polygon={work.polygon}
                variable={work.variable}
                timeIndex={work.timeIndex}
                seriesPreview={work.seriesPreview}
                title={work.title}
                regionLabel={work.region}
              />
              <div>
                <h3>{work.title}</h3>
                <span>
                  {work.region} · {work.musicalKey}
                </span>
                <ArrowRight size={14} />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
