import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { computeBounds, computeCentroid, simplifyPolygon, zoomForBounds } from "./geoUtils";
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

/**
 * Extracts a country or territory feature's primary mainland boundary as an editable GeoPoint ring.
 */
export function extractTerritoryPolygon(
  geom: GeoJSON.Geometry
): { polygon: GeoPoint[]; bounds: GeoBounds; center: GeoPoint; zoom: number } | null {
  let rings: number[][][] = [];
  if (geom.type === "Polygon" && geom.coordinates[0]) {
    rings = [geom.coordinates[0]];
  } else if (geom.type === "MultiPolygon") {
    rings = geom.coordinates.map((poly) => poly[0]).filter((r): r is number[][] => Boolean(r));
  }

  let bestRing: number[][] = [];
  let bestScore = -1;

  for (const ring of rings) {
    if (ring.length < 3) continue;
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (const c of ring) {
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
    }
    const lonSpan = maxLon - minLon;
    if (lonSpan > 175) continue;
    const score = lonSpan * (maxLat - minLat);
    if (score > bestScore) {
      bestScore = score;
      bestRing = ring;
    }
  }

  if (bestRing.length < 3) return null;

  const rawPoints: GeoPoint[] = bestRing
    .slice(0, -1)
    .map(([lon, lat]) => ({
      lat: Number(Math.max(-84, Math.min(84, lat)).toFixed(4)),
      lon: Number(lon.toFixed(4)),
    }));

  // Adapt simplification tolerance to territory size so edited rings remain smooth (~14..64 vertices)
  let simplified = simplifyPolygon(rawPoints, 0.16);
  if (simplified.length > 64) {
    simplified = simplifyPolygon(rawPoints, 0.35);
  }
  if (simplified.length > 64) {
    const step = Math.ceil(simplified.length / 56);
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
