import { describe, expect, it } from "vitest";

import { WALK_SPEED, mulberry32 } from "../js/config.ts";
import {
  FAUNA_SPECIES,
  FAUNA_WORLD_CHANCE,
  PET_FOLLOW_SPEED,
  computePetCompass,
  createPetEntity,
  findPetEntity,
  formatPetDistance,
  parsePetEntityData,
  parsePetPose,
  pickRandomFaunaSpecies,
  planFauna,
  stepFollow,
  upsertPetEntity,
} from "../js/fauna/index.ts";
import {
  createEmptyPlanetDocument,
  parsePlanetDocument,
  sealPlanetDocument,
} from "../js/planet-save.ts";

describe("planFauna", () => {
  it("is deterministic for a seed", () => {
    const heightAt = () => 4;
    const first = planFauna({
      seed: 0xc0ffee,
      heightAt,
      spawnX: 0,
      spawnZ: 0,
      hasLiquid: false,
      waterLevel: 0,
    });
    const second = planFauna({
      seed: 0xc0ffee,
      heightAt,
      spawnX: 0,
      spawnZ: 0,
      hasLiquid: false,
      waterLevel: 0,
    });
    expect(first).toEqual(second);
  });

  it("uses only known walker species when fauna is present", () => {
    const heightAt = () => 4;
    let found = false;
    for (let seed = 0; seed < 2000; seed += 1) {
      const plan = planFauna({
        seed,
        heightAt,
        spawnX: 0,
        spawnZ: 0,
        hasLiquid: true,
        waterLevel: 1,
      });
      if (!plan.hasFauna) continue;
      found = true;
      expect(plan.spawns.length).toBeGreaterThan(0);
      expect(plan.spawns.length).toBeLessThanOrEqual(3);
      for (const spawn of plan.spawns) {
        expect(FAUNA_SPECIES).toContain(spawn.species);
        expect(spawn.id).toMatch(/^fauna-\d+$/);
      }
    }
    expect(found).toBe(true);
  });

  it("marks roughly FAUNA_WORLD_CHANCE of seeds", () => {
    const heightAt = () => 4;
    let withFauna = 0;
    const samples = 4000;
    for (let seed = 0; seed < samples; seed += 1) {
      const plan = planFauna({
        seed,
        heightAt,
        spawnX: 0,
        spawnZ: 0,
        hasLiquid: false,
        waterLevel: 0,
      });
      if (plan.hasFauna) withFauna += 1;
    }
    const ratio = withFauna / samples;
    expect(ratio).toBeGreaterThan(FAUNA_WORLD_CHANCE - 0.05);
    expect(ratio).toBeLessThan(FAUNA_WORLD_CHANCE + 0.05);
  });
});

describe("stepFollow", () => {
  it("keeps a fixed pace slower than the player walk speed", () => {
    expect(PET_FOLLOW_SPEED).toBeLessThan(WALK_SPEED);
    expect(PET_FOLLOW_SPEED).toBeGreaterThan(WALK_SPEED * 0.5);
  });

  it("never teleports, even across huge gaps it only advances one step", () => {
    const deltaTime = 1 / 60;
    const result = stepFollow({
      pose: { x: 0, z: 0, yaw: 0 },
      targetX: 0,
      targetZ: 400,
      deltaTime,
    });
    expect(result.moving).toBe(true);
    expect(result.pose.z).toBeCloseTo(PET_FOLLOW_SPEED * deltaTime, 5);
    expect(result.pose.z).toBeLessThan(5);
  });

  it("moves toward the player when beyond the stop distance", () => {
    const result = stepFollow({
      pose: { x: 0, z: 0, yaw: 0 },
      targetX: 0,
      targetZ: 12,
      deltaTime: 0.25,
    });
    expect(result.moving).toBe(true);
    expect(result.pose.z).toBeGreaterThan(0);
    expect(result.pose.z).toBeLessThan(12);
  });

  it("idles inside the stop distance without sliding onto the player", () => {
    const result = stepFollow({
      pose: { x: 0, z: 1, yaw: 0 },
      targetX: 0,
      targetZ: 0,
      deltaTime: 0.25,
    });
    expect(result.moving).toBe(false);
    expect(result.pose.x).toBe(0);
    expect(result.pose.z).toBe(1);
  });
});

