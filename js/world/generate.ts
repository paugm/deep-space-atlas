import * as THREE from "three";

import {
  DEPOSIT_DEFINITIONS,
  DEPOSIT_TYPES,
  HALF_WORLD,
  MATERIALS,
  WATER_SURFACE_OPACITY,
  WORLD_SIZE,
  createNoise2D,
  makeFbm,
  mulberry32,
} from "../config.ts";
import type { DepositType, RandomSource } from "../config.ts";
import { createDepositGeometry } from "./deposit-geometry.ts";
import { depositStableId } from "./deposit-id.ts";
import { refreshDepositInstance } from "./present.ts";
import {
  buildTerrainSurface,
  createGridHeightAt,
  fillHeightField,
} from "./terrain.ts";
import { createRadialTexture, createStarPositions } from "./textures.ts";
import { buildSpatialAimIndex } from "./spatial-index.ts";
import type {
  BiomeConfig,
  DepositCollection,
  DepositEntry,
  FloraCollection,
  HeightAt,
  World,
  WorldPalette,
} from "./types.ts";
import {
  getBufferAttribute,
  isCompleteDepositRecord,
} from "./util.ts";
import { planFauna } from "../fauna/plan.ts";
import { planRovers } from "../vehicles/plan.ts";
import {
  biomeFromPlanetClass,
  depositInstanceCount,
  hasLiquidWater,
  hasSurfacePlane,
  liquidWaterPenalty,
  pickPlanetClass,
  type PlanetClassDefinition,
  type SurfaceKind,
} from "./planet-class.ts";

export {
  biomeFromPlanetClass,
  pickPlanetClass,
  PLANET_CLASSES,
  PLANET_CLASS_IDS,
  type PlanetClassDefinition,
  type PlanetClassId,
  type SurfaceKind,
} from "./planet-class.ts";

export function createPlanetName(random: RandomSource): string {
  const prefixes = [
    "va",
    "ze",
    "kor",
    "ul",
    "ny",
    "xa",
    "tho",
    "ri",
    "mel",
    "dra",
    "os",
    "qui",
    "be",
    "lu",
    "ka",
  ] as const;
  const suffixes = [
    "lix",
    "mar",
    "dun",
    "tha",
    "vex",
    "nor",
    "bis",
    "rion",
    "myr",
    "ghal",
    "ceti",
    "ossa",
  ] as const;
  const designations = [
    "PRIME",
    "MINOR",
    "II",
    "IV",
    "VII",
    "IX",
    "SECUNDUS",
    "REACH",
  ] as const;
  const select = <Value>(items: readonly Value[]): Value =>
    items[Math.floor(random() * items.length)]!;
  const name = `${select(prefixes)}${select(prefixes)}${select(suffixes)}`;
  return (
    name.charAt(0).toUpperCase() +
    name.slice(1) +
    ` ${select(designations)}`
  );
}

