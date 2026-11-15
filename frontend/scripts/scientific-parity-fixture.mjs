// Explicit synthetic fixture shared with Python regression tests. Never a NASA API fallback.
import { prepareDetail } from '../public/audio/geos-cf-data.mjs';
import { createContextPlan } from '../public/audio/geos-cf-orchestration.mjs';
const fixture = JSON.parse(process.argv[2]);
if (fixture.isMock !== true) throw Error('Parity input must identify its synthetic origin');
const values = Float32Array.from({ length: 721 * 1440 }, (_, i) => i % 31 === 0 ? NaN : (i % 17) / 4);
const view = prepareDetail(values, { rows: 721, cols: 1440, lat_first: 90, lat_step: -.25, lon_first: -180, lon_step: .25 }, fixture.options);
const context = createContextPlan(view.frames, 300);
const array = value => Array.from(value, x => Number.isFinite(x) ? x : null);
console.log(JSON.stringify({ grid: array(view.grid), mean: array(view.frames.mean), p90: array(view.frames.p90), spread: array(view.frames.spread),
  coverage: array(view.frames.coverage), contrast: array(view.frames.contrast), positions: array(view.frames.positions), stepPositions: array(view.frames.stepPositions),
  rowBins: view.rowBins, colBins: view.colBins, laneBins: view.frames.laneBins,
  gradient: array(context.gradient), curvature: array(context.curvature), windows: context.windows }));
