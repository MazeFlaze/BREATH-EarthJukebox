// Shared worker/test implementation. Every valid native sample is considered; no interpolation.
export const DETAIL_MAPPING = 'detail-continuous-log99-v1';
export const lens = value => Math.log1p(99 * Math.max(0, Math.min(1, value))) / Math.log(100);

function bins(start, end, stride, latitude, geometry) {
  const result = [];
  for (let i = start; i < end; i++) {
    const key = stride === 1 ? i : latitude ? Math.max(0, Math.ceil(i / stride) - 1) : Math.floor(i / stride);
    if (!result.length || result[result.length - 1].key !== key) result.push({ key, start: i, end: i + 1 });
    else result[result.length - 1].end = i + 1;
  }
  for (const b of result) {
    if (latitude) {
      b.high = Math.min(90, geometry.lat_first + b.start * geometry.lat_step + Math.abs(geometry.lat_step) / 2);
      b.low = Math.max(-90, geometry.lat_first + (b.end - 1) * geometry.lat_step - Math.abs(geometry.lat_step) / 2);
    } else {
      b.low = Math.max(-180, geometry.lon_first + b.start * geometry.lon_step - geometry.lon_step / 2);
      b.high = Math.min(180, geometry.lon_first + (b.end - 1) * geometry.lon_step + geometry.lon_step / 2);
    }
  }
  return result;
}

function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[Math.ceil(pos)] * frac;
}

export function prepareDetail(values, geometry, options) {
  const { rows: sourceRows, cols: sourceCols } = geometry;
  if (!(values instanceof Float32Array) || values.length !== sourceRows * sourceCols) throw Error('Native shape mismatch');
  const crop = options.crop ?? [0, sourceRows, 0, sourceCols];
  const [r0, r1, c0, c1] = crop;
  if (!crop.every(Number.isInteger) || r0 < 0 || r1 > sourceRows || c0 < 0 || c1 > sourceCols || r0 >= r1 || c0 >= c1) throw Error('Invalid native crop');
  if (!['horizontal', 'vertical'].includes(options.axis) || !['focus', 'spectral'].includes(options.profile)) throw Error('Unknown detail mode');
  if (![45, 22.5, 11.25, 5, 1, 'native'].includes(options.resolution)) throw Error('Unknown grid resolution');
  if (![8, 16].includes(options.bands) || !(options.audioMax > 0)) throw Error('Invalid feature mapping');
  const stride = options.resolution === 'native' ? 1 : Math.round(options.resolution / geometry.lon_step);
  const rowBins = bins(r0, r1, stride, true, geometry), colBins = bins(c0, c1, stride, false, geometry);
  const rows = rowBins.length, cols = colBins.length;
  const grid = new Float32Array(rows * cols), validCounts = new Uint32Array(grid.length), totals = new Uint32Array(grid.length);
  const weights = Float64Array.from({ length: sourceRows }, (_, r) => Math.max(0, Math.cos((geometry.lat_first + r * geometry.lat_step) * Math.PI / 180)));
  let included = 0, validTotal = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let numerator = 0, denominator = 0, count = 0;
    const rb = rowBins[r], cb = colBins[c], index = r * cols + c;
    for (let rr = rb.start; rr < rb.end; rr++) for (let cc = cb.start; cc < cb.end; cc++) {
      const v = values[rr * sourceCols + cc];
      if (Number.isFinite(v) && v >= 0) { numerator += v * weights[rr]; denominator += weights[rr]; count++; }
    }
    grid[index] = denominator > 0 ? numerator / denominator : NaN;
    totals[index] = (rb.end - rb.start) * (cb.end - cb.start); validCounts[index] = count;
    included += totals[index]; validTotal += count;
  }
  const horizontal = options.axis === 'horizontal', steps = horizontal ? cols : rows;
  const perpendicular = horizontal ? rows : cols;
  const lanes = options.profile === 'spectral' ? perpendicular : Math.min(options.bands, perpendicular);
  const mean = new Float32Array(steps * lanes), p90 = new Float32Array(mean.length), spread = new Float32Array(mean.length);
  const coverage = new Float32Array(mean.length), contrast = new Float32Array(mean.length);
  const laneBins = Array.from({ length: lanes }, (_, lane) => ({ start: Math.floor(lane * perpendicular / lanes), end: Math.floor((lane + 1) * perpendicular / lanes) }));
  for (let step = 0; step < steps; step++) for (let lane = 0; lane < lanes; lane++) {
    const index = step * lanes + lane, group = laneBins[lane];
    if (options.profile === 'spectral') {
      const cell = horizontal ? lane * cols + step : step * cols + lane;
      mean[index] = grid[cell]; coverage[index] = validCounts[cell] / totals[cell]; p90[index] = NaN;
      continue;
    }
    const rb = horizontal ? { start: rowBins[group.start].start, end: rowBins[group.end - 1].end } : rowBins[step];
    const cb = horizontal ? colBins[step] : { start: colBins[group.start].start, end: colBins[group.end - 1].end };
    const distribution = [];
    let numerator = 0, denominator = 0;
    for (let rr = rb.start; rr < rb.end; rr++) for (let cc = cb.start; cc < cb.end; cc++) {
      const v = values[rr * sourceCols + cc];
      if (Number.isFinite(v) && v >= 0) { distribution.push(v); numerator += weights[rr] * v; denominator += weights[rr]; }
    }
    distribution.sort((a, b) => a - b);
    mean[index] = denominator > 0 ? numerator / denominator : NaN;
    p90[index] = quantile(distribution, .9);
    spread[index] = distribution.length ? (quantile(distribution, .75) - quantile(distribution, .25)) / options.audioMax : 0;
    coverage[index] = distribution.length / ((rb.end - rb.start) * (cb.end - cb.start));
  }
  // Intrinsic spatial contrast against adjacent slices. Reverse never recalculates it.
  for (let step = 0; step < steps; step++) for (let lane = 0; lane < lanes; lane++) {
    const i = step * lanes + lane, v = mean[i]; let total = 0, count = 0;
    for (const other of [step - 1, step + 1]) if (other >= 0 && other < steps && Number.isFinite(mean[other * lanes + lane])) { total += mean[other * lanes + lane]; count++; }
    contrast[i] = count && Number.isFinite(v) ? Math.min(1, Math.abs(v - total / count) / options.audioMax) : 0;
  }
  const positions = Float32Array.from(laneBins, group => {
    const bins = horizontal ? rowBins : colBins;
    const center = (bins[group.start].low + bins[group.end - 1].high) / 2;
    // Latitude bins run north-south; use their outer north/south bounds.
    const latitude = (bins[group.start].high + bins[group.end - 1].low) / 2;
    return horizontal ? (latitude + 90) / 180 : (center + 180) / 360;
  });
  const stepPositions = Float32Array.from(horizontal ? colBins : rowBins, bin => horizontal ? ((bin.low + bin.high) / 2 + 180) / 360 : ((bin.low + bin.high) / 2 + 90) / 180);
  return { mappingVersion: DETAIL_MAPPING, rows, cols, rowBins, colBins, grid, validCounts, totals, included, validTotal,
    frames: { steps, lanes, mean, p90, spread, coverage, contrast, laneBins, positions, stepPositions, profile: options.profile, axis: options.axis, audioMax: options.audioMax } };
}
