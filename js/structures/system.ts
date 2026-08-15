/**
 * Runtime field structures: beacons, walk-in shelters, and other blueprints.
 */

import * as THREE from "three";

import {
  BLUEPRINT_DEFINITIONS,
  type BlueprintId,
} from "../blueprints.ts";
import type {
  CapsulePose,
  CapsuleResolveResult,
} from "../collision.ts";
import type { PlanetEntity } from "../planet-save.ts";
import type { World } from "../world/types.ts";
import {
  createStructureEntity,
  parseStructurePose,
  type StructurePose,
} from "./entity.ts";
import { createStructureMesh } from "./mesh.ts";
import {
  placementPointAhead,
  validateStructurePlacement,
  type StructurePlacementReason,
} from "./placement.ts";
import {
  resolveCapsuleAgainstShelter,
  sampleShelterGround,
  shelterFloorSupport,
  shelterLayoutFor,
  type ShelterLayout,
} from "./shelter.ts";

/** Max look-at distance to label a structure in the prompt. */
export const STRUCTURE_AIM_RANGE = 8;

const NDC_CENTER = new THREE.Vector2(0, 0);

interface StructureRuntime {
  id: string;
  blueprintId: BlueprintId;
  root: THREE.Group;
  layout: ShelterLayout | null;
}

export interface StructureSystem {
  sync(world: World, saved: readonly PlanetEntity[]): void;
  clear(): void;
  /**
   * Spend is caller-owned. Places ahead of `from` when validation passes.
   */
  place(
    world: World,
    blueprintId: BlueprintId,
    from: { x: number; z: number; yaw: number },
  ):
    | { ok: true; pose: StructurePose }
    | { ok: false; reason: StructurePlacementReason };
  /** Remove a placed instance. Returns the blueprint id when found. */
  remove(id: string): BlueprintId | null;
  /** Center-reticle raycast finds a structure within range. */
  aimedInRange(
    camera: THREE.Camera,
    maxDistance: number,
  ): { id: string; blueprintId: BlueprintId; distance: number } | null;
  /** Nearest structure of any blueprint, or null when none. */
  nearest(from: { x: number; z: number }): {
    id: string;
    blueprintId: BlueprintId;
    x: number;
    z: number;
    distance: number;
    label: string;
  } | null;
  /**
   * Push the capsule out of all walk-in shelter walls (local-space resolve so
   * door gaps stay open at any yaw).
   */
  resolveWalls(pose: CapsulePose): CapsuleResolveResult;
  /** Highest shelter floor under XZ, or null when outside every footprint. */
  floorSupportAt(x: number, z: number): number | null;
  getSaveEntities(): PlanetEntity[];
  footprints(): readonly {
    blueprintId: BlueprintId;
    x: number;
    z: number;
  }[];
}