export function createPalette(
  random: RandomSource,
  planetClass: PlanetClassDefinition,
): WorldPalette {
  const hsl = (
    hue: number,
    saturation: number,
    lightness: number,
  ): THREE.Color =>
    new THREE.Color().setHSL(
      ((hue % 1) + 1) % 1,
      saturation,
      lightness,
    );

  switch (planetClass.id) {
    case "lush-paradise":
      return {
        low: hsl(0.115 + random() * 0.02, 0.5, 0.6),
        mid: hsl(0.3 + random() * 0.06, 0.5, 0.34),
        high: hsl(0.07 + random() * 0.03, 0.12, 0.36),
        peak: hsl(0.55, 0.08, 0.9),
        crater: hsl(0.09, 0.45, 0.15),
        skyTop: hsl(0.58 + random() * 0.03, 0.65, 0.5),
        horizon: hsl(0.55, 0.45, 0.76),
        sun: hsl(0.13, 0.6, 0.85),
        rock: hsl(0.08, 0.12, 0.4),
        water: hsl(0.5 + random() * 0.04, 0.75, 0.42),
      };
    case "verdant-marsh":
      return {
        low: hsl(0.14 + random() * 0.03, 0.45, 0.42),
        mid: hsl(0.32 + random() * 0.05, 0.55, 0.28),
        high: hsl(0.1 + random() * 0.04, 0.18, 0.3),
        peak: hsl(0.5, 0.1, 0.82),
        crater: hsl(0.12, 0.4, 0.12),
        skyTop: hsl(0.5 + random() * 0.04, 0.45, 0.42),
        horizon: hsl(0.48, 0.35, 0.68),
        sun: hsl(0.12, 0.5, 0.78),
        rock: hsl(0.1, 0.15, 0.32),
        water: hsl(0.42 + random() * 0.05, 0.55, 0.3),
      };
    case "ash-wastes":
      return {
        low: hsl(0.05 + random() * 0.03, 0.22, 0.38),
        mid: hsl(0.04 + random() * 0.02, 0.18, 0.22),
        high: hsl(0.02, 0.08, 0.16),
        peak: hsl(0.08, 0.05, 0.55),
        crater: hsl(0.02, 0.35, 0.08),
        skyTop: hsl(0.05 + random() * 0.02, 0.2, 0.22),
        horizon: hsl(0.06, 0.25, 0.4),
        sun: hsl(0.08, 0.55, 0.7),
        rock: hsl(0.03, 0.12, 0.2),
      };
    case "crystal-barrens":
      return {
        low: hsl(0.55 + random() * 0.04, 0.18, 0.72),
        mid: hsl(0.58 + random() * 0.05, 0.22, 0.48),
        high: hsl(0.62, 0.12, 0.38),
        peak: hsl(0.6, 0.08, 0.94),
        crater: hsl(0.7, 0.25, 0.18),
        skyTop: hsl(0.58 + random() * 0.03, 0.4, 0.55),
        horizon: hsl(0.55, 0.3, 0.78),
        sun: hsl(0.15, 0.35, 0.9),
        rock: hsl(0.6, 0.08, 0.45),
      };
    case "rust-dunes":
      return {
        low: hsl(0.06 + random() * 0.03, 0.55, 0.52),
        mid: hsl(0.04 + random() * 0.03, 0.5, 0.32),
        high: hsl(0.03, 0.3, 0.22),
        peak: hsl(0.08, 0.15, 0.7),
        crater: hsl(0.02, 0.45, 0.12),
        skyTop: hsl(0.08 + random() * 0.03, 0.45, 0.45),
        horizon: hsl(0.07, 0.4, 0.62),
        sun: hsl(0.1, 0.7, 0.82),
        rock: hsl(0.05, 0.35, 0.28),
      };
    case "frozen-shelf":
      return {
        low: hsl(0.55 + random() * 0.03, 0.25, 0.78),
        mid: hsl(0.58 + random() * 0.04, 0.2, 0.55),
        high: hsl(0.6, 0.12, 0.4),
        peak: hsl(0.58, 0.05, 0.95),
        crater: hsl(0.62, 0.2, 0.2),
        skyTop: hsl(0.6 + random() * 0.02, 0.35, 0.35),
        horizon: hsl(0.58, 0.25, 0.7),
        sun: hsl(0.12, 0.25, 0.75),
        rock: hsl(0.58, 0.08, 0.42),
        water: hsl(0.55 + random() * 0.03, 0.2, 0.72),
      };
    case "nightworld":
      return {
        low: hsl(0.7 + random() * 0.08, 0.25, 0.28),
        mid: hsl(0.65 + random() * 0.1, 0.3, 0.18),
        high: hsl(0.72, 0.15, 0.12),
        peak: hsl(0.65, 0.1, 0.55),
        crater: hsl(0.75, 0.35, 0.08),
        skyTop: hsl(0.68 + random() * 0.04, 0.45, 0.12),
        horizon: hsl(0.7, 0.3, 0.28),
        sun: hsl(0.08, 0.4, 0.65),
        rock: hsl(0.7, 0.1, 0.2),
      };
    case "exotic": {
      const baseHue = random();
      const skyHue = random();
      return {
        low: hsl(
          baseHue,
          0.38 + random() * 0.25,
          0.52 + random() * 0.12,
        ),
        mid: hsl(
          baseHue + 0.14 + random() * 0.3,
          0.4 + random() * 0.28,
          0.3 + random() * 0.12,
        ),
        high: hsl(
          baseHue + random() * 0.5,
          0.08 + random() * 0.14,
          0.28 + random() * 0.08,
        ),
        peak: hsl(skyHue, 0.12, 0.86),
        crater: hsl(baseHue, 0.3, 0.14),
        skyTop: hsl(skyHue, 0.55, 0.4 + random() * 0.15),
        horizon: hsl(skyHue + 0.06, 0.4, 0.66 + random() * 0.1),
        sun: hsl(0.09 + random() * 0.06, 0.7, 0.8),
        rock: hsl(baseHue + 0.05, 0.1 + random() * 0.1, 0.32),
      };
    }
    default: {
      const _exhaustive: never = planetClass.id;
      throw new Error(`Unhandled planet class: ${_exhaustive}`);
    }
  }
}

