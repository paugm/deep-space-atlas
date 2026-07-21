import {
  CAVE_CELL_SIZE,
  CAVE_CHUNK_SIZE,
  CAVE_DIG_BACKTRACK,
  CAVE_DIG_LENGTH,
  CAVE_DIG_RADIUS,
  HALF_WORLD,
  WORLD_SIZE,
  clamp,
} from "../config.ts";

export interface CavePoint {
  x: number;
  y: number;
  z: number;
}

export interface CaveBrush {
  start: CavePoint;
  end: CavePoint;
  radius: number;
}

export interface CaveChunkCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface CaveBrushIndex {
  brushes: CaveBrush[];
  byChunk: Map<string, CaveBrush[]>;
}

export interface CaveRayHit {
  point: CavePoint;
  normal: CavePoint;
  distance: number;
}

export interface CaveCapsulePose {
  x: number;
  y: number;
  z: number;
  radius: number;
  eyeHeight: number;
}

export interface CaveCapsuleResolution {
  x: number;
  y: number;
  z: number;
  correctionX: number;
  correctionY: number;
  correctionZ: number;
  grounded: boolean;
  groundNormal: CavePoint | null;
}

export type CaveField = (x: number, y: number, z: number) => number;
export type SurfaceHeightAt = (x: number, z: number) => number;

const CAVE_CHUNKS_PER_AXIS = WORLD_SIZE / CAVE_CHUNK_SIZE;
/** 5 cm save precision keeps configured brush dimensions exact. */
const CAVE_BRUSH_QUANTIZATION = 20;
const CAVE_BRUSH_RECORD_BYTES = 14;
const CAVE_RAY_STEP = CAVE_CELL_SIZE * 0.4;
const CAVE_NORMAL_EPSILON = CAVE_CELL_SIZE * 0.3;
const CAVE_COLLISION_ITERATIONS = 4;
const CAVE_CAPSULE_SAMPLES = 5;

function isFinitePoint(point: CavePoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

export function isValidCaveBrush(brush: CaveBrush): boolean {
  return (
    isFinitePoint(brush.start) &&
    isFinitePoint(brush.end) &&
    Number.isFinite(brush.radius) &&
    brush.radius >= CAVE_CELL_SIZE &&
    brush.radius <= CAVE_CHUNK_SIZE * 0.5
  );
}

export function createDirectionalCaveBrush(
  hit: CavePoint,
  direction: CavePoint,
  options: {
    radius?: number;
    length?: number;
    backtrack?: number;
  } = {},
): CaveBrush {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const inverseLength = length > 1e-8 ? 1 / length : 0;
  const x = direction.x * inverseLength;
  const y = direction.y * inverseLength;
  const z = direction.z * inverseLength;
  const digLength = options.length ?? CAVE_DIG_LENGTH;
  const digBacktrack = options.backtrack ?? CAVE_DIG_BACKTRACK;
  const digRadius = options.radius ?? CAVE_DIG_RADIUS;
  return {
    start: {
      x: hit.x - x * digBacktrack,
      y: hit.y - y * digBacktrack,
      z: hit.z - z * digBacktrack,
    },
    end: {
      x: hit.x + x * digLength,
      y: hit.y + y * digLength,
      z: hit.z + z * digLength,
    },
    radius: digRadius,
  };
}

export function caveChunkKey(coordinate: CaveChunkCoordinate): string {
  return `${coordinate.x}:${coordinate.y}:${coordinate.z}`;
}

export function caveChunkCoordinateAt(
  x: number,
  y: number,
  z: number,
): CaveChunkCoordinate {
  return {
    x: Math.floor((x + HALF_WORLD) / CAVE_CHUNK_SIZE),
    y: Math.floor(y / CAVE_CHUNK_SIZE),
    z: Math.floor((z + HALF_WORLD) / CAVE_CHUNK_SIZE),
  };
}

export function caveChunkOrigin(
  coordinate: CaveChunkCoordinate,
): CavePoint {
  return {
    x: coordinate.x * CAVE_CHUNK_SIZE - HALF_WORLD,
    y: coordinate.y * CAVE_CHUNK_SIZE,
    z: coordinate.z * CAVE_CHUNK_SIZE - HALF_WORLD,
  };
}

export function caveChunkCenter(
  coordinate: CaveChunkCoordinate,
): CavePoint {
  const origin = caveChunkOrigin(coordinate);
  return {
    x: origin.x + CAVE_CHUNK_SIZE * 0.5,
    y: origin.y + CAVE_CHUNK_SIZE * 0.5,
    z: origin.z + CAVE_CHUNK_SIZE * 0.5,
  };
}

export function caveBrushChunkCoordinates(
  brush: CaveBrush,
): CaveChunkCoordinate[] {
  if (!isValidCaveBrush(brush)) return [];
  const minimum = caveChunkCoordinateAt(
    Math.min(brush.start.x, brush.end.x) - brush.radius,
    Math.min(brush.start.y, brush.end.y) - brush.radius,
    Math.min(brush.start.z, brush.end.z) - brush.radius,
  );
  const maximum = caveChunkCoordinateAt(
    Math.max(brush.start.x, brush.end.x) + brush.radius,
    Math.max(brush.start.y, brush.end.y) + brush.radius,
    Math.max(brush.start.z, brush.end.z) + brush.radius,
  );
  const coordinates: CaveChunkCoordinate[] = [];
  const minimumX = clamp(minimum.x, 0, CAVE_CHUNKS_PER_AXIS - 1);
  const maximumX = clamp(maximum.x, 0, CAVE_CHUNKS_PER_AXIS - 1);
  const minimumZ = clamp(minimum.z, 0, CAVE_CHUNKS_PER_AXIS - 1);
  const maximumZ = clamp(maximum.z, 0, CAVE_CHUNKS_PER_AXIS - 1);

  for (let z = minimumZ; z <= maximumZ; z += 1) {
    for (let y = minimum.y; y <= maximum.y; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const coordinate = { x, y, z };
        if (caveBrushIntersectsChunk(brush, coordinate)) {
          coordinates.push(coordinate);
        }
      }
    }
  }
  return coordinates;
}

