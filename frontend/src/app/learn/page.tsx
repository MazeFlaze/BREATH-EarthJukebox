"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { CustomSelect, DataBadge, SiteFooter } from "@/components/breathe/SharedUI";
import { AudioTransport, RhythmGrid, Waveform } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { galleryWorks, observations } from "@/lib/breatheData";
import { samplePointSeries } from "@/lib/geosCfRaster";
import { sonificationService } from "@/services/sonificationService";
import type { AudioCompositionSpec, SonificationMapping } from "@/types/breathe";

interface ComparisonProfile {
  id: string;
  title: string;
  subtitle: string;
  label: string;
  value: number;
  unit: string;
  badge: string;
  series: number[];
  xLabels: readonly string[];
  isIllustrative: boolean;
  coordinates?: { lat: number; lon: number };
}

const JULY_X_LABELS = ["Jul 1", "Jul 8", "Jul 15", "Jul 22", "Jul 31"] as const;
const UTC_X_LABELS = ["00:30Z", "06:30Z", "12:30Z", "18:30Z", "21:30Z"] as const;

function getStationFallbackSeries(value: number): number[] {
  return Array.from({ length: 8 }, () => Number(value.toFixed(1)));
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
    xLabels: JULY_X_LABELS,
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
    xLabels: JULY_X_LABELS,
    isIllustrative: true,
  },
  ...observations.map((obs) => ({
    id: obs.id,
    title: obs.coordinates.regionName,
    subtitle: `NASA GEOS-CF v2 · ${obs.timestamp.slice(11, 16)}Z (${obs.timestamp.slice(0, 10)})`,
    label: `${obs.coordinates.regionName} (NASA GEOS-CF v2)`,
    value: Number(obs.value.toFixed(1)),
    unit: obs.unit,
    badge: obs.value > 75 ? "Elevated" : obs.value > 35 ? "Moderate" : "Lower",
    series: getStationFallbackSeries(obs.value),
    xLabels: UTC_X_LABELS,
    isIllustrative: false,
    coordinates: { lat: obs.coordinates.lat, lon: obs.coordinates.lon },
  })),
];

