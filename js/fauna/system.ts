import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import { mulberry32 } from "../config.ts";
import type { PlanetEntity } from "../planet-save.ts";
import type { FaunaSpawnSpec, World } from "../world/types.ts";
import {
  PET_GREET_SECONDS,
  pickWanderGoal,
  petWaitPose,
  stepFollow,
  stepWander,
  type Pose2,
} from "./motion.ts";
import {
  createPetEntity,
  parsePetEntityData,
  parsePetPose,
} from "./pet-entity.ts";
import type { PetEntityData } from "./pet-entity.ts";
import {
  FAUNA_DEFINITIONS,
  type FaunaSpeciesId,
} from "./species.ts";

type CreatureRole = "wild" | "pet";

interface CreatureRuntime {
  id: string;
  species: FaunaSpeciesId;
  role: CreatureRole;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  activeClip: string | null;
  pose: Pose2;
  homeX: number;
  homeZ: number;
  goalX: number;
  goalZ: number;
  pauseRemaining: number;
  greetRemaining: number;
  wanderRandom: () => number;
  sourceSpawnId?: string;
}

export interface PetBeacon {
  x: number;
  z: number;
  label: string;
}

export interface FaunaSystem {
  sync(world: World, petEntity: PlanetEntity | null): Promise<void>;
  clear(): void;
  update(
    deltaTime: number,
    player: { x: number; y: number; z: number; yaw: number },
  ): void;
  tryTame(creatureId: string):
    | { ok: true; entity: PlanetEntity }
    | { ok: false; reason: "missing" | "not-wild" | "has-pet" };
  hasPet(): boolean;
  getPetBeacon(): PetBeacon | null;
  getPetSaveEntity(): PlanetEntity | null;
}

interface TemplateCache {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export function createFaunaSystem(): FaunaSystem {
  const loader = new GLTFLoader();
  const templates = new Map<FaunaSpeciesId, Promise<TemplateCache>>();
  let world: World | null = null;
  let creatures: CreatureRuntime[] = [];
  let generation = 0;

  function clearCreatures(): void {
    // Clones share materials and textures with the GLTF template cache, so do not dispose them.
    for (const creature of creatures) {
      creature.mixer.stopAllAction();
      creature.root.removeFromParent();
    }
    creatures = [];
    if (world !== null) world.faunaAimTargets = [];
  }

  function clear(): void {
    generation += 1;
    clearCreatures();
    world = null;
  }

  function loadTemplate(species: FaunaSpeciesId): Promise<TemplateCache> {
    const existing = templates.get(species);
    if (existing) return existing;

    const url = FAUNA_DEFINITIONS[species].glbUrl;
    const pending = loader.loadAsync(url).then((gltf) => ({
      scene: gltf.scene,
      animations: gltf.animations,
    }));
    templates.set(species, pending);
    return pending;
  }

  function playClip(creature: CreatureRuntime, clipName: string): void {
    if (creature.activeClip === clipName) return;
    const next = creature.actions.get(clipName);
    if (!next) return;
    const previous =
      creature.activeClip === null
        ? null
        : creature.actions.get(creature.activeClip);
    if (previous) previous.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    creature.activeClip = clipName;
  }

  function chooseIdleClip(creature: CreatureRuntime): string {
    if (creature.actions.has("Idle")) return "Idle";
    if (creature.actions.has("Flying")) return "Flying";
    const first = creature.actions.keys().next();
    return first.value ?? "Idle";
  }

  function chooseWalkClip(creature: CreatureRuntime): string {
    if (creature.actions.has("Walk")) return "Walk";
    if (creature.actions.has("Flying")) return "Flying";
    return chooseIdleClip(creature);
  }

  function chooseGreetClip(creature: CreatureRuntime): string {
    if (creature.actions.has("Yes")) return "Yes";
    if (creature.actions.has("Dance")) return "Dance";
    return chooseIdleClip(creature);
  }

