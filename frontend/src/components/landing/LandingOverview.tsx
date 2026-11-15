"use client";

import { useEffect, useState } from "react";
import { AirflowLogo } from "@/components/landing/AirflowLogo";

const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4";
const QUOTES = [
  "Some melodies are never written. They move through the air.",
  "Every breath leaves a rhythm.",
  "The quietest things can still be heard.",
  "Where the wind wanders, a story begins.",
  "Listen closely; the air is always changing.",
  "Every place holds its own melody.",
];
const QUOTE_ROTATION_INTERVAL_MS = 8000;

export default function LandingOverview() {
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setQuoteIndex((currentIndex) => {
        const offset = Math.floor(Math.random() * (QUOTES.length - 1)) + 1;
        return (currentIndex + offset) % QUOTES.length;
      });
    }, QUOTE_ROTATION_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="landing-overview relative min-h-[calc(100svh_-_78px)] w-full overflow-x-hidden bg-black text-white selection:bg-white/20">
      <video
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        className="fixed inset-0 z-0 h-full w-full object-cover grayscale"
      >
        <source src={HERO_VIDEO_URL} type="video/mp4" />
      </video>

      <div
        className="fixed inset-0 z-0 bg-black/40 pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-[calc(100svh_-_78px)] w-full">
        <section className="relative flex min-h-[calc(100svh_-_78px)] w-full items-center justify-center px-6 py-12 sm:px-8 lg:w-[52%] lg:px-10">
          <div
            className="liquid-glass-strong absolute inset-3 rounded-3xl sm:inset-4 lg:inset-5"
            aria-hidden="true"
          />

          <div className="relative z-10 flex max-w-xl flex-col items-center text-center">
            {/* Organic Feathered Dark Cushion tightly hugging the text (Cocoon style) */}
            <div
              className="pointer-events-none absolute -inset-x-6 top-16 bottom-8 -z-10 rounded-full bg-black/75 blur-2xl"
              aria-hidden="true"
            />

            <AirflowLogo size={72} className="mb-7" />

            <span className="mb-3 text-[11px] uppercase tracking-[0.22em] text-white/55">
              A quieter way to discover the world
            </span>

            <h1 className="text-balance text-5xl font-medium leading-[1.06] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
              The world breathes.
              <br />
              <em className="font-serif text-white/80">Listen closely.</em>
            </h1>

            <blockquote
              key={quoteIndex}
              className="animate-quote-swap mt-7 max-w-md text-sm italic leading-relaxed text-white/75 sm:text-base"
            >
              “{QUOTES[quoteIndex]}”
            </blockquote>

            <span className="mt-8 text-[10px] uppercase tracking-[0.2em] text-white/45">
              Every place, a composition
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
