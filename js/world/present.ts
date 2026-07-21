import * as THREE from "three";

import {
  DAY_LENGTH,
  EYE_HEIGHT,
  WATER_SURFACE_OPACITY,
  WATER_UNDER_OPACITY,
  clamp,
  smoothstep,
} from "../config.ts";
import type { DepositType } from "../config.ts";
import {
  blendUnderwaterFogColor,
  sampleWaterImmersion,
  underwaterFogParams,
} from "../water.ts";
import { disposeMaterial } from "./util.ts";
import type { World } from "./types.ts";

const underwaterFogScratch = new THREE.Color();

const NIGHT_TINT = new THREE.Color(0.055, 0.075, 0.16);
const DUSK_TINT = new THREE.Color(1.12, 0.62, 0.42);
const DAY_TINT = new THREE.Color(1, 1, 1);

export function disposeWorldGroup(
  scene: THREE.Scene,
  world: World,
): void {
  world.group.traverse((object: THREE.Object3D) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points
    ) {
      object.geometry.dispose();
      const materials: readonly THREE.Material[] = Array.isArray(
        object.material,
      )
        ? object.material
        : [object.material];
      for (const material of materials) disposeMaterial(material);
    } else if (object instanceof THREE.Sprite) {
      disposeMaterial(object.material);
    }
  });

  scene.remove(world.group);
}

export function refreshDepositInstance(
  world: World,
  type: DepositType,
  index: number,
  scratch: {
    matrix: THREE.Matrix4;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  },
): void {
  const deposit = world.deposits[type];
  const entry = deposit.list[index]!;
  const shrink =
    entry.remaining <= 0
      ? 0.0001
      : entry.base * (0.4 + (0.6 * entry.remaining) / entry.capacity);

  scratch.matrix.compose(
    entry.position,
    scratch.quaternion.setFromEuler(new THREE.Euler(0, entry.yaw, 0)),
    scratch.scale.set(shrink, shrink, shrink),
  );
  deposit.mesh.setMatrixAt(index, scratch.matrix);
  deposit.mesh.instanceMatrix.needsUpdate = true;
}

export function updateDayNight(
  world: World,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  time: number,
  scratch: {
    vector: THREE.Vector3;
    dayTint: THREE.Color;
  },
  cameraY?: number,
): void {
  if (world.timeOrigin < 0) world.timeOrigin = time;

  const dayLength = DAY_LENGTH * world.lighting.dayLengthScale;
  const dayTime = ((time - world.timeOrigin) / dayLength + 0.07) % 1;
  const phase = dayTime * Math.PI * 2;
  const cosine = Math.cos(world.sunAzimuth);
  const sine = Math.sin(world.sunAzimuth);
  scratch.vector.set(
    Math.cos(phase) * cosine,
    Math.sin(phase),
    Math.cos(phase) * sine,
  );

  const elevation = scratch.vector.y;
  const daylight = smoothstep(-0.07, 0.22, elevation);
  const dusk =
    Math.max(0, 1 - Math.abs(elevation) / 0.28) *
    smoothstep(-0.18, -0.02, elevation);
  scratch.dayTint
    .copy(NIGHT_TINT)
    .lerp(DAY_TINT, daylight)
    .lerp(DUSK_TINT, dusk * 0.55);

  world.sky.material.color.copy(scratch.dayTint);
  const fog = scene.fog;
  if (!(fog instanceof THREE.Fog)) {
    throw new Error("Active world must own THREE.Fog");
  }
  fog.color.copy(world.palette.horizon).multiply(scratch.dayTint);
  fog.near = world.biome.fogNear;
  fog.far = world.biome.fogFar;

  const lightScale = world.lighting.intensityScale;
  let sunScale = 1;
  if (world.water && world.surfaceKind === "water") {
    const surfaceY =
      world.waterLevel + Math.sin(time * 0.6) * 0.12;
    world.water.position.y = surfaceY;

    const eyeY = cameraY ?? surfaceY + 1;
    const immersion = sampleWaterImmersion(
      eyeY,
      EYE_HEIGHT,
      surfaceY,
    );
    if (immersion.eyeSubmerged && world.palette.water) {
      const fogParams = underwaterFogParams(
        immersion.eyeDepth,
        world.biome.fogNear,
        world.biome.fogFar,
      );
      const water = world.palette.water;
      const blended = blendUnderwaterFogColor(
        fog.color.r,
        fog.color.g,
        fog.color.b,
        water.r,
        water.g,
        water.b,
        fogParams.strength,
      );
      underwaterFogScratch.setRGB(blended.r, blended.g, blended.b);
      fog.color.copy(underwaterFogScratch);
      fog.near = fogParams.near;
      fog.far = fogParams.far;
      world.water.material.opacity = WATER_UNDER_OPACITY;
      sunScale = 1 - fogParams.strength * 0.55;
    } else {
      world.water.material.opacity = WATER_SURFACE_OPACITY;
    }
  } else if (world.water && world.surfaceKind === "ice") {
    world.water.position.y = world.waterLevel;
  }

  renderer.setClearColor(fog.color);
  world.sunLight.position.copy(scratch.vector).multiplyScalar(300);
  world.sunLight.intensity =
    2.6 * daylight * sunScale * lightScale;
  world.moonLight.position.copy(scratch.vector).multiplyScalar(-300);
  world.moonLight.intensity =
    0.5 * (1 - daylight) * sunScale * lightScale;
  world.hemisphereLight.intensity =
    (0.14 + 0.72 * daylight) *
    (0.55 + 0.45 * sunScale) *
    lightScale;
  world.sun.position.copy(scratch.vector).multiplyScalar(800);
  world.sun.material.opacity = clamp(elevation * 6 + 0.4, 0, 1);
  world.moon.position.copy(scratch.vector).multiplyScalar(-800);
  world.moon.material.opacity = clamp(-elevation * 6 + 0.2, 0, 0.95);
  world.stars.material.opacity = (1 - daylight) * 0.95;
  const glow =
    (1.25 + 1.5 * (1 - daylight)) * world.lighting.depositGlowScale;
  world.crystalMaterial.emissiveIntensity =
    glow +
    (0.4 + 0.5 * (1 - daylight)) *
      Math.sin(time * 2.3) *
      world.lighting.depositGlowScale;
}
