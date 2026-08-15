import { describe, expect, it } from "vitest";

import { EYE_HEIGHT, PLAYER_RADIUS } from "../js/config.ts";
import {
  BLUEPRINT_DEFINITIONS,
  BLUEPRINT_ORDER,
  addCost,
  blueprintDefinitionFromToken,
  isBlueprintId,
  salvageRefund,
  tryFabricate,
} from "../js/blueprints.ts";
import { createEmptyInventory } from "../js/player-profile.ts";
import {
  placementPointAhead,
  validateStructurePlacement,
} from "../js/structures/placement.ts";
import {
  resolveCapsuleAgainstShelter,
  sampleShelterGround,
  shelterFloorSupport,
  shelterLayoutFor,
} from "../js/structures/shelter.ts";

describe("blueprint catalog", () => {
  it("lists every definition exactly once in BLUEPRINT_ORDER", () => {
    expect(new Set(BLUEPRINT_ORDER).size).toBe(BLUEPRINT_ORDER.length);
    for (const id of BLUEPRINT_ORDER) {
      expect(BLUEPRINT_DEFINITIONS[id].id).toBe(id);
      expect(BLUEPRINT_DEFINITIONS[id].token).toBe(id);
    }
    expect(Object.keys(BLUEPRINT_DEFINITIONS).sort()).toEqual(
      [...BLUEPRINT_ORDER].sort(),
    );
  });

  it("resolves tokens case-insensitively", () => {
    expect(blueprintDefinitionFromToken("Planet-Base")?.id).toBe("planet-base");
    expect(blueprintDefinitionFromToken("Tent")?.id).toBe("tent");
    expect(blueprintDefinitionFromToken("nope")).toBeNull();
    expect(isBlueprintId("beacon")).toBe(true);
    expect(isBlueprintId("thruster-coil-i")).toBe(false);
  });
});