function caveBrushIntersectsChunk(
  brush: CaveBrush,
  coordinate: CaveChunkCoordinate,
): boolean {
  const origin = caveChunkOrigin(coordinate);
  const minimum = {
    x: origin.x - brush.radius,
    y: origin.y - brush.radius,
    z: origin.z - brush.radius,
  };
  const maximum = {
    x: origin.x + CAVE_CHUNK_SIZE + brush.radius,
    y: origin.y + CAVE_CHUNK_SIZE + brush.radius,
    z: origin.z + CAVE_CHUNK_SIZE + brush.radius,
  };
  let entry = 0;
  let exit = 1;
  const starts = [brush.start.x, brush.start.y, brush.start.z];
  const directions = [
    brush.end.x - brush.start.x,
    brush.end.y - brush.start.y,
    brush.end.z - brush.start.z,
  ];
  const minimums = [minimum.x, minimum.y, minimum.z];
  const maximums = [maximum.x, maximum.y, maximum.z];
  for (let axis = 0; axis < 3; axis += 1) {
    const start = starts[axis]!;
    const direction = directions[axis]!;
    const axisMinimum = minimums[axis]!;
    const axisMaximum = maximums[axis]!;
    if (Math.abs(direction) < 1e-8) {
      if (start < axisMinimum || start > axisMaximum) return false;
      continue;
    }
    const inverse = 1 / direction;
    let near = (axisMinimum - start) * inverse;
    let far = (axisMaximum - start) * inverse;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return false;
  }
  return true;
}

export function createCaveBrushIndex(
  brushes: readonly CaveBrush[] = [],
): CaveBrushIndex {
  const index: CaveBrushIndex = {
    brushes: [],
    byChunk: new Map(),
  };
  for (const brush of brushes) addCaveBrushToIndex(index, brush);
  return index;
}

