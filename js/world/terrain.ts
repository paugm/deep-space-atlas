import * as THREE from "three";

import {
  CAVE_CHUNK_SIZE,
  HALF_WORLD,
  SEGMENTS,
  TERRAIN_STEP,
  VERTICES_PER_ROW,
  WORLD_SIZE,
  clamp,
  lerp,
  smoothstep,
} from "../config.ts";
import type { FbmNoise2D, Noise2D } from "../config.ts";
import type { TerrainHeightSample } from "../planet-save.ts";
import {
  waterLevelForPlanetClass,
  type PlanetClassDefinition,
} from "./planet-class.ts";
import type {
  BiomeConfig,
  GridNormal,
  HeightAt,
  TerrainRayHit,
  VertexColor,
  World,
  WorldPalette,
} from "./types.ts";
import {
  generatedArrayValue,
  getBufferAttribute,
  gridIndex,
} from "./util.ts";

export interface HeightField {
  heights: Float32Array;
  minimumHeight: number;
  maximumHeight: number;
  waterLevel: number;
}

/**
 * Fill the heightfield in row chunks, yielding between them so the frame
 * loop keeps rendering during world build. Output is identical regardless
 * of chunk size: noise inputs depend only on vertex coordinates.
 */
export async function fillHeightField(
  biome: BiomeConfig,
  planetClass: PlanetClassDefinition,
  fbmA: FbmNoise2D,
  fbmB: FbmNoise2D,
  fbmC: FbmNoise2D,
): Promise<HeightField> {
  const heights = new Float32Array(
    VERTICES_PER_ROW * VERTICES_PER_ROW,
  );
  const heightFunction = (x: number, z: number): number => {
    const continent = fbmA(x * 0.0022, z * 0.0022, 3, 2, 0.5);
    const hills = fbmA(
      x * 0.0085 + 31.7,
      z * 0.0085 - 12.3,
      5,
      2.05,
      0.5,
    );
    const ridge =
      1 - Math.abs(fbmB(x * 0.004, z * 0.004, 4, 2.2, 0.55));
    const mask = smoothstep(
      biome.maskLow,
      biome.maskHigh,
      fbmC(x * 0.0019, z * 0.0019, 2, 2, 0.5),
    );
    return (
      continent * biome.continent +
      hills * biome.hills +
      mask * Math.pow(ridge, 1.8) * biome.mountains
    );
  };

  const ROWS_PER_CHUNK = 24;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;
  for (
    let zStart = 0;
    zStart < VERTICES_PER_ROW;
    zStart += ROWS_PER_CHUNK
  ) {
    const zEnd = Math.min(zStart + ROWS_PER_CHUNK, VERTICES_PER_ROW);
    for (let zIndex = zStart; zIndex < zEnd; zIndex += 1) {
      for (let xIndex = 0; xIndex < VERTICES_PER_ROW; xIndex += 1) {
        const height = heightFunction(
          -HALF_WORLD + xIndex * TERRAIN_STEP,
          -HALF_WORLD + zIndex * TERRAIN_STEP,
        );
        heights[gridIndex(xIndex, zIndex)] = height;
        minimumHeight = Math.min(minimumHeight, height);
        maximumHeight = Math.max(maximumHeight, height);
      }
    }
    if (zEnd < VERTICES_PER_ROW) await yieldToFrame();
  }

  return {
    heights,
    minimumHeight,
    maximumHeight,
    waterLevel: waterLevelForPlanetClass(
      planetClass,
      minimumHeight,
      maximumHeight,
    ),
  };
}

function yieldToFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createHeightAt(heights: Float32Array): HeightAt {
  return (x, z) => {
    const gridX = clamp(
      (x + HALF_WORLD) / TERRAIN_STEP,
      0,
      SEGMENTS - 0.001,
    );
    const gridZ = clamp(
      (z + HALF_WORLD) / TERRAIN_STEP,
      0,
      SEGMENTS - 0.001,
    );
    const xIndex = Math.floor(gridX);
    const zIndex = Math.floor(gridZ);
    const xAmount = gridX - xIndex;
    const zAmount = gridZ - zIndex;
    const h00 = generatedArrayValue(
      heights,
      gridIndex(xIndex, zIndex),
    );
    const h10 = generatedArrayValue(
      heights,
      gridIndex(xIndex + 1, zIndex),
    );
    const h01 = generatedArrayValue(
      heights,
      gridIndex(xIndex, zIndex + 1),
    );
    const h11 = generatedArrayValue(
      heights,
      gridIndex(xIndex + 1, zIndex + 1),
    );
    return lerp(
      lerp(h00, h10, xAmount),
      lerp(h01, h11, xAmount),
      zAmount,
    );
  };
}

