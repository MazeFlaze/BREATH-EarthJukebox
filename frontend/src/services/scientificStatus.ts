export type ScientificStatusKind = 'unmounted' | 'empty' | 'error';

export interface ScientificStatusNotice {
  kind: ScientificStatusKind;
  title: string;
  detail: string;
  canRetry: boolean;
}

/**
 * Translate scientific session errors and catalog readiness into a single UI notice.
 * Returns null while loading without an error or when at least one verified snapshot is ready.
 */
export function describeScientificStatus(
  error: string,
  readyCount: number,
  hasCatalog: boolean
): ScientificStatusNotice | null {
  const trimmed = error.trim();
  if (trimmed) {
    if (/Scientific API 503\b/i.test(trimmed)) {
      const clean = trimmed.replace(/^Error:\s*/i, '');
      return {
        kind: 'unmounted',
        canRetry: true,
        title: 'Verified scientific catalog is unavailable (not yet mounted)',
        detail: `The backend verified NASA GEOS-CF catalog directory is not exported or mounted yet (${clean}). Mount or sync the verified catalog and retry; no synthetic fallback is substituted.`,
      };
    }
    return {
      kind: 'error',
      canRetry: false,
      title: 'Scientific session request failed',
      detail: trimmed,
    };
  }
  if (hasCatalog && readyCount <= 0) {
    return {
      kind: 'empty',
      canRetry: true,
      title: 'No verified NASA snapshots are indexed',
      detail:
        '0 verified NASA GEOS-CF snapshots are currently indexed in the catalog. Export or sync verified snapshots and retry, or return to the map workspace.',
    };
  }
  return null;
}
