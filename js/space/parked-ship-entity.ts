import type { PlanetDocument, PlanetEntity } from "../planet-save.ts";
import { findPlanetEntity, upsertPlanetEntity } from "../planet-save.ts";

export const PARKED_SHIP_ENTITY_KIND = "parked-ship" as const;

export interface ParkedShipPose {
  x: number;
  z: number;
  yaw: number;
}

export function findParkedShipEntity(
  document: Pick<PlanetDocument, "entities">,
): PlanetEntity | null {
  return findPlanetEntity(document, PARKED_SHIP_ENTITY_KIND);
}

export function parseParkedShipPose(
  entity: PlanetEntity,
): ParkedShipPose | null {
  if (entity.kind !== PARKED_SHIP_ENTITY_KIND) return null;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return null;
  if (entity.yaw === undefined || !Number.isFinite(entity.yaw)) return null;
  return { x: entity.x, z: entity.z, yaw: entity.yaw };
}

export function createParkedShipEntity(
  pose: ParkedShipPose,
): PlanetEntity {
  return {
    id: PARKED_SHIP_ENTITY_KIND,
    kind: PARKED_SHIP_ENTITY_KIND,
    x: pose.x,
    // Restored via heightAt; kept for PlanetEntity shape completeness.
    y: 0,
    z: pose.z,
    yaw: pose.yaw,
  };
}

export function upsertParkedShipEntity(
  document: PlanetDocument,
  entity: PlanetEntity,
): void {
  upsertPlanetEntity(document, entity);
}
