import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import {
  computeBounds,
  computeCentroid,
  computeGeometryAreaKm2,
  computePrimaryFocusBounds,
  simplifyPolygon,
  zoomForBounds,
} from "./geoUtils";
import type { GeoBounds, GeoPoint } from "@/types/breathe";

export interface CountryFeatureProperties {
  isoNumeric: string;
  name: string;
  centerLat: number;
  centerLon: number;
  bboxSpanDeg: number;
}

export interface WorldBoundaryBundle {
  countries: GeoJSON.FeatureCollection<GeoJSON.Geometry, CountryFeatureProperties>;
  borders: GeoJSON.Feature<GeoJSON.MultiLineString>;
  coastlines: GeoJSON.Feature<GeoJSON.MultiLineString>;
  labelAnchors: Array<{ text: string; lat: number; lon: number; minZoom: number }>;
}

export interface ResolvedTerritorySelection {
  id: string;
  territoryCode: string;
  name: string;
  boundaryGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  polygon: GeoPoint[];
  bounds: GeoBounds;
  areaKm2: number;
  center: GeoPoint;
  zoom: number;
}

let bundlePromise: Promise<WorldBoundaryBundle> | null = null;
let cachedBundle: WorldBoundaryBundle | null = null;

function computeGeometrySummary(geom: GeoJSON.Geometry): {
  centerLat: number;
  centerLon: number;
  bboxSpanDeg: number;
} {
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  let bestRing: number[][] = [];
  let bestAreaScore = -1;

  const inspectRing = (ring: number[][]) => {
    if (ring.length < 3) return;
    let rMinLat = 90;
    let rMaxLat = -90;
    let rMinLon = 180;
    let rMaxLon = -180;
    for (const coord of ring) {
      const lon = coord[0];
      const lat = coord[1];
      if (lat < rMinLat) rMinLat = lat;
      if (lat > rMaxLat) rMaxLat = lat;
      if (lon < rMinLon) rMinLon = lon;
      if (lon > rMaxLon) rMaxLon = lon;
    }
    const lonSpan = rMaxLon - rMinLon;
    // Skip antimeridian-spanning wide global wrap rings for center calc when possible
    if (lonSpan > 170) return;
    const areaScore = lonSpan * (rMaxLat - rMinLat);
    if (areaScore > bestAreaScore) {
      bestAreaScore = areaScore;
      bestRing = ring;
    }
    minLat = Math.min(minLat, rMinLat);
    maxLat = Math.max(maxLat, rMaxLat);
    minLon = Math.min(minLon, rMinLon);
    maxLon = Math.max(maxLon, rMaxLon);
  };

  if (geom.type === "Polygon" && geom.coordinates[0]) {
    inspectRing(geom.coordinates[0]);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      if (poly[0]) inspectRing(poly[0]);
    }
  }

  if (bestRing.length >= 3) {
    let sumLat = 0;
    let sumLon = 0;
    for (const c of bestRing) {
      sumLon += c[0];
      sumLat += c[1];
    }
    const centerLon = sumLon / bestRing.length;
    const centerLat = sumLat / bestRing.length;
    return {
      centerLat: Number(centerLat.toFixed(3)),
      centerLon: Number(centerLon.toFixed(3)),
      bboxSpanDeg: Number(Math.max(maxLon - minLon, maxLat - minLat).toFixed(2)),
    };
  }

  return { centerLat: 0, centerLon: 0, bboxSpanDeg: 10 };
}

/**
 * Loads Natural Earth 50m world country & territory vector boundaries once via dynamic import.
 */
