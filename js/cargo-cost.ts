/**
 * Shared cargo spend helpers for gear installs and field blueprints.
 * Pure — no DOM or Three.js.
 */

import type { Inventory, MaterialId } from "./config.ts";
import { MATERIAL_ORDER, MATERIALS } from "./config.ts";

export type CargoCost = Partial<Record<MaterialId, number>>;

function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const materialId of MATERIAL_ORDER) {
    inventory[materialId] = 0;
  }
  return inventory;
}

export function cloneInventory(inventory: Inventory): Inventory {
  const next = createEmptyInventory();
  for (const materialId of MATERIAL_ORDER) {
    next[materialId] = inventory[materialId];
  }
  return next;
}

export function canAffordCost(cost: CargoCost, inventory: Inventory): boolean {
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    if (inventory[materialId] < amount) return false;
  }
  return true;
}

export function deductCost(cost: CargoCost, inventory: Inventory): Inventory {
  const next = cloneInventory(inventory);
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    next[materialId] -= amount;
  }
  return next;
}

export function addCost(cost: CargoCost, inventory: Inventory): Inventory {
  const next = cloneInventory(inventory);
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    next[materialId] += amount;
  }
  return next;
}

/** Half of each positive line, rounded down. Empty when every line is 1. */
export function salvageRefund(cost: CargoCost): CargoCost {
  const refund: CargoCost = {};
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    const half = Math.floor(amount / 2);
    if (half > 0) refund[materialId] = half;
  }
  return refund;
}

/** Cost lines for UI, ordered like cargo materials. */
export function formatCargoCost(cost: CargoCost): string {
  const parts: string[] = [];
  for (const materialId of MATERIAL_ORDER) {
    const amount = cost[materialId];
    if (amount === undefined || amount <= 0) continue;
    parts.push(`${amount} ${MATERIALS[materialId].label}`);
  }
  return parts.join(" · ");
}
