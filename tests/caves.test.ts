import { describe, expect, it } from "vitest";

import { CAVE_CHUNK_SIZE, HALF_WORLD, VERTICES_PER_ROW } from "../js/config.ts";
import { buildCaveChunkMesh } from "../js/world/cave-mesh.ts";
import {
  addCaveBrushToIndex,
  caveBrushChunkCoordinates,
  caveBrushSurfaceTiles,
  caveChunkKey,
  createCaveBrushIndex,
  createDirectionalCaveBrush,
  decodeCaveBrushes,
  encodeCaveBrushes,
  mergeCollinearCaveBrushes,
  raycastCaveField,
  resolveCapsuleAgainstCave,
  sampleCaveDensity,
  snapCaveBrushToSurface,
} from "../js/world/caves.ts";
import type {
  CaveBrush,
  CaveField,
} from "../js/world/caves.ts";

const flatSurface = (): number => 0;

const ORIGIN_CHUNK = Math.floor(HALF_WORLD / CAVE_CHUNK_SIZE);

function tunnelBrush(): CaveBrush {
  return {
    start: { x: -1, y: -2, z: 0 },
    end: { x: 1, y: -2, z: 0 },
    radius: 1.6,
  };
}

describe("cave brushes", () => {
  it("creates a player-sized capsule in the look direction", () => {
    const brush = createDirectionalCaveBrush(
      { x: 4, y: 5, z: 6 },
      { x: 0, y: 0, z: -2 },
    );
    expect(brush.radius).toBe(1.6);
    expect(brush.start).toEqual({ x: 4, y: 5, z: 7.7 });
    expect(brush.end).toEqual({ x: 4, y: 5, z: 4.35 });
  });

  it("compacts overlapping straight strokes but preserves turns", () => {
    const first: CaveBrush = {
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2, y: 0, z: 0 },
      radius: 1.6,
    };
    const straight: CaveBrush = {
      start: { x: 1.9, y: 0, z: 0 },
      end: { x: 4, y: 0, z: 0 },
      radius: 1.6,
    };
    const turn: CaveBrush = {
      start: { x: 4, y: 0, z: 0 },
      end: { x: 4, y: 0, z: 2 },
      radius: 1.6,
    };
    expect(mergeCollinearCaveBrushes(first, straight)).toEqual({
      start: first.start,
      end: straight.end,
      radius: 1.6,
    });
    expect(mergeCollinearCaveBrushes(first, turn)).toBeNull();
    expect(
      mergeCollinearCaveBrushes(first, {
        start: { x: 1.9, y: 0, z: 0 },
        end: { x: 50, y: 0, z: 0 },
        radius: 1.6,
      }),
    ).toBeNull();
  });

  it("indexes a crossing brush in every touched sparse chunk", () => {
    const brush: CaveBrush = {
      start: { x: -1, y: -1, z: -1 },
      end: { x: 1, y: 1, z: 1 },
      radius: 1,
    };
    const coordinates = caveBrushChunkCoordinates(brush);
    expect(coordinates).toHaveLength(8);

    const index = createCaveBrushIndex();
    expect(addCaveBrushToIndex(index, brush)).toBe(true);
    for (const coordinate of coordinates) {
      expect(index.byChunk.get(caveChunkKey(coordinate))).toEqual([brush]);
    }
  });

  it("finds only surface tiles actually opened by a brush", () => {
    const opening: CaveBrush = {
      start: { x: -1, y: 0.5, z: 0 },
      end: { x: 1, y: -1, z: 0 },
      radius: 1.6,
    };
    const buried: CaveBrush = {
      start: { x: -1, y: -8, z: 0 },
      end: { x: 1, y: -8, z: 0 },
      radius: 1.6,
    };
    expect(caveBrushSurfaceTiles(opening, flatSurface).length).toBeGreaterThan(
      0,
    );
    expect(caveBrushSurfaceTiles(buried, flatSurface)).toEqual([]);
  });

  it("snaps sub-cell roofs open for matching mesh and collision topology", () => {
    const shallow: CaveBrush = {
      start: { x: -1, y: -1.7, z: 0 },
      end: { x: 1, y: -1.7, z: 0 },
      radius: 1.6,
    };
    const snapped = snapCaveBrushToSurface(shallow, flatSurface);
    expect(snapped.radius).toBeGreaterThan(shallow.radius);
    expect(caveBrushSurfaceTiles(snapped, flatSurface).length).toBeGreaterThan(
      0,
    );
    expect(
      sampleCaveDensity(flatSurface, [snapped], 0, 0, 0),
    ).toBeGreaterThan(0);
  });

  it("round-trips compact quantized brush records", () => {
    const brush = tunnelBrush();
    const encoded = encodeCaveBrushes([brush]);
    expect(encoded.byteLength).toBe(14);
    expect(decodeCaveBrushes(encoded)).toEqual([brush]);
    expect(decodeCaveBrushes(encoded.subarray(1))).toBeNull();
  });
});

