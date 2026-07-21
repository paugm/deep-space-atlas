/**
 * Quaternius Ultimate Space Kit rovers (CC0).
 * See CREDITS.md and assets/vehicles/quaternius-ultimate-space-kit/.
 */

import roverUrl from "../../assets/vehicles/quaternius-ultimate-space-kit/rover.glb?url";
import roundRoverUrl from "../../assets/vehicles/quaternius-ultimate-space-kit/round-rover.glb?url";
import roverVariantUrl from "../../assets/vehicles/quaternius-ultimate-space-kit/rover-variant.glb?url";

export type RoverKindId = "rover" | "round-rover" | "rover-variant";

export interface RoverKindDefinition {
  label: string;
  /** Slash-command token after `/spawn` (no spaces). */
  spawnToken: string;
  /** Longest dimension target in world units (~meters). */
  length: number;
  glbUrl: string;
}

export const ROVER_DEFINITIONS: Record<RoverKindId, RoverKindDefinition> = {
  rover: {
    label: "Rover",
    spawnToken: "rover",
    length: 3.4,
    glbUrl: roverUrl,
  },
  "round-rover": {
    label: "Round Rover",
    spawnToken: "roundrover",
    length: 3.2,
    glbUrl: roundRoverUrl,
  },
  "rover-variant": {
    label: "Rover Variant",
    spawnToken: "rovervariant",
    length: 3.4,
    glbUrl: roverVariantUrl,
  },
};

export const ROVER_KINDS: readonly RoverKindId[] = Object.keys(
  ROVER_DEFINITIONS,
) as RoverKindId[];

export function isRoverKindId(value: unknown): value is RoverKindId {
  return typeof value === "string" && value in ROVER_DEFINITIONS;
}

/** Map `/spawn <token>` args to a rover kind. */
export function roverKindFromSpawnToken(
  token: string,
): RoverKindId | null {
  const normalized = token.trim().toLowerCase();
  for (const kind of ROVER_KINDS) {
    if (ROVER_DEFINITIONS[kind].spawnToken === normalized) return kind;
  }
  return null;
}
