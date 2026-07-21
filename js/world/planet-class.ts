/**
 * Seed-selected planet classes: terrain, surface, flora, deposits, lighting.
 * Pure data and selection, no Three.js. Generation and metadata both read it.
 */

import type { DepositType, RandomSource } from "../config.ts";
import type { BiomeConfig } from "./types.ts";

export type PlanetClassId =
  | "lush-paradise"
  | "exotic"
  | "ash-wastes"
  | "crystal-barrens"
  | "rust-dunes"
  | "frozen-shelf"
  | "verdant-marsh"
  | "nightworld";

/** Visual surface plane. Only `water` enables swimming / immersion. */
export type SurfaceKind = "none" | "water" | "ice";

export interface PlanetLighting {
  /** Multiplier on sun / moon / hemisphere intensities. */
  intensityScale: number;
  /** Full day+night cycle length vs default ( >1 = longer nights and days ). */
  dayLengthScale: number;
  /** Extra multiplier on aetherite emissive pulse. */
  depositGlowScale: number;
}

export interface PlanetClassDefinition {
  id: PlanetClassId;
  label: string;
  /** Relative pick weight among all classes. */
  weight: number;
  biome: Omit<BiomeConfig, "label">;
  surface: SurfaceKind;
  /**
   * Surface plane height as a fraction of (max − min) above minimum.
   * Ignored when `surface` is `none`.
   */
  waterFraction: number;
  /** Target tree count (0 = none; placement may undershoot). */
  floraCount: number;
  /** Rock cluster count (each cluster places several boulders). */
  rockClusters: number;
  /**
   * Crystal (aetherite) altitude cut as a fraction of the height range.
   * Lower accepts more mid-elevation sites.
   */
  crystalAltitudeFraction: number;
  /** Per-deposit instance count scales (1 = catalog default). */
  depositCountScale: Partial<Record<DepositType, number>>;
  lighting: PlanetLighting;
  /** Dry-land foot speed multiplier (1 = normal). */
  walkSpeedFactor: number;
}

const SHARED_COLOR_CUTS_WARM: BiomeConfig["colorCuts"] = [
  0.2, 0.26, 0.52, 0.6, 0.78, 0.86,
];
const SHARED_COLOR_CUTS_LUSH: BiomeConfig["colorCuts"] = [
  0.21, 0.26, 0.6, 0.68, 0.84, 0.9,
];

export const PLANET_CLASSES: Record<
  PlanetClassId,
  PlanetClassDefinition