function createSkyAndLights(
  group: THREE.Group,
  palette: WorldPalette,
  random: RandomSource,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  biome: BiomeConfig,
): Pick<
  World,
  | "sky"
  | "sun"
  | "moon"
  | "stars"
  | "sunLight"
  | "moonLight"
  | "hemisphereLight"
  | "sunAzimuth"
> {
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyContext = skyCanvas.getContext("2d");
  if (!skyContext) throw new Error("Canvas 2D context is unavailable");
  const skyGradient = skyContext.createLinearGradient(0, 0, 0, 256);
  skyGradient.addColorStop(0, `#${palette.skyTop.getHexString()}`);
  skyGradient.addColorStop(0.52, `#${palette.horizon.getHexString()}`);
  skyGradient.addColorStop(
    1,
    `#${palette.horizon.clone().multiplyScalar(0.55).getHexString()}`,
  );
  skyContext.fillStyle = skyGradient;
  skyContext.fillRect(0, 0, 4, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 12),
    new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  group.add(sky);

  const sunAzimuth = random() * Math.PI * 2;
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createRadialTexture(
        "rgba(255,250,235,1)",
        "rgba(255,220,160,0.6)",
      ),
      color: palette.sun,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
    }),
  );
  sun.scale.setScalar(150);
  group.add(sun);

  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createRadialTexture(
        "rgba(235,242,255,1)",
        "rgba(170,190,255,0.45)",
      ),
      color: "#cdd8ff",
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
    }),
  );
  moon.scale.setScalar(70);
  group.add(moon);

  const starPositions = createStarPositions(random, 800, 870);
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(starPositions, 3),
  );
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  group.add(stars);

  const sunLight = new THREE.DirectionalLight(palette.sun, 2.6);
  const moonLight = new THREE.DirectionalLight("#8fa3ff", 0);
  const hemisphereLight = new THREE.HemisphereLight(
    palette.skyTop,
    palette.low,
    0.85,
  );
  group.add(
    sunLight,
    moonLight,
    hemisphereLight,
    new THREE.AmbientLight(0xffffff, 0.12),
  );

  const fogColor = palette.horizon.clone();
  scene.fog = new THREE.Fog(fogColor, biome.fogNear, biome.fogFar);
  renderer.setClearColor(fogColor);

  return {
    sky,
    sun,
    moon,
    stars,
    sunLight,
    moonLight,
    hemisphereLight,
    sunAzimuth,
  };
}

function placeRocks(options: {
  group: THREE.Group;
  palette: WorldPalette;
  heightAt: HeightAt;
  random: RandomSource;
  noiseB: ReturnType<typeof createNoise2D>;
  rockClusters: number;
  scratch: {
    vector: THREE.Vector3;
    matrix: THREE.Matrix4;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  };
}): THREE.InstancedMesh<
  THREE.BufferGeometry,
  THREE.MeshStandardMaterial
