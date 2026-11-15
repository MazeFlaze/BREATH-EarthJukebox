"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sonificationService } from "@/services/sonificationService";
import type {
  AudioClockState,
  AudioTelemetry,
  OscillatorWaveform,
  PlaybackState,
  SonificationConfig,
  SonificationInput,
} from "@/types/audio";
import type { AudioCompositionSpec } from "@/types/breathe";

export interface UseSonificationReturn {
  playbackState: PlaybackState;
  telemetry: AudioTelemetry | null;
  clock: AudioClockState;
  config: SonificationConfig;
  play: (input: SonificationInput) => void;
  playComposition: (spec: AudioCompositionSpec) => void;
  syncPreviewSpec: (spec: AudioCompositionSpec) => void;
  seekStep: (step: number) => void;
  pause: () => void;
  resume: (input?: SonificationInput) => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  setWaveform: (waveform: OscillatorWaveform) => void;
  updateConfig: (partial: Partial<SonificationConfig>) => void;
}

export function useAudioClock(): AudioClockState {
  const [clock, setClock] = useState<AudioClockState>(() => sonificationService.getClockState());

  useEffect(() => {
    return sonificationService.onClockTick(setClock);
  }, []);

  return clock;
}

/**
 * Subscribes only to structural audio metadata (playback state, track id, step schedule),
 * preventing high-frequency visualizers from re-rendering React on elapsed-time or step ticks.
 */
export function useAudioClockMeta(): {
  playbackState: PlaybackState;
  activeCompositionId: string | null;
  scheduleMatrix: number[][];
} {
  const [meta, setMeta] = useState(() => {
    const c = sonificationService.getClockState();
    return {
      playbackState: c.playbackState,
      activeCompositionId: c.activeCompositionId,
      scheduleMatrix: c.scheduleMatrix,
    };
  });

  useEffect(() => {
    return sonificationService.onClockTick((c) => {
      setMeta((prev) =>
        prev.playbackState === c.playbackState &&
        prev.activeCompositionId === c.activeCompositionId &&
        prev.scheduleMatrix === c.scheduleMatrix
          ? prev
          : {
              playbackState: c.playbackState,
              activeCompositionId: c.activeCompositionId,
              scheduleMatrix: c.scheduleMatrix,
            }
      );
    });
  }, []);

  return meta;
}

export function useSonification(): UseSonificationReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>(() =>
    sonificationService.getState()
  );
  const [telemetry, setTelemetry] = useState<AudioTelemetry | null>(null);
  const [clock, setClock] = useState<AudioClockState>(() => sonificationService.getClockState());
  const [config, setConfig] = useState<SonificationConfig>(() => sonificationService.getConfig());

  const activeInputRef = useRef<SonificationInput | null>(null);

  useEffect(() => {
    const unsubState = sonificationService.onStateChange(setPlaybackState);
    const unsubTelemetry = sonificationService.onTelemetry(setTelemetry);
    const unsubClock = sonificationService.onClockTick(setClock);
    return () => {
      unsubState();
      unsubTelemetry();
      unsubClock();
    };
  }, []);

  const play = useCallback((input: SonificationInput) => {
    activeInputRef.current = input;
    sonificationService.play(input);
  }, []);

  const playComposition = useCallback((spec: AudioCompositionSpec) => {
    sonificationService.playComposition(spec);
  }, []);

  const syncPreviewSpec = useCallback((spec: AudioCompositionSpec) => {
    sonificationService.syncPreviewSpec(spec);
  }, []);

  const seekStep = useCallback((step: number) => {
    sonificationService.seekStep(step);
  }, []);

  const pause = useCallback(() => {
    sonificationService.pause();
  }, []);

  const resume = useCallback((input?: SonificationInput) => {
    const targetInput = input ?? activeInputRef.current ?? undefined;
    sonificationService.resume(targetInput);
  }, []);

  const stop = useCallback(() => {
    sonificationService.stop();
  }, []);

  const setVolume = useCallback((volume: number) => {
    sonificationService.setVolume(volume);
    setConfig(sonificationService.getConfig());
  }, []);

  const setWaveform = useCallback((waveform: OscillatorWaveform) => {
    sonificationService.setWaveform(waveform);
    setConfig(sonificationService.getConfig());
  }, []);

  const updateConfig = useCallback((partial: Partial<SonificationConfig>) => {
    sonificationService.updateConfig(partial);
    setConfig(sonificationService.getConfig());
  }, []);

  return {
    playbackState,
    telemetry,
    clock,
    config,
    play,
    playComposition,
    syncPreviewSpec,
    seekStep,
    pause,
    resume,
    stop,
    setVolume,
    setWaveform,
    updateConfig,
  };
}
