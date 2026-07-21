import type { PlanetDocument, PlanetEntity } from "../planet-save.ts";
import { isRoverKindId, type RoverKindId } from "./kinds.ts";

export const ROVER_ENTITY_KIND = "rover" as const;

export interface RoverPose {
  id: string;
  kind: RoverKindId;
  x: number;
  z: number;
  yaw: number;
}

export function listRoverEntities(
  document: Pick<PlanetDocument, "entities">,
): PlanetEntity[] {
  return document.entities.filter(
    (entry) => entry.kind === ROVER_ENTITY_KIND,
  );
}

export function parseRoverPose(entity: PlanetEntity): RoverPose | null {
  if (entity.kind !== ROVER_ENTITY_KIND) return null;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return null;
  if (entity.yaw === undefined || !Number.isFinite(entity.yaw)) return null;
  const kind = entity.data?.roverKind;
  if (!isRoverKindId(kind)) return null;
  if (typeof entity.id !== "string" || entity.id.length === 0) return null;
  return {
    id: entity.id,
    kind,
    x: entity.x,
    z: entity.z,
    yaw: entity.yaw,
  };
}

export function createRoverEntity(pose: RoverPose): PlanetEntity {
  return {
    id: pose.id,
    kind: ROVER_ENTITY_KIND,
    x: pose.x,
    // Restored via heightAt; kept for PlanetEntity shape completeness.
    y: 0,
    z: pose.z,
    yaw: pose.yaw,
    data: { roverKind: pose.kind },
  };
}