> {
  const {
    group,
    palette,
    heightAt,
    random,
    noiseB,
    rockClusters,
    scratch,
  } = options;
  const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rockPositions = getBufferAttribute(rockGeometry, "position");
  for (let index = 0; index < rockPositions.count; index += 1) {
    scratch.vector.set(
      rockPositions.getX(index),
      rockPositions.getY(index),
      rockPositions.getZ(index),
    );
    const distortion =
      1 +
      noiseB(
        scratch.vector.x * 1.7,
        scratch.vector.y * 1.7 + scratch.vector.z,
      ) *
        0.28;
    rockPositions.setXYZ(
      index,
      scratch.vector.x * distortion,
      scratch.vector.y * distortion * 0.72,
      scratch.vector.z * distortion,
    );
  }
  rockGeometry.computeVertexNormals();

  const rockMatrices: THREE.Matrix4[] = [];
  for (let cluster = 0; cluster < rockClusters; cluster += 1) {
    const centerX = (random() * 2 - 1) * (HALF_WORLD - 20);
    const centerZ = (random() * 2 - 1) * (HALF_WORLD - 20);
    const count = 3 + Math.floor(random() * 6);
    for (let index = 0; index < count; index += 1) {
      const x = centerX + (random() * 2 - 1) * 8;
      const z = centerZ + (random() * 2 - 1) * 8;
      const size = 0.6 + random() * random() * 2.2;
      scratch.matrix.compose(
        scratch.vector.set(x, heightAt(x, z) - size * 0.18, z),
        scratch.quaternion.setFromEuler(
          new THREE.Euler(
            random() * 0.4,
            random() * Math.PI * 2,
            random() * 0.4,
          ),
        ),
        scratch.scale.set(size, size * (0.7 + random() * 0.5), size),
      );
      rockMatrices.push(scratch.matrix.clone());
    }
  }

  const rocks = new THREE.InstancedMesh(
    rockGeometry,
    new THREE.MeshStandardMaterial({
      color: palette.rock,
      flatShading: true,
      roughness: 0.95,
    }),
    rockMatrices.length,
  );
  rockMatrices.forEach((rockMatrix, index) => {
    rocks.setMatrixAt(index, rockMatrix);
  });
  rocks.frustumCulled = false;
  rocks.userData = { kind: "rock" };
  group.add(rocks);
  return rocks;
}

