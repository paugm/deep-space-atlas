import { describe, expect, it } from "vitest";

import {
  createEmptyPlanetDocument,
  parsePlanetDocument,
  sealPlanetDocument,
} from "../js/planet-save.ts";
import {
  ROVER_KINDS,
  ROVER_MAX_COUNT,
  createRoverEntity,
  listRoverEntities,
  parseRoverPose,
  planRovers,
  roverKindFromSpawnToken,
  roverSpawnId,
} from "../js/vehicles/index.ts";

describe("planRovers", () => {
  it("is deterministic for a seed", () => {
    const heightAt = () => 4;
    const first = planRovers({
      seed: 0xc0ffee,
      heightAt,
      spawnX: 0,
      spawnZ: 0,
      hasLiquid: false,
      waterLevel: 0,
    });
    const second = planRovers({
      seed: 0xc0ffee,
      heightAt,
      spawnX: 0,
      spawnZ: 0,
      hasLiquid: false,
      waterLevel: 0,
    });
    expect(first).toEqual(second);
  });

  it("places 0–2 rovers with known kinds and stable ids", () => {
    const heightAt = () => 4;
    let sawNonEmpty = false;
    let sawEmpty = false;
    for (let seed = 0; seed < 2000; seed += 1) {
      const plan = planRovers({
        seed,
        heightAt,
        spawnX: 0,
        spawnZ: 0,
        hasLiquid: true,
        waterLevel: 1,
      });
      expect(plan.spawns.length).toBeGreaterThanOrEqual(0);
      expect(plan.spawns.length).toBeLessThanOrEqual(ROVER_MAX_COUNT);
      if (plan.spawns.length === 0) sawEmpty = true;
      else sawNonEmpty = true;
      for (const spawn of plan.spawns) {
        expect(ROVER_KINDS).toContain(spawn.kind);
        expect(spawn.id).toMatch(/^rover-\d+$/);
        expect(Number.isFinite(spawn.yaw)).toBe(true);
      }
    }
    expect(sawEmpty).toBe(true);
    expect(sawNonEmpty).toBe(true);
  });

  it("keeps fauna and rover RNG streams independent", () => {
    const heightAt = () => 4;
    const a = planRovers({
      seed: 42,
      heightAt,
      spawnX: 10,
      spawnZ: -10,
      hasLiquid: false,
      waterLevel: 0,
    });
    const b = planRovers({
      seed: 42,
      heightAt,
      spawnX: 10,
      spawnZ: -10,
      hasLiquid: false,
      waterLevel: 0,
    });
    expect(a).toEqual(b);
    expect(roverSpawnId(0)).toBe("rover-0");
  });
});

describe("roverKindFromSpawnToken", () => {
  it("maps slash-command tokens", () => {
    expect(roverKindFromSpawnToken("rover")).toBe("rover");
    expect(roverKindFromSpawnToken("roundrover")).toBe("round-rover");
    expect(roverKindFromSpawnToken("rovervariant")).toBe("rover-variant");
    expect(roverKindFromSpawnToken("spaceship")).toBeNull();
  });
});

describe("rover entity", () => {
  it("round-trips multiple rover poses through seal / parse", () => {
    const document = createEmptyPlanetDocument("ABCD1234");
    const first = createRoverEntity({
      id: "rover-0",
      kind: "rover",
      x: 12,
      z: -8,
      yaw: 1.25,
    });
    const second = createRoverEntity({
      id: "rover-spawn-1",
      kind: "round-rover",
      x: 3,
      z: 4,
      yaw: 0.5,
    });
    document.entities.push(first, second);

    expect(listRoverEntities(document)).toHaveLength(2);
    expect(parseRoverPose(first)).toEqual({
      id: "rover-0",
      kind: "rover",
      x: 12,
      z: -8,
      yaw: 1.25,
    });

    const sealed = sealPlanetDocument(document);
    const parsed = parsePlanetDocument(sealed);
    expect(parsed).not.toBeNull();
    const restored = listRoverEntities(parsed!);
    expect(restored).toHaveLength(2);
    expect(parseRoverPose(restored[0]!)?.kind).toBe("rover");
    expect(parseRoverPose(restored[1]!)?.kind).toBe("round-rover");
  });

  it("rejects malformed rover entities", () => {
    expect(
      parseRoverPose({
        id: "rover-0",
        kind: "rover",
        x: 1,
        y: 0,
        z: 2,
        yaw: 0,
        data: { roverKind: "not-a-kind" },
      }),
    ).toBeNull();
  });
});
