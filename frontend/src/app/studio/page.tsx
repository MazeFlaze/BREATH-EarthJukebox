"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookmarkCheck,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Minus,
  Plus,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import { GeoMap } from "@/components/breathe/GeoMap";
import {
  BasemapSwitcher,
  DataBadge,
  Legend,
  SiteFooter,
  TerritorySelect,
  Timeline,
} from "@/components/breathe/SharedUI";
import {
  AudioTransport,
  ParticleField,
  RhythmGrid,
  Spectrogram,
  Waveform,
} from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { useAudioClock } from "@/hooks/useSonification";
import { getLayerDefinition, layers, timeSlots } from "@/lib/breatheData";
import { zoomForBounds } from "@/lib/geoUtils";
import type { BreatheProjectFile } from "@/types/breathe";
import type { OscillatorWaveform } from "@/types/audio";

const MUSICAL_KEYS = ["A minor", "C major", "D minor", "G major", "E minor"];
const WAVEFORMS: OscillatorWaveform[] = ["sine", "triangle", "sawtooth", "square"];

export default function StudioPage() {
  const {
    selection,
    territories,
    activeLayer,
    basemapMode,
    layerVisible,
    layerOpacity,
    timeIndex,
    mapping,
    regionStats,
    setActiveLayer,
    setBasemapMode,
    setLayerVisible,
    setLayerOpacity,
    setTimeIndex,
    selectPreset,
    selectTerritory,
    setPolygon,
    updateMapping,
    saveWorkToGallery,
    exportProjectFile,
    importProjectFile,
    buildCompositionSpec,
  } = useBreathe();

  const clock = useAudioClock();
  const [vizTab, setVizTab] = useState<"waveform" | "spectrogram" | "rhythm" | "particles">("waveform");
  const [scanLocked, setScanLocked] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const layerDef = getLayerDefinition(activeLayer);
  const compositionSpec = useMemo(() => buildCompositionSpec(), [buildCompositionSpec]);
  const fittedZoom = useMemo(() => zoomForBounds(selection.bounds), [selection.bounds]);

  useEffect(() => {
    if (!timelinePlaying) return;
    const id = window.setInterval(() => {
      setTimeIndex((prev) => (prev + 1) % timeSlots.length);
    }, 1500);
    return () => window.clearInterval(id);
  }, [timelinePlaying, setTimeIndex]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleSaveToGallery = () => {
    const saved = saveWorkToGallery();
    setNotice(`Saved "${saved.title}" to Gallery · My Works`);
  };

  const handleExportJson = () => {
    const project = exportProjectFile();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selection.id || "breathe-project"}.breathe.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Exported .breathe.json project");
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BreatheProjectFile;
      importProjectFile(parsed);
      setNotice(`Loaded "${parsed.name || file.name}"`);
    } catch {
      setNotice("Could not parse .breathe.json file");
    } finally {
      e.target.value = "";
    }
  };

  const handleShare = async () => {
    const params = new URLSearchParams({
      region: selection.id,
      layer: activeLayer,
      t: String(timeIndex),
      tempo: String(mapping.tempo),
      key: mapping.musicalKey,
    });
    const url = `${window.location.origin}/studio?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Copied Studio URL to clipboard");
    } catch {
      setNotice("Share parameters ready in browser URL");
    }
  };

  return (
    <div className="b-page">
      <div className="b-container b-studio-intro b-workspace-intro">
        <div>
          <h1>Sonification Studio</h1>
          <p>Shape territory-level NASA atmospheric measurements into an audible composition.</p>
        </div>

        <div className="b-studio-actions">
          {notice && (
            <span className="b-toast-banner" role="status">
              <BookmarkCheck size={13} /> {notice}
            </span>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.breathe.json"
            onChange={handleImportFile}
            hidden
          />

          <button
            type="button"
            className="b-button b-button-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen size={14} /> Open project
          </button>

          <button type="button" className="b-button b-button-secondary" onClick={handleShare}>
            <Share2 size={14} /> Share
          </button>

          <button
            type="button"
            className="b-button b-button-secondary"
            onClick={handleExportJson}
            title="Download .breathe.json project configuration"
          >
            <Download size={14} /> Export
          </button>

          <button type="button" className="b-button b-button-primary" onClick={handleSaveToGallery}>
            <BookmarkCheck size={14} /> Save
          </button>
        </div>
      </div>

      <div className="b-studio-grid b-container">
        <section className="b-studio-left">
          <div className="b-studio-map-card">
            <div className="b-studio-map-bar">
              <Link href="/explore/region" className="b-button b-button-secondary">
                <span>Edit boundary</span>
                <ArrowRight size={14} />
              </Link>

              <TerritorySelect
                className="b-studio-select"
                ariaLabel="Active geographic region"
                selection={selection}
                territories={territories}
                disabled={scanLocked}
                title={scanLocked ? "Close 2D Scan to switch territory" : undefined}
                onSelectValue={selectPreset}
              />

              <BasemapSwitcher compact value={basemapMode} onChange={setBasemapMode} />

              <DataBadge label={regionStats.sourceLabel} />
            </div>

            <div className="b-studio-layer-bar" role="region" aria-label="Atmospheric layer controls">
              <div className="b-studio-var-strip" role="radiogroup" aria-label="Atmospheric variable">
                {layers.map((item) => {
                  const active = item.key === activeLayer;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={active ? "is-active" : undefined}
                      disabled={!item.available}
                      title={!item.available ? item.methodologyNote : item.label}
                      onClick={() => {
                        if (item.available) setActiveLayer(item.key);
                      }}
                    >
                      {item.short}
                    </button>
                  );
                })}
              </div>

              <div className="b-studio-opacity-inline">
                <button
                  type="button"
                  className="b-eye-btn"
                  onClick={() => setLayerVisible(!layerVisible)}
                  aria-label={layerVisible ? `Hide ${layerDef.short} field` : `Show ${layerDef.short} field`}
                  title={layerVisible ? "Hide overlay" : "Show overlay"}
                >
                  {layerVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <input
                  type="range"
                  min={0.15}
                  max={0.95}
                  step={0.05}
                  value={layerOpacity}
                  disabled={!layerVisible}
                  onChange={(e) => setLayerOpacity(Number(e.target.value))}
                  aria-label={`${layerDef.short} field opacity`}
                />
                <span className="b-tabular">{layerVisible ? `${Math.round(layerOpacity * 100)}%` : "Off"}</span>
              </div>
            </div>

            <div className="b-studio-map">
              <GeoMap
                mode="flat"
                basemapMode={basemapMode}
                layer={activeLayer}
                layerVisible={layerVisible}
                layerOpacity={layerOpacity}
                timeIndex={timeIndex}
                center={selection.center}
                zoom={Math.max(1.4, fittedZoom)}
                polygon={selection.polygon}
                boundaryGeometry={selection.boundaryGeometry}
                boundaryKind={selection.boundaryKind}
                onPolygonChange={(pts) => setPolygon(pts, "Edited Studio region", "custom")}
                onSelectTerritory={selectTerritory}
                onScanLockChange={setScanLocked}
                tool="select"
                showLabels
                showScaleBar
                mapping={mapping}
              />

              <Legend layerKey={activeLayer} />
            </div>
          </div>

          <Timeline
            timeIndex={timeIndex}
            onChange={setTimeIndex}
            playing={timelinePlaying}
            onTogglePlay={() => setTimelinePlaying((v) => !v)}
          />
        </section>

        <aside className="b-studio-right">
          <div className="b-sound-panel">
            <div className="b-panel-heading">
              <div>
                <h2>{selection.name}</h2>
              </div>
              <span className="b-sound-context b-tabular">
                {layerDef.short} → sound
              </span>
            </div>

            <AudioTransport
              title={`${selection.name} · ${layerDef.short}`}
              spec={compositionSpec}
              onStepSlot={(delta) =>
                setTimeIndex((prev) => (prev + delta + timeSlots.length) % timeSlots.length)
              }
            />

            <div className="b-viz-tabs" role="tablist" aria-label="Sound visualization view">
              {(["waveform", "spectrogram", "rhythm", "particles"] as const).map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  role="tab"
                  aria-selected={vizTab === tabKey}
                  className={vizTab === tabKey ? "is-active" : undefined}
                  onClick={() => setVizTab(tabKey)}
                >
                  {tabKey[0].toUpperCase() + tabKey.slice(1)}
                </button>
              ))}
            </div>

            <div className="b-viz-stage">
              {vizTab === "waveform" && <Waveform spec={compositionSpec} />}
              {vizTab === "spectrogram" && <Spectrogram spec={compositionSpec} />}
              {vizTab === "rhythm" && (
                <RhythmGrid rows={[layerDef.short, "Timbre", "ΔRate"]} spec={compositionSpec} />
              )}
              {vizTab === "particles" && <ParticleField spec={compositionSpec} />}
            </div>

            <div className="b-sound-telemetry b-tabular">
              <div>
                <span>Region mean</span>
                <strong>
                  {regionStats.mean !== null ? `${regionStats.mean.toFixed(1)} ${regionStats.unit}` : "—"}
                </strong>
              </div>
              <div>
                <span>Peak (P90)</span>
                <strong>
                  {regionStats.p90 !== null ? `${regionStats.p90.toFixed(1)} ${regionStats.unit}` : "—"}
                </strong>
              </div>
              <div>
                <span>Synthesis</span>
                <strong>
                  {clock.playbackState === "playing"
                    ? `${clock.activeFrequencyHz.toFixed(1)} Hz · ${clock.currentStep + 1}/16`
                    : `${mapping.tempo} BPM · ${mapping.musicalKey}`}
                </strong>
              </div>
            </div>
          </div>

          <div className="b-studio-controls">
            <div className="b-mapping-panel">
              <div className="b-sidebar-title">
                <SlidersHorizontal size={14} />
                <h2>Data-to-sound mapping</h2>
              </div>

              <label className="b-mapping-row">
                <div>
                  <strong>{layerDef.short} level</strong>
                  <small>Surface mass</small>
                </div>
                <span>→ Rhythm</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.02}
                  value={mapping.density}
                  onChange={(e) => updateMapping({ density: Number(e.target.value) })}
                />
                <output className="b-tabular">{Math.round(mapping.density * 100)}%</output>
              </label>

              <label className="b-mapping-row">
                <div>
                  <strong>AOD / texture</strong>
                  <small>Filter shimmer</small>
                </div>
                <span>→ Timbre</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.02}
                  value={mapping.brightness}
                  onChange={(e) => updateMapping({ brightness: Number(e.target.value) })}
                />
                <output className="b-tabular">{Math.round(mapping.brightness * 100)}%</output>
              </label>

              <label className="b-mapping-row">
                <div>
                  <strong>Change rate</strong>
                  <small>Diurnal Δ slope</small>
                </div>
                <span>→ Pitch</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.02}
                  value={mapping.pitchSensitivity}
                  onChange={(e) => updateMapping({ pitchSensitivity: Number(e.target.value) })}
                />
                <output className="b-tabular">{Math.round(mapping.pitchSensitivity * 100)}%</output>
              </label>

              <label className="b-mapping-row">
                <div>
                  <strong>Spatial gradient</strong>
                  <small>Basin spread</small>
                </div>
                <span>→ Stereo</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={mapping.spatialSpread}
                  onChange={(e) => updateMapping({ spatialSpread: Number(e.target.value) })}
                />
                <output className="b-tabular">{Math.round(mapping.spatialSpread * 100)}%</output>
              </label>
            </div>

            <div className="b-settings-panel">
              <div>
                <span>TEMPO</span>
                <strong className="b-tabular">
                  {mapping.tempo}
                  <small> BPM</small>
                </strong>
                <div>
                  <button
                    type="button"
                    aria-label="Decrease tempo"
                    onClick={() => updateMapping({ tempo: Math.max(56, mapping.tempo - 4) })}
                  >
                    <Minus size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Increase tempo"
                    onClick={() => updateMapping({ tempo: Math.min(160, mapping.tempo + 4) })}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>

              <label>
                KEY
                <select
                  value={mapping.musicalKey}
                  onChange={(e) => updateMapping({ musicalKey: e.target.value })}
                  aria-label="Musical scale key"
                >
                  {MUSICAL_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                WAVEFORM
                <select
                  value={mapping.waveform}
                  onChange={(e) =>
                    updateMapping({ waveform: e.target.value as OscillatorWaveform })
                  }
                  aria-label="Oscillator waveform"
                >
                  {WAVEFORMS.map((wf) => (
                    <option key={wf} value={wf}>
                      {wf}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}
