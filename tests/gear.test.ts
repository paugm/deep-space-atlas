import { describe, expect, it } from "vitest";

import {
  GEAR_DEFINITIONS,
  GEAR_ORDER,
  baseGearModifiers,
  canAffordCost,
  formatCargoCost,
  gearDefinitionFromToken,
  isGearId,
  missingPrerequisites,
  resolveGearModifiers,
  tryInstallGear,
} from "../js/gear.ts";
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

describe("gear catalog", () => {
  it("lists every definition exactly once in GEAR_ORDER", () => {
    expect(new Set(GEAR_ORDER).size).toBe(GEAR_ORDER.length);
    for (const id of GEAR_ORDER) {
      expect(GEAR_DEFINITIONS[id].id).toBe(id);
      expect(GEAR_DEFINITIONS[id].token).toBe(id);
    }
    expect(Object.keys(GEAR_DEFINITIONS).sort()).toEqual(
      [...GEAR_ORDER].sort(),
    );
  });

  it("resolves tokens case-insensitively", () => {
    expect(gearDefinitionFromToken("Focus-Lens-I")?.id).toBe("focus-lens-i");
    expect(gearDefinitionFromToken("nope")).toBeNull();
    expect(isGearId("thruster-coil-i")).toBe(true);
    expect(isGearId("thruster")).toBe(false);
  });
});

describe("tryInstallGear", () => {
  it("spends cargo and installs when affordable", () => {
    const inventory = createEmptyInventory();
    inventory.silicate = 40;
    inventory.iron = 20;
    inventory.carbon = 8;
    const result = tryInstallGear("thruster-coil-i", inventory, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gear).toEqual(["thruster-coil-i"]);
    expect(result.inventory.silicate).toBe(0);
    expect(result.inventory.iron).toBe(0);
    expect(result.inventory.carbon).toBe(0);
  });

  it("rejects missing cargo, duplicates, and prerequisites", () => {
    const inventory = createEmptyInventory();
    expect(tryInstallGear("thruster-coil-i", inventory, [])).toEqual({
      ok: false,
      reason: "cannot-afford",
    });
    inventory.silicate = 500;
    inventory.iron = 500;
    inventory.carbon = 500;
    inventory.copper = 500;
    expect(tryInstallGear("thruster-coil-ii", inventory, [])).toEqual({
      ok: false,
      reason: "missing-prerequisite",
    });
    expect(
      tryInstallGear("thruster-coil-i", inventory, ["thruster-coil-i"]),
    ).toEqual({
      ok: false,
      reason: "already-owned",
    });
    expect(tryInstallGear("nope", inventory, [])).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("free install skips cost and prerequisites", () => {
    const inventory = createEmptyInventory();
    const result = tryInstallGear("thruster-coil-ii", inventory, [], {
      free: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gear).toEqual(["thruster-coil-ii"]);
    expect(result.inventory).toEqual(inventory);
  });
});

describe("resolveGearModifiers", () => {
  it("returns base values with no gear", () => {
    expect(resolveGearModifiers([])).toEqual(baseGearModifiers());
  });

  it("stacks jetpack and dig modifiers", () => {
    const modifiers = resolveGearModifiers([
      "thruster-coil-i",
      "thruster-coil-ii",
      "bore-widener-i",
    ]);
    expect(modifiers.jetBurnSeconds).toBeCloseTo(
      JET_BURN_SECONDS * 1.25 * 1.28,
    );
    expect(modifiers.jetMaxVerticalSpeed).toBe(
      baseGearModifiers().jetMaxVerticalSpeed + 2,
    );
    expect(modifiers.digRadius).toBeCloseTo(CAVE_DIG_RADIUS * 1.15);
    expect(modifiers.digLength).toBeCloseTo(CAVE_DIG_LENGTH * 1.15);
  });

  it("applies mobility and rover modifiers", () => {
    const modifiers = resolveGearModifiers([
      "servo-boots",
      "mass-dampers",
      "hydro-seal-suit",
      "drive-kit-i",
      "focus-lens-i",
      "long-arm-emitter",
      "resonance-tip",
    ]);
    expect(modifiers.walkSpeed).toBeCloseTo(WALK_SPEED * 1.12);
    expect(modifiers.sprintSpeed).toBeCloseTo(SPRINT_SPEED * 1.12);
    expect(modifiers.jumpVelocity).toBeCloseTo(JUMP_VELOCITY * 1.15);
    expect(modifiers.waterMoveFactor).toBeCloseTo(WATER_MOVE_FACTOR * 1.35);
    expect(modifiers.waterVerticalDrag).toBeCloseTo(WATER_VERTICAL_DRAG * 0.7);
    expect(modifiers.roverDriveSpeed).toBeCloseTo(ROVER_DRIVE_SPEED * 1.24);
    expect(modifiers.miningTime).toBeCloseTo(MINING_TIME * 0.69);
    expect(modifiers.miningRange).toBe(MINING_RANGE + 7);
    expect(modifiers.depositYieldBonus).toBe(1);
  });
});

describe("gear helpers", () => {
  it("formats costs and checks affordability", () => {
    const cost = { silicate: 10, iron: 2 };
    expect(formatCargoCost(cost)).toContain("Silicate");
    expect(canAffordCost(cost, createEmptyInventory())).toBe(false);
    expect(missingPrerequisites(GEAR_DEFINITIONS["thruster-coil-ii"], [])).toEqual(
      ["thruster-coil-i"],
    );
  });
});
