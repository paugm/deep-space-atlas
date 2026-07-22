/**
 * Built-in slash commands. Host callbacks keep Three.js / save I/O out of the
 * registry so parse + dispatch stay unit-testable. Undocumented in player UI;
 * see docs/commands.md.
 */

import { hexToSeed, seedToHex } from "../planet-save.ts";
import {
  BLUEPRINT_ORDER,
  blueprintDefinitionFromToken,
} from "../blueprints.ts";
import {
  GEAR_ORDER,
  gearDefinitionFromToken,
} from "../gear.ts";
import {
  roverKindFromSpawnToken,
  type RoverKindId,
} from "../vehicles/kinds.ts";
import type { CommandDefinition } from "./registry.ts";

/** Shown when `/travel` gets a non-hex seed. */
export const UNKNOWN_SEED_MESSAGE =
  "THE LATTICE HAS NO MEMORY OF THAT FREQUENCY.";

export const SPACESHIP_SPAWN_AHEAD_METERS = 10;
export const ROVER_SPAWN_AHEAD_METERS = 8;

export interface CommandHost {
  hasPlanetWorld(): boolean;
  spawnSpaceshipAhead(meters: number): Promise<void>;
  /** Adds a rover; does not remove existing ones. */
  spawnRoverAhead(kind: RoverKindId, meters: number): Promise<void>;
  travelToSeed(seed: number): Promise<void>;
  currentSeed(): number | null;
  toggleMute(): boolean;
  /**
   * Fabricate a field structure without spending cargo (playtest shortcut).
   */
  buildItem(token: string): {
    ok: true;
    label: string;
  } | {
    ok: false;
    reason:
      | "unknown"
      | "unknown-blueprint"
      | "at-limit"
      | "too-close"
      | "out-of-bounds"
      | "too-steep"
      | "no-world"
      | "cannot-afford";
  };
  /**
   * Install commander gear without spending cargo (playtest shortcut).
   */
  installGear(token: string): {
    ok: true;
    label: string;
  } | {
    ok: false;
    reason: "unknown" | "already-owned";
  };
  /**
   * Spawn a random companion pet near the player (playtest shortcut).
   */
  adoptPet(): Promise<
    | { ok: true; label: string }
    | { ok: false; reason: "has-pet" | "no-world" }
  >;
}

