"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Hand,
  PenTool,
  Redo2,
  RotateCcw,
  Shapes,
  SlidersHorizontal,
  Square,
  Undo2,
} from "lucide-react";
import { GeoMap, type MapDrawTool } from "@/components/breathe/GeoMap";
import { BasemapSwitcher, DataBadge, Legend, SiteFooter, Timeline } from "@/components/breathe/SharedUI";
import { AudioTransport } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { getLayerDefinition, presetSelections, timeSlots } from "@/lib/breatheData";
import { formatBounds } from "@/lib/geoUtils";

export default function RegionPage() {
  const {
    selection,
    activeLayer,
    basemapMode,
    layerVisible,
    layerOpacity,
    timeIndex,
    camera,
    regionStats,
    canUndoPolygon,
    canRedoPolygon,
    setTimeIndex,
    setBasemapMode,
    setPolygon,
    flyTo,
    selectPreset,
    undoPolygon,
    redoPolygon,
    clearSelection,
    setCamera,
    buildCompositionSpec,
  } = useBreathe();

  const [tool, setTool] = useState<MapDrawTool>("polygon");
  const [timelinePlaying, setTimelinePlaying] = useState(false);

  const layerDef = getLayerDefinition(activeLayer);
  const spec = useMemo(() => buildCompositionSpec(), [buildCompositionSpec]);

  useEffect(() => {
    if (!timelinePlaying) return;
    const id = window.setInterval(() => {
      setTimeIndex((prev) => (prev + 1) % timeSlots.length);
    }, 1500);
    return () => window.clearInterval(id);
  }, [timelinePlaying, setTimeIndex]);

  return (
    <div className="b-page">
      <div className="b-container b-region-intro b-workspace-intro">
        <div>
          <Link href="/explore" className="b-back-link">
            <ArrowLeft size={14} /> Back to Explore
          </Link>
          <h1>Region boundary editor</h1>
          <p>
            Outline a basin or coastline over vector borders, or drag vertices directly before composing.
          </p>
        </div>
        <BasemapSwitcher value={basemapMode} onChange={setBasemapMode} />
      </div>

      <div className="b-region-layout b-container">
        <div className="b-region-workspace">
          <div className="b-region-toolbar">
            <div className="b-region-tool-hint">
              {tool === "polygon" &&
                "Click map to place vertices · Click green origin point or double-click to close."}
              {tool === "rectangle" && "Click and drag on map to define a bounding box."}
              {tool === "freehand" && "Hold pointer down and sketch boundary smoothly."}
              {tool === "select" &&
                "Drag any vertex handle, click edge + handles to insert nodes, or click a country to outline."}
            </div>
            <DataBadge label={regionStats.sourceLabel} />
          </div>

          <div className="b-region-map">
            <div className="b-draw-toolbar" role="toolbar" aria-label="Polygon drawing tools">
              <button
                type="button"
                className={tool === "select" ? "is-active" : undefined}
                onClick={() => setTool("select")}
                title="Pan map and edit vertices"
              >
                <Hand size={15} />
                <span>Select</span>
              </button>
              <button
                type="button"
                className={tool === "polygon" ? "is-active" : undefined}
                onClick={() => setTool("polygon")}
                title="Plot custom polygon vertices"
              >
                <Shapes size={15} />
                <span>Polygon</span>
              </button>
              <button
                type="button"
                className={tool === "rectangle" ? "is-active" : undefined}
                onClick={() => setTool("rectangle")}
                title="Drag geographic rectangle"
              >
                <Square size={15} />
                <span>Box</span>
              </button>
              <button
                type="button"
                className={tool === "freehand" ? "is-active" : undefined}
                onClick={() => setTool("freehand")}
                title="Sketch freehand region"
              >
                <PenTool size={15} />
                <span>Freehand</span>
              </button>
              <span className="b-draw-divider" aria-hidden="true" />
              <button
                type="button"
                onClick={undoPolygon}
                disabled={!canUndoPolygon}
                title="Undo last boundary edit"
              >
                <Undo2 size={14} />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={redoPolygon}
                disabled={!canRedoPolygon}
                title="Redo boundary edit"
              >
                <Redo2 size={14} />
                <span>Redo</span>
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selection.polygon.length === 0}
                title="Clear active region"
              >
                <RotateCcw size={14} />
                <span>Clear</span>
              </button>
            </div>

            <GeoMap
              mode="flat"
              basemapMode={basemapMode}
              layer={activeLayer}
              layerVisible={layerVisible}
              layerOpacity={layerOpacity}
              timeIndex={timeIndex}
              center={selection.center}
              zoom={Math.max(4.0, camera.zoom)}
              onCameraChange={(nextCenter, nextZoom) =>
                setCamera({ mode: "flat", center: nextCenter, zoom: nextZoom })
              }
              polygon={selection.polygon}
              onPolygonChange={(pts) => setPolygon(pts, "Custom drawn region", "custom")}
              onSelectTerritory={(territory) => {
                setPolygon(territory.polygon, territory.name, "custom");
                flyTo(territory.center, Math.max(3.2, territory.zoom));
                setTool("select");
              }}
              tool={tool}
              onToolComplete={() => setTool("select")}
              showLabels
              showScaleBar
            />

            <div className="b-region-map-label">
              <span>ACTIVE BOUNDARY</span>
              <strong>{selection.name}</strong>
              <small className="b-tabular">
                {selection.areaKm2 > 0
                  ? `${selection.areaKm2.toLocaleString()} km² · ${selection.polygon.length} pts`
                  : "Draw or choose a preset"}
              </small>
            </div>

            <Legend layerKey={activeLayer} />
          </div>

          <Timeline
            timeIndex={timeIndex}
            onChange={setTimeIndex}
            playing={timelinePlaying}
            onTogglePlay={() => setTimelinePlaying((v) => !v)}
          />
        </div>

        <aside className="b-region-details">
          <div className="b-sidebar-title">
            <SlidersHorizontal size={15} />
            <h2>Selected boundary</h2>
          </div>

          <label className="b-field-label">
            Region preset
            <select
              className="b-text-input"
              value={presetSelections.some((p) => p.id === selection.id) ? selection.id : "custom"}
              onChange={(e) => {
                if (e.target.value !== "custom") {
                  selectPreset(e.target.value);
                  setTool("select");
                }
              }}
            >
              {presetSelections.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {!presetSelections.some((p) => p.id === selection.id) && (
                <option value="custom">{selection.name}</option>
              )}
            </select>
          </label>

          <div className="b-metric-list">
            <div>
              <span>Extent</span>
              <strong className="b-tabular">{formatBounds(selection.bounds)}</strong>
            </div>
            <div>
              <span>Estimated area</span>
              <strong className="b-tabular">
                {selection.areaKm2 > 0 ? `${selection.areaKm2.toLocaleString()} km²` : "—"}
              </strong>
            </div>
            <div>
              <span>Mean {layerDef.short}</span>
              <strong className="b-tabular">
                {regionStats.loading
                  ? "Sampling…"
                  : regionStats.mean !== null
                  ? `${regionStats.mean.toFixed(1)} ${regionStats.unit}`
                  : "Awaiting data"}
              </strong>
            </div>
            <div>
              <span>Range / P90</span>
              <strong className="b-tabular">
                {regionStats.min !== null && regionStats.max !== null
                  ? `${regionStats.min.toFixed(1)}–${regionStats.max.toFixed(1)} (P90: ${
                      regionStats.p90?.toFixed(1) ?? "—"
                    })`
                  : "—"}
              </strong>
            </div>
          </div>

          <AudioTransport compact title={`${selection.name} audition`} spec={spec} />

          <div className="b-science-note">
            Polygon area statistics sample the active NASA GEOS-CF raster directly within your drawn
            vertices and remain decoupled from index scales (AQI).
          </div>

          <Link href="/studio" className="b-button b-button-primary b-full-button">
            <span>Open Sonification Studio</span>
            <ArrowRight size={15} />
          </Link>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}
