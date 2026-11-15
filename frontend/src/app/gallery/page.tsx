"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Clock,
  Globe,
  MapPin,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { MapArtworkThumbnail } from "@/components/breathe/MapArtworkThumbnail";
import { DataBadge, SiteFooter } from "@/components/breathe/SharedUI";
import { AudioTransport } from "@/components/breathe/SoundVisuals";
import { useBreathe } from "@/context/BreatheContext";
import { useSonification } from "@/hooks/useSonification";
import { galleryWorks, getLayerDefinition, layers } from "@/lib/breatheData";
import type { AudioCompositionSpec, GalleryWork, LayerKey } from "@/types/breathe";

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
  const [, startTransition] = useTransition();

  const [tab, setTab] = useState<"curated" | "trending" | "recent" | "mine">("curated");
  const [query, setQuery] = useState("");
  const [variableFilter, setVariableFilter] = useState<LayerKey | "ALL">("ALL");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  const allWorks = useMemo(() => {
    const map = new Map<string, GalleryWork>();
    for (const w of savedWorks) map.set(w.id, w);
    for (const w of galleryWorks) map.set(w.id, w);
    return Array.from(map.values());
  }, [savedWorks]);

  const [selectedId, setSelectedId] = useState<string>(galleryWorks[0].id);

  const tabWorks = useMemo(() => {
    if (tab === "mine") {
      return allWorks.filter((w) => w.isUserSaved || bookmarkedIds.includes(w.id));
    }
    if (tab === "trending") {
      return [...allWorks].sort((a, b) => b.mappings.density - a.mappings.density);
    }
    if (tab === "recent") {
      return [...allWorks].reverse();
    }
    return galleryWorks;
  }, [tab, allWorks, bookmarkedIds]);

  const variableOptions = useMemo(() => layers.filter((layer) => layer.available), []);

  const variableCounts = useMemo(() => {
    const counts: Partial<Record<LayerKey, number>> = {};
    for (const work of tabWorks) {
      counts[work.variable] = (counts[work.variable] ?? 0) + 1;
    }
    return counts;
  }, [tabWorks]);

  const activeFilterDef = useMemo(
    () => (variableFilter === "ALL" ? null : getLayerDefinition(variableFilter)),
    [variableFilter]
  );

  const hasActiveFilters = variableFilter !== "ALL" || query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabWorks.filter((w) => {
      if (variableFilter !== "ALL" && w.variable !== variableFilter) return false;
      if (!q) return true;
      const layerDef = getLayerDefinition(w.variable);
      return (
        w.title.toLowerCase().includes(q) ||
        w.region.toLowerCase().includes(q) ||
        w.creator.toLowerCase().includes(q) ||
        w.variable.toLowerCase().includes(q) ||
        layerDef.short.toLowerCase().includes(q) ||
        layerDef.label.toLowerCase().includes(q)
      );
    });
  }, [tabWorks, query, variableFilter]);

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
                  onClick={() => startTransition(() => setTab(item.key as typeof tab))}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="b-gallery-controls">
              <div className="b-gallery-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search works or regions..."
                  aria-label="Search gallery works or geographic regions"
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    className="b-gallery-search-clear"
                    onClick={() => setQuery("")}
                    aria-label="Clear search query"
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="b-gallery-filter-wrap" ref={filterMenuRef}>
                <button
                  type="button"
                  className={`b-gallery-filter-btn ${variableFilter !== "ALL" ? "is-active" : ""}`}
                  onClick={() => setFilterOpen((open) => !open)}
                  aria-expanded={filterOpen}
                  aria-haspopup="listbox"
                  aria-label="Filter gallery works by atmospheric variable"
                >
                  <SlidersHorizontal size={13} aria-hidden="true" />
                  <span>
                    Filter: <strong>{activeFilterDef ? activeFilterDef.short : "All"}</strong>
                  </span>
                  <ChevronDown
                    size={13}
                    className={filterOpen ? "is-open" : undefined}
                    aria-hidden="true"
                  />
                </button>

                {filterOpen && (
                  <div
                    className="b-gallery-filter-menu"
                    role="listbox"
                    aria-label="Atmospheric variable filter"
                  >
                    <div className="b-gallery-filter-heading">Atmospheric variable</div>
                    <button
                      type="button"
                      role="option"
                      aria-selected={variableFilter === "ALL"}
                      className={`b-gallery-filter-option ${variableFilter === "ALL" ? "is-selected" : ""}`}
                      onClick={() => {
                        setVariableFilter("ALL");
                        setFilterOpen(false);
                      }}
                    >
                      <span className="b-gallery-filter-option-main">
                        <strong>All variables</strong>
                        <small>Every available dataset</small>
                      </span>
                      <span className="b-gallery-filter-count">{tabWorks.length}</span>
                      {variableFilter === "ALL" && <Check size={13} aria-hidden="true" />}
                    </button>

                    {variableOptions.map((layer) => {
                      const count = variableCounts[layer.key] ?? 0;
                      const isSelected = variableFilter === layer.key;
                      return (
                        <button
                          key={layer.key}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`b-gallery-filter-option ${isSelected ? "is-selected" : ""}`}
                          onClick={() => {
                            setVariableFilter(layer.key);
                            setFilterOpen(false);
                          }}
                        >
                          <span className="b-gallery-filter-option-main">
                            <strong>{layer.short}</strong>
                            <small>{layer.label}</small>
                          </span>
                          <span className="b-gallery-filter-count">{count}</span>
                          {isSelected && <Check size={13} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="b-gallery-active-bar" role="status" aria-live="polite">
              <span className="b-gallery-active-summary">
                Showing {filtered.length} of {tabWorks.length} works
              </span>
              {activeFilterDef && (
                <button
                  type="button"
                  className="b-gallery-filter-chip"
                  onClick={() => setVariableFilter("ALL")}
                  aria-label={`Remove ${activeFilterDef.short} variable filter`}
                >
                  <span>
                    Variable: <strong>{activeFilterDef.short}</strong>
                  </span>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
              {query.trim().length > 0 && (
                <button
                  type="button"
                  className="b-gallery-filter-chip"
                  onClick={() => setQuery("")}
                  aria-label="Clear search term filter"
                >
                  <span>Search: “{query.trim()}”</span>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="b-gallery-clear-all"
                onClick={() => {
                  setVariableFilter("ALL");
                  setQuery("");
                }}
              >
                Clear all
              </button>
            </div>
          )}

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
              <p>
                {hasActiveFilters
                  ? `No works matched${activeFilterDef ? ` variable ${activeFilterDef.short}` : ""}${query.trim() ? ` for “${query.trim()}”` : ""}.`
                  : tab === "mine"
                    ? "Bookmark any concept work or click Save inside Studio to populate My Works."
                    : "No atmospheric works matched that filter."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="b-button b-button-secondary"
                  onClick={() => {
                    setVariableFilter("ALL");
                    setQuery("");
                  }}
                >
                  Reset filters
                </button>
              )}
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
