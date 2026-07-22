/**
 * Pure shelter geometry: local wall AABBs, floor/porch support, oriented
 * collision, and footprint terrain sampling. Walk-in shells share one layout
 * recipe so mesh and collision stay aligned.
 *
 * Local convention: origin at floor center, +Z is the door face (toward the
 * commander who placed it), matching a THREE `rotation.y = yaw` transform.
 */

import type { BlueprintId } from "../blueprints.ts";
import type { AabbCollider, CapsulePose, CapsuleResolveResult } from "../collision.ts";
import { resolveCapsuleAgainstSolids } from "../collision.ts";

export interface LocalAabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface ShelterLayout {
  halfWidth: number;
  halfDepth: number;
  wallHeight: number;
  wallThickness: number;
  doorWidth: number;
  doorHeight: number;
  /** Walkable pad outside the door; the step up onto the floor happens here. */
  porchDepth: number;
  /** Walls extend this far below the floor so slopes cannot be slipped under. */
  foundationDepth: number;
  /** Max terrain height difference across the footprint before placement fails. */
  maxTerrainDrop: number;
  walls: readonly LocalAabb[];
  /** Solid interior props (bunk, crate); mesh visuals derive from these boxes. */
  furniture: readonly LocalAabb[];
}

interface ShelterRecipe {
  halfWidth: number;
  halfDepth: number;
  wallHeight: number;
  wallThickness: number;
  doorWidth: number;
  doorHeight: number;
  porchDepth: number;
  maxTerrainDrop: number;
}

const SHELTER_RECIPES: Partial<Record<BlueprintId, ShelterRecipe>> = {
  tent: {
    halfWidth: 1.7,
    halfDepth: 1.7,
    wallHeight: 1.95,
    wallThickness: 0.1,
    doorWidth: 1.4,
    doorHeight: 1.8,
    porchDepth: 0.9,
    maxTerrainDrop: 1,
  },
  "planet-base": {
    halfWidth: 2.6,
    halfDepth: 2.6,
    wallHeight: 2.6,
    wallThickness: 0.16,
    doorWidth: 1.5,
    doorHeight: 2.1,
    porchDepth: 1.15,
    maxTerrainDrop: 1.4,
  },
};

/** Interior props with collision, in local space. */
const SHELTER_FURNITURE: Partial<Record<BlueprintId, readonly LocalAabb[]>> = {
  "planet-base": [
    // Bunk along the back wall.
    { minX: -2.35, minY: 0, minZ: -2.4, maxX: -0.35, maxY: 0.52, maxZ: -1.55 },
    // Supply crate in the back-right corner.
    { minX: 1.5, minY: 0, minZ: -2.2, maxX: 2.25, maxY: 0.62, maxZ: -1.45 },
  ],
};

export function shelterLayoutFor(
  blueprintId: BlueprintId,
): ShelterLayout | null {
  const recipe = SHELTER_RECIPES[blueprintId];
  if (recipe === undefined) return null;
  const foundationDepth = recipe.maxTerrainDrop + 0.8;
  return {
    ...recipe,
    foundationDepth,
    walls: buildShelterWalls(recipe, foundationDepth),
    furniture: SHELTER_FURNITURE[blueprintId] ?? [],
  };
}

/**
 * Wall boxes with a door gap on the +Z face. Walls (and the door sill) run
 * from below grade up, and a ceiling closes the shell for jumps. The only
 * opening is the doorway above floor level.
 */
function buildShelterWalls(
  recipe: ShelterRecipe,
  foundationDepth: number,
): LocalAabb[] {
  const {
    halfWidth,
    halfDepth,
    wallHeight,
    wallThickness,
    doorWidth,
    doorHeight,
  } = recipe;
  const t = wallThickness;
  const doorHalf = doorWidth * 0.5;
  const bottom = -foundationDepth;

  return [
    // Back (−Z)
    {
      minX: -halfWidth,
      minY: bottom,
      minZ: -halfDepth,
      maxX: halfWidth,
      maxY: wallHeight,
      maxZ: -halfDepth + t,
    },
    // Left (−X)
    {
      minX: -halfWidth,
      minY: bottom,
      minZ: -halfDepth,
      maxX: -halfWidth + t,
      maxY: wallHeight,
      maxZ: halfDepth,
    },
    // Right (+X)
    {
      minX: halfWidth - t,
      minY: bottom,
      minZ: -halfDepth,
      maxX: halfWidth,
      maxY: wallHeight,
      maxZ: halfDepth,
    },
    // Front (+Z): left jamb, right jamb, lintel, and below-floor sill
    {
      minX: -halfWidth,
      minY: bottom,
      minZ: halfDepth - t,
      maxX: -doorHalf,
      maxY: wallHeight,
      maxZ: halfDepth,
    },
    {
      minX: doorHalf,
      minY: bottom,
      minZ: halfDepth - t,
      maxX: halfWidth,
      maxY: wallHeight,
      maxZ: halfDepth,
    },
    {
      minX: -doorHalf,
      minY: doorHeight,
      minZ: halfDepth - t,
      maxX: doorHalf,
      maxY: wallHeight,
      maxZ: halfDepth,
    },
    {
      minX: -doorHalf,
      minY: bottom,
      minZ: halfDepth - t,
      maxX: doorHalf,
      maxY: 0,
      maxZ: halfDepth,
    },
    // Ceiling
    {
      minX: -halfWidth,
      minY: wallHeight,
      minZ: -halfDepth,
      maxX: halfWidth,
      maxY: wallHeight + t,
      maxZ: halfDepth,
    },
  ];
}