export function mergeCollinearCaveBrushes(
  first: CaveBrush,
  second: CaveBrush,
): CaveBrush | null {
  if (
    !isValidCaveBrush(first) ||
    !isValidCaveBrush(second) ||
    Math.abs(first.radius - second.radius) > 0.01
  ) {
    return null;
  }
  const firstX = first.end.x - first.start.x;
  const firstY = first.end.y - first.start.y;
  const firstZ = first.end.z - first.start.z;
  const secondX = second.end.x - second.start.x;
  const secondY = second.end.y - second.start.y;
  const secondZ = second.end.z - second.start.z;
  const firstLength = Math.hypot(firstX, firstY, firstZ);
  const secondLength = Math.hypot(secondX, secondY, secondZ);
  if (firstLength < 1e-6 || secondLength < 1e-6) return null;
  const direction = {
    x: firstX / firstLength,
    y: firstY / firstLength,
    z: firstZ / firstLength,
  };
  const alignment =
    direction.x * (secondX / secondLength) +
    direction.y * (secondY / secondLength) +
    direction.z * (secondZ / secondLength);
  if (alignment < 0.9995) return null;

  const startOffset = {
    x: second.start.x - first.start.x,
    y: second.start.y - first.start.y,
    z: second.start.z - first.start.z,
  };
  const endOffset = {
    x: second.end.x - first.start.x,
    y: second.end.y - first.start.y,
    z: second.end.z - first.start.z,
  };
  const startProjection =
    startOffset.x * direction.x +
    startOffset.y * direction.y +
    startOffset.z * direction.z;
  const endProjection =
    endOffset.x * direction.x +
    endOffset.y * direction.y +
    endOffset.z * direction.z;
  const startPerpendicular = Math.hypot(
    startOffset.x - direction.x * startProjection,
    startOffset.y - direction.y * startProjection,
    startOffset.z - direction.z * startProjection,
  );
  const endPerpendicular = Math.hypot(
    endOffset.x - direction.x * endProjection,
    endOffset.y - direction.y * endProjection,
    endOffset.z - direction.z * endProjection,
  );
  if (startPerpendicular > 0.05 || endPerpendicular > 0.05) return null;
  const minimum = Math.min(startProjection, endProjection);
  const maximum = Math.max(startProjection, endProjection);
  if (minimum > firstLength + 0.05 || maximum < -0.05) return null;
  const mergedMinimum = Math.min(0, minimum);
  const mergedMaximum = Math.max(firstLength, maximum);
  if (mergedMaximum - mergedMinimum > CAVE_CHUNK_SIZE * 2) return null;
  return {
    start: {
      x: first.start.x + direction.x * mergedMinimum,
      y: first.start.y + direction.y * mergedMinimum,
      z: first.start.z + direction.z * mergedMinimum,
    },
    end: {
      x: first.start.x + direction.x * mergedMaximum,
      y: first.start.y + direction.y * mergedMaximum,
      z: first.start.z + direction.z * mergedMaximum,
    },
    radius: first.radius,
  };
}

export function appendCaveBrush(
  brushes: CaveBrush[],
  brush: CaveBrush,
): boolean {
  if (!isValidCaveBrush(brush)) return false;
  const previous = brushes.at(-1);
  if (previous === undefined) {
    brushes.push(brush);
    return true;
  }
  const merged = mergeCollinearCaveBrushes(previous, brush);
  if (merged === null) brushes.push(brush);
  else brushes[brushes.length - 1] = merged;
  return true;
}

export function addCaveBrushToIndex(
  index: CaveBrushIndex,
  brush: CaveBrush,
): boolean {
  if (!isValidCaveBrush(brush)) return false;
  const previous = index.brushes.at(-1);
  const merged =
    previous === undefined
      ? null
      : mergeCollinearCaveBrushes(previous, brush);
  if (previous !== undefined && merged !== null) {
    index.brushes.pop();
    for (const coordinate of caveBrushChunkCoordinates(previous)) {
      const key = caveChunkKey(coordinate);
      const list = index.byChunk.get(key);
      if (list === undefined) continue;
      const next = list.filter((entry) => entry !== previous);
      if (next.length === 0) index.byChunk.delete(key);
      else index.byChunk.set(key, next);
    }
  }
  const indexedBrush = merged ?? brush;
  index.brushes.push(indexedBrush);
  for (const coordinate of caveBrushChunkCoordinates(indexedBrush)) {
    const key = caveChunkKey(coordinate);
    const list = index.byChunk.get(key);
    if (list === undefined) index.byChunk.set(key, [indexedBrush]);
    else list.push(indexedBrush);
  }
  return true;
}

export function caveBrushClearance(
  brush: CaveBrush,
  x: number,
  y: number,
  z: number,
): number {
  const segmentX = brush.end.x - brush.start.x;
  const segmentY = brush.end.y - brush.start.y;
  const segmentZ = brush.end.z - brush.start.z;
  const segmentLengthSquared =
    segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
  const offsetX = x - brush.start.x;
  const offsetY = y - brush.start.y;
  const offsetZ = z - brush.start.z;
  const amount =
    segmentLengthSquared > 1e-10
      ? clamp(
          (offsetX * segmentX +
            offsetY * segmentY +
            offsetZ * segmentZ) /
            segmentLengthSquared,
          0,
          1,
        )
      : 0;
  const nearestX = brush.start.x + segmentX * amount;
  const nearestY = brush.start.y + segmentY * amount;
  const nearestZ = brush.start.z + segmentZ * amount;
  return (
    brush.radius -
    Math.hypot(x - nearestX, y - nearestY, z - nearestZ)
  );
}

