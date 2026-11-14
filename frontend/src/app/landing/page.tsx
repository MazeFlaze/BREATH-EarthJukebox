"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wind,
  Droplets,
  Thermometer,
  AudioLines,
  Headphones,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Sparkles,
  BookOpen,
  ArrowRight,
  Twitter,
  Linkedin,
  Instagram,
  Menu,
  Minimize2,
  Maximize2,
  ExternalLink,
} from 'lucide-react';
import {
  BreatheModalKey,
  DEFAULT_DEMO_SIGNALS,
  EnvironmentalSignals,
  SoundPreset,
} from '@/types/landing/breathe';
import { sonificationEngine } from '@/services/landing/sonificationEngine';
import { AirflowLogo } from '@/components/landing/AirflowLogo';
import { MiniWaveform } from '@/components/landing/AmbientWaveform';
import { BreatheModal } from '@/components/landing/BreatheModal';

const HERO_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4';

const SOCIAL_LINKS: Array<{
  label: string;
  url: string;
  network: 'twitter' | 'linkedin' | 'instagram';
}> = [];

export default function LandingPage() {
  const [activeModal, setActiveModal] = useState<BreatheModalKey>(null);
  const [signals, setSignals] = useState<EnvironmentalSignals>(DEFAULT_DEMO_SIGNALS);
  const [activePresetId, setActivePresetId] = useState<SoundPreset['id'] | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLeftPanelMinimized, setIsLeftPanelMinimized] = useState(false);

  useEffect(() => {
    sonificationEngine.updateSignals(signals);
  }, [signals]);

  useEffect(() => {
    return () => {
      sonificationEngine.dispose();
    };
  }, []);

  const handleTogglePlay = async () => {
    if (isPlaying) {
      sonificationEngine.pause();
      setIsPlaying(false);
    } else {
      await sonificationEngine.start(signals);
      setIsPlaying(true);
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    sonificationEngine.setMuted(nextMuted);
  };

  const handleUpdateSignal = (key: keyof EnvironmentalSignals, value: number) => {
    setActivePresetId(null);
    setSignals((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSelectPreset = async (preset: SoundPreset) => {
    setActivePresetId(preset.id);
    setSignals(preset.signals);
    if (!isPlaying) {
      await sonificationEngine.start(preset.signals);
      setIsPlaying(true);
    }
  };

  return (
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-black text-white selection:bg-white/20">
      {/* Full-screen looping muted video background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        className="fixed inset-0 h-full w-full object-cover z-0 grayscale"
      >
        <source src={HERO_VIDEO_URL} type="video/mp4" />
      </video>

      {/* Subtle dark overlay for readability */}
      <div
        className="fixed inset-0 z-0 bg-black/40 pointer-events-none"
        aria-hidden="true"
      />

      {/* Two-panel split foreground */}
      <main className="relative z-10 flex min-h-[100svh] w-full flex-col lg:flex-row">
        {/* Left Panel (52% desktop, full width mobile; collapsible) */}
        <section
          className={`relative flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isLeftPanelMinimized
              ? 'w-full lg:w-auto lg:min-w-[360px] self-start justify-start p-7 sm:p-8 lg:p-10'
              : 'min-h-[100svh] w-full lg:w-[52%] justify-between p-8 sm:p-10 lg:p-14'
          }`}
        >
          {/* Liquid-glass-strong overlay */}
          <div
            className="liquid-glass-strong absolute inset-4 lg:inset-6 rounded-3xl pointer-events-none"
            aria-hidden="true"
          />

          {/* Navigation inside Left Panel */}
          <header className="relative z-10 flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex items-center gap-2.5 hover:scale-105 active:scale-95 transition-transform shrink-0"
            >
              <AirflowLogo size={32} />
              <span className="font-semibold text-2xl tracking-tighter text-white whitespace-nowrap">
                BREATHE
              </span>
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              {/* Link directly to full NASA Earth Jukebox app */}
              <Link
                href="/"
                className="liquid-glass rounded-full px-3.5 py-2 text-xs font-medium text-cyan-300 hover:text-white flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-transform whitespace-nowrap shrink-0 border border-cyan-500/30"
              >
                <span>Live Jukebox</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>

              {/* Mobile-accessible quick signal tuner button */}
              <button
                type="button"
                onClick={() => setActiveModal('signals')}
                aria-label="Shape atmospheric signals"
                className="lg:hidden liquid-glass w-9 h-9 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              >
                <Wind className="w-4 h-4 text-white" />
              </button>

              <button
                type="button"
                onClick={() => setActiveModal('menu')}
                className="liquid-glass rounded-full px-4 py-2 text-sm text-white flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform cursor-pointer whitespace-nowrap shrink-0"
              >
                <Menu className="w-4 h-4 text-white" />
                <span>Menu</span>
              </button>

              {isLeftPanelMinimized && (
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Pause listening' : 'Listen to the World'}
                  aria-pressed={isPlaying}
                  className="liquid-glass w-9 h-9 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 text-white" />
                  ) : (
                    <Play className="w-4 h-4 text-white ml-0.5" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsLeftPanelMinimized((prev) => !prev)}
                aria-label={isLeftPanelMinimized ? 'Expand panel' : 'Minimize panel'}
                aria-expanded={!isLeftPanelMinimized}
                className="liquid-glass w-9 h-9 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                {isLeftPanelMinimized ? (
                  <Maximize2 className="w-4 h-4 text-white" />
                ) : (
                  <Minimize2 className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </header>

          {!isLeftPanelMinimized && (
            <>
              {/* Centered Hero */}
              <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center py-6 px-2">
                <AirflowLogo size={80} animate className="mb-5" />

                <span className="text-[11px] tracking-[0.22em] uppercase text-white/50 mb-3">
                  A QUIETER WAY TO DISCOVER THE WORLD
                </span>

                <h1 className="text-5xl sm:text-6xl lg:text-7xl tracking-[-0.05em] text-white font-medium leading-[1.06] text-balance max-w-2xl font-sans">
                  The world breathes.
                  <br />
                  <em className="italic text-white/80 font-serif">Listen closely.</em>
                </h1>

                <p className="mt-5 text-sm sm:text-base text-white/60 leading-relaxed max-w-lg">
                  A passing breeze. The warmth of afternoon. Rain gathering in the air. BREATHE turns the invisible movements of our environment into sound — inviting you to hear the poetry of being here.
                </p>

                {/* Primary CTA & Mute Control */}
                <div className="mt-7 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    aria-pressed={isPlaying}
                    className="liquid-glass-strong rounded-full pl-5 pr-2.5 py-2.5 text-sm font-medium text-white flex items-center gap-3 hover:scale-105 active:scale-95 transition-transform cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span>{isPlaying ? 'Pause Listening' : 'Listen to the World'}</span>
                    <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
                      {isPlaying ? (
                        <Pause className="w-3.5 h-3.5 text-white" />
                      ) : (
                        <AudioLines className="w-3.5 h-3.5 text-white" />
                      )}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleMute}
                    aria-label={isMuted ? 'Unmute soundscape' : 'Mute soundscape'}
                    aria-pressed={isMuted}
                    className="liquid-glass w-11 h-11 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer shrink-0"
                  >
                    {isMuted ? (
                      <VolumeX className="w-4 h-4 text-white/60" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-white/50">
                  <Headphones className="w-3.5 h-3.5 shrink-0" />
                  <span>An unfolding experience, best heard with headphones.</span>
                </div>

                {/* Three liquid-glass pills */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveModal('experience')}
                    className="liquid-glass rounded-full px-4 py-1.5 text-xs text-white/80 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Atmospheric Soundscapes
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModal('visuals')}
                    className="liquid-glass rounded-full px-4 py-1.5 text-xs text-white/80 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Living Rhythms
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModal('world-is-sound')}
                    className="liquid-glass rounded-full px-4 py-1.5 text-xs text-white/80 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Sensory Exploration
                  </button>
                </div>
              </div>

              {/* Bottom Quote */}
              <footer className="relative z-10 flex flex-col items-center text-center pt-4">
                <span className="text-xs tracking-widest uppercase text-white/50">
                  EVERY PLACE, A COMPOSITION
                </span>
                <p className="mt-2 text-sm sm:text-base text-white/90 font-normal">
                  Some melodies are never written.{' '}
                  <span className="italic text-white/80 font-serif">
                    They move through the air.
                  </span>
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="h-px w-8 bg-white/25" aria-hidden="true" />
                  <span className="text-[11px] tracking-[0.2em] uppercase text-white/60">
                    BREATHE
                  </span>
                  <span className="h-px w-8 bg-white/25" aria-hidden="true" />
                </div>
              </footer>
            </>
          )}
        </section>

        {/* Right Panel (48% when expanded, expands when left panel is minimized, desktop only) */}
        <aside
          className={`hidden lg:flex min-h-[100svh] flex-col justify-between p-10 lg:p-12 transition-all duration-300 ${
            isLeftPanelMinimized ? 'lg:flex-1' : 'lg:w-[48%]'
          }`}
        >
          {/* Top Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="liquid-glass rounded-full px-4 py-2 flex items-center gap-3.5">
              {SOCIAL_LINKS.length > 0 ? (
                SOCIAL_LINKS.map((item) => (
                  <a
                    key={item.label}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={item.label}
                    className="text-white hover:text-white/80 hover:scale-105 active:scale-95 transition-[color,transform]"
                  >
                    {item.network === 'twitter' && <Twitter className="w-4 h-4" />}
                    {item.network === 'linkedin' && <Linkedin className="w-4 h-4" />}
                    {item.network === 'instagram' && <Instagram className="w-4 h-4" />}
                  </a>
                ))
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                    className="text-white hover:text-white/80 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  >
                    {isMuted ? (
                      <VolumeX className="w-4 h-4 text-white/60" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <span className="text-xs text-white/60 whitespace-nowrap">
                    {isPlaying ? 'Soundscape Unfolding' : 'Headphones Ready'}
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={() => setActiveModal('experience')}
                aria-label="Open atmospheric controls"
                className="text-white hover:text-white/80 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <Link
                href="/"
                className="liquid-glass rounded-full px-4 py-2.5 text-xs font-medium text-cyan-300 hover:text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer whitespace-nowrap shrink-0 border border-cyan-500/20"
              >
                Open Earth Jukebox ↗
              </Link>
              <button
                type="button"
                onClick={() => setActiveModal('about')}
                className="liquid-glass rounded-full px-5 py-2.5 text-xs font-medium text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer whitespace-nowrap shrink-0"
              >
                About BREATHE
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('world-is-sound')}
                aria-label="Discover how the world becomes sound"
                className="liquid-glass w-10 h-10 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Sparkles className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          {/* Middle Open Space: Introduction Card */}
          <div className="my-auto flex flex-col gap-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveModal('world-is-sound')}
                className="liquid-glass w-60 rounded-3xl p-5 text-left hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              >
                <h2 className="text-sm font-medium text-white">
                  An orchestra without a stage.
                </h2>
                <p className="mt-1.5 text-xs text-white/60 leading-relaxed">
                  The wind carries a rhythm. Heat holds a tone. The air is always composing.
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-white/80">
                  <span>Discover how to listen</span>
                  <span aria-hidden="true">↗</span>
                </div>
              </button>
            </div>
          </div>

          {/* Bottom Feature Section */}
          <div className="mt-auto">
            <div className="liquid-glass rounded-[2.5rem] p-4 flex flex-col gap-3">
              {/* Header + Demo Status */}
              <div className="flex items-center justify-between gap-2 px-2 pt-1">
                <span className="text-[11px] tracking-[0.18em] uppercase text-white/50">
                  LISTENING TO THE INVISIBLE
                </span>
                <span className="text-[11px] tracking-widest uppercase text-white/60">
                  AN IMAGINED ATMOSPHERE
                </span>
              </div>

              {/* Four compact adjustable demo readings */}
              <div className="grid grid-cols-4 gap-2 px-1">
                <div className="liquid-glass rounded-2xl p-2.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-white/50">
                    <span>Wind</span>
                    <Wind className="w-3 h-3 text-white/60" />
                  </div>
                  <div className="text-xs font-medium text-white tabular-nums">
                    {signals.wind} km/h
                  </div>
                  <input
                    type="range"
                    aria-label="Demo wind speed"
                    min={0}
                    max={60}
                    value={signals.wind}
                    onChange={(e) => handleUpdateSignal('wind', Number(e.target.value))}
                    className="w-full accent-white cursor-pointer h-1"
                  />
                </div>

                <div className="liquid-glass rounded-2xl p-2.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-white/50">
                    <span>Humidity</span>
                    <Droplets className="w-3 h-3 text-white/60" />
                  </div>
                  <div className="text-xs font-medium text-white tabular-nums">
                    {signals.humidity}%
                  </div>
                  <input
                    type="range"
                    aria-label="Demo humidity level"
                    min={15}
                    max={100}
                    value={signals.humidity}
                    onChange={(e) => handleUpdateSignal('humidity', Number(e.target.value))}
                    className="w-full accent-white cursor-pointer h-1"
                  />
                </div>

                <div className="liquid-glass rounded-2xl p-2.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-white/50">
                    <span>Temp</span>
                    <Thermometer className="w-3 h-3 text-white/60" />
                  </div>
                  <div className="text-xs font-medium text-white tabular-nums">
                    {signals.temperature}°C
                  </div>
                  <input
                    type="range"
                    aria-label="Demo temperature"
                    min={-5}
                    max={45}
                    value={signals.temperature}
                    onChange={(e) => handleUpdateSignal('temperature', Number(e.target.value))}
                    className="w-full accent-white cursor-pointer h-1"
                  />
                </div>

                <div className="liquid-glass rounded-2xl p-2.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-white/50">
                    <span>PM2.5</span>
                    <AudioLines className="w-3 h-3 text-white/60" />
                  </div>
                  <div className="text-xs font-medium text-white tabular-nums">
                    {signals.pm25} µg/m³
                  </div>
                  <input
                    type="range"
                    aria-label="Demo PM2.5 particulate density"
                    min={0}
                    max={100}
                    value={signals.pm25}
                    onChange={(e) => handleUpdateSignal('pm25', Number(e.target.value))}
                    className="w-full accent-white cursor-pointer h-1"
                  />
                </div>
              </div>

              {/* Two side-by-side cards */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal('world-is-sound')}
                  className="liquid-glass rounded-3xl p-4 text-left hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mb-2.5">
                    <Wind className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-sm font-medium text-white">
                    When the air becomes music
                  </h3>
                  <p className="mt-1 text-xs text-white/60 leading-relaxed">
                    Wind, warmth, moisture, and dust find a voice in an ever-changing composition.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModal('collected-atmospheres')}
                  className="liquid-glass rounded-3xl p-4 text-left hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mb-2.5">
                    <BookOpen className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-sm font-medium text-white">
                    Echoes of a place
                  </h3>
                  <p className="mt-1 text-xs text-white/60 leading-relaxed">
                    Gather fleeting atmospheres. Return to the feeling of a moment.
                  </p>
                </button>
              </div>

              {/* Bottom full-width card */}
              <div className="liquid-glass rounded-3xl p-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <MiniWaveform signals={signals} isPlaying={isPlaying} />
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-white truncate">
                      Somewhere, the world is singing.
                    </h3>
                    <p className="mt-0.5 text-xs text-white/60 leading-relaxed line-clamp-2">
                      Pause for a moment. Let the atmosphere unfold.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Pause composition' : 'Play composition'}
                  aria-pressed={isPlaying}
                  className="liquid-glass w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 text-white" />
                  ) : (
                    <Play className="w-4 h-4 text-white ml-0.5" />
                  )}
                </button>
              </div>

              <div className="px-2 pb-0.5 text-[11px] text-white/50 text-right">
                Illustrative demo data · Adjust signals or explore collected atmospheres
              </div>
            </div>
          </div>
        </aside>
      </main>

      <BreatheModal
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        onSelectModal={(modal) => setActiveModal(modal)}
        signals={signals}
        onUpdateSignal={handleUpdateSignal}
        activePresetId={activePresetId}
        onSelectPreset={handleSelectPreset}
        isPlaying={isPlaying}
        isMuted={isMuted}
        onTogglePlay={handleTogglePlay}
        onToggleMute={handleToggleMute}
      />
    </div>
  );
}
