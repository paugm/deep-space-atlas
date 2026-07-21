import {
  CAVE_CELLS_PER_CHUNK,
  CAVE_CELL_SIZE,
  CAVE_SAMPLES_PER_CHUNK,
  HALF_WORLD,
  SEGMENTS,
  TERRAIN_STEP,
  VERTICES_PER_ROW,
  clamp,
  smoothstep,
} from "../config.ts";
import type {
  CaveBrush,
  CaveChunkCoordinate,
  CavePoint,
} from "./caves.ts";
import {
  caveBrushClearance,
  caveChunkOrigin,
} from "./caves.ts";

export interface CaveMeshInput {
  coordinate: CaveChunkCoordinate;
  heights: Float32Array;
  surfaceColors: Float32Array;
  brushes: readonly CaveBrush[];
  caveColor: readonly [red: number, green: number, blue: number];
  /** Surface-replacement chunks include the original outer terrain skin. */
  includeSurface: boolean;
}

export interface CaveMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}

interface MeshVertex {
  position: CavePoint;
  normal: CavePoint;
  color: CavePoint;
}

const HALO = 1;
const FIELD_SIZE = CAVE_SAMPLES_PER_CHUNK + HALO * 2;
const CUBE_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const TETRAHEDRA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];
const TETRAHEDRON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
  [0, 3],
  [1, 3],
  [2, 3],
];

function fieldIndex(x: number, y: number, z: number): number {
  return (y * FIELD_SIZE + z) * FIELD_SIZE + x;
}

function gridIndex(x: number, z: number): number {
  return z * VERTICES_PER_ROW + x;
}

function gridCoordinates(x: number, z: number): {
  xIndex: number;
  zIndex: number;
  xAmount: number;
  zAmount: number;
} {
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
  return {
    xIndex,
    zIndex,
    xAmount: gridX - xIndex,
    zAmount: gridZ - zIndex,
  };
}

function bilinear(
  bottomLeft: number,
  bottomRight: number,
  topLeft: number,
  topRight: number,
  xAmount: number,
  zAmount: number,
): number {
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xAmount;
  const top = topLeft + (topRight - topLeft) * xAmount;
  return bottom + (top - bottom) * zAmount;
}

function sampleSurfaceHeight(
  heights: Float32Array,
  x: number,
  z: number,
): number {
  const grid = gridCoordinates(x, z);
  return bilinear(
    heights[gridIndex(grid.xIndex, grid.zIndex)] ?? 0,
    heights[gridIndex(grid.xIndex + 1, grid.zIndex)] ?? 0,
    heights[gridIndex(grid.xIndex, grid.zIndex + 1)] ?? 0,
    heights[gridIndex(grid.xIndex + 1, grid.zIndex + 1)] ?? 0,
    grid.xAmount,
    grid.zAmount,
  );
}

function sampleSurfaceColor(
  colors: Float32Array,
  x: number,
  z: number,
): CavePoint {
  const grid = gridCoordinates(x, z);
  const index00 = gridIndex(grid.xIndex, grid.zIndex) * 3;
  const index10 = gridIndex(grid.xIndex + 1, grid.zIndex) * 3;
  const index01 = gridIndex(grid.xIndex, grid.zIndex + 1) * 3;
  const index11 = gridIndex(grid.xIndex + 1, grid.zIndex + 1) * 3;
  return {
    x: bilinear(
      colors[index00] ?? 1,
      colors[index10] ?? 1,
      colors[index01] ?? 1,
      colors[index11] ?? 1,
      grid.xAmount,
      grid.zAmount,
    ),
    y: bilinear(
      colors[index00 + 1] ?? 1,
      colors[index10 + 1] ?? 1,
      colors[index01 + 1] ?? 1,
      colors[index11 + 1] ?? 1,
      grid.xAmount,
      grid.zAmount,
    ),
    z: bilinear(
      colors[index00 + 2] ?? 1,
      colors[index10 + 2] ?? 1,
      colors[index01 + 2] ?? 1,
      colors[index11 + 2] ?? 1,
      grid.xAmount,
      grid.zAmount,
    ),
  };
}

