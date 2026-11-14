import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Wind,
  Droplets,
  Thermometer,
  AudioLines,
  BookOpen,
  Sparkles,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ArrowRight,
  Headphones,
} from 'lucide-react';
import {
  BreatheModalKey,
  EnvironmentalSignals,
  SOUND_PRESETS,
  SoundPreset,
} from '@/types/landing/breathe';
import { AirflowLogo } from './AirflowLogo';
import { AmbientWaveformField } from './AmbientWaveform';

interface BreatheModalProps {
  activeModal: BreatheModalKey;
  onClose: () => void;
  onSelectModal: (modal: BreatheModalKey) => void;
  signals: EnvironmentalSignals;
  onUpdateSignal: (key: keyof EnvironmentalSignals, value: number) => void;
  activePresetId: SoundPreset['id'] | null;
  onSelectPreset: (preset: SoundPreset) => void;
  isPlaying: boolean;
  isMuted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
}

export const BreatheModal: React.FC<BreatheModalProps> = ({
  activeModal,
  onClose,
  onSelectModal,
  signals,
  onUpdateSignal,
  activePresetId,
  onSelectPreset,
  isPlaying,
  isMuted,
  onTogglePlay,
  onToggleMute,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (activeModal) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, onClose]);

  return (
    <AnimatePresence>
      {activeModal && (
        <motion.div
          key="breathe-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 sm:p-6 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="BREATHE Exhibition Panel"
        >
          <motion.div
            key={activeModal}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="liquid-glass-strong w-full max-w-xl rounded-3xl p-6 sm:p-8 text-white bg-black/55 my-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <AirflowLogo size={32} />
                <span className="text-xs tracking-widest uppercase text-white/50">
                  BREATHE · An Imagined Atmosphere
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="liquid-glass w-9 h-9 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* MENU */}
            {activeModal === 'menu' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl tracking-tight text-white">
                    Enter the <em className="font-serif italic text-white/80">Atmosphere</em>
                  </h2>
                  <p className="text-sm text-white/60 mt-1">
                    Encounter the quiet music moving through wind, warmth, moisture, and air.
                  </p>
                </div>

                <div className="space-y-2.5">
                  {[
                    {
                      key: 'world-is-sound' as BreatheModalKey,
                      title: 'The World Is Sound',
                      desc: 'Discover how passing breezes, heat, and dust compose a living voice.',
                      icon: Sparkles,
                    },
                    {
                      key: 'experience' as BreatheModalKey,
                      title: 'The Experience',
                      desc: 'Shape an imagined atmosphere and hear the air unfold in real time.',
                      icon: AudioLines,
                    },
                    {
                      key: 'collected-atmospheres' as BreatheModalKey,
                      title: 'Collected Atmospheres',
                      desc: 'Return to fleeting moments: Before the City Wakes, Where the Wind Wanders, and The Weight of Summer Air.',
                      icon: BookOpen,
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => onSelectModal(item.key)}
                        className="liquid-glass w-full rounded-2xl p-4 text-left flex items-center justify-between gap-4 hover:scale-[1.02] active:scale-[0.99] transition-transform cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">
                              {item.title}
                            </div>
                            <div className="text-xs text-white/60 mt-0.5 leading-relaxed">
                              {item.desc}
                            </div>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-white/60 shrink-0" />
                      </button>
                    );
                  })}
                </div>

                {/* Audio Controls for mobile & quick access */}
                <div className="liquid-glass rounded-2xl p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs text-white/80">
                    <Headphones className="w-4 h-4 text-white/60" />
                    <span>{isPlaying ? 'Soundscape Unfolding' : 'Best heard with headphones'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onToggleMute}
                      aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                      className="liquid-glass w-9 h-9 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                    >
                      {isMuted ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onTogglePlay}
                      aria-label={isPlaying ? 'Pause listening' : 'Listen to the World'}
                      className="liquid-glass-strong rounded-full px-4 py-2 text-xs font-medium text-white flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Listen</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* THE EXPERIENCE / SIGNALS / GENERATIVE VISUALS */}
            {(activeModal === 'experience' ||
              activeModal === 'signals' ||
              activeModal === 'visuals') && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl tracking-tight text-white">
                      {activeModal === 'visuals' ? (
                        <>
                          A Portrait of the <em className="font-serif italic text-white/80">Air</em>
                        </>
                      ) : (
                        <>
                          The <em className="font-serif italic text-white/80">Experience</em>
                        </>
                      )}
                    </h2>
                    <p className="text-xs text-white/50 mt-1 uppercase tracking-widest">
                      An Imagined Atmosphere · Illustrative Demo Data
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onToggleMute}
                      aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                      className="liquid-glass w-9 h-9 rounded-full flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                    >
                      {isMuted ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onTogglePlay}
                      className="liquid-glass-strong rounded-full px-4 py-2 text-xs font-medium text-white flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Listen</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="liquid-glass rounded-2xl px-4 py-2">
                  <AmbientWaveformField signals={signals} isPlaying={isPlaying} />
                  <div className="text-center pb-2 text-[11px] text-white/50 italic font-serif">
                    A portrait of the air, in sound.
                  </div>
                </div>

                {/* Four adjustable demo signal sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="liquid-glass rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="modal-wind" className="flex items-center gap-2 text-white/80">
                        <Wind className="w-3.5 h-3.5 text-white/60" />
                        <span>Wind · Rhythm</span>
                      </label>
                      <span className="text-white tabular-nums">{signals.wind} km/h</span>
                    </div>
                    <input
                      id="modal-wind"
                      type="range"
                      min={0}
                      max={60}
                      value={signals.wind}
                      onChange={(e) => onUpdateSignal('wind', Number(e.target.value))}
                      className="w-full accent-white cursor-pointer"
                    />
                  </div>

                  <div className="liquid-glass rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="modal-humidity" className="flex items-center gap-2 text-white/80">
                        <Droplets className="w-3.5 h-3.5 text-white/60" />
                        <span>Moisture · Texture</span>
                      </label>
                      <span className="text-white tabular-nums">{signals.humidity}%</span>
                    </div>
                    <input
                      id="modal-humidity"
                      type="range"
                      min={15}
                      max={100}
                      value={signals.humidity}
                      onChange={(e) => onUpdateSignal('humidity', Number(e.target.value))}
                      className="w-full accent-white cursor-pointer"
                    />
                  </div>

                  <div className="liquid-glass rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="modal-temp" className="flex items-center gap-2 text-white/80">
                        <Thermometer className="w-3.5 h-3.5 text-white/60" />
                        <span>Warmth · Tone</span>
                      </label>
                      <span className="text-white tabular-nums">{signals.temperature}°C</span>
                    </div>
                    <input
                      id="modal-temp"
                      type="range"
                      min={-5}
                      max={45}
                      value={signals.temperature}
                      onChange={(e) => onUpdateSignal('temperature', Number(e.target.value))}
                      className="w-full accent-white cursor-pointer"
                    />
                  </div>

                  <div className="liquid-glass rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="modal-pm25" className="flex items-center gap-2 text-white/80">
                        <AudioLines className="w-3.5 h-3.5 text-white/60" />
                        <span>Dust · Air Texture</span>
                      </label>
                      <span className="text-white tabular-nums">{signals.pm25} µg/m³</span>
                    </div>
                    <input
                      id="modal-pm25"
                      type="range"
                      min={0}
                      max={100}
                      value={signals.pm25}
                      onChange={(e) => onUpdateSignal('pm25', Number(e.target.value))}
                      className="w-full accent-white cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onSelectModal('collected-atmospheres')}
                    className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 hover:text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  >
                    Collected Atmospheres
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectModal('world-is-sound')}
                    className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 hover:text-white flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  >
                    <span>The World Is Sound</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* THE WORLD IS SOUND */}
            {activeModal === 'world-is-sound' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl tracking-tight text-white">
                    The World <em className="font-serif italic text-white/80">Is Sound</em>
                  </h2>
                  <p className="text-sm text-white/60 mt-1">
                    An orchestra without a stage. Four quiet forces in the air become a continuous composition.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      icon: Wind,
                      title: 'Wind carries rhythm',
                      desc: 'A breeze crossing a room sets the breathing cadence and swells of the composition.',
                    },
                    {
                      icon: Droplets,
                      title: 'Moisture holds texture',
                      desc: 'Humidity gathering before rain softens the air into shimmering harmonic layers.',
                    },
                    {
                      icon: Thermometer,
                      title: 'Heat holds a tone',
                      desc: 'Warmth lingering on a street gently lifts the pitch and resonance of the drone.',
                    },
                    {
                      icon: AudioLines,
                      title: 'Dust becomes breath',
                      desc: 'Airborne particles shape a delicate whisper of atmospheric texture.',
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="liquid-glass rounded-2xl p-4 space-y-2">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Icon className="w-4 h-4 text-white" />
                        </div>
                        <h3 className="text-sm font-medium text-white">{item.title}</h3>
                        <p className="text-xs text-white/60 leading-relaxed">{item.desc}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onSelectModal('experience')}
                    className="liquid-glass-strong rounded-full px-5 py-2.5 text-xs font-medium text-white flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  >
                    <span>Shape an Atmosphere</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* COLLECTED ATMOSPHERES */}
            {activeModal === 'collected-atmospheres' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl tracking-tight text-white">
                    Collected <em className="font-serif italic text-white/80">Atmospheres</em>
                  </h2>
                  <p className="text-sm text-white/60 mt-1">
                    Echoes of a place. Select an imagined atmosphere to listen to its composition.
                  </p>
                </div>

                <div className="space-y-3">
                  {SOUND_PRESETS.map((preset) => {
                    const isSelected = activePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onSelectPreset(preset)}
                        className={`liquid-glass w-full rounded-2xl p-4 text-left transition-transform hover:scale-[1.02] active:scale-[0.99] cursor-pointer ${
                          isSelected ? 'bg-white/15' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">{preset.name}</div>
                            <div className="text-[11px] text-white/50 mt-0.5">
                              {preset.location}
                            </div>
                          </div>
                          <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/80 shrink-0">
                            {isSelected ? 'Unfolding Now' : 'Listen'}
                          </span>
                        </div>
                        <p className="text-xs text-white/60 mt-2 leading-relaxed">
                          {preset.description}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/50 tabular-nums">
                          <span>Wind: {preset.signals.wind} km/h</span>
                          <span>Humidity: {preset.signals.humidity}%</span>
                          <span>Temp: {preset.signals.temperature}°C</span>
                          <span>PM2.5: {preset.signals.pm25} µg/m³</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ABOUT BREATHE */}
            {activeModal === 'about' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl tracking-tight text-white">
                    About <em className="font-serif italic text-white/80">BREATHE</em>
                  </h2>
                  <p className="text-sm text-white/60 mt-1 leading-relaxed">
                    An invitation to slow down and encounter the beauty moving quietly around us.
                  </p>
                </div>

                <div className="liquid-glass rounded-2xl p-4 space-y-2.5 text-xs text-white/70 leading-relaxed">
                  <p>
                    Every place carries an unscripted score — in the breeze crossing a room, warmth lingering on pavement, and moisture gathering before rain. BREATHE transforms these invisible movements into gentle, living soundscapes.
                  </p>
                  <p className="text-white/50">
                    All environmental readings shown on this page are illustrative demo data representing an imagined atmosphere.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectModal('collected-atmospheres')}
                    className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 hover:text-white hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  >
                    Collected Atmospheres
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPlaying) onTogglePlay();
                      onClose();
                    }}
                    className="liquid-glass-strong rounded-full px-5 py-2.5 text-xs font-medium text-white flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span>{isPlaying ? 'Return to Listening' : 'Listen to the World'}</span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
