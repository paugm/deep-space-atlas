/**
 * Heightfield nav map math. Painting lives in the UI; this module stays pure.
 */

import {
  HALF_WORLD,
  WORLD_SIZE,
  clamp,
  lerp,
} from "./config.ts";
import type { SurfaceKind } from "./world/planet-class.ts";

export const MINIMAP_SIZE = 128;

export interface MinimapPaletteRgb {
  low: readonly [number, number, number];
  mid: readonly [number, number, number];
  high: readonly [number, number, number];
  peak: readonly [number, number, number];
  water?: readonly [number, number, number];
}

export interface MinimapMarker {
  x: number;
  z: number;
  kind: "player" | "structure" | "pet" | "crew";
  yaw?: number;
}

/** World XZ → pixel on a square map. Forward at yaw 0 is -Z (top of the map). */
export function worldToMapPixel(
  x: number,
  z: number,
  mapSize: number,
): { x: number; y: number } {
  const u = clamp((x + HALF_WORLD) / WORLD_SIZE, 0, 1);
  const v = clamp((z + HALF_WORLD) / WORLD_SIZE, 0, 1);
  return {
    x: Math.floor(u * (mapSize - 1)),
    y: Math.floor(v * (mapSize - 1)),
  };
}

export function altitudeColor(
  altitude: number,
  palette: MinimapPaletteRgb,
): readonly [number, number, number] {
  const t = clamp(altitude, 0, 1);
  if (t < 0.22) return palette.low;
  if (t < 0.38) {
    const amount = (t - 0.22) / 0.16;
    return lerpRgb(palette.low, palette.mid, amount);
  }
  if (t < 0.62) return palette.mid;
  if (t < 0.78) {
    const amount = (t - 0.62) / 0.16;
    return lerpRgb(palette.mid, palette.high, amount);
  }
  if (t < 0.9) return palette.high;
  const amount = (t - 0.9) / 0.1;
  return lerpRgb(palette.high, palette.peak, amount);
}

function lerpRgb(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [
    lerp(start[0], end[0], amount),
    lerp(start[1], end[1], amount),
    lerp(start[2], end[2], amount),
  ];
}

export function fillMinimapPixels(
  pixels: Uint8ClampedArray,
  options: {
    heights: ArrayLike<number>;
    verticesPerRow: number;
    minimumHeight: number;
    maximumHeight: number;
    palette: MinimapPaletteRgb;
    mapSize: number;
    waterLevel: number;
    surfaceKind: SurfaceKind;
  },
): void {
  const {
    heights,
    verticesPerRow,
    minimumHeight,
    maximumHeight,
    palette,
    mapSize,
    waterLevel,
    surfaceKind,
  } = options;
  const span = Math.max(0.0001, maximumHeight - minimumHeight);
  const last = verticesPerRow - 1;

  for (let y = 0; y < mapSize; y += 1) {
    const gridZ = Math.round((y / Math.max(mapSize - 1, 1)) * last);
    for (let x = 0; x < mapSize; x += 1) {
      const gridX = Math.round((x / Math.max(mapSize - 1, 1)) * last);
      const height = heights[gridZ * verticesPerRow + gridX] ?? minimumHeight;
      const wet =
        surfaceKind !== "none" && height <= waterLevel + 0.15;
      const color =
        wet && palette.water !== undefined
          ? palette.water
          : altitudeColor((height - minimumHeight) / span, palette);
      const index = (y * mapSize + x) * 4;
      pixels[index] = Math.round(color[0] * 255);
      pixels[index + 1] = Math.round(color[1] * 255);
      pixels[index + 2] = Math.round(color[2] * 255);
      pixels[index + 3] = 255;
    }
  }
}
