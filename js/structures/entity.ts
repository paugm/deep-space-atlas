import type { PlanetDocument, PlanetEntity } from "../planet-save.ts";
import {
  isBlueprintId,
  type BlueprintId,
} from "../blueprints.ts";

export const STRUCTURE_ENTITY_KIND = "structure" as const;

export interface StructurePose {
  id: string;
  blueprintId: BlueprintId;
  x: number;
  z: number;
  yaw: number;
}

export function listStructureEntities(
  document: Pick<PlanetDocument, "entities">,
): PlanetEntity[] {
  return document.entities.filter(
    (entry) => entry.kind === STRUCTURE_ENTITY_KIND,
  );
}

export function parseStructurePose(entity: PlanetEntity): StructurePose | null {
  if (entity.kind !== STRUCTURE_ENTITY_KIND) return null;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return null;
  if (entity.yaw === undefined || !Number.isFinite(entity.yaw)) return null;
  const blueprintId = entity.data?.blueprintId;
  if (!isBlueprintId(blueprintId)) return null;
  if (typeof entity.id !== "string" || entity.id.length === 0) return null;
  return {
    id: entity.id,
    blueprintId,
    x: entity.x,
    z: entity.z,
    yaw: entity.yaw,
  };
}

export function createStructureEntity(pose: StructurePose): PlanetEntity {
  return {
    id: pose.id,
    kind: STRUCTURE_ENTITY_KIND,
    x: pose.x,
    // Restored via heightAt; kept for PlanetEntity shape completeness.
    y: 0,
    z: pose.z,
    yaw: pose.yaw,
    data: { blueprintId: pose.blueprintId },
  };
}
