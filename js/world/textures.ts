import * as THREE from "three";

import type { RandomSource } from "../config.ts";

/** Uniform-ish random points on a sphere shell (deterministic via `random`). */
export function createStarPositions(
  random: RandomSource,
  count: number,
  radius: number,
): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    positions[index * 3] = Math.cos(angle) * ring * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] = Math.sin(angle) * ring * radius;
  }
  return positions;
}

export function createRadialTexture(
  innerColor: string,
  outerColor: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");

  const gradient = context.createRadialGradient(
    32,
    32,
    0,
    32,
    32,
    32,
  );
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(0.35, outerColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
