import type * as THREE from "three";

import type { DepositType, RandomSource } from "../config.ts";
import type { FaunaSpeciesId } from "../fauna/species.ts";
import type { RoverKindId } from "../vehicles/kinds.ts";
import type { PlanetDocument } from "../planet-save.ts";
import type { CaveRuntime } from "./cave-runtime.ts";
import type { CaveBrush, CavePoint } from "./caves.ts";
import type {
  PlanetClassId,
  PlanetLighting,
  SurfaceKind,
} from "./planet-class.ts";

/** Terrain-generation controls form a stable contract for gameplay and UI. */
export interface BiomeConfig {
  label: string;
  continent: number;
  hills: number;
  mountains: number;
  maskLow: number;
  maskHigh: number;
  colorCuts: [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  fogNear: number;
  fogFar: number;
}

export interface DepositEntry {
  /** Stable id from type and quantized XZ, used by planet saves. */
  id: string;
  position: THREE.Vector3;
  yaw: number;
  base: number;
  capacity: number;
  remaining: number;
}

export interface DepositCollection {
  mesh: THREE.InstancedMesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  list: DepositEntry[];
  /** id → instance index for O(1) save apply. */
  byId: Map<string, number>;
}

export interface WorldPalette {
  low: THREE.Color;
  mid: THREE.Color;
  high: THREE.Color;
  peak: THREE.Color;
  crater: THREE.Color;
  skyTop: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  rock: THREE.Color;
  water?: THREE.Color;
}

export interface FloraCollection {
  trunks: THREE.InstancedMesh<
    THREE.CylinderGeometry,
    THREE.MeshStandardMaterial
  >;
  canopies: THREE.InstancedMesh<
    THREE.IcosahedronGeometry,
    THREE.MeshStandardMaterial
  >;
}

export type HeightAt = (x: number, z: number) => number;
export type GridNormal = (
  xIndex: number,
  zIndex: number,
  output: THREE.Vector3,
) => THREE.Vector3;
export type VertexColor = (
  xIndex: number,
  zIndex: number,
  normalY: number,
  output: THREE.Color,
) => THREE.Color;


export interface FaunaSpawnSpec {
  id: string;
  species: FaunaSpeciesId;
  x: number;
  z: number;
}

export interface FaunaPlanSpec {
  hasFauna: boolean;
  spawns: readonly FaunaSpawnSpec[];
}

export interface RoverSpawnSpec {
  id: string;
  kind: RoverKindId;
  x: number;
  z: number;
  yaw: number;
}

export interface RoverPlanSpec {
  spawns: readonly RoverSpawnSpec[];
}

export interface FaunaAimTarget {
  creatureId: string;
  species: FaunaSpeciesId;
  role: "wild" | "pet";
  object: THREE.Object3D;
}

export type AimCandidate =
  | { kind: "rock"; index: number }
  | { kind: "flora"; index: number }
  | { kind: "deposit"; type: DepositType; index: number };

export interface SpatialAimIndex {
  readonly cellSize: number;
  /** Candidates whose XZ falls in cells overlapping the query circle. */
  query(x: number, z: number, radius: number): AimCandidate[];
}

/** The active world owns every seed-specific GPU and procedural resource. */
export interface World {
  seed: number;
  random: RandomSource;
  group: THREE.Group;
  palette: WorldPalette;
  terrain: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshLambertMaterial
  >;
  heights: Float32Array;
  gridToVertex: Int32Array;
  minimumHeight: number;
  maximumHeight: number;
  heightAt: HeightAt;
  gridNormal: GridNormal;
  vertexColor: VertexColor;
  rocks: THREE.InstancedMesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  deposits: Record<DepositType, DepositCollection>;
  colorAttribute: THREE.BufferAttribute;
  positionAttribute: THREE.BufferAttribute;
  normalAttribute: THREE.BufferAttribute;
  crystalMaterial: THREE.MeshStandardMaterial;
  planetClassId: PlanetClassId;
  surfaceKind: SurfaceKind;
  lighting: PlanetLighting;
  walkSpeedFactor: number;
  biome: BiomeConfig;
  /** Surface plane mesh (swimable water or visual ice). */
  water: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshPhongMaterial
  > | null;
  waterLevel: number;
  flora: FloraCollection | null;
  sky: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  >;
  sun: THREE.Sprite;
  moon: THREE.Sprite;
  stars: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
  sunLight: THREE.DirectionalLight;
  moonLight: THREE.DirectionalLight;
  hemisphereLight: THREE.HemisphereLight;
  sunAzimuth: number;
  timeOrigin: number;
  spawn: THREE.Vector3;
  name: string;
  aimIndex: SpatialAimIndex;
  /** Sparse volumetric terrain runtime, initialized after save patches apply. */
  caves: CaveRuntime | null;
  hasFauna: boolean;
  faunaPlan: FaunaPlanSpec;
  /** Filled by the fauna runtime; empty until creatures mount. */
  faunaAimTargets: FaunaAimTarget[];
  /** Seeded wheeled-rover pads (overridden by saved rover entities). */
  roverPlan: RoverPlanSpec;
}

interface TerrainAimHit {
  kind: "terrain";
  point: THREE.Vector3;
  distance: number;
}

interface RockAimHit {
  kind: "rock";
  index: number;
  point: THREE.Vector3;
  distance: number;
}

interface FloraAimHit {
  kind: "flora";
  index: number;
  point: THREE.Vector3;
  distance: number;
}

interface DepositAimHit {
  kind: "deposit";
  type: DepositType;
  index: number;
  point: THREE.Vector3;
  distance: number;
}

interface FaunaAimHit {
  kind: "fauna";
  creatureId: string;
  species: FaunaSpeciesId;
  role: "wild" | "pet";
  point: THREE.Vector3;
  distance: number;
}

export type AimHit =
  | TerrainAimHit
  | RockAimHit
  | FloraAimHit
  | DepositAimHit
  | FaunaAimHit;

/** Methods requiring a world are called only while current is non-null. */
export interface WorldSystem {
  build(seed: number): Promise<World>;
  dispose(): void;
  refreshDeposit(type: DepositType, index: number): void;
  /** Optional camera Y drives underwater fog / water-plane opacity. */
  updateDayNight(time: number, cameraY?: number): void;
  carveCave(
    point: CavePoint,
    direction: CavePoint,
    options?: { radius?: number; length?: number },
  ): CaveBrush | null;
  applyPlanetPatch(document: PlanetDocument): Promise<void>;
  updateTerrain(viewPosition: CavePoint): readonly CaveBrush[];
  getAimHit(camera: THREE.Camera, range?: number): AimHit | null;
  readonly current: World | null;
}

export type WorldObjectMetadata =
  | { kind: "rock" }
  | { kind: "flora" }
  | { kind: "deposit"; type: DepositType };

export interface TerrainRayHit {
  point: THREE.Vector3;
  distance: number;
}
