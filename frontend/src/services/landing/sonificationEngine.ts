import { EnvironmentalSignals } from '@/types/landing/breathe';

class SonificationEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muteGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private textureGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private noiseSource: AudioBufferSourceNode | null = null;

  private isPlaying = false;
  private isMuted = false;
  private currentSignals: EnvironmentalSignals = {
    wind: 12,
    humidity: 68,
    temperature: 24,
    pm25: 18,
  };

  private initContext() {
    if (this.ctx) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Master envelope gain (handles fade-in / fade-out)
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    // Mute gain
    const muteGain = ctx.createGain();
    muteGain.gain.setValueAtTime(this.isMuted ? 0 : 1, ctx.currentTime);

    masterGain.connect(muteGain);
    muteGain.connect(ctx.destination);

    this.masterGain = masterGain;
    this.muteGain = muteGain;

    // Warm drone filter (modulated by wind LFO)
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.setValueAtTime(520, ctx.currentTime);
    droneFilter.Q.setValueAtTime(1.8, ctx.currentTime);
    droneFilter.connect(masterGain);
    this.droneFilter = droneFilter;

    // Texture bus (humidity controls shimmer oscillators)
    const textureGain = ctx.createGain();
    textureGain.gain.setValueAtTime(0.28, ctx.currentTime);
    textureGain.connect(droneFilter);
    this.textureGain = textureGain;

    // Base + harmonic oscillators (pitch controlled by temperature)
    const baseGain = ctx.createGain();
    baseGain.gain.setValueAtTime(0.42, ctx.currentTime);
    baseGain.connect(droneFilter);

    const oscRoot = ctx.createOscillator();
    oscRoot.type = 'sine';

    const oscFifth = ctx.createOscillator();
    oscFifth.type = 'triangle';

    const oscOctave = ctx.createOscillator();
    oscOctave.type = 'sine';

    const oscNinth = ctx.createOscillator();
    oscNinth.type = 'sine';

    oscRoot.connect(baseGain);
    oscOctave.connect(baseGain);
    oscFifth.connect(textureGain);
    oscNinth.connect(textureGain);

    oscRoot.start();
    oscFifth.start();
    oscOctave.start();
    oscNinth.start();

    this.oscillators = [oscRoot, oscFifth, oscOctave, oscNinth];

    // Wind LFO modulating filter cutoff for rhythmic breathing motion
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(220, ctx.currentTime);
    lfo.connect(lfoDepth);
    lfoDepth.connect(droneFilter.frequency);
    lfo.start();
    this.lfo = lfo;
    this.lfoDepth = lfoDepth;

    // Pink-ish noise buffer for particulate (PM2.5) air density
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(900, ctx.currentTime);
    noiseFilter.Q.setValueAtTime(0.9, ctx.currentTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, ctx.currentTime);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSource.start();

    this.noiseSource = noiseSource;
    this.noiseFilter = noiseFilter;
    this.noiseGain = noiseGain;

    this.applySignals(this.currentSignals);
  }

  private applySignals(signals: EnvironmentalSignals) {
    this.currentSignals = signals;
    if (!this.ctx || this.oscillators.length < 4) return;

    const now = this.ctx.currentTime;
    const ramp = 0.35;

    // 1. Temperature (-5..45°C) -> Pitch (110 Hz .. 220 Hz)
    const tempNorm = Math.max(0, Math.min(1, (signals.temperature + 5) / 50));
    const rootFreq = 110 + tempNorm * 110;
    const [oscRoot, oscFifth, oscOctave, oscNinth] = this.oscillators;
    oscRoot.frequency.setTargetAtTime(rootFreq, now, ramp);
    oscFifth.frequency.setTargetAtTime(rootFreq * 1.498, now, ramp); // calm fifth
    oscOctave.frequency.setTargetAtTime(rootFreq * 2, now, ramp);
    oscNinth.frequency.setTargetAtTime(rootFreq * 2.25, now, ramp); // gentle ninth

    // 2. Wind (0..60 km/h) -> Rhythmic LFO motion (0.08 Hz .. 1.6 Hz) & sweep depth
    const windNorm = Math.max(0, Math.min(1, signals.wind / 60));
    const lfoRate = 0.08 + windNorm * 1.52;
    this.lfo?.frequency.setTargetAtTime(lfoRate, now, ramp);
    this.lfoDepth?.gain.setTargetAtTime(120 + windNorm * 380, now, ramp);

    // 3. Humidity (15..100%) -> Harmonic texture & filter resonance
    const humNorm = Math.max(0, Math.min(1, (signals.humidity - 15) / 85));
    this.textureGain?.gain.setTargetAtTime(0.12 + humNorm * 0.34, now, ramp);
    this.droneFilter?.Q.setTargetAtTime(0.8 + humNorm * 3.2, now, ramp);
    this.droneFilter?.frequency.setTargetAtTime(340 + humNorm * 420, now, ramp);

    // 4. PM2.5 (0..100 µg/m³) -> Particulate noise density
    const pmNorm = Math.max(0, Math.min(1, signals.pm25 / 100));
    this.noiseGain?.gain.setTargetAtTime(0.02 + pmNorm * 0.24, now, ramp);
    this.noiseFilter?.frequency.setTargetAtTime(600 + pmNorm * 1600, now, ramp);
  }

  public async start(signals: EnvironmentalSignals) {
    this.currentSignals = signals;
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.applySignals(signals);
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(
      Math.max(0.0001, this.masterGain.gain.value),
      now
    );
    // Gentle master volume ceiling (0.18) with smooth 1.2s fade-in
    this.masterGain.gain.linearRampToValueAtTime(0.18, now + 1.2);
    this.isPlaying = true;
  }

  public pause() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.65);
    this.isPlaying = false;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (!this.ctx || !this.muteGain) return;
    const now = this.ctx.currentTime;
    this.muteGain.gain.setTargetAtTime(muted ? 0 : 1, now, 0.08);
  }

  public updateSignals(signals: EnvironmentalSignals) {
    this.applySignals(signals);
  }

  public getPlaying() {
    return this.isPlaying;
  }

  public dispose() {
    if (this.noiseSource) {
      try {
        this.noiseSource.stop();
      } catch {
        // ignore if already stopped
      }
    }
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        // ignore
      }
    });
    try {
      this.lfo?.stop();
    } catch {
      // ignore
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const sonificationEngine = new SonificationEngine();
