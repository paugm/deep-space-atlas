import {
  WATER_DEPTH_FOR_FULL_FOG,
  WATER_FOG_FAR,
  WATER_FOG_NEAR,
  clamp,
  lerp,
  smoothstep,
} from "./config.ts";

export interface WaterImmersion {
  eyeSubmerged: boolean;
  /** Chest crosses the plane before the camera; drives swim slowdown. */
  bodyInWater: boolean;
  eyeDepth: number;
}

/**
 * Eye-space Y and waterLevel share world units. Chest sample sits a bit below
 * the eyes so wading still slows movement before the camera goes under.
 */
export function sampleWaterImmersion(
  eyeY: number,
  eyeHeight: number,
  waterLevel: number,
): WaterImmersion {
  const eyeDepth = Math.max(0, waterLevel - eyeY);
  const chestY = eyeY - eyeHeight * 0.4;
  return {
    eyeSubmerged: eyeDepth > 0,
    bodyInWater: chestY < waterLevel,
    eyeDepth,
  };
}

export interface UnderwaterFogParams {
  near: number;
  far: number;
  /** 0 at the surface → 1 at WATER_DEPTH_FOR_FULL_FOG. */
  strength: number;
}

export function underwaterFogParams(
  eyeDepth: number,
  surfaceNear: number,
  surfaceFar: number,
): UnderwaterFogParams {
  const strength = smoothstep(0, WATER_DEPTH_FOR_FULL_FOG, eyeDepth);
  return {
    near: lerp(surfaceNear, WATER_FOG_NEAR, strength),
    far: lerp(surfaceFar, WATER_FOG_FAR, strength),
    strength,
  };
}

export function blendUnderwaterFogColor(
  surfaceR: number,
  surfaceG: number,
  surfaceB: number,
  waterR: number,
  waterG: number,
  waterB: number,
  strength: number,
): { r: number; g: number; b: number } {
  const amount = clamp(strength, 0, 1);
  // Pull toward a slightly darker water so depth reads as volume, not paint.
  const deepR = waterR * 0.35;
  const deepG = waterG * 0.45;
  const deepB = waterB * 0.55;
  return {
    r: lerp(surfaceR, deepR, amount),
    g: lerp(surfaceG, deepG, amount),
    b: lerp(surfaceB, deepB, amount),
  };
}
