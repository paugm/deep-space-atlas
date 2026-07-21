/**
 * Places the survey vessel beside spawn, or where commands move it. Clones the
 * shared ship template, places it on terrain, and checks board proximity.
 *
 * The clone shares template geometry/materials, so it is removed from the
 * scene before world disposal instead of being disposed with the group.
 */

import * as THREE from "three";

import type { AabbCollider } from "../collision.ts";
import { createShipModel, loadShipTemplate } from "./ship-model.ts";
import type { World } from "../world.ts";

const SPAWN_OFFSET_X = 7;
const SPAWN_OFFSET_Z = 5;
export const BOARD_RANGE = 7;

export interface ParkedShip {
  place(scene: THREE.Scene, world: World): Promise<void>;
  placeAt(
    scene: THREE.Scene,
    world: World,
    x: number,
    z: number,
    yaw: number,
  ): Promise<void>;
  remove(): void;
  /** Horizontal distance to the parked vessel. */
  distanceTo(x: number, z: number): number | null;
  getPose(): { x: number; z: number; yaw: number } | null;
  /** Approximate hull bounds for player collision. */
  getCollisionAabb(): AabbCollider | null;
}

export function createParkedShip(): ParkedShip {
  let placed: THREE.Group | null = null;
  let placedScene: THREE.Scene | null = null;
  let generation = 0;

  function remove(): void {
    generation += 1;
    if (placed !== null && placedScene !== null) {
      placedScene.remove(placed);
    }
    placed = null;
    placedScene = null;
  }

  async function placeAt(
    scene: THREE.Scene,
    world: World,
    x: number,
    z: number,
    yaw: number,
  ): Promise<void> {
    remove();
    const placeGeneration = generation;
    const source = await loadShipTemplate();
    if (generation !== placeGeneration) return;

    const { model, baseLift } = createShipModel(source);
    const ground = world.heightAt(x, z);

    const root = new THREE.Group();
    root.name = "parked-ship";
    // Rest the hull on the terrain sample; a slight sink hides gaps on slopes.
    model.position.y = baseLift - 0.15;
    root.add(model);
    root.position.set(x, ground, z);
    root.rotation.y = yaw;

    scene.add(root);
    placed = root;
    placedScene = scene;
  }

  async function place(
    scene: THREE.Scene,
    world: World,
  ): Promise<void> {
    const x = world.spawn.x + SPAWN_OFFSET_X;
    const z = world.spawn.z + SPAWN_OFFSET_Z;
    const yaw = Math.atan2(world.spawn.x - x, world.spawn.z - z);
    await placeAt(scene, world, x, z, yaw);
  }

  function distanceTo(x: number, z: number): number | null {
    if (placed === null) return null;
    return Math.hypot(placed.position.x - x, placed.position.z - z);
  }

  function getPose(): { x: number; z: number; yaw: number } | null {
    if (placed === null) return null;
    return {
      x: placed.position.x,
      z: placed.position.z,
      yaw: placed.rotation.y,
    };
  }

  function getCollisionAabb(): AabbCollider | null {
    if (placed === null) return null;
    placed.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(placed);
    return {
      kind: "aabb",
      minX: box.min.x,
      minY: box.min.y,
      minZ: box.min.z,
      maxX: box.max.x,
      maxY: box.max.y,
      maxZ: box.max.z,
    };
  }

  return {
    place,
    placeAt,
    remove,
    distanceTo,
    getPose,
    getCollisionAabb,
  };
}
