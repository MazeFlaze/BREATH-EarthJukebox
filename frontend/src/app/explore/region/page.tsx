"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Hand,
  Info,
  PenTool,
  Redo2,
  RotateCcw,
  Shapes,
  SlidersHorizontal,
  Square,
  Undo2,
} from "lucide-react";
import { GeoMap, type MapDrawTool } from "@/components/breathe/GeoMap";
import { BasemapSwitcher, DataBadge, Legend, SiteFooter, TerritorySelect, Timeline } from "@/components/breathe/SharedUI";
import { AudioTransport } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { getLayerDefinition, timeSlots } from "@/lib/breatheData";
import { formatBounds, zoomForBounds } from "@/lib/geoUtils";

export default function RegionPage() {
  const {
    selection,
    territories,
    activeLayer,
    getLayerRestriction,
    basemapMode,
    layerVisible,
    layerOpacity,
    timeIndex,
    camera,
    mapping,
    regionStats,
    canUndoPolygon,
    canRedoPolygon,
    setTimeIndex,
    setBasemapMode,
    setPolygon,
    selectTerritory,
    convertBoundaryToEditableSketch,
    selectPreset,
    undoPolygon,
    redoPolygon,
    clearSelection,
    setCamera,
    buildCompositionSpec,
  } = useBreathe();

  const [tool, setTool] = useState<MapDrawTool>("select");
  const [scanLocked, setScanLocked] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const didFrameOnMountRef = useRef(false);

  const layerDef = getLayerDefinition(activeLayer);
  const pm25Restriction = getLayerRestriction("PM25_RH35");
  const spec = useMemo(() => buildCompositionSpec(), [buildCompositionSpec]);

  useEffect(() => {
    if (didFrameOnMountRef.current) return;
    didFrameOnMountRef.current = true;
    setCamera({
      center: selection.center,
      zoom: Math.max(2.0, zoomForBounds(selection.bounds)),
    });
  }, [selection.center, selection.bounds, setCamera]);

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
              {scanLocked
                ? "2D viewport locked during scan — close 2D Scan (×) to pan, zoom, or edit boundary."
                : tool === "polygon"
                ? "Click map to place vertices · Click green origin point or double-click to close."
                : tool === "rectangle"
                ? "Click and drag on map to define a bounding box."
                : tool === "freehand"
                ? "Hold pointer down and sketch boundary smoothly."
                : "Drag any vertex handle, click edge + handles to insert nodes, or click a country to outline."}
            </div>
            <DataBadge label={regionStats.sourceLabel} />
          </div>

          {pm25Restriction && (
            <div className="b-layer-restriction-note is-compact" role="status" aria-live="polite">
              <Info size={13} aria-hidden="true" />
              <span>{pm25Restriction.notice}</span>
            </div>
          )}

          <div className="b-region-map">
            <div className="b-draw-toolbar" role="toolbar" aria-label="Polygon drawing tools">
              <button
                type="button"
                className={tool === "select" ? "is-active" : undefined}
                aria-disabled={scanLocked || undefined}
                onClick={() => {
                  if (!scanLocked) setTool("select");
                }}
                title={scanLocked ? "Close 2D Scan to pan or edit vertices" : "Pan map and edit vertices"}
              >
                <Hand size={15} />
                <span>Select</span>
              </button>
              <button
                type="button"
                className={tool === "polygon" ? "is-active" : undefined}
                aria-disabled={scanLocked || undefined}
                onClick={() => {
                  if (!scanLocked) setTool("polygon");
                }}
                title={scanLocked ? "Close 2D Scan to draw polygon" : "Plot custom polygon vertices"}
              >
                <Shapes size={15} />
                <span>Polygon</span>
              </button>
              <button
                type="button"
                className={tool === "rectangle" ? "is-active" : undefined}
                aria-disabled={scanLocked || undefined}
                onClick={() => {
                  if (!scanLocked) setTool("rectangle");
                }}
                title={scanLocked ? "Close 2D Scan to draw box" : "Drag geographic rectangle"}
              >
                <Square size={15} />
                <span>Box</span>
              </button>
              <button
                type="button"
                className={tool === "freehand" ? "is-active" : undefined}
                aria-disabled={scanLocked || undefined}
                onClick={() => {
                  if (!scanLocked) setTool("freehand");
                }}
                title={scanLocked ? "Close 2D Scan to sketch boundary" : "Sketch freehand region"}
              >
                <PenTool size={15} />
                <span>Freehand</span>
              </button>
              <span className="b-draw-divider" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  if (!scanLocked) undoPolygon();
                }}
                disabled={!canUndoPolygon}
                aria-disabled={scanLocked || undefined}
                title={scanLocked ? "Close 2D Scan to undo edit" : "Undo last boundary edit"}
              >
                <Undo2 size={14} />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!scanLocked) redoPolygon();
                }}
                disabled={!canRedoPolygon}
                aria-disabled={scanLocked || undefined}
                title={scanLocked ? "Close 2D Scan to redo edit" : "Redo boundary edit"}
              >
                <Redo2 size={14} />
                <span>Redo</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!scanLocked) clearSelection();
                }}
                disabled={selection.polygon.length === 0}
                aria-disabled={scanLocked || undefined}
                title={scanLocked ? "Close 2D Scan to clear selection" : "Clear active region"}
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
              center={camera.center}
              zoom={camera.zoom}
              onCameraChange={(nextCenter, nextZoom) =>
                setCamera({ center: nextCenter, zoom: nextZoom })
              }
              polygon={selection.polygon}
              boundaryGeometry={selection.boundaryGeometry}
              boundaryKind={selection.boundaryKind}
              onPolygonChange={(pts) => setPolygon(pts, "Custom drawn region", "custom")}
              onSelectTerritory={(territory) => {
                selectTerritory(territory);
                setTool("select");
              }}
              onScanLockChange={setScanLocked}
              tool={tool}
              onToolComplete={() => setTool("select")}
              showLabels
              showScaleBar
              mapping={mapping}
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
            Territory / region
            <TerritorySelect
              selection={selection}
              territories={territories}
              disabled={scanLocked}
              title={scanLocked ? "Close 2D Scan to switch territory" : undefined}
              onSelectValue={(val) => {
                selectPreset(val);
                setTool("select");
              }}
              ariaLabel="Select region or territory"
            />
          </label>

          <div className="b-metric-list">
            <div>
              <span>Boundary mode</span>
              <strong>
                {selection.areaKm2 === 0
                  ? "—"
                  : selection.boundaryKind === "drawn"
                  ? "Editable custom sketch"
                  : "National border (Admin-0)"}
              </strong>
            </div>
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

          {selection.boundaryKind !== "drawn" && selection.polygon.length >= 3 && (
            <button
              type="button"
              className="b-button b-button-secondary b-full-button"
              aria-disabled={scanLocked || undefined}
              title={scanLocked ? "Close 2D Scan to convert boundary" : undefined}
              onClick={() => {
                if (scanLocked) return;
                convertBoundaryToEditableSketch();
                setTool("select");
              }}
            >
              <PenTool size={14} />
              <span>Convert to editable sketch</span>
            </button>
          )}

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
