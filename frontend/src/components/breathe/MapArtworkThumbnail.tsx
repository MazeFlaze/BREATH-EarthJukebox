"use client";

import React, { useEffect, useRef, useState } from "react";
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

export const MapArtworkThumbnail = React.memo(function MapArtworkThumbnail({
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shouldRender, setShouldRender] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    if (shouldRender) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    void renderMapSnapshotToCanvas(canvas, {
      center,
      zoom,
      polygon,
      boundaryGeometry,
      territoryCode,
      variable,
      timeIndex,
      seriesPreview,
      signal: controller.signal,
    });
    return () => {
      controller.abort();
    };
  }, [shouldRender, center, zoom, polygon, boundaryGeometry, territoryCode, variable, timeIndex, seriesPreview]);

  return (
    <div
      ref={containerRef}
      className={`b-artwork-visual b-map-art ${className}`.trim()}
      style={height ? { height } : { aspectRatio: "420 / 240" }}
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
});
