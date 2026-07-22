/**
 * Walker species from Quaternius Cute Monsters (CC0).
 * See CREDITS.md and assets/creatures/quaternius-cute-monsters/.
 */

import alienUrl from "../../assets/creatures/quaternius-cute-monsters/alien.glb?url";
import alienTallUrl from "../../assets/creatures/quaternius-cute-monsters/alien-tall.glb?url";
import cactusUrl from "../../assets/creatures/quaternius-cute-monsters/cactus.glb?url";
import crabUrl from "../../assets/creatures/quaternius-cute-monsters/crab.glb?url";
import cyclopsUrl from "../../assets/creatures/quaternius-cute-monsters/cyclops.glb?url";
import deerUrl from "../../assets/creatures/quaternius-cute-monsters/deer.glb?url";
import demonUrl from "../../assets/creatures/quaternius-cute-monsters/demon.glb?url";
import ghostUrl from "../../assets/creatures/quaternius-cute-monsters/ghost.glb?url";
import greenDemonUrl from "../../assets/creatures/quaternius-cute-monsters/green-demon.glb?url";
import pandaUrl from "../../assets/creatures/quaternius-cute-monsters/panda.glb?url";
import skullUrl from "../../assets/creatures/quaternius-cute-monsters/skull.glb?url";
import treeUrl from "../../assets/creatures/quaternius-cute-monsters/tree.glb?url";
import yetiUrl from "../../assets/creatures/quaternius-cute-monsters/yeti.glb?url";

export type FaunaSpeciesId =
  | "alien"
  | "alien-tall"
  | "cactus"
  | "crab"
  | "cyclops"
  | "deer"
  | "demon"
  | "ghost"
  | "green-demon"
  | "panda"
  | "skull"
  | "tree"
  | "yeti";

export interface FaunaSpeciesDefinition {
  label: string;
  /** Uniform scale applied to the Quaternius GLB. */
  scale: number;
  glbUrl: string;
}

export const FAUNA_DEFINITIONS: Record<
  FaunaSpeciesId,
  FaunaSpeciesDefinition
> = {
  alien: { label: "Alien", scale: 0.85, glbUrl: alienUrl },
  "alien-tall": { label: "Tall Alien", scale: 0.75, glbUrl: alienTallUrl },
  cactus: { label: "Cactus", scale: 0.85, glbUrl: cactusUrl },
  crab: { label: "Crab", scale: 0.9, glbUrl: crabUrl },
  cyclops: { label: "Cyclops", scale: 0.8, glbUrl: cyclopsUrl },
  deer: { label: "Deer", scale: 0.85, glbUrl: deerUrl },
  demon: { label: "Demon", scale: 0.8, glbUrl: demonUrl },
  ghost: { label: "Ghost", scale: 0.85, glbUrl: ghostUrl },
  "green-demon": {
    label: "Green Demon",
    scale: 0.8,
    glbUrl: greenDemonUrl,
  },
  panda: { label: "Panda", scale: 0.85, glbUrl: pandaUrl },
  skull: { label: "Skull", scale: 0.85, glbUrl: skullUrl },
  tree: { label: "Tree Spirit", scale: 0.8, glbUrl: treeUrl },
  yeti: { label: "Yeti", scale: 0.8, glbUrl: yetiUrl },
};

export const FAUNA_SPECIES: readonly FaunaSpeciesId[] = Object.keys(
  FAUNA_DEFINITIONS,
) as FaunaSpeciesId[];

export function isFaunaSpeciesId(value: unknown): value is FaunaSpeciesId {
  return typeof value === "string" && value in FAUNA_DEFINITIONS;
}

/** Uniform pick among walker species (`random` in [0, 1)). */
export function pickRandomFaunaSpecies(random: () => number): FaunaSpeciesId {
  const roll = random();
  const unit = Number.isFinite(roll) ? ((roll % 1) + 1) % 1 : 0;
  const index = Math.min(
    FAUNA_SPECIES.length - 1,
    Math.floor(unit * FAUNA_SPECIES.length),
  );
  return FAUNA_SPECIES[index]!;
}
