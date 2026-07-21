/**
 * Fabricator catalog: buildable gear, costs, and stacked modifiers.
 * Pure — no DOM or Three.js. Installed ids live on the player profile.
 */

import type { Inventory, MaterialId } from "./config.ts";
import {
  CAVE_DIG_LENGTH,
  CAVE_DIG_RADIUS,
  JET_BURN_SECONDS,
  JET_MAX_VERTICAL_SPEED,
  JET_RECHARGE_SECONDS,
  JUMP_VELOCITY,
  MATERIAL_ORDER,
  MATERIALS,
  MINING_RANGE,
  MINING_TIME,
  ROVER_DRIVE_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
  WATER_MOVE_FACTOR,
  WATER_VERTICAL_DRAG,
} from "./config.ts";

function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const materialId of MATERIAL_ORDER) {
    inventory[materialId] = 0;
  }
  return inventory;
}

function cloneInventory(inventory: Inventory): Inventory {
  const next = createEmptyInventory();
  for (const materialId of MATERIAL_ORDER) {
    next[materialId] = inventory[materialId];
  }
  return next;
}

export type BuildId =
  | "thruster-coil-i"
  | "thruster-coil-ii"
  | "capacitor-lattice"
  | "aether-lift-core"
  | "focus-lens-i"
  | "focus-lens-ii"
  | "bore-widener-i"
  | "bore-widener-ii"
  | "resonance-tip"
  | "long-arm-emitter"
  | "servo-boots"
  | "hydro-seal-suit"
  | "mass-dampers"
  | "drive-kit-i";

export type BuildCategory = "jetpack" | "extractor" | "mobility" | "rover";

export type BuildCost = Partial<Record<MaterialId, number>>;

/**
 * Stacked modifiers. Multipliers multiply; additives sum. Dig scale multiplies
 * both radius and length from the base cave brush constants.
 */
export type BuildEffect =
  | { kind: "jetBurnMult"; value: number }
  | { kind: "jetRechargeMult"; value: number }
  | { kind: "jetMaxSpeedAdd"; value: number }
  | { kind: "miningTimeMult"; value: number }
  | { kind: "miningRangeAdd"; value: number }
  | { kind: "digScale"; value: number }
  | { kind: "depositYieldBonus"; value: number }
  | { kind: "footSpeedMult"; value: number }
  | { kind: "jumpMult"; value: number }
  | { kind: "waterMoveMult"; value: number }
  | { kind: "waterDragMult"; value: number }
  | { kind: "roverSpeedMult"; value: number };

export interface BuildDefinition {
  id: BuildId;
  /** Slash-command token; usually matches `id`. */
  token: string;
  label: string;
  blurb: string;
  category: BuildCategory;
  cost: BuildCost;
  effects: readonly BuildEffect[];
  /** Must already be installed before this recipe unlocks. */
  requires?: readonly BuildId[];
}

export interface BuildModifiers {
  jetBurnSeconds: number;
  jetRechargeSeconds: number;
  jetMaxVerticalSpeed: number;
  miningTime: number;
  miningRange: number;
  digRadius: number;
  digLength: number;
  depositYieldBonus: number;
  walkSpeed: number;
  sprintSpeed: number;
  jumpVelocity: number;
  waterMoveFactor: number;
  waterVerticalDrag: number;
  roverDriveSpeed: number;
}

export type TryBuildReason =
  | "unknown"
  | "already-owned"
  | "missing-prerequisite"
  | "cannot-afford";

export type TryBuildResult =
  | {
      ok: true;
      inventory: Inventory;
      builds: BuildId[];
      definition: BuildDefinition;
    }
  | { ok: false; reason: TryBuildReason };