function placeDeposits(options: {
  group: THREE.Group;
  heightAt: HeightAt;
  random: RandomSource;
  minimumHeight: number;
  maximumHeight: number;
  planetClass: PlanetClassDefinition;
}): Record<DepositType, DepositCollection> {
  const {
    group,
    heightAt,
    random,
    minimumHeight,
    maximumHeight,
    planetClass,
  } = options;
  const pendingDeposits: Partial<
    Record<DepositType, DepositCollection>
  > = {};

  for (const type of DEPOSIT_TYPES) {
    const definition = DEPOSIT_DEFINITIONS[type];
    const materialDefinition = MATERIALS[type];
    const emissive = materialDefinition.emissive;
    const emissiveIntensity = materialDefinition.emissiveIntensity;
    if (emissive === undefined || emissiveIntensity === undefined) {
      throw new Error(`Deposit material ${type} is incomplete`);
    }
    const targetCount = depositInstanceCount(
      planetClass,
      type,
      definition.count,
    );
    const depositMaterial = new THREE.MeshStandardMaterial({
      color: materialDefinition.color,
      emissive,
      emissiveIntensity,
      flatShading: true,
      roughness: 0.55,
      metalness: type === "iron" || type === "copper" ? 0.35 : 0,
    });
    const mesh = new THREE.InstancedMesh(
      createDepositGeometry(type, random),
      depositMaterial,
      targetCount,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.userData = { kind: "deposit", type };

    const list: DepositEntry[] = [];
    const altitudeCut =
      minimumHeight +
      (maximumHeight - minimumHeight) *
        (type === "crystal"
          ? planetClass.crystalAltitudeFraction
          : 0.62);
    let attempts = 0;
    while (list.length < targetCount && attempts < targetCount * 80) {
      attempts += 1;
      const x = (random() * 2 - 1) * (HALF_WORLD - 14);
      const z = (random() * 2 - 1) * (HALF_WORLD - 14);
      const height = heightAt(x, z);
      if (definition.highAltitude && height < altitudeCut) {
        continue;
      }
      const base = (type === "crystal" ? 1 : 0.9) + random() * 0.7;
      const capacity = 6 + Math.floor(random() * 5);
      list.push({
        id: depositStableId(type, x, z),
        position: new THREE.Vector3(x, height - 0.12, z),
        yaw: random() * Math.PI * 2,
        base,
        capacity,
        remaining: capacity,
      });
    }

    mesh.count = list.length;
    const byId = new Map<string, number>();
    list.forEach((entry, index) => {
      byId.set(entry.id, index);
    });
    pendingDeposits[type] = { mesh, list, byId };
    group.add(mesh);
  }

  if (!isCompleteDepositRecord(pendingDeposits)) {
    throw new Error("World generation omitted a deposit type");
  }
  return pendingDeposits;
}

function placeSurfaceExtras(options: {
  group: THREE.Group;
  palette: WorldPalette;
  heightAt: HeightAt;
  random: RandomSource;
  surfaceKind: SurfaceKind;
  waterLevel: number;
  floraCount: number;
  minimumHeight: number;
  maximumHeight: number;
  scratch: {
    vector: THREE.Vector3;
    matrix: THREE.Matrix4;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  };
}): {
  water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhongMaterial>;
  flora: FloraCollection | null;
} {
  const {
    group,
    palette,
    heightAt,
    random,
    surfaceKind,
    waterLevel,
    floraCount,
    minimumHeight,
    maximumHeight,
    scratch,
  } = options;

  if (surfaceKind === "none") {
    throw new Error("placeSurfaceExtras requires a surface plane");
  }
  if (!palette.water) {
    throw new Error("Surface plane requires a water palette color");
  }

  const isIce = surfaceKind === "ice";
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    new THREE.MeshPhongMaterial({
      color: palette.water,
      transparent: true,
      opacity: isIce ? 0.88 : WATER_SURFACE_OPACITY,
      shininess: isIce ? 90 : 130,
      specular: isIce ? 0xddeeff : 0xbbffee,
      // Double-sided so the surface stays visible as a ceiling when submerged.
      side: THREE.DoubleSide,
    }),
  );
  water.rotateX(-Math.PI / 2);
  water.position.y = waterLevel;
  group.add(water);

  if (floraCount <= 0) {
    return { water, flora: null };
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.09, 0.16, 1, 5);
  trunkGeometry.translate(0, 0.5, 0);
  const canopyGeometry = new THREE.IcosahedronGeometry(0.62, 0);
  const treeLocations: {
    x: number;
    z: number;
    height: number;
    size: number;
    yaw: number;
    hue: number;
    lightness: number;
  }[] = [];
  let attempts = 0;
  const maxAttempts = Math.max(9000, floraCount * 40);

  while (treeLocations.length < floraCount && attempts < maxAttempts) {
    attempts += 1;
    const x = (random() * 2 - 1) * (HALF_WORLD - 16);
    const z = (random() * 2 - 1) * (HALF_WORLD - 16);
    const height = heightAt(x, z);
    const altitude =
      (height - minimumHeight) / (maximumHeight - minimumHeight);
    if (
      altitude < 0.23 ||
      altitude > 0.55 ||
      height < waterLevel + 1.2
    ) {
      continue;
    }

    const heightDeltaX =
      (heightAt(x + 2, z) - heightAt(x - 2, z)) / 4;
    const heightDeltaZ =
      (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
    const normalY =
      1 /
      Math.sqrt(
        heightDeltaX * heightDeltaX +
          1 +
          heightDeltaZ * heightDeltaZ,
      );
    if (normalY < 0.82) continue;

    treeLocations.push({
      x,
      z,
      height,
      size: 2 + random() * 2.2,
      yaw: random() * Math.PI * 2,
      hue: 0.27 + random() * 0.09,
      lightness: 0.28 + random() * 0.14,
    });
  }

  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    new THREE.MeshStandardMaterial({
      color: "#7a5a3d",
      flatShading: true,
      roughness: 1,
    }),
    treeLocations.length,
  );
  const canopies = new THREE.InstancedMesh(
    canopyGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      flatShading: true,
      roughness: 0.9,
    }),
    treeLocations.length,
  );
  const canopyColor = new THREE.Color();

  treeLocations.forEach((tree, index) => {
    scratch.matrix.compose(
      scratch.vector.set(tree.x, tree.height - 0.1, tree.z),
      scratch.quaternion.setFromEuler(new THREE.Euler(0, tree.yaw, 0)),
      scratch.scale.set(tree.size * 0.9, tree.size, tree.size * 0.9),
    );
    trunks.setMatrixAt(index, scratch.matrix);

    scratch.matrix.compose(
      scratch.vector.set(
        tree.x,
        tree.height + tree.size * 0.98,
        tree.z,
      ),
      scratch.quaternion.setFromEuler(
        new THREE.Euler(random() * 0.3, tree.yaw, random() * 0.3),
      ),
      scratch.scale.set(
        tree.size * 0.8,
        tree.size * 0.66,
        tree.size * 0.8,
      ),
    );
    canopies.setMatrixAt(index, scratch.matrix);
    canopies.setColorAt(
      index,
      canopyColor.setHSL(tree.hue, 0.5, tree.lightness),
    );
  });

  trunks.frustumCulled = false;
  canopies.frustumCulled = false;
  trunks.userData = { kind: "flora" };
  canopies.userData = { kind: "flora" };
  group.add(trunks, canopies);

  return { water, flora: { trunks, canopies } };
}

