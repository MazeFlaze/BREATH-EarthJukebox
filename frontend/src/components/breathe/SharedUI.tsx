"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Menu,
  Pause,
  Play,
  Volume2,
  X,
} from "lucide-react";
import { dataSourceUrl, formatUtc, getLayerDefinition, layers, presetSelections, timeSlots } from "@/lib/breatheData";
import type { BasemapMode, GeographicSelection, LayerKey } from "@/types/breathe";
import { AirflowLogo } from "@/components/landing/AirflowLogo";

const BASEMAP_OPTIONS: Array<{ value: BasemapMode; label: string }> = [
  { value: "territories", label: "Territories" },
  { value: "choropleth", label: "AQ Focus" },
  { value: "atlas", label: "Atlas" },
  { value: "satellite", label: "Satellite" },
];

export function BasemapSwitcher({
  value,
  onChange,
  compact = false,
}: {
  value: BasemapMode;
  onChange: (mode: BasemapMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`b-basemap-switch ${compact ? "is-compact" : ""}`.trim()}
      role="group"
      aria-label="Map viewing mode"
    >
      {BASEMAP_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? "is-active" : undefined}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/explore", label: "Explore" },
  { href: "/studio", label: "Sonification" },
  { href: "/learn", label: "Learning Lab" },
  { href: "/gallery", label: "Gallery" },
];

export function SiteHeader() {
  const path = usePathname() || "/";
  const [mobileOpen, setMobileOpen] = useState(false);

  const isRouteActive = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

  return (
    <header className="b-header">
      <Link href="/" className="b-brand" aria-label="BREATHE Home">
        <AirflowLogo size={37} />
        <span className="b-brand-name">BREATHE</span>
        <span className="b-brand-meta">Earth Air Quality Sonification</span>
      </Link>

      <nav className={mobileOpen ? "b-nav is-open" : "b-nav"} aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const active = isRouteActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "is-active" : undefined}
              onClick={() => setMobileOpen(false)}
            >
              <span>{item.label}</span>
              {active && (
                <motion.span
                  layoutId="breathe-nav-underline"
                  className="b-nav-indicator"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="b-header-actions">
        <a
          href={dataSourceUrl}
          target="_blank"
          rel="noreferrer"
          className="b-nasa-badge"
        >
          <span className="b-nasa-disc" aria-hidden="true">
            NASA
          </span>
          <span>
            Powered by
            <br />
            <strong>NASA Earth Data</strong>
          </span>
          <ArrowRight size={14} aria-hidden="true" />
        </a>

        <button
          type="button"
          className="b-menu-button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </header>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="b-eyebrow">{children}</div>;
}

export function ButtonLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link href={href} className={primary ? "b-button b-button-primary" : "b-button b-button-secondary"}>
      <span>{children}</span>
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

export function LayerList({
  value,
  onChange,
  compact = false,
  layerVisible = true,
  onToggleVisible,
  layerOpacity = 0.76,
  onOpacityChange,
}: {
  value: LayerKey;
  onChange: (key: LayerKey) => void;
  compact?: boolean;
  layerVisible?: boolean;
  onToggleVisible?: () => void;
  layerOpacity?: number;
  onOpacityChange?: (opacity: number) => void;
}) {
  const activeDef = getLayerDefinition(value);

  return (
    <>
      <div
        className={compact ? "b-layer-list is-compact" : "b-layer-list"}
        role="radiogroup"
        aria-label="Atmospheric data layers"
      >
        {layers.map((layer) => {
          const active = layer.key === value;
          return (
            <button
              key={layer.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? "is-active" : undefined}
              onClick={() => {
                if (layer.available) onChange(layer.key);
              }}
              disabled={!layer.available}
              title={!layer.available ? layer.methodologyNote : layer.description}
            >
              <span className="b-layer-radio" aria-hidden="true" />
              <span className="b-layer-name">{layer.short}</span>
              {!compact && (
                <span className="b-layer-detail">
                  {layer.available ? layer.label : "Awaiting data"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {onToggleVisible && onOpacityChange && activeDef.available && (
        <div className={compact ? "b-layer-opacity-row is-compact" : "b-layer-opacity-row"}>
          <button
            type="button"
            className="b-eye-btn"
            onClick={onToggleVisible}
            aria-label={layerVisible ? `Hide ${activeDef.short} overlay` : `Show ${activeDef.short} overlay`}
            title={layerVisible ? "Hide overlay" : "Show overlay"}
          >
            {layerVisible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <input
            type="range"
            min={0.15}
            max={0.95}
            step={0.05}
            value={layerOpacity}
            disabled={!layerVisible}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            aria-label={`${activeDef.short} overlay opacity`}
          />
          <span className="b-tabular">{layerVisible ? `${Math.round(layerOpacity * 100)}%` : "Off"}</span>
        </div>
      )}
    </>
  );
}

export function Legend({ layerKey }: { layerKey: LayerKey }) {
  const layer = getLayerDefinition(layerKey);
  const mid = Number(((layer.vmin + layer.vmax) / 2).toFixed(layer.vmax <= 5 ? 1 : 0));

  return (
    <div className="b-legend" aria-label={`${layer.short} concentration scale`}>
      <div className="b-legend-heading">
        <strong>{layer.short}</strong>
        <span className="b-tabular">{layer.unit}</span>
      </div>
      <div className="b-legend-bar b-legend-bar-editorial" />
      <div className="b-legend-scale b-tabular">
        <span>Low ({layer.vmin})</span>
        <span>Moderate ({mid})</span>
        <span>High ({layer.vmax})</span>
      </div>
    </div>
  );
}

export function DataBadge({
  tone = "nasa",
  label,
}: {
  tone?: "nasa" | "illustrative";
  label?: string;
}) {
  return (
    <span className={tone === "illustrative" ? "b-data-badge is-demo" : "b-data-badge"}>
      <span aria-hidden="true" />
      {label ??
        (tone === "nasa" ? "NASA GEOS-CF v2 · 12 Nov 2026" : "Illustrative example")}
    </span>
  );
}

export function Timeline({
  timeIndex,
  onChange,
  playing = false,
  onTogglePlay,
}: {
  timeIndex: number;
  onChange: (index: number) => void;
  playing?: boolean;
  onTogglePlay?: () => void;
}) {
  const safeIndex = Math.max(0, Math.min(timeSlots.length - 1, timeIndex));
  const currentTs = timeSlots[safeIndex] ?? timeSlots[0];
  const formatted = formatUtc(currentTs);

  const stepBy = (delta: number) => {
    onChange((safeIndex + delta + timeSlots.length) % timeSlots.length);
  };

  return (
    <div className="b-timeline">
      {onTogglePlay && (
        <button
          type="button"
          className="b-timeline-play"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause diurnal timeline" : "Play diurnal timeline"}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
      )}

      <div className="b-timeline-current">
        <strong>UTC Snapshot</strong>
        <span className="b-tabular">{formatted}</span>
      </div>

      <button
        type="button"
        className="b-icon-button b-timeline-step"
        onClick={() => stepBy(-1)}
        aria-label="Previous UTC timestamp"
      >
        <ChevronLeft size={14} />
      </button>

      <div className="b-timeline-track" role="radiogroup" aria-label="Select UTC observation slot">
        <div className="b-timeline-rule" aria-hidden="true" />
        {timeSlots.map((ts, idx) => (
          <button
            key={ts}
            type="button"
            role="radio"
            aria-checked={idx === safeIndex}
            className={idx === safeIndex ? "is-active" : undefined}
            onClick={() => onChange(idx)}
            title={formatUtc(ts)}
          >
            <span className="b-timeline-dot" aria-hidden="true" />
            <small className="b-tabular">{ts.slice(11, 16)}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="b-icon-button b-timeline-step"
        onClick={() => stepBy(1)}
        aria-label="Next UTC timestamp"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export function SectionCaption({ children }: { children: React.ReactNode }) {
  return <div className="b-section-caption">{children}</div>;
}

export function TerritorySelect({
  selection,
  territories,
  onSelectValue,
  className = "b-text-input",
  ariaLabel = "Active geographic territory",
  disabled = false,
  title,
}: {
  selection: GeographicSelection;
  territories: Array<{ id: string; isoNumeric: string; name: string }>;
  onSelectValue: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  const curatedCodes = new Set(
    presetSelections.map((p) => p.territoryCode).filter((c): c is string => Boolean(c))
  );
  const additionalTerritories = territories.filter((t) => !curatedCodes.has(t.isoNumeric));

  const matchedPreset = presetSelections.find(
    (p) =>
      p.id === selection.id ||
      (selection.boundaryKind !== "drawn" &&
        selection.territoryCode &&
        p.territoryCode === selection.territoryCode)
  );
  const matchedOther =
    !matchedPreset && selection.boundaryKind !== "drawn"
      ? additionalTerritories.find(
          (t) =>
            t.id === selection.id ||
            (selection.territoryCode && t.isoNumeric === selection.territoryCode)
        )
      : undefined;

  const value = matchedPreset?.id ?? matchedOther?.id ?? "custom";

  return (
    <select
      className={className}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        if (!disabled && e.target.value !== "custom") onSelectValue(e.target.value);
      }}
    >
      <optgroup label="Curated territories">
        {presetSelections.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </optgroup>
      {additionalTerritories.length > 0 && (
        <optgroup label="All countries & territories">
          {additionalTerritories.map((territory) => (
            <option key={territory.id} value={territory.id}>
              {territory.name}
            </option>
          ))}
        </optgroup>
      )}
      {value === "custom" && <option value="custom">{selection.name}</option>}
    </select>
  );
}

export function SiteFooter() {
  return (
    <footer className="b-footer">
      <div>
        <div className="b-footer-mark">
          <span>BREATHE</span>
        </div>
        <p>NASA Space Apps Challenge · Earth Air Quality Data Sonification</p>
        <p>Earth imagery: NASA Blue Marble &amp; SVS · Atmospheric data: NASA GMAO GEOS-CF v2</p>
      </div>
      <div>
        <a href={dataSourceUrl} target="_blank" rel="noreferrer">
          NASA GEOS-CF v2 Data Catalog
        </a>
        <span className="b-footer-sound">
          <Volume2 size={13} aria-hidden="true" />
          Real-time Web Audio synthesis from observed atmospheric fields
        </span>
      </div>
    </footer>
  );
}
