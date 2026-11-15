"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bookmark,
  Clock,
  Globe,
  MapPin,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { MapArtworkThumbnail } from "@/components/breathe/MapArtworkThumbnail";
import { DataBadge, SiteFooter } from "@/components/breathe/SharedUI";
import { AudioTransport } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { useSonification } from "@/hooks/useSonification";
import { galleryWorks, getLayerDefinition } from "@/lib/breatheData";
import type { AudioCompositionSpec, GalleryWork } from "@/types/breathe";

function workToSpec(work: GalleryWork): AudioCompositionSpec {
  const layer = getLayerDefinition(work.variable);
  return {
    id: `gallery-${work.id}`,
    title: work.title,
    regionName: work.region,
    variable: work.variable,
    series: work.seriesPreview,
    min: layer.vmin,
    max: layer.vmax,
    mapping: {
      density: work.mappings.density,
      brightness: work.mappings.brightness,
      pitchSensitivity: work.mappings.pitchSensitivity,
      spatialSpread: work.mappings.spatialSpread,
      tempo: work.tempo,
      musicalKey: work.musicalKey,
      waveform: "sine",
      volume: 0.72,
    },
    durationSec: 30,
  };
}

export default function GalleryPage() {
  const router = useRouter();
  const { savedWorks, bookmarkedIds, toggleBookmark, loadWorkContext } = useBreathe();
  const { playbackState, clock, playComposition, pause } = useSonification();

  const [tab, setTab] = useState<"curated" | "trending" | "recent" | "mine">("curated");
  const [query, setQuery] = useState("");
  const [pm25Only, setPm25Only] = useState(false);

  const allWorks = useMemo(() => {
    const map = new Map<string, GalleryWork>();
    for (const w of savedWorks) map.set(w.id, w);
    for (const w of galleryWorks) map.set(w.id, w);
    return Array.from(map.values());
  }, [savedWorks]);

  const [selectedId, setSelectedId] = useState<string>(galleryWorks[0].id);

  const filtered = useMemo(() => {
    let base: GalleryWork[];
    if (tab === "mine") {
      base = allWorks.filter((w) => w.isUserSaved || bookmarkedIds.includes(w.id));
    } else if (tab === "trending") {
      base = [...allWorks].sort((a, b) => b.mappings.density - a.mappings.density);
    } else if (tab === "recent") {
      base = [...allWorks].reverse();
    } else {
      base = galleryWorks;
    }

    const q = query.trim().toLowerCase();
    return base.filter((w) => {
      if (pm25Only && w.variable !== "PM25_RH35") return false;
      if (!q) return true;
      return (
        w.title.toLowerCase().includes(q) ||
        w.region.toLowerCase().includes(q) ||
        w.creator.toLowerCase().includes(q) ||
        w.variable.toLowerCase().includes(q)
      );
    });
  }, [tab, allWorks, bookmarkedIds, query, pm25Only]);

  const featured =
    allWorks.find((w) => w.id === selectedId) ?? filtered[0] ?? galleryWorks[0];
  const featuredSpec = useMemo(() => workToSpec(featured), [featured]);

  const togglePlayWork = (work: GalleryWork, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(work.id);
    const spec = workToSpec(work);
    const isPlayingThis =
      playbackState === "playing" && clock.activeCompositionId === spec.id;
    if (isPlayingThis) {
      pause();
    } else {
      playComposition(spec);
    }
  };

  const handleOpenInStudio = (work: GalleryWork) => {
    loadWorkContext(work, "flat");
    router.push("/studio");
  };

  const handleViewOnMap = (work: GalleryWork) => {
    loadWorkContext(work, "globe");
    router.push("/explore");
  };

  return (
    <div className="b-page">
      <div className="b-container b-gallery-intro b-workspace-intro">
        <div>
          <h1>Atmospheric Gallery</h1>
          <p>
            Concept works and field recordings translating territory-level air quality curves into sound.
          </p>
        </div>
        <DataBadge
          tone={featured.isIllustrative ? "illustrative" : "nasa"}
          label={featured.isIllustrative ? "Illustrative example" : featured.dataSource}
        />
      </div>

      <div className="b-gallery-layout b-container">
        <div className="b-gallery-main">
          <div className="b-gallery-filters">
            <div className="b-filter-tabs" role="tablist" aria-label="Gallery views">
              {[
                { key: "curated", label: "Curated" },
                { key: "trending", label: "Trending" },
                { key: "recent", label: "Recent" },
                { key: "mine", label: `My Works (${savedWorks.length + bookmarkedIds.length})` },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={tab === item.key ? "is-active" : undefined}
                  onClick={() => setTab(item.key as typeof tab)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="b-gallery-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search works or regions..."
                aria-label="Search gallery works or geographic regions"
              />
              <button
                type="button"
                className={`b-icon-button ${pm25Only ? "is-active" : ""}`}
                onClick={() => setPm25Only((v) => !v)}
                aria-pressed={pm25Only}
                aria-label="Filter PM2.5 works only"
                title={pm25Only ? "Showing PM2.5 works (click for all)" : "Filter PM2.5 only"}
              >
                <SlidersHorizontal size={14} />
              </button>
            </div>
          </div>

          <div className="b-gallery-grid">
            {filtered.map((work) => {
              const layer = getLayerDefinition(work.variable);
              const isPlayingCard =
                playbackState === "playing" &&
                clock.activeCompositionId === `gallery-${work.id}`;
              const isBookmarked = bookmarkedIds.includes(work.id);

              return (
                <article
                  key={work.id}
                  className={`b-work-card ${featured.id === work.id ? "is-selected" : ""}`}
                >
                  <div className="b-work-select" onClick={() => setSelectedId(work.id)}>
                    <MapArtworkThumbnail
                      center={work.center}
                      zoom={work.zoom}
                      polygon={work.polygon}
                      boundaryGeometry={work.boundaryGeometry}
                      territoryCode={work.territoryCode}
                      variable={work.variable}
                      timeIndex={work.timeIndex}
                      seriesPreview={work.seriesPreview}
                      title={work.title}
                      regionLabel={work.region}
                    />
                    <button
                      type="button"
                      className="b-work-play"
                      onClick={(e) => togglePlayWork(work, e)}
                      aria-label={isPlayingCard ? `Pause ${work.title}` : `Play ${work.title}`}
                    >
                      {isPlayingCard ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <span className="b-work-duration">{work.duration}</span>
                  </div>

                  <div className="b-work-body">
                    <div className="b-work-title">
                      <button type="button" onClick={() => setSelectedId(work.id)}>
                        {work.title}
                      </button>
                      <button
                        type="button"
                        className={isBookmarked ? "is-bookmarked" : undefined}
                        onClick={() => toggleBookmark(work.id)}
                        aria-label={isBookmarked ? `Remove ${work.title} bookmark` : `Bookmark ${work.title}`}
                        aria-pressed={isBookmarked}
                      >
                        <Bookmark size={14} fill={isBookmarked ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <span className="b-work-creator">{work.creator}</span>
                    <div className="b-work-meta-inline">
                      <MapPin size={11} /> {work.region} · {layer.short}
                    </div>
                    <p>{work.description}</p>
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="b-gallery-empty">
              {tab === "mine"
                ? "Bookmark any concept work or click Save inside Studio to populate My Works."
                : "No atmospheric works matched that filter."}
            </div>
          )}

          <p className="b-gallery-disclaimer">
            Every work preserves its exact geographic boundary, atmospheric variable, timestamp, and
            data-to-sound parameters so it can be reopened in Studio or Explore.
          </p>
        </div>

        <aside className="b-featured-panel">
          <span className="b-featured-kicker">
            {featured.isUserSaved
              ? "SAVED IN STUDIO"
              : featured.isIllustrative
              ? "FEATURED CONCEPT"
              : "NASA GEOS-CF WORK"}
          </span>

          <MapArtworkThumbnail
            className="b-featured-art"
            center={featured.center}
            zoom={featured.zoom}
            polygon={featured.polygon}
            boundaryGeometry={featured.boundaryGeometry}
            territoryCode={featured.territoryCode}
            variable={featured.variable}
            timeIndex={featured.timeIndex}
            seriesPreview={featured.seriesPreview}
            title={featured.title}
            regionLabel={featured.region}
          />

          <div className="b-featured-title">
            <div>
              <h2>{featured.title}</h2>
              <span>by {featured.creator}</span>
            </div>
            <button
              type="button"
              className={bookmarkedIds.includes(featured.id) ? "is-bookmarked" : undefined}
              onClick={() => toggleBookmark(featured.id)}
              aria-label="Bookmark featured work"
            >
              <Bookmark
                size={16}
                fill={bookmarkedIds.includes(featured.id) ? "currentColor" : "none"}
              />
            </button>
          </div>

          <AudioTransport compact title="Synthesized tone preview" spec={featuredSpec} />

          <p>{featured.description}</p>

          <div className="b-preview-divider" />

          <span className="b-card-kicker">DATA &amp; MAPPING</span>
          <div className="b-featured-spec-list b-tabular">
            <div>
              <span>Primary variable</span>
              <strong>{getLayerDefinition(featured.variable).short} → Rhythm ({Math.round(featured.mappings.density * 100)}%)</strong>
            </div>
            <div>
              <span>Diurnal slope</span>
              <strong>Δ Rate → Pitch ({Math.round(featured.mappings.pitchSensitivity * 100)}%)</strong>
            </div>
            <div>
              <span>Scale &amp; Tempo</span>
              <strong>{featured.musicalKey} · {featured.tempo} BPM</strong>
            </div>
          </div>

          <div className="b-featured-meta">
            <div>
              <MapPin size={13} />
              <span>Region</span>
              <strong>{featured.region}</strong>
            </div>
            <div>
              <Globe size={13} />
              <span>Source</span>
              <strong>{featured.dataSource}</strong>
            </div>
            <div>
              <Clock size={13} />
              <span>Window</span>
              <strong className="b-tabular">{featured.timeRangeLabel}</strong>
            </div>
          </div>

          <div className="b-featured-actions">
            <button
              type="button"
              className="b-button b-button-primary"
              onClick={() => handleOpenInStudio(featured)}
            >
              <span>Open in Studio</span>
              <ArrowRight size={13} />
            </button>

            <button
              type="button"
              className="b-button b-button-secondary"
              onClick={() => handleViewOnMap(featured)}
            >
              <Globe size={13} />
              <span>View on Map</span>
            </button>
          </div>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}
