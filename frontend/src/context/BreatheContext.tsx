"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import {
  formatUtc,
  galleryWorks,
  getLayerDefinition,
  getRegionLayerRestriction,
  type LayerRegionRestriction,
  makeSelection,
  presetSelections,
  timeSlots,
} from "@/lib/breatheData";
import { fetchBackendRegionStats, samplePolygonSeries } from "@/lib/geosCfRaster";
import { zoomForBounds } from "@/lib/geoUtils";
import {
  buildResolvedTerritory,
  findTerritoryFeature,
  getCachedWorldBoundaries,
  loadWorldBoundariesDetailed,
  loadWorldBoundariesQuick,
  resolveTerritoryByCodeOrName,
} from "@/lib/worldBoundaries";
import { sonificationService } from "@/services/sonificationService";
import type {
  AudioCompositionSpec,
  BasemapMode,
  BreatheProjectFile,
  GalleryWork,
  GeographicSelection,
  GeoPoint,
  LayerKey,
  MapCameraState,
  RegionStats,
  SonificationMapping,
  TerritorySelectionPayload,
} from "@/types/breathe";

const DEFAULT_SELECTION = presetSelections[0];

/** Schedules non-critical background work so initial 3D globe rendering stays uncontested. */
function scheduleWhenIdle(task: () => void, timeoutMs: number): () => void {
  if (typeof window === "undefined") return () => {};
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    const idleId = win.requestIdleCallback(task, { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(idleId);
  }
  const timerId = window.setTimeout(task, Math.min(timeoutMs, 1100));
  return () => window.clearTimeout(timerId);
}

function toTerritoryCatalogEntries(
  bundle: Awaited<ReturnType<typeof loadWorldBoundariesQuick>>
): TerritoryCatalogEntry[] {
  const byId = new Map<string, TerritoryCatalogEntry>();
  for (const f of bundle.countries.features) {
    const code = f.properties.isoNumeric?.trim();
    if (!code) continue;
    const id = `territory-${code}`;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        isoNumeric: code,
        name: f.properties.name,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const DEFAULT_MAPPING: SonificationMapping = {
  density: 0.65,
  brightness: 0.52,
  pitchSensitivity: 0.58,
  spatialSpread: 0.42,
  tempo: 96,
  musicalKey: "A minor",
  waveform: "sine",
  volume: 0.72,
};

const DEFAULT_CAMERA: MapCameraState = {
  center: { lat: DEFAULT_SELECTION.center.lat, lon: DEFAULT_SELECTION.center.lon },
  zoom: 2.35,
  mode: "globe",
  pitch: 0,
  bearing: 0,
};

const STORAGE_KEYS = {
  region: "breathe-selected-region",
  savedWorks: "breathe-saved-works-v1",
  bookmarks: "breathe-bookmarks-v1",
};

export interface TerritoryCatalogEntry {
  id: string;
  isoNumeric: string;
  name: string;
}

interface BreatheContextValue {
  selection: GeographicSelection;
  territories: TerritoryCatalogEntry[];
  activeLayer: LayerKey;
  basemapMode: BasemapMode;
  layerVisible: boolean;
  layerOpacity: number;
  showGrid: boolean;
  showLabels: boolean;
  timeIndex: number;
  camera: MapCameraState;
  mapping: SonificationMapping;
  regionStats: RegionStats;
  regionSeries: number[];
  savedWorks: GalleryWork[];
  bookmarkedIds: string[];
  canUndoPolygon: boolean;
  canRedoPolygon: boolean;
  setActiveLayer: (layer: LayerKey) => void;
  getLayerRestriction: (layer: LayerKey) => LayerRegionRestriction | null;
  setBasemapMode: (mode: BasemapMode) => void;
  setLayerVisible: (visible: boolean) => void;
  setLayerOpacity: (opacity: number) => void;
  setShowGrid: (show: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setTimeIndex: (index: number | ((prev: number) => number)) => void;
  setCamera: (patch: Partial<MapCameraState> | ((prev: MapCameraState) => MapCameraState)) => void;
  flyTo: (center: GeoPoint, zoom?: number) => void;
  updateMapping: (patch: Partial<SonificationMapping>) => void;
  selectPreset: (presetId: string) => void;
  selectTerritory: (territory: TerritorySelectionPayload) => void;
  selectTerritoryByCode: (codeOrName: string) => Promise<void>;
  convertBoundaryToEditableSketch: () => void;
  setPolygon: (
    points: GeoPoint[],
    name?: string,
    sourceType?: GeographicSelection["sourceType"]
  ) => void;
  undoPolygon: () => void;
  redoPolygon: () => void;
  clearSelection: () => void;
  loadWorkContext: (work: GalleryWork, targetMode?: "globe" | "flat") => void;
  saveWorkToGallery: (customTitle?: string) => GalleryWork;
  toggleBookmark: (workId: string) => void;
  exportProjectFile: () => BreatheProjectFile;
  importProjectFile: (data: BreatheProjectFile) => void;
  buildCompositionSpec: (titleOverride?: string) => AudioCompositionSpec;
}

const BreatheContext = createContext<BreatheContextValue | null>(null);

export function BreatheProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMapWorkspace =
    Boolean(pathname?.startsWith("/explore")) || Boolean(pathname?.startsWith("/studio"));

  const [selectionHistory, setSelectionHistory] = useState<GeographicSelection[]>([
    DEFAULT_SELECTION,
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const selection = selectionHistory[historyIndex] ?? DEFAULT_SELECTION;

  const [activeLayerState, setActiveLayerState] = useState<LayerKey>("PM25_RH35");
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const activeLayerRestriction = getRegionLayerRestriction(selection, activeLayerState);
  const activeLayer = activeLayerRestriction
    ? activeLayerRestriction.fallbackLayer
    : activeLayerState;

  const setActiveLayer = useCallback((nextLayer: LayerKey) => {
    const restriction = getRegionLayerRestriction(selectionRef.current, nextLayer);
    setActiveLayerState(restriction ? restriction.fallbackLayer : nextLayer);
  }, []);

  const getLayerRestriction = useCallback(
    (layer: LayerKey) => getRegionLayerRestriction(selection, layer),
    [selection]
  );

  useEffect(() => {
    if (activeLayerRestriction) {
      setActiveLayerState(activeLayerRestriction.fallbackLayer);
    }
  }, [activeLayerRestriction]);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("territories");
  const [layerVisible, setLayerVisible] = useState(true);
  const [layerOpacity, setLayerOpacity] = useState(0.76);
  const [showGrid, setShowGrid] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [timeIndex, setTimeIndex] = useState(0);
  const [camera, setCameraState] = useState<MapCameraState>(DEFAULT_CAMERA);
  const [mapping, setMapping] = useState<SonificationMapping>(DEFAULT_MAPPING);

  const [regionStats, setRegionStats] = useState<RegionStats>(() => ({
    variable: "PM25_RH35",
    unit: "µg/m³",
    mean: null,
    min: null,
    max: null,
    p90: null,
    sampleCount: 0,
    coveragePct: 0,
    timestamp: timeSlots[0] ?? "2026-11-12T00:30:00Z",
    sourceKind: "geos-cf-raster",
    sourceLabel: "NASA GEOS-CF v2 raster-sampled",
    isMock: false,
    loading: true,
  }));

  const [regionSeries, setRegionSeries] = useState<number[]>([64, 68, 72, 78, 74, 69, 66, 70]);
  const [savedWorks, setSavedWorks] = useState<GalleryWork[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(["beijing", "monsoon"]);
  const [territories, setTerritories] = useState<TerritoryCatalogEntry[]>([]);
  const hydratedRef = useRef(false);

  // Load lightweight 110m countries catalog and upgrade to 50m on browser idle ONLY on map workspace routes
  useEffect(() => {
    if (!isMapWorkspace) return;
    let active = true;
    let cancelIdle: (() => void) | null = null;
    void loadWorldBoundariesQuick().then((bundle) => {
      if (!active) return;
      setTerritories((prev) => (prev.length > 0 ? prev : toTerritoryCatalogEntries(bundle)));
      cancelIdle = scheduleWhenIdle(() => {
        void loadWorldBoundariesDetailed().then((detailed) => {
          if (!active) return;
          setTerritories(toTerritoryCatalogEntries(detailed));
        });
      }, 1800);
    });
    return () => {
      active = false;
      cancelIdle?.();
    };
  }, [isMapWorkspace]);

  // Hydrate full 50m GeoJSON Polygon/MultiPolygon boundary only on map workspace routes
  useEffect(() => {
    const code = selection.territoryCode;
    if (!isMapWorkspace || !code || selection.boundaryGeometry) return;
    let cancelled = false;
    void resolveTerritoryByCodeOrName(code, selection.id, selection.name, "50m").then((resolved) => {
      if (cancelled || !resolved) return;
      setSelectionHistory((prev) =>
        prev.map((item) =>
          item.id === selection.id && item.territoryCode === code && !item.boundaryGeometry
            ? {
                ...item,
                boundaryGeometry: resolved.boundaryGeometry,
                boundaryKind: "territory",
                polygon: resolved.polygon,
                bounds: resolved.bounds,
                areaKm2: resolved.areaKm2,
                center: resolved.center,
              }
            : item
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [isMapWorkspace, selection.id, selection.name, selection.territoryCode, selection.boundaryGeometry]);

  // Hydrate persisted selection, saved works, bookmarks, and optional URL query context once on client
  useEffect(() => {
    if (hydratedRef.current || typeof window === "undefined") return;
    hydratedRef.current = true;

    try {
      const rawRegion = window.sessionStorage.getItem(STORAGE_KEYS.region);
      if (rawRegion) {
        const parsed = JSON.parse(rawRegion) as Partial<GeographicSelection>;
        if (Array.isArray(parsed.polygon) && parsed.polygon.length >= 3) {
          const restored = makeSelection(
            parsed.id ?? "custom-region",
            parsed.name ?? "Custom atmospheric region",
            parsed.polygon,
            parsed.sourceType ?? "custom",
            {
              boundaryKind: parsed.boundaryKind ?? (parsed.territoryCode ? "territory" : "drawn"),
              territoryCode: parsed.territoryCode,
              bounds: parsed.bounds,
              areaKm2: parsed.areaKm2,
              center: parsed.center,
            }
          );
          setSelectionHistory([restored]);
          setHistoryIndex(0);
        }
      }
      const rawSaved = window.localStorage.getItem(STORAGE_KEYS.savedWorks);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as GalleryWork[];
        if (Array.isArray(parsed)) {
          setSavedWorks(
            parsed.filter(
              (work) =>
                !getRegionLayerRestriction(
                  {
                    id: work.regionId,
                    name: work.region,
                    territoryCode: work.territoryCode,
                  },
                  work.variable
                )
            )
          );
        }
      }
      const rawBookmarks = window.localStorage.getItem(STORAGE_KEYS.bookmarks);
      if (rawBookmarks) {
        const parsed = JSON.parse(rawBookmarks) as string[];
        if (Array.isArray(parsed)) setBookmarkedIds(parsed);
      }
    } catch {
      // Ignore corrupt browser storage cleanly
    }

    // Optional share link restoration (?work=id or ?region=id&layer=...&t=...)
    const params = new URLSearchParams(window.location.search);
    const workId = params.get("work");
    const regionId = params.get("region");
    const layerParam = params.get("layer") as LayerKey | null;
    const tParam = params.get("t");
    const tempoParam = params.get("tempo");
    const keyParam = params.get("key");

    if (workId) {
      const work = galleryWorks.find((item) => item.id === workId);
      if (work) {
        const nextSel = makeSelection(work.regionId, work.region, work.polygon, "gallery", {
          territoryCode: work.territoryCode,
          boundaryKind: work.territoryCode ? "territory" : "drawn",
          boundaryGeometry: work.boundaryGeometry,
        });
        setSelectionHistory([nextSel]);
        setHistoryIndex(0);
        setActiveLayer(work.variable);
        setTimeIndex(Math.max(0, Math.min(timeSlots.length - 1, work.timeIndex)));
        setMapping((prev) => ({
          ...prev,
          density: work.mappings.density,
          brightness: work.mappings.brightness,
          pitchSensitivity: work.mappings.pitchSensitivity,
          spatialSpread: work.mappings.spatialSpread,
          tempo: work.tempo,
          musicalKey: work.musicalKey,
        }));
        setCameraState((prev) => ({ ...prev, center: work.center, zoom: work.zoom }));
        return;
      }
    }

    if (regionId) {
      const preset = presetSelections.find((item) => item.id === regionId);
      if (preset) {
        setSelectionHistory([preset]);
        setHistoryIndex(0);
        setCameraState((prev) => ({
          ...prev,
          center: preset.center,
          zoom: zoomForBounds(preset.bounds),
        }));
      }
    }
    if (layerParam && ["PM25_RH35", "AOD", "NO2", "SO2", "CO", "O3"].includes(layerParam)) {
      setActiveLayer(layerParam);
    }
    if (tParam !== null && !Number.isNaN(Number(tParam))) {
      setTimeIndex(Math.max(0, Math.min(timeSlots.length - 1, Number(tParam))));
    }
    if (tempoParam !== null && !Number.isNaN(Number(tempoParam))) {
      setMapping((prev) => ({ ...prev, tempo: Math.max(54, Math.min(160, Number(tempoParam))) }));
    }
    if (keyParam) {
      setMapping((prev) => ({ ...prev, musicalKey: keyParam }));
    }
  }, [setActiveLayer]);

  // Persist current region to sessionStorage without huge GeoJSON geometry blobs (rehydrated by territoryCode)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const compactSelection = {
        id: selection.id,
        name: selection.name,
        boundaryKind: selection.boundaryKind,
        territoryCode: selection.territoryCode,
        polygon: selection.polygon,
        bounds: selection.bounds,
        areaKm2: selection.areaKm2,
        center: selection.center,
        sourceType: selection.sourceType,
      };
      window.sessionStorage.setItem(STORAGE_KEYS.region, JSON.stringify(compactSelection));
    } catch {
      // Ignore quota errors
    }
  }, [selection]);

  // Query live backend / GEOS-CF raster stats only on map workspace routes
  useEffect(() => {
    if (!isMapWorkspace) return;
    let cancelled = false;
    if (!selection.boundaryGeometry && selection.polygon.length < 3) return;

    setRegionStats((prev) => ({
      ...prev,
      variable: activeLayer,
      unit: getLayerDefinition(activeLayer).unit,
      loading: true,
    }));

    void fetchBackendRegionStats(
      activeLayer,
      timeIndex,
      selection.bounds,
      selection.polygon,
      selection.boundaryGeometry
    ).then((stats) => {
      if (!cancelled) setRegionStats(stats);
    });

    return () => {
      cancelled = true;
    };
  }, [isMapWorkspace, selection.polygon, selection.bounds, selection.boundaryGeometry, activeLayer, timeIndex]);

  const initialSeriesSettledRef = useRef(false);

  // Sample diurnal 8-step atmospheric time series across the current boundary & active variable on map routes.
  // Deferred until idle on initial boot so 8 raster decodes never contend with 3D globe painting.
  useEffect(() => {
    if (!isMapWorkspace) return;
    let cancelled = false;
    if (!selection.boundaryGeometry && selection.polygon.length < 3) return;

    const timeoutMs = initialSeriesSettledRef.current ? 240 : 1800;
    const cancelIdle = scheduleWhenIdle(() => {
      if (cancelled) return;
      initialSeriesSettledRef.current = true;
      void samplePolygonSeries(
        activeLayer,
        selection.polygon,
        selection.boundaryGeometry,
        selection.bounds
      ).then((series) => {
        if (!cancelled && series.length > 0) {
          setRegionSeries(series);
        }
      });
    }, timeoutMs);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [isMapWorkspace, selection.polygon, selection.boundaryGeometry, selection.bounds, activeLayer]);

  const setCamera = useCallback(
    (patch: Partial<MapCameraState> | ((prev: MapCameraState) => MapCameraState)) => {
      setCameraState((prev) => (typeof patch === "function" ? patch(prev) : { ...prev, ...patch }));
    },
    []
  );

  const flyTo = useCallback((center: GeoPoint, zoom?: number) => {
    setCameraState((prev) => ({
      ...prev,
      center,
      zoom: zoom ?? prev.zoom,
    }));
  }, []);

  const pushSelection = useCallback(
    (next: GeographicSelection) => {
      setSelectionHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        const updated = [...sliced, next];
        setHistoryIndex(updated.length - 1);
        return updated;
      });
    },
    [historyIndex]
  );

  const selectTerritory = useCallback(
    (territory: TerritorySelectionPayload) => {
      const matchedPreset = presetSelections.find(
        (p) => p.territoryCode === territory.territoryCode || p.id === territory.id
      );
      const next = makeSelection(
        matchedPreset?.id ?? territory.id,
        matchedPreset?.name ?? territory.name,
        territory.polygon,
        matchedPreset ? "preset" : "custom",
        {
          boundaryGeometry: territory.boundaryGeometry,
          boundaryKind: "territory",
          territoryCode: territory.territoryCode,
          bounds: territory.bounds,
          areaKm2: territory.areaKm2,
          center: territory.center,
        }
      );
      pushSelection(next);
      setCameraState((prev) => ({
        ...prev,
        center: territory.center,
        zoom: territory.zoom,
      }));
    },
    [pushSelection]
  );

  const selectTerritoryByCode = useCallback(
    async (codeOrName: string) => {
      const resolved = await resolveTerritoryByCodeOrName(codeOrName);
      if (!resolved) return;
      selectTerritory(resolved);
    },
    [selectTerritory]
  );

  const selectPreset = useCallback(
    (presetId: string) => {
      const found = presetSelections.find((p) => p.id === presetId);
      if (!found) {
        if (presetId.startsWith("territory-")) {
          void selectTerritoryByCode(presetId);
        }
        return;
      }

      const cached = getCachedWorldBoundaries();
      let resolvedSel = found;
      if (cached && found.territoryCode) {
        const feat = findTerritoryFeature(cached, found.territoryCode);
        const resolved = feat ? buildResolvedTerritory(feat, found.id, found.name) : null;
        if (resolved) {
          resolvedSel = makeSelection(found.id, found.name, resolved.polygon, "preset", {
            boundaryGeometry: resolved.boundaryGeometry,
            boundaryKind: "territory",
            territoryCode: resolved.territoryCode,
            bounds: resolved.bounds,
            areaKm2: resolved.areaKm2,
            center: resolved.center,
          });
        }
      }

      pushSelection(resolvedSel);
      setCameraState((prev) => ({
        ...prev,
        center: resolvedSel.center,
        zoom: zoomForBounds(resolvedSel.bounds),
      }));
    },
    [pushSelection, selectTerritoryByCode]
  );

  const convertBoundaryToEditableSketch = useCallback(() => {
    if (selection.polygon.length < 3) return;
    const next = makeSelection(
      `sketch-${Date.now()}`,
      `${selection.name} (Editable sketch)`,
      selection.polygon,
      "custom",
      {
        boundaryKind: "drawn",
        boundaryGeometry: undefined,
        territoryCode: undefined,
      }
    );
    pushSelection(next);
  }, [selection.name, selection.polygon, pushSelection]);

  const setPolygon = useCallback(
    (
      points: GeoPoint[],
      name?: string,
      sourceType: GeographicSelection["sourceType"] = "custom"
    ) => {
      if (points.length < 3) return;
      const next = makeSelection(
        `custom-${Date.now()}`,
        name ?? "Custom drawn region",
        points,
        sourceType,
        {
          boundaryKind: "drawn",
          boundaryGeometry: undefined,
          territoryCode: undefined,
        }
      );
      pushSelection(next);
    },
    [pushSelection]
  );

  const undoPolygon = useCallback(() => {
    setHistoryIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const redoPolygon = useCallback(() => {
    setHistoryIndex((idx) => Math.min(selectionHistory.length - 1, idx + 1));
  }, [selectionHistory.length]);

  const clearSelection = useCallback(() => {
    const empty: GeographicSelection = {
      id: "cleared",
      name: "No region selected",
      polygon: [],
      bounds: selection.bounds,
      areaKm2: 0,
      center: selection.center,
      sourceType: "custom",
    };
    pushSelection(empty);
  }, [pushSelection, selection.bounds, selection.center]);

  const updateMapping = useCallback((patch: Partial<SonificationMapping>) => {
    setMapping((prev) => {
      const next = { ...prev, ...patch };
      if (patch.volume !== undefined) sonificationService.setVolume(patch.volume);
      if (patch.waveform !== undefined) sonificationService.setWaveform(patch.waveform);
      return next;
    });
  }, []);

  const buildCompositionSpec = useCallback(
    (titleOverride?: string): AudioCompositionSpec => {
      const layerDef = getLayerDefinition(activeLayer);
      return {
        id: `${selection.id}-${activeLayer}-${timeIndex}`,
        title: titleOverride ?? `${selection.name} · ${layerDef.short}`,
        regionName: selection.name,
        variable: activeLayer,
        series: regionSeries,
        min: layerDef.vmin,
        max: layerDef.vmax,
        mapping,
        durationSec: 30,
      };
    },
    [selection.id, selection.name, activeLayer, timeIndex, regionSeries, mapping]
  );

  // Keep Web Audio synthesizer + preview schedule synchronized live with mapping changes on map workspace routes
  useEffect(() => {
    if (!isMapWorkspace) return;
    const spec = buildCompositionSpec();
    sonificationService.syncPreviewSpec(spec);
  }, [isMapWorkspace, buildCompositionSpec]);

  const loadWorkContext = useCallback(
    (work: GalleryWork, targetMode?: "globe" | "flat") => {
      const cached = getCachedWorldBoundaries();
      let resolvedGeom = work.boundaryGeometry;
      if (!resolvedGeom && work.territoryCode && cached?.resolution === "50m") {
        const feat = findTerritoryFeature(cached, work.territoryCode);
        const resolved = feat ? buildResolvedTerritory(feat, work.regionId, work.region) : null;
        if (resolved) resolvedGeom = resolved.boundaryGeometry;
      }
      const next = makeSelection(work.regionId, work.region, work.polygon, "gallery", {
        boundaryGeometry: resolvedGeom,
        boundaryKind: work.territoryCode ? "territory" : "drawn",
        territoryCode: work.territoryCode,
      });
      pushSelection(next);
      setActiveLayer(work.variable);
      setTimeIndex(Math.max(0, Math.min(timeSlots.length - 1, work.timeIndex)));
      setMapping((prev) => ({
        ...prev,
        density: work.mappings.density,
        brightness: work.mappings.brightness,
        pitchSensitivity: work.mappings.pitchSensitivity,
        spatialSpread: work.mappings.spatialSpread,
        tempo: work.tempo,
        musicalKey: work.musicalKey,
      }));
      setCameraState((prev) => ({
        ...prev,
        center: work.center,
        zoom: work.zoom,
        mode: targetMode ?? prev.mode,
      }));
      if (work.seriesPreview.length > 0) {
        setRegionSeries(work.seriesPreview);
      }
    },
    [pushSelection, setActiveLayer]
  );

  const saveWorkToGallery = useCallback(
    (customTitle?: string): GalleryWork => {
      const layerDef = getLayerDefinition(activeLayer);
      const timestamp = timeSlots[timeIndex] ?? timeSlots[0];
      const newWork: GalleryWork = {
        id: `work-${Date.now()}`,
        title: customTitle?.trim() || `${selection.name} (${layerDef.short})`,
        creator: "Saved in Studio",
        regionId: selection.id,
        region: selection.name,
        territoryCode: selection.territoryCode,
        polygon: selection.polygon,
        center: selection.center,
        zoom: Math.max(2.6, zoomForBounds(selection.bounds)),
        variable: activeLayer,
        timeIndex,
        timeRangeLabel: formatUtc(timestamp),
        duration: "00:30",
        tempo: mapping.tempo,
        musicalKey: mapping.musicalKey,
        mappings: {
          density: mapping.density,
          brightness: mapping.brightness,
          pitchSensitivity: mapping.pitchSensitivity,
          spatialSpread: mapping.spatialSpread,
        },
        seriesPreview: regionSeries.slice(),
        description: `User composition for ${selection.name} mapped from NASA GEOS-CF v2 ${layerDef.short} (${layerDef.unit}).`,
        dataSource: regionStats.sourceLabel,
        isIllustrative: false,
        isUserSaved: true,
      };
      setSavedWorks((prev) => {
        const next = [newWork, ...prev];
        try {
          window.localStorage.setItem(STORAGE_KEYS.savedWorks, JSON.stringify(next));
        } catch {
          // Ignore storage quota failure
        }
        return next;
      });
      return newWork;
    },
    [activeLayer, timeIndex, selection, mapping, regionSeries, regionStats.sourceLabel]
  );

  const toggleBookmark = useCallback((workId: string) => {
    setBookmarkedIds((prev) => {
      const next = prev.includes(workId) ? prev.filter((id) => id !== workId) : [...prev, workId];
      try {
        window.localStorage.setItem(STORAGE_KEYS.bookmarks, JSON.stringify(next));
      } catch {
        // Ignore storage failure
      }
      return next;
    });
  }, []);

  const exportProjectFile = useCallback((): BreatheProjectFile => {
    return {
      version: "2.0",
      name: selection.name,
      territoryCode: selection.territoryCode,
      polygon: selection.polygon,
      layer: activeLayer,
      timeIndex,
      tempo: mapping.tempo,
      key: mapping.musicalKey,
      waveform: mapping.waveform,
      mappings: [
        Math.round(mapping.density * 100),
        Math.round(mapping.brightness * 100),
        Math.round(mapping.pitchSensitivity * 100),
        Math.round(mapping.spatialSpread * 100),
      ],
    };
  }, [selection, activeLayer, timeIndex, mapping]);

  const importProjectFile = useCallback(
    (data: BreatheProjectFile) => {
      if (Array.isArray(data.polygon) && data.polygon.length >= 3) {
        const next = makeSelection(
          data.territoryCode ? `territory-${data.territoryCode}` : "imported",
          data.name || "Imported Region",
          data.polygon,
          "custom",
          {
            territoryCode: data.territoryCode,
            boundaryKind: data.territoryCode ? "territory" : "drawn",
          }
        );
        pushSelection(next);
        setCameraState((prev) => ({
          ...prev,
          center: next.center,
          zoom: zoomForBounds(next.bounds),
        }));
      }
      if (data.layer) setActiveLayer(data.layer);
      if (typeof data.timeIndex === "number") {
        setTimeIndex(Math.max(0, Math.min(timeSlots.length - 1, data.timeIndex)));
      }
      const m = data.mappings ?? [];
      setMapping((prev) => ({
        ...prev,
        tempo: typeof data.tempo === "number" ? data.tempo : prev.tempo,
        musicalKey: data.key || prev.musicalKey,
        waveform: data.waveform || prev.waveform,
        density: typeof m[0] === "number" ? Math.max(0, Math.min(1, m[0] / 100)) : prev.density,
        brightness: typeof m[1] === "number" ? Math.max(0, Math.min(1, m[1] / 100)) : prev.brightness,
        pitchSensitivity:
          typeof m[2] === "number" ? Math.max(0, Math.min(1, m[2] / 100)) : prev.pitchSensitivity,
        spatialSpread:
          typeof m[3] === "number" ? Math.max(0, Math.min(1, m[3] / 100)) : prev.spatialSpread,
      }));
    },
    [pushSelection, setActiveLayer]
  );

  const value = useMemo<BreatheContextValue>(
    () => ({
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
      regionSeries,
      savedWorks,
      bookmarkedIds,
      canUndoPolygon: historyIndex > 0,
      canRedoPolygon: historyIndex < selectionHistory.length - 1,
      setActiveLayer,
      getLayerRestriction,
      setBasemapMode,
      setLayerVisible,
      setLayerOpacity,
      setShowGrid,
      setShowLabels,
      setTimeIndex,
      setCamera,
      flyTo,
      updateMapping,
      selectPreset,
      selectTerritory,
      selectTerritoryByCode,
      convertBoundaryToEditableSketch,
      setPolygon,
      undoPolygon,
      redoPolygon,
      clearSelection,
      loadWorkContext,
      saveWorkToGallery,
      toggleBookmark,
      exportProjectFile,
      importProjectFile,
      buildCompositionSpec,
    }),
    [
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
      regionSeries,
      savedWorks,
      bookmarkedIds,
      historyIndex,
      selectionHistory.length,
      setActiveLayer,
      getLayerRestriction,
      setCamera,
      flyTo,
      updateMapping,
      selectPreset,
      selectTerritory,
      selectTerritoryByCode,
      convertBoundaryToEditableSketch,
      setPolygon,
      undoPolygon,
      redoPolygon,
      clearSelection,
      loadWorkContext,
      saveWorkToGallery,
      toggleBookmark,
      exportProjectFile,
      importProjectFile,
      buildCompositionSpec,
    ]
  );

  return (
    <MotionConfig reducedMotion="user">
      <BreatheContext.Provider value={value}>{children}</BreatheContext.Provider>
    </MotionConfig>
  );
}

export function useBreathe() {
  const ctx = useContext(BreatheContext);
  if (!ctx) {
    throw new Error("useBreathe must be used within BreatheProvider");
  }
  return ctx;
}

