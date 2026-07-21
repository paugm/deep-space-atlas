/**
 * Deterministic fauna presence and spawn placement. It uses a separate RNG
 * stream so existing worlds stay reproducible.
 */

import { HALF_WORLD, mulberry32 } from "../config.ts";
import { liquidWaterPenalty } from "../world/planet-class.ts";
import type { HeightAt } from "../world/types.ts";
import { FAUNA_SPECIES, type FaunaSpeciesId } from "./species.ts";

export const FAUNA_WORLD_CHANCE = 0.22;
export const FAUNA_MIN_COUNT = 1;
export const FAUNA_MAX_COUNT = 3;
/** Keep fauna away from the player spawn pad. */
export const FAUNA_SPAWN_MIN_DISTANCE = 28;
export const FAUNA_SPAWN_MAX_DISTANCE = 120;
export const FAUNA_SPAWN_ATTEMPTS = 40;

export interface FaunaSpawnPlan {
  id: string;
  species: FaunaSpeciesId;
  x: number;
  z: number;
}

export interface FaunaPlan {
  hasFauna: boolean;
  spawns: readonly FaunaSpawnPlan[];
}

export function faunaSpawnId(index: number): string {
  return `fauna-${index}`;
}

/**
 * Plan wild fauna for a seed. Uses an isolated PRNG so calling this never
 * advances the main world generation stream.
 */
export function planFauna(options: {
  seed: number;
  heightAt: HeightAt;
  spawnX: number;
  spawnZ: number;
  hasLiquid: boolean;
  waterLevel: number;
}): FaunaPlan {
  const random = mulberry32(options.seed ^ 0xcafef00d);
  const hasFauna = random() < FAUNA_WORLD_CHANCE;
  if (!hasFauna) {
    return { hasFauna: false, spawns: [] };
  }

  const count =
    FAUNA_MIN_COUNT +
    Math.floor(random() * (FAUNA_MAX_COUNT - FAUNA_MIN_COUNT + 1));
  const spawns: FaunaSpawnPlan[] = [];

  for (let index = 0; index < count; index += 1) {
    const species =
      FAUNA_SPECIES[Math.floor(random() * FAUNA_SPECIES.length)]!;
    const placed = pickSpawnXZ({
      random,
      heightAt: options.heightAt,
      spawnX: options.spawnX,
      spawnZ: options.spawnZ,
      hasLiquid: options.hasLiquid,
      waterLevel: options.waterLevel,
      existing: spawns,
    });
    if (placed === null) continue;
    spawns.push({
      id: faunaSpawnId(index),
      species,
      x: placed.x,
      z: placed.z,
    });
  }

  return { hasFauna: spawns.length > 0, spawns };
}

function pickSpawnXZ(options: {
  random: () => number;
  heightAt: HeightAt;
  spawnX: number;
  spawnZ: number;
  hasLiquid: boolean;
  waterLevel: number;
  existing: readonly FaunaSpawnPlan[];
}): { x: number; z: number } | null {
  const {
    random,
    heightAt,
    spawnX,
    spawnZ,
    hasLiquid,
    waterLevel,
    existing,
  } = options;
  let best: { x: number; z: number; score: number } | null = null;

  for (let attempt = 0; attempt < FAUNA_SPAWN_ATTEMPTS; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius =
      FAUNA_SPAWN_MIN_DISTANCE +
      random() * (FAUNA_SPAWN_MAX_DISTANCE - FAUNA_SPAWN_MIN_DISTANCE);
    const x = clampWorld(spawnX + Math.cos(angle) * radius);
    const z = clampWorld(spawnZ + Math.sin(angle) * radius);
    const height = heightAt(x, z);

    let score =
      Math.abs(heightAt(x + 2, z) - height) +
      Math.abs(heightAt(x, z + 2) - height);
    score += liquidWaterPenalty(height, waterLevel, hasLiquid, 1.2, 80);

    for (const other of existing) {
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < 12 * 12) score += 40;
    }

    if (best === null || score < best.score) {
      best = { x, z, score };
    }
  }

  return best === null ? null : { x: best.x, z: best.z };
}

function clampWorld(value: number): number {
  const limit = HALF_WORLD - 8;
  if (value < -limit) return -limit;
  if (value > limit) return limit;
  return value;
}
