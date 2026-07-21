/**
 * Deterministic rover presence and spawn placement. It uses a separate RNG
 * stream so existing worlds stay reproducible.
 */

import { HALF_WORLD, mulberry32 } from "../config.ts";
import { liquidWaterPenalty } from "../world/planet-class.ts";
import type { HeightAt } from "../world/types.ts";
import { ROVER_KINDS, type RoverKindId } from "./kinds.ts";

export const ROVER_MIN_COUNT = 0;
export const ROVER_MAX_COUNT = 2;
/** Keep seeded rovers away from the player spawn pad. */
export const ROVER_SPAWN_MIN_DISTANCE = 22;
export const ROVER_SPAWN_MAX_DISTANCE = 110;
export const ROVER_SPAWN_ATTEMPTS = 40;

export interface RoverSpawnPlan {
  id: string;
  kind: RoverKindId;
  x: number;
  z: number;
  yaw: number;
}

export interface RoverPlan {
  spawns: readonly RoverSpawnPlan[];
}

export function roverSpawnId(index: number): string {
  return `rover-${index}`;
}

/**
 * Plan wheeled rovers for a seed. Uses an isolated PRNG so calling this never
 * advances the main world generation stream.
 */
export function planRovers(options: {
  seed: number;
  heightAt: HeightAt;
  spawnX: number;
  spawnZ: number;
  hasLiquid: boolean;
  waterLevel: number;
}): RoverPlan {
  const random = mulberry32(options.seed ^ 0x70fe700e);
  const count =
    ROVER_MIN_COUNT +
    Math.floor(random() * (ROVER_MAX_COUNT - ROVER_MIN_COUNT + 1));
  const spawns: RoverSpawnPlan[] = [];

  for (let index = 0; index < count; index += 1) {
    const kind = ROVER_KINDS[Math.floor(random() * ROVER_KINDS.length)]!;
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
      id: roverSpawnId(index),
      kind,
      x: placed.x,
      z: placed.z,
      yaw: random() * Math.PI * 2,
    });
  }

  return { spawns };
}

function pickSpawnXZ(options: {
  random: () => number;
  heightAt: HeightAt;
  spawnX: number;
  spawnZ: number;
  hasLiquid: boolean;
  waterLevel: number;
  existing: readonly RoverSpawnPlan[];
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

  for (let attempt = 0; attempt < ROVER_SPAWN_ATTEMPTS; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius =
      ROVER_SPAWN_MIN_DISTANCE +
      random() * (ROVER_SPAWN_MAX_DISTANCE - ROVER_SPAWN_MIN_DISTANCE);
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
      if (dx * dx + dz * dz < 16 * 16) score += 40;
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
