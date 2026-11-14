import type { CatalogEntry } from './geosCfCatalog';
import type { Pollutant } from '@/types/notebookDemo';
import type { DetailManifest, DetailOptions, DetailView } from '@/types/geosCfDetail';

export async function loadDetail(entry: CatalogEntry, pollutant: Pollutant, signal: AbortSignal) {
  if (entry.status !== 'ready' || !entry.detail_url?.startsWith('/data/')) throw Error('Snapshot chưa có native cache. Export lại catalog local rồi tải lại trang.');
  const response = await fetch(entry.detail_url, { signal });
  if (!response.ok) throw Error(`Không đọc được detail manifest: HTTP ${response.status}`);
  const manifest = await response.json() as DetailManifest;
  const field = manifest.fields?.[pollutant];
  if (manifest.schema_version !== 'geos-cf-detail-v1' || manifest.isMock !== false || manifest.source.sha256 !== entry.sha256
    || manifest.source.timestamp_utc !== entry.timestamp_utc || manifest.rows !== 721 || manifest.cols !== 1440
    || manifest.lat_first !== 90 || manifest.lat_step !== -.25 || manifest.lon_first !== -180 || manifest.lon_step !== .25
    || manifest.order !== 'north-to-south,west-to-east' || manifest.missing !== 'NaN'
    || !field?.url.startsWith('/data/') || field.dtype !== 'float32-le' || !(field.audio_max > 0)) throw Error('Native cache và catalog không khớp');
  const rawResponse = await fetch(field.url, { signal });
  if (!rawResponse.ok) throw Error(`Không đọc được native cache: HTTP ${rawResponse.status}`);
  const buffer = await rawResponse.arrayBuffer();
  if (buffer.byteLength !== manifest.rows * manifest.cols * 4) throw Error('Native cache thiếu mẫu');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const checksum = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (checksum !== field.sha256) throw Error('Native cache sai checksum');
  const view = new DataView(buffer), values = new Float32Array(manifest.rows * manifest.cols);
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isNaN(value) && (!Number.isFinite(value) || value < 0)) throw Error('Giá trị native không hợp lệ');
    values[i] = value; if (Number.isFinite(value)) count++;
  }
  if (count !== field.valid_count) throw Error('Coverage không khớp manifest');
  return { manifest, values };
}

export function prepareDetailView(values: Float32Array, manifest: DetailManifest, options: DetailOptions, signal: AbortSignal): Promise<DetailView> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/audio/geos-cf-data.worker.mjs', { type: 'module' });
    const cleanup = () => { signal.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => { cleanup(); reject(Error(event.message || 'Worker tính dữ liệu gặp lỗi')); };
    worker.onmessage = ({ data }) => { cleanup(); if (data.error) reject(Error(data.error)); else resolve(data.view as DetailView); };
    worker.postMessage({ id: 1, values, geometry: manifest, options });
  });
}
