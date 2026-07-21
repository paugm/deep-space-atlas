import * as THREE from "three";

import {
  DEPOSIT_TYPES,
  VERTICES_PER_ROW,
} from "../config.ts";
import type { DepositType, MaterialId } from "../config.ts";
import type { DepositCollection } from "./types.ts";

export function gridIndex(x: number, z: number): number {
  return z * VERTICES_PER_ROW + x;
}

/**
 * Generated grid loops guarantee these typed-array indices are in bounds.
 * Keeping the assertion here makes every indexed read auditable.
 */
export function generatedArrayValue(
  values: ArrayLike<number>,
  index: number,
): number {
  return values[index]!;
}

export function getBufferAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
): THREE.BufferAttribute {
  const attribute = geometry.getAttribute(name);
  if (!(attribute instanceof THREE.BufferAttribute)) {
    throw new Error(`Expected ${name} to be a BufferAttribute`);
  }
  return attribute;
}

export function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDisposable(value: unknown): value is { dispose(): void } {
  return isRecord(value) && typeof value.dispose === "function";
}

export function isMaterialId(value: unknown): value is MaterialId {
  switch (value) {
    case "silicate":
    case "iron":
    case "carbon":
    case "copper":
    case "crystal":
      return true;
    default:
      return false;
  }
}

export function isDepositType(value: unknown): value is DepositType {
  return isMaterialId(value) && value !== "silicate";
}

export function isCompleteDepositRecord(
  deposits: Partial<Record<DepositType, DepositCollection>>,
): deposits is Record<DepositType, DepositCollection> {
  return DEPOSIT_TYPES.every((type) => deposits[type] !== undefined);
}

export function disposeMaterial(material: THREE.Material): void {
  if ("map" in material) {
    const map: unknown = material.map;
    if (isDisposable(map)) map.dispose();
  }
  material.dispose();
}
