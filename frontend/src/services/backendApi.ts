export interface BackendHealthStatus {
  status: string;
  service: string;
  version: string;
  timestamp: string;
  dataset_loaded: boolean;
  observations_count: number;
  active_variable: string | null;
}

export type BackendConnectionState = "checking" | "live" | "offline";

export interface BackendDatasetAvailability {
  datasetId: string;
  availableTimes: string[];
  timeRange: {
    start: string | null;
    end: string | null;
  };
  totalGranules: number;
}

export interface BackendLocationItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: string;
  isPreset: boolean;
}

export interface BackendTemporalPoint {
  order: number;
  locationId?: string | null;
  timestamp: string;
  value: number | null;
  normalizedValue: number | null;
  displayValue: number | null;
  displayUnit?: string | null;
  quality: string;
}

export interface BackendTemporalResponse {
  mode: "temporal" | "spatial";
  datasetId: string;
  variable: string;
  unit: string;
  displayUnit?: string | null;
  dataType: string;
  isMock: boolean;
  points: BackendTemporalPoint[];
  provenance?: {
    provider?: string;
    sourceUrl?: string;
    productVersion?: string;
  };
}

export function sanitizeBackendUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return undefined;
  }
  return trimmed
    .replace(/\/+$/, "")
    .replace(/\/api\/v1\/?$/i, "")
    .replace(/\/+$/, "");
}

export function resolveProxyBackendBase(
  env: Record<string, string | undefined> = process.env
): string {
  return (
    sanitizeBackendUrl(env.BACKEND_API_URL) ||
    sanitizeBackendUrl(env.NEXT_PUBLIC_BACKEND_URL) ||
    sanitizeBackendUrl(env.NEXT_PUBLIC_API_URL) ||
    "http://localhost:8000"
  );
}

export function buildProxyTargetUrl(
  pathSegments: string[],
  search: string = "",
  baseUrl: string = resolveProxyBackendBase()
): string {
  const cleanBase = sanitizeBackendUrl(baseUrl) || "http://localhost:8000";
  const cleanPath = pathSegments
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${cleanBase}/api/v1/${cleanPath}${query}`;
}

/**
 * Returns an explicit public backend origin only when NEXT_PUBLIC_BACKEND_URL or
 * NEXT_PUBLIC_API_URL is intentionally configured.
 */
export function getExplicitBackendUrl(): string | undefined {
  return (
    sanitizeBackendUrl(process.env.NEXT_PUBLIC_BACKEND_URL) ||
    sanitizeBackendUrl(process.env.NEXT_PUBLIC_API_URL)
  );
}

/**
 * Resolves a request URL for FastAPI routes:
 * 1. Explicit NEXT_PUBLIC_BACKEND_URL / NEXT_PUBLIC_API_URL when configured.
 * 2. Browser runtime without explicit URL -> same-origin `/api/v1/...` Next.js proxy
 *    (backed by runtime BACKEND_API_URL).
 * 3. Server/Node test runtime -> BACKEND_API_URL or `http://localhost:8000`.
 */
export function resolveBackendRequestUrl(apiPath: string): string {
  const cleanPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const normalizedApiPath = cleanPath.startsWith("/api/v1")
    ? cleanPath
    : `/api/v1${cleanPath}`;

  const explicit = getExplicitBackendUrl();
  if (explicit) {
    return `${explicit}${normalizedApiPath}`;
  }

  if (typeof window !== "undefined") {
    return normalizedApiPath;
  }

  const serverFallback =
    sanitizeBackendUrl(process.env.BACKEND_API_URL) || "http://localhost:8000";
  return `${serverFallback}${normalizedApiPath}`;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkBackendHealth(
  timeoutMs: number = 2500
): Promise<BackendHealthStatus | null> {
  const payload = await fetchJsonWithTimeout<BackendHealthStatus>(
    resolveBackendRequestUrl("/api/v1/health"),
    timeoutMs
  );
  if (!payload || payload.status !== "healthy") {
    return null;
  }
  return payload;
}

export async function fetchDatasetAvailability(
  datasetId: string = "geos-cf-v2-aqc",
  timeoutMs: number = 2500
): Promise<BackendDatasetAvailability | null> {
  const payload = await fetchJsonWithTimeout<BackendDatasetAvailability>(
    resolveBackendRequestUrl(`/api/v1/datasets/${encodeURIComponent(datasetId)}/availability`),
    timeoutMs
  );
  if (!payload || !Array.isArray(payload.availableTimes)) {
    return null;
  }
  return payload;
}

export async function fetchBackendLocations(
  timeoutMs: number = 2500
): Promise<BackendLocationItem[] | null> {
  const payload = await fetchJsonWithTimeout<BackendLocationItem[]>(
    resolveBackendRequestUrl("/api/v1/locations"),
    timeoutMs
  );
  return Array.isArray(payload) ? payload : null;
}

export interface TemporalSeriesParams {
  lat: number;
  lon: number;
  variable: string;
  start: string;
  end: string;
  datasetId?: string;
  interval?: string;
  normalizationMethod?: "fixed_reference_range" | "log_scale" | "quantile_linear" | "calibrated";
  offlineOnly?: boolean;
  timeoutMs?: number;
}

export async function fetchBackendTemporalSeries(
  params: TemporalSeriesParams
): Promise<BackendTemporalResponse | null> {
  const query = new URLSearchParams({
    dataset_id: params.datasetId ?? "geos-cf-v2-aqc",
    lat: String(params.lat),
    lon: String(params.lon),
    variable: params.variable,
    start: params.start,
    end: params.end,
    interval: params.interval ?? "3h",
    normalization_method: params.normalizationMethod ?? "log_scale",
    offline_only: String(params.offlineOnly ?? true),
  });
  const payload = await fetchJsonWithTimeout<BackendTemporalResponse>(
    resolveBackendRequestUrl(`/api/v1/jukebox/temporal?${query.toString()}`),
    params.timeoutMs ?? 3500
  );
  if (!payload || !Array.isArray(payload.points)) {
    return null;
  }
  return payload;
}
