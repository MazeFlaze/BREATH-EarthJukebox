export interface EnvironmentalSignals {
  wind: number; // km/h (0 - 60)
  humidity: number; // % (15 - 100)
  temperature: number; // °C (-5 - 45)
  pm25: number; // µg/m³ (0 - 100)
}

export interface SoundPreset {
  id: 'before-the-city-wakes' | 'where-the-wind-wanders' | 'weight-of-summer-air';
  name: string;
  location: string;
  description: string;
  signals: EnvironmentalSignals;
}

export const DEFAULT_DEMO_SIGNALS: EnvironmentalSignals = {
  wind: 12,
  humidity: 68,
  temperature: 24,
  pm25: 18,
};

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'before-the-city-wakes',
    name: 'Before the City Wakes',
    location: 'Imagined Atmosphere · Early Dawn Street',
    description:
      'Cool stillness before sunrise, moisture resting on stone, and a quiet harmonic hum.',
    signals: {
      wind: 6,
      humidity: 82,
      temperature: 15,
      pm25: 8,
    },
  },
  {
    id: 'where-the-wind-wanders',
    name: 'Where the Wind Wanders',
    location: 'Imagined Atmosphere · Open Window Breeze',
    description:
      'A passing breeze crossing a sunlit room, carrying unhurried swells and airy overtones.',
    signals: {
      wind: 28,
      humidity: 54,
      temperature: 19,
      pm25: 14,
    },
  },
  {
    id: 'weight-of-summer-air',
    name: 'The Weight of Summer Air',
    location: 'Imagined Atmosphere · Late Afternoon Rain',
    description:
      'Warmth lingering on pavement as moisture gathers before rain, dense with golden dust.',
    signals: {
      wind: 4,
      humidity: 88,
      temperature: 31,
      pm25: 34,
    },
  },
];

export type BreatheModalKey =
  | null
  | 'menu'
  | 'world-is-sound'
  | 'experience'
  | 'collected-atmospheres'
  | 'about'
  | 'signals'
  | 'visuals';
