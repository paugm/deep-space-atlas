import * as THREE from "three";

import {
  CAVE_CHUNK_SIZE,
  DEPOSIT_TYPES,
  MINING_RANGE,
  clamp,
} from "../config.ts";
import type { DepositType } from "../config.ts";
import type {
  PlanetDocument,
  TerrainHeightSample,
} from "../planet-save.ts";
import {
  caveBrushesArray,
  WORLD_CONTENT_REVISION,
  unpackHeights,
} from "../planet-save.ts";
import { createCaveRuntime } from "./cave-runtime.ts";
import {
  createDirectionalCaveBrush,
  snapCaveBrushToSurface,
} from "./caves.ts";
import { buildWorld } from "./generate.ts";
import {
  disposeWorldGroup,
  refreshDepositInstance,
  updateDayNight as presentDayNight,
} from "./present.ts";
import { getAimHit as resolveAimHit } from "./target.ts";
import {
  applyHeightSamples,
  setHiddenTerrainSurfaceTiles,
} from "./terrain.ts";
import { generatedArrayValue } from "./util.ts";
import type { World, WorldSystem } from "./types.ts";

export type {
  AimHit,
  BiomeConfig,
  DepositCollection,
  DepositEntry,
  World,
  WorldPalette,
  WorldSystem,
} from "./types.ts";
export { createRadialTexture } from "./textures.ts";
export { createDepositGeometry } from "./deposit-geometry.ts";
export { depositStableId } from "./deposit-id.ts";
export {
  createPlanetName,
  createPalette,
  biomeFromPlanetClass,
  pickPlanetClass,
  PLANET_CLASSES,
  PLANET_CLASS_IDS,
} from "./generate.ts";
export type {
  PlanetClassDefinition,
  PlanetClassId,
  SurfaceKind,
} from "./generate.ts";
export { sampleHeightBilinear } from "./terrain.ts";
export {
  cellCoord,
  cellKey,
  forEachCellInRadius,
} from "./spatial-index.ts";

function unpackPackedTerrain(
  terrain: Extract<PlanetDocument["terrain"], { kind: "packed" }>,
): Float32Array | null {
  if (terrain.encoding !== "f32le-b64") return null;
  return unpackHeights(terrain.data);
}

/**
 * Own all seed-specific scene data and world queries.
 * dispose() is the sole release path for resources created by build().
 */
