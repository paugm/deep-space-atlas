import type { SampleId } from "./audio-catalog.ts";
import type { RoverKindId } from "./vehicles/kinds.ts";

export type FootstepSurface = "dry" | "wet" | "soft";

const FOOTSTEPS_DRY: readonly SampleId[] = [
  "footstepConcrete0",
  "footstepConcrete1",
  "footstepConcrete2",
];

const FOOTSTEPS_WET: readonly SampleId[] = [
  "footstepSnow0",
  "footstepSnow1",
  "slime0",
];

const FOOTSTEPS_SOFT: readonly SampleId[] = [
  "footstepGrass0",
  "footstepGrass1",
];

const PET_CHIRPS: readonly SampleId[] = [
  "cute01",
  "cute03",
  "cute05",
  "cute07",
  "bug01",
  "alien01",
  "alien03",
];

const SWIM_STROKES: readonly SampleId[] = [
  "slime0",
  "slime1",
  "burble01",
  "burble02",
];

const SCAN_PINGS: readonly SampleId[] = [
  "forceField0",
  "forceField2",
  "laserSmall",
  "laserRetro",
];

const THRUSTER_LOOPS: readonly SampleId[] = [
  "thrusterFire0",
  "thrusterFire1",
  "spaceEngineSmall",
];

export function pickFromPool<T>(pool: readonly T[], unitRandom: number): T {
  if (pool.length === 0) {
    throw new Error("Cannot pick from an empty audio pool.");
  }
  const index = Math.min(
    pool.length - 1,
    Math.floor(Math.max(0, Math.min(0.999999, unitRandom)) * pool.length),
  );
  return pool[index]!;
}

export function footstepSample(
  surface: FootstepSurface,
  unitRandom: number,
): SampleId {
  switch (surface) {
    case "dry":
      return pickFromPool(FOOTSTEPS_DRY, unitRandom);
    case "wet":
      return pickFromPool(FOOTSTEPS_WET, unitRandom);
    case "soft":
      return pickFromPool(FOOTSTEPS_SOFT, unitRandom);
    default: {
      const exhaustive: never = surface;
      throw new Error(`Unknown footstep surface: ${String(exhaustive)}`);
    }
  }
}

export function chimeSampleForFrequency(frequency: number): SampleId {
  if (frequency < 400) return "pepSound1";
  if (frequency < 480) return "pepSound2";
  if (frequency < 560) return "pepSound3";
  if (frequency < 640) return "pepSound4";
  if (frequency < 700) return "confirmation1";
  if (frequency < 780) return "confirmation2";
  if (frequency < 860) return "powerUp1";
  return "powerUp4";
}

export function scanPingSample(unitRandom: number): SampleId {
  return pickFromPool(SCAN_PINGS, unitRandom);
}

export function thrusterLoopSample(unitRandom: number): SampleId {
  return pickFromPool(THRUSTER_LOOPS, unitRandom);
}

/** Used for rare flora discoveries. */
export function odditySample(unitRandom: number): SampleId {
  return pickFromPool(
    ["spaceTrash1", "pluck", "zap1", "lowThreeTone", "phaserUp1"] as const,
    unitRandom,
  );
}

export function vehicleEngineSample(kind: RoverKindId): SampleId {
  switch (kind) {
    case "rover":
      return "engineCircular0";
    case "round-rover":
      return "engineCircular1";
    case "rover-variant":
      return "engineCircular2";
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown rover kind: ${String(exhaustive)}`);
    }
  }
}

export function vehicleEngineGain(speedRatio: number): number {
  const clamped = Math.max(0, Math.min(1, speedRatio));
  return 0.04 + clamped * 0.14;
}

export function vehicleEngineRate(speedRatio: number): number {
  const clamped = Math.max(0, Math.min(1, speedRatio));
  return 0.85 + clamped * 0.45;
}

export function miningHumGain(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return 0.03 + clamped * 0.1;
}

export function underwaterBedGain(strength: number): number {
  const clamped = Math.max(0, Math.min(1, strength));
  return clamped * 0.22;
}

export function petChirpSample(unitRandom: number): SampleId {
  return pickFromPool(PET_CHIRPS, unitRandom);
}

export function swimStrokeSample(unitRandom: number): SampleId {
  return pickFromPool(SWIM_STROKES, unitRandom);
}

export function thrusterLoopGain(intensity: number): number {
  const clamped = Math.max(0, Math.min(1, intensity));
  return clamped * 0.22;
}

export function thrusterLoopRate(intensity: number): number {
  const clamped = Math.max(0, Math.min(1, intensity));
  return 0.92 + clamped * 0.28;
}

/**
 * Quiet cockpit bed while coasting; opens up with speed and boost.
 * `speedRatio` is vs the active cap (cruise or boost).
 */
export function spaceBedGain(speedRatio: number, boosting = false): number {
  const clamped = Math.max(0, Math.min(1, speedRatio));
  return 0.06 + clamped * 0.1 + (boosting ? 0.04 : 0);
}

export function spaceBedRate(speedRatio: number, boosting = false): number {
  const clamped = Math.max(0, Math.min(1, speedRatio));
  return 0.88 + clamped * 0.22 + (boosting ? 0.08 : 0);
}
