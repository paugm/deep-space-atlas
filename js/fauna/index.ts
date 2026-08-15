export {
  FAUNA_DEFINITIONS,
  FAUNA_SPECIES,
  isFaunaSpeciesId,
  pickRandomFaunaSpecies,
  type CreatureRole,
  type FaunaSpeciesDefinition,
  type FaunaSpeciesId,
} from "./species.ts";
export {
  FAUNA_WORLD_CHANCE,
  faunaSpawnId,
  planFauna,
  type FaunaPlan,
  type FaunaSpawnPlan,
} from "./plan.ts";
export {
  FAUNA_FOLLOW_STOP_DISTANCE,
  FAUNA_WALK_SPEED,
  PET_FOLLOW_SPEED,
  TAME_TIME,
  ENLIST_TIME,
  petWaitPose,
  stepFollow,
  stepWander,
  type FollowStepResult,
  type Pose2,
} from "./motion.ts";
export {
  computePetCompass,
  formatPetDistance,
  type PetCompassReading,
} from "./compass.ts";
export {
  PET_ENTITY_KIND,
  createPetEntity,
  findPetEntity,
  parsePetEntityData,
  parsePetPose,
  upsertPetEntity,
  type PetEntityData,
} from "./pet-entity.ts";
export {
  createFaunaSystem,
  type FaunaSystem,
  type PetBeacon,
} from "./system.ts";