describe("tryFabricate", () => {
  it("spends cargo for a cheap tent", () => {
    const inventory = createEmptyInventory();
    inventory.silicate = 12;
    inventory.carbon = 18;
    inventory.iron = 4;
    const result = tryFabricate("tent", inventory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.id).toBe("tent");
    expect(result.inventory.silicate).toBe(0);
    expect(result.inventory.carbon).toBe(0);
    expect(result.inventory.iron).toBe(0);
  });

  it("rejects unknown blueprints and missing cargo", () => {
    const inventory = createEmptyInventory();
    expect(tryFabricate("nope", inventory)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(tryFabricate("planet-base", inventory)).toEqual({
      ok: false,
      reason: "cannot-afford",
    });
  });

  it("free fabricate skips cost", () => {
    const inventory = createEmptyInventory();
    const result = tryFabricate("planet-base", inventory, { free: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inventory).toEqual(inventory);
  });
});

describe("salvageRefund", () => {
  it("returns half of each line rounded down and skips ones", () => {
    expect(salvageRefund({ silicate: 25, iron: 15, copper: 8 })).toEqual({
      silicate: 12,
      iron: 7,
      copper: 4,
    });
    expect(salvageRefund({ silicate: 1, carbon: 2 })).toEqual({ carbon: 1 });
    expect(salvageRefund({ silicate: 1 })).toEqual({});
  });

  it("addCost restores a salvage refund onto cargo", () => {
    const inventory = createEmptyInventory();
    inventory.silicate = 3;
    const next = addCost({ silicate: 12, iron: 7 }, inventory);
    expect(next.silicate).toBe(15);
    expect(next.iron).toBe(7);
    expect(inventory.silicate).toBe(3);
  });
});

describe("validateStructurePlacement", () => {
  it("accepts a clear site", () => {
    expect(
      validateStructurePlacement({
        blueprintId: "tent",
        x: 0,
        z: 0,
        existing: [],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects limit, spacing, bounds, and unknown ids", () => {
    const definition = BLUEPRINT_DEFINITIONS.beacon;
    const existing = Array.from({ length: definition.maxPerPlanet }, (_, i) => ({
      blueprintId: "beacon" as const,
      x: i * definition.minSpacing,
      z: 0,
    }));
    expect(
      validateStructurePlacement({
        blueprintId: "beacon",
        x: definition.maxPerPlanet * definition.minSpacing,
        z: 0,
        existing,
      }),
    ).toEqual({ ok: false, reason: "at-limit" });

    expect(
      validateStructurePlacement({
        blueprintId: "beacon",
        x: 1,
        z: 0,
        existing: [{ blueprintId: "beacon", x: 0, z: 0 }],
      }),
    ).toEqual({ ok: false, reason: "too-close" });

    expect(
      validateStructurePlacement({
        blueprintId: "tent",
        x: 2,
        z: 0,
        existing: [{ blueprintId: "beacon", x: 0, z: 0 }],
      }),
    ).toEqual({ ok: false, reason: "too-close" });

    expect(
      validateStructurePlacement({
        blueprintId: "planet-base",
        x: 40,
        z: 0,
        existing: [{ blueprintId: "planet-base", x: 0, z: 0 }],
      }),
    ).toEqual({ ok: false, reason: "at-limit" });

    expect(
      validateStructurePlacement({
        blueprintId: "beacon",
        x: 10_000,
        z: 0,
        existing: [],
      }),
    ).toEqual({ ok: false, reason: "out-of-bounds" });

    expect(
      validateStructurePlacement({
        blueprintId: "nope",
        x: 0,
        z: 0,
        existing: [],
      }),
    ).toEqual({ ok: false, reason: "unknown-blueprint" });
  });

  it("places ahead of the commander along look yaw", () => {
    const point = placementPointAhead({ x: 0, z: 0, yaw: 0, meters: 2 });
    expect(point.x).toBeCloseTo(0);
    expect(point.z).toBeCloseTo(-2);
  });
});

describe("walk-in shelter collision", () => {
  const layout = shelterLayoutFor("tent");
  if (layout === null) {
    throw new Error("expected tent layout");
  }
  const origin = { x: 10, y: 5, z: -4, yaw: Math.PI / 4 };
  const eyeHeight = EYE_HEIGHT;

  it("keeps every shelter doorway passable for the player capsule", () => {
    expect(shelterLayoutFor("beacon")).toBeNull();
    for (const id of ["tent", "planet-base"] as const) {
      const shelter = shelterLayoutFor(id);
      expect(shelter).not.toBeNull();
      if (shelter === null) continue;
      // Wide and tall enough for the capsule (top of capsule = eye height).
      expect(shelter.doorWidth).toBeGreaterThan(PLAYER_RADIUS * 2 + 0.2);
      expect(shelter.doorHeight).toBeGreaterThanOrEqual(EYE_HEIGHT + 0.1);
      expect(shelter.wallHeight).toBeGreaterThan(shelter.doorHeight);
      // Shell is closed: a ceiling wall spans the full footprint.
      const ceiling = shelter.walls.find(
        (wall) => wall.minY >= shelter.wallHeight,
      );
      expect(ceiling).toBeDefined();
    }
  });

  it("lets the capsule pass through the door opening", () => {
    // Door is on +Z local; at yaw=π/4, local +Z is world (sin, cos).
    const dirX = Math.sin(origin.yaw);
    const dirZ = Math.cos(origin.yaw);
    const outside = resolveCapsuleAgainstShelter(
      {
        x: origin.x + dirX * (layout.halfDepth + PLAYER_RADIUS + 0.2),
        y: origin.y + eyeHeight,
        z: origin.z + dirZ * (layout.halfDepth + PLAYER_RADIUS + 0.2),
        radius: PLAYER_RADIUS,
        eyeHeight,
      },
      origin,
      layout,
    );
    // Standing exactly in the doorway plane, feet on the floor.
    const inDoor = resolveCapsuleAgainstShelter(
      {
        x: origin.x + dirX * (layout.halfDepth - layout.wallThickness * 0.5),
        y: origin.y + eyeHeight,
        z: origin.z + dirZ * (layout.halfDepth - layout.wallThickness * 0.5),
        radius: PLAYER_RADIUS,
        eyeHeight,
      },
      origin,
      layout,
    );
    expect(outside.correctionX).toBeCloseTo(0);
    expect(outside.correctionZ).toBeCloseTo(0);
    expect(inDoor.correctionX).toBeCloseTo(0);
    expect(inDoor.correctionY).toBeCloseTo(0);
    expect(inDoor.correctionZ).toBeCloseTo(0);
  });

  it("blocks the capsule through a solid wall", () => {
    // Local −Z is the back wall.
    const intoWall = {
      x: origin.x - Math.sin(origin.yaw) * (layout.halfDepth - 0.02),
      y: origin.y + eyeHeight,
      z: origin.z - Math.cos(origin.yaw) * (layout.halfDepth - 0.02),
      radius: PLAYER_RADIUS,
      eyeHeight,
    };
    const resolved = resolveCapsuleAgainstShelter(intoWall, origin, layout);
    expect(
      Math.hypot(resolved.correctionX, resolved.correctionZ),
    ).toBeGreaterThan(0.05);
  });

  it("blocks the capsule on interior furniture in the planet base", () => {
    const base = shelterLayoutFor("planet-base");
    expect(base).not.toBeNull();
    if (base === null) return;
    const bunk = base.furniture[0];
    expect(bunk).toBeDefined();
    if (bunk === undefined) return;
    // Straight-on placement (yaw 0): local coords equal world offsets.
    const flat = { x: 0, y: 0, z: 0, yaw: 0 };
    const ontoBunk = resolveCapsuleAgainstShelter(
      {
        x: (bunk.minX + bunk.maxX) * 0.5,
        y: eyeHeight, // feet at floor level, capsule overlapping the bunk
        z: (bunk.minZ + bunk.maxZ) * 0.5,
        radius: PLAYER_RADIUS,
        eyeHeight,
      },
      flat,
      base,
    );
    const pushed = Math.hypot(
      ontoBunk.correctionX,
      ontoBunk.correctionY,
      ontoBunk.correctionZ,
    );
    expect(pushed).toBeGreaterThan(0.05);
  });

  it("supports the floor inside, the porch at the door, and nothing beyond", () => {
    const support = (x: number, z: number): number | null =>
      shelterFloorSupport({
        x,
        z,
        originX: origin.x,
        originY: origin.y,
        originZ: origin.z,
        yaw: origin.yaw,
        layout,
      });

    // Center of the room.
    expect(support(origin.x, origin.z)).toBe(origin.y);

    // Porch pad just outside the door (+Z local → world (sin, cos)).
    const porch = layout.halfDepth + layout.porchDepth * 0.5;
    expect(
      support(
        origin.x + Math.sin(origin.yaw) * porch,
        origin.z + Math.cos(origin.yaw) * porch,
      ),
    ).toBe(origin.y);

    // Same distance on the back side has no porch.
    expect(
      support(
        origin.x - Math.sin(origin.yaw) * porch,
        origin.z - Math.cos(origin.yaw) * porch,
      ),
    ).toBeNull();

    // Far away.
    expect(support(origin.x + 20, origin.z)).toBeNull();
  });
});

describe("shelter terrain sampling", () => {
  const layout = shelterLayoutFor("planet-base");
  if (layout === null) {
    throw new Error("expected planet-base layout");
  }

  it("sets the floor on the highest footprint sample and reports the drop", () => {
    // Terrain rises 0.2 per meter along X.
    const ground = sampleShelterGround({
      heightAt: (x) => x * 0.2,
      originX: 10,
      originZ: 0,
      yaw: 0,
      layout,
    });
    expect(ground.floorY).toBeCloseTo((10 + layout.halfWidth) * 0.2);
    expect(ground.drop).toBeCloseTo(layout.halfWidth * 2 * 0.2);
  });

  it("rotates the footprint with yaw before sampling", () => {
    // Slope along X only; at yaw=π/2 the local X axis maps to world −Z,
    // so the world-X spread comes from local Z (same square: same drop).
    const flatAcross = sampleShelterGround({
      heightAt: (_x, z) => z * 0.5,
      originX: 0,
      originZ: 0,
      yaw: Math.PI / 2,
      layout,
    });
    expect(flatAcross.drop).toBeCloseTo(layout.halfWidth * 2 * 0.5);
  });

  it("flat terrain has zero drop", () => {
    const ground = sampleShelterGround({
      heightAt: () => 7,
      originX: 0,
      originZ: 0,
      yaw: 1.3,
      layout,
    });
    expect(ground.floorY).toBe(7);
    expect(ground.drop).toBe(0);
  });
});
