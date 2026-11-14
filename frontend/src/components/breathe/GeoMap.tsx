"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Plus, Minus, Compass, Maximize2, Check, X } from "lucide-react";
import { getLayerDefinition, observations, presetSelections } from "@/lib/breatheData";
import { registerBreatheMapProtocol } from "@/lib/geosCfRaster";
import { clampLat, computeBounds, normalizeLon, polygonToGeoJSONFeature, simplifyPolygon } from "@/lib/geoUtils";
import {
  extractTerritoryPolygon,
  loadWorldBoundaries,
  type CountryFeatureProperties,
  type WorldBoundaryBundle,
} from "@/lib/worldBoundaries";
import type { BasemapMode, GeoPoint, LayerKey } from "@/types/breathe";

export type MapDrawTool = "select" | "polygon" | "rectangle" | "freehand";

export interface TerritorySelectionPayload {
  name: string;
  polygon: GeoPoint[];
  center: GeoPoint;
  zoom: number;
}

type GeoMapProps = {
  mode?: "globe" | "flat";
  basemapMode?: BasemapMode;
  layer: LayerKey;
  layerVisible?: boolean;
  layerOpacity?: number;
  timeIndex: number;
  center?: GeoPoint;
  zoom?: number;
  polygon?: GeoPoint[];
  onPolygonChange?: (points: GeoPoint[]) => void;
  onSelectTerritory?: (territory: TerritorySelectionPayload) => void;
  tool?: MapDrawTool;
  onToolComplete?: () => void;
  onCameraChange?: (center: GeoPoint, zoom: number) => void;
  onSelectStation?: (id: string, name: string, lat: number, lon: number) => void;
  showGrid?: boolean;
  showLabels?: boolean;
  showControls?: boolean;
  showScaleBar?: boolean;
  compact?: boolean;
  className?: string;
  label?: string;
  /** Preserved for legacy prop compatibility. */
  detailSource?: { url: string; bounds: { west: number; south: number; east: number; north: number } };
};

interface BasemapTheme {
  ocean: string;
  land: string;
  landHover: string;
  landOpacity: number;
  satelliteOpacity: number;
  coast: string;
  border: string;
  basinLine: string;
  graticule: string;
  isLight: boolean;
  water: string;
  vegetation: string;
  park: string;
  road: string;
  majorRoad: string;
  place: string;
  placeHalo: string;
}

const BASEMAP_THEMES: Record<BasemapMode, BasemapTheme> = {
  territories: {
    ocean: "#dbe6e1",
    land: "#f3f4ed",
    landHover: "#deebe1",
    landOpacity: 0.98,
    satelliteOpacity: 0,
    coast: "#244e47",
    border: "#4c6660",
    basinLine: "rgba(35, 105, 95, 0.34)",
    graticule: "rgba(20, 44, 44, 0.14)",
    isLight: true,
    water: "#c9dcd8",
    vegetation: "#dfe9dd",
    park: "#d4e5d5",
    road: "#b8c6bd",
    majorRoad: "#d3baa0",
    place: "#284741",
    placeHalo: "#f3f4ed",
  },
  choropleth: {
    ocean: "#0f201f",
    land: "#172d2a",
    landHover: "#23443f",
    landOpacity: 0.98,
    satelliteOpacity: 0,
    coast: "rgba(182, 214, 198, 0.72)",
    border: "rgba(218, 236, 226, 0.52)",
    basinLine: "rgba(224, 235, 228, 0.36)",
    graticule: "rgba(246, 245, 240, 0.16)",
    isLight: false,
    water: "#173636",
    vegetation: "#234139",
    park: "#2b4b3e",
    road: "#4e6a63",
    majorRoad: "#a58c64",
    place: "#e2ebe4",
    placeHalo: "#172d2a",
  },
  atlas: {
    ocean: "#f5f4ee",
    land: "#eae7dd",
    landHover: "#dae6dd",
    landOpacity: 0.98,
    satelliteOpacity: 0,
    coast: "#142c2c",
    border: "#687a76",
    basinLine: "rgba(20, 44, 44, 0.28)",
    graticule: "rgba(20, 44, 44, 0.2)",
    isLight: true,
    water: "#d3dfdb",
    vegetation: "#dce5d6",
    park: "#d3e2ce",
    road: "#b5bdb2",
    majorRoad: "#d4bfa4",
    place: "#304940",
    placeHalo: "#eae7dd",
  },
  satellite: {
    ocean: "#0d2226",
    land: "#173331",
    landHover: "rgba(224, 235, 228, 0.24)",
    landOpacity: 0.08,
    satelliteOpacity: 0.96,
    coast: "rgba(246, 245, 240, 0.6)",
    border: "rgba(246, 245, 240, 0.7)",
    basinLine: "rgba(246, 245, 240, 0.34)",
    graticule: "rgba(246, 245, 240, 0.22)",
    isLight: false,
    water: "#173a40",
    vegetation: "#234039",
    park: "#2d4a3c",
    road: "#83988e",
    majorRoad: "#c4aa82",
    place: "#f4f7ed",
    placeHalo: "#173331",
  },
};

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const PRESET_BASINS_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: presetSelections.map((sel) => ({
    type: "Feature",
    properties: { id: sel.id, name: sel.name },
    geometry: {
      type: "Polygon",
      coordinates: [[...sel.polygon.map((p) => [p.lon, p.lat]), [sel.polygon[0].lon, sel.polygon[0].lat]]],
    },
  })),
};

function buildGraticuleGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let lon = -180; lon <= 180; lon += 15) {
    const coords: [number, number][] = [];
    for (let lat = -78; lat <= 78; lat += 4) coords.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return { type: "FeatureCollection", features };
}

function isFrontHemisphere(
  point: GeoPoint,
  viewCenter: GeoPoint,
  mode: "globe" | "flat",
  zoom: number
): boolean {
  if (mode === "flat" || zoom >= 3.2) return true;
  const rad = Math.PI / 180;
  const lat1 = point.lat * rad;
  const lat2 = viewCenter.lat * rad;
  const dLon = (point.lon - viewCenter.lon) * rad;
  const cosAngle =
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return cosAngle > 0.14;
}

function niceScaleBar(lat: number, zoom: number): { label: string; widthPx: number } {
  const metersPerPixel =
    (40075016.686 * Math.max(0.25, Math.cos((lat * Math.PI) / 180))) /
    (512 * Math.pow(2, zoom));
  const targetMeters = metersPerPixel * 96;
  const candidatesKm = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
  let bestKm = 100;
  for (const km of candidatesKm) {
    if (km * 1000 <= targetMeters * 1.4) bestKm = km;
  }
  const px = Math.round((bestKm * 1000) / Math.max(1, metersPerPixel));
  return {
    label: bestKm >= 1000 ? `${bestKm} km` : `0 — ${Math.round(bestKm / 2)} — ${bestKm} km`,
    widthPx: Math.max(46, Math.min(138, px)),
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function GeoMap({
  mode = "globe",
  basemapMode = "territories",
  layer,
  layerVisible = true,
  layerOpacity = 0.76,
  timeIndex,
  center,
  zoom = 2.2,
  polygon = [],
  onPolygonChange,
  onSelectTerritory,
  tool = "select",
  onToolComplete,
  onCameraChange,
  onSelectStation,
  showGrid = false,
  showLabels = true,
  showControls = true,
  showScaleBar = false,
  compact = false,
  className = "",
  label,
}: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [webglFallback, setWebglFallback] = useState(false);
  const [viewTick, setViewTick] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 520 });
  const [boundaries, setBoundaries] = useState<WorldBoundaryBundle | null>(null);
  const [hoveredCountryName, setHoveredCountryName] = useState<string | null>(null);

  const hoveredIdRef = useRef<number | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const prevModeRef = useRef<"globe" | "flat">(mode);

  const [draft, setDraft] = useState<GeoPoint[]>([]);
  const [activeVertexIdx, setActiveVertexIdx] = useState<number | null>(null);
  const dragRef = useRef<{
    kind: "vertex" | "rectangle" | "freehand";
    vertexIndex?: number;
    startPoint?: GeoPoint;
    points: GeoPoint[];
  } | null>(null);

  const programmaticMoveRef = useRef(false);
  const lastPropViewRef = useRef<{ lat: number; lon: number; zoom: number } | null>(null);
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onSelectTerritoryRef = useRef(onSelectTerritory);
  onSelectTerritoryRef.current = onSelectTerritory;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const polygonRef = useRef(polygon);
  polygonRef.current = polygon;

  const graticuleGeoJson = useMemo(() => buildGraticuleGeoJSON(), []);
  const theme = BASEMAP_THEMES[basemapMode] ?? BASEMAP_THEMES.territories;

  // Measure container dynamically for SVG overlays + crisp WebGL resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const syncSize = () => {
      setContainerSize({
        width: Math.max(1, el.clientWidth),
        height: Math.max(1, el.clientHeight),
      });
      mapRef.current?.resize();
    };
    syncSize();
    const obs = new ResizeObserver(syncSize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Cancel draft on Escape or delete selected polygon vertex on Delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft([]);
        dragRef.current = null;
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        activeVertexIdx !== null &&
        onPolygonChange &&
        polygon.length > 3 &&
        document.activeElement?.closest(".b-geo")
      ) {
        e.preventDefault();
        const next = polygon.filter((_, idx) => idx !== activeVertexIdx);
        onPolygonChange(next);
        setActiveVertexIdx(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeVertexIdx, onPolygonChange, polygon]);

  // Initialize MapLibre GL once with explicit ocean background + vector layers + overlay
  useEffect(() => {
    const host = mapCanvasHostRef.current;
    if (!host) return;

    registerBreatheMapProtocol(maplibregl);
    // Next.js 14 does not emit MapLibre v6's module worker automatically.
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const initialCenter: [number, number] = [
      normalizeLon(center?.lon ?? 105.75),
      clampLat(center?.lat ?? 21.1),
    ];
    const initialZoom =
      mode === "globe"
        ? Math.min(4.2, zoom)
        : Math.max(compact ? 1.4 : 2.1, zoom);
    lastPropViewRef.current = {
      lat: initialCenter[1],
      lon: initialCenter[0],
      zoom: initialZoom,
    };

    const layerDef = getLayerDefinition(layer);
    const initialOverlayOpacity =
      layerVisible && layerDef.available ? Math.max(0, Math.min(1, layerOpacity)) : 0;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: host,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        center: initialCenter,
        zoom: initialZoom,
        minZoom: mode === "globe" ? 1.05 : compact ? 1.2 : 1.75,
        maxZoom: 9.2,
        maxBounds:
          mode === "flat"
            ? [
                [-179.9, -76],
                [179.9, 76],
              ]
            : undefined,
        style: {
          version: 8,
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          projection: { type: mode === "globe" ? "globe" : "mercator" },
          sky: {
            "sky-color": mode === "globe" ? "#f6f5f0" : theme.ocean,
            "horizon-color": mode === "globe" ? "#eef1eb" : theme.ocean,
            "fog-color": mode === "globe" ? "#f6f5f0" : theme.ocean,
            "sky-horizon-blend": mode === "globe" ? 0.9 : 0,
            "atmosphere-blend": mode === "globe" ? 0.34 : 0,
          },
          sources: {
            "openmaptiles": {
              type: "vector",
              url: "https://tiles.openfreemap.org/planet",
            },
            "earth-base": {
              type: "raster",
              tiles: ["breathe-earth://base/v1/{z}/{x}/{y}"],
              tileSize: 256,
              maxzoom: 7,
            },
            countries: {
              type: "geojson",
              data: EMPTY_FC,
            },
            borders: {
              type: "geojson",
              data: EMPTY_FC,
            },
            coastlines: {
              type: "geojson",
              data: EMPTY_FC,
            },
            "preset-basins": {
              type: "geojson",
              data: PRESET_BASINS_FC,
            },
            "geos-overlay": {
              type: "raster",
              tiles: [`breathe-earth://overlay/${layer}/${timeIndex}/{z}/{x}/{y}`],
              tileSize: 256,
              maxzoom: 8,
            },
            graticule: {
              type: "geojson",
              data: graticuleGeoJson,
            },
          },
          layers: [
            {
              id: "ocean-bg",
              type: "background",
              paint: {
                "background-color": theme.land,
              },
            },
            {
              id: "earth-base-layer",
              type: "raster",
              source: "earth-base",
              paint: {
                "raster-opacity": theme.satelliteOpacity,
                "raster-fade-duration": 100,
              },
            },
            {
              id: "countries-fill",
              type: "fill",
              source: "countries",
              paint: {
                "fill-color": [
                  "case",
                  ["boolean", ["feature-state", "hover"], false],
                  theme.landHover,
                  theme.land,
                ],
                "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.26, 0],
              },
            },
            {
              id: "osm-water",
              type: "fill",
              source: "openmaptiles",
              "source-layer": "water",
              paint: { "fill-color": theme.water },
            },
            {
              id: "osm-vegetation",
              type: "fill",
              source: "openmaptiles",
              "source-layer": "landcover",
              minzoom: 5,
              filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "scrub"]]],
              paint: { "fill-color": theme.vegetation, "fill-opacity": 0.76 },
            },
            {
              id: "osm-park",
              type: "fill",
              source: "openmaptiles",
              "source-layer": "park",
              minzoom: 6,
              paint: { "fill-color": theme.park, "fill-opacity": 0.8 },
            },
            {
              id: "osm-waterway",
              type: "line",
              source: "openmaptiles",
              "source-layer": "waterway",
              minzoom: 5,
              paint: { "line-color": theme.water, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 1.8] },
            },
            {
              id: "osm-minor-roads",
              type: "line",
              source: "openmaptiles",
              "source-layer": "transportation",
              minzoom: 7,
              filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary", "minor"]]],
              paint: { "line-color": theme.road, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1.3], "line-opacity": 0.65 },
            },
            {
              id: "osm-major-roads",
              type: "line",
              source: "openmaptiles",
              "source-layer": "transportation",
              minzoom: 5,
              filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
              paint: { "line-color": theme.majorRoad, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.5], "line-opacity": 0.78 },
            },
            {
              id: "geos-overlay-layer",
              type: "raster",
              source: "geos-overlay",
              paint: {
                "raster-opacity": initialOverlayOpacity,
                "raster-resampling": "linear",
                "raster-fade-duration": 140,
              },
            },
            {
              id: "preset-basins-line",
              type: "line",
              source: "preset-basins",
              paint: {
                "line-color": theme.basinLine,
                "line-width": 1.0,
                "line-dasharray": [3, 2],
              },
            },
            {
              id: "coastlines-line",
              type: "line",
              source: "coastlines",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": theme.coast,
                "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.9, 5, 1.55],
              },
            },
            {
              id: "borders-line",
              type: "line",
              source: "borders",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": theme.border,
                "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.75, 5, 1.35],
              },
            },
            {
              id: "osm-admin-boundaries",
              type: "line",
              source: "openmaptiles",
              "source-layer": "boundary",
              minzoom: 5,
              filter: ["all", [">=", ["get", "admin_level"], 3], ["<=", ["get", "admin_level"], 6], ["!=", ["get", "maritime"], 1]],
              paint: { "line-color": theme.border, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 10, 1.05], "line-opacity": 0.55, "line-dasharray": [2, 2] },
            },
            {
              id: "graticule-layer",
              type: "line",
              source: "graticule",
              layout: {
                visibility: showGrid || basemapMode === "atlas" ? "visible" : "none",
              },
              paint: {
                "line-color": theme.graticule,
                "line-width": 0.8,
              },
            },
            {
              id: "osm-country-labels",
              type: "symbol",
              source: "openmaptiles",
              "source-layer": "place",
              filter: ["==", ["get", "class"], "country"],
              layout: {
                visibility: showLabels ? "visible" : "none",
                "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
                "text-font": ["Noto Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 14],
                "text-letter-spacing": 0.12,
                "text-transform": "uppercase",
                "text-max-width": 9,
              },
              paint: { "text-color": theme.place, "text-halo-color": theme.placeHalo, "text-halo-width": 1.6 },
            },
            {
              id: "osm-region-labels",
              type: "symbol",
              source: "openmaptiles",
              "source-layer": "place",
              minzoom: 5,
              filter: ["==", ["get", "class"], "state"],
              layout: {
                visibility: showLabels ? "visible" : "none",
                "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
                "text-font": ["Noto Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 9, 12],
                "text-letter-spacing": 0.07,
                "text-max-width": 9,
              },
              paint: { "text-color": theme.place, "text-halo-color": theme.placeHalo, "text-halo-width": 1.4 },
            },
            {
              id: "osm-city-labels",
              type: "symbol",
              source: "openmaptiles",
              "source-layer": "place",
              minzoom: 4,
              filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
              layout: {
                visibility: showLabels ? "visible" : "none",
                "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
                "text-font": ["Noto Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 13],
                "text-max-width": 9,
              },
              paint: { "text-color": theme.place, "text-halo-color": theme.placeHalo, "text-halo-width": 1.4 },
            },
          ],
        },
      });
    } catch {
      setWebglFallback(true);
      return;
    }

    mapRef.current = map;

    const handleMove = () => {
      setViewTick((t) => (t + 1) % 100000);
    };

    const handleMoveEnd = () => {
      handleMove();
      if (programmaticMoveRef.current) {
        programmaticMoveRef.current = false;
        return;
      }
      const c = map.getCenter();
      const z = Number(map.getZoom().toFixed(2));
      const nextCenter = { lat: Number(c.lat.toFixed(3)), lon: Number(normalizeLon(c.lng).toFixed(3)) };
      lastPropViewRef.current = { lat: nextCenter.lat, lon: nextCenter.lon, zoom: z };
      onCameraChangeRef.current?.(nextCenter, z);
    };

    // Interactive country/territory hover highlighting & click selection
    const clearHover = () => {
      if (hoveredIdRef.current !== null && map.getSource("countries")) {
        try {
          map.setFeatureState({ source: "countries", id: hoveredIdRef.current }, { hover: false });
        } catch {
          // Source not loaded yet
        }
        hoveredIdRef.current = null;
      }
      setHoveredCountryName(null);
    };

    map.on("mousemove", "countries-fill", (e) => {
      if (toolRef.current !== "select" || !onSelectTerritoryRef.current) {
        clearHover();
        return;
      }
      const feat = e.features?.[0];
      if (!feat || feat.id === undefined) {
        clearHover();
        return;
      }
      const numericId = Number(feat.id);
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== numericId) {
        map.setFeatureState({ source: "countries", id: hoveredIdRef.current }, { hover: false });
      }
      hoveredIdRef.current = numericId;
      map.setFeatureState({ source: "countries", id: numericId }, { hover: true });
      const props = feat.properties as Partial<CountryFeatureProperties> | undefined;
      setHoveredCountryName(props?.name ?? null);
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "countries-fill", () => {
      clearHover();
      map.getCanvas().style.cursor = "";
    });

    map.on("mousedown", (e) => {
      pointerDownPosRef.current = { x: e.point.x, y: e.point.y };
    });

    map.on("click", "countries-fill", (e) => {
      if (toolRef.current !== "select" || !onSelectTerritoryRef.current) return;
      const down = pointerDownPosRef.current;
      if (down && Math.hypot(e.point.x - down.x, e.point.y - down.y) > 5) return;

      const feat = e.features?.[0];
      if (!feat?.geometry) return;
      const props = feat.properties as Partial<CountryFeatureProperties> | undefined;
      const name = props?.name;
      if (!name) return;

      // Resolve full unclipped GeoJSON geometry from loaded boundary bundle when available
      const fullFeature = cachedCountriesLookup(name) ?? (feat as unknown as GeoJSON.Feature);
      const extracted = extractTerritoryPolygon(fullFeature.geometry);
      if (!extracted) return;

      onSelectTerritoryRef.current({
        name,
        polygon: extracted.polygon,
        center: extracted.center,
        zoom: extracted.zoom,
      });
    });

    map.on("load", () => {
      setMapReady(true);
      handleMove();
    });
    map.on("move", handleMove);
    map.on("zoom", handleMove);
    map.on("resize", handleMove);
    map.on("moveend", handleMoveEnd);
    map.on("error", (event) => {
      if (event.error && !String(event.error).includes("aborted")) {
        console.error("BREATHE map layer error", event.error);
      }
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Populate vector country polygons, borders, coastlines once worldBoundaries loads
  useEffect(() => {
    let active = true;
    void loadWorldBoundaries().then((bundle) => {
      if (!active) return;
      setBoundaries(bundle);
      const applySources = () => {
        const map = mapRef.current;
        if (!map) return;
        const cSrc = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
        const bSrc = map.getSource("borders") as maplibregl.GeoJSONSource | undefined;
        const kSrc = map.getSource("coastlines") as maplibregl.GeoJSONSource | undefined;
        cSrc?.setData(bundle.countries as GeoJSON.GeoJSON);
        bSrc?.setData(bundle.borders as GeoJSON.GeoJSON);
        kSrc?.setData(bundle.coastlines as GeoJSON.GeoJSON);
        setViewTick((t) => (t + 1) % 100000);
      };
      const map = mapRef.current;
      if (map?.isStyleLoaded()) applySources();
      else map?.once("load", applySources);
    });
    return () => {
      active = false;
    };
  }, []);

  // Keep GeoJSON cached feature lookup handy for unclipped polygon click extraction
  const cachedCountriesLookup = useCallback(
    (name: string) => boundaries?.countries.features.find((f) => f.properties.name === name) ?? null,
    [boundaries]
  );

  // Sync BasemapMode palette smoothly without destroying map state
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyTheme = () => {
      try {
        const activeTheme = BASEMAP_THEMES[basemapMode] ?? BASEMAP_THEMES.territories;
        if (map.getLayer("ocean-bg")) {
          map.setPaintProperty("ocean-bg", "background-color", activeTheme.land);
        }
        if (map.getLayer("earth-base-layer")) {
          map.setPaintProperty("earth-base-layer", "raster-opacity", activeTheme.satelliteOpacity);
        }
        if (map.getLayer("countries-fill")) {
          map.setPaintProperty("countries-fill", "fill-color", [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            activeTheme.landHover,
            activeTheme.land,
          ]);
          map.setPaintProperty("countries-fill", "fill-opacity", [
            "case", ["boolean", ["feature-state", "hover"], false], 0.26, 0,
          ]);
        }
        for (const [id, property, color] of [
          ["osm-water", "fill-color", activeTheme.water],
          ["osm-vegetation", "fill-color", activeTheme.vegetation],
          ["osm-park", "fill-color", activeTheme.park],
          ["osm-waterway", "line-color", activeTheme.water],
          ["osm-minor-roads", "line-color", activeTheme.road],
          ["osm-major-roads", "line-color", activeTheme.majorRoad],
          ["osm-admin-boundaries", "line-color", activeTheme.border],
        ] as const) {
          if (map.getLayer(id)) map.setPaintProperty(id, property, color);
        }
        for (const id of ["osm-country-labels", "osm-region-labels", "osm-city-labels"]) {
          if (!map.getLayer(id)) continue;
          map.setPaintProperty(id, "text-color", activeTheme.place);
          map.setPaintProperty(id, "text-halo-color", activeTheme.placeHalo);
          map.setLayoutProperty(id, "visibility", showLabels ? "visible" : "none");
        }
        if (map.getLayer("preset-basins-line")) {
          map.setPaintProperty("preset-basins-line", "line-color", activeTheme.basinLine);
        }
        if (map.getLayer("coastlines-line")) {
          map.setPaintProperty("coastlines-line", "line-color", activeTheme.coast);
        }
        if (map.getLayer("borders-line")) {
          map.setPaintProperty("borders-line", "line-color", activeTheme.border);
        }
        if (map.getLayer("graticule-layer")) {
          map.setPaintProperty("graticule-layer", "line-color", activeTheme.graticule);
          map.setLayoutProperty(
            "graticule-layer",
            "visibility",
            showGrid || basemapMode === "atlas" ? "visible" : "none"
          );
        }
        map.setSky({
          "sky-color": mode === "globe" ? "#f6f5f0" : activeTheme.ocean,
          "horizon-color": mode === "globe" ? "#eef1eb" : activeTheme.ocean,
          "fog-color": mode === "globe" ? "#f6f5f0" : activeTheme.ocean,
          "sky-horizon-blend": mode === "globe" ? 0.9 : 0,
          "atmosphere-blend": mode === "globe" ? 0.34 : 0,
        });
      } catch {
        // Ignore transient style state before initial load
      }
    };

    if (map.isStyleLoaded()) applyTheme();
    else map.once("load", applyTheme);
  }, [basemapMode, mode, showGrid]);

  // Synchronize projection mode cleanly (globe <-> 2D mercator) preventing horizontal strip compression
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyProjection = () => {
      try {
        const activeTheme = BASEMAP_THEMES[basemapMode] ?? BASEMAP_THEMES.territories;
        map.setProjection({ type: mode === "globe" ? "globe" : "mercator" });
        map.setRenderWorldCopies(false);
        map.setMinZoom(mode === "globe" ? 1.05 : compact ? 1.2 : 1.75);
        map.setMaxBounds(
          mode === "flat"
            ? [
                [-179.9, -76],
                [179.9, 76],
              ]
            : null
        );
        map.setSky({
          "sky-color": mode === "globe" ? "#f6f5f0" : activeTheme.ocean,
          "horizon-color": mode === "globe" ? "#eef1eb" : activeTheme.ocean,
          "fog-color": mode === "globe" ? "#f6f5f0" : activeTheme.ocean,
          "sky-horizon-blend": mode === "globe" ? 0.9 : 0,
          "atmosphere-blend": mode === "globe" ? 0.34 : 0,
        });

        // Auto-frame active region cleanly when switching Globe -> 2D flat map
        if (prevModeRef.current === "globe" && mode === "flat") {
          programmaticMoveRef.current = true;
          const activePts = polygonRef.current;
          if (activePts.length >= 3) {
            const b = computeBounds(activePts);
            map.fitBounds(
              [
                [b.west, b.south],
                [b.east, b.north],
              ],
              { padding: 68, minZoom: 2.8, maxZoom: 6.6, duration: prefersReducedMotion() ? 0 : 480 }
            );
          } else {
            map.easeTo({
              zoom: Math.max(3.2, map.getZoom()),
              duration: prefersReducedMotion() ? 0 : 420,
            });
          }
        }
        prevModeRef.current = mode;
        map.resize();
        setViewTick((t) => (t + 1) % 100000);
      } catch {
        // Style might still be loading
      }
    };

    if (map.isStyleLoaded()) applyProjection();
    else map.once("load", applyProjection);
    // Keep theme sync separate in applyTheme; only re-run projection switch on mode/compact
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, compact]);

  // Fly/ease smoothly when external center/zoom props change programmatically
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    const prev = lastPropViewRef.current;
    const dist = prev
      ? Math.hypot(prev.lat - center.lat, prev.lon - center.lon) + Math.abs((prev.zoom ?? zoom) - zoom)
      : 99;
    if (dist < 0.08) return;

    const clampedZoom = mode === "flat" ? Math.max(compact ? 1.2 : 1.75, zoom) : zoom;
    lastPropViewRef.current = { lat: center.lat, lon: center.lon, zoom: clampedZoom };
    programmaticMoveRef.current = true;
    const duration = prefersReducedMotion() ? 0 : 620;
    map.easeTo({
      center: [normalizeLon(center.lon), clampLat(center.lat)],
      zoom: clampedZoom,
      duration,
      essential: true,
    });
  }, [center, zoom, mode, compact]);

  // Synchronize GEOS-CF raster overlay tiles + opacity without map remount
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncLayers = () => {
      const layerDef = getLayerDefinition(layer);
      const source = map.getSource("geos-overlay") as maplibregl.RasterTileSource | undefined;
      if (source && typeof source.setTiles === "function" && layerDef.available) {
        source.setTiles([`breathe-earth://overlay/${layer}/${timeIndex}/{z}/{x}/{y}`]);
      }
      if (map.getLayer("geos-overlay-layer")) {
        const opacity = layerVisible && layerDef.available ? Math.max(0, Math.min(1, layerOpacity)) : 0;
        map.setPaintProperty("geos-overlay-layer", "raster-opacity", opacity);
      }
    };

    if (map.isStyleLoaded()) syncLayers();
    else map.once("load", syncLayers);
  }, [layer, timeIndex, layerVisible, layerOpacity]);

  // Keep scroll zoom active while temporarily locking pan for active draw tools
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tool === "select") map.dragPan.enable();
    else map.dragPan.disable();
    map.scrollZoom.enable();
  }, [tool]);

  useEffect(() => {
    if (tool === "select") {
      setDraft([]);
      dragRef.current = null;
    }
  }, [tool]);

  const unprojectPointer = useCallback((clientX: number, clientY: number): GeoPoint | null => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return null;
    const rect = el.getBoundingClientRect();
    const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
    return {
      lat: Number(clampLat(lngLat.lat).toFixed(4)),
      lon: Number(normalizeLon(lngLat.lng).toFixed(4)),
    };
  }, []);

  const commitPolygon = useCallback(
    (points: GeoPoint[]) => {
      if (points.length >= 3 && onPolygonChange) {
        onPolygonChange(points);
        setDraft([]);
        onToolComplete?.();
      }
    },
    [onPolygonChange, onToolComplete]
  );

  const handleDrawPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPolygonChange || tool === "select") return;
    if (e.button === 1 || e.altKey) return;
    const pt = unprojectPointer(e.clientX, e.clientY);
    if (!pt) return;

    if (tool === "polygon") {
      if (draft.length >= 3 && mapRef.current) {
        const firstPx = mapRef.current.project([draft[0].lon, draft[0].lat]);
        const curPx = mapRef.current.project([pt.lon, pt.lat]);
        if (Math.hypot(firstPx.x - curPx.x, firstPx.y - curPx.y) < 16) {
          commitPolygon(draft);
          return;
        }
      }
      setDraft((prev) => [...prev, pt]);
      return;
    }

    if (tool === "rectangle" || tool === "freehand") {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: tool,
        startPoint: pt,
        points: [pt],
      };
      setDraft([pt]);
    }
  };

  const handleDrawPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !onPolygonChange) return;
    const pt = unprojectPointer(e.clientX, e.clientY);
    if (!pt) return;

    if (drag.kind === "vertex" && drag.vertexIndex !== undefined) {
      const updated = [...polygon];
      updated[drag.vertexIndex] = pt;
      onPolygonChange(updated);
      return;
    }

    if (drag.kind === "rectangle" && drag.startPoint) {
      const a = drag.startPoint;
      const box: GeoPoint[] = [
        { lat: a.lat, lon: a.lon },
        { lat: a.lat, lon: pt.lon },
        { lat: pt.lat, lon: pt.lon },
        { lat: pt.lat, lon: a.lon },
      ];
      drag.points = box;
      setDraft(box);
      return;
    }

    if (drag.kind === "freehand") {
      const last = drag.points[drag.points.length - 1];
      if (!last || Math.hypot(pt.lat - last.lat, pt.lon - last.lon) > 0.14) {
        const next = [...drag.points, pt];
        drag.points = next;
        setDraft(next);
      }
    }
  };

  const handleDrawPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.kind === "rectangle" && drag.points.length >= 3) {
      commitPolygon(drag.points);
    } else if (drag.kind === "freehand" && drag.points.length >= 3) {
      const simplified = simplifyPolygon(drag.points, 0.12);
      if (simplified.length >= 3) commitPolygon(simplified);
      else setDraft([]);
    }
  };

  const handleVertexPointerDown = (index: number, e: React.PointerEvent<SVGCircleElement>) => {
    if (!onPolygonChange) return;
    e.stopPropagation();
    e.preventDefault();
    setActiveVertexIdx(index);
    const svgEl = e.currentTarget.ownerSVGElement;
    svgEl?.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "vertex",
      vertexIndex: index,
      points: polygon,
    };
  };

  const insertVertexAt = (afterIndex: number, midpoint: GeoPoint, e: React.MouseEvent) => {
    if (!onPolygonChange) return;
    e.stopPropagation();
    const next = [
      ...polygon.slice(0, afterIndex + 1),
      midpoint,
      ...polygon.slice(afterIndex + 1),
    ];
    onPolygonChange(next);
    setActiveVertexIdx(afterIndex + 1);
  };

  const map = mapRef.current;
  const activeZoom = map ? map.getZoom() : zoom;
  const activeCenter: GeoPoint = map
    ? { lat: map.getCenter().lat, lon: normalizeLon(map.getCenter().lng) }
    : center ?? { lat: 21.1, lon: 105.75 };

  const activePolygon = draft.length > 0 ? draft : polygon;
  const projectedPoly = useMemo(() => {
    if (!map) return [];
    return activePolygon.map((pt) => {
      const p = map.project([pt.lon, pt.lat]);
      return {
        x: p.x,
        y: p.y,
        visible: isFrontHemisphere(pt, activeCenter, mode, activeZoom),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activePolygon, viewTick, mode, activeZoom]);

  const polyPointsStr = projectedPoly
    .filter((p) => p.visible)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const projectedMidpoints = useMemo(() => {
    if (!map || !onPolygonChange || tool !== "select" || polygon.length < 3 || activeZoom < 2.2) {
      return [];
    }
    return polygon.map((pt, i) => {
      const next = polygon[(i + 1) % polygon.length];
      const mid: GeoPoint = {
        lat: Number(((pt.lat + next.lat) / 2).toFixed(4)),
        lon: Number(((pt.lon + next.lon) / 2).toFixed(4)),
      };
      const px = map.project([mid.lon, mid.lat]);
      return {
        index: i,
        x: px.x,
        y: px.y,
        geo: mid,
        visible: isFrontHemisphere(mid, activeCenter, mode, activeZoom),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, onPolygonChange, tool, polygon, activeZoom, viewTick, mode]);

  const projectedStations = useMemo(() => {
    if (!map || !showLabels || compact) return [];
    return observations
      .map((obs) => {
        const pt = { lat: obs.coordinates.lat, lon: obs.coordinates.lon };
        const p = map.project([pt.lon, pt.lat]);
        const visible =
          p.x > 16 &&
          p.x < containerSize.width - 16 &&
          p.y > 16 &&
          p.y < containerSize.height - 16 &&
          isFrontHemisphere(pt, activeCenter, mode, activeZoom);
        return { obs, x: p.x, y: p.y, visible };
      })
      .filter((item) => item.visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, showLabels, compact, containerSize, activeZoom, viewTick, mode]);

  const scaleInfo = useMemo(() => niceScaleBar(activeCenter.lat, activeZoom), [activeCenter.lat, activeZoom]);
  const isDrawingTool = Boolean(onPolygonChange && tool !== "select");

  const handleZoomStep = (delta: number) => {
    const m = mapRef.current;
    if (!m) return;
    const floor = mode === "globe" ? 1.05 : compact ? 1.2 : 1.75;
    m.easeTo({
      zoom: Math.max(floor, Math.min(9.0, m.getZoom() + delta)),
      duration: prefersReducedMotion() ? 0 : 280,
    });
  };

  const handleFitRegion = () => {
    const m = mapRef.current;
    if (!m) return;
    if (polygon.length >= 3) {
      const b = computeBounds(polygon);
      m.fitBounds(
        [
          [b.west, b.south],
          [b.east, b.north],
        ],
        {
          padding: 64,
          minZoom: mode === "flat" ? 2.4 : 1.5,
          maxZoom: 7.2,
          duration: prefersReducedMotion() ? 0 : 480,
        }
      );
      return;
    }
    m.easeTo({
      center: [normalizeLon(center?.lon ?? 105.75), clampLat(center?.lat ?? 21.1)],
      zoom: mode === "globe" ? 2.3 : Math.max(3.6, zoom),
      duration: prefersReducedMotion() ? 0 : 480,
    });
  };

  const handleResetGlobe = () => {
    const m = mapRef.current;
    if (!m) return;
    m.easeTo({
      center: [normalizeLon(center?.lon ?? 105.75), clampLat(center?.lat ?? 21.1)],
      zoom: mode === "globe" ? 2.2 : 3.2,
      duration: prefersReducedMotion() ? 0 : 480,
    });
  };

  void polygonToGeoJSONFeature;

  return (
    <div
      ref={containerRef}
      className={`b-geo ${mode === "globe" ? "b-geo-globe" : "b-geo-flat"} ${
        theme.isLight ? "is-light-basemap" : "is-dark-basemap"
      } ${className}`}
      role="region"
      aria-label={
        label ??
        `${mode === "globe" ? "Interactive 3D Earth globe" : "Interactive 2D territory map"} displaying NASA GEOS-CF ${layer} observations`
      }
    >
      <div ref={mapCanvasHostRef} className="b-maplibre-host" />

      {!mapReady && !webglFallback && (
        <div className="b-map-loading">Loading map and air-quality layers…</div>
      )}

      {webglFallback && (
        <div className="b-map-fallback">
          <Image
            src="/images/earth-blue-marble.png"
            alt="NASA Blue Marble Earth preview"
            fill
            unoptimized
            className="b-map-fallback-img"
          />
        </div>
      )}

      {mode === "globe" && !compact && <div className="b-globe-orbit" aria-hidden="true" />}

      {/* Hover indicator when clicking a country/territory boundary is available */}
      {hoveredCountryName && onSelectTerritory && tool === "select" && !compact && (
        <div className="b-territory-hover-pill" role="status" aria-live="polite">
          <span>{hoveredCountryName}</span>
          <small>Click to select territory</small>
        </div>
      )}

      {/* Vector geographic overlay synced with MapLibre projection */}
      <svg
        className={`b-map-overlay ${isDrawingTool ? "b-map-drawing" : ""} ${
          dragRef.current?.kind === "vertex" ? "b-map-dragging-vertex" : ""
        }`}
        viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
        onPointerDown={handleDrawPointerDown}
        onPointerMove={handleDrawPointerMove}
        onPointerUp={handleDrawPointerUp}
        onDoubleClick={() => {
          if (tool === "polygon" && draft.length >= 3) {
            commitPolygon(draft);
          }
        }}
        style={{
          pointerEvents: isDrawingTool || dragRef.current?.kind === "vertex" ? "all" : "none",
        }}
      >
        {projectedPoly.length >= 3 && (
          <polygon points={polyPointsStr} className="b-region-polygon" />
        )}
        {(projectedPoly.length === 2 || (tool === "polygon" && draft.length >= 2)) && (
          <polyline
            points={projectedPoly
              .filter((p) => p.visible)
              .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(" ")}
            className="b-region-line"
          />
        )}

        {tool === "polygon" &&
          draft.map((pt, idx) => {
            if (!map) return null;
            const p = map.project([pt.lon, pt.lat]);
            return (
              <circle
                key={`draft-${idx}`}
                cx={p.x}
                cy={p.y}
                r={idx === 0 && draft.length >= 3 ? 7 : 5}
                className={idx === 0 && draft.length >= 3 ? "b-region-vertex-close" : "b-region-vertex"}
              />
            );
          })}

        {projectedMidpoints.map((mid) =>
          mid.visible ? (
            <g
              key={`mid-${mid.index}`}
              className="b-region-midpoint"
              style={{ pointerEvents: "all", cursor: "pointer" }}
              onClick={(e) => insertVertexAt(mid.index, mid.geo, e)}
            >
              <circle cx={mid.x} cy={mid.y} r={5} />
              <path d={`M ${mid.x - 2.5} ${mid.y} H ${mid.x + 2.5} M ${mid.x} ${mid.y - 2.5} V ${mid.y + 2.5}`} />
            </g>
          ) : null
        )}

        {onPolygonChange &&
          tool === "select" &&
          polygon.map((pt, index) => {
            if (!map || !isFrontHemisphere(pt, activeCenter, mode, activeZoom)) return null;
            const p = map.project([pt.lon, pt.lat]);
            const isSelected = activeVertexIdx === index;
            return (
              <circle
                key={`v-${index}`}
                cx={p.x}
                cy={p.y}
                r={isSelected ? 7.5 : 6}
                className={`b-region-vertex ${isSelected ? "is-selected" : ""}`}
                style={{ pointerEvents: "all", cursor: "grab" }}
                onPointerDown={(e) => handleVertexPointerDown(index, e)}
              />
            );
          })}

      </svg>

      {projectedStations.length > 0 && (
        <div className="b-station-layer" aria-hidden={!onSelectStation}>
          {projectedStations.map(({ obs, x, y }) => (
            <button
              key={obs.id}
              type="button"
              className="b-station-dot"
              style={{ left: x, top: y }}
              title={`${obs.coordinates.regionName} · ${obs.value.toFixed(1)} ${obs.unit}`}
              onClick={() => {
                if (onSelectStation) {
                  onSelectStation(obs.id, obs.coordinates.regionName, obs.coordinates.lat, obs.coordinates.lon);
                } else {
                  mapRef.current?.easeTo({
                    center: [obs.coordinates.lon, obs.coordinates.lat],
                    zoom: Math.max(4.8, activeZoom),
                    duration: prefersReducedMotion() ? 0 : 600,
                  });
                }
              }}
            >
              <span className="b-station-pulse" />
            </button>
          ))}
        </div>
      )}

      {tool === "polygon" && draft.length > 0 && (
        <div className="b-draw-toast">
          <span>
            {draft.length < 3
              ? `Click ${3 - draft.length} more point${3 - draft.length === 1 ? "" : "s"}`
              : `${draft.length} vertices · click green point or Finish`}
          </span>
          {draft.length >= 3 && (
            <button type="button" className="b-draw-finish" onClick={() => commitPolygon(draft)}>
              <Check size={13} /> Finish
            </button>
          )}
          <button type="button" className="b-draw-cancel" onClick={() => setDraft([])} aria-label="Cancel draft">
            <X size={13} />
          </button>
        </div>
      )}

      {showControls && !compact && (
        <div className="b-map-nav-controls" role="group" aria-label="Map navigation controls">
          <button type="button" onClick={() => handleZoomStep(0.8)} aria-label="Zoom in" title="Zoom in">
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => handleZoomStep(-0.8)} aria-label="Zoom out" title="Zoom out">
            <Minus size={14} />
          </button>
          <button type="button" onClick={handleFitRegion} aria-label="Fit active region" title="Fit active region">
            <Maximize2 size={13} />
          </button>
          <button type="button" onClick={handleResetGlobe} aria-label="Center view" title="Center view">
            <Compass size={14} />
          </button>
        </div>
      )}

      {showScaleBar && !compact && (
        <div className="b-map-scale" aria-label={`Map scale ${scaleInfo.label}`}>
          <span>{scaleInfo.label}</span>
          <i style={{ width: scaleInfo.widthPx }} />
        </div>
      )}

      <div className="b-map-credit">
        Map: <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
        {" · "}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        {" · "}<a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>
        {" · "}Air quality: NASA GEOS-CF v2
      </div>
    </div>
  );
}