/**
 * Nearest-vertex height read for one-off placement sampling (rocks, flora,
 * deposits, spawn). Avoids bilinear interpolation cost; gameplay physics
 * keeps the smooth `createHeightAt` reader.
 */
export function createGridHeightAt(heights: Float32Array): HeightAt {
  return (x, z) => {
    const xIndex = clamp(
      Math.round((x + HALF_WORLD) / TERRAIN_STEP),
      0,
      SEGMENTS,
    );
    const zIndex = clamp(
      Math.round((z + HALF_WORLD) / TERRAIN_STEP),
      0,
      SEGMENTS,
    );
    return generatedArrayValue(heights, gridIndex(xIndex, zIndex));
  };
}

export function createGridNormal(heights: Float32Array): GridNormal {
  return (xIndex, zIndex, output) => {
    const left = generatedArrayValue(
      heights,
      gridIndex(Math.max(xIndex - 1, 0), zIndex),
    );
    const right = generatedArrayValue(
      heights,
      gridIndex(Math.min(xIndex + 1, SEGMENTS), zIndex),
    );
    const down = generatedArrayValue(
      heights,
      gridIndex(xIndex, Math.max(zIndex - 1, 0)),
    );
    const up = generatedArrayValue(
      heights,
      gridIndex(xIndex, Math.min(zIndex + 1, SEGMENTS)),
    );
    return output
      .set(
        -(right - left) / (2 * TERRAIN_STEP),
        1,
        -(up - down) / (2 * TERRAIN_STEP),
      )
      .normalize();
  };
}

export function createVertexColor(options: {
  heights: Float32Array;
  minimumHeight: number;
  maximumHeight: number;
  biome: BiomeConfig;
  palette: WorldPalette;
  noiseB: Noise2D;
  noiseC: Noise2D;
}): VertexColor {
  const {
    heights,
    minimumHeight,
    maximumHeight,
    biome,
    palette,
    noiseB,
    noiseC,
  } = options;
  const rockColor = new THREE.Color();

  return (xIndex, zIndex, normalY, output) => {
    const x = -HALF_WORLD + xIndex * TERRAIN_STEP;
    const z = -HALF_WORLD + zIndex * TERRAIN_STEP;
    const jitter = noiseC(x * 0.05, z * 0.05) * 0.05;
    const altitude = clamp(
      (generatedArrayValue(heights, gridIndex(xIndex, zIndex)) -
        minimumHeight) /
        (maximumHeight - minimumHeight) +
        jitter,
      0,
      1,
    );
    const [cut0, cut1, cut2, cut3, cut4, cut5] = biome.colorCuts;

    if (altitude < cut0) output.copy(palette.low);
    else if (altitude < cut1) {
      output
        .copy(palette.low)
        .lerp(palette.mid, (altitude - cut0) / (cut1 - cut0));
    } else if (altitude < cut2) output.copy(palette.mid);
    else if (altitude < cut3) {
      output
        .copy(palette.mid)
        .lerp(palette.high, (altitude - cut2) / (cut3 - cut2));
    } else if (altitude < cut4) output.copy(palette.high);
    else if (altitude < cut5) {
      output
        .copy(palette.high)
        .lerp(palette.peak, (altitude - cut4) / (cut5 - cut4));
    } else output.copy(palette.peak);

    const steepness = 1 - smoothstep(0.55, 0.8, normalY);
    output.lerp(rockColor.copy(palette.rock), steepness * 0.85);
    output.multiplyScalar(1 + noiseB(x * 0.11, z * 0.11) * 0.07);
    return output;
  };
}

export interface TerrainSurface {
  terrain: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshLambertMaterial
  >;
  gridToVertex: Int32Array;
  colorAttribute: THREE.BufferAttribute;
  positionAttribute: THREE.BufferAttribute;
  normalAttribute: THREE.BufferAttribute;
  heightAt: HeightAt;
  gridNormal: GridNormal;
  vertexColor: VertexColor;
}