function chooseSpawn(options: {
  seed: number;
  heightAt: HeightAt;
  hasLiquid: boolean;
  waterLevel: number;
}): THREE.Vector3 {
  const { seed, heightAt, hasLiquid, waterLevel } = options;
  let bestSpawn: { x: number; z: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const spawnRandom = mulberry32(seed ^ 0x165667b1);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const x = (spawnRandom() * 2 - 1) * 90;
    const z = (spawnRandom() * 2 - 1) * 90;
    const height = heightAt(x, z);
    let score =
      Math.abs(heightAt(x + 3, z) - height) +
      Math.abs(heightAt(x, z + 3) - height);
    score += liquidWaterPenalty(
      height,
      waterLevel,
      hasLiquid,
      1.5,
      100,
    );
    if (score < bestScore) {
      bestScore = score;
      bestSpawn = { x, z };
    }
  }

  const selectedSpawn = bestSpawn ?? { x: 0, z: 0 };
  return new THREE.Vector3(
    selectedSpawn.x,
    heightAt(selectedSpawn.x, selectedSpawn.z),
    selectedSpawn.z,
  );
}

/**
 * Deterministically assemble a seed-specific world into the scene.
 * Caller must dispose any previous world before build resolves. The
 * heightfield fills in chunks that yield to the frame loop; RNG draw
 * order is unchanged, so generation stays seed-deterministic.
 */
