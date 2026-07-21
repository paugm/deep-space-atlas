import type { PlanetDocument, PlanetEntity } from "../planet-save.ts";
import { findPlanetEntity, upsertPlanetEntity } from "../planet-save.ts";
import { isFaunaSpeciesId, type FaunaSpeciesId } from "./species.ts";

export const PET_ENTITY_KIND = "pet" as const;

export interface PetEntityData {
  species: FaunaSpeciesId;
  sourceSpawnId?: string;
}

export function findPetEntity(
  document: Pick<PlanetDocument, "entities">,
): PlanetEntity | null {
  return findPlanetEntity(document, PET_ENTITY_KIND);
}

export function parsePetEntityData(
  entity: PlanetEntity,
): PetEntityData | null {
  if (entity.kind !== PET_ENTITY_KIND) return null;
  const data = entity.data;
  if (data === undefined || typeof data !== "object" || data === null) {
    return null;
  }
  const species = (data as Record<string, unknown>).species;
  if (!isFaunaSpeciesId(species)) return null;
  const sourceSpawnId = (data as Record<string, unknown>).sourceSpawnId;
  if (typeof sourceSpawnId === "string" && sourceSpawnId.length > 0) {
    return { species, sourceSpawnId };
  }
  return { species };
}

export function parsePetPose(
  entity: PlanetEntity,
): { x: number; z: number; yaw: number } | null {
  if (entity.kind !== PET_ENTITY_KIND) return null;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return null;
  const yaw =
    entity.yaw !== undefined && Number.isFinite(entity.yaw) ? entity.yaw : 0;
  return { x: entity.x, z: entity.z, yaw };
}

export function createPetEntity(options: {
  species: FaunaSpeciesId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sourceSpawnId?: string;
}): PlanetEntity {
  const data: Record<string, unknown> = { species: options.species };
  if (options.sourceSpawnId !== undefined) {
    data.sourceSpawnId = options.sourceSpawnId;
  }
  return {
    id: PET_ENTITY_KIND,
    kind: PET_ENTITY_KIND,
    x: options.x,
    y: options.y,
    z: options.z,
    yaw: options.yaw,
    data,
  };
}

export function upsertPetEntity(
  document: PlanetDocument,
  entity: PlanetEntity,
): void {
  upsertPlanetEntity(document, entity);
}
