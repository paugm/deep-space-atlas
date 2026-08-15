import { describe, expect, it } from "vitest";

import { VERTICES_PER_ROW } from "../js/config.ts";
import {
  MINIMAP_SIZE,
  altitudeColor,
  fillMinimapPixels,
  worldToMapPixel,
} from "../js/minimap.ts";

const palette = {
  low: [0.1, 0.2, 0.3] as const,
  mid: [0.4, 0.5, 0.3] as const,
  high: [0.7, 0.6, 0.4] as const,
  peak: [1, 1, 1] as const,
  water: [0.1, 0.3, 0.8] as const,
};

describe("worldToMapPixel", () => {
  it("maps world origin to the map center and -Z toward the top", () => {
    const origin = worldToMapPixel(0, 0, MINIMAP_SIZE);
    expect(origin.x).toBe(Math.floor((MINIMAP_SIZE - 1) / 2));
    expect(origin.y).toBe(Math.floor((MINIMAP_SIZE - 1) / 2));

    const north = worldToMapPixel(0, -500, MINIMAP_SIZE);
    const south = worldToMapPixel(0, 500, MINIMAP_SIZE);
    expect(north.y).toBeLessThan(south.y);
  });
});

describe("altitudeColor", () => {
  it("picks low, mid, and peak bands", () => {
    expect(altitudeColor(0, palette)).toEqual(palette.low);
    expect(altitudeColor(0.5, palette)).toEqual(palette.mid);
    expect(altitudeColor(1, palette)[0]).toBeCloseTo(1, 10);
    expect(altitudeColor(1, palette)[1]).toBeCloseTo(1, 10);
    expect(altitudeColor(1, palette)[2]).toBeCloseTo(1, 10);
  });
});

describe("fillMinimapPixels", () => {
  it("paints water where the heightfield is at or below water level", () => {
    const mapSize = 4;
    const pixels = new Uint8ClampedArray(mapSize * mapSize * 4);
    const heights = new Float32Array(VERTICES_PER_ROW * VERTICES_PER_ROW);
    heights.fill(10);
    heights[0] = 0;
    fillMinimapPixels(pixels, {
      heights,
      verticesPerRow: VERTICES_PER_ROW,
      minimumHeight: 0,
      maximumHeight: 10,
      palette,
      mapSize,
      waterLevel: 1,
      surfaceKind: "water",
    });
    expect(pixels[0]).toBe(Math.round(0.1 * 255));
    expect(pixels[2]).toBe(Math.round(0.8 * 255));
    expect(pixels[3]).toBe(255);
  });
});