export async function buildWorld(options: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  seed: number;
}): Promise<World> {
  const { scene, renderer, seed } = options;

  // Every random stream is seed-derived; generation order is deterministic.
  const random = mulberry32(seed);
  const noiseA = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
  const noiseB = createNoise2D(mulberry32(seed ^ 0x85ebca6b));
  const noiseC = createNoise2D(mulberry32(seed ^ 0xc2b2ae35));
  const fbmA = makeFbm(noiseA);
  const fbmB = makeFbm(noiseB);
  const fbmC = makeFbm(noiseC);

  const planetClass = pickPlanetClass(random);
  const biome = biomeFromPlanetClass(planetClass);
  const palette = createPalette(random, planetClass);
  const hasLiquid = hasLiquidWater(planetClass);
  const group = new THREE.Group();
  scene.add(group);

  const heightField = await fillHeightField(
    biome,
    planetClass,
    fbmA,
    fbmB,
    fbmC,
  );
  const scratch = {
    vector: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };

  const surface = buildTerrainSurface({
    heights: heightField.heights,
    minimumHeight: heightField.minimumHeight,
    maximumHeight: heightField.maximumHeight,
    biome,
    palette,
    noiseB,
    noiseC,
    scratchNormal: scratch.vector,
  });
  group.add(surface.terrain);

  const celestial = createSkyAndLights(
    group,
    palette,
    random,
    scene,
    renderer,
    biome,
  );

  // Placement samples snap to grid vertices; physics uses surface.heightAt.
  const placementHeightAt = createGridHeightAt(heightField.heights);

  const rocks = placeRocks({
    group,
    palette,
    heightAt: placementHeightAt,
    random,
    noiseB,
    rockClusters: planetClass.rockClusters,
    scratch,
  });

  const deposits = placeDeposits({
    group,
    heightAt: placementHeightAt,
    random,
    minimumHeight: heightField.minimumHeight,
    maximumHeight: heightField.maximumHeight,
    planetClass,
  });

  let water: World["water"] = null;
  let flora: FloraCollection | null = null;
  if (hasSurfacePlane(planetClass)) {
    const extras = placeSurfaceExtras({
      group,
      palette,
      heightAt: placementHeightAt,
      random,
      surfaceKind: planetClass.surface,
      waterLevel: heightField.waterLevel,
      floraCount: planetClass.floraCount,
      minimumHeight: heightField.minimumHeight,
      maximumHeight: heightField.maximumHeight,
      scratch,
    });
    water = extras.water;
    flora = extras.flora;
  }

  const spawn = chooseSpawn({
    seed,
    heightAt: placementHeightAt,
    hasLiquid,
    waterLevel: heightField.waterLevel,
  });
  const faunaPlan = planFauna({
    seed,
    heightAt: placementHeightAt,
    spawnX: spawn.x,
    spawnZ: spawn.z,
    hasLiquid,
    waterLevel: heightField.waterLevel,
  });
  const roverPlan = planRovers({
    seed,
    heightAt: placementHeightAt,
    spawnX: spawn.x,
    spawnZ: spawn.z,
    hasLiquid,
    waterLevel: heightField.waterLevel,
  });

  const world: World = {
    seed,
    random,
    group,
    palette,
    terrain: surface.terrain,
    heights: heightField.heights,
    gridToVertex: surface.gridToVertex,
    minimumHeight: heightField.minimumHeight,
    maximumHeight: heightField.maximumHeight,
    heightAt: surface.heightAt,
    gridNormal: surface.gridNormal,
    vertexColor: surface.vertexColor,
    rocks,
    deposits,
    colorAttribute: surface.colorAttribute,
    positionAttribute: surface.positionAttribute,
    normalAttribute: surface.normalAttribute,
    crystalMaterial: deposits.crystal.mesh.material,
    planetClassId: planetClass.id,
    surfaceKind: planetClass.surface,
    lighting: planetClass.lighting,
    walkSpeedFactor: planetClass.walkSpeedFactor,
    biome,
    water,
    waterLevel: heightField.waterLevel,
    flora,
    sky: celestial.sky,
    sun: celestial.sun,
    moon: celestial.moon,
    stars: celestial.stars,
    sunLight: celestial.sunLight,
    moonLight: celestial.moonLight,
    hemisphereLight: celestial.hemisphereLight,
    sunAzimuth: celestial.sunAzimuth,
    timeOrigin: -1,
    spawn,
    name: createPlanetName(mulberry32(seed ^ 0x27d4eb2f)),
    aimIndex: buildSpatialAimIndex({ rocks, deposits, flora }),
    caves: null,
    hasFauna: faunaPlan.hasFauna,
    faunaPlan,
    faunaAimTargets: [],
    roverPlan,
  };

  for (const type of DEPOSIT_TYPES) {
    world.deposits[type].list.forEach((_entry, index) => {
      refreshDepositInstance(world, type, index, scratch);
    });
  }

  return world;
}