function densityAt(
  heights: Float32Array,
  brushes: readonly CaveBrush[],
  x: number,
  y: number,
  z: number,
): number {
  let density = y - sampleSurfaceHeight(heights, x, z);
  for (const brush of brushes) {
    density = Math.max(density, caveBrushClearance(brush, x, y, z));
  }
  return density;
}

function fieldGradient(
  field: Float32Array,
  x: number,
  y: number,
  z: number,
): CavePoint {
  const gradientX =
    (field[fieldIndex(x + 1, y, z)]! -
      field[fieldIndex(x - 1, y, z)]!) /
    (2 * CAVE_CELL_SIZE);
  const gradientY =
    (field[fieldIndex(x, y + 1, z)]! -
      field[fieldIndex(x, y - 1, z)]!) /
    (2 * CAVE_CELL_SIZE);
  const gradientZ =
    (field[fieldIndex(x, y, z + 1)]! -
      field[fieldIndex(x, y, z - 1)]!) /
    (2 * CAVE_CELL_SIZE);
  const length = Math.max(
    1e-6,
    Math.hypot(gradientX, gradientY, gradientZ),
  );
  return {
    x: gradientX / length,
    y: gradientY / length,
    z: gradientZ / length,
  };
}

function interpolateVertex(
  first: MeshVertex,
  firstDensity: number,
  second: MeshVertex,
  secondDensity: number,
): MeshVertex {
  const denominator = firstDensity - secondDensity;
  const amount =
    Math.abs(denominator) > 1e-8
      ? clamp(firstDensity / denominator, 0, 1)
      : 0.5;
  const normalX =
    first.normal.x + (second.normal.x - first.normal.x) * amount;
  const normalY =
    first.normal.y + (second.normal.y - first.normal.y) * amount;
  const normalZ =
    first.normal.z + (second.normal.z - first.normal.z) * amount;
  const normalLength = Math.max(
    1e-6,
    Math.hypot(normalX, normalY, normalZ),
  );
  return {
    position: {
      x:
        first.position.x +
        (second.position.x - first.position.x) * amount,
      y:
        first.position.y +
        (second.position.y - first.position.y) * amount,
      z:
        first.position.z +
        (second.position.z - first.position.z) * amount,
    },
    normal: {
      x: normalX / normalLength,
      y: normalY / normalLength,
      z: normalZ / normalLength,
    },
    color: {
      x: first.color.x + (second.color.x - first.color.x) * amount,
      y: first.color.y + (second.color.y - first.color.y) * amount,
      z: first.color.z + (second.color.z - first.color.z) * amount,
    },
  };
}

function orientAndPushTriangle(
  first: MeshVertex,
  second: MeshVertex,
  third: MeshVertex,
  positions: number[],
  normals: number[],
  colors: number[],
): void {
  const edgeAX = second.position.x - first.position.x;
  const edgeAY = second.position.y - first.position.y;
  const edgeAZ = second.position.z - first.position.z;
  const edgeBX = third.position.x - first.position.x;
  const edgeBY = third.position.y - first.position.y;
  const edgeBZ = third.position.z - first.position.z;
  const crossX = edgeAY * edgeBZ - edgeAZ * edgeBY;
  const crossY = edgeAZ * edgeBX - edgeAX * edgeBZ;
  const crossZ = edgeAX * edgeBY - edgeAY * edgeBX;
  const averageNormalX = first.normal.x + second.normal.x + third.normal.x;
  const averageNormalY = first.normal.y + second.normal.y + third.normal.y;
  const averageNormalZ = first.normal.z + second.normal.z + third.normal.z;
  const oriented =
    crossX * averageNormalX +
      crossY * averageNormalY +
      crossZ * averageNormalZ >=
    0
      ? [first, second, third]
      : [first, third, second];

  for (const vertex of oriented) {
    positions.push(
      vertex.position.x,
      vertex.position.y,
      vertex.position.z,
    );
    normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
    colors.push(vertex.color.x, vertex.color.y, vertex.color.z);
  }
}