export function createWorldSystem(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): WorldSystem {
  let world: World | null = null;
  const raycaster = new THREE.Raycaster();
  raycaster.far = MINING_RANGE;
  const screenCenter = new THREE.Vector2(0, 0);
  const scratch = {
    vector: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    dayTint: new THREE.Color(),
  };

  // Gameplay calls these methods only after build; preserving that contract
  // also preserves the original failure mode for invalid lifecycle use.
  const requireWorld = (): World => world!;

  function hideInstance(
    mesh: THREE.InstancedMesh,
    index: number,
  ): void {
    mesh.getMatrixAt(index, scratch.matrix);
    scratch.matrix.decompose(
      scratch.vector,
      scratch.quaternion,
      scratch.scale,
    );
    if (scratch.scale.lengthSq() < 1e-8) return;
    scratch.matrix.compose(
      scratch.vector,
      scratch.quaternion,
      scratch.scale.setScalar(0.0001),
    );
    mesh.setMatrixAt(index, scratch.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function surfaceSupportRemoved(
    activeWorld: World,
    x: number,
    z: number,
  ): boolean {
    const caves = activeWorld.caves;
    if (caves === null) return false;
    return (
      caves.densityAt(
        x,
        activeWorld.heightAt(x, z) - 0.08,
        z,
      ) > 0
    );
  }

  function hideUnsupportedSurfaceObjects(
    activeWorld: World,
    x?: number,
    z?: number,
    radius: number = MINING_RANGE,
  ): void {
    const candidates =
      x === undefined || z === undefined
        ? [
            ...Array.from(
              { length: activeWorld.rocks.count },
              (_unused, index) =>
                ({ kind: "rock", index }) as const,
            ),
            ...DEPOSIT_TYPES.flatMap((type) =>
              activeWorld.deposits[type].list.map(
                (_entry, index) =>
                  ({ kind: "deposit", type, index }) as const,
              ),
            ),
            ...(activeWorld.flora === null
              ? []
              : Array.from(
                  { length: activeWorld.flora.trunks.count },
                  (_unused, index) =>
                    ({ kind: "flora", index }) as const,
                )),
          ]
        : activeWorld.aimIndex.query(x, z, radius);
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key =
        candidate.kind === "deposit"
          ? `${candidate.kind}:${candidate.type}:${candidate.index}`
          : `${candidate.kind}:${candidate.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      switch (candidate.kind) {
        case "rock":
          activeWorld.rocks.getMatrixAt(candidate.index, scratch.matrix);
          scratch.vector.setFromMatrixPosition(scratch.matrix);
          if (
            surfaceSupportRemoved(
              activeWorld,
              scratch.vector.x,
              scratch.vector.z,
            )
          ) {
            hideInstance(activeWorld.rocks, candidate.index);
          }
          break;
        case "flora":
          if (activeWorld.flora === null) break;
          activeWorld.flora.trunks.getMatrixAt(
            candidate.index,
            scratch.matrix,
          );
          scratch.vector.setFromMatrixPosition(scratch.matrix);
          if (
            surfaceSupportRemoved(
              activeWorld,
              scratch.vector.x,
              scratch.vector.z,
            )
          ) {
            hideInstance(activeWorld.flora.trunks, candidate.index);
            hideInstance(activeWorld.flora.canopies, candidate.index);
          }
          break;
        case "deposit": {
          const entry =
            activeWorld.deposits[candidate.type].list[candidate.index];
          if (
            entry !== undefined &&
            surfaceSupportRemoved(
              activeWorld,
              entry.position.x,
              entry.position.z,
            )
          ) {
            hideInstance(
              activeWorld.deposits[candidate.type].mesh,
              candidate.index,
            );
          }
          break;
        }
        default: {
          const exhaustive: never = candidate;
          throw new Error(
            `Unknown surface candidate: ${String(exhaustive)}`,
          );
        }
      }
    }
  }

  function dispose(): void {
    if (!world) return;
    world.caves?.dispose();
    disposeWorldGroup(scene, world);
    world = null;
  }

  function refreshDeposit(type: DepositType, index: number): void {
    refreshDepositInstance(requireWorld(), type, index, scratch);
  }

  async function build(seed: number): Promise<World> {
    dispose();
    world = await buildWorld({
      scene,
      renderer,
      seed,
    });
    return world;
  }

  function updateDayNight(time: number, cameraY?: number): void {
    if (!world) return;
    presentDayNight(world, scene, renderer, time, scratch, cameraY);
  }

  async function applyPlanetPatch(document: PlanetDocument): Promise<void> {
    const activeWorld = requireWorld();

    if (document.terrain?.kind === "sparse") {
      await applyHeightSamples(
        activeWorld,
        document.terrain.cells.map(([index, height]) => ({
          index,
          height,
        })),
        scratch.vector,
      );
    } else if (document.terrain?.kind === "packed") {
      const heights = unpackPackedTerrain(document.terrain);
      if (heights !== null) {
        const samples: TerrainHeightSample[] = [];
        for (let index = 0; index < heights.length; index += 1) {
          const height = heights[index];
          if (height === undefined) continue;
          if (
            height ===
            generatedArrayValue(activeWorld.heights, index)
          ) {
            continue;
          }
          samples.push({ index, height });
        }
        await applyHeightSamples(activeWorld, samples, scratch.vector);
      }
    }

    if (
      document.deposits &&
      document.contentRevision === WORLD_CONTENT_REVISION
    ) {
      for (const type of DEPOSIT_TYPES) {
        const list = document.deposits[type];
        if (list === undefined) continue;
        for (const entry of list) {
          const index = activeWorld.deposits[type].byId.get(entry.id);
          if (index === undefined) continue;
          const deposit = activeWorld.deposits[type].list[index];
          if (deposit === undefined) continue;
          deposit.remaining = clamp(
            entry.remaining,
            0,
            deposit.capacity,
          );
          refreshDeposit(type, index);
        }
      }
    }

    const caveBrushes =
      document.caves === undefined
        ? []
        : caveBrushesArray(document.caves) ?? [];
    activeWorld.caves = await createCaveRuntime({
      group: activeWorld.group,
      heights: activeWorld.heights,
      gridToVertex: activeWorld.gridToVertex,
      colorAttribute: activeWorld.colorAttribute,
      surfaceHeightAt: activeWorld.heightAt,
      caveColor: activeWorld.palette.crater,
      brushes: caveBrushes,
      setHiddenSurfaceTiles(tiles) {
        setHiddenTerrainSurfaceTiles(activeWorld, tiles);
      },
      onBrushCommitted(brush) {
        hideUnsupportedSurfaceObjects(
          activeWorld,
          brush.end.x,
          brush.end.z,
          brush.radius + CAVE_CHUNK_SIZE * 0.25,
        );
      },
    });
    hideUnsupportedSurfaceObjects(activeWorld);
  }

  function carveCave(
    point: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
  ) {
    const caves = requireWorld().caves;
    if (caves === null) return null;
    const brush = snapCaveBrushToSurface(
      createDirectionalCaveBrush(point, direction),
      requireWorld().heightAt,
    );
    if (!caves.addBrush(brush)) return null;
    return brush;
  }

  function updateTerrain(viewPosition: {
    x: number;
    y: number;
    z: number;
  }) {
    return world?.caves?.update(viewPosition) ?? [];
  }

  function getAimHit(camera: THREE.Camera) {
    return resolveAimHit(
      requireWorld(),
      camera,
      raycaster,
      screenCenter,
    );
  }

  return {
    applyPlanetPatch,
    build,
    carveCave,
    dispose,
    getAimHit,
    refreshDeposit,
    updateTerrain,
    updateDayNight,
    get current(): World | null {
      return world;
    },
  };
}
