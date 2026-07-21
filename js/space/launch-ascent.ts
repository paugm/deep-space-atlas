/**
 * Launch cinematic: ride the cockpit straight up from the pad, shaking, while
 * the planet world keeps rendering below. The host drives update() during the
 * cinema hold and disposes before switching to space.
 */

import * as THREE from "three";

import { launchAscentState } from "./cinematic-math.ts";
import { buildCockpit } from "./cockpit.ts";

export interface LaunchAscent {
  update(deltaTime: number): void;
  dispose(): void;
}

export interface LaunchAscentOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  x: number;
  z: number;
  yaw: number;
  startY: number;
}

export function startLaunchAscent({
  scene,
  camera,
  x,
  z,
  yaw,
  startY,
}: LaunchAscentOptions): LaunchAscent {
  // Camera children only render when the camera is in the scene graph.
  const cameraWasParented = camera.parent !== null;
  if (!cameraWasParented) scene.add(camera);
  const cockpit = buildCockpit();
  camera.add(cockpit);
  let elapsedMs = 0;

  return {
    update(deltaTime: number): void {
      elapsedMs += deltaTime * 1000;
      const state = launchAscentState(elapsedMs);
      camera.position.set(
        x,
        startY + state.altitude + state.offsetY,
        z,
      );
      camera.rotation.set(state.pitch, yaw, 0);
    },
    dispose(): void {
      camera.remove(cockpit);
      if (!cameraWasParented) scene.remove(camera);
    },
  };
}
