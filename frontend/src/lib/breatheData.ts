import source from "@/data/observations.json";
import { approximateAreaKm2, computeBounds, computeCentroid } from "@/lib/geoUtils";
import type {
  GalleryWork,
  GeographicSelection,
  GeoPoint,
  LayerDefinition,
  LayerKey,
} from "@/types/breathe";

export type { LayerKey, GeoPoint };

export const layers: LayerDefinition[] = [
  {
    key: "PM25_RH35",
    label: "Fine particles",
    short: "PM2.5",
    unit: "µg/m³",
    available: true,
    vmin: 0,
    vmax: 150,
    cmap: "inferno",
    description:
      "Fine particulate matter (≤ 2.5 µm) near Earth's surface at 35% relative humidity from NASA GMAO GEOS-CF v2.",
    methodologyNote:
      "Surface mass concentration from GEOS-CF v2 assimilation (distinct from column AOD and AQI).",
  },
  {
    key: "AOD",
    label: "Aerosol optical depth",
    short: "AOD",
    unit: "dimensionless",
    available: false,
    vmin: 0,
    vmax: 1.5,
    cmap: "inferno",
    description:
      "Dimensionless measure of total vertical sunlight extinction by aerosols aloft. Distinct from surface PM2.5 and AQI.",
    methodologyNote:
      "Awaiting live NASA MODIS/VIIRS AOD granule connection. Never substituted with PM2.5.",
  },
  {
    key: "NO2",
    label: "Nitrogen dioxide",
    short: "NO₂",
    unit: "ppbv",
    available: true,
    vmin: 0,
    vmax: 45,
    cmap: "magma",
    description: "Reactive nitrogen oxide trace gas emitted by urban traffic, industry, and combustion.",
    methodologyNote: "Surface mole fraction converted from mol/mol to ppbv (×10⁹).",
  },
  {
    key: "SO2",
    label: "Sulfur dioxide",
    short: "SO₂",
    unit: "ppbv",
    available: true,
    vmin: 0,
    vmax: 25,
    cmap: "plasma",
    description: "Sulfur trace gas from coal/oil combustion, smelting, and volcanic degassing.",
    methodologyNote: "Surface mole fraction converted from mol/mol to ppbv (×10⁹).",
  },
  {
    key: "CO",
    label: "Carbon monoxide",
    short: "CO",
    unit: "ppbv",
    available: true,
    vmin: 50,
    vmax: 600,
    cmap: "cividis",
    description: "Long-lived combustion and wildfire smoke tracer transported across continents.",
    methodologyNote: "Surface mole fraction converted from mol/mol to ppbv (×10⁹).",
  },
  {
    key: "O3",
    label: "Ground-level ozone",
    short: "O₃",
    unit: "ppbv",
    available: true,
    vmin: 10,
    vmax: 50,
    cmap: "viridis",
    description: "Photochemical oxidant formed near the surface in sunlight from NOₓ and VOCs.",
    methodologyNote: "Surface mole fraction converted from mol/mol to ppbv (×10⁹).",
  },
];

export const observations = source.dataset.observations;
export const mapFrames = source.maps;
export const timeSlots = Array.from(new Set(mapFrames.map((frame) => frame.timestamp))).sort();
export const dataSourceUrl = source.dataset.sourceUrl;

export function getLayerDefinition(key: LayerKey): LayerDefinition {
  return layers.find((layer) => layer.key === key) ?? layers[0];
}

export function frameFor(layer: LayerKey, timeIndex: number) {
  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  return mapFrames.find(
    (frame) => frame.variable === layer && frame.timestamp === timeSlots[safeIndex]
  );
}

export function formatUtc(value: string, includeTime = true) {
  return (
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(new Date(value)) + (includeTime ? " UTC" : "")
  );
}

