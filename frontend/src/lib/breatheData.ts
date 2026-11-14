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
  sourceType: GeographicSelection["sourceType"] = "preset"
): GeographicSelection {
  return {
    id,
    name,
    polygon,
    bounds: computeBounds(polygon),
    areaKm2: approximateAreaKm2(polygon),
    center: computeCentroid(polygon),
    sourceType,
  };
}

export const presetSelections: GeographicSelection[] = [
  makeSelection("northern-vietnam", "Northern Vietnam", regions.northernVietnam, "preset"),
  makeSelection("ninh-thuan", "Ninh Thuận · Coast & Highlands", regions.ninhThuan, "preset"),
  makeSelection("east-china", "Beijing & East China", regions.eastChina, "preset"),
  makeSelection("bangkok", "Bangkok · Chao Phraya", regions.bangkokDelta, "preset"),
  makeSelection("singapore", "Singapore Strait", regions.singaporeStrait, "preset"),
  makeSelection("tokyo", "Tokyo Bay", regions.tokyoBay, "preset"),
  makeSelection("new-york", "New York Metro", regions.newYorkCorridor, "preset"),
  makeSelection("london", "London Basin", regions.londonBasin, "preset"),
  makeSelection("paris", "Paris Basin", regions.parisBasin, "preset"),
  makeSelection("sydney", "Sydney Coast", regions.sydneyCoast, "preset"),
];

export interface SearchablePlace {
  id: string;
  name: string;
  aliases: string[];
  point: GeoPoint;
  zoom: number;
  selectionId?: string;
}

export const searchablePlaces: SearchablePlace[] = [
  {
    id: "northern-vietnam",
    name: "Northern Vietnam",
    aliases: ["hanoi", "vietnam", "ha noi", "red river", "bac bo"],
    point: { lat: 21.1, lon: 105.75 },
    zoom: 5.2,
    selectionId: "northern-vietnam",
  },
  {
    id: "ninh-thuan",
    name: "Ninh Thuận · Coast & Highlands",
    aliases: ["ninh thuan", "phan rang", "south central vietnam"],
    point: { lat: 11.56, lon: 108.85 },
    zoom: 7.4,
    selectionId: "ninh-thuan",
  },
  {
    id: "east-china",
    name: "Beijing & East China",
    aliases: ["beijing", "china", "shanghai", "north china plain"],
    point: { lat: 39.9, lon: 116.4 },
    zoom: 4.5,
    selectionId: "east-china",
  },
  {
    id: "bangkok",
    name: "Bangkok, Thailand",
    aliases: ["bangkok", "thailand"],
    point: { lat: 13.75, lon: 100.5 },
    zoom: 6.1,
    selectionId: "bangkok",
  },
  {
    id: "singapore",
    name: "Singapore Strait",
    aliases: ["singapore", "malacca"],
    point: { lat: 1.3, lon: 103.8 },
    zoom: 6.4,
    selectionId: "singapore",
  },
  {
    id: "tokyo",
    name: "Tokyo, Japan",
    aliases: ["tokyo", "japan", "kanto"],
    point: { lat: 35.75, lon: 139.75 },
    zoom: 6.1,
    selectionId: "tokyo",
  },
  {
    id: "new-york",
    name: "New York City, USA",
    aliases: ["new york", "nyc", "manhattan", "usa"],
    point: { lat: 40.75, lon: -74.0 },
    zoom: 6.1,
    selectionId: "new-york",
  },
  {
    id: "london",
    name: "London, UK",
    aliases: ["london", "uk", "united kingdom"],
    point: { lat: 51.5, lon: -0.25 },
    zoom: 6.1,
    selectionId: "london",
  },
  {
    id: "paris",
    name: "Paris, France",
    aliases: ["paris", "france"],
    point: { lat: 48.75, lon: 2.25 },
    zoom: 6.1,
    selectionId: "paris",
  },
  {
    id: "sydney",
    name: "Sydney, Australia",
    aliases: ["sydney", "australia"],
    point: { lat: -33.8, lon: 151.2 },
    zoom: 6.1,
    selectionId: "sydney",
  },
];

export const approximateArea = approximateAreaKm2;