export function buildTerrainSurface(options: {
  heights: Float32Array;
  minimumHeight: number;
  maximumHeight: number;
  biome: BiomeConfig;
  palette: WorldPalette;
  noiseB: Noise2D;
  noiseC: Noise2D;
  scratchNormal: THREE.Vector3;
}): TerrainSurface {
  const {
    heights,
    minimumHeight,
    maximumHeight,
    biome,
    palette,
    noiseB,
    noiseC,
    scratchNormal,
  } = options;

  const terrainGeometry = new THREE.PlaneGeometry(
    WORLD_SIZE,
    WORLD_SIZE,
    SEGMENTS,
    SEGMENTS,
  );
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = getBufferAttribute(terrainGeometry, "position");
  const gridToVertex = new Int32Array(
    VERTICES_PER_ROW * VERTICES_PER_ROW,
  );

  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const xIndex = Math.round(
      (positions.getX(vertex) + HALF_WORLD) / TERRAIN_STEP,
    );
    const zIndex = Math.round(
      (positions.getZ(vertex) + HALF_WORLD) / TERRAIN_STEP,
    );
    gridToVertex[gridIndex(xIndex, zIndex)] = vertex;
    positions.setY(
      vertex,
      generatedArrayValue(heights, gridIndex(xIndex, zIndex)),
    );
  }

  const normals = new Float32Array(positions.count * 3);
  const colors = new Float32Array(positions.count * 3);
  const normalAttribute = new THREE.BufferAttribute(normals, 3);
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  terrainGeometry.setAttribute("normal", normalAttribute);
  terrainGeometry.setAttribute("color", colorAttribute);

  const gridNormal = createGridNormal(heights);
  const vertexColor = createVertexColor({
    heights,
    minimumHeight,
    maximumHeight,
    biome,
    palette,
    noiseB,
    noiseC,
  });
  const color = new THREE.Color();

  for (let zIndex = 0; zIndex < VERTICES_PER_ROW; zIndex += 1) {
    for (let xIndex = 0; xIndex < VERTICES_PER_ROW; xIndex += 1) {
      const vertex = generatedArrayValue(
        gridToVertex,
        gridIndex(xIndex, zIndex),
      );
      gridNormal(xIndex, zIndex, scratchNormal);
      normals[vertex * 3] = scratchNormal.x;
      normals[vertex * 3 + 1] = scratchNormal.y;
      normals[vertex * 3 + 2] = scratchNormal.z;
      vertexColor(xIndex, zIndex, scratchNormal.y, color);
      colors[vertex * 3] = color.r;
      colors[vertex * 3 + 1] = color.g;
      colors[vertex * 3 + 2] = color.b;
    }
  }

  const terrain = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  terrain.userData = { kind: "terrain" };

  return {
    terrain,
    gridToVertex,
    colorAttribute,
    positionAttribute: positions,
    normalAttribute,
    heightAt: createHeightAt(heights),
    gridNormal,
    vertexColor,
  };
}

export function refreshTerrainNormals(
  world: World,
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
  scratchNormal: THREE.Vector3,
): void {
  for (
    let zIndex = Math.max(0, minimumZ - 1);
    zIndex <= Math.min(SEGMENTS, maximumZ + 1);
    zIndex += 1
  ) {
    for (
      let xIndex = Math.max(0, minimumX - 1);
      xIndex <= Math.min(SEGMENTS, maximumX + 1);
      xIndex += 1
    ) {
      const vertex = generatedArrayValue(
        world.gridToVertex,
        gridIndex(xIndex, zIndex),
      );
      world.gridNormal(xIndex, zIndex, scratchNormal);
      world.normalAttribute.setXYZ(
        vertex,
        scratchNormal.x,
        scratchNormal.y,
        scratchNormal.z,
      );
    }
  }
}

/**
 * Replace complete 20 m surface tiles with volumetric cave meshes. Rebuilding
 * this compact index is infrequent (only when an entrance streams in/out) and
 * leaves height/color/normal buffers untouched.
 */
export function setHiddenTerrainSurfaceTiles(
  world: World,
  hiddenTiles: ReadonlySet<number>,
): void {
  const segmentsPerTile = CAVE_CHUNK_SIZE / TERRAIN_STEP;
  const tilesPerAxis = WORLD_SIZE / CAVE_CHUNK_SIZE;
  const visibleQuadCount =
    SEGMENTS * SEGMENTS - hiddenTiles.size * segmentsPerTile * segmentsPerTile;
  const indices = new Uint32Array(Math.max(0, visibleQuadCount) * 6);
  let offset = 0;

  for (let zIndex = 0; zIndex < SEGMENTS; zIndex += 1) {
    const tileZ = Math.floor(zIndex / segmentsPerTile);
    for (let xIndex = 0; xIndex < SEGMENTS; xIndex += 1) {
      const tileX = Math.floor(xIndex / segmentsPerTile);
      if (hiddenTiles.has(tileZ * tilesPerAxis + tileX)) continue;
      const bottomLeft = generatedArrayValue(
        world.gridToVertex,
        gridIndex(xIndex, zIndex),
      );
      const bottomRight = generatedArrayValue(
        world.gridToVertex,
        gridIndex(xIndex + 1, zIndex),
      );
      const topLeft = generatedArrayValue(
        world.gridToVertex,
        gridIndex(xIndex, zIndex + 1),
      );
      const topRight = generatedArrayValue(
        world.gridToVertex,
        gridIndex(xIndex + 1, zIndex + 1),
      );
      indices[offset] = bottomLeft;
      indices[offset + 1] = topLeft;
      indices[offset + 2] = bottomRight;
      indices[offset + 3] = topLeft;
      indices[offset + 4] = topRight;
      indices[offset + 5] = bottomRight;
      offset += 6;
    }
  }
  world.terrain.geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
}

