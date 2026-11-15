export interface MapInteractionHandler {
  enable: () => unknown;
  disable: () => unknown;
}

export interface LockableMapViewport {
  dragPan?: MapInteractionHandler;
  scrollZoom?: MapInteractionHandler;
  boxZoom?: MapInteractionHandler;
  doubleClickZoom?: MapInteractionHandler;
  touchZoomRotate?: MapInteractionHandler;
  touchPitch?: MapInteractionHandler;
  dragRotate?: MapInteractionHandler;
  keyboard?: MapInteractionHandler;
  isMoving?: () => boolean;
  stop?: () => unknown;
  getPitch?: () => number;
  setPitch?: (pitch: number) => unknown;
  getBearing?: () => number;
  setBearing?: (bearing: number) => unknown;
}

export interface ViewportLockOptions {
  locked: boolean;
  allowDragPan: boolean;
}

const VIEWPORT_HANDLERS = [
  "scrollZoom",
  "boxZoom",
  "doubleClickZoom",
  "touchZoomRotate",
  "touchPitch",
  "keyboard",
] as const;

/**
 * Applies or releases a full 2D viewport interaction lock on a MapLibre map instance.
 * When locked, halts any in-flight camera transition, keeps pitch/bearing flat at 0,
 * and disables every pan, zoom, rotate, pitch, and keyboard navigation handler.
 */
export function syncMapViewportLock(
  map: LockableMapViewport | null | undefined,
  { locked, allowDragPan }: ViewportLockOptions
): void {
  if (!map) return;

  if (locked) {
    if (map.isMoving?.()) {
      map.stop?.();
    }
    if ((map.getPitch?.() ?? 0) !== 0) {
      map.setPitch?.(0);
    }
    if ((map.getBearing?.() ?? 0) !== 0) {
      map.setBearing?.(0);
    }
    map.dragPan?.disable();
    map.dragRotate?.disable();
    for (const key of VIEWPORT_HANDLERS) {
      map[key]?.disable();
    }
    return;
  }

  if (allowDragPan) {
    map.dragPan?.enable();
  } else {
    map.dragPan?.disable();
  }
  map.dragRotate?.disable();
  for (const key of VIEWPORT_HANDLERS) {
    map[key]?.enable();
  }
}