function buildProfileSpec(profile: ComparisonProfile, series: number[]): AudioCompositionSpec {
  const norm = Math.min(1, profile.value / 130);
  return {
    id: `learn-${profile.id}`,
    title: profile.title,
    regionName: profile.title,
    variable: "PM25_RH35",
    series,
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

function MiniSeriesChart({
  series,
  labelId,
  xLabels,
}: {
  series: number[];
  labelId: string;
  xLabels: readonly string[];
}) {
  const maxVal = series.length > 0 ? Math.max(...series) : 100;
  const maxTick = Math.max(100, Math.ceil((maxVal * 1.15) / 25) * 25);
  const midTick = Math.round(maxTick / 2);
  const denom = Math.max(1, series.length - 1);
  const pts = series
    .map((v, i) => {
      const x = (i / denom) * 280;
      const clamped = Math.max(0, Math.min(maxTick, v));
      const y = 92 - (clamped / maxTick) * 80;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const gradId = `learn-grad-${labelId}`;

  return (
    <div className="b-learning-chart">
      <div className="b-chart-grid b-tabular" aria-hidden="true">
        <span>{maxTick}</span>
        <span>{midTick}</span>
        <span>0</span>
      </div>
      <svg viewBox="0 0 280 96" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#23695f" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#23695f" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <polygon points={`0,92 ${pts} 280,92`} fill={`url(#${gradId})`} />
        <polyline
          points={pts}
          fill="none"
          stroke="#23695f"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="b-chart-dates b-tabular">
        {xLabels.map((lbl) => (
          <span key={lbl}>{lbl}</span>
        ))}
      </div>
    </div>
  );
}

function useSampledStationSeries(
  coordinates: { lat: number; lon: number } | undefined,
  fallbackValue: number,
  enabled: boolean
): number[] {
  const [sampled, setSampled] = useState<number[] | null>(null);

  useEffect(() => {
    setSampled(null);
    if (!enabled || !coordinates) return;
    let cancelled = false;
    void samplePointSeries("PM25_RH35", coordinates.lat, coordinates.lon, fallbackValue).then(
      (series) => {
        if (!cancelled && series.length > 0) {
          setSampled(series);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, coordinates, fallbackValue]);

  return sampled ?? getStationFallbackSeries(fallbackValue);
}

const ExperimentsSandbox = React.memo(function ExperimentsSandbox({
  onApplyToStudio,
}: {
  onApplyToStudio: (patch: Partial<SonificationMapping>) => void;
}) {
  const [expObsIdx, setExpObsIdx] = useState(0);
  const [expDensity, setExpDensity] = useState(0.68);
  const [expBrightness, setExpBrightness] = useState(0.54);
  const [expTempo, setExpTempo] = useState(96);

  const activeObs = observations[expObsIdx] ?? observations[0];
  const sampledSeries = useSampledStationSeries(
    activeObs.coordinates,
    activeObs.value,
    true
  );

  const sandboxSpec = useMemo<AudioCompositionSpec>(
    () => ({
      id: `sandbox-${activeObs.id}`,
      title: `${activeObs.coordinates.regionName} Experiment`,
      regionName: activeObs.coordinates.regionName,
      variable: "PM25_RH35",
      series: sampledSeries,
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
    [activeObs, sampledSeries, expDensity, expBrightness, expTempo]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const state = sonificationService.getClockState();
      if (
        state.playbackState !== "playing" ||
        !state.activeCompositionId ||
        state.activeCompositionId.startsWith("sandbox-")
      ) {
        sonificationService.syncPreviewSpec(sandboxSpec);
      }
    }, 45);
    return () => window.clearTimeout(timer);
  }, [sandboxSpec]);

  return (
    <div className="b-container b-experiment">
      <div>
        <h2>Test mapping rules live</h2>
        <p>
          Pick a verified NASA GEOS-CF v2 station, dial how concentration governs pulse density
          and filter timbre, then transfer the mapping into Studio.
        </p>

        <div className="b-field-label" style={{ display: "grid", gap: 6, marginTop: 22 }}>
          <span>Station (NASA GEOS-CF v2)</span>
          <CustomSelect
            value={String(expObsIdx)}
            options={observations.map((obs, idx) => ({
              value: String(idx),
              label: `${obs.coordinates.regionName} — ${obs.value.toFixed(1)} ${obs.unit}`,
            }))}
            onChange={(val) => setExpObsIdx(Number(val))}
            searchPlaceholder="Search station or region..."
            ariaLabel="Station (NASA GEOS-CF v2)"
          />
        </div>

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
          onClick={() =>
            onApplyToStudio({
              density: expDensity,
              brightness: expBrightness,
              tempo: expTempo,
            })
          }
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
  );
});

export default function LearnPage() {
  const router = useRouter();
  const { updateMapping, loadWorkContext } = useBreathe();

  const [tab, setTab] = useState<"lessons" | "experiments" | "concepts">("lessons");
  const [cityAId, setCityAId] = useState<string>("beijing-lesson");
  const [cityBId, setCityBId] = useState<string>("vancouver-lesson");
  const [activeAB, setActiveAB] = useState<"a" | "b">("a");
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);

  const cityA = COMPARISON_PROFILES.find((c) => c.id === cityAId) ?? COMPARISON_PROFILES[0];
  const cityB = COMPARISON_PROFILES.find((c) => c.id === cityBId) ?? COMPARISON_PROFILES[1];

  const sampledCityASeries = useSampledStationSeries(
    cityA.coordinates,
    cityA.value,
    tab === "lessons" && !cityA.isIllustrative
  );
  const sampledCityBSeries = useSampledStationSeries(
    cityB.coordinates,
    cityB.value,
    tab === "lessons" && !cityB.isIllustrative
  );

  const cityASeries = cityA.isIllustrative ? cityA.series : sampledCityASeries;
  const cityBSeries = cityB.isIllustrative ? cityB.series : sampledCityBSeries;

  const specA = useMemo(() => buildProfileSpec(cityA, cityASeries), [cityA, cityASeries]);
  const specB = useMemo(() => buildProfileSpec(cityB, cityBSeries), [cityB, cityBSeries]);

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

  const applySandboxToStudio = React.useCallback(
    (patch: Partial<SonificationMapping>) => {
      updateMapping(patch);
      router.push("/studio");
    },
    [updateMapping, router]
  );

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
              <div style={{ flex: 1, minWidth: 160 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Region A</span>
                <CustomSelect
                  value={cityAId}
                  options={COMPARISON_PROFILES.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                  onChange={setCityAId}
                  compact
                  searchPlaceholder="Search region A..."
                  ariaLabel="Select Region A"
                />
              </div>

              <div style={{ flex: 1, minWidth: 160 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Region B</span>
                <CustomSelect
                  value={cityBId}
                  options={COMPARISON_PROFILES.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                  onChange={setCityBId}
                  compact
                  searchPlaceholder="Search region B..."
                  ariaLabel="Select Region B"
                />
              </div>
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
                <MiniSeriesChart
                  series={cityASeries}
                  labelId={`a-${cityA.id}`}
                  xLabels={cityA.xLabels}
                />
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
                <MiniSeriesChart
                  series={cityBSeries}
                  labelId={`b-${cityB.id}`}
                  xLabels={cityB.xLabels}
                />
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
        <ExperimentsSandbox onApplyToStudio={applySandboxToStudio} />
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
                boundaryGeometry={work.boundaryGeometry}
                territoryCode={work.territoryCode}
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
