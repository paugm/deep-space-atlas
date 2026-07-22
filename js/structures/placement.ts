/**
 * Pure placement rules for field structures.
 */

import {
  BLUEPRINT_DEFINITIONS,
  type BlueprintId,
  isBlueprintId,
} from "../blueprints.ts";
import { HALF_WORLD } from "../config.ts";

export type StructurePlacementReason =
  | "unknown-blueprint"
  | "at-limit"
  | "too-close"
  | "out-of-bounds"
  | "too-steep";

export type StructurePlacementResult =
  | { ok: true }
  | { ok: false; reason: StructurePlacementReason };

export interface StructureFootprint {
  blueprintId: BlueprintId;
  x: number;
  z: number;
}

/** Margin from the world rim where structures may not be placed. */
export const STRUCTURE_EDGE_MARGIN = 4;

/** Fallback when a blueprint does not define placeAhead. */
export const STRUCTURE_PLACE_AHEAD = 2.5;

export function placementPointAhead(options: {
  x: number;
  z: number;
  yaw: number;
  meters?: number;
}): { x: number; z: number } {
  const meters = options.meters ?? STRUCTURE_PLACE_AHEAD;
  return {
    x: options.x - Math.sin(options.yaw) * meters,
    z: options.z - Math.cos(options.yaw) * meters,
  };
}

export function validateStructurePlacement(options: {
  blueprintId: string;
  x: number;
  z: number;
  existing: readonly StructureFootprint[];
}): StructurePlacementResult {
  if (!isBlueprintId(options.blueprintId)) {
    return { ok: false, reason: "unknown-blueprint" };
  }
  const definition = BLUEPRINT_DEFINITIONS[options.blueprintId];
  const limit = HALF_WORLD - STRUCTURE_EDGE_MARGIN;
  if (
    !Number.isFinite(options.x) ||
    !Number.isFinite(options.z) ||
    Math.abs(options.x) > limit ||
    Math.abs(options.z) > limit
  ) {
    return { ok: false, reason: "out-of-bounds" };
  }

  let sameKind = 0;
  for (const entry of options.existing) {
    const other = BLUEPRINT_DEFINITIONS[entry.blueprintId];
    const clearance = definition.footprintRadius + other.footprintRadius;
    const distance = Math.hypot(entry.x - options.x, entry.z - options.z);
    if (distance < clearance) {
      return { ok: false, reason: "too-close" };
    }
    if (entry.blueprintId !== options.blueprintId) continue;
    sameKind += 1;
    if (distance < definition.minSpacing) {
      return { ok: false, reason: "too-close" };
    }
  }
  if (sameKind >= definition.maxPerPlanet) {
    return { ok: false, reason: "at-limit" };
  }
  return { ok: true };
}
