"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Compass,
  Globe,
  Grid,
  Hand,
  Layers,
  Map as MapIcon,
  PenTool,
  Redo2,
  RotateCcw,
  Search,
  Shapes,
  Square,
  Tag,
  Undo2,
} from "lucide-react";
import { GeoMap, type MapDrawTool } from "@/components/breathe/GeoMap";
import {
  BasemapSwitcher,
  DataBadge,
  LayerList,
  Legend,
  SiteFooter,
  TerritorySelect,
  Timeline,
} from "@/components/breathe/SharedUI";
import { AudioTransport, RhythmGrid } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import {
  formatUtc,
  getLayerDefinition,
  searchablePlaces,
  timeSlots,
} from "@/lib/breatheData";
import { formatBounds, parseCoordinateQuery, zoomForBounds } from "@/lib/geoUtils";

export default function ExplorePage() {
  const {
    selection,
    territories,
    activeLayer,
    basemapMode,
    layerVisible,
    layerOpacity,
    showGrid,
    showLabels,
    timeIndex,
    camera,
    mapping,
    regionStats,
    canUndoPolygon,
    canRedoPolygon,
    setActiveLayer,
    setBasemapMode,
    setLayerVisible,
    setLayerOpacity,
    setShowGrid,
    setShowLabels,
    setTimeIndex,
    setCamera,
    flyTo,
    selectPreset,
    selectTerritory,
    selectTerritoryByCode,
    setPolygon,
    undoPolygon,
    redoPolygon,
    clearSelection,
    buildCompositionSpec,
  } = useBreathe();

  const [tab, setTab] = useState<"sound" | "data" | "about">("sound");
  const [drawTool, setDrawTool] = useState<MapDrawTool>("select");
  const [scanLocked, setScanLocked] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const layerDef = getLayerDefinition(activeLayer);
  const compositionSpec = useMemo(() => buildCompositionSpec(), [buildCompositionSpec]);

  useEffect(() => {
    if (!timelinePlaying) return;
    const id = window.setInterval(() => {
      setTimeIndex((prev) => (prev + 1) % timeSlots.length);
    }, 1500);
    return () => window.clearInterval(id);
  }, [timelinePlaying, setTimeIndex]);

  const matchingPlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedPlaces = !q
      ? searchablePlaces.slice(0, 6)
      : searchablePlaces.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.aliases.some((alias) => alias.includes(q))
        );

    const placeItems = matchedPlaces.slice(0, 6).map((p) => ({
      id: p.id,
      name: p.name,
      subtitle: `${p.point.lat.toFixed(2)}°, ${p.point.lon.toFixed(2)}°`,
      kind: "place" as const,
      place: p,
    }));

    if (!q) return placeItems;

    const coveredCodes = new Set(
      matchedPlaces.map((p) => p.territoryCode).filter((c): c is string => Boolean(c))
    );
    const territoryItems = territories
      .filter((t) => !coveredCodes.has(t.isoNumeric) && t.name.toLowerCase().includes(q))
      .slice(0, Math.max(0, 8 - placeItems.length))
      .map((t) => ({
        id: t.id,
        name: t.name,
        subtitle: "National border",
        kind: "territory" as const,
        isoNumeric: t.isoNumeric,
      }));

    return [...placeItems, ...territoryItems];
  }, [query, territories]);

  const handleSelectSuggestion = (item: (typeof matchingPlaces)[number]) => {
    if (scanLocked) return;
    setSearchError(null);
    setSearchFocused(false);
    setQuery(item.name);
    if (item.kind === "territory") {
      void selectTerritoryByCode(item.isoNumeric);
      return;
    }
    const found = item.place;
    if (found.selectionId) {
      selectPreset(found.selectionId);
    } else if (found.territoryCode) {
      void selectTerritoryByCode(found.territoryCode);
    } else {
      flyTo(found.point, found.zoom);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanLocked) return;
    const coord = parseCoordinateQuery(query);
    if (coord) {
      setSearchError(null);
      setSearchFocused(false);
      flyTo(coord, Math.max(4.2, camera.zoom));
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) return;
    const placeMatch = searchablePlaces.find(
      (p) =>
        p.name.toLowerCase() === q ||
        p.name.toLowerCase().includes(q) ||
        p.aliases.some((alias) => alias.includes(q))
    );
    if (placeMatch) {
      setSearchError(null);
      setSearchFocused(false);
      setQuery(placeMatch.name);
      if (placeMatch.selectionId) selectPreset(placeMatch.selectionId);
      else if (placeMatch.territoryCode) void selectTerritoryByCode(placeMatch.territoryCode);
      else flyTo(placeMatch.point, placeMatch.zoom);
      return;
    }
    const territoryMatch =
      territories.find((t) => t.name.toLowerCase() === q) ??
      territories.find((t) => t.name.toLowerCase().includes(q));
    if (territoryMatch) {
      setSearchError(null);
      setSearchFocused(false);
      setQuery(territoryMatch.name);
      void selectTerritoryByCode(territoryMatch.isoNumeric);
    } else {
      setSearchError(
        "Try a country (Vietnam, Germany, Brazil), city (Hanoi, Tokyo), or coordinates like 21.02, 105.85."
      );
    }
  };

  const activateTool = (nextTool: MapDrawTool) => {
    if (scanLocked) return;
    setDrawTool(nextTool);
    if (nextTool !== "select" && camera.mode === "globe") {
      setCamera({ mode: "flat", zoom: Math.max(3.6, camera.zoom) });
    }
  };

  const mapMode = camera.mode === "globe" ? "globe" : "flat";

  return (
    <div className="b-page">
      <div className="b-container b-explore-intro b-workspace-intro">
        <div>
          <h1>Earth Explorer</h1>
          <p>Browse territory borders overlaid with NASA air quality fields and click any country or draw a basin to hear its curve.</p>
        </div>
        <DataBadge label="NASA GEOS-CF v2 · 12 Nov 2026" />
      </div>

      <div className="b-container b-explore-toolbar">
        <div className="b-search-wrap">
          <form className="b-search" onSubmit={handleSearchSubmit}>
            <Search size={15} aria-hidden="true" />
            <input
              type="text"
              value={query}
              readOnly={scanLocked}
              aria-disabled={scanLocked || undefined}
              title={scanLocked ? "Close 2D Scan to search and move the map" : undefined}
              onFocus={() => {
                if (!scanLocked) setSearchFocused(true);
              }}
              onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
              onChange={(e) => {
                if (scanLocked) return;
                setQuery(e.target.value);
                setSearchError(null);
              }}
              placeholder="Search place or coordinates (Hanoi, Tokyo, 21.02, 105.85)..."
              aria-label="Search Earth place or coordinates"
            />
            <button
              type="submit"
              className="b-icon-button"
              aria-label="Go to location"
              aria-disabled={scanLocked || undefined}
              title={scanLocked ? "Close 2D Scan to jump to location" : "Go to location"}
            >
              <ArrowRight size={14} />
            </button>
          </form>

          {!scanLocked && searchFocused && matchingPlaces.length > 0 && (
            <div className="b-search-suggestions" role="listbox" aria-label="Suggested Earth locations">
              {matchingPlaces.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="b-search-suggestion"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSuggestion(item);
                  }}
                >
                  <span>{item.name}</span>
                  <small>{item.subtitle}</small>
                </button>
              ))}
            </div>
          )}

          {searchError && <div className="b-search-error">{searchError}</div>}
        </div>

        <BasemapSwitcher value={basemapMode} onChange={setBasemapMode} />

        <div className="b-segmented" role="group" aria-label="Projection mode">
          <button
            type="button"
            className={mapMode === "globe" ? "is-active" : undefined}
            onClick={() => setCamera({ mode: "globe", zoom: Math.min(3.4, camera.zoom) })}
          >
            <Globe size={14} /> 3D globe
          </button>
          <button
            type="button"
            className={mapMode === "flat" ? "is-active" : undefined}
            onClick={() => {
              if (mapMode === "flat" || scanLocked) return;
              setCamera({
                mode: "flat",
                center: selection.center,
                zoom: Math.max(2.0, zoomForBounds(selection.bounds) - 0.35),
              });
            }}
          >
            <MapIcon size={14} /> 2D map
          </button>
        </div>

        <button
          type="button"
          className="b-icon-button b-global-button"
          aria-disabled={scanLocked || undefined}
          onClick={() => {
            if (scanLocked) return;
            if (mapMode === "flat") {
              setCamera({
                mode: "flat",
                center: { lat: 15, lon: 14 },
                zoom: 0.95,
              });
            } else {
              setCamera({
                mode: "globe",
                center: { lat: 21.1, lon: 105.75 },
                zoom: 2.35,
              });
            }
          }}
          title={
            scanLocked
              ? "Viewport locked during 2D scan — close scan to move"
              : mapMode === "flat"
              ? "Full flat world view"
              : "Reset global view"
          }
          aria-label={mapMode === "flat" ? "Full flat world view" : "Reset global overview"}
        >
          <Compass size={16} />
        </button>
      </div>

      <div className="b-explore-grid b-container">
        <aside className="b-explore-sidebar">
          <div className="b-sidebar-section">
            <div className="b-sidebar-title">
              <Layers size={15} />
              <h2>Data layers</h2>
            </div>
            <p className="b-muted b-tabular" style={{ fontSize: 11, margin: "0 0 8px" }}>
              {formatUtc(timeSlots[timeIndex] ?? timeSlots[0])}
            </p>
            <LayerList
              value={activeLayer}
              onChange={setActiveLayer}
              layerVisible={layerVisible}
              onToggleVisible={() => setLayerVisible(!layerVisible)}
              layerOpacity={layerOpacity}
              onOpacityChange={setLayerOpacity}
            />
          </div>

          <div className="b-sidebar-section">
            <div className="b-sidebar-title">
              <PenTool size={15} />
              <h2>Region tools</h2>
            </div>

            <div className="b-inline-draw-bar" role="group" aria-label="Region selection tools">
              <button
                type="button"
                className={`b-inline-tool ${drawTool === "select" ? "is-active" : ""}`}
                aria-disabled={scanLocked || undefined}
                onClick={() => activateTool("select")}
                title={scanLocked ? "Close 2D Scan to change tools" : "Pan map and drag vertices"}
              >
                <Hand size={12} /> Select
              </button>
              <button
                type="button"
                className={`b-inline-tool ${drawTool === "polygon" ? "is-active" : ""}`}
                aria-disabled={scanLocked || undefined}
                onClick={() => activateTool("polygon")}
                title={scanLocked ? "Close 2D Scan to draw polygon" : "Click points to trace custom polygon"}
              >
                <Shapes size={12} /> Polygon
              </button>
              <button
                type="button"
                className={`b-inline-tool ${drawTool === "rectangle" ? "is-active" : ""}`}
                aria-disabled={scanLocked || undefined}
                onClick={() => activateTool("rectangle")}
                title={scanLocked ? "Close 2D Scan to draw box" : "Drag a bounding box"}
              >
                <Square size={12} /> Box
              </button>
              <button
                type="button"
                className={`b-inline-tool ${drawTool === "freehand" ? "is-active" : ""}`}
                aria-disabled={scanLocked || undefined}
                onClick={() => activateTool("freehand")}
                title={scanLocked ? "Close 2D Scan to sketch boundary" : "Sketch freehand boundary"}
              >
                <PenTool size={12} /> Freehand
              </button>
              <button
                type="button"
                className="b-inline-tool"
                onClick={() => {
                  if (!scanLocked) undoPolygon();
                }}
                disabled={!canUndoPolygon}
                aria-disabled={scanLocked || undefined}
                title={scanLocked ? "Close 2D Scan to undo edit" : "Undo region edit"}
                aria-label="Undo region edit"
              >
                <Undo2 size={12} />
              </button>
              <button
                type="button"
                className="b-inline-tool"
                onClick={() => {
                  if (!scanLocked) redoPolygon();
                }}
                disabled={!canRedoPolygon}
                aria-disabled={scanLocked || undefined}
                title={scanLocked ? "Close 2D Scan to redo edit" : "Redo region edit"}
                aria-label="Redo region edit"
              >
                <Redo2 size={12} />
              </button>
              <button
                type="button"
                className="b-inline-tool"
                onClick={() => {
                  if (!scanLocked) clearSelection();
                }}
                disabled={selection.polygon.length === 0}
                aria-disabled={scanLocked || undefined}
                title={scanLocked ? "Close 2D Scan to clear selection" : "Clear selection"}
                aria-label="Clear selection"
              >
                <RotateCcw size={12} />
              </button>
            </div>

            <label className="b-field-label">
              Territory / region
              <TerritorySelect
                selection={selection}
                territories={territories}
                onSelectValue={selectPreset}
                ariaLabel="Select territory or region"
                disabled={scanLocked}
                title={scanLocked ? "Close 2D Scan to switch territory" : undefined}
              />
            </label>

            <Link href="/explore/region" className="b-tool-link">
              <PenTool size={14} />
              <span>Precision editor &amp; stats</span>
              <ArrowRight size={14} />
            </Link>

            <div className="b-tool-divider" />

            <label className="b-toggle-row">
              <Grid size={14} />
              <span>Show grid</span>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span className="b-switch" aria-hidden="true" />
            </label>

            <label className="b-toggle-row">
              <Tag size={14} />
              <span>Show labels</span>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
              <span className="b-switch" aria-hidden="true" />
            </label>
          </div>
        </aside>

        <section className="b-explore-map" aria-label="Interactive Earth air quality canvas">
          {!scanLocked && drawTool !== "select" && (
            <div className="b-map-hint">
              {drawTool === "polygon"
                ? "Click vertices to outline region · Click green start point or Finish"
                : drawTool === "rectangle"
                ? "Drag across map to outline box · Press Esc to cancel"
                : "Sketch region boundary smoothly · Press Esc to cancel"}
            </div>
          )}

          <div className="b-map-selection">
            <span>
              {selection.boundaryKind === "drawn" ? "DRAWN BOUNDARY" : "NATIONAL BORDER"}
            </span>
            <strong>{selection.name}</strong>
            <small className="b-tabular">
              {selection.areaKm2 > 0
                ? `${selection.boundaryKind === "drawn" ? "Custom polygon" : "Admin-0"} · ${selection.areaKm2.toLocaleString()} km²`
                : "Click a country or draw a region"}
            </small>
          </div>

          <GeoMap
            mode={mapMode}
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
            onSelectTerritory={selectTerritory}
            tool={drawTool}
            onToolComplete={() => setDrawTool("select")}
            onSelectStation={(_id, name, lat, lon) => {
              if (scanLocked) return;
              flyTo({ lat, lon }, Math.max(4.8, camera.zoom));
              setQuery(name);
            }}
            onScanLockChange={setScanLocked}
            showGrid={showGrid}
            showLabels={showLabels}
            showScaleBar
            mapping={mapping}
          />

          <Legend layerKey={activeLayer} />
        </section>

        <aside className="b-preview-panel">
          <div className="b-preview-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "sound"}
              className={tab === "sound" ? "is-active" : undefined}
              onClick={() => setTab("sound")}
            >
              Sound preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "data"}
              className={tab === "data" ? "is-active" : undefined}
              onClick={() => setTab("data")}
            >
              Region data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "about"}
              className={tab === "about" ? "is-active" : undefined}
              onClick={() => setTab("about")}
            >
              About
            </button>
          </div>

          {tab === "sound" && (
            <div className="b-preview-content">
              <h2>{selection.name}</h2>
              <p className="b-muted b-tabular">{formatUtc(timeSlots[timeIndex] ?? timeSlots[0])}</p>

              <AudioTransport
                compact
                title={`${layerDef.short} point tone preview`}
                spec={compositionSpec}
                onStepSlot={(delta) =>
                  setTimeIndex((prev) => (prev + delta + timeSlots.length) % timeSlots.length)
                }
              />

              <div className="b-preview-divider" />

              <div className="b-between">
                <strong>From data to rhythm</strong>
                <span className="b-muted b-tabular">1 bar · 4 beats</span>
              </div>

              <RhythmGrid rows={[layerDef.short, "Timbre", "ΔRate"]} spec={compositionSpec} />

              <div className="b-science-note">
                {regionStats.mean !== null
                  ? `Mean ${layerDef.short} in ${selection.name} is ${regionStats.mean.toFixed(1)} ${layerDef.unit} (peak ${regionStats.max?.toFixed(1) ?? "—"}).`
                  : regionStats.sourceLabel}{" "}
                Column AOD remains independent and adjusts timbre when connected.
              </div>

              <Link href="/studio" className="b-button b-button-primary b-full-button">
                <span>Open Sonification Studio</span>
                <ArrowRight size={15} />
              </Link>
              <p className="b-footnote">{regionStats.sourceLabel} · Web Audio synthesizer</p>
            </div>
          )}

          {tab === "data" && (
            <div className="b-preview-content">
              <h2>{selection.name}</h2>
              <p className="b-muted b-tabular">{formatBounds(selection.bounds)}</p>

              <div className="b-metric-list">
                <div>
                  <span>Mean ({layerDef.short})</span>
                  <strong className="b-tabular">
                    {regionStats.loading
                      ? "Sampling…"
                      : regionStats.mean !== null
                      ? `${regionStats.mean.toFixed(1)} ${regionStats.unit}`
                      : "Awaiting data"}
                  </strong>
                </div>
                <div>
                  <span>Min / Max</span>
                  <strong className="b-tabular">
                    {regionStats.min !== null && regionStats.max !== null
                      ? `${regionStats.min.toFixed(1)} – ${regionStats.max.toFixed(1)} ${regionStats.unit}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>P90 Peak</span>
                  <strong className="b-tabular">
                    {regionStats.p90 !== null
                      ? `${regionStats.p90.toFixed(1)} ${regionStats.unit}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Area &amp; Cells</span>
                  <strong className="b-tabular">
                    {selection.areaKm2.toLocaleString()} km² ({regionStats.sampleCount})
                  </strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>{regionStats.sourceLabel}</strong>
                </div>
              </div>

              <div className="b-science-note">
                Scale {layerDef.short}: {layerDef.vmin}–{layerDef.vmax} {layerDef.unit}.{" "}
                {layerDef.methodologyNote}
              </div>

              <Link href="/studio" className="b-button b-button-primary b-full-button">
                <span>Open in Studio</span>
                <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {tab === "about" && (
            <div className="b-preview-content">
              <h2>{layerDef.label}</h2>
              <p className="b-muted">{layerDef.description}</p>
              <div className="b-about-callout">
                <strong>Policy note:</strong> {layerDef.methodologyNote} Dimensionless Aerosol
                Optical Depth (AOD) and Air Quality Index (AQI) are never substituted for surface{" "}
                {layerDef.short}.
              </div>
              <Link href="/learn" className="b-button b-button-secondary b-full-button">
                <span>Explore methods in Learning Lab</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </aside>
      </div>

      <div className="b-container b-explore-timeline">
        <Timeline
          timeIndex={timeIndex}
          onChange={setTimeIndex}
          playing={timelinePlaying}
          onTogglePlay={() => setTimelinePlaying((v) => !v)}
        />
      </div>

      <SiteFooter />
    </div>
  );
}
