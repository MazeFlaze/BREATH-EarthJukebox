"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AudioLines,
  Headphones,
  Pause,
  Volume2,
  VolumeX,
  Menu,
} from 'lucide-react';
import {
  BreatheModalKey,
  DEFAULT_DEMO_SIGNALS,
  EnvironmentalSignals,
  SoundPreset,
} from '@/types/landing/breathe';
import { sonificationEngine } from '@/services/landing/sonificationEngine';
import { AirflowLogo } from '@/components/landing/AirflowLogo';
import { BreatheModal } from '@/components/landing/BreatheModal';

const HERO_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4';

export default function LandingPage() {
  const [activeModal, setActiveModal] = useState<BreatheModalKey>(null);
  const [signals, setSignals] = useState<EnvironmentalSignals>(DEFAULT_DEMO_SIGNALS);
  const [activePresetId, setActivePresetId] = useState<SoundPreset['id'] | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

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
        {/* Main Content Panel */}
        <section className="relative flex flex-col min-h-[100svh] w-full lg:w-[52%] justify-between pt-5 px-6 pb-8 sm:pt-6 sm:px-8 sm:pb-10 lg:pt-8 lg:px-10 lg:pb-14">
          {/* Liquid-glass-strong overlay */}
          <div
            className="liquid-glass-strong absolute inset-3 sm:inset-4 lg:inset-5 rounded-3xl pointer-events-none"
            aria-hidden="true"
          />

          {/* Navigation inside Left Panel */}
          <header className="relative z-10 flex items-center justify-between gap-4 -mt-1 sm:-mt-2 -mr-3 sm:-mr-4 lg:-mr-5">
            <Link
              href="/"
              className="flex items-center gap-3 hover:scale-105 active:scale-95 transition-transform shrink-0"
            >
              <AirflowLogo size={46} />
              <span className="font-semibold text-2xl sm:text-3xl tracking-tighter text-white whitespace-nowrap">
                BREATHE
              </span>
            </Link>

            {/* Top Bar - Extended horizontal width */}
            <nav
              aria-label="Quick Navigation"
              className="liquid-glass rounded-xl sm:rounded-2xl px-6 sm:px-10 py-2 sm:py-2.5 flex items-center justify-between gap-6 sm:gap-10 min-w-[280px] sm:min-w-[360px] border border-white/15 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_6px_25px_rgba(0,0,0,0.5)] backdrop-blur-2xl bg-white/[0.06] shrink-0"
            >
              {/* Experience Button */}
              <button
                type="button"
                onClick={() => setActiveModal('experience')}
                className="px-5 py-1.5 rounded-lg text-sm sm:text-base font-medium text-white/90 hover:text-white hover:bg-white/15 transition-all cursor-pointer whitespace-nowrap text-center"
              >
                Experience
              </button>

              {/* About Button */}
              <button
                type="button"
                onClick={() => setActiveModal('about')}
                className="px-5 py-1.5 rounded-lg text-sm sm:text-base font-medium text-white/90 hover:text-white hover:bg-white/15 transition-all cursor-pointer whitespace-nowrap text-center"
              >
                About
              </button>

              {/* Menu Hamburger Button */}
              <button
                type="button"
                onClick={() => setActiveModal('menu')}
                aria-label="Open navigation menu"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition-all cursor-pointer shrink-0"
              >
                <Menu className="w-5 h-5 text-white" />
              </button>
            </nav>
          </header>

          {/* Centered Hero */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center py-6 px-2">
            <AirflowLogo size={105} animate className="mb-5" />

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
        </section>

        {/* Right Panel */}
        <aside className="hidden lg:flex min-h-[100svh] flex-col justify-start p-10 lg:p-12 w-[48%]">
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