export const regions = {
  eastChina: [
    { lat: 41.2, lon: 113.0 },
    { lat: 41.0, lon: 119.8 },
    { lat: 36.2, lon: 121.6 },
    { lat: 30.8, lon: 122.0 },
    { lat: 28.4, lon: 115.8 },
    { lat: 33.4, lon: 110.2 },
  ] satisfies GeoPoint[],
  northernVietnam: [
    { lat: 23.4, lon: 103.7 },
    { lat: 22.7, lon: 106.8 },
    { lat: 21.8, lon: 108.5 },
    { lat: 19.9, lon: 107.1 },
    { lat: 19.0, lon: 105.4 },
    { lat: 20.2, lon: 103.0 },
  ] satisfies GeoPoint[],
  ninhThuan: [
    { lat: 11.86, lon: 108.45 },
    { lat: 11.84, lon: 109.05 },
    { lat: 11.48, lon: 109.18 },
    { lat: 11.28, lon: 108.94 },
    { lat: 11.34, lon: 108.51 },
  ] satisfies GeoPoint[],
  westernCanada: [
    { lat: 57.5, lon: -126.0 },
    { lat: 57.5, lon: -114.0 },
    { lat: 51.0, lon: -114.0 },
    { lat: 51.0, lon: -126.0 },
  ] satisfies GeoPoint[],
  arcticBasin: [
    { lat: 76.0, lon: -15.0 },
    { lat: 76.0, lon: 35.0 },
    { lat: 68.5, lon: 35.0 },
    { lat: 68.5, lon: -15.0 },
  ] satisfies GeoPoint[],
  bangkokDelta: [
    { lat: 14.9, lon: 99.6 },
    { lat: 14.9, lon: 101.6 },
    { lat: 13.1, lon: 101.6 },
    { lat: 13.1, lon: 99.6 },
  ] satisfies GeoPoint[],
  tokyoBay: [
    { lat: 36.6, lon: 138.6 },
    { lat: 36.6, lon: 140.9 },
    { lat: 34.8, lon: 140.9 },
    { lat: 34.8, lon: 138.6 },
  ] satisfies GeoPoint[],
  newYorkCorridor: [
    { lat: 41.6, lon: -75.2 },
    { lat: 41.6, lon: -72.6 },
    { lat: 39.8, lon: -72.6 },
    { lat: 39.8, lon: -75.2 },
  ] satisfies GeoPoint[],
  londonBasin: [
    { lat: 52.3, lon: -1.4 },
    { lat: 52.3, lon: 1.0 },
    { lat: 50.8, lon: 1.0 },
    { lat: 50.8, lon: -1.4 },
  ] satisfies GeoPoint[],
  parisBasin: [
    { lat: 49.6, lon: 1.2 },
    { lat: 49.6, lon: 3.6 },
    { lat: 48.0, lon: 3.6 },
    { lat: 48.0, lon: 1.2 },
  ] satisfies GeoPoint[],
  sydneyCoast: [
    { lat: -32.9, lon: 150.1 },
    { lat: -32.9, lon: 152.2 },
    { lat: -34.7, lon: 152.2 },
    { lat: -34.7, lon: 150.1 },
  ] satisfies GeoPoint[],
  singaporeStrait: [
    { lat: 2.3, lon: 102.6 },
    { lat: 2.3, lon: 104.9 },
    { lat: 0.5, lon: 104.9 },
    { lat: 0.5, lon: 102.6 },
  ] satisfies GeoPoint[],
};

export function makeSelection(
  id: string,
  name: string,
  polygon: GeoPoint[],
  sourceType: GeographicSelection["sourceType"] = "preset",
  extras?: {
    boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    boundaryKind?: GeographicSelection["boundaryKind"];
    territoryCode?: string;
    bounds?: GeographicSelection["bounds"];
    areaKm2?: number;
    center?: GeoPoint;
  }
): GeographicSelection {
  return {
    id,
    name,
    boundaryGeometry: extras?.boundaryGeometry,
    boundaryKind:
      extras?.boundaryKind ?? (extras?.boundaryGeometry || extras?.territoryCode ? "territory" : "drawn"),
    territoryCode: extras?.territoryCode,
    polygon,
    bounds: extras?.bounds ?? computeBounds(polygon),
    areaKm2: extras?.areaKm2 ?? approximateAreaKm2(polygon),
    center: extras?.center ?? computeCentroid(polygon),
    sourceType,
  };
}

