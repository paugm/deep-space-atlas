/**
 * Runtime rovers: load Quaternius GLBs, place on terrain, board / drive / park.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { AabbCollider } from "../collision.ts";
import {
  EYE_HEIGHT,
  HALF_WORLD,
  ROVER_DRIVE_SPEED,
  ROVER_SEAT_HEIGHT,
} from "../config.ts";
import type { PlanetEntity } from "../planet-save.ts";
import type { World } from "../world/types.ts";
import {
  createRoverEntity,
  parseRoverPose,
  type RoverPose,
} from "./entity.ts";
import {
  ROVER_DEFINITIONS,
  type RoverKindId,
} from "./kinds.ts";
import type { RoverSpawnPlan } from "./plan.ts";

/**
 * Max look-at distance to show board prompt / accept **E** (world units ≈ m).
 * Uses a center-screen raycast, not proximity alone.
 */
export const ROVER_BOARD_RANGE = 10;

export { ROVER_DRIVE_SPEED, ROVER_SEAT_HEIGHT };

const NDC_CENTER = new THREE.Vector2(0, 0);

interface RoverRuntime {
  id: string;
  kind: RoverKindId;
  root: THREE.Group;
  model: THREE.Object3D;
  headlight: THREE.SpotLight;
}

export interface RoverSystem {
  /** Saved entities override the seeded plan. */
  sync(
    world: World,
    saved: readonly PlanetEntity[],
  ): Promise<void>;
  clear(): void;
  updateBoarded(driver: { x: number; z: number; yaw: number }): void;
  /** Center-reticle raycast finds unboarded rovers within range. */
  aimedInRange(
    camera: THREE.Camera,
    maxDistance: number,
  ): { id: string; distance: number } | null;
  isBoarded(): boolean;
  boardedId(): string | null;
  getPose(id: string): { x: number; z: number; yaw: number } | null;
  board(
    id: string,
  ): {
    speed: number;
    eyeHeight: number;
    x: number;
    z: number;
    yaw: number;
    kind: RoverKindId;
  } | null;
  /**
   * Leave the boarded rover at its current pose and return a stand-up offset
   * beside the hull (or null if nothing was boarded).
   */
  disembark(): {
    standX: number;
    standZ: number;
    yaw: number;
    eyeHeight: number;
  } | null;
  /** Adds a rover without replacing existing ones. */
  spawnAhead(
    world: World,
    kind: RoverKindId,
    from: { x: number; z: number; yaw: number },
    meters: number,
  ): Promise<RoverPose>;
  /** Persistence snapshot for flush and disembark. */
  getSaveEntities(): PlanetEntity[];
  /** Only unboarded rovers block the player. */
  getCollisionAabbs(): AabbCollider[];
  setHeadlights(on: boolean): void;
  getBoardedRoot(): THREE.Object3D | null;
}

