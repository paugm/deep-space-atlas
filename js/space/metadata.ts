/**
 * Planet metadata from a seed without building the world.
 *
 * Mirrors the derivations in `js/world/generate.ts` (`buildWorld`): the class
 * pick is the first call on `mulberry32(seed)`, the palette consumes the same
 * stream next, and the name uses the dedicated `seed ^ 0x27d4eb2f` stream.
 * If generation changes those rules, update this module in the same change.
 *
 * Proxy colors are remapped from the ground palette for orbital view. Terrain
 * mid/horizon tints stay soft for the planet surface, but flat spheres in space
 * need darker, deeper hues so they read as sci-fi bodies rather than pastels.
 */

import * as THREE from "three";

import { clamp, mulberry32 } from "../config.ts";
import { seedToHex } from "../planet-save.ts";
import {
  createPalette,
  createPlanetName,
  pickPlanetClass,
  type PlanetClassId,
} from "../world.ts";
import { hasLiquidWater } from "../world/planet-class.ts";
import type { WorldPalette } from "../world/types.ts";
import type { ProxyBandColors } from "./proxy-geometry.ts";

export interface PlanetMetadata {
  seed: number;
  seedHex: string;
  name: string;
  planetClassId: PlanetClassId;
  hasLiquidWater: boolean;
  biomeLabel: string;
  /** Hex tint for space proxies (temperate band / HUD fallback). */
  surfaceColor: string;
  atmosphereColor: string;
  bandPoleColor: string;
  bandTemperateColor: string;
  bandEquatorColor: string;
}

const hslScratch = { h: 0, s: 0, l: 0 };

function deepenOrbital(
  color: THREE.Color,
  saturationBoost: number,
  lightnessScale: number,
  lightnessMax: number,
): THREE.Color {
  color.getHSL(hslScratch);
  color.setHSL(
    hslScratch.h,
    clamp(hslScratch.s * 1.2 + saturationBoost, 0.18, 0.72),
    clamp(hslScratch.l * lightnessScale, 0.1, lightnessMax),
  );
  return color;
}

/**
 * Ground mid/low/high → orbital body albedo: deeper, a bit more saturated.
 * Ocean classes pull toward water so the disc reads wet instead of candy green.
 */
export function spaceProxySurfaceColor(palette: WorldPalette): THREE.Color {
  const surface = palette.mid.clone();
  surface.lerp(palette.low, 0.28);
  surface.lerp(palette.high, 0.12);
  if (palette.water) surface.lerp(palette.water, 0.42);
  return deepenOrbital(surface, 0.08, 0.52, 0.34);
}

/**
 * Soft sky horizon → dim atmosphere emissive (cool rim, not pastel wash).
 */
export function spaceProxyAtmosphereColor(palette: WorldPalette): THREE.Color {
  const atmosphere = palette.skyTop.clone().lerp(palette.horizon, 0.4);
  return deepenOrbital(atmosphere, 0.12, 0.38, 0.36);
}

/**
 * Three latitude bands for vertex-colored proxy spheres (pole / mid / equator).
 */
export function spaceProxyBandColors(palette: WorldPalette): ProxyBandColors {
  const pole = palette.peak.clone().lerp(palette.high, 0.55);
  pole.lerp(palette.rock, 0.25);
  deepenOrbital(pole, 0.05, 0.58, 0.4);

  const temperate = spaceProxySurfaceColor(palette);

  const equator = palette.low.clone().lerp(palette.mid, 0.35);
  if (palette.water) equator.lerp(palette.water, 0.55);
  else equator.lerp(palette.crater, 0.2);
  deepenOrbital(equator, 0.1, 0.48, 0.32);

  return { pole, temperate, equator };
}

export function planetMetadata(seed: number): PlanetMetadata {
  const normalized = seed >>> 0;
  const random = mulberry32(normalized);
  const planetClass = pickPlanetClass(random);
  const palette = createPalette(random, planetClass);
  const bands = spaceProxyBandColors(palette);
  const atmosphere = spaceProxyAtmosphereColor(palette);
  return {
    seed: normalized,
    seedHex: seedToHex(normalized),
    name: createPlanetName(mulberry32(normalized ^ 0x27d4eb2f)),
    planetClassId: planetClass.id,
    hasLiquidWater: hasLiquidWater(planetClass),
    biomeLabel: planetClass.label,
    surfaceColor: `#${bands.temperate.getHexString()}`,
    atmosphereColor: `#${atmosphere.getHexString()}`,
    bandPoleColor: `#${bands.pole.getHexString()}`,
    bandTemperateColor: `#${bands.temperate.getHexString()}`,
    bandEquatorColor: `#${bands.equator.getHexString()}`,
  };
}

export function proxyBandsFromMetadata(
  metadata: PlanetMetadata,
): ProxyBandColors {
  return {
    pole: new THREE.Color(metadata.bandPoleColor),
    temperate: new THREE.Color(metadata.bandTemperateColor),
    equator: new THREE.Color(metadata.bandEquatorColor),
  };
}
