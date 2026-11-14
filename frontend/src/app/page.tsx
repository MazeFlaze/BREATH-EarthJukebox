"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Compass, Pause, Play, Sparkles, Volume2 } from "lucide-react";
import { GeoMap } from "@/components/breathe/GeoMap";
import { MapArtworkThumbnail } from "@/components/breathe/MapArtworkThumbnail";
import { DataBadge, Eyebrow, SiteFooter } from "@/components/breathe/SharedUI";
import { Waveform } from "@/components/breathe/SoundVisuals";
import { useSonification } from "@/hooks/useSonification";
import { observations, regions } from "@/lib/breatheData";
import type { AudioCompositionSpec } from "@/types/breathe";

const RHYTHM_PREVIEW_HEIGHTS = [24, 38, 62, 48, 86, 68, 42, 74, 96, 56, 36, 80, 64, 44, 52, 30];

export default function OverviewPage() {
  const { playbackState, clock, playComposition, pause } = useSonification();
  const hanoi = observations[0];

  const sampleSpec = useMemo<AudioCompositionSpec>(
    () => ({
      id: "overview-hanoi-sample",
      title: "Hanoi · NASA GEOS-CF PM2.5 Sample",
      regionName: "Northern Vietnam",
      variable: "PM25_RH35",
      series: [94, 104, 119.7, 124.2, 112.5, 98.4, 89.2, 101.6],
      min: 0,
      max: 150,
      mapping: {
        density: 0.72,
        brightness: 0.56,
        pitchSensitivity: 0.6,
        spatialSpread: 0.45,
        tempo: 94,
        musicalKey: "A minor",
        waveform: "sine",
        volume: 0.72,
      },
      durationSec: 30,
    }),
    []
  );

  const isSamplePlaying =
    playbackState === "playing" && clock.activeCompositionId === sampleSpec.id;

  const toggleSample = () => {
    if (isSamplePlaying) pause();
    else playComposition(sampleSpec);
  };

  return (
    <div className="b-page b-overview">
      <section className="b-hero b-container">
        <div className="b-hero-copy">
          <Eyebrow>NASA SPACE APPS 2026 · EARTH AIR QUALITY SONIFICATION</Eyebrow>
          <h1>Listen to Earth&apos;s atmosphere.</h1>
          <p className="b-hero-lede">
            Explore NASA GEOS-CF v2 atmospheric layers, select any territory or basin on the globe,
            and translate surface concentration and diurnal change into sound.
          </p>
          <div className="b-hero-actions">
            <Link href="/explore" className="b-button b-button-primary">
              <span>Explore Earth</span>
              <ArrowRight size={15} />
            </Link>
            <button type="button" className="b-button b-button-secondary" onClick={toggleSample}>
              {isSamplePlaying ? <Pause size={14} /> : <Play size={14} />}
              <span>{isSamplePlaying ? "Pause sample" : "Hear a sample"}</span>
            </button>
          </div>
          <div className="b-hero-aside">
            <span>NASA GEOS-CF v2 · PM2.5, NO₂, SO₂, CO &amp; O₃ · Web Audio synthesis</span>
          </div>
        </div>

        <div className="b-hero-visual">
          <GeoMap
            mode="globe"
            basemapMode="territories"
            layer="PM25_RH35"
            timeIndex={0}
            center={{ lat: hanoi.coordinates.lat, lon: hanoi.coordinates.lon }}
            zoom={2.35}
            polygon={regions.northernVietnam}
            showLabels={false}
            showControls={false}
            compact
            label="Interactive 3D Earth showing Northern Vietnam NASA GEOS-CF PM2.5"
          />

          <div className="b-hero-data-card">
            <span className="b-card-kicker">NASA GEOS-CF V2</span>
            <div>
              <strong>{hanoi.value.toFixed(1)}</strong>
              <span>{hanoi.unit}</span>
            </div>
            <p>Hanoi Basin · PM2.5</p>
            <small className="b-tabular">UTC · {hanoi.timestamp.slice(0, 10)}</small>
          </div>
        </div>
      </section>

      {isSamplePlaying && (
        <div className="b-sample-strip b-container">
          <div>
            <strong>Hanoi atmospheric sample</strong>
            <span className="b-tabular">
              {hanoi.value.toFixed(1)} {hanoi.unit} · {clock.activeFrequencyHz.toFixed(1)} Hz ·{" "}
              {sampleSpec.mapping.musicalKey}
            </span>
          </div>
          <Waveform compact spec={sampleSpec} />
          <button type="button" className="b-button b-button-secondary" onClick={toggleSample}>
            <Pause size={13} /> Pause
          </button>
        </div>
      )}

      <section className="b-entry-section b-container">
        <div className="b-entry-heading">
          <div>
            <h2>From observation to creation.</h2>
          </div>
          <p>
            Begin on the territory explorer, tune data-to-sound rules inside Studio, or compare
            global cities and archived atmospheric works.
          </p>
        </div>

        <div className="b-entry-grid">
          <Link href="/explore" className="b-entry b-entry-map">
            <div className="b-entry-top">
              <span>EXPLORE</span>
              <ArrowRight size={14} />
            </div>
            <div className="b-entry-earth" aria-hidden="true">
              <MapArtworkThumbnail
                center={{ lat: hanoi.coordinates.lat, lon: hanoi.coordinates.lon }}
                zoom={3.6}
                polygon={regions.northernVietnam}
                variable="PM25_RH35"
                timeIndex={0}
                seriesPreview={sampleSpec.series}
                title="Northern Vietnam"
                height={186}
              />
            </div>
            <div className="b-entry-bottom">
              <Compass size={17} />
              <h3>Explore Earth</h3>
              <p>
                Switch between globe and flat borders, toggle NASA pollutant fields, and select any
                territory or drawn polygon.
              </p>
            </div>
          </Link>

          <Link href="/studio" className="b-entry b-entry-sound">
            <div className="b-entry-top">
              <span>SONIFICATION</span>
              <ArrowRight size={14} />
            </div>
            <div className="b-entry-rhythm" aria-hidden="true">
              {RHYTHM_PREVIEW_HEIGHTS.map((h, i) => (
                <span key={i} style={{ height: h }} />
              ))}
            </div>
            <div className="b-entry-bottom">
              <Volume2 size={17} />
              <h3>Sonification Studio</h3>
              <p>
                Inspect live Web Audio waveforms and spectrograms while mapping concentration and
                diurnal rate to rhythm and pitch.
              </p>
            </div>
          </Link>

          <Link href="/learn" className="b-entry b-entry-learn">
            <div className="b-entry-top">
              <span>LEARN &amp; ARCHIVE</span>
              <ArrowRight size={14} />
            </div>
            <div className="b-entry-number" aria-hidden="true">
              <span>119</span>
              <strong>.7</strong>
              <i>µg/m³</i>
            </div>
            <div className="b-entry-bottom">
              <Sparkles size={17} />
              <h3>Learning Lab &amp; Gallery</h3>
              <p>
                Contrast city baselines side-by-side or open curated geographic compositions straight
                into Studio.
              </p>
            </div>
          </Link>
        </div>
      </section>

      <section className="b-overview-end b-container">
        <DataBadge label="NASA GEOS-CF v2 · Verified Provenance Policy" />
        <h2>Transparent environmental sound.</h2>
        <p>
          Surface PM2.5 (µg/m³) is evaluated at 35% relative humidity and stays strictly decoupled
          from dimensionless Aerosol Optical Depth (AOD) and AQI index scores.
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}
