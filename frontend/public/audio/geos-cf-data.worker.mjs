import { prepareDetail } from './geos-cf-data.mjs';
self.onmessage = event => {
  const { id, values, geometry, options } = event.data;
  try {
    const view = prepareDetail(values, geometry, options);
    const arrays = [view.grid, view.validCounts, view.totals, view.frames.mean, view.frames.p90, view.frames.spread, view.frames.coverage, view.frames.contrast, view.frames.positions, view.frames.stepPositions];
    self.postMessage({ id, view }, arrays.map(array => array.buffer));
  } catch (cause) { self.postMessage({ id, error: String(cause) }); }
};