export function sampleCaveDensity(
  surfaceHeightAt: SurfaceHeightAt,
  brushes: readonly CaveBrush[],
  x: number,
  y: number,
  z: number,
): number {
  let density = y - surfaceHeightAt(x, z);
  for (const brush of brushes) {
    density = Math.max(density, caveBrushClearance(brush, x, y, z));
  }
  return density;
}

export function caveBrushSurfaceTiles(
  brush: CaveBrush,
  surfaceHeightAt: SurfaceHeightAt,
): number[] {
  if (!isValidCaveBrush(brush)) return [];
  const minimumX = Math.max(
    -HALF_WORLD,
    Math.min(brush.start.x, brush.end.x) - brush.radius,
  );
  const maximumX = Math.min(
    HALF_WORLD,
    Math.max(brush.start.x, brush.end.x) + brush.radius,
  );
  const minimumZ = Math.max(
    -HALF_WORLD,
    Math.min(brush.start.z, brush.end.z) - brush.radius,
  );
  const maximumZ = Math.min(
    HALF_WORLD,
    Math.max(brush.start.z, brush.end.z) + brush.radius,
  );
  const tiles = new Set<number>();

  const firstX = Math.ceil(minimumX / CAVE_CELL_SIZE) * CAVE_CELL_SIZE;
  const firstZ = Math.ceil(minimumZ / CAVE_CELL_SIZE) * CAVE_CELL_SIZE;
  for (let z = firstZ; z <= maximumZ; z += CAVE_CELL_SIZE) {
    for (let x = firstX; x <= maximumX; x += CAVE_CELL_SIZE) {
      const height = surfaceHeightAt(x, z);
      if (caveBrushClearance(brush, x, height, z) <= 0) continue;
      const coordinate = caveChunkCoordinateAt(x, height, z);
      if (
        coordinate.x < 0 ||
        coordinate.x >= CAVE_CHUNKS_PER_AXIS ||
        coordinate.z < 0 ||
        coordinate.z >= CAVE_CHUNKS_PER_AXIS
      ) {
        continue;
      }
      tiles.add(coordinate.z * CAVE_CHUNKS_PER_AXIS + coordinate.x);
    }
  }
  return [...tiles];
}

export function snapCaveBrushToSurface(
  brush: CaveBrush,
  surfaceHeightAt: SurfaceHeightAt,
): CaveBrush {
  if (!isValidCaveBrush(brush)) return brush;
  const minimumX = Math.max(
    -HALF_WORLD,
    Math.min(brush.start.x, brush.end.x) - brush.radius,
  );
  const maximumX = Math.min(
    HALF_WORLD,
    Math.max(brush.start.x, brush.end.x) + brush.radius,
  );
  const minimumZ = Math.max(
    -HALF_WORLD,
    Math.min(brush.start.z, brush.end.z) - brush.radius,
  );
  const maximumZ = Math.min(
    HALF_WORLD,
    Math.max(brush.start.z, brush.end.z) + brush.radius,
  );
  const firstX = Math.ceil(minimumX / CAVE_CELL_SIZE) * CAVE_CELL_SIZE;
  const firstZ = Math.ceil(minimumZ / CAVE_CELL_SIZE) * CAVE_CELL_SIZE;
  let maximumClearance = Number.NEGATIVE_INFINITY;
  for (let z = firstZ; z <= maximumZ; z += CAVE_CELL_SIZE) {
    for (let x = firstX; x <= maximumX; x += CAVE_CELL_SIZE) {
      maximumClearance = Math.max(
        maximumClearance,
        caveBrushClearance(brush, x, surfaceHeightAt(x, z), z),
      );
    }
  }
  const snapDistance = CAVE_CELL_SIZE * 0.5;
  if (maximumClearance >= 0 || maximumClearance < -snapDistance) {
    return brush;
  }
  return {
    start: { ...brush.start },
    end: { ...brush.end },
    radius: brush.radius - maximumClearance + CAVE_CELL_SIZE * 0.1,
  };
}

