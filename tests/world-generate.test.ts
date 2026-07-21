import { describe, expect, it } from "vitest";

import {
  DEPOSIT_TYPES,
  createNoise2D,
  makeFbm,
  mulberry32,
  HALF_WORLD,
  TERRAIN_STEP,
  VERTICES_PER_ROW,
} from "../js/config.ts";
import {
  biomeFromPlanetClass,
  createPlanetName,
  pickPlanetClass,
  PLANET_CLASSES,
  PLANET_CLASS_IDS,
  sampleHeightBilinear,
} from "../js/world.ts";
import {
  depositInstanceCount,
  hasLiquidWater,
  hasSurfacePlane,
  liquidWaterPenalty,
  waterLevelForPlanetClass,
} from "../js/world/planet-class.ts";
import {
  createGridHeightAt,
  createHeightAt,
  fillHeightField,
} from "../js/world/terrain.ts";
import { createStarPositions } from "../js/world/textures.ts";
import { gridIndex } from "../js/world/util.ts";

describe("createPlanetName", () => {
  it("is deterministic for a seed stream", () => {
    const first = createPlanetName(mulberry32(0x27d4eb2f ^ 42));
    const second = createPlanetName(mulberry32(0x27d4eb2f ^ 42));
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Z][a-z]+ [A-Z0-9]+$/);
  });

  it("varies across seeds", () => {
    const a = createPlanetName(mulberry32(1));
    const b = createPlanetName(mulberry32(2));
    expect(a).not.toBe(b);
  });
});

describe("planet classes", () => {
  it("defines every class id with a unique label", () => {
    const labels = new Set<string>();
    for (const id of PLANET_CLASS_IDS) {
      const entry = PLANET_CLASSES[id];
      expect(entry.id).toBe(id);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.weight).toBeGreaterThan(0);
      expect(labels.has(entry.label)).toBe(false);
      labels.add(entry.label);
    }
    expect(PLANET_CLASS_IDS).toHaveLength(8);
  });

  it("picks deterministically from the main stream", () => {
    const seed = 0xabcdd00d;
    expect(pickPlanetClass(mulberry32(seed)).id).toBe(
      pickPlanetClass(mulberry32(seed)).id,
    );
  });

  it("eventually selects every class across many seeds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 8000; seed += 1) {
      seen.add(pickPlanetClass(mulberry32(seed)).id);
      if (seen.size === PLANET_CLASS_IDS.length) break;
    }
    expect(seen.size).toBe(PLANET_CLASS_IDS.length);
  });

  it("maps biome config from the class table", () => {
    const lush = biomeFromPlanetClass(PLANET_CLASSES["lush-paradise"]);
    expect(lush.label).toBe("LUSH PARADISE");
    expect(lush.mountains).toBe(34);

    const exotic = biomeFromPlanetClass(PLANET_CLASSES.exotic);
    expect(exotic.label).toBe("EXOTIC");
    expect(exotic.mountains).toBe(52);

    const ash = biomeFromPlanetClass(PLANET_CLASSES["ash-wastes"]);
    expect(ash.label).toBe("ASH WASTES");
    expect(ash.fogFar).toBeLessThan(exotic.fogFar);
  });

  it("derives liquid water and surface planes from surface kind", () => {
    expect(hasLiquidWater(PLANET_CLASSES["lush-paradise"])).toBe(true);
    expect(hasLiquidWater(PLANET_CLASSES["verdant-marsh"])).toBe(true);
    expect(hasLiquidWater(PLANET_CLASSES["frozen-shelf"])).toBe(false);
    expect(hasSurfacePlane(PLANET_CLASSES["frozen-shelf"])).toBe(true);
    expect(hasSurfacePlane(PLANET_CLASSES.exotic)).toBe(false);
  });

  it("computes water levels only for surface planes", () => {
    expect(
      waterLevelForPlanetClass(PLANET_CLASSES.exotic, 0, 100),
    ).toBe(Number.NEGATIVE_INFINITY);
    expect(
      waterLevelForPlanetClass(PLANET_CLASSES["lush-paradise"], 0, 100),
    ).toBeCloseTo(16, 5);
    expect(
      waterLevelForPlanetClass(PLANET_CLASSES["verdant-marsh"], 0, 100),
    ).toBeCloseTo(28, 5);
  });

  it("scales deposit counts and keeps at least one instance", () => {
    const crystal = PLANET_CLASSES["crystal-barrens"];
    expect(depositInstanceCount(crystal, "crystal", 24)).toBe(42);
    expect(depositInstanceCount(crystal, "iron", 85)).toBe(72);
    expect(depositInstanceCount(PLANET_CLASSES.exotic, "iron", 85)).toBe(
      85,
    );
  });

  it("applies liquid water spawn penalties only when liquid", () => {
    expect(liquidWaterPenalty(1, 2, true, 1.2, 80)).toBe(80);
    expect(liquidWaterPenalty(5, 2, true, 1.2, 80)).toBe(0);
    expect(liquidWaterPenalty(1, 2, false, 1.2, 80)).toBe(0);
  });
});

