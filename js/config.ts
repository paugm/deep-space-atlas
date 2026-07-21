/** Shared game config and deterministic helpers. No DOM or Three.js imports. */

export type MaterialId =
  | "silicate"
  | "iron"
  | "carbon"
  | "copper"
  | "crystal";

export type DepositType = Exclude<MaterialId, "silicate">;

export interface MaterialDefinition {
  label: string;
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface DepositDefinition {
  label: string;
  count: number;
  chime: number;
  highAltitude?: boolean;
}

export type Inventory = Record<MaterialId, number>;
export type RandomSource = () => number;
export type Noise2D = (x: number, y: number) => number;
export type FbmNoise2D = (
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
) => number;

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (start: number, end: number, amount: number): number =>
  start + (end - start) * amount;

export function smoothstep(min: number, max: number, value: number): number {
  const amount = clamp((value - min) / (max - min), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

/** Deterministic PRNG; values in [0, 1). */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;

  return function random(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise2D(random: RandomSource): Noise2D {
  const gradients: readonly (readonly [number, number])[] = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const values = new Uint8Array(256);

  for (let index = 0; index < 256; index += 1) values[index] = index;
  for (let index = 255; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target]!, values[index]!];
  }

  const permutation = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) {
    permutation[index] = values[index & 255]!;
  }

  const skew = 0.5 * (Math.sqrt(3) - 1);
  const unskew = (3 - Math.sqrt(3)) / 6;

  return function noise(xInput: number, yInput: number): number {
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    const offset = (xInput + yInput) * skew;
    const gridX = Math.floor(xInput + offset);
    const gridY = Math.floor(yInput + offset);
    const unskewOffset = (gridX + gridY) * unskew;
    const x0 = xInput - (gridX - unskewOffset);
    const y0 = yInput - (gridY - unskewOffset);
    const xStep = x0 > y0 ? 1 : 0;
    const yStep = x0 > y0 ? 0 : 1;
    const x1 = x0 - xStep + unskew;
    const y1 = y0 - yStep + unskew;
    const x2 = x0 - 1 + 2 * unskew;
    const y2 = y0 - 1 + 2 * unskew;
    const wrappedX = gridX & 255;
    const wrappedY = gridY & 255;

    let contribution = 0.5 - x0 * x0 - y0 * y0;
    if (contribution > 0) {
      contribution *= contribution;
      const gradient =
        gradients[
          permutation[wrappedX + permutation[wrappedY]!]! % gradients.length
        ]!;
      n0 =
        contribution *
        contribution *
        (gradient[0] * x0 + gradient[1] * y0);
    }

    contribution = 0.5 - x1 * x1 - y1 * y1;
    if (contribution > 0) {
      contribution *= contribution;
      const gradient =
        gradients[
          permutation[
            wrappedX + xStep + permutation[wrappedY + yStep]!
          ]! % gradients.length
        ]!;
      n1 =
        contribution *
        contribution *
        (gradient[0] * x1 + gradient[1] * y1);
    }

    contribution = 0.5 - x2 * x2 - y2 * y2;
    if (contribution > 0) {
      contribution *= contribution;
      const gradient =
        gradients[
          permutation[wrappedX + 1 + permutation[wrappedY + 1]!]! %
            gradients.length
        ]!;
      n2 =
        contribution *
        contribution *
        (gradient[0] * x2 + gradient[1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  };
}

export function makeFbm(noise: Noise2D): FbmNoise2D {
  return function fbm(
    x: number,
    y: number,
    octaves: number,
    lacunarity: number,
    gain: number,
  ): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let normalization = 0;

    for (let octave = 0; octave < octaves; octave += 1) {
      sum += amplitude * noise(x * frequency, y * frequency);
      normalization += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return sum / normalization;
  };
}

export const WORLD_SIZE = 1000;
export const SEGMENTS = 400;
export const HALF_WORLD = WORLD_SIZE / 2;
export const TERRAIN_STEP = WORLD_SIZE / SEGMENTS;
export const VERTICES_PER_ROW = SEGMENTS + 1;

export const EYE_HEIGHT = 1.7;
export const GRAVITY = 27;
export const JUMP_VELOCITY = 9.6;
export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 12.2;
export const ROVER_DRIVE_SPEED = 18.5;
/** Below on-foot eye height. */
export const ROVER_SEAT_HEIGHT = 1.15;

export const PLAYER_RADIUS = 0.38;
/** Icosahedron rocks use unit radius; collider ≈ max scale × this. */
export const ROCK_COLLIDER_RADIUS_FACTOR = 0.85;
export const PLAYER_COLLISION_ITERATIONS = 3;
export const PLAYER_COLLISION_QUERY_RADIUS = 5;

/** Swimming movement while torso-submerged. */
export const WATER_MOVE_FACTOR = 0.48;
export const WATER_GRAVITY_FACTOR = 0.42;
export const WATER_VERTICAL_DRAG = 3.5;
export const WATER_DEPTH_FOR_FULL_FOG = 4;
export const WATER_FOG_NEAR = 1.5;
export const WATER_FOG_FAR = 22;
export const WATER_SURFACE_OPACITY = 0.72;
export const WATER_UNDER_OPACITY = 0.94;

export const MINING_RANGE = 15;
export const MINING_TIME = 0.8;
export const MINING_RING_CIRCUMFERENCE = 138.23;
export const DAY_LENGTH = 210;

/** Sparse volumetric terrain is allocated only for chunks touched by digs. */
export const CAVE_CHUNK_SIZE = 20;
export const CAVE_CELL_SIZE = 0.5;
export const CAVE_CELLS_PER_CHUNK = CAVE_CHUNK_SIZE / CAVE_CELL_SIZE;
export const CAVE_SAMPLES_PER_CHUNK = CAVE_CELLS_PER_CHUNK + 1;
/** Player-sized directional dig capsule (3.2 m nominal tunnel diameter). */
export const CAVE_DIG_RADIUS = 1.6;
export const CAVE_DIG_LENGTH = 1.65;
/** Overlap the previous capsule so straight strokes compact without changing shape. */
export const CAVE_DIG_BACKTRACK = 1.7;
/** Cave meshes stream independently from their compact brush save records. */
export const CAVE_MESH_LOAD_RADIUS = 68;
export const CAVE_MESH_UNLOAD_RADIUS = 104;

export const JET_ACCELERATION = GRAVITY + 20;
export const JET_BURN_SECONDS = 3.2;
export const JET_RECHARGE_SECONDS = 2.2;
export const JET_MAX_VERTICAL_SPEED = 16;

export const MATERIALS: Record<MaterialId, MaterialDefinition> = {
  silicate: { label: "Silicate", color: "#d8c28e" },
  iron: {
    label: "Iron",
    color: "#d0855a",
    emissive: "#8a3a16",
    emissiveIntensity: 0.35,
  },
  carbon: {
    label: "Carbon",
    color: "#33303f",
    emissive: "#5c49d8",
    emissiveIntensity: 0.55,
  },
  copper: {
    label: "Copper",
    color: "#31c2ab",
    emissive: "#0d6e63",
    emissiveIntensity: 0.55,
  },
  crystal: {
    label: "Aetherite",
    color: "#ff6bf0",
    emissive: "#e03bd6",
    emissiveIntensity: 1.5,
  },
};

export const MATERIAL_ORDER: readonly MaterialId[] = [
  "silicate",
  "iron",
  "carbon",
  "copper",
  "crystal",
];

export const DEPOSIT_DEFINITIONS: Record<DepositType, DepositDefinition> = {
  iron: { label: "IRON DEPOSIT", count: 85, chime: 440 },
  carbon: { label: "CARBON CRYSTALS", count: 65, chime: 392 },
  copper: { label: "COPPER NODES", count: 55, chime: 587 },
  crystal: {
    label: "AETHERITE SPIRE",
    count: 24,
    chime: 784,
    highAltitude: true,
  },
};

// Object.keys preserves the declaration order used by procedural generation.
export const DEPOSIT_TYPES: readonly DepositType[] = Object.keys(
  DEPOSIT_DEFINITIONS,
) as DepositType[];

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