export const BUILD_DEFINITIONS: Record<BuildId, BuildDefinition> = {
  "thruster-coil-i": {
    id: "thruster-coil-i",
    token: "thruster-coil-i",
    label: "Thruster Coil I",
    blurb: "Extends jetpack burn time (~+25%).",
    category: "jetpack",
    cost: { silicate: 40, iron: 20, carbon: 8 },
    effects: [{ kind: "jetBurnMult", value: 1.25 }],
  },
  "thruster-coil-ii": {
    id: "thruster-coil-ii",
    token: "thruster-coil-ii",
    label: "Thruster Coil II",
    blurb: "Much longer burn and a bit more climb speed.",
    category: "jetpack",
    cost: { silicate: 200, iron: 100, carbon: 40, copper: 15 },
    requires: ["thruster-coil-i"],
    effects: [
      { kind: "jetBurnMult", value: 1.28 },
      { kind: "jetMaxSpeedAdd", value: 2 },
    ],
  },
  "capacitor-lattice": {
    id: "capacitor-lattice",
    token: "capacitor-lattice",
    label: "Capacitor Lattice",
    blurb: "Faster jetpack recharge.",
    category: "jetpack",
    cost: { iron: 60, carbon: 30, copper: 20 },
    effects: [{ kind: "jetRechargeMult", value: 0.64 }],
  },
  "aether-lift-core": {
    id: "aether-lift-core",
    token: "aether-lift-core",
    label: "Aether Lift Core",
    blurb: "Higher max vertical jetpack speed.",
    category: "jetpack",
    cost: { copper: 80, crystal: 12 },
    effects: [{ kind: "jetMaxSpeedAdd", value: 4 }],
  },
  "focus-lens-i": {
    id: "focus-lens-i",
    token: "focus-lens-i",
    label: "Focus Lens I",
    blurb: "Shorter extractor cycle (~0.55 s).",
    category: "extractor",
    cost: { silicate: 30, iron: 25, copper: 10 },
    effects: [{ kind: "miningTimeMult", value: 0.69 }],
  },
  "focus-lens-ii": {
    id: "focus-lens-ii",
    token: "focus-lens-ii",
    label: "Focus Lens II",
    blurb: "Very fast extract plus a bit more range.",
    category: "extractor",
    cost: { silicate: 150, iron: 120, copper: 50, crystal: 8 },
    requires: ["focus-lens-i"],
    effects: [
      { kind: "miningTimeMult", value: 0.64 },
      { kind: "miningRangeAdd", value: 4 },
    ],
  },
  "bore-widener-i": {
    id: "bore-widener-i",
    token: "bore-widener-i",
    label: "Bore Widener I",
    blurb: "Larger cave dig bite (~+15%).",
    category: "extractor",
    cost: { silicate: 50, iron: 40, carbon: 20 },
    effects: [{ kind: "digScale", value: 1.15 }],
  },
  "bore-widener-ii": {
    id: "bore-widener-ii",
    token: "bore-widener-ii",
    label: "Bore Widener II",
    blurb: "Much larger tunnels (~+35% with I).",
    category: "extractor",
    cost: { silicate: 250, iron: 180, carbon: 80, copper: 25 },
    requires: ["bore-widener-i"],
    effects: [{ kind: "digScale", value: 1.17 }],
  },
  "resonance-tip": {
    id: "resonance-tip",
    token: "resonance-tip",
    label: "Resonance Tip",
    blurb: "Deposits yield +1 material per cycle.",
    category: "extractor",
    cost: { carbon: 40, copper: 30, crystal: 6 },
    effects: [{ kind: "depositYieldBonus", value: 1 }],
  },
  "long-arm-emitter": {
    id: "long-arm-emitter",
    token: "long-arm-emitter",
    label: "Long-Arm Emitter",
    blurb: "Longer extractor reach (~+7 m).",
    category: "extractor",
    cost: { iron: 70, copper: 40, crystal: 10 },
    effects: [{ kind: "miningRangeAdd", value: 7 }],
  },
  "servo-boots": {
    id: "servo-boots",
    token: "servo-boots",
    label: "Servo Boots",
    blurb: "Faster walk and sprint (~+12%).",
    category: "mobility",
    cost: { silicate: 40, iron: 30, carbon: 15 },
    effects: [{ kind: "footSpeedMult", value: 1.12 }],
  },
  "hydro-seal-suit": {
    id: "hydro-seal-suit",
    token: "hydro-seal-suit",
    label: "Hydro Seal Suit",
    blurb: "Less swim slowdown and underwater drag.",
    category: "mobility",
    cost: { carbon: 50, copper: 25, iron: 10 },
    effects: [
      { kind: "waterMoveMult", value: 1.35 },
      { kind: "waterDragMult", value: 0.7 },
    ],
  },
  "mass-dampers": {
    id: "mass-dampers",
    token: "mass-dampers",
    label: "Mass Dampers",
    blurb: "Slightly higher jump.",
    category: "mobility",
    cost: { iron: 35, copper: 20 },
    effects: [{ kind: "jumpMult", value: 1.15 }],
  },
  "drive-kit-i": {
    id: "drive-kit-i",
    token: "drive-kit-i",
    label: "Drive Kit I",
    blurb: "Faster wheeled rover top speed (~+24%).",
    category: "rover",
    cost: { iron: 60, silicate: 40, copper: 20 },
    effects: [{ kind: "roverSpeedMult", value: 1.24 }],
  },
};