describe("computePetCompass", () => {
  it("reports distance and bearing relative to look yaw", () => {
    const ahead = computePetCompass({
      playerX: 0,
      playerZ: 0,
      playerYaw: 0,
      petX: 0,
      petZ: 40,
      label: "CRAB",
    });
    expect(ahead.distance).toBeCloseTo(40, 5);
    expect(ahead.bearing).toBeCloseTo(0, 5);

    const right = computePetCompass({
      playerX: 0,
      playerZ: 0,
      playerYaw: 0,
      petX: 25,
      petZ: 0,
      label: "CRAB",
    });
    expect(right.bearing).toBeCloseTo(Math.PI / 2, 5);

    const behindWhenFacingEast = computePetCompass({
      playerX: 0,
      playerZ: 0,
      playerYaw: Math.PI / 2,
      petX: -10,
      petZ: 0,
      label: "CRAB",
    });
    expect(behindWhenFacingEast.bearing).toBeCloseTo(Math.PI, 5);
  });

  it("formats short and long ranges", () => {
    expect(formatPetDistance(3.2)).toBe("3.2 m");
    expect(formatPetDistance(42.6)).toBe("43 m");
  });
});

describe("pet entity save", () => {
  it("round-trips a pet through seal/parse", () => {
    const document = createEmptyPlanetDocument("00ABCDEF");
    const entity = createPetEntity({
      species: "crab",
      x: 1,
      y: 2,
      z: 3,
      yaw: 0.5,
      sourceSpawnId: "fauna-0",
    });
    upsertPetEntity(document, entity);
    const sealed = sealPlanetDocument(document);
    const parsed = parsePlanetDocument(sealed);
    expect(parsed).not.toBeNull();
    const pet = findPetEntity(parsed!);
    expect(pet).not.toBeNull();
    expect(parsePetEntityData(pet!)).toEqual({
      species: "crab",
      sourceSpawnId: "fauna-0",
    });
    expect(parsePetPose(pet!)).toEqual({ x: 1, z: 3, yaw: 0.5 });
  });

  it("parsePetPose rejects invalid coordinates", () => {
    expect(
      parsePetPose({
        id: "pet",
        kind: "pet",
        x: Number.NaN,
        y: 0,
        z: 1,
        yaw: 0,
        data: { species: "crab" },
      }),
    ).toBeNull();
    expect(
      parsePetPose({
        id: "player",
        kind: "player",
        x: 1,
        y: 0,
        z: 1,
        yaw: 0,
      }),
    ).toBeNull();
  });

  it("replaces an existing pet entity", () => {
    const document = createEmptyPlanetDocument("00000001");
    upsertPetEntity(
      document,
      createPetEntity({
        species: "deer",
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
      }),
    );
    upsertPetEntity(
      document,
      createPetEntity({
        species: "panda",
        x: 2,
        y: 0,
        z: 2,
        yaw: 1,
        sourceSpawnId: "fauna-1",
      }),
    );
    expect(document.entities).toHaveLength(1);
    expect(parsePetEntityData(document.entities[0]!)?.species).toBe("panda");
    expect(parsePetPose(document.entities[0]!)).toEqual({
      x: 2,
      z: 2,
      yaw: 1,
    });
  });
});

describe("pickRandomFaunaSpecies", () => {
  it("returns only known species across the unit interval", () => {
    for (let step = 0; step < FAUNA_SPECIES.length; step += 1) {
      const species = pickRandomFaunaSpecies(
        () => (step + 0.5) / FAUNA_SPECIES.length,
      );
      expect(FAUNA_SPECIES).toContain(species);
    }
    expect(pickRandomFaunaSpecies(() => 0)).toBe(FAUNA_SPECIES[0]);
    expect(pickRandomFaunaSpecies(() => 0.9999)).toBe(
      FAUNA_SPECIES[FAUNA_SPECIES.length - 1],
    );
  });
});

describe("mulberry fauna stream isolation smoke", () => {
  it("keeps a dedicated stream stable", () => {
    const a = mulberry32(0xabc ^ 0xcafef00d)();
    const b = mulberry32(0xabc ^ 0xcafef00d)();
    expect(a).toBe(b);
  });
});
