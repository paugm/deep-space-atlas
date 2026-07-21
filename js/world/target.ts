import * as THREE from "three";

import { DEPOSIT_TYPES, MINING_RANGE } from "../config.ts";
import type { DepositType } from "../config.ts";
import { raymarchTerrain } from "./terrain.ts";
import type { AimHit, World, WorldObjectMetadata } from "./types.ts";
import { isDepositType, isRecord } from "./util.ts";

/** Narrow Three's open userData dictionary before using hit metadata. */
export function readWorldObjectMetadata(
  value: unknown,
): WorldObjectMetadata | null {
  if (!isRecord(value)) return null;

  switch (value.kind) {
    case "rock":
      return { kind: "rock" };
    case "flora":
      return { kind: "flora" };
    case "deposit":
      return isDepositType(value.type)
        ? { kind: "deposit", type: value.type }
        : null;
    default:
      return null;
  }
}

const scratchMatrix = new THREE.Matrix4();
const scratchInstanceWorld = new THREE.Matrix4();
const scratchInverse = new THREE.Matrix4();
const scratchSphere = new THREE.Sphere();
const scratchBox = new THREE.Box3();
const localRay = new THREE.Ray();
const hitPoint = new THREE.Vector3();
const singleton = new THREE.Mesh();

/**
 * Raycast only the listed instance indices of an InstancedMesh.
 * Avoids O(all instances) work when a spatial broad-phase supplies candidates.
 */
export function intersectInstancedIndices(
  mesh: THREE.InstancedMesh,
  indices: readonly number[],
  raycaster: THREE.Raycaster,
): THREE.Intersection[] {
  if (indices.length === 0) return [];

  const geometry = mesh.geometry;
  const intersections: THREE.Intersection[] = [];

  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const localSphere = geometry.boundingSphere;
  const localBox = geometry.boundingBox;
  if (!localSphere || !localBox) return [];

  mesh.updateWorldMatrix(true, false);
  singleton.geometry = geometry;
  singleton.material = mesh.material;
  singleton.matrixAutoUpdate = false;

  for (const index of indices) {
    if (index < 0 || index >= mesh.count) continue;
    mesh.getMatrixAt(index, scratchMatrix);
    scratchInstanceWorld.multiplyMatrices(mesh.matrixWorld, scratchMatrix);

    scratchSphere.copy(localSphere).applyMatrix4(scratchInstanceWorld);
    const originInside =
      raycaster.ray.origin.distanceToSquared(scratchSphere.center) <=
      scratchSphere.radius * scratchSphere.radius;
    if (!originInside && !raycaster.ray.intersectsSphere(scratchSphere)) {
      continue;
    }

    scratchInverse.copy(scratchInstanceWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(scratchInverse);
    scratchBox.copy(localBox);
    const boxHit =
      localRay.intersectBox(scratchBox, hitPoint) !== null ||
      scratchBox.containsPoint(localRay.origin);
    if (!boxHit) continue;

    const hits: THREE.Intersection[] = [];
    singleton.matrixWorld.copy(scratchInstanceWorld);
    singleton.raycast(raycaster, hits);

    for (const hit of hits) {
      if (hit.distance > raycaster.far) continue;
      hit.object = mesh;
      hit.instanceId = index;
      intersections.push(hit);
    }
  }

  intersections.sort((left, right) => left.distance - right.distance);
  return intersections;
}

export function getAimHit(
  world: World,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  screenCenter: THREE.Vector2,
): AimHit | null {
  raycaster.setFromCamera(screenCenter, camera);
  const direction = raycaster.ray.direction;
  const origin = raycaster.ray.origin;

  const candidates = world.aimIndex.query(
    origin.x,
    origin.z,
    MINING_RANGE + 4,
  );

  const rockIndices: number[] = [];
  const floraIndices: number[] = [];
  const depositIndices = new Map<DepositType, number[]>();

  for (const candidate of candidates) {
    switch (candidate.kind) {
      case "rock":
        rockIndices.push(candidate.index);
        break;
      case "flora":
        floraIndices.push(candidate.index);
        break;
      case "deposit": {
        const list = depositIndices.get(candidate.type);
        if (list) list.push(candidate.index);
        else depositIndices.set(candidate.type, [candidate.index]);
        break;
      }
      default: {
        const exhaustiveCandidate: never = candidate;
        throw new Error(`Unknown aim candidate: ${String(exhaustiveCandidate)}`);
      }
    }
  }

  const aimState: { best: AimHit | null } = { best: null };
  const consider = (hit: THREE.Intersection): void => {
    const metadata = readWorldObjectMetadata(hit.object.userData);
    const index = hit.instanceId;
    if (!metadata || typeof index !== "number") return;

    let next: AimHit;
    if (metadata.kind === "deposit") {
      const entry = world.deposits[metadata.type].list[index];
      if (!entry || entry.remaining <= 0) return;
      next = {
        kind: "deposit",
        type: metadata.type,
        index,
        point: hit.point.clone(),
        distance: hit.distance,
      };
    } else {
      next = {
        kind: metadata.kind,
        index,
        point: hit.point.clone(),
        distance: hit.distance,
      };
    }

    if (!aimState.best || next.distance < aimState.best.distance) {
      aimState.best = next;
    }
  };

  for (const hit of intersectInstancedIndices(
    world.rocks,
    rockIndices,
    raycaster,
  )) {
    consider(hit);
  }

  for (const type of DEPOSIT_TYPES) {
    const indices = depositIndices.get(type);
    if (!indices) continue;
    for (const hit of intersectInstancedIndices(
      world.deposits[type].mesh,
      indices,
      raycaster,
    )) {
      consider(hit);
    }
  }

  if (world.flora && floraIndices.length > 0) {
    for (const hit of intersectInstancedIndices(
      world.flora.trunks,
      floraIndices,
      raycaster,
    )) {
      consider(hit);
    }
    for (const hit of intersectInstancedIndices(
      world.flora.canopies,
      floraIndices,
      raycaster,
    )) {
      consider(hit);
    }
  }

  for (const target of world.faunaAimTargets) {
    const hits = raycaster.intersectObject(target.object, true);
    for (const hit of hits) {
      if (hit.distance > raycaster.far) continue;
      const next: AimHit = {
        kind: "fauna",
        creatureId: target.creatureId,
        species: target.species,
        role: target.role,
        point: hit.point.clone(),
        distance: hit.distance,
      };
      if (!aimState.best || next.distance < aimState.best.distance) {
        aimState.best = next;
      }
      break;
    }
  }

  const caveHit = world.caves?.raycast(origin, direction, MINING_RANGE);
  const terrainHit =
    caveHit === undefined
      ? raymarchTerrain(world, origin, direction, MINING_RANGE)
      : caveHit === null
        ? null
        : {
            point: new THREE.Vector3(
              caveHit.point.x,
              caveHit.point.y,
              caveHit.point.z,
            ),
            distance: caveHit.distance,
          };
  if (
    terrainHit &&
    (aimState.best === null ||
      terrainHit.distance < aimState.best.distance)
  ) {
    aimState.best = {
      kind: "terrain",
      point: terrainHit.point,
      distance: terrainHit.distance,
    };
  }

  return aimState.best;
}