describe("sampleHeightBilinear", () => {
  it("returns exact grid heights at vertices", () => {
    const heights = new Float32Array(VERTICES_PER_ROW * VERTICES_PER_ROW);
    heights[gridIndex(10, 12)] = 7.5;
    const x = -HALF_WORLD + 10 * TERRAIN_STEP;
    const z = -HALF_WORLD + 12 * TERRAIN_STEP;
    expect(sampleHeightBilinear(heights, x, z)).toBeCloseTo(7.5, 5);
  });

  it("interpolates between neighboring grid samples", () => {
    const heights = new Float32Array(VERTICES_PER_ROW * VERTICES_PER_ROW);
    heights[gridIndex(0, 0)] = 0;
    heights[gridIndex(1, 0)] = 10;
    heights[gridIndex(0, 1)] = 0;
    heights[gridIndex(1, 1)] = 10;
    const x = -HALF_WORLD + 0.5 * TERRAIN_STEP;
    const z = -HALF_WORLD;
    expect(sampleHeightBilinear(heights, x, z)).toBeCloseTo(5, 5);
  });

  it("matches createHeightAt for a filled field", async () => {
    const seed = 0xabcd;
    const noiseA = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
    const noiseB = createNoise2D(mulberry32(seed ^ 0x85ebca6b));
    const noiseC = createNoise2D(mulberry32(seed ^ 0xc2b2ae35));
    const field = await fillHeightField(
      biomeFromPlanetClass(PLANET_CLASSES.exotic),
      PLANET_CLASSES.exotic,
      makeFbm(noiseA),
      makeFbm(noiseB),
      makeFbm(noiseC),
    );
    const heightAt = createHeightAt(field.heights);
    const x = 12.5;
    const z = -40.25;
    expect(sampleHeightBilinear(field.heights, x, z)).toBe(
      heightAt(x, z),
    );
  });

  it("produces identical heights across chunk yields (deterministic)", async () => {
    const seed = 0x1234;
    const make = async () => {
      const noiseA = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
      const noiseB = createNoise2D(mulberry32(seed ^ 0x85ebca6b));
      const noiseC = createNoise2D(mulberry32(seed ^ 0xc2b2ae35));
      return fillHeightField(
        biomeFromPlanetClass(PLANET_CLASSES["lush-paradise"]),
        PLANET_CLASSES["lush-paradise"],
        makeFbm(noiseA),
        makeFbm(noiseB),
        makeFbm(noiseC),
      );
    };
    const first = await make();
    const second = await make();
    expect(first.heights).toEqual(second.heights);
    expect(first.minimumHeight).toBe(second.minimumHeight);
    expect(first.maximumHeight).toBe(second.maximumHeight);
    expect(first.waterLevel).toBe(second.waterLevel);
    expect(first.waterLevel).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });
});

describe("createGridHeightAt", () => {
  it("snaps to the nearest vertex and matches the bilinear read there", () => {
    const heights = new Float32Array(VERTICES_PER_ROW * VERTICES_PER_ROW);
    heights[gridIndex(10, 12)] = 7.5;
    const gridHeightAt = createGridHeightAt(heights);
    const x = -HALF_WORLD + 10 * TERRAIN_STEP;
    const z = -HALF_WORLD + 12 * TERRAIN_STEP;
    expect(gridHeightAt(x, z)).toBe(7.5);
    // A point slightly off-vertex snaps to the same vertex.
    expect(gridHeightAt(x + TERRAIN_STEP * 0.3, z)).toBe(7.5);
  });

  it("clamps out-of-range coordinates to the edge vertices", () => {
    const heights = new Float32Array(VERTICES_PER_ROW * VERTICES_PER_ROW);
    heights[gridIndex(0, 0)] = 3;
    const gridHeightAt = createGridHeightAt(heights);
    expect(gridHeightAt(-HALF_WORLD - 500, -HALF_WORLD - 500)).toBe(3);
  });
});

describe("createStarPositions", () => {
  it("is deterministic for a seeded source and sized count*3", () => {
    const first = createStarPositions(mulberry32(0x57a125), 10, 870);
    const second = createStarPositions(mulberry32(0x57a125), 10, 870);
    expect(first).toEqual(second);
    expect(first).toHaveLength(30);
  });

  it("places every star on the requested shell radius", () => {
    const positions = createStarPositions(mulberry32(7), 50, 1000);
    for (let index = 0; index < 50; index += 1) {
      const x = positions[index * 3]!;
      const y = positions[index * 3 + 1]!;
      const z = positions[index * 3 + 2]!;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1000, 3);
    }
  });
});

describe("deposit type coverage", () => {
  it("keeps deposit scales keyed to known deposit types only", () => {
    for (const id of PLANET_CLASS_IDS) {
      for (const key of Object.keys(
        PLANET_CLASSES[id].depositCountScale,
      )) {
        expect(DEPOSIT_TYPES).toContain(key);
      }
    }
  });
});
