import type { DepositType } from "../config.ts";

/**
 * Stable deposit identity from type + quantized XZ.
 * Survives generation-order changes as long as placement positions stay put.
 */
export function depositStableId(
  type: DepositType,
  x: number,
  z: number,
): string {
  const qx = Math.round(x * 100);
  const qz = Math.round(z * 100);
  return `${type}:${qx}:${qz}`;
}