> = {
  "lush-paradise": {
    id: "lush-paradise",
    label: "LUSH PARADISE",
    weight: 12,
    biome: {
      continent: 10,
      hills: 4.5,
      mountains: 34,
      maskLow: 0.15,
      maskHigh: 0.7,
      colorCuts: SHARED_COLOR_CUTS_LUSH,
      fogNear: 70,
      fogFar: 400,
    },
    surface: "water",
    waterFraction: 0.16,
    floraCount: 240,
    rockClusters: 60,
    crystalAltitudeFraction: 0.62,
    depositCountScale: {},
    lighting: {
      intensityScale: 1,
      dayLengthScale: 1,
      depositGlowScale: 1,
    },
    walkSpeedFactor: 1,
  },
  exotic: {
    id: "exotic",
    label: "EXOTIC",
    weight: 16,
    biome: {
      continent: 13,
      hills: 6.5,
      mountains: 52,
      maskLow: 0.02,
      maskHigh: 0.55,
      colorCuts: SHARED_COLOR_CUTS_WARM,
      fogNear: 55,
      fogFar: 330,
    },
    surface: "none",
    waterFraction: 0,
    floraCount: 0,
    rockClusters: 60,
    crystalAltitudeFraction: 0.62,
    depositCountScale: {},
    lighting: {
      intensityScale: 1,
      dayLengthScale: 1,
      depositGlowScale: 1,
    },
    walkSpeedFactor: 1,
  },
  "ash-wastes": {
    id: "ash-wastes",
    label: "ASH WASTES",
    weight: 12,
    biome: {
      continent: 5,
      hills: 2.2,
      mountains: 10,
      maskLow: 0.4,
      maskHigh: 0.9,
      colorCuts: [0.18, 0.28, 0.48, 0.58, 0.72, 0.82],
      fogNear: 40,
      fogFar: 210,
    },
    surface: "none",
    waterFraction: 0,
    floraCount: 0,
    rockClusters: 28,
    crystalAltitudeFraction: 0.7,
    depositCountScale: { iron: 0.75, carbon: 0.7, copper: 0.7 },
    lighting: {
      intensityScale: 0.92,
      dayLengthScale: 1,
      depositGlowScale: 1.05,
    },
    walkSpeedFactor: 1.06,
  },
  "crystal-barrens": {
    id: "crystal-barrens",
    label: "CRYSTAL BARRENS",
    weight: 12,
    biome: {
      continent: 11,
      hills: 5,
      mountains: 58,
      maskLow: 0.06,
      maskHigh: 0.48,
      colorCuts: [0.22, 0.3, 0.5, 0.62, 0.8, 0.9],
      fogNear: 65,
      fogFar: 380,
    },
    surface: "none",
    waterFraction: 0,
    floraCount: 0,
    rockClusters: 48,
    crystalAltitudeFraction: 0.45,
    depositCountScale: { crystal: 1.75, iron: 0.85, carbon: 0.85 },
    lighting: {
      intensityScale: 1.05,
      dayLengthScale: 1,
      depositGlowScale: 1.25,
    },
    walkSpeedFactor: 1,
  },
  "rust-dunes": {
    id: "rust-dunes",
    label: "RUST DUNES",
    weight: 14,
    biome: {
      continent: 9,
      hills: 7.5,
      mountains: 14,
      maskLow: 0.45,
      maskHigh: 0.95,
      colorCuts: [0.18, 0.24, 0.45, 0.58, 0.74, 0.84],
      fogNear: 60,
      fogFar: 350,
    },
    surface: "none",
    waterFraction: 0,
    floraCount: 0,
    rockClusters: 55,
    crystalAltitudeFraction: 0.72,
    depositCountScale: { iron: 1.35, copper: 1.15, crystal: 0.65 },
    lighting: {
      intensityScale: 1,
      dayLengthScale: 1,
      depositGlowScale: 1,
    },
    walkSpeedFactor: 1.03,
  },
  "frozen-shelf": {
    id: "frozen-shelf",
    label: "FROZEN SHELF",
    weight: 12,
    biome: {
      continent: 10,
      hills: 4,
      mountains: 28,
      maskLow: 0.12,
      maskHigh: 0.65,
      colorCuts: [0.2, 0.28, 0.5, 0.62, 0.78, 0.88],
      fogNear: 32,
      fogFar: 190,
    },
    surface: "ice",
    waterFraction: 0.14,
    floraCount: 0,
    rockClusters: 42,
    crystalAltitudeFraction: 0.58,
    depositCountScale: { copper: 1.1 },
    lighting: {
      intensityScale: 0.78,
      dayLengthScale: 1.1,
      depositGlowScale: 1.15,
    },
    walkSpeedFactor: 0.94,
  },
  "verdant-marsh": {
    id: "verdant-marsh",
    label: "VERDANT MARSH",
    weight: 10,
    biome: {
      continent: 8,
      hills: 3.5,
      mountains: 22,
      maskLow: 0.22,
      maskHigh: 0.78,
      colorCuts: SHARED_COLOR_CUTS_LUSH,
      fogNear: 85,
      fogFar: 460,
    },
    surface: "water",
    waterFraction: 0.28,
    floraCount: 420,
    rockClusters: 40,
    crystalAltitudeFraction: 0.68,
    depositCountScale: { carbon: 1.55, iron: 0.8, crystal: 0.7 },
    lighting: {
      intensityScale: 0.95,
      dayLengthScale: 1,
      depositGlowScale: 1,
    },
    walkSpeedFactor: 0.84,
  },
  nightworld: {
    id: "nightworld",
    label: "NIGHTWORLD",
    weight: 12,
    biome: {
      continent: 12,
      hills: 5.5,
      mountains: 44,
      maskLow: 0.05,
      maskHigh: 0.58,
      colorCuts: SHARED_COLOR_CUTS_WARM,
      fogNear: 50,
      fogFar: 300,
    },
    surface: "none",
    waterFraction: 0,
    floraCount: 0,
    rockClusters: 55,
    crystalAltitudeFraction: 0.55,
    depositCountScale: { crystal: 1.2 },
    lighting: {
      intensityScale: 0.62,
      dayLengthScale: 1.35,
      depositGlowScale: 2.1,
    },
    walkSpeedFactor: 1,
  },
};

export const PLANET_CLASS_IDS = Object.keys(
  PLANET_CLASSES,
) as PlanetClassId[];

const WEIGHTED_CLASSES: readonly PlanetClassDefinition[] =
  PLANET_CLASS_IDS.map((id) => PLANET_CLASSES[id]);

const TOTAL_WEIGHT = WEIGHTED_CLASSES.reduce(
  (sum, entry) => sum + entry.weight,
  0,
);

/** First main-stream draw in `buildWorld` / `planetMetadata`. */
export function pickPlanetClass(
  random: RandomSource,
): PlanetClassDefinition {
  let ticket = random() * TOTAL_WEIGHT;
  for (const entry of WEIGHTED_CLASSES) {
    ticket -= entry.weight;
    if (ticket < 0) return entry;
  }
  return WEIGHTED_CLASSES[WEIGHTED_CLASSES.length - 1]!;
}

export function biomeFromPlanetClass(
  planetClass: PlanetClassDefinition,
): BiomeConfig {
  return {
    label: planetClass.label,
    ...planetClass.biome,
  };
}

export function waterLevelForPlanetClass(
  planetClass: PlanetClassDefinition,
  minimumHeight: number,
  maximumHeight: number,
): number {
  if (planetClass.surface === "none") {
    return Number.NEGATIVE_INFINITY;
  }
  return (
    minimumHeight +
    (maximumHeight - minimumHeight) * planetClass.waterFraction
  );
}

export function hasLiquidWater(
  planetClass: PlanetClassDefinition,
): boolean {
  return planetClass.surface === "water";
}

export function hasSurfacePlane(
  planetClass: PlanetClassDefinition,
): boolean {
  return planetClass.surface !== "none";
}

/** Flatness / shore scoring shared by spawn, fauna, and rover placement. */
export function liquidWaterPenalty(
  height: number,
  waterLevel: number,
  hasLiquid: boolean,
  margin: number,
  penalty: number,
): number {
  if (hasLiquid && height < waterLevel + margin) return penalty;
  return 0;
}

export function depositInstanceCount(
  planetClass: PlanetClassDefinition,
  type: DepositType,
  baseCount: number,
): number {
  const scale = planetClass.depositCountScale[type] ?? 1;
  return Math.max(1, Math.round(baseCount * scale));
}
