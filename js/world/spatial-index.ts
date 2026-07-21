import * as THREE from "three";

import { DEPOSIT_TYPES, HALF_WORLD, WORLD_SIZE } from "../config.ts";
import type {
  AimCandidate,
  DepositCollection,
  FloraCollection,
  SpatialAimIndex,
  World,
} from "./types.ts";

const DEFAULT_CELL_SIZE = WORLD_SIZE / 32;

export function cellCoord(value: number, cellSize: number): number {
  return Math.floor((value + HALF_WORLD) / cellSize);
}

export function cellKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}

/** Iterate integer cell coordinates overlapping a circle in XZ. */
export function forEachCellInRadius(
  x: number,
  z: number,
  radius: number,
  cellSize: number,
  visit: (cellX: number, cellZ: number) => void,
): void {
  const minimumX = cellCoord(x - radius, cellSize);
  const maximumX = cellCoord(x + radius, cellSize);
  const minimumZ = cellCoord(z - radius, cellSize);
  const maximumZ = cellCoord(z + radius, cellSize);
  for (let cellZ = minimumZ; cellZ <= maximumZ; cellZ += 1) {
    for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
      visit(cellX, cellZ);
    }
  }
}

function insert(
  cells: Map<string, AimCandidate[]>,
  cellSize: number,
  x: number,
  z: number,
  candidate: AimCandidate,
): void {
  const key = cellKey(cellCoord(x, cellSize), cellCoord(z, cellSize));
  const bucket = cells.get(key);
  if (bucket) bucket.push(candidate);
  else cells.set(key, [candidate]);
}

/**
 * Build a uniform XZ hash of aimable instances. Positions are taken from
 * instance matrices (rocks/flora) or deposit entries.
 */
export function buildSpatialAimIndex(
  world: {
    rocks: THREE.InstancedMesh;
    deposits: Record<string, DepositCollection>;
    flora: FloraCollection | null;
  },
  cellSize: number = DEFAULT_CELL_SIZE,
): SpatialAimIndex {
  const cells = new Map<string, AimCandidate[]>();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();

  for (let index = 0; index < world.rocks.count; index += 1) {
    world.rocks.getMatrixAt(index, matrix);
    position.setFromMatrixPosition(matrix);
    insert(cells, cellSize, position.x, position.z, {
      kind: "rock",
      index,
    });
  }

  for (const type of DEPOSIT_TYPES) {
    const collection = world.deposits[type];
    if (!collection) continue;
    collection.list.forEach((entry, index) => {
      insert(cells, cellSize, entry.position.x, entry.position.z, {
        kind: "deposit",
        type,
        index,
      });
    });
  }

  if (world.flora) {
    for (let index = 0; index < world.flora.trunks.count; index += 1) {
      world.flora.trunks.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      insert(cells, cellSize, position.x, position.z, {
        kind: "flora",
        index,
      });
    }
  }

  return {
    cellSize,
    query(x: number, z: number, radius: number): AimCandidate[] {
      const seen = new Set<string>();
      const results: AimCandidate[] = [];
      forEachCellInRadius(x, z, radius, cellSize, (cellX, cellZ) => {
        const bucket = cells.get(cellKey(cellX, cellZ));
        if (!bucket) return;
        for (const candidate of bucket) {
          const token =
            candidate.kind === "deposit"
              ? `deposit:${candidate.type}:${candidate.index}`
              : `${candidate.kind}:${candidate.index}`;
          if (seen.has(token)) continue;
          seen.add(token);
          results.push(candidate);
        }
      });
      return results;
    },
  };
}

export type { AimCandidate, SpatialAimIndex, World };