export async function loadWorldBoundaries(): Promise<WorldBoundaryBundle> {
  if (cachedBundle) return cachedBundle;
  if (bundlePromise) return bundlePromise;

  bundlePromise = import("world-atlas/countries-50m.json").then((mod) => {
    const topo = (mod.default ?? mod) as unknown as Topology<{
      countries: GeometryCollection<{ name?: string }>;
    }>;

    const rawCountries = feature(topo, topo.objects.countries);
    const filteredFeatures: Array<GeoJSON.Feature<GeoJSON.Geometry, CountryFeatureProperties>> = [];
    const labelAnchors: Array<{ text: string; lat: number; lon: number; minZoom: number }> = [];

    rawCountries.features.forEach((feat, index) => {
      const isoNumeric = String(feat.id ?? index);
      const name = String(feat.properties?.name ?? `Territory ${isoNumeric}`);
      // Exclude Antarctica shelf polygon from Mercator horizontal stretch
      if (isoNumeric === "010" || name === "Antarctica") return;
      if (!feat.geometry) return;

      const summary = computeGeometrySummary(feat.geometry);
      const numericId = index + 1;

      filteredFeatures.push({
        type: "Feature",
        id: numericId,
        properties: {
          isoNumeric,
          name,
          centerLat: summary.centerLat,
          centerLon: summary.centerLon,
          bboxSpanDeg: summary.bboxSpanDeg,
        },
        geometry: feat.geometry,
      });

      if (summary.bboxSpanDeg >= 1.2) {
        const minZoom =
          summary.bboxSpanDeg >= 18
            ? 1.0
            : summary.bboxSpanDeg >= 8
            ? 2.2
            : summary.bboxSpanDeg >= 3.2
            ? 3.1
            : 4.3;
        labelAnchors.push({
          text: name.toUpperCase(),
          lat: summary.centerLat,
          lon: summary.centerLon,
          minZoom,
        });
      }
    });

    const countries: GeoJSON.FeatureCollection<GeoJSON.Geometry, CountryFeatureProperties> = {
      type: "FeatureCollection",
      features: filteredFeatures,
    };

    const borderMesh = mesh(topo, topo.objects.countries, (a, b) => a !== b);
    const coastMesh = mesh(topo, topo.objects.countries, (a, b) => a === b);

    const bundle: WorldBoundaryBundle = {
      countries,
      borders: {
        type: "Feature",
        properties: {},
        geometry: borderMesh,
      },
      coastlines: {
        type: "Feature",
        properties: {},
        geometry: coastMesh,
      },
      labelAnchors,
    };

    cachedBundle = bundle;
    return bundle;
  });

  return bundlePromise;
}

export function getCachedWorldBoundaries(): WorldBoundaryBundle | null {
  return cachedBundle;
}

function isPolygonalGeometry(
  geom: GeoJSON.Geometry | null | undefined
): geom is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  return Boolean(geom && (geom.type === "Polygon" || geom.type === "MultiPolygon"));
}

const TERRITORY_NAME_ALIASES: Record<string, string> = {
  usa: "United States of America",
  us: "United States of America",
  "united states": "United States of America",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  "viet nam": "Vietnam",
  russia: "Russia",
  "south korea": "South Korea",
};

/**
 * Finds a territory feature inside a loaded WorldBoundaryBundle by ISO numeric code or country name/alias.
 */
export function findTerritoryFeature(
  bundle: WorldBoundaryBundle,
  codeOrName: string
): GeoJSON.Feature<GeoJSON.Geometry, CountryFeatureProperties> | null {
  const trimmed = codeOrName.trim();
  if (!trimmed) return null;
  const normalizedCode = trimmed.replace(/^territory-/, "");
  const lower = trimmed.toLowerCase();
  const aliased = TERRITORY_NAME_ALIASES[lower]?.toLowerCase() ?? lower;

  return (
    bundle.countries.features.find((f) => f.properties.isoNumeric === normalizedCode) ??
    bundle.countries.features.find((f) => f.properties.name.toLowerCase() === aliased) ??
    bundle.countries.features.find((f) => f.properties.name.toLowerCase() === lower) ??
    null
  );
}

/**
 * Resolves a country/territory GeoJSON feature cleanly into an unclipped full-border selection,
 * preserving MultiPolygon islands/holes while computing mainland-focused viewport bounds.
 */