/** Interior footprint plus the porch pad in front of the door. */
export function shelterFloorContains(
  localX: number,
  localZ: number,
  layout: ShelterLayout,
): boolean {
  if (
    Math.abs(localX) <= layout.halfWidth &&
    Math.abs(localZ) <= layout.halfDepth
  ) {
    return true;
  }
  return (
    Math.abs(localX) <= layout.doorWidth * 0.5 + 0.2 &&
    localZ > layout.halfDepth &&
    localZ <= layout.halfDepth + layout.porchDepth
  );
}

/** World XZ → structure-local XZ (inverse of THREE `rotation.y = yaw`). */
export function worldToShelterLocal(
  worldX: number,
  worldZ: number,
  originX: number,
  originZ: number,
  yaw: number,
): { x: number; z: number } {
  const dx = worldX - originX;
  const dz = worldZ - originZ;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: dx * cosine - dz * sine,
    z: dx * sine + dz * cosine,
  };
}

/** Structure-local XZ delta → world delta (THREE `rotation.y = yaw`). */
export function shelterLocalToWorldDelta(
  localX: number,
  localZ: number,
  yaw: number,
): { x: number; z: number } {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: localX * cosine + localZ * sine,
    z: -localX * sine + localZ * cosine,
  };
}

/**
 * Resolve a capsule against one shelter's walls by working in local space,
 * so door gaps stay open at any yaw (world AABBs would fatten and seal them).
 */
export function resolveCapsuleAgainstShelter(
  pose: CapsulePose,
  origin: { x: number; y: number; z: number; yaw: number },
  layout: ShelterLayout,
): CapsuleResolveResult {
  const local = worldToShelterLocal(
    pose.x,
    pose.z,
    origin.x,
    origin.z,
    origin.yaw,
  );
  const localSolids: AabbCollider[] = [
    ...layout.walls,
    ...layout.furniture,
  ].map((box) => ({
    kind: "aabb" as const,
    minX: box.minX,
    minY: origin.y + box.minY,
    minZ: box.minZ,
    maxX: box.maxX,
    maxY: origin.y + box.maxY,
    maxZ: box.maxZ,
  }));

  const localPose: CapsulePose = {
    x: local.x,
    y: pose.y,
    z: local.z,
    radius: pose.radius,
    eyeHeight: pose.eyeHeight,
  };
  const resolved = resolveCapsuleAgainstSolids(localPose, localSolids);
  const worldDelta = shelterLocalToWorldDelta(
    resolved.x - local.x,
    resolved.z - local.z,
    origin.yaw,
  );
  return {
    x: pose.x + worldDelta.x,
    y: resolved.y,
    z: pose.z + worldDelta.z,
    correctionX: worldDelta.x,
    correctionY: resolved.correctionY,
    correctionZ: worldDelta.z,
  };
}

/** Floor Y when the point is on the shelter floor or porch; otherwise null. */
export function shelterFloorSupport(options: {
  x: number;
  z: number;
  originX: number;
  originZ: number;
  originY: number;
  yaw: number;
  layout: ShelterLayout;
}): number | null {
  const local = worldToShelterLocal(
    options.x,
    options.z,
    options.originX,
    options.originZ,
    options.yaw,
  );
  if (!shelterFloorContains(local.x, local.z, options.layout)) {
    return null;
  }
  return options.originY;
}

export interface ShelterGroundInfo {
  /** Highest terrain sample under the footprint; the floor sits here. */
  floorY: number;
  /** Height difference across the footprint (placement fails when too large). */
  drop: number;
}

/** Sample terrain across the oriented footprint (3×3 grid). */
export function sampleShelterGround(options: {
  heightAt: (x: number, z: number) => number;
  originX: number;
  originZ: number;
  yaw: number;
  layout: ShelterLayout;
}): ShelterGroundInfo {
  const { heightAt, originX, originZ, yaw, layout } = options;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const localX of [-layout.halfWidth, 0, layout.halfWidth]) {
    for (const localZ of [-layout.halfDepth, 0, layout.halfDepth]) {
      const delta = shelterLocalToWorldDelta(localX, localZ, yaw);
      const height = heightAt(originX + delta.x, originZ + delta.z);
      if (height < min) min = height;
      if (height > max) max = height;
    }
  }
  return { floorY: max, drop: max - min };
}