function orderPolygon(vertices: MeshVertex[]): MeshVertex[] {
  if (vertices.length < 4) return vertices;
  const center = { x: 0, y: 0, z: 0 };
  const normal = { x: 0, y: 0, z: 0 };
  for (const vertex of vertices) {
    center.x += vertex.position.x;
    center.y += vertex.position.y;
    center.z += vertex.position.z;
    normal.x += vertex.normal.x;
    normal.y += vertex.normal.y;
    normal.z += vertex.normal.z;
  }
  center.x /= vertices.length;
  center.y /= vertices.length;
  center.z /= vertices.length;
  const normalLength = Math.max(
    1e-6,
    Math.hypot(normal.x, normal.y, normal.z),
  );
  normal.x /= normalLength;
  normal.y /= normalLength;
  normal.z /= normalLength;

  let tangent: CavePoint;
  if (Math.abs(normal.y) < 0.9) {
    const length = Math.max(1e-6, Math.hypot(normal.z, normal.x));
    tangent = { x: -normal.z / length, y: 0, z: normal.x / length };
  } else {
    const length = Math.max(1e-6, Math.hypot(normal.y, normal.x));
    tangent = { x: normal.y / length, y: -normal.x / length, z: 0 };
  }
  const bitangent = {
    x: normal.y * tangent.z - normal.z * tangent.y,
    y: normal.z * tangent.x - normal.x * tangent.z,
    z: normal.x * tangent.y - normal.y * tangent.x,
  };

  return vertices.sort((left, right) => {
    const leftX =
      (left.position.x - center.x) * tangent.x +
      (left.position.y - center.y) * tangent.y +
      (left.position.z - center.z) * tangent.z;
    const leftY =
      (left.position.x - center.x) * bitangent.x +
      (left.position.y - center.y) * bitangent.y +
      (left.position.z - center.z) * bitangent.z;
    const rightX =
      (right.position.x - center.x) * tangent.x +
      (right.position.y - center.y) * tangent.y +
      (right.position.z - center.z) * tangent.z;
    const rightY =
      (right.position.x - center.x) * bitangent.x +
      (right.position.y - center.y) * bitangent.y +
      (right.position.z - center.z) * bitangent.z;
    return Math.atan2(leftY, leftX) - Math.atan2(rightY, rightX);
  });
}

function caveVertexColor(
  heights: Float32Array,
  surfaceColors: Float32Array,
  caveColor: CaveMeshInput["caveColor"],
  x: number,
  y: number,
  z: number,
): CavePoint {
  const surfaceHeight = sampleSurfaceHeight(heights, x, z);
  const surface = sampleSurfaceColor(surfaceColors, x, z);
  const caveAmount = smoothstep(0.25, 1.2, Math.abs(y - surfaceHeight));
  return {
    x: surface.x + (caveColor[0] - surface.x) * caveAmount,
    y: surface.y + (caveColor[1] - surface.y) * caveAmount,
    z: surface.z + (caveColor[2] - surface.z) * caveAmount,
  };
}

function isOuterSurfaceTriangle(
  heights: Float32Array,
  first: MeshVertex,
  second: MeshVertex,
  third: MeshVertex,
): boolean {
  return [first, second, third].every(
    (vertex) =>
      Math.abs(
        vertex.position.y -
          sampleSurfaceHeight(
            heights,
            vertex.position.x,
            vertex.position.z,
          ),
      ) <
      CAVE_CELL_SIZE * 0.3,
  );
}

