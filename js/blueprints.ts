/**
 * Field blueprint catalog: placeable structures fabricated from cargo.
 * Pure — no DOM or Three.js. Instances live on planet entities.
 */

import type { CargoCost } from "./cargo-cost.ts";
import {
  canAffordCost,
  cloneInventory,
  deductCost,
  formatCargoCost,
} from "./cargo-cost.ts";
import type { Inventory } from "./config.ts";

export type BlueprintId = "beacon" | "tent" | "planet-base";

export type BlueprintCategory = "marker" | "shelter";

export type BlueprintCost = CargoCost;

export interface BlueprintDefinition {
  id: BlueprintId;
  /** Slash-command token; usually matches `id`. */
  token: string;
  label: string;
  blurb: string;
  category: BlueprintCategory;
  cost: BlueprintCost;
  /** Max instances of this blueprint on one planet. */
  maxPerPlanet: number;
  /** Minimum distance between instances of this blueprint (world units). */
  minSpacing: number;
  /**
   * Clearance radius vs any other structure (sum of radii must fit).
   * Keeps tents/bases from overlapping beacons.
   */
  footprintRadius: number;
  /** How far ahead of the commander to plant the structure. */
  placeAhead: number;
}

export type TryFabricateReason = "unknown" | "cannot-afford";

export type TryFabricateResult =
  | {
      ok: true;
      inventory: Inventory;
      definition: BlueprintDefinition;
    }
  | { ok: false; reason: TryFabricateReason };

export const BLUEPRINT_DEFINITIONS: Record<BlueprintId, BlueprintDefinition> = {
  beacon: {
    id: "beacon",
    token: "beacon",
    label: "Survey Beacon",
    blurb: "Plants a glowing marker on this planet. Compass tracks the nearest.",
    category: "marker",
    cost: { silicate: 25, iron: 15, copper: 8 },
    maxPerPlanet: 8,
    minSpacing: 12,
    footprintRadius: 1,
    placeAhead: 2.5,
  },
  tent: {
    id: "tent",
    token: "tent",
    label: "Survey Tent",
    blurb: "Cheap walk-in canvas shelter. Duck through the flap to get inside.",
    category: "shelter",
    cost: { silicate: 12, carbon: 18, iron: 4 },
    maxPerPlanet: 4,
    minSpacing: 8,
    footprintRadius: 2.8,
    placeAhead: 3.5,
  },
  "planet-base": {
    id: "planet-base",
    token: "planet-base",
    label: "Planet Base",
    blurb: "A proper walk-in outpost. Floor, walls, and a warm cabin light.",
    category: "shelter",
    cost: { silicate: 80, iron: 55, carbon: 30, copper: 22 },
    maxPerPlanet: 1,
    minSpacing: 20,
    footprintRadius: 4,
    placeAhead: 5,
  },
};

/** Catalog order for menus and docs. */
export const BLUEPRINT_ORDER: readonly BlueprintId[] = [
  "beacon",
  "tent",
  "planet-base",
];

const BLUEPRINT_ID_SET = new Set<string>(BLUEPRINT_ORDER);

export function isBlueprintId(value: unknown): value is BlueprintId {
  return typeof value === "string" && BLUEPRINT_ID_SET.has(value);
}

export function blueprintDefinitionFromToken(
  token: string,
): BlueprintDefinition | null {
  const normalized = token.trim().toLowerCase();
  if (normalized.length === 0) return null;
  for (const id of BLUEPRINT_ORDER) {
    const definition = BLUEPRINT_DEFINITIONS[id];
    if (definition.token === normalized || definition.id === normalized) {
      return definition;
    }
  }
  return null;
}

/**
 * Spend cargo for one blueprint instance. Placement rules are separate
 * (`validateStructurePlacement`). With `free: true`, skips cost.
 */
export function tryFabricate(
  blueprintId: string,
  inventory: Inventory,
  options: { free?: boolean } = {},
): TryFabricateResult {
  if (!isBlueprintId(blueprintId)) {
    return { ok: false, reason: "unknown" };
  }
  const definition = BLUEPRINT_DEFINITIONS[blueprintId];
  const free = options.free === true;
  if (!free && !canAffordCost(definition.cost, inventory)) {
    return { ok: false, reason: "cannot-afford" };
  }
  return {
    ok: true,
    inventory: free
      ? cloneInventory(inventory)
      : deductCost(definition.cost, inventory),
    definition,
  };
}

export { canAffordCost, formatCargoCost };
