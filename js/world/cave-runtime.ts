import * as THREE from "three";

import {
  CAVE_CHUNK_SIZE,
  CAVE_MESH_LOAD_RADIUS,
  CAVE_MESH_UNLOAD_RADIUS,
  HALF_WORLD,
} from "../config.ts";
import { buildCaveChunkMesh } from "./cave-mesh.ts";
import type {
  CaveMeshData,
} from "./cave-mesh.ts";
import type {
  CaveBrush,
  CaveBrushIndex,
  CaveCapsulePose,
  CaveCapsuleResolution,
  CaveChunkCoordinate,
  CavePoint,
  CaveRayHit,
  SurfaceHeightAt,
} from "./caves.ts";
import {
  addCaveBrushToIndex,
  caveBrushChunkCoordinates,
  caveBrushSurfaceTiles,
  caveChunkCenter,
  caveChunkCoordinateAt,
  caveChunkKey,
  caveSurfaceTileCoordinate,
  caveSurfaceTileVerticalChunks,
  createCaveBrushIndex,
  isValidCaveBrush,
  raycastCaveField,
  resolveCapsuleAgainstCave,
  sampleCaveDensity,
} from "./caves.ts";
import type {
  CaveWorkerRequest,
  CaveWorkerResponse,
} from "./cave-worker-protocol.ts";

export interface CaveRuntime {
  readonly brushes: readonly CaveBrush[];
  addBrush(brush: CaveBrush): boolean;
  densityAt(x: number, y: number, z: number): number;
  isNearEdit(x: number, y: number, z: number, margin: number): boolean;
  raycast(
    origin: CavePoint,
    direction: CavePoint,
    maximumDistance: number,
  ): CaveRayHit | null;
  resolveCapsule(pose: CaveCapsulePose): CaveCapsuleResolution;
  update(viewPosition: CavePoint): readonly CaveBrush[];
  dispose(): void;
}

export interface CreateCaveRuntimeOptions {
  group: THREE.Group;
  heights: Float32Array;
  gridToVertex: Int32Array;
  colorAttribute: THREE.BufferAttribute;
  surfaceHeightAt: SurfaceHeightAt;
  caveColor: THREE.Color;
  brushes: readonly CaveBrush[];
  setHiddenSurfaceTiles(tiles: ReadonlySet<number>): void;
  onBrushCommitted?(brush: CaveBrush): void;
}

interface CaveChunkState {
  key: string;
  coordinate: CaveChunkCoordinate;
  revision: number;
  meshRevision: number;
  dirty: boolean;
  queued: boolean;
  pending: boolean;
  wanted: boolean;
  failures: number;
  touched: boolean;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null;
  stagedMesh:
    | THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>
    | null;
  pendingBrushes: number;
  surfaceTiles: Set<number>;
}

interface SurfaceTileState {
  tile: number;
  chunkKeys: string[];
  active: boolean;
}

interface CompletedMesh {
  key: string;
  revision: number;
  data: CaveMeshData;
}

interface PendingBrushCommit {
  brush: CaveBrush;
  chunkKeys: string[];
  surfaceTiles: number[];
}

const STREAM_RECHECK_DISTANCE = CAVE_CHUNK_SIZE * 0.25;
const STREAM_RECHECK_DISTANCE_SQUARED =
  STREAM_RECHECK_DISTANCE * STREAM_RECHECK_DISTANCE;
const SURFACE_LOAD_RADIUS = CAVE_MESH_LOAD_RADIUS + CAVE_CHUNK_SIZE;
const SURFACE_UNLOAD_RADIUS = CAVE_MESH_UNLOAD_RADIUS + CAVE_CHUNK_SIZE;
const SURFACE_LOAD_RADIUS_SQUARED = SURFACE_LOAD_RADIUS * SURFACE_LOAD_RADIUS;
const SURFACE_UNLOAD_RADIUS_SQUARED =
  SURFACE_UNLOAD_RADIUS * SURFACE_UNLOAD_RADIUS;
const LOAD_RADIUS_SQUARED = CAVE_MESH_LOAD_RADIUS * CAVE_MESH_LOAD_RADIUS;
const UNLOAD_RADIUS_SQUARED =
  CAVE_MESH_UNLOAD_RADIUS * CAVE_MESH_UNLOAD_RADIUS;

function yieldToFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function chunkDistanceSquared(
  coordinate: CaveChunkCoordinate,
  point: CavePoint,
): number {
  const center = caveChunkCenter(coordinate);
  const x = center.x - point.x;
  const y = center.y - point.y;
  const z = center.z - point.z;
  return x * x + y * y + z * z;
}

function tileDistanceSquared(tile: number, point: CavePoint): number {
  const coordinate = caveSurfaceTileCoordinate(tile);
  const centerX =
    coordinate.x * CAVE_CHUNK_SIZE - HALF_WORLD + CAVE_CHUNK_SIZE * 0.5;
  const centerZ =
    coordinate.z * CAVE_CHUNK_SIZE - HALF_WORLD + CAVE_CHUNK_SIZE * 0.5;
  const x = centerX - point.x;
  const z = centerZ - point.z;
  return x * x + z * z;
}

function surfaceColorsByGrid(
  gridToVertex: Int32Array,
  colorAttribute: THREE.BufferAttribute,
): Float32Array {
  const colors = new Float32Array(gridToVertex.length * 3);
  for (let index = 0; index < gridToVertex.length; index += 1) {
    const vertex = gridToVertex[index];
    if (vertex === undefined) continue;
    colors[index * 3] = colorAttribute.getX(vertex);
    colors[index * 3 + 1] = colorAttribute.getY(vertex);
    colors[index * 3 + 2] = colorAttribute.getZ(vertex);
  }
  return colors;
}