export const presetSelections: GeographicSelection[] = [
  makeSelection("vietnam", "Vietnam", regions.northernVietnam, "preset", {
    territoryCode: "704",
    boundaryKind: "territory",
    bounds: { west: 102.14, south: 8.56, east: 109.47, north: 23.39 },
    center: { lat: 15.98, lon: 105.8 },
    areaKm2: 331212,
  }),
  makeSelection("china", "China", regions.eastChina, "preset", {
    territoryCode: "156",
    boundaryKind: "territory",
    bounds: { west: 73.5, south: 18.1, east: 134.8, north: 53.6 },
    center: { lat: 35.8, lon: 104.1 },
    areaKm2: 9596961,
  }),
  makeSelection("thailand", "Thailand", regions.bangkokDelta, "preset", {
    territoryCode: "764",
    boundaryKind: "territory",
    bounds: { west: 97.35, south: 5.61, east: 105.64, north: 20.46 },
    center: { lat: 13.04, lon: 101.49 },
    areaKm2: 513120,
  }),
  makeSelection("singapore", "Singapore", regions.singaporeStrait, "preset", {
    territoryCode: "702",
    boundaryKind: "territory",
    bounds: { west: 103.6, south: 1.16, east: 104.09, north: 1.47 },
    center: { lat: 1.35, lon: 103.82 },
    areaKm2: 728,
  }),
  makeSelection("japan", "Japan", regions.tokyoBay, "preset", {
    territoryCode: "392",
    boundaryKind: "territory",
    bounds: { west: 129.4, south: 30.2, east: 145.8, north: 45.5 },
    center: { lat: 37.85, lon: 137.6 },
    areaKm2: 377975,
  }),
  makeSelection("south-korea", "South Korea", regions.tokyoBay, "preset", {
    territoryCode: "410",
    boundaryKind: "territory",
    bounds: { west: 125.0, south: 33.1, east: 129.6, north: 38.6 },
    center: { lat: 35.9, lon: 127.7 },
    areaKm2: 100210,
  }),
  makeSelection("indonesia", "Indonesia", regions.singaporeStrait, "preset", {
    territoryCode: "360",
    boundaryKind: "territory",
    bounds: { west: 95.0, south: -11.0, east: 141.0, north: 6.1 },
    center: { lat: -2.4, lon: 118.0 },
    areaKm2: 1904569,
  }),
  makeSelection("india", "India", regions.bangkokDelta, "preset", {
    territoryCode: "356",
    boundaryKind: "territory",
    bounds: { west: 68.1, south: 6.75, east: 97.4, north: 35.5 },
    center: { lat: 21.1, lon: 78.9 },
    areaKm2: 3287263,
  }),
  makeSelection("united-states", "United States of America", regions.newYorkCorridor, "preset", {
    territoryCode: "840",
    boundaryKind: "territory",
    bounds: { west: -124.8, south: 24.5, east: -66.9, north: 49.4 },
    center: { lat: 39.8, lon: -98.5 },
    areaKm2: 9833517,
  }),
  makeSelection("united-kingdom", "United Kingdom", regions.londonBasin, "preset", {
    territoryCode: "826",
    boundaryKind: "territory",
    bounds: { west: -8.2, south: 49.9, east: 1.8, north: 60.8 },
    center: { lat: 54.4, lon: -2.9 },
    areaKm2: 242495,
  }),
  makeSelection("france", "France", regions.parisBasin, "preset", {
    territoryCode: "250",
    boundaryKind: "territory",
    bounds: { west: -5.1, south: 41.3, east: 9.6, north: 51.1 },
    center: { lat: 46.6, lon: 2.3 },
    areaKm2: 551695,
  }),
  makeSelection("canada", "Canada", regions.westernCanada, "preset", {
    territoryCode: "124",
    boundaryKind: "territory",
    bounds: { west: -141.0, south: 41.7, east: -52.6, north: 83.1 },
    center: { lat: 59.0, lon: -96.0 },
    areaKm2: 9984670,
  }),
  makeSelection("australia", "Australia", regions.sydneyCoast, "preset", {
    territoryCode: "036",
    boundaryKind: "territory",
    bounds: { west: 113.2, south: -43.6, east: 153.6, north: -10.7 },
    center: { lat: -25.8, lon: 133.7 },
    areaKm2: 7692024,
  }),
  makeSelection("norway", "Norway", regions.arcticBasin, "preset", {
    territoryCode: "578",
    boundaryKind: "territory",
    bounds: { west: 4.5, south: 58.0, east: 31.1, north: 71.2 },
    center: { lat: 64.6, lon: 11.5 },
    areaKm2: 385207,
  }),
];

export interface SearchablePlace {
  id: string;
  name: string;
  aliases: string[];
  point: GeoPoint;
  zoom: number;
  selectionId?: string;
  territoryCode?: string;
}

