import type { FrozenEvent } from "@/types/notebookDemo";

export type ScanPattern = "horizontal" | "vertical" | "rings";
export interface TraversalOptions { pattern: ScanPattern; clockwise: boolean; inward: boolean }

/** Reorder references only: never re-freeze moods or assign a cell a different identity. */
export function traverse(events: readonly FrozenEvent[], options: TraversalOptions): FrozenEvent[] {
  const cells = new Map<string, FrozenEvent>();
  for (const event of events) {
    const { lat, lon } = event.scientific.bounds;
    const row = Math.round((90 - lat[1]) / 45), col = Math.round((lon[0] + 180) / 45);
    const key = `${row}:${col}`;
    if (cells.has(key) || row < 0 || row > 3 || col < 0 || col > 7) throw new Error("Expected 32 unique global cells");
    cells.set(key, event);
  }
  if (cells.size !== 32) throw new Error("Expected complete 4 × 8 global coverage");
  const positions: [number, number][] = [];
  if (options.pattern === "horizontal") {
    for (let row = 0; row < 4; row++) for (let j = 0; j < 8; j++) positions.push([row, row % 2 ? 7 - j : j]);
  } else if (options.pattern === "vertical") {
    for (let col = 0; col < 8; col++) for (let j = 0; j < 4; j++) positions.push([col % 2 ? 3 - j : j, col]);
  } else {
    const rings: [number, number][][] = [];
    for (let layer = 0; layer < 2; layer++) {
      const top = layer, bottom = 3 - layer, left = layer, right = 7 - layer;
      let ring: [number, number][] = [];
      for (let col = left; col <= right; col++) ring.push([top, col]);
      for (let row = top + 1; row <= bottom; row++) ring.push([row, right]);
      for (let col = right - 1; col >= left; col--) ring.push([bottom, col]);
      for (let row = bottom - 1; row > top; row--) ring.push([row, left]);
      if (!options.clockwise) ring = [ring[0], ...ring.slice(1).reverse()];
      rings.push(ring);
    }
    if (!options.inward) rings.reverse();
    for (let ring of rings) {
      if (positions.length) {
        const previous = positions[positions.length - 1];
        let nearest = 0, best = Infinity;
        ring.forEach(([row, col], i) => {
          const distance = Math.abs(row - previous[0]) + Math.abs(col - previous[1]);
          if (distance < best) { best = distance; nearest = i; }
        });
        ring = [...ring.slice(nearest), ...ring.slice(0, nearest)];
      }
      positions.push(...ring);
    }
  }
  return positions.map(([row, col]) => cells.get(`${row}:${col}`)!);
}