  async function spawnCreature(options: {
    id: string;
    species: FaunaSpeciesId;
    role: CreatureRole;
    pose: Pose2;
    homeX: number;
    homeZ: number;
    greet: boolean;
    sourceSpawnId?: string;
  }): Promise<CreatureRuntime> {
    const activeWorld = world;
    if (activeWorld === null) {
      throw new Error("Fauna system has no active world.");
    }

    const template = await loadTemplate(options.species);
    const def = FAUNA_DEFINITIONS[options.species];
    const root = new THREE.Group();
    root.name = `fauna:${options.id}`;
    const model = cloneSkinned(template.scene);
    model.scale.setScalar(def.scale);
    root.add(model);
    root.userData = {
      kind: "fauna",
      creatureId: options.id,
      species: options.species,
      role: options.role,
    };

    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of template.animations) {
      const name = clip.name.replace(/^MonsterArmature\|/, "");
      actions.set(name, mixer.clipAction(clip));
    }

    const height = activeWorld.heightAt(options.pose.x, options.pose.z);
    root.position.set(options.pose.x, height, options.pose.z);
    root.rotation.y = options.pose.yaw;
    activeWorld.group.add(root);

    const goal = pickWanderGoal(
      options.homeX,
      options.homeZ,
      10,
      mulberry32(hashId(options.id)),
    );

    const creature: CreatureRuntime = {
      id: options.id,
      species: options.species,
      role: options.role,
      root,
      mixer,
      actions,
      activeClip: null,
      pose: { ...options.pose },
      homeX: options.homeX,
      homeZ: options.homeZ,
      goalX: goal.x,
      goalZ: goal.z,
      pauseRemaining: options.greet ? 0 : 0.6,
      greetRemaining: options.greet ? PET_GREET_SECONDS : 0,
      wanderRandom: mulberry32(hashId(options.id) ^ 0x99abcdef),
      ...(options.sourceSpawnId !== undefined
        ? { sourceSpawnId: options.sourceSpawnId }
        : {}),
    };

    playClip(
      creature,
      options.greet ? chooseGreetClip(creature) : chooseIdleClip(creature),
    );
    return creature;
  }

  function refreshAimTargets(): void {
    if (world === null) return;
    world.faunaAimTargets = creatures.map((creature) => ({
      creatureId: creature.id,
      species: creature.species,
      role: creature.role,
      object: creature.root,
    }));
  }

  async function sync(
    nextWorld: World,
    petEntity: PlanetEntity | null,
  ): Promise<void> {
    const syncGeneration = generation + 1;
    generation = syncGeneration;
    clearCreatures();
    world = nextWorld;
    nextWorld.faunaAimTargets = [];

    const petData: PetEntityData | null =
      petEntity === null ? null : parsePetEntityData(petEntity);
    const claimedSpawnId = petData?.sourceSpawnId;

    const wildPlans: readonly FaunaSpawnSpec[] =
      nextWorld.faunaPlan.spawns.filter(
        (spawn) => spawn.id !== claimedSpawnId,
      );

    const spawned: CreatureRuntime[] = [];

    for (const spawn of wildPlans) {
      if (generation !== syncGeneration) return;
      const pose: Pose2 = {
        x: spawn.x,
        z: spawn.z,
        yaw: mulberry32(hashId(spawn.id))() * Math.PI * 2,
      };
      spawned.push(
        await spawnCreature({
          id: spawn.id,
          species: spawn.species,
          role: "wild",
          pose,
          homeX: spawn.x,
          homeZ: spawn.z,
          greet: false,
        }),
      );
    }

    if (petData !== null && petEntity !== null) {
      if (generation !== syncGeneration) return;
      const savedPose = parsePetPose(petEntity);
      const pose =
        savedPose ??
        petWaitPose(
          nextWorld.spawn.x,
          nextWorld.spawn.z,
          mulberry32(nextWorld.seed ^ 0x51eed),
        );
      spawned.push(
        await spawnCreature({
          id: "pet",
          species: petData.species,
          role: "pet",
          pose,
          homeX: pose.x,
          homeZ: pose.z,
          greet: true,
          ...(petData.sourceSpawnId !== undefined
            ? { sourceSpawnId: petData.sourceSpawnId }
            : {}),
        }),
      );
    }

    if (generation !== syncGeneration) return;
    creatures = spawned;
    refreshAimTargets();
  }

  function groundCreature(creature: CreatureRuntime): void {
    if (world === null) return;
    const height = world.heightAt(creature.pose.x, creature.pose.z);
    creature.root.position.set(creature.pose.x, height, creature.pose.z);
    creature.root.rotation.y = creature.pose.yaw;
  }