export const galleryWorks: GalleryWork[] = [
  {
    id: "beijing",
    title: "Breathing Beijing",
    creator: "BREATHE Studio",
    regionId: "east-china",
    region: "Beijing & East China",
    polygon: regions.eastChina,
    center: { lat: 35.5, lon: 116.4 },
    zoom: 4.1,
    variable: "PM25_RH35",
    timeIndex: 0,
    timeRangeLabel: "12 Nov 2026 · 00:30–21:30 UTC",
    duration: "03:24",
    tempo: 108,
    musicalKey: "D minor",
    mappings: { density: 0.84, brightness: 0.65, pitchSensitivity: 0.72, spatialSpread: 0.55 },
    seriesPreview: [112, 106, 98, 121, 134, 118, 95, 102],
    description:
      "A study of dense winter particulate accumulation across the North China Plain and its shifting diurnal pulse.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "forest",
    title: "Forest After Fire",
    creator: "BREATHE Studio",
    regionId: "western-canada",
    region: "Western Canada",
    polygon: regions.westernCanada,
    center: { lat: 54.2, lon: -120.0 },
    zoom: 3.8,
    variable: "CO",
    timeIndex: 4,
    timeRangeLabel: "12 Nov 2026 · 12:30 UTC",
    duration: "04:12",
    tempo: 78,
    musicalKey: "A minor",
    mappings: { density: 0.56, brightness: 0.74, pitchSensitivity: 0.62, spatialSpread: 0.82 },
    seriesPreview: [190, 210, 245, 290, 310, 275, 230, 198],
    description:
      "A slow acoustic drift tracking carbon monoxide smoke plumes moving across boreal forest corridors.",
    dataSource: "NASA GEOS-CF v2 (CO tracer)",
    isIllustrative: false,
  },
  {
    id: "monsoon",
    title: "Monsoon Pulse",
    creator: "BREATHE Studio",
    regionId: "northern-vietnam",
    region: "Northern Vietnam",
    polygon: regions.northernVietnam,
    center: { lat: 21.1, lon: 105.75 },
    zoom: 5.0,
    variable: "PM25_RH35",
    timeIndex: 0,
    timeRangeLabel: "12 Nov 2026 · 00:30–21:30 UTC",
    duration: "02:58",
    tempo: 96,
    musicalKey: "A minor",
    mappings: { density: 0.78, brightness: 0.58, pitchSensitivity: 0.74, spatialSpread: 0.48 },
    seriesPreview: [119.7, 94.2, 68.5, 58.1, 72.4, 88.6, 104.1, 114.0],
    description:
      "A coastal-to-basin rhythm shaped by morning accumulation and daytime boundary-layer ventilation over Hanoi.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "arctic",
    title: "Arctic Silence",
    creator: "BREATHE Studio",
    regionId: "arctic-basin",
    region: "Arctic region",
    polygon: regions.arcticBasin,
    center: { lat: 72.0, lon: 10.0 },
    zoom: 3.1,
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
    title: "City Contrast",
    creator: "BREATHE Studio",
    regionId: "tokyo",
    region: "Tokyo Bay · Kanto",
    polygon: regions.tokyoBay,
    center: { lat: 35.75, lon: 139.75 },
    zoom: 5.4,
    variable: "NO2",
    timeIndex: 3,
    timeRangeLabel: "12 Nov 2026 · 09:30 UTC",
    duration: "03:37",
    tempo: 112,
    musicalKey: "G major",
    mappings: { density: 0.68, brightness: 0.72, pitchSensitivity: 0.82, spatialSpread: 0.44 },
    seriesPreview: [14, 18, 22, 27, 24, 19, 16, 15],
    description:
      "Sharp urban NO₂ rush-hour gradients contrasting coastal sea-breeze dispersion against dense rail corridors.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
  {
    id: "year",
    title: "A Year of Air",
    creator: "BREATHE Studio",
    regionId: "ninh-thuan",
    region: "Ninh Thuận · Coast",
    polygon: regions.ninhThuan,
    center: { lat: 11.56, lon: 108.85 },
    zoom: 6.4,
    variable: "PM25_RH35",
    timeIndex: 2,
    timeRangeLabel: "12 Nov 2026 · 06:30 UTC",
    duration: "06:21",
    tempo: 88,
    musicalKey: "E minor",
    mappings: { density: 0.45, brightness: 0.52, pitchSensitivity: 0.58, spatialSpread: 0.64 },
    seriesPreview: [26, 29, 34, 31, 28, 25, 27, 30],
    description:
      "Coastal wind corridors meet arid highlands along south-central Vietnam, producing steady oceanic modulation.",
    dataSource: "NASA GEOS-CF v2",
    isIllustrative: false,
  },
];

export const works = galleryWorks;
