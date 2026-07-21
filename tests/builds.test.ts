import { describe, expect, it } from "vitest";

import {
  BUILD_DEFINITIONS,
  BUILD_ORDER,
  baseBuildModifiers,
  buildDefinitionFromToken,
  canAffordBuild,
  formatBuildCost,
  isBuildId,
  missingPrerequisites,
  resolveBuildModifiers,
  tryBuild,
} from "../js/builds.ts";
import { createEmptyInventory } from "../js/player-profile.ts";
import {
  CAVE_DIG_LENGTH,
  CAVE_DIG_RADIUS,
  JET_BURN_SECONDS,
  JUMP_VELOCITY,
  MINING_RANGE,
  MINING_TIME,
  ROVER_DRIVE_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
  WATER_MOVE_FACTOR,
  WATER_VERTICAL_DRAG,
} from "../js/config.ts";

describe("build catalog", () => {
  it("lists every definition exactly once in BUILD_ORDER", () => {
    expect(new Set(BUILD_ORDER).size).toBe(BUILD_ORDER.length);
    for (const id of BUILD_ORDER) {
      expect(BUILD_DEFINITIONS[id].id).toBe(id);
      expect(BUILD_DEFINITIONS[id].token).toBe(id);
    }
    expect(Object.keys(BUILD_DEFINITIONS).sort()).toEqual(
      [...BUILD_ORDER].sort(),
    );
  });

  it("resolves tokens case-insensitively", () => {
    expect(buildDefinitionFromToken("Focus-Lens-I")?.id).toBe("focus-lens-i");
    expect(buildDefinitionFromToken("nope")).toBeNull();
    expect(isBuildId("thruster-coil-i")).toBe(true);
    expect(isBuildId("thruster")).toBe(false);
  });
});

describe("tryBuild", () => {
  it("spends cargo and installs when affordable", () => {
    const inventory = createEmptyInventory();
    inventory.silicate = 40;
    inventory.iron = 20;
    inventory.carbon = 8;
    const result = tryBuild("thruster-coil-i", inventory, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.builds).toEqual(["thruster-coil-i"]);
    expect(result.inventory.silicate).toBe(0);
    expect(result.inventory.iron).toBe(0);
    expect(result.inventory.carbon).toBe(0);
  });

  it("rejects missing cargo, duplicates, and prerequisites", () => {
    const inventory = createEmptyInventory();
    expect(tryBuild("thruster-coil-i", inventory, [])).toEqual({
      ok: false,
      reason: "cannot-afford",
    });
    inventory.silicate = 500;
    inventory.iron = 500;
    inventory.carbon = 500;
    inventory.copper = 500;
    expect(tryBuild("thruster-coil-ii", inventory, [])).toEqual({
      ok: false,
      reason: "missing-prerequisite",
    });
    expect(
      tryBuild("thruster-coil-i", inventory, ["thruster-coil-i"]),
    ).toEqual({
      ok: false,
      reason: "already-owned",
    });
    expect(tryBuild("nope", inventory, [])).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("free installs skip cost and prerequisites", () => {
    const inventory = createEmptyInventory();
    inventory.iron = 3;
    const result = tryBuild("thruster-coil-ii", inventory, [], {
      free: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.builds).toEqual(["thruster-coil-ii"]);
    expect(result.inventory.iron).toBe(3);
  });
});

describe("resolveBuildModifiers", () => {
  it("returns base values with no builds", () => {
    expect(resolveBuildModifiers([])).toEqual(baseBuildModifiers());
  });

  it("stacks jetpack and extractor effects", () => {
    const modifiers = resolveBuildModifiers([
      "thruster-coil-i",
      "thruster-coil-ii",
      "focus-lens-i",
      "bore-widener-i",
      "resonance-tip",
      "long-arm-emitter",
    ]);
    expect(modifiers.jetBurnSeconds).toBeCloseTo(
      JET_BURN_SECONDS * 1.25 * 1.28,
    );
    expect(modifiers.jetMaxVerticalSpeed).toBe(
      baseBuildModifiers().jetMaxVerticalSpeed + 2,
    );
    expect(modifiers.miningTime).toBeCloseTo(MINING_TIME * 0.69);
    expect(modifiers.miningRange).toBe(MINING_RANGE + 7);
    expect(modifiers.digRadius).toBeCloseTo(CAVE_DIG_RADIUS * 1.15);
    expect(modifiers.digLength).toBeCloseTo(CAVE_DIG_LENGTH * 1.15);
    expect(modifiers.depositYieldBonus).toBe(1);
  });

  it("stacks mobility and rover effects", () => {
    const modifiers = resolveBuildModifiers([
      "servo-boots",
      "hydro-seal-suit",
      "mass-dampers",
      "drive-kit-i",
    ]);
    expect(modifiers.walkSpeed).toBeCloseTo(WALK_SPEED * 1.12);
    expect(modifiers.sprintSpeed).toBeCloseTo(SPRINT_SPEED * 1.12);
    expect(modifiers.jumpVelocity).toBeCloseTo(JUMP_VELOCITY * 1.15);
    expect(modifiers.waterMoveFactor).toBeCloseTo(WATER_MOVE_FACTOR * 1.35);
    expect(modifiers.waterVerticalDrag).toBeCloseTo(
      WATER_VERTICAL_DRAG * 0.7,
    );
    expect(modifiers.roverDriveSpeed).toBeCloseTo(ROVER_DRIVE_SPEED * 1.24);
  });
});

describe("build helpers", () => {
  it("formats costs and prerequisite gaps", () => {
    const cost = BUILD_DEFINITIONS["focus-lens-i"].cost;
    expect(formatBuildCost(cost)).toContain("Silicate");
    expect(canAffordBuild(cost, createEmptyInventory())).toBe(false);
    expect(
      missingPrerequisites(BUILD_DEFINITIONS["focus-lens-ii"], []),
    ).toEqual(["focus-lens-i"]);
  });
});