export function buildCaveChunkMesh(input: CaveMeshInput): CaveMeshData {
  const origin = caveChunkOrigin(input.coordinate);
  const field = new Float32Array(FIELD_SIZE * FIELD_SIZE * FIELD_SIZE);

  for (let y = 0; y < FIELD_SIZE; y += 1) {
    for (let z = 0; z < FIELD_SIZE; z += 1) {
      for (let x = 0; x < FIELD_SIZE; x += 1) {
        const worldX = origin.x + (x - HALO) * CAVE_CELL_SIZE;
        const worldY = origin.y + (y - HALO) * CAVE_CELL_SIZE;
        const worldZ = origin.z + (z - HALO) * CAVE_CELL_SIZE;
        field[fieldIndex(x, y, z)] = densityAt(
          input.heights,
          input.brushes,
          worldX,
          worldY,
          worldZ,
        );
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  for (let y = 0; y < CAVE_CELLS_PER_CHUNK; y += 1) {
    for (let z = 0; z < CAVE_CELLS_PER_CHUNK; z += 1) {
      for (let x = 0; x < CAVE_CELLS_PER_CHUNK; x += 1) {
        const densities: number[] = [];
        let hasAir = false;
        let hasSolid = false;
        for (const [offsetX, offsetY, offsetZ] of CUBE_CORNERS) {
          const fieldX = x + offsetX + HALO;
          const fieldY = y + offsetY + HALO;
          const fieldZ = z + offsetZ + HALO;
          const density = field[fieldIndex(fieldX, fieldY, fieldZ)]!;
          densities.push(density);
          if (density > 0) hasAir = true;
          else hasSolid = true;
        }
        if (!hasAir || !hasSolid) continue;

        const vertices: MeshVertex[] = [];
        for (const [offsetX, offsetY, offsetZ] of CUBE_CORNERS) {
          const fieldX = x + offsetX + HALO;
          const fieldY = y + offsetY + HALO;
          const fieldZ = z + offsetZ + HALO;
          const worldX = origin.x + (x + offsetX) * CAVE_CELL_SIZE;
          const worldY = origin.y + (y + offsetY) * CAVE_CELL_SIZE;
          const worldZ = origin.z + (z + offsetZ) * CAVE_CELL_SIZE;
          vertices.push({
            position: { x: worldX, y: worldY, z: worldZ },
            normal: fieldGradient(field, fieldX, fieldY, fieldZ),
            color: caveVertexColor(
              input.heights,
              input.surfaceColors,
              input.caveColor,
              worldX,
              worldY,
              worldZ,
            ),
          });
        }

        for (const tetrahedron of TETRAHEDRA) {
          const polygon: MeshVertex[] = [];
          for (const [edgeStart, edgeEnd] of TETRAHEDRON_EDGES) {
            const firstIndex = tetrahedron[edgeStart]!;
            const secondIndex = tetrahedron[edgeEnd]!;
            const firstDensity = densities[firstIndex]!;
            const secondDensity = densities[secondIndex]!;
            if ((firstDensity > 0) === (secondDensity > 0)) continue;
            polygon.push(
              interpolateVertex(
                vertices[firstIndex]!,
                firstDensity,
                vertices[secondIndex]!,
                secondDensity,
              ),
            );
          }
          if (polygon.length === 3) {
            const first = polygon[0]!;
            const second = polygon[1]!;
            const third = polygon[2]!;
            if (
              input.includeSurface ||
              !isOuterSurfaceTriangle(
                input.heights,
                first,
                second,
                third,
              )
            ) {
              orientAndPushTriangle(
                first,
                second,
                third,
                positions,
                normals,
                colors,
              );
            }
          } else if (polygon.length === 4) {
            const ordered = orderPolygon(polygon);
            const triangles = [
              [ordered[0]!, ordered[1]!, ordered[2]!],
              [ordered[0]!, ordered[2]!, ordered[3]!],
            ] as const;
            for (const [first, second, third] of triangles) {
              if (
                !input.includeSurface &&
                isOuterSurfaceTriangle(
                  input.heights,
                  first,
                  second,
                  third,
                )
              ) {
                continue;
              }
              orientAndPushTriangle(
                first,
                second,
                third,
                positions,
                normals,
                colors,
              );
            }
          }
        }
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
  };
}