export const searchablePlaces: SearchablePlace[] = [
  {
    id: "vietnam",
    name: "Vietnam",
    aliases: ["vietnam", "viet nam", "hanoi", "ha noi", "ho chi minh", "ninh thuan"],
    point: { lat: 15.98, lon: 105.8 },
    zoom: 4.1,
    selectionId: "vietnam",
    territoryCode: "704",
  },
  {
    id: "china",
    name: "China",
    aliases: ["beijing", "china", "shanghai", "guangzhou"],
    point: { lat: 35.8, lon: 104.1 },
    zoom: 3.1,
    selectionId: "china",
    territoryCode: "156",
  },
  {
    id: "thailand",
    name: "Thailand",
    aliases: ["bangkok", "thailand", "chiang mai"],
    point: { lat: 13.04, lon: 101.49 },
    zoom: 4.4,
    selectionId: "thailand",
    territoryCode: "764",
  },
  {
    id: "singapore",
    name: "Singapore",
    aliases: ["singapore", "malacca"],
    point: { lat: 1.35, lon: 103.82 },
    zoom: 7.4,
    selectionId: "singapore",
    territoryCode: "702",
  },
  {
    id: "japan",
    name: "Japan",
    aliases: ["tokyo", "japan", "osaka", "kanto"],
    point: { lat: 37.85, lon: 137.6 },
    zoom: 4.2,
    selectionId: "japan",
    territoryCode: "392",
  },
  {
    id: "south-korea",
    name: "South Korea",
    aliases: ["seoul", "south korea", "korea", "busan"],
    point: { lat: 35.9, lon: 127.7 },
    zoom: 5.4,
    selectionId: "south-korea",
    territoryCode: "410",
  },
  {
    id: "united-states",
    name: "United States of America",
    aliases: ["new york", "nyc", "usa", "united states", "california"],
    point: { lat: 39.8, lon: -98.5 },
    zoom: 2.9,
    selectionId: "united-states",
    territoryCode: "840",
  },
  {
    id: "united-kingdom",
    name: "United Kingdom",
    aliases: ["london", "uk", "united kingdom", "britain", "england"],
    point: { lat: 54.4, lon: -2.9 },
    zoom: 4.7,
    selectionId: "united-kingdom",
    territoryCode: "826",
  },
  {
    id: "france",
    name: "France",
    aliases: ["paris", "france", "lyon", "marseille"],
    point: { lat: 46.6, lon: 2.3 },
    zoom: 4.6,
    selectionId: "france",
    territoryCode: "250",
  },
  {
    id: "australia",
    name: "Australia",
    aliases: ["sydney", "australia", "melbourne"],
    point: { lat: -25.8, lon: 133.7 },
    zoom: 3.1,
    selectionId: "australia",
    territoryCode: "036",
  },
  {
    id: "canada",
    name: "Canada",
    aliases: ["canada", "vancouver", "toronto", "montreal"],
    point: { lat: 59.0, lon: -96.0 },
    zoom: 2.8,
    selectionId: "canada",
    territoryCode: "124",
  },
  {
    id: "norway",
    name: "Norway",
    aliases: ["norway", "oslo", "tromso", "arctic"],
    point: { lat: 64.6, lon: 11.5 },
    zoom: 4.1,
    selectionId: "norway",
    territoryCode: "578",
  },
];

export const approximateArea = approximateAreaKm2;

