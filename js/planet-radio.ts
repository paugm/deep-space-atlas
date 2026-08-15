/**
 * Seed → quiet generative radio patch. Tone.js plays it; this file stays pure.
 */

import { mulberry32 } from "./config.ts";
import type { PlanetClassId } from "./world/planet-class.ts";

export type RadioWaveform = "sine" | "triangle" | "sawtooth";

export interface PlanetRadioPatch {
  bpm: number;
  rootMidi: number;
  intervals: readonly number[];
  filterHz: number;
  delayTime: number;
  waveform: RadioWaveform;
  notes: readonly number[];
  volumeDb: number;
}

const CLASS_PATCH: Record<
  PlanetClassId,
  Omit<PlanetRadioPatch, "notes" | "rootMidi" | "bpm">
> = {
  "lush-paradise": {
    intervals: [0, 2, 4, 7, 9],
    filterHz: 920,
    delayTime: 0.38,
    waveform: "sine",
    volumeDb: -22,
  },
  exotic: {
    intervals: [0, 1, 4, 6, 9],
    filterHz: 1400,
    delayTime: 0.22,
    waveform: "triangle",
    volumeDb: -24,
  },
  "ash-wastes": {
    intervals: [0, 3, 5, 7, 10],
    filterHz: 480,
    delayTime: 0.5,
    waveform: "sawtooth",
    volumeDb: -26,
  },
  "crystal-barrens": {
    intervals: [0, 2, 5, 7, 11],
    filterHz: 1800,
    delayTime: 0.28,
    waveform: "sine",
    volumeDb: -23,
  },
  "rust-dunes": {
    intervals: [0, 2, 3, 7, 10],
    filterHz: 700,
    delayTime: 0.42,
    waveform: "triangle",
    volumeDb: -25,
  },
  "frozen-shelf": {
    intervals: [0, 2, 7, 9],
    filterHz: 620,
    delayTime: 0.62,
    waveform: "sine",
    volumeDb: -24,
  },
  "verdant-marsh": {
    intervals: [0, 3, 5, 7, 10],
    filterHz: 540,
    delayTime: 0.46,
    waveform: "triangle",
    volumeDb: -23,
  },
  nightworld: {
    intervals: [0, 1, 3, 7, 8],
    filterHz: 380,
    delayTime: 0.7,
    waveform: "sine",
    volumeDb: -27,
  },
};

function midiFromClass(classId: PlanetClassId, random: () => number): number {
  const bases: Record<PlanetClassId, number> = {
    "lush-paradise": 57,
    exotic: 62,
    "ash-wastes": 50,
    "crystal-barrens": 66,
    "rust-dunes": 53,
    "frozen-shelf": 64,
    "verdant-marsh": 55,
    nightworld: 48,
  };
  return bases[classId] + Math.floor(random() * 3) - 1;
}

export function planetRadioPatch(
  seed: number,
  classId: PlanetClassId,
): PlanetRadioPatch {
  const random = mulberry32(seed ^ 0x12ad10);
  const preset = CLASS_PATCH[classId];
  const rootMidi = midiFromClass(classId, random);
  const bpm = 48 + Math.floor(random() * 28);
  const notes: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    const interval = preset.intervals[
      Math.floor(random() * preset.intervals.length)
    ]!;
    const octave = random() < 0.3 ? 12 : 0;
    notes.push(rootMidi + interval + octave);
  }
  return {
    ...preset,
    rootMidi,
    bpm,
    notes,
  };
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