  function update(
    deltaTime: number,
    player: { x: number; y: number; z: number; yaw: number },
  ): void {
    if (world === null || creatures.length === 0) return;

    for (const creature of creatures) {
      creature.mixer.update(deltaTime);

      if (creature.role === "pet") {
        if (creature.greetRemaining > 0) {
          creature.greetRemaining -= deltaTime;
          creature.pose.yaw = Math.atan2(
            player.x - creature.pose.x,
            player.z - creature.pose.z,
          );
          playClip(creature, chooseGreetClip(creature));
          groundCreature(creature);
          continue;
        }

        const follow = stepFollow({
          pose: creature.pose,
          targetX: player.x,
          targetZ: player.z,
          deltaTime,
        });
        creature.pose = follow.pose;
        playClip(
          creature,
          follow.moving ? chooseWalkClip(creature) : chooseIdleClip(creature),
        );
        groundCreature(creature);
        continue;
      }

      // Deterministic wander: reseed each step from id + quantized time bucket
      // would jump; use a stable per-creature PRNG advanced via pause goals only.
      const wander = stepWander({
        pose: creature.pose,
        goalX: creature.goalX,
        goalZ: creature.goalZ,
        pauseRemaining: creature.pauseRemaining,
        deltaTime,
        random: creature.wanderRandom,
        homeX: creature.homeX,
        homeZ: creature.homeZ,
      });
      creature.pose = wander.pose;
      creature.goalX = wander.goalX;
      creature.goalZ = wander.goalZ;
      creature.pauseRemaining = wander.pauseRemaining;
      playClip(
        creature,
        wander.moving ? chooseWalkClip(creature) : chooseIdleClip(creature),
      );
      groundCreature(creature);
    }

    refreshAimTargets();
  }

  function hasPet(): boolean {
    return creatures.some((creature) => creature.role === "pet");
  }

  function getPetBeacon(): PetBeacon | null {
    const pet = creatures.find((creature) => creature.role === "pet");
    if (pet === undefined) return null;
    return {
      x: pet.pose.x,
      z: pet.pose.z,
      label: FAUNA_DEFINITIONS[pet.species].label.toUpperCase(),
    };
  }

  function getPetSaveEntity(): PlanetEntity | null {
    if (world === null) return null;
    const pet = creatures.find((creature) => creature.role === "pet");
    if (pet === undefined) return null;
    const height = world.heightAt(pet.pose.x, pet.pose.z);
    return createPetEntity({
      species: pet.species,
      x: pet.pose.x,
      y: height,
      z: pet.pose.z,
      yaw: pet.pose.yaw,
      ...(pet.sourceSpawnId !== undefined
        ? { sourceSpawnId: pet.sourceSpawnId }
        : {}),
    });
  }

  function tryTame(creatureId: string):
    | { ok: true; entity: PlanetEntity }
    | { ok: false; reason: "missing" | "not-wild" | "has-pet" } {
    if (hasPet()) return { ok: false, reason: "has-pet" };
    const creature = creatures.find((entry) => entry.id === creatureId);
    if (creature === undefined) return { ok: false, reason: "missing" };
    if (creature.role !== "wild") return { ok: false, reason: "not-wild" };
    if (world === null) return { ok: false, reason: "missing" };

    const sourceSpawnId = creature.id;
    creature.role = "pet";
    creature.id = "pet";
    creature.sourceSpawnId = sourceSpawnId;
    creature.greetRemaining = PET_GREET_SECONDS;
    creature.root.userData = {
      kind: "fauna",
      creatureId: "pet",
      species: creature.species,
      role: "pet",
    };
    playClip(creature, chooseGreetClip(creature));
    refreshAimTargets();

    const height = world.heightAt(creature.pose.x, creature.pose.z);
    return {
      ok: true,
      entity: createPetEntity({
        species: creature.species,
        x: creature.pose.x,
        y: height,
        z: creature.pose.z,
        yaw: creature.pose.yaw,
        sourceSpawnId,
      }),
    };
  }

  return {
    sync,
    clear,
    update,
    tryTame,
    hasPet,
    getPetBeacon,
    getPetSaveEntity,
  };
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
