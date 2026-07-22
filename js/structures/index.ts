export {
  STRUCTURE_ENTITY_KIND,
  createStructureEntity,
  listStructureEntities,
  parseStructurePose,
  type StructurePose,
} from "./entity.ts";
export {
  STRUCTURE_PLACE_AHEAD,
  STRUCTURE_EDGE_MARGIN,
  placementPointAhead,
  validateStructurePlacement,
  type StructureFootprint,
  type StructurePlacementReason,
  type StructurePlacementResult,
} from "./placement.ts";
export {
  resolveCapsuleAgainstShelter,
  sampleShelterGround,
  shelterFloorContains,
  shelterFloorSupport,
  shelterLayoutFor,
  type LocalAabb,
  type ShelterGroundInfo,
  type ShelterLayout,
} from "./shelter.ts";
export {
  STRUCTURE_AIM_RANGE,
  createStructureSystem,
  type StructureSystem,
} from "./system.ts";