export async function applyHeightSamples(
  world: World,
  samples: ReadonlyArray<TerrainHeightSample>,
  scratchNormal: THREE.Vector3,
): Promise<void> {
  if (samples.length === 0) return;

  const color = new THREE.Color();
  let minimumX = SEGMENTS;
  let maximumX = 0;
  let minimumZ = SEGMENTS;
  let maximumZ = 0;

  for (let sampleOffset = 0; sampleOffset < samples.length; sampleOffset += 1) {
    const sample = samples[sampleOffset]!;
    if (sample.index < 0 || sample.index >= world.heights.length) {
      continue;
    }

    const xIndex = sample.index % VERTICES_PER_ROW;
    const zIndex = (sample.index / VERTICES_PER_ROW) | 0;
    const previous = generatedArrayValue(world.heights, sample.index);
    world.heights[sample.index] = sample.height;
    const vertex = generatedArrayValue(
      world.gridToVertex,
      sample.index,
    );
    world.positionAttribute.setY(vertex, sample.height);

    const dig = previous - sample.height;
    if (dig > 0) {
      const amount = clamp(dig / 1.2, 0, 1);
      color
        .fromArray(world.colorAttribute.array, vertex * 3)
        .lerp(world.palette.crater, amount * 0.55);
      world.colorAttribute.setXYZ(vertex, color.r, color.g, color.b);
    }

    minimumX = Math.min(minimumX, xIndex);
    maximumX = Math.max(maximumX, xIndex);
    minimumZ = Math.min(minimumZ, zIndex);
    maximumZ = Math.max(maximumZ, zIndex);
    if (sampleOffset > 0 && sampleOffset % 1024 === 0) {
      await yieldToFrame();
    }
  }

  if (maximumX < minimumX) return;

  const NORMAL_ROWS_PER_CHUNK = 24;
  for (
    let zStart = minimumZ;
    zStart <= maximumZ;
    zStart += NORMAL_ROWS_PER_CHUNK
  ) {
    refreshTerrainNormals(
      world,
      minimumX,
      maximumX,
      zStart,
      Math.min(maximumZ, zStart + NORMAL_ROWS_PER_CHUNK - 1),
      scratchNormal,
    );
    if (zStart + NORMAL_ROWS_PER_CHUNK <= maximumZ) {
      await yieldToFrame();
    }
  }
  world.positionAttribute.needsUpdate = true;
  world.normalAttribute.needsUpdate = true;
  world.colorAttribute.needsUpdate = true;
}

export function raymarchTerrain(
  world: World,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maximumDistance: number,
): TerrainRayHit | null {
  if (origin.y - world.heightAt(origin.x, origin.z) <= 0.02) {
    return null;
  }

  let distance = 0.4;
  let previousAbove = true;
  let previousDistance = distance;

  while (distance < maximumDistance) {
    const x = origin.x + direction.x * distance;
    const z = origin.z + direction.z * distance;
    const y = origin.y + direction.y * distance;
    if (Math.abs(x) > HALF_WORLD || Math.abs(z) > HALF_WORLD) {
      return null;
    }

    const height = world.heightAt(x, z) + 0.05;
    const above = y >= height;
    if (previousAbove && !above) {
      let low = previousDistance;
      let high = distance;
      for (let index = 0; index < 8; index += 1) {
        const middle = (low + high) * 0.5;
        const sampleY = origin.y + direction.y * middle;
        const sampleHeight =
          world.heightAt(
            origin.x + direction.x * middle,
            origin.z + direction.z * middle,
          ) + 0.05;
        if (sampleY >= sampleHeight) low = middle;
        else high = middle;
      }
      const hitDistance = (low + high) * 0.5;
      return {
        point: origin
          .clone()
          .addScaledVector(direction, hitDistance),
        distance: hitDistance,
      };
    }

    previousAbove = above;
    previousDistance = distance;
    const clearance = Math.max(0.15, y - height);
    distance += clamp(clearance * 0.65, 0.35, 2.4);
  }

  return null;
}

/** Standalone bilinear sampler for tests and non-World callers. */
export function sampleHeightBilinear(
  heights: Float32Array,
  x: number,
  z: number,
): number {
  return createHeightAt(heights)(x, z);
}