export function createStructureSystem(): StructureSystem {
  const raycaster = new THREE.Raycaster();
  let world: World | null = null;
  let structures: StructureRuntime[] = [];
  let nextId = 0;

  /**
   * Ground height for a pose: shelters sit on the highest terrain sample
   * under their footprint (floor stays level on curved ground); point
   * structures use the height at their center.
   */
  function originYFor(pose: StructurePose, layout: ShelterLayout | null): number {
    const terrain = world;
    if (terrain === null) return 0;
    if (layout === null) return terrain.heightAt(pose.x, pose.z);
    return sampleShelterGround({
      heightAt: (x, z) => terrain.heightAt(x, z),
      originX: pose.x,
      originZ: pose.z,
      yaw: pose.yaw,
      layout,
    }).floorY;
  }

  function mountPose(pose: StructurePose): StructureRuntime {
    const layout = shelterLayoutFor(pose.blueprintId);
    const root = createStructureMesh(pose.blueprintId);
    root.position.set(pose.x, originYFor(pose, layout), pose.z);
    root.rotation.y = pose.yaw;
    world?.group.add(root);
    return {
      id: pose.id,
      blueprintId: pose.blueprintId,
      root,
      layout,
    };
  }

  function disposeRuntime(entry: StructureRuntime): void {
    entry.root.removeFromParent();
    entry.root.traverse((child) => {
      if (child instanceof THREE.Light) return;
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        for (const entryMaterial of material) entryMaterial.dispose();
      } else {
        material.dispose();
      }
    });
  }

  function clear(): void {
    for (const entry of structures) disposeRuntime(entry);
    structures = [];
    world = null;
    nextId = 0;
  }

  function sync(nextWorld: World, saved: readonly PlanetEntity[]): void {
    clear();
    world = nextWorld;
    let maxSuffix = -1;
    for (const entity of saved) {
      const pose = parseStructurePose(entity);
      if (pose === null) continue;
      structures.push(mountPose(pose));
      const match = /^structure-(\d+)$/.exec(pose.id);
      if (match?.[1] !== undefined) {
        maxSuffix = Math.max(maxSuffix, Number(match[1]));
      }
    }
    nextId = maxSuffix + 1;
  }

  function footprints(): {
    blueprintId: BlueprintId;
    x: number;
    z: number;
  }[] {
    return structures.map((entry) => ({
      blueprintId: entry.blueprintId,
      x: entry.root.position.x,
      z: entry.root.position.z,
    }));
  }

  function place(
    nextWorld: World,
    blueprintId: BlueprintId,
    from: { x: number; z: number; yaw: number },
  ):
    | { ok: true; pose: StructurePose }
    | { ok: false; reason: StructurePlacementReason } {
    world = nextWorld;
    const definition = BLUEPRINT_DEFINITIONS[blueprintId];
    const point = placementPointAhead({
      ...from,
      meters: definition.placeAhead,
    });
    const validation = validateStructurePlacement({
      blueprintId,
      x: point.x,
      z: point.z,
      existing: footprints(),
    });
    if (!validation.ok) return validation;

    const layout = shelterLayoutFor(blueprintId);
    if (layout !== null) {
      const ground = sampleShelterGround({
        heightAt: (x, z) => nextWorld.heightAt(x, z),
        originX: point.x,
        originZ: point.z,
        yaw: from.yaw,
        layout,
      });
      if (ground.drop > layout.maxTerrainDrop) {
        return { ok: false, reason: "too-steep" };
      }
    }

    const pose: StructurePose = {
      id: `structure-${nextId}`,
      blueprintId,
      x: point.x,
      z: point.z,
      yaw: from.yaw,
    };
    nextId += 1;
    structures.push(mountPose(pose));
    return { ok: true, pose };
  }

  function remove(id: string): BlueprintId | null {
    const index = structures.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const [entry] = structures.splice(index, 1);
    if (entry === undefined) return null;
    disposeRuntime(entry);
    return entry.blueprintId;
  }

  function aimedInRange(
    camera: THREE.Camera,
    maxDistance: number,
  ): { id: string; blueprintId: BlueprintId; distance: number } | null {
    if (structures.length === 0) return null;
    raycaster.setFromCamera(NDC_CENTER, camera);
    const roots = structures.map((entry) => entry.root);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (hit.distance > maxDistance) continue;
      let object: THREE.Object3D | null = hit.object;
      while (object !== null) {
        const match = structures.find((entry) => entry.root === object);
        if (match !== undefined) {
          return {
            id: match.id,
            blueprintId: match.blueprintId,
            distance: hit.distance,
          };
        }
        object = object.parent;
      }
    }
    return null;
  }

  function nearest(from: { x: number; z: number }): {
    id: string;
    blueprintId: BlueprintId;
    x: number;
    z: number;
    distance: number;
    label: string;
  } | null {
    let best: {
      id: string;
      blueprintId: BlueprintId;
      x: number;
      z: number;
      distance: number;
      label: string;
    } | null = null;
    for (const entry of structures) {
      const x = entry.root.position.x;
      const z = entry.root.position.z;
      const distance = Math.hypot(x - from.x, z - from.z);
      if (best !== null && distance >= best.distance) continue;
      best = {
        id: entry.id,
        blueprintId: entry.blueprintId,
        x,
        z,
        distance,
        label: BLUEPRINT_DEFINITIONS[entry.blueprintId].label.toUpperCase(),
      };
    }
    return best;
  }

  function resolveWalls(pose: CapsulePose): CapsuleResolveResult {
    let working: CapsulePose = {
      x: pose.x,
      y: pose.y,
      z: pose.z,
      radius: pose.radius,
      eyeHeight: pose.eyeHeight,
    };
    let correctionX = 0;
    let correctionY = 0;
    let correctionZ = 0;

    for (const entry of structures) {
      if (entry.layout === null) continue;
      const resolved = resolveCapsuleAgainstShelter(
        working,
        {
          x: entry.root.position.x,
          y: entry.root.position.y,
          z: entry.root.position.z,
          yaw: entry.root.rotation.y,
        },
        entry.layout,
      );
      correctionX += resolved.correctionX;
      correctionY += resolved.correctionY;
      correctionZ += resolved.correctionZ;
      working = {
        x: resolved.x,
        y: resolved.y,
        z: resolved.z,
        radius: working.radius,
        eyeHeight: working.eyeHeight,
      };
    }

    return {
      x: working.x,
      y: working.y,
      z: working.z,
      correctionX,
      correctionY,
      correctionZ,
    };
  }

  function floorSupportAt(x: number, z: number): number | null {
    let best: number | null = null;
    for (const entry of structures) {
      if (entry.layout === null) continue;
      const floorY = shelterFloorSupport({
        x,
        z,
        originX: entry.root.position.x,
        originY: entry.root.position.y,
        originZ: entry.root.position.z,
        yaw: entry.root.rotation.y,
        layout: entry.layout,
      });
      if (floorY === null) continue;
      if (best === null || floorY > best) best = floorY;
    }
    return best;
  }

  function getSaveEntities(): PlanetEntity[] {
    return structures.map((entry) =>
      createStructureEntity({
        id: entry.id,
        blueprintId: entry.blueprintId,
        x: entry.root.position.x,
        z: entry.root.position.z,
        yaw: entry.root.rotation.y,
      }),
    );
  }

  return {
    sync,
    clear,
    place,
    remove,
    aimedInRange,
    nearest,
    resolveWalls,
    floorSupportAt,
    getSaveEntities,
    footprints,
  };
}