export function createBuiltinCommands(
  host: CommandHost,
): CommandDefinition[] {
  const spawn: CommandDefinition = {
    name: "spawn",
    usage: "/spawn spaceship|rover|roundrover|rovervariant",
    description:
      "Park the survey vessel ahead, or spawn an extra rover (keeps others)",
    async run(args) {
      if (args.length !== 1 || args[0] === undefined) {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }
      if (!host.hasPlanetWorld()) {
        return {
          ok: false,
          message: "NO PLANET UNDERFOOT — LAND FIRST",
        };
      }

      const token = args[0].toLowerCase();
      if (token === "spaceship") {
        await host.spawnSpaceshipAhead(SPACESHIP_SPAWN_AHEAD_METERS);
        return {
          ok: true,
          message: "SURVEY VESSEL REPOSITIONED",
        };
      }

      const roverKind = roverKindFromSpawnToken(token);
      if (roverKind !== null) {
        await host.spawnRoverAhead(roverKind, ROVER_SPAWN_AHEAD_METERS);
        return {
          ok: true,
          message: "ROVER DEPLOYED",
        };
      }

      return { ok: false, message: "INCOMPLETE SIGNAL" };
    },
  };

  const travel: CommandDefinition = {
    name: "travel",
    usage: "/travel <seed>",
    description: "Instant-travel to a planet by 8-digit hex seed",
    async run(args) {
      if (args.length !== 1 || args[0] === undefined) {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }

      const seedToken = args[0];
      const seed = hexToSeed(seedToken);
      if (seed === null) {
        return { ok: false, message: UNKNOWN_SEED_MESSAGE };
      }

      const current = host.currentSeed();
      if (current !== null && (current >>> 0) === seed) {
        return {
          ok: true,
          message: `ALREADY ON ${seedToHex(seed)}`,
        };
      }

      await host.travelToSeed(seed);
      return {
        ok: true,
        message: `TRAVELING TO ${seedToHex(seed)}`,
      };
    },
  };

  const mute: CommandDefinition = {
    name: "mute",
    usage: "/mute",
    description: "Toggle sound effects and ambient audio",
    run(args) {
      if (args.length !== 0) {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }
      const muted = host.toggleMute();
      return {
        ok: true,
        message: muted ? "AUDIO MUTED" : "AUDIO RESTORED",
      };
    },
  };

  const build: CommandDefinition = {
    name: "build",
    usage: `/build <${BLUEPRINT_ORDER.join("|")}>`,
    description:
      "Fabricate a field structure without spending cargo (same effect as Build)",
    run(args) {
      if (args.length !== 1 || args[0] === undefined) {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }
      const definition = blueprintDefinitionFromToken(args[0]);
      if (definition === null) {
        return { ok: false, message: "UNKNOWN BLUEPRINT" };
      }
      if (!host.hasPlanetWorld()) {
        return {
          ok: false,
          message: "NO PLANET UNDERFOOT — LAND FIRST",
        };
      }
      const result = host.buildItem(definition.id);
      if (!result.ok) {
        switch (result.reason) {
          case "unknown":
          case "unknown-blueprint":
            return { ok: false, message: "UNKNOWN BLUEPRINT" };
          case "at-limit":
            return { ok: false, message: "PLANET LIMIT REACHED" };
          case "too-close":
            return { ok: false, message: "TOO CLOSE TO ANOTHER" };
          case "out-of-bounds":
            return { ok: false, message: "OUT OF BOUNDS" };
          case "too-steep":
            return { ok: false, message: "TERRAIN TOO STEEP" };
          case "no-world":
            return { ok: false, message: "NO PLANET UNDERFOOT — LAND FIRST" };
          case "cannot-afford":
            return { ok: false, message: "INSUFFICIENT CARGO" };
          default: {
            const exhaustive: never = result.reason;
            throw new Error(`Unhandled build reason: ${String(exhaustive)}`);
          }
        }
      }
      return {
        ok: true,
        message: `FABRICATED · ${result.label.toUpperCase()}`,
      };
    },
  };

  const gear: CommandDefinition = {
    name: "gear",
    usage: `/gear <${GEAR_ORDER.join("|")}>`,
    description:
      "Install commander gear without spending cargo (same effect as Gear)",
    run(args) {
      if (args.length !== 1 || args[0] === undefined) {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }
      const definition = gearDefinitionFromToken(args[0]);
      if (definition === null) {
        return { ok: false, message: "UNKNOWN SCHEMATIC" };
      }
      const result = host.installGear(definition.id);
      if (!result.ok) {
        switch (result.reason) {
          case "already-owned":
            return { ok: false, message: "ALREADY INSTALLED" };
          case "unknown":
            return { ok: false, message: "UNKNOWN SCHEMATIC" };
          default: {
            const exhaustive: never = result.reason;
            throw new Error(`Unhandled gear reason: ${String(exhaustive)}`);
          }
        }
      }
      return {
        ok: true,
        message: `INSTALLED · ${result.label.toUpperCase()}`,
      };
    },
  };

  const gimme: CommandDefinition = {
    name: "gimme",
    usage: "/gimme everything",
    description:
      "Install every gear recipe without spending cargo (playtest)",
    run(args) {
      if (args.length !== 1 || args[0]?.toLowerCase() !== "everything") {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }
      let installed = 0;
      let alreadyOwned = 0;
      for (const gearId of GEAR_ORDER) {
        const result = host.installGear(gearId);
        if (result.ok) {
          installed += 1;
          continue;
        }
        switch (result.reason) {
          case "already-owned":
            alreadyOwned += 1;
            break;
          case "unknown":
            return { ok: false, message: "UNKNOWN SCHEMATIC" };
          default: {
            const exhaustive: never = result.reason;
            throw new Error(`Unhandled gear reason: ${String(exhaustive)}`);
          }
        }
      }
      if (installed === 0 && alreadyOwned === GEAR_ORDER.length) {
        return { ok: true, message: "FULL LOADOUT ALREADY INSTALLED" };
      }
      return {
        ok: true,
        message: `FULL LOADOUT · ${installed} INSTALLED`,
      };
    },
  };

  const adopt: CommandDefinition = {
    name: "adopt",
    usage: "/adopt pet",
    description:
      "Spawn a random companion pet near the player (fails if one already exists)",
    async run(args) {
      if (args.length !== 1 || args[0]?.toLowerCase() !== "pet") {
        return { ok: false, message: "INCOMPLETE SIGNAL" };
      }
      const result = await host.adoptPet();
      if (!result.ok) {
        switch (result.reason) {
          case "has-pet":
            return { ok: false, message: "ALREADY HAVE A COMPANION" };
          case "no-world":
            return {
              ok: false,
              message: "NO PLANET UNDERFOOT — LAND FIRST",
            };
          default: {
            const exhaustive: never = result.reason;
            throw new Error(`Unhandled adopt reason: ${String(exhaustive)}`);
          }
        }
      }
      return {
        ok: true,
        message: `COMPANION BONDED · ${result.label.toUpperCase()}`,
      };
    },
  };

  return [spawn, travel, mute, build, gear, gimme, adopt];
}