export function createRoverSystem(): RoverSystem {
  const loader = new GLTFLoader();
  const raycaster = new THREE.Raycaster();
  const templates = new Map<RoverKindId, Promise<THREE.Object3D>>();
  let world: World | null = null;
  let rovers: RoverRuntime[] = [];
  let boardedId: string | null = null;
  let spawnSerial = 0;
  let generation = 0;

  function loadTemplate(kind: RoverKindId): Promise<THREE.Object3D> {
    let pending = templates.get(kind);
    if (pending === undefined) {
      pending = loader
        .loadAsync(ROVER_DEFINITIONS[kind].glbUrl)
        .then((gltf) => gltf.scene);
      templates.set(kind, pending);
    }
    return pending;
  }

  function clearRovers(): void {
    for (const rover of rovers) {
      rover.root.removeFromParent();
    }
    rovers = [];
    boardedId = null;
  }

  function clear(): void {
    generation += 1;
    clearRovers();
    world = null;
  }

  function groundRoot(
    root: THREE.Group,
    model: THREE.Object3D,
    scale: number,
    boundsMinY: number,
    x: number,
    z: number,
    yaw: number,
  ): void {
    const active = world;
    if (active === null) return;
    const ground = active.heightAt(x, z);
    model.position.y = -boundsMinY * scale - 0.05;
    root.position.set(x, ground, z);
    root.rotation.y = yaw;
  }

  async function mountRover(
    pose: RoverPose,
    sceneGeneration: number,
  ): Promise<void> {
    const active = world;
    if (active === null || generation !== sceneGeneration) return;

    const source = await loadTemplate(pose.kind);
    if (active !== world || generation !== sceneGeneration) return;

    const definition = ROVER_DEFINITIONS[pose.kind];
    const model = source.clone(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale =
      definition.length / Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(scale);

    const root = new THREE.Group();
    root.name = `rover:${pose.id}`;
    root.add(model);
    const headlight = new THREE.SpotLight(
      0xfff1d0,
      0,
      42,
      Math.PI / 6.5,
      0.4,
      1.1,
    );
    headlight.position.set(0, 1.15, 0.35);
    const headlightTarget = new THREE.Object3D();
    headlightTarget.position.set(0, 0.35, -14);
    root.add(headlight);
    root.add(headlightTarget);
    headlight.target = headlightTarget;
    groundRoot(root, model, scale, bounds.min.y, pose.x, pose.z, pose.yaw);
    active.group.add(root);

    rovers.push({
      id: pose.id,
      kind: pose.kind,
      root,
      model,
      headlight,
    });
  }

  async function sync(
    nextWorld: World,
    saved: readonly PlanetEntity[],
  ): Promise<void> {
    clear();
    world = nextWorld;
    const sceneGeneration = generation;

    const fromSave: RoverPose[] = [];
    for (const entity of saved) {
      const pose = parseRoverPose(entity);
      if (pose !== null) fromSave.push(pose);
    }

    const poses: RoverPose[] =
      fromSave.length > 0
        ? fromSave
        : nextWorld.roverPlan.spawns.map((spawn: RoverSpawnPlan) => ({
            id: spawn.id,
            kind: spawn.kind,
            x: spawn.x,
            z: spawn.z,
            yaw: spawn.yaw,
          }));

    for (const pose of poses) {
      await mountRover(pose, sceneGeneration);
    }
  }

  function findRover(id: string): RoverRuntime | null {
    for (const rover of rovers) {
      if (rover.id === id) return rover;
    }
    return null;
  }

  function updateBoarded(driver: { x: number; z: number; yaw: number }): void {
    if (boardedId === null || world === null) return;
    const rover = findRover(boardedId);
    if (rover === null) return;
    const ground = world.heightAt(driver.x, driver.z);
    rover.root.position.set(driver.x, ground, driver.z);
    rover.root.rotation.y = driver.yaw;
  }

  function roverIdFromObject(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current !== null) {
      if (current.name.startsWith("rover:")) {
        return current.name.slice("rover:".length);
      }
      current = current.parent;
    }
    return null;
  }

  function aimedInRange(
    camera: THREE.Camera,
    maxDistance: number,
  ): { id: string; distance: number } | null {
    const targets: THREE.Object3D[] = [];
    for (const rover of rovers) {
      if (rover.id === boardedId) continue;
      targets.push(rover.root);
    }
    if (targets.length === 0) return null;

    raycaster.setFromCamera(NDC_CENTER, camera);
    raycaster.far = maxDistance;
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      if (hit.distance > maxDistance) continue;
      const id = roverIdFromObject(hit.object);
      if (id === null) continue;
      return { id, distance: hit.distance };
    }
    return null;
  }

  function getPose(
    id: string,
  ): { x: number; z: number; yaw: number } | null {
    const rover = findRover(id);
    if (rover === null) return null;
    return {
      x: rover.root.position.x,
      z: rover.root.position.z,
      yaw: rover.root.rotation.y,
    };
  }

  function board(
    id: string,
  ): {
    speed: number;
    eyeHeight: number;
    x: number;
    z: number;
    yaw: number;
    kind: RoverKindId;
  } | null {
    if (boardedId !== null) return null;
    const rover = findRover(id);
    if (rover === null) return null;
    boardedId = id;
    // Hide the hull so the cabin does not fill the camera.
    rover.model.visible = false;
    rover.headlight.intensity = 2.6;
    return {
      speed: ROVER_DRIVE_SPEED,
      eyeHeight: ROVER_SEAT_HEIGHT,
      x: rover.root.position.x,
      z: rover.root.position.z,
      yaw: rover.root.rotation.y,
      kind: rover.kind,
    };
  }

  function disembark(): {
    standX: number;
    standZ: number;
    yaw: number;
    eyeHeight: number;
  } | null {
    if (boardedId === null) return null;
    const rover = findRover(boardedId);
    boardedId = null;
    if (rover === null) return null;

    rover.model.visible = true;
    rover.headlight.intensity = 0;
    const yaw = rover.root.rotation.y;
    // Step off to the right of the hull.
    const standX = rover.root.position.x + Math.cos(yaw) * 2.2;
    const standZ = rover.root.position.z - Math.sin(yaw) * 2.2;
    return {
      standX,
      standZ,
      yaw,
      eyeHeight: EYE_HEIGHT,
    };
  }

  async function spawnAhead(
    nextWorld: World,
    kind: RoverKindId,
    from: { x: number; z: number; yaw: number },
    meters: number,
  ): Promise<RoverPose> {
    if (world !== nextWorld) {
      // Allow spawn during an active synced world only.
      world = nextWorld;
    }
    const sceneGeneration = generation;
    spawnSerial += 1;
    const limit = HALF_WORLD - 4;
    const x = Math.max(
      -limit,
      Math.min(limit, from.x - Math.sin(from.yaw) * meters),
    );
    const z = Math.max(
      -limit,
      Math.min(limit, from.z - Math.cos(from.yaw) * meters),
    );
    const yaw = Math.atan2(from.x - x, from.z - z);
    const pose: RoverPose = {
      id: `rover-spawn-${spawnSerial}`,
      kind,
      x,
      z,
      yaw,
    };
    await mountRover(pose, sceneGeneration);
    return pose;
  }

  function getSaveEntities(): PlanetEntity[] {
    return rovers.map((rover) =>
      createRoverEntity({
        id: rover.id,
        kind: rover.kind,
        x: rover.root.position.x,
        z: rover.root.position.z,
        yaw: rover.root.rotation.y,
      }),
    );
  }

  function getCollisionAabbs(): AabbCollider[] {
    const hulls: AabbCollider[] = [];
    for (const rover of rovers) {
      if (rover.id === boardedId) continue;
      rover.root.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(rover.root);
      hulls.push({
        kind: "aabb",
        minX: box.min.x,
        minY: box.min.y,
        minZ: box.min.z,
        maxX: box.max.x,
        maxY: box.max.y,
        maxZ: box.max.z,
      });
    }
    return hulls;
  }

  function setHeadlights(on: boolean): void {
    for (const rover of rovers) {
      if (rover.id !== boardedId) {
        rover.headlight.intensity = 0;
        continue;
      }
      rover.headlight.intensity = on ? 2.6 : 0;
    }
  }

  function getBoardedRoot(): THREE.Object3D | null {
    if (boardedId === null) return null;
    return findRover(boardedId)?.root ?? null;
  }

  return {
    sync,
    clear,
    updateBoarded,
    aimedInRange,
    isBoarded: () => boardedId !== null,
    boardedId: () => boardedId,
    getPose,
    board,
    disembark,
    spawnAhead,
    getSaveEntities,
    getCollisionAabbs,
    setHeadlights,
    getBoardedRoot,
  };
}