export const galleryWorks: GalleryWork[] = [
  {
    id: "beijing",
    title: "Breathing China",
    creator: "BREATHE Studio",
    regionId: "china",
    region: "China",
    territoryCode: "156",
    polygon: regions.eastChina,
    center: { lat: 35.8, lon: 104.1 },
    zoom: 3.1,
    variable: "PM25_RH35",
    timeIndex: 0,
    timeRangeLabel: "12 Nov 2026 · 00:30–21:30 UTC",
    duration: "03:24",
    tempo: 108,
    musicalKey: "D minor",
    mappings: { density: 0.84, brightness: 0.65, pitchSensitivity: 0.72, spatialSpread: 0.55 },
    seriesPreview: [112, 106, 98, 121, 134, 118, 95, 102],
    description:
      "A study of winter particulate gradients across China's eastern basins and shifting diurnal pulses.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "forest",
    title: "Forest After Fire",
    creator: "BREATHE Studio",
    regionId: "canada",
    region: "Canada",
    territoryCode: "124",
    polygon: regions.westernCanada,
    center: { lat: 56.0, lon: -102.0 },
    zoom: 2.8,
    variable: "CO",
    timeIndex: 4,
    timeRangeLabel: "12 Nov 2026 · 12:30 UTC",
    duration: "04:12",
    tempo: 78,
    musicalKey: "A minor",
    mappings: { density: 0.56, brightness: 0.74, pitchSensitivity: 0.62, spatialSpread: 0.82 },
    seriesPreview: [190, 210, 245, 290, 310, 275, 230, 198],
    description:
      "A slow acoustic drift tracking carbon monoxide smoke plumes moving across boreal forest corridors in Canada.",
    dataSource: "NASA GEOS-CF v2 (CO tracer)",
    isIllustrative: false,
  },
  {
    id: "monsoon",
    title: "Monsoon Pulse",
    creator: "BREATHE Studio",
    regionId: "vietnam",
    region: "Vietnam",
    territoryCode: "704",
    polygon: regions.northernVietnam,
    center: { lat: 15.98, lon: 105.8 },
    zoom: 4.1,
    variable: "PM25_RH35",
    timeIndex: 0,
    timeRangeLabel: "12 Nov 2026 · 00:30–21:30 UTC",
    duration: "02:58",
    tempo: 96,
    musicalKey: "A minor",
    mappings: { density: 0.78, brightness: 0.58, pitchSensitivity: 0.74, spatialSpread: 0.48 },
    seriesPreview: [119.7, 94.2, 68.5, 58.1, 72.4, 88.6, 104.1, 114.0],
    description:
      "A coastal-to-basin rhythm shaped by morning accumulation and daytime boundary-layer ventilation across Vietnam.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "arctic",
    title: "Arctic Silence",
    creator: "BREATHE Studio",
    regionId: "norway",
    region: "Norway",
    territoryCode: "578",
    polygon: regions.arcticBasin,
    center: { lat: 64.6, lon: 11.5 },
    zoom: 4.0,
    variable: "O3",
    timeIndex: 6,
    timeRangeLabel: "12 Nov 2026 · 18:30 UTC",
    duration: "05:09",
    tempo: 64,
    musicalKey: "C major",
    mappings: { density: 0.28, brightness: 0.35, pitchSensitivity: 0.38, spatialSpread: 0.88 },
    seriesPreview: [24, 23, 22, 24, 25, 24, 23, 22],
    description:
      "A sparse, low-density interpretation reflecting clean high-latitude background ozone and calm vertical gradients.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "contrast",
    title: "Island Corridor",
    creator: "BREATHE Studio",
    regionId: "japan",
    region: "Japan",
    territoryCode: "392",
    polygon: regions.tokyoBay,
    center: { lat: 37.85, lon: 137.6 },
    zoom: 4.2,
    variable: "NO2",
    timeIndex: 3,
    timeRangeLabel: "12 Nov 2026 · 09:30 UTC",
    duration: "03:37",
    tempo: 112,
    musicalKey: "G major",
    mappings: { density: 0.68, brightness: 0.72, pitchSensitivity: 0.82, spatialSpread: 0.44 },
    seriesPreview: [14, 18, 22, 27, 24, 19, 16, 15],
    description:
      "Sharp urban NO₂ rush-hour gradients contrasting coastal sea-breeze dispersion against dense rail corridors across Japan.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "year",
    title: "A Year of Air",
    creator: "BREATHE Studio",
    regionId: "thailand",
    region: "Thailand",
    territoryCode: "764",
    polygon: regions.bangkokDelta,
    center: { lat: 13.04, lon: 101.49 },
    zoom: 4.4,
    variable: "PM25_RH35",
    timeIndex: 2,
    timeRangeLabel: "12 Nov 2026 · 06:30 UTC",
    duration: "06:21",
    tempo: 88,
    musicalKey: "E minor",
    mappings: { density: 0.45, brightness: 0.52, pitchSensitivity: 0.58, spatialSpread: 0.64 },
    seriesPreview: [26, 29, 34, 31, 28, 25, 27, 30],
    description:
      "Seasonal tropical valley circulation and coastal haze shifts translated across Thailand's borders.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
];

export const works = galleryWorks;
