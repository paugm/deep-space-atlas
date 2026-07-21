import { describe, expect, it } from "vitest";

import { HALF_WORLD, WORLD_SIZE } from "../js/config.ts";
import { depositStableId } from "../js/world/deposit-id.ts";
import {
  cellCoord,
  cellKey,
  forEachCellInRadius,
} from "../js/world/spatial-index.ts";

describe("depositStableId", () => {
  it("is stable for the same type and position", () => {
    expect(depositStableId("iron", 12.345, -9.876)).toBe(
      depositStableId("iron", 12.345, -9.876),
    );
  });

  it("quantizes position so tiny float noise does not change the id", () => {
    expect(depositStableId("crystal", 1.001, 2.004)).toBe(
      depositStableId("crystal", 1.004, 2.002),
    );
  });

  it("differs across types or cells", () => {
    expect(depositStableId("iron", 1, 2)).not.toBe(
      depositStableId("copper", 1, 2),
    );
    expect(depositStableId("iron", 1, 2)).not.toBe(
      depositStableId("iron", 1.02, 2),
    );
  });
});

describe("spatial cell helpers", () => {
  it("maps world coordinates into cell indices", () => {
    const cellSize = WORLD_SIZE / 32;
    expect(cellCoord(-HALF_WORLD, cellSize)).toBe(0);
    expect(cellCoord(0, cellSize)).toBe(16);
    expect(cellKey(3, 5)).toBe("3:5");
  });

  it("visits every cell overlapping a radius", () => {
    const visited: string[] = [];
    forEachCellInRadius(0, 0, 25, 20, (cellX, cellZ) => {
      visited.push(cellKey(cellX, cellZ));
    });
    expect(visited.length).toBeGreaterThan(1);
    expect(new Set(visited).size).toBe(visited.length);
  });
});
