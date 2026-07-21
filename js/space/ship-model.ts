/**
 * Shared loader for the survey vessel GLB (Liz Reddington, CC BY, see
 * CREDITS.md). The template loads once; instances clone it (sharing
 * geometry/materials) with the longest hull dimension normalized to
 * SHIP_LENGTH world meters, so the parked pad and the landing cinematic
 * always show the same craft at the same scale.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import shipUrl from "../../assets/ships/liz-reddington-spaceship/spaceship.glb?url";

export const SHIP_LENGTH = 8;

let template: Promise<THREE.Object3D> | null = null;

export function loadShipTemplate(): Promise<THREE.Object3D> {
  template ??= new GLTFLoader()
    .loadAsync(shipUrl)
    .then((gltf) => gltf.scene);
  return template;
}

export interface ShipModel {
  model: THREE.Object3D;
  /** Lift from the model origin so the hull bottom rests at local y = 0. */
  baseLift: number;
  /** Translation that centers the hull bounds on the local origin. */
  centerOffset: THREE.Vector3;
}

/** Clone the template at gameplay scale. Do not dispose shared resources. */
export function createShipModel(source: THREE.Object3D): ShipModel {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = SHIP_LENGTH / Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(scale);
  return {
    model,
    baseLift: -bounds.min.y * scale,
    centerOffset: bounds
      .getCenter(new THREE.Vector3())
      .multiplyScalar(-scale),
  };
}