function createGeometry(data: CaveMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export async function createCaveRuntime(
  options: CreateCaveRuntimeOptions,
): Promise<CaveRuntime> {
  const caveGroup = new THREE.Group();
  caveGroup.name = "cave-volume";
  options.group.add(caveGroup);

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const surfaceColors = surfaceColorsByGrid(
    options.gridToVertex,
    options.colorAttribute,
  );
  const index: CaveBrushIndex = createCaveBrushIndex();
  const committedIndex: CaveBrushIndex = createCaveBrushIndex();
  const chunks = new Map<string, CaveChunkState>();
  const surfaceTiles = new Map<number, SurfaceTileState>();
  const activeSurfaceTiles = new Set<number>();
  const committedSurfaceTiles = new Set<number>();
  const nearSurfaceTiles = new Set<number>();
  const completed: CompletedMesh[] = [];
  const newlyCommittedBrushes: CaveBrush[] = [];
  const pendingBrushCommits: PendingBrushCommit[] = [];
  const queue: CaveChunkState[] = [];
  let worker: Worker | null = null;
  let workerReady = false;
  let workerBusy = false;
  let disposed = false;
  let streamDirty = true;
  let hiddenTilesDirty = false;
  let lastStreamPosition: CavePoint | null = null;

  const ensureChunk = (
    coordinate: CaveChunkCoordinate,
    touched: boolean,
  ): CaveChunkState => {
    const key = caveChunkKey(coordinate);
    const existing = chunks.get(key);
    if (existing !== undefined) {
      if (touched) existing.touched = true;
      return existing;
    }
    const created: CaveChunkState = {
      key,
      coordinate,
      revision: 0,
      meshRevision: -1,
      dirty: true,
      queued: false,
      pending: false,
      wanted: false,
      failures: 0,
      touched,
      mesh: null,
      stagedMesh: null,
      pendingBrushes: 0,
      surfaceTiles: new Set(),
    };
    chunks.set(key, created);
    return created;
  };

  const ensureSurfaceTile = (tile: number): SurfaceTileState => {
    const existing = surfaceTiles.get(tile);
    if (existing !== undefined) return existing;
    const chunkKeys: string[] = [];
    for (const coordinate of caveSurfaceTileVerticalChunks(
      tile,
      options.surfaceHeightAt,
    )) {
      const chunk = ensureChunk(coordinate, false);
      chunk.surfaceTiles.add(tile);
      chunkKeys.push(chunk.key);
    }
    const created = { tile, chunkKeys, active: false };
    surfaceTiles.set(tile, created);
    return created;
  };

  const registerBrush = (
    brush: CaveBrush,
    commitImmediately: boolean,
  ): boolean => {
    if (!addCaveBrushToIndex(index, brush)) return false;
    const chunkKeys = new Set<string>();
    for (const coordinate of caveBrushChunkCoordinates(brush)) {
      const chunk = ensureChunk(coordinate, true);
      chunk.revision += 1;
      chunk.dirty = true;
      chunkKeys.add(chunk.key);
    }
    const openedSurfaceTiles = caveBrushSurfaceTiles(
      brush,
      options.surfaceHeightAt,
    );
    for (const tile of openedSurfaceTiles) {
      const surfaceTile = ensureSurfaceTile(tile);
      for (const key of surfaceTile.chunkKeys) {
        const chunk = chunks.get(key);
        if (chunk === undefined) continue;
        chunk.revision += 1;
        chunk.dirty = true;
        chunkKeys.add(key);
      }
    }
    if (commitImmediately) {
      addCaveBrushToIndex(committedIndex, brush);
      for (const tile of openedSurfaceTiles) committedSurfaceTiles.add(tile);
    } else {
      for (const key of chunkKeys) {
        const chunk = chunks.get(key);
        if (chunk !== undefined) chunk.pendingBrushes += 1;
      }
      pendingBrushCommits.push({
        brush,
        chunkKeys: [...chunkKeys],
        surfaceTiles: openedSurfaceTiles,
      });
    }
    streamDirty = true;
    return true;
  };

  for (let offset = 0; offset < options.brushes.length; offset += 1) {
    registerBrush(options.brushes[offset]!, true);
    if (offset > 0 && offset % 256 === 0) await yieldToFrame();
  }

  const rollbackPendingBrush = (): void => {
    const pending = pendingBrushCommits.shift();
    if (pending === undefined) return;
    index.brushes.length = 0;
    index.byChunk.clear();
    for (const brush of committedIndex.brushes) {
      addCaveBrushToIndex(index, brush);
    }
    for (const key of pending.chunkKeys) {
      const chunk = chunks.get(key);
      if (chunk === undefined) continue;
      chunk.pendingBrushes = Math.max(0, chunk.pendingBrushes - 1);
      chunk.stagedMesh?.geometry.dispose();
      chunk.stagedMesh = null;
      chunk.revision += 1;
      chunk.meshRevision = -1;
      chunk.failures = 0;
      chunk.dirty = true;
      chunk.wanted = true;
    }
    for (const tileNumber of pending.surfaceTiles) {
      if (committedSurfaceTiles.has(tileNumber)) continue;
      const tile = surfaceTiles.get(tileNumber);
      if (tile === undefined) continue;
      if (tile.active) {
        tile.active = false;
        activeSurfaceTiles.delete(tileNumber);
        hiddenTilesDirty = true;
      }
      for (const key of tile.chunkKeys) {
        chunks.get(key)?.surfaceTiles.delete(tileNumber);
      }
      surfaceTiles.delete(tileNumber);
      nearSurfaceTiles.delete(tileNumber);
    }
    streamDirty = true;
  };

  const recordChunkFailure = (state: CaveChunkState): void => {
    state.pending = false;
    state.failures += 1;
    state.dirty = state.failures < 3;
    if (state.failures >= 3 && state.pendingBrushes > 0) {
      rollbackPendingBrush();
    }
  };

  const finishFallbackMesh = (
    state: CaveChunkState,
    revision: number,
    data: CaveMeshData,
  ): void => {
    state.pending = false;
    state.failures = 0;
    workerBusy = false;
    completed.push({
      key: state.key,
      revision,
      data,
    });
  };

  const pumpWorker = (): void => {
    if (disposed || workerBusy || !workerReady) return;
    const state = queue.shift();
    if (state === undefined) return;
    state.queued = false;
    if (!state.wanted || !state.dirty || state.pending) {
      pumpWorker();
      return;
    }
    state.pending = true;
    state.dirty = false;
    workerBusy = true;
    const revision = state.revision;
    const brushes = [...(index.byChunk.get(state.key) ?? [])];
    const request: CaveWorkerRequest = {
      kind: "mesh",
      key: state.key,
      revision,
      coordinate: state.coordinate,
      brushes,
      includeSurface: state.surfaceTiles.size > 0,
    };
    if (worker !== null) {
      worker.postMessage(request);
      return;
    }
    setTimeout(() => {
      if (disposed) return;
      try {
        const data = buildCaveChunkMesh({
          coordinate: state.coordinate,
          heights: options.heights,
          surfaceColors,
          brushes,
          caveColor: [
            options.caveColor.r,
            options.caveColor.g,
            options.caveColor.b,
          ],
          includeSurface: state.surfaceTiles.size > 0,
        });
        finishFallbackMesh(state, revision, data);
      } catch (error) {
        recordChunkFailure(state);
        workerBusy = false;
        console.warn(
          error instanceof Error
            ? error.message
            : "Cave fallback meshing failed.",
        );
      } finally {
        streamDirty = true;
        pumpWorker();
      }
    }, 0);
  };

  try {
    worker = new Worker(new URL("./cave-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<CaveWorkerResponse>): void => {
      if (disposed) return;
      const response = event.data;
      switch (response.kind) {
        case "ready":
          workerReady = true;
          pumpWorker();
          return;
        case "mesh": {
          workerBusy = false;
          const state = chunks.get(response.key);
          if (state !== undefined) {
            state.pending = false;
            state.failures = 0;
          }
          completed.push({
            key: response.key,
            revision: response.revision,
            data: {
              positions: response.positions,
              normals: response.normals,
              colors: response.colors,
            },
          });
          pumpWorker();
          return;
        }
        case "error": {
          workerBusy = false;
          if (response.key !== null) {
            const state = chunks.get(response.key);
            if (state !== undefined) recordChunkFailure(state);
          }
          streamDirty = true;
          console.warn(response.message);
          pumpWorker();
          return;
        }
        default: {
          const exhaustive: never = response;
          throw new Error(`Unknown cave worker response: ${String(exhaustive)}`);
        }
      }
    };
    worker.onerror = (event): void => {
      console.warn("Cave worker failed:", event.message);
      worker?.terminate();
      worker = null;
      workerBusy = false;
      workerReady = true;
      streamDirty = true;
      for (const chunk of chunks.values()) {
        if (!chunk.pending) continue;
        chunk.pending = false;
        chunk.dirty = true;
      }
      pumpWorker();
    };
    const heights = options.heights.slice();
    const colors = surfaceColors.slice();
    const initialize: CaveWorkerRequest = {
      kind: "initialize",
      heights,
      surfaceColors: colors,
      caveColor: [
        options.caveColor.r,
        options.caveColor.g,
        options.caveColor.b,
      ],
    };
    worker.postMessage(initialize, [heights.buffer, colors.buffer]);
  } catch {
    worker = null;
    workerReady = true;
  }

  const queueChunk = (state: CaveChunkState): void => {
    if (
      !state.wanted ||
      state.failures >= 3 ||
      state.queued ||
      state.pending ||
      !state.dirty
    ) {
      return;
    }
    state.queued = true;
    queue.push(state);
  };

  const unloadChunk = (state: CaveChunkState): void => {
    if (state.mesh !== null) {
      caveGroup.remove(state.mesh);
      state.mesh.geometry.dispose();
      state.mesh = null;
    }
    if (state.stagedMesh !== null) {
      state.stagedMesh.geometry.dispose();
      state.stagedMesh = null;
    }
    state.meshRevision = -1;
    state.dirty = true;
  };

  const updateStreaming = (viewPosition: CavePoint): void => {
    nearSurfaceTiles.clear();
    for (const chunk of chunks.values()) chunk.wanted = false;
    for (const pending of pendingBrushCommits) {
      for (const tile of pending.surfaceTiles) {
        nearSurfaceTiles.add(tile);
      }
      for (const key of pending.chunkKeys) {
        const chunk = chunks.get(key);
        if (chunk !== undefined) chunk.wanted = true;
      }
    }

    for (const tile of surfaceTiles.values()) {
      const distanceSquared = tileDistanceSquared(tile.tile, viewPosition);
      const keepResident = distanceSquared <= SURFACE_UNLOAD_RADIUS_SQUARED;
      if (keepResident) {
        for (const key of tile.chunkKeys) {
          const chunk = chunks.get(key);
          if (chunk !== undefined) chunk.wanted = true;
        }
      }
      if (distanceSquared <= SURFACE_LOAD_RADIUS_SQUARED) {
        nearSurfaceTiles.add(tile.tile);
        for (const key of tile.chunkKeys) {
          const chunk = chunks.get(key);
          if (chunk !== undefined) queueChunk(chunk);
        }
      } else if (
        distanceSquared > SURFACE_UNLOAD_RADIUS_SQUARED &&
        tile.active
      ) {
        tile.active = false;
        activeSurfaceTiles.delete(tile.tile);
        for (const key of tile.chunkKeys) {
          const mesh = chunks.get(key)?.mesh;
          if (mesh !== null && mesh !== undefined) mesh.visible = false;
        }
        hiddenTilesDirty = true;
      }
    }

    for (const chunk of chunks.values()) {
      const distanceSquared = chunkDistanceSquared(
        chunk.coordinate,
        viewPosition,
      );
      if (chunk.touched && distanceSquared <= UNLOAD_RADIUS_SQUARED) {
        chunk.wanted = true;
      }
      if (chunk.touched && distanceSquared <= LOAD_RADIUS_SQUARED) {
        queueChunk(chunk);
      }
      if (!chunk.wanted && !chunk.pending) {
        unloadChunk(chunk);
      }
    }

    for (const pending of pendingBrushCommits) {
      for (const key of pending.chunkKeys) {
        const chunk = chunks.get(key);
        if (chunk === undefined) continue;
        queueChunk(chunk);
      }
    }

    queue.sort(
      (left, right) =>
        chunkDistanceSquared(left.coordinate, viewPosition) -
        chunkDistanceSquared(right.coordinate, viewPosition),
    );
    pumpWorker();
    lastStreamPosition = { ...viewPosition };
    streamDirty = false;
  };

  const commitCompletedMesh = (): void => {
    const result = completed.shift();
    if (result === undefined) return;
    const state = chunks.get(result.key);
    if (
      state === undefined ||
      !state.wanted ||
      result.revision !== state.revision
    ) {
      if (state !== undefined) {
        state.dirty = true;
        streamDirty = true;
      }
      return;
    }
    let nextMesh:
      | THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>
      | null = null;
    if (result.data.positions.length > 0) {
      nextMesh = new THREE.Mesh(createGeometry(result.data), material);
      nextMesh.userData = { kind: "terrain" };
    }
    if (state.pendingBrushes > 0) {
      state.stagedMesh?.geometry.dispose();
      state.stagedMesh = nextMesh;
    } else {
      if (state.mesh !== null) {
        caveGroup.remove(state.mesh);
        state.mesh.geometry.dispose();
      }
      state.mesh = nextMesh;
      if (nextMesh !== null) {
        nextMesh.visible =
          state.surfaceTiles.size === 0 ||
          [...state.surfaceTiles].some((tile) =>
            activeSurfaceTiles.has(tile),
          );
        caveGroup.add(nextMesh);
      }
    }
    state.meshRevision = state.revision;
  };

  const updateSurfaceVisibility = (): void => {
    for (const tileNumber of nearSurfaceTiles) {
      const tile = surfaceTiles.get(tileNumber);
      if (tile === undefined || tile.active) continue;
      const ready = tile.chunkKeys.every((key) => {
        const chunk = chunks.get(key);
        return (
          chunk !== undefined &&
          chunk.meshRevision === chunk.revision &&
          !chunk.dirty &&
          !chunk.pending
        );
      });
      if (!ready) continue;
      tile.active = true;
      activeSurfaceTiles.add(tile.tile);
      for (const key of tile.chunkKeys) {
        const mesh = chunks.get(key)?.mesh;
        if (mesh !== null && mesh !== undefined) mesh.visible = true;
      }
      hiddenTilesDirty = true;
    }
    if (!hiddenTilesDirty) return;
    options.setHiddenSurfaceTiles(activeSurfaceTiles);
    hiddenTilesDirty = false;
  };

  const commitReadyBrushes = (): void => {
    while (pendingBrushCommits.length > 0) {
      const pending = pendingBrushCommits[0]!;
      const chunksReady = pending.chunkKeys.every((key) => {
        const chunk = chunks.get(key);
        return (
          chunk !== undefined &&
          chunk.meshRevision === chunk.revision &&
          !chunk.dirty &&
          !chunk.pending
        );
      });
      const surfaceReady = pending.surfaceTiles.every(
        (tile) => surfaceTiles.get(tile)?.active === true,
      );
      if (!chunksReady || !surfaceReady) return;
      addCaveBrushToIndex(committedIndex, pending.brush);
      pendingBrushCommits.shift();
      for (const tile of pending.surfaceTiles) {
        committedSurfaceTiles.add(tile);
      }
      for (const key of pending.chunkKeys) {
        const chunk = chunks.get(key);
        if (chunk === undefined) continue;
        chunk.pendingBrushes = Math.max(0, chunk.pendingBrushes - 1);
        if (chunk.pendingBrushes > 0) continue;
        if (chunk.mesh !== null) {
          caveGroup.remove(chunk.mesh);
          chunk.mesh.geometry.dispose();
        }
        chunk.mesh = chunk.stagedMesh;
        chunk.stagedMesh = null;
        if (chunk.mesh !== null) {
          chunk.mesh.visible =
            chunk.surfaceTiles.size === 0 ||
            [...chunk.surfaceTiles].some((tile) =>
              activeSurfaceTiles.has(tile),
            );
          caveGroup.add(chunk.mesh);
        }
      }
      newlyCommittedBrushes.push(pending.brush);
      options.onBrushCommitted?.(pending.brush);
      streamDirty = true;
    }
  };

  const densityAt = (x: number, y: number, z: number): number => {
    const coordinate = caveChunkCoordinateAt(x, y, z);
    const key = caveChunkKey(coordinate);
    const brushes =
      (chunks.get(key)?.failures ?? 0) >= 3
        ? []
        : committedIndex.byChunk.get(key) ?? [];
    return sampleCaveDensity(options.surfaceHeightAt, brushes, x, y, z);
  };

  return {
    get brushes(): readonly CaveBrush[] {
      return index.brushes;
    },
    addBrush(brush: CaveBrush): boolean {
      if (
        pendingBrushCommits.length > 0 ||
        !isValidCaveBrush(brush)
      ) {
        return false;
      }
      return registerBrush(brush, false);
    },
    densityAt,
    isNearEdit(
      x: number,
      y: number,
      z: number,
      margin: number,
    ): boolean {
      const minimum = caveChunkCoordinateAt(
        x - margin,
        y - margin,
        z - margin,
      );
      const maximum = caveChunkCoordinateAt(
        x + margin,
        y + margin,
        z + margin,
      );
      for (
        let chunkZ = minimum.z;
        chunkZ <= maximum.z;
        chunkZ += 1
      ) {
        for (
          let chunkY = minimum.y;
          chunkY <= maximum.y;
          chunkY += 1
        ) {
          for (
            let chunkX = minimum.x;
            chunkX <= maximum.x;
            chunkX += 1
          ) {
            const key = caveChunkKey({
              x: chunkX,
              y: chunkY,
              z: chunkZ,
            });
            if (
              (chunks.get(key)?.failures ?? 0) < 3 &&
              committedIndex.byChunk.has(key)
            ) {
              return true;
            }
          }
        }
      }
      return false;
    },
    raycast(
      origin: CavePoint,
      direction: CavePoint,
      maximumDistance: number,
    ): CaveRayHit | null {
      return raycastCaveField(
        densityAt,
        origin,
        direction,
        maximumDistance,
      );
    },
    resolveCapsule(pose: CaveCapsulePose): CaveCapsuleResolution {
      return resolveCapsuleAgainstCave(densityAt, pose);
    },
    update(viewPosition: CavePoint): readonly CaveBrush[] {
      newlyCommittedBrushes.length = 0;
      if (disposed) return newlyCommittedBrushes;
      commitCompletedMesh();
      const movedEnough =
        lastStreamPosition === null ||
        (viewPosition.x - lastStreamPosition.x) ** 2 +
          (viewPosition.y - lastStreamPosition.y) ** 2 +
          (viewPosition.z - lastStreamPosition.z) ** 2 >=
          STREAM_RECHECK_DISTANCE_SQUARED;
      if (streamDirty || movedEnough) updateStreaming(viewPosition);
      updateSurfaceVisibility();
      commitReadyBrushes();
      pumpWorker();
      return [...newlyCommittedBrushes];
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      worker?.terminate();
      worker = null;
      for (const chunk of chunks.values()) {
        chunk.stagedMesh?.geometry.dispose();
        chunk.stagedMesh = null;
      }
      material.dispose();
    },
  };
}
