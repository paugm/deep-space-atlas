import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { VERTICES_PER_ROW } from "../js/config.ts";
import { createCaveRuntime } from "../js/world/cave-runtime.ts";
import type { CaveBrush } from "../js/world/caves.ts";

function waitForTimer(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
}

describe("cave runtime commits", () => {
  it("keeps collision unchanged until an affected mesh is ready", async () => {
    const vertexCount = VERTICES_PER_ROW * VERTICES_PER_ROW;
    const heights = new Float32Array(vertexCount);
    heights.fill(10);
    const gridToVertex = Int32Array.from(
      { length: vertexCount },
      (_unused, index) => index,
    );
    const colors = new Float32Array(vertexCount * 3);
    colors.fill(0.6);
    const group = new THREE.Group();
    const runtime = await createCaveRuntime({
      group,
      heights,
      gridToVertex,
      colorAttribute: new THREE.BufferAttribute(colors, 3),
      surfaceHeightAt: () => 10,
      caveColor: new THREE.Color(0.25, 0.2, 0.16),
      brushes: [],
      setHiddenSurfaceTiles: () => undefined,
    });
    const brush: CaveBrush = {
      start: { x: -11, y: 2, z: -10 },
      end: { x: -9, y: 2, z: -10 },
      radius: 1.6,
    };

    expect(runtime.addBrush(brush)).toBe(true);
    expect(runtime.addBrush(brush)).toBe(false);
    expect(runtime.densityAt(-10, 2, -10)).toBeLessThan(0);

    let committed: readonly CaveBrush[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      committed = runtime.update({ x: -10, y: 2, z: -10 });
      if (committed.length > 0) break;
      await waitForTimer();
    }

    expect(committed).toEqual([brush]);
    expect(runtime.densityAt(-10, 2, -10)).toBeGreaterThan(0);
    const caveGroup = group.getObjectByName("cave-volume");
    expect(caveGroup?.children.length).toBe(1);
    runtime.update({ x: 140, y: 2, z: 140 });
    expect(caveGroup?.children.length).toBe(0);
    runtime.dispose();
  });

  it("finishes a pending surface replacement after the player moves away", async () => {
    const vertexCount = VERTICES_PER_ROW * VERTICES_PER_ROW;
    const heights = new Float32Array(vertexCount);
    const gridToVertex = Int32Array.from(
      { length: vertexCount },
      (_unused, index) => index,
    );
    const colors = new Float32Array(vertexCount * 3);
    colors.fill(0.6);
    const group = new THREE.Group();
    let hiddenTileCount = 0;
    const runtime = await createCaveRuntime({
      group,
      heights,
      gridToVertex,
      colorAttribute: new THREE.BufferAttribute(colors, 3),
      surfaceHeightAt: () => 0,
      caveColor: new THREE.Color(0.25, 0.2, 0.16),
      brushes: [],
      setHiddenSurfaceTiles(tiles) {
        hiddenTileCount = tiles.size;
      },
    });
    const brush: CaveBrush = {
      start: { x: -11, y: 0.5, z: -10 },
      end: { x: -9, y: -1, z: -10 },
      radius: 1.6,
    };
    expect(runtime.addBrush(brush)).toBe(true);

    let committed: readonly CaveBrush[] = [];
    for (let attempt = 0; attempt < 150; attempt += 1) {
      committed = runtime.update({ x: 140, y: 20, z: 140 });
      if (committed.length > 0) break;
      await waitForTimer();
    }

    expect(committed).toEqual([brush]);
    expect(hiddenTileCount).toBeGreaterThan(0);
    expect(runtime.densityAt(-10, 0, -10)).toBeGreaterThan(0);
    runtime.dispose();
  });
});