export function buildResolvedTerritory(
  feat: GeoJSON.Feature<GeoJSON.Geometry, Partial<CountryFeatureProperties> | GeoJSON.GeoJsonProperties>,
  idOverride?: string,
  nameOverride?: string
): ResolvedTerritorySelection | null {
  if (!isPolygonalGeometry(feat.geometry)) return null;

  const isoNumeric = String(feat.properties?.isoNumeric ?? feat.id ?? "unknown");
  const name = nameOverride ?? String(feat.properties?.name ?? `Territory ${isoNumeric}`);
  const focus = computePrimaryFocusBounds(feat.geometry);
  const areaKm2 = computeGeometryAreaKm2(feat.geometry);
  const zoom = zoomForBounds(focus.bounds);

  // Build simplified mainland ring only as an editable-sketch / legacy fallback
  const rawMainRing: GeoPoint[] = focus.primaryRing
    .slice(0, focus.primaryRing.length > 1 ? -1 : focus.primaryRing.length)
    .map(([lon, lat]) => ({
      lat: Number(Math.max(-84, Math.min(84, lat)).toFixed(4)),
      lon: Number(lon.toFixed(4)),
    }));
  let fallback = simplifyPolygon(rawMainRing, 0.08);
  if (fallback.length > 48) {
    fallback = simplifyPolygon(rawMainRing, 0.18);
  }
  if (fallback.length > 48) {
    const step = Math.ceil(fallback.length / 40);
    fallback = fallback.filter((_, idx) => idx % step === 0);
  }
  if (fallback.length < 3) {
    fallback = rawMainRing.slice(0, Math.min(24, rawMainRing.length));
  }

  return {
    id: idOverride ?? `territory-${isoNumeric}`,
    territoryCode: isoNumeric,
    name,
    boundaryGeometry: feat.geometry,
    polygon: fallback,
    bounds: focus.bounds,
    areaKm2,
    center: focus.center,
    zoom,
  };
}

/**
 * Resolves a country/territory by ISO numeric code or name (loading worldBoundaries on demand).
 */
export async function resolveTerritoryByCodeOrName(
  codeOrName: string,
  idOverride?: string,
  nameOverride?: string
): Promise<ResolvedTerritorySelection | null> {
  const bundle = await loadWorldBoundaries();
  const feat = findTerritoryFeature(bundle, codeOrName);
  if (!feat) return null;
  return buildResolvedTerritory(feat, idOverride, nameOverride);
}

/**
 * Extracts a simplified editable GeoPoint ring from a GeoJSON territory boundary
 * (used strictly when converting an official border to a user-editable sketch).
 */
export function extractTerritoryPolygon(
  geom: GeoJSON.Geometry
): { polygon: GeoPoint[]; bounds: GeoBounds; center: GeoPoint; zoom: number } | null {
  if (!isPolygonalGeometry(geom)) return null;
  const focus = computePrimaryFocusBounds(geom);
  const bestRing = focus.primaryRing;
  if (bestRing.length < 3) return null;

  const rawPoints: GeoPoint[] = bestRing
    .slice(0, -1)
    .map(([lon, lat]) => ({
      lat: Number(Math.max(-84, Math.min(84, lat)).toFixed(4)),
      lon: Number(lon.toFixed(4)),
    }));

  // Keep up to ~48 vertices for smooth manual vertex editing
  let simplified = simplifyPolygon(rawPoints, 0.14);
  if (simplified.length > 48) {
    simplified = simplifyPolygon(rawPoints, 0.28);
  }
  if (simplified.length > 48) {
    const step = Math.ceil(simplified.length / 44);
    simplified = simplified.filter((_, idx) => idx % step === 0);
  }
  if (simplified.length < 3) {
    simplified = rawPoints.slice(0, Math.min(24, rawPoints.length));
  }

  const bounds = computeBounds(simplified);
  const center = computeCentroid(simplified);
  const zoom = zoomForBounds(bounds);

  return { polygon: simplified, bounds, center, zoom };
}