export function caveSurfaceTileCoordinate(tile: number): {
  x: number;
  z: number;
} {
  return {
    x: tile % CAVE_CHUNKS_PER_AXIS,
    z: Math.floor(tile / CAVE_CHUNKS_PER_AXIS),
  };
}

export function caveSurfaceTileVerticalChunks(
  tile: number,
  surfaceHeightAt: SurfaceHeightAt,
): CaveChunkCoordinate[] {
  const coordinate = caveSurfaceTileCoordinate(tile);
  const originX = coordinate.x * CAVE_CHUNK_SIZE - HALF_WORLD;
  const originZ = coordinate.z * CAVE_CHUNK_SIZE - HALF_WORLD;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;

  for (let z = 0; z <= CAVE_CHUNK_SIZE; z += CAVE_CELL_SIZE) {
    for (let x = 0; x <= CAVE_CHUNK_SIZE; x += CAVE_CELL_SIZE) {
      const height = surfaceHeightAt(originX + x, originZ + z);
      minimumHeight = Math.min(minimumHeight, height);
      maximumHeight = Math.max(maximumHeight, height);
    }
  }

  const minimumY = Math.floor(
    (minimumHeight - CAVE_CELL_SIZE) / CAVE_CHUNK_SIZE,
  );
  const maximumY = Math.floor(
    (maximumHeight + CAVE_CELL_SIZE) / CAVE_CHUNK_SIZE,
  );
  const chunks: CaveChunkCoordinate[] = [];
  for (let y = minimumY; y <= maximumY; y += 1) {
    chunks.push({ x: coordinate.x, y, z: coordinate.z });
  }
  return chunks;
}

export function caveFieldNormal(
  field: CaveField,
  x: number,
  y: number,
  z: number,
): { normal: CavePoint; magnitude: number } {
  const gradientX =
    field(x + CAVE_NORMAL_EPSILON, y, z) -
    field(x - CAVE_NORMAL_EPSILON, y, z);
  const gradientY =
    field(x, y + CAVE_NORMAL_EPSILON, z) -
    field(x, y - CAVE_NORMAL_EPSILON, z);
  const gradientZ =
    field(x, y, z + CAVE_NORMAL_EPSILON) -
    field(x, y, z - CAVE_NORMAL_EPSILON);
  const magnitude = Math.max(
    1e-6,
    Math.hypot(gradientX, gradientY, gradientZ) /
      (2 * CAVE_NORMAL_EPSILON),
  );
  const rawLength = Math.max(
    1e-6,
    Math.hypot(gradientX, gradientY, gradientZ),
  );
  return {
    normal: {
      x: gradientX / rawLength,
      y: gradientY / rawLength,
      z: gradientZ / rawLength,
    },
    magnitude,
  };
}

export function raycastCaveField(
  field: CaveField,
  origin: CavePoint,
  direction: CavePoint,
  maximumDistance: number,
): CaveRayHit | null {
  const directionLength = Math.hypot(
    direction.x,
    direction.y,
    direction.z,
  );
  if (directionLength < 1e-8 || maximumDistance <= 0) return null;
  const inverseLength = 1 / directionLength;
  const rayX = direction.x * inverseLength;
  const rayY = direction.y * inverseLength;
  const rayZ = direction.z * inverseLength;
  let previousDistance = 0;
  let previousDensity = field(origin.x, origin.y, origin.z);
  if (previousDensity < -CAVE_CELL_SIZE * 0.25) return null;

  for (
    let distance = CAVE_RAY_STEP;
    distance <= maximumDistance;
    distance += CAVE_RAY_STEP
  ) {
    const x = origin.x + rayX * distance;
    const y = origin.y + rayY * distance;
    const z = origin.z + rayZ * distance;
    const density = field(x, y, z);
    if (previousDensity > 0 && density <= 0) {
      let low = previousDistance;
      let high = distance;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const middle = (low + high) * 0.5;
        const sample = field(
          origin.x + rayX * middle,
          origin.y + rayY * middle,
          origin.z + rayZ * middle,
        );
        if (sample > 0) low = middle;
        else high = middle;
      }
      const hitDistance = (low + high) * 0.5;
      const point = {
        x: origin.x + rayX * hitDistance,
        y: origin.y + rayY * hitDistance,
        z: origin.z + rayZ * hitDistance,
      };
      return {
        point,
        normal: caveFieldNormal(
          field,
          point.x,
          point.y,
          point.z,
        ).normal,
        distance: hitDistance,
      };
    }
    previousDensity = density;
    previousDistance = distance;
  }
  return null;
}

