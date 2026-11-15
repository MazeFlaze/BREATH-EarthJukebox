"use client";

import React, { useEffect, useRef } from "react";
import { renderMapSnapshotToCanvas } from "@/lib/geosCfRaster";
import type { GeoPoint, LayerKey } from "@/types/breathe";

interface MapArtworkThumbnailProps {
  center: GeoPoint;
  zoom: number;
  polygon: GeoPoint[];
  boundaryGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  territoryCode?: string;
  variable: LayerKey;
  timeIndex: number;
  seriesPreview?: number[];
  title: string;
  regionLabel?: string;
  height?: number;
  className?: string;
}

export function MapArtworkThumbnail({
  center,
  zoom,
  polygon,
  boundaryGeometry,
  territoryCode,
  variable,
  timeIndex,
  seriesPreview,
  title,
  regionLabel,
  height,
  className = "",
}: MapArtworkThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    void renderMapSnapshotToCanvas(canvas, {
      center,
      zoom,
      polygon,
      boundaryGeometry,
      territoryCode,
      variable,
      timeIndex,
      seriesPreview,
    }).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [center, zoom, polygon, boundaryGeometry, territoryCode, variable, timeIndex, seriesPreview]);

  return (
    <div
      className={`b-artwork-visual b-map-art ${className}`.trim()}
      style={height ? { height } : undefined}
    >
      <canvas
        ref={canvasRef}
        width={420}
        height={240}
        className="b-map-art-canvas"
        aria-label={`Satellite air-quality map snapshot for ${title}`}
      />
      {regionLabel && (
        <span className="b-map-art-place">{regionLabel}</span>
      )}
    </div>
  );
}