/** Catalog order for menus and docs. */
export const BUILD_ORDER: readonly BuildId[] = [
  "thruster-coil-i",
  "thruster-coil-ii",
  "capacitor-lattice",
  "aether-lift-core",
  "focus-lens-i",
  "focus-lens-ii",
  "bore-widener-i",
  "bore-widener-ii",
  "resonance-tip",
  "long-arm-emitter",
  "servo-boots",
  "hydro-seal-suit",
  "mass-dampers",
  "drive-kit-i",
];

const BUILD_ID_SET = new Set<string>(BUILD_ORDER);

export function isBuildId(value: unknown): value is BuildId {
  return typeof value === "string" && BUILD_ID_SET.has(value);
}

export function buildDefinitionFromToken(
  token: string,
): BuildDefinition | null {
  const normalized = token.trim().toLowerCase();
  if (normalized.length === 0) return null;
  for (const id of BUILD_ORDER) {
    const definition = BUILD_DEFINITIONS[id];
    if (definition.token === normalized || definition.id === normalized) {
      return definition;
    }
  }
  return null;
}

export function cloneBuilds(builds: readonly BuildId[]): BuildId[] {
  const next: BuildId[] = [];
  const seen = new Set<BuildId>();
  for (const id of builds) {
    if (!isBuildId(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function hasBuild(
  builds: readonly BuildId[],
  buildId: BuildId,
): boolean {
  return builds.includes(buildId);
}

export function missingPrerequisites(
  definition: BuildDefinition,
  owned: readonly BuildId[],
): BuildId[] {
  if (definition.requires === undefined) return [];
  return definition.requires.filter((id) => !owned.includes(id));
}

export function canAffordBuild(
  cost: BuildCost,
  inventory: Inventory,
): boolean {
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    if (inventory[materialId] < amount) return false;
  }
  return true;
}

export function deductBuildCost(
  cost: BuildCost,
  inventory: Inventory,
): Inventory {
  const next = cloneInventory(inventory);
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    next[materialId] -= amount;
  }
  return next;
}

export function baseBuildModifiers(): BuildModifiers {
  return {
    jetBurnSeconds: JET_BURN_SECONDS,
    jetRechargeSeconds: JET_RECHARGE_SECONDS,
    jetMaxVerticalSpeed: JET_MAX_VERTICAL_SPEED,
    miningTime: MINING_TIME,
    miningRange: MINING_RANGE,
    digRadius: CAVE_DIG_RADIUS,
    digLength: CAVE_DIG_LENGTH,
    depositYieldBonus: 0,
    walkSpeed: WALK_SPEED,
    sprintSpeed: SPRINT_SPEED,
    jumpVelocity: JUMP_VELOCITY,
    waterMoveFactor: WATER_MOVE_FACTOR,
    waterVerticalDrag: WATER_VERTICAL_DRAG,
    roverDriveSpeed: ROVER_DRIVE_SPEED,
  };
}

/** Resolve stacked modifiers from installed builds (unknown ids ignored). */
export function resolveBuildModifiers(
  builds: readonly BuildId[],
): BuildModifiers {
  const modifiers = baseBuildModifiers();
  let jetBurnMult = 1;
  let jetRechargeMult = 1;
  let miningTimeMult = 1;
  let digScale = 1;
  let footSpeedMult = 1;
  let jumpMult = 1;
  let waterMoveMult = 1;
  let waterDragMult = 1;
  let roverSpeedMult = 1;

  for (const id of builds) {
    if (!isBuildId(id)) continue;
    for (const effect of BUILD_DEFINITIONS[id].effects) {
      switch (effect.kind) {
        case "jetBurnMult":
          jetBurnMult *= effect.value;
          break;
        case "jetRechargeMult":
          jetRechargeMult *= effect.value;
          break;
        case "jetMaxSpeedAdd":
          modifiers.jetMaxVerticalSpeed += effect.value;
          break;
        case "miningTimeMult":
          miningTimeMult *= effect.value;
          break;
        case "miningRangeAdd":
          modifiers.miningRange += effect.value;
          break;
        case "digScale":
          digScale *= effect.value;
          break;
        case "depositYieldBonus":
          modifiers.depositYieldBonus += effect.value;
          break;
        case "footSpeedMult":
          footSpeedMult *= effect.value;
          break;
        case "jumpMult":
          jumpMult *= effect.value;
          break;
        case "waterMoveMult":
          waterMoveMult *= effect.value;
          break;
        case "waterDragMult":
          waterDragMult *= effect.value;
          break;
        case "roverSpeedMult":
          roverSpeedMult *= effect.value;
          break;
        default: {
          const exhaustive: never = effect;
          throw new Error(`Unknown build effect: ${String(exhaustive)}`);
        }
      }
    }
  }

  modifiers.jetBurnSeconds = JET_BURN_SECONDS * jetBurnMult;
  modifiers.jetRechargeSeconds = JET_RECHARGE_SECONDS * jetRechargeMult;
  modifiers.miningTime = MINING_TIME * miningTimeMult;
  modifiers.digRadius = CAVE_DIG_RADIUS * digScale;
  modifiers.digLength = CAVE_DIG_LENGTH * digScale;
  modifiers.walkSpeed = WALK_SPEED * footSpeedMult;
  modifiers.sprintSpeed = SPRINT_SPEED * footSpeedMult;
  modifiers.jumpVelocity = JUMP_VELOCITY * jumpMult;
  modifiers.waterMoveFactor = WATER_MOVE_FACTOR * waterMoveMult;
  modifiers.waterVerticalDrag = WATER_VERTICAL_DRAG * waterDragMult;
  modifiers.roverDriveSpeed = ROVER_DRIVE_SPEED * roverSpeedMult;
  return modifiers;
}

/**
 * Attempt to install a build. With `free: true` (slash command), skips cargo
 * cost and prerequisites; still rejects unknown / already-owned ids.
 */
export function tryBuild(
  buildId: string,
  inventory: Inventory,
  owned: readonly BuildId[],
  options: { free?: boolean } = {},
): TryBuildResult {
  if (!isBuildId(buildId)) {
    return { ok: false, reason: "unknown" };
  }
  const definition = BUILD_DEFINITIONS[buildId];
  if (owned.includes(buildId)) {
    return { ok: false, reason: "already-owned" };
  }

  const free = options.free === true;
  if (!free) {
    const missing = missingPrerequisites(definition, owned);
    if (missing.length > 0) {
      return { ok: false, reason: "missing-prerequisite" };
    }
    if (!canAffordBuild(definition.cost, inventory)) {
      return { ok: false, reason: "cannot-afford" };
    }
  }

  const nextInventory = free
    ? cloneInventory(inventory)
    : deductBuildCost(definition.cost, inventory);
  const nextBuilds = cloneBuilds([...owned, buildId]);
  return {
    ok: true,
    inventory: nextInventory,
    builds: nextBuilds,
    definition,
  };
}

/** Cost lines for UI, ordered like cargo materials. */
export function formatBuildCost(cost: BuildCost): string {
  const parts: string[] = [];
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    parts.push(`${amount} ${MATERIALS[materialId].label}`);
  }
  return parts.join(" · ");
}