export function resolveCapsuleAgainstCave(
  field: CaveField,
  pose: CaveCapsulePose,
): CaveCapsuleResolution {
  let x = pose.x;
  let y = pose.y;
  let z = pose.z;
  const startX = x;
  const startY = y;
  const startZ = z;

  for (
    let iteration = 0;
    iteration < CAVE_COLLISION_ITERATIONS;
    iteration += 1
  ) {
    let moved = false;
    const feet = y - pose.eyeHeight;
    const bottom = feet + pose.radius;
    const top = Math.max(bottom, y - pose.radius);
    for (let sample = 0; sample < CAVE_CAPSULE_SAMPLES; sample += 1) {
      const amount = sample / (CAVE_CAPSULE_SAMPLES - 1);
      const sampleY = bottom + (top - bottom) * amount;
      const density = field(x, sampleY, z);
      const gradient = caveFieldNormal(field, x, sampleY, z);
      const clearance = density / gradient.magnitude;
      const penetration = pose.radius - clearance;
      if (penetration <= 0) continue;
      const correction = Math.min(penetration, pose.radius * 2);
      x += gradient.normal.x * correction;
      y += gradient.normal.y * correction;
      z += gradient.normal.z * correction;
      moved = true;
    }
    if (!moved) break;
  }

  const feet = y - pose.eyeHeight;
  const probeY = feet + pose.radius - 0.08;
  const probe = caveFieldNormal(field, x, probeY, z);
  const probeClearance = field(x, probeY, z) / probe.magnitude;
  const grounded =
    probeClearance <= pose.radius + 0.04 && probe.normal.y >= 0.55;

  return {
    x,
    y,
    z,
    correctionX: x - startX,
    correctionY: y - startY,
    correctionZ: z - startZ,
    grounded,
    groundNormal: grounded ? probe.normal : null,
  };
}

function quantizeSigned(value: number): number {
  return clamp(
    Math.round(value * CAVE_BRUSH_QUANTIZATION),
    -0x8000,
    0x7fff,
  );
}

export function encodeCaveBrushes(
  brushes: readonly CaveBrush[],
): Uint8Array {
  const valid = brushes.filter(isValidCaveBrush);
  const bytes = new Uint8Array(valid.length * CAVE_BRUSH_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const brush of valid) {
    view.setInt16(offset, quantizeSigned(brush.start.x), true);
    view.setInt16(offset + 2, quantizeSigned(brush.start.y), true);
    view.setInt16(offset + 4, quantizeSigned(brush.start.z), true);
    view.setInt16(offset + 6, quantizeSigned(brush.end.x), true);
    view.setInt16(offset + 8, quantizeSigned(brush.end.y), true);
    view.setInt16(offset + 10, quantizeSigned(brush.end.z), true);
    view.setUint16(
      offset + 12,
      clamp(
        Math.round(brush.radius * CAVE_BRUSH_QUANTIZATION),
        1,
        0xffff,
      ),
      true,
    );
    offset += CAVE_BRUSH_RECORD_BYTES;
  }
  return bytes;
}

export function decodeCaveBrushes(bytes: Uint8Array): CaveBrush[] | null {
  if (bytes.byteLength % CAVE_BRUSH_RECORD_BYTES !== 0) return null;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const brushes: CaveBrush[] = [];
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += CAVE_BRUSH_RECORD_BYTES
  ) {
    const brush: CaveBrush = {
      start: {
        x: view.getInt16(offset, true) / CAVE_BRUSH_QUANTIZATION,
        y: view.getInt16(offset + 2, true) / CAVE_BRUSH_QUANTIZATION,
        z: view.getInt16(offset + 4, true) / CAVE_BRUSH_QUANTIZATION,
      },
      end: {
        x: view.getInt16(offset + 6, true) / CAVE_BRUSH_QUANTIZATION,
        y: view.getInt16(offset + 8, true) / CAVE_BRUSH_QUANTIZATION,
        z: view.getInt16(offset + 10, true) / CAVE_BRUSH_QUANTIZATION,
      },
      radius:
        view.getUint16(offset + 12, true) / CAVE_BRUSH_QUANTIZATION,
    };
    if (!isValidCaveBrush(brush)) return null;
    brushes.push(brush);
  }
  return brushes;
}
