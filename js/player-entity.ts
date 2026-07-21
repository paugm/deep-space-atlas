import type { PlanetDocument, PlanetEntity } from "./planet-save.ts";
import { findPlanetEntity, upsertPlanetEntity } from "./planet-save.ts";

export const PLAYER_ENTITY_KIND = "player" as const;

export interface PlayerSaveState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fuel: number;
}

export function findPlayerEntity(
  document: Pick<PlanetDocument, "entities">,
): PlanetEntity | null {
  return findPlanetEntity(document, PLAYER_ENTITY_KIND);
}

export function parsePlayerSaveState(
  entity: PlanetEntity,
): PlayerSaveState | null {
  if (entity.kind !== PLAYER_ENTITY_KIND) return null;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return null;
  if (!Number.isFinite(entity.z)) return null;
  if (entity.yaw === undefined || !Number.isFinite(entity.yaw)) return null;

  const data = entity.data;
  let pitch = -0.05;
  let fuel = 1;
  if (data !== undefined && typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.pitch === "number" && Number.isFinite(record.pitch)) {
      pitch = record.pitch;
    }
    if (typeof record.fuel === "number" && Number.isFinite(record.fuel)) {
      fuel = record.fuel;
    }
  }

  return {
    x: entity.x,
    y: entity.y,
    z: entity.z,
    yaw: entity.yaw,
    pitch,
    fuel,
  };
}

export function createPlayerEntity(state: PlayerSaveState): PlanetEntity {
  return {
    id: PLAYER_ENTITY_KIND,
    kind: PLAYER_ENTITY_KIND,
    x: state.x,
    y: state.y,
    z: state.z,
    yaw: state.yaw,
    data: {
      pitch: state.pitch,
      fuel: state.fuel,
    },
  };
}

export function upsertPlayerEntity(
  document: PlanetDocument,
  entity: PlanetEntity,
): void {
  upsertPlanetEntity(document, entity);
}