describe("cave density queries", () => {
  const brush = tunnelBrush();
  const field: CaveField = (x, y, z) =>
    sampleCaveDensity(flatSurface, [brush], x, y, z);

  it("combines the solid heightfield with capsule-shaped empty space", () => {
    expect(field(0, -2, 0)).toBeCloseTo(1.6);
    expect(field(0, -4, 0)).toBeLessThan(0);
    expect(field(0, 1, 0)).toBeGreaterThan(0);
  });

  it("raycasts cave walls from inside the excavated volume", () => {
    const hit = raycastCaveField(
      field,
      { x: 0, y: -2, z: 0 },
      { x: 0, y: 0, z: 1 },
      5,
    );
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(1.6, 1);
    expect(hit?.normal.z).toBeLessThan(-0.9);
  });

  it("pushes the player capsule away from a cave wall", () => {
    const result = resolveCapsuleAgainstCave(field, {
      x: 0,
      y: -1.9,
      z: 1.45,
      radius: 0.38,
      eyeHeight: 1.7,
    });
    expect(result.z).toBeLessThan(1.3);
    expect(result.correctionZ).toBeLessThan(0);
  });
});

describe("cave meshing", () => {
  it("builds finite triangles for a carved surface chunk", () => {
    const vertexCount = VERTICES_PER_ROW * VERTICES_PER_ROW;
    const heights = new Float32Array(vertexCount);
    const colors = new Float32Array(vertexCount * 3);
    colors.fill(0.75);

    const mesh = buildCaveChunkMesh({
      coordinate: { x: ORIGIN_CHUNK, y: -1, z: ORIGIN_CHUNK },
      heights,
      surfaceColors: colors,
      brushes: [tunnelBrush()],
      caveColor: [0.25, 0.2, 0.16],
      includeSurface: false,
    });

    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.positions.length % 9).toBe(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.colors.length).toBe(mesh.positions.length);
    expect(
      [...mesh.positions, ...mesh.normals, ...mesh.colors].every(
        Number.isFinite,
      ),
    ).toBe(true);
  });

  it("omits the outer heightfield skin for a buried cave chunk", () => {
    const vertexCount = VERTICES_PER_ROW * VERTICES_PER_ROW;
    const heights = new Float32Array(vertexCount);
    heights.fill(10);
    const colors = new Float32Array(vertexCount * 3);
    colors.fill(0.75);
    const buried: CaveBrush = {
      start: { x: -1, y: 2, z: 0 },
      end: { x: 1, y: 2, z: 0 },
      radius: 1.6,
    };

    const mesh = buildCaveChunkMesh({
      coordinate: { x: ORIGIN_CHUNK, y: 0, z: ORIGIN_CHUNK },
      heights,
      surfaceColors: colors,
      brushes: [buried],
      caveColor: [0.25, 0.2, 0.16],
      includeSurface: false,
    });

    const yCoordinates = mesh.positions.filter(
      (_value, index) => index % 3 === 1,
    );
    expect(yCoordinates.length).toBeGreaterThan(0);
    expect(Math.max(...yCoordinates)).toBeLessThan(4);
  });
});
