import { describe, expect, it, vi } from "vitest";

import {
  UNKNOWN_SEED_MESSAGE,
  createBuiltinCommands,
  createCommandRegistry,
  parseCommandLine,
  type CommandHost,
} from "../js/commands/index.ts";

describe("parseCommandLine", () => {
  it("parses a name and args with optional leading slash", () => {
    expect(parseCommandLine("/travel DEADBEEF")).toEqual({
      name: "travel",
      args: ["DEADBEEF"],
    });
    expect(parseCommandLine("spawn spaceship")).toEqual({
      name: "spawn",
      args: ["spaceship"],
    });
  });

  it("normalizes the command name to lowercase", () => {
    expect(parseCommandLine("/Help")).toEqual({ name: "help", args: [] });
  });

  it("returns null for empty or slash-only input", () => {
    expect(parseCommandLine("")).toBeNull();
    expect(parseCommandLine("   ")).toBeNull();
    expect(parseCommandLine("/")).toBeNull();
  });
});

describe("createCommandRegistry", () => {
  it("dispatches known commands and rejects unknown ones", async () => {
    const registry = createCommandRegistry([
      {
        name: "ping",
        usage: "/ping",
        description: "Respond",
        run: () => ({ ok: true, message: "PONG" }),
      },
    ]);

    await expect(registry.dispatch("/ping")).resolves.toEqual({
      ok: true,
      message: "PONG",
    });
    await expect(registry.dispatch("/nope")).resolves.toEqual({
      ok: false,
      message: "UNKNOWN COMMAND",
    });
    await expect(registry.dispatch("")).resolves.toEqual({
      ok: false,
      message: "EMPTY COMMAND",
    });
  });

  it("rejects duplicate names and aliases", () => {
    expect(() =>
      createCommandRegistry([
        {
          name: "a",
          aliases: ["b"],
          usage: "/a",
          description: "A",
          run: () => ({ ok: true, message: "A" }),
        },
        {
          name: "b",
          usage: "/b",
          description: "B",
          run: () => ({ ok: true, message: "B" }),
        },
      ]),
    ).toThrow(/Duplicate command name: b/);
  });
});

describe("builtin commands", () => {
  function createHost(overrides: Partial<CommandHost> = {}): {
    host: CommandHost;
    spawnSpaceshipAhead: ReturnType<typeof vi.fn>;
    spawnRoverAhead: ReturnType<typeof vi.fn>;
    travelToSeed: ReturnType<typeof vi.fn>;
    toggleMute: ReturnType<typeof vi.fn>;
    buildItem: ReturnType<typeof vi.fn>;
    installGear: ReturnType<typeof vi.fn>;
    adoptPet: ReturnType<typeof vi.fn>;
  } {
    const spawnSpaceshipAhead = vi.fn(async (_meters: number) => undefined);
    const spawnRoverAhead = vi.fn(
      async (_kind: string, _meters: number) => undefined,
    );
    const travelToSeed = vi.fn(async (_seed: number) => undefined);
    let muted = false;
    const toggleMute = vi.fn(() => {
      muted = !muted;
      return muted;
    });
    const buildItem = vi.fn((token: string) => {
      if (token === "beacon") {
        return { ok: true as const, label: "Survey Beacon" };
      }
      return { ok: false as const, reason: "unknown" as const };
    });
    const installGear = vi.fn((token: string) => {
      if (token === "thruster-coil-i") {
        return { ok: true as const, label: "Thruster Coil I" };
      }
      if (token === "focus-lens-i") {
        return { ok: false as const, reason: "already-owned" as const };
      }
      return { ok: false as const, reason: "unknown" as const };
    });
    const adoptPet = vi.fn(async () => ({
      ok: true as const,
      label: "Panda",
    }));
    const host: CommandHost = {
      hasPlanetWorld: () => true,
      currentSeed: () => 0x11111111,
      spawnSpaceshipAhead,
      spawnRoverAhead,
      travelToSeed,
      toggleMute,
      buildItem,
      installGear,
      adoptPet,
      ...overrides,
    };
    return {
      host,
      spawnSpaceshipAhead,
      spawnRoverAhead,
      travelToSeed,
      toggleMute,
      buildItem,
      installGear,
      adoptPet,
    };
  }

  it("does not expose a help listing command", async () => {
    const { host } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));
    await expect(registry.dispatch("/help")).resolves.toEqual({
      ok: false,
      message: "UNKNOWN COMMAND",
    });
  });

  it("spawns a spaceship ahead on a planet world", async () => {
    const { host, spawnSpaceshipAhead } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/spawn spaceship")).resolves.toEqual({
      ok: true,
      message: "SURVEY VESSEL REPOSITIONED",
    });
    expect(spawnSpaceshipAhead).toHaveBeenCalledWith(10);

    await expect(registry.dispatch("/spawn")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
  });

  it("spawns rover variants without removing the spaceship path", async () => {
    const { host, spawnRoverAhead, spawnSpaceshipAhead } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/spawn rover")).resolves.toEqual({
      ok: true,
      message: "ROVER DEPLOYED",
    });
    await expect(registry.dispatch("/spawn roundrover")).resolves.toEqual({
      ok: true,
      message: "ROVER DEPLOYED",
    });
    await expect(registry.dispatch("/spawn rovervariant")).resolves.toEqual({
      ok: true,
      message: "ROVER DEPLOYED",
    });
    expect(spawnRoverAhead).toHaveBeenNthCalledWith(1, "rover", 8);
    expect(spawnRoverAhead).toHaveBeenNthCalledWith(2, "round-rover", 8);
    expect(spawnRoverAhead).toHaveBeenNthCalledWith(3, "rover-variant", 8);
    expect(spawnSpaceshipAhead).not.toHaveBeenCalled();
  });

  it("refuses spawn when no planet is active", async () => {
    const { host, spawnSpaceshipAhead, spawnRoverAhead } = createHost({
      hasPlanetWorld: () => false,
    });
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/spawn spaceship")).resolves.toEqual({
      ok: false,
      message: "NO PLANET UNDERFOOT — LAND FIRST",
    });
    await expect(registry.dispatch("/spawn rover")).resolves.toEqual({
      ok: false,
      message: "NO PLANET UNDERFOOT — LAND FIRST",
    });
    expect(spawnSpaceshipAhead).not.toHaveBeenCalled();
    expect(spawnRoverAhead).not.toHaveBeenCalled();
  });

  it("travels to a valid seed and rejects malformed seeds", async () => {
    const { host, travelToSeed } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/travel deadbeef")).resolves.toEqual({
      ok: true,
      message: "TRAVELING TO DEADBEEF",
    });
    expect(travelToSeed).toHaveBeenCalledWith(0xdeadbeef);

    await expect(registry.dispatch("/travel not-a-seed")).resolves.toEqual({
      ok: false,
      message: UNKNOWN_SEED_MESSAGE,
    });
    expect(travelToSeed).toHaveBeenCalledTimes(1);
  });

  it("skips travel when already on the requested seed", async () => {
    const { host, travelToSeed } = createHost({
      currentSeed: () => 0xdeadbeef,
    });
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/travel DEADBEEF")).resolves.toEqual({
      ok: true,
      message: "ALREADY ON DEADBEEF",
    });
    expect(travelToSeed).not.toHaveBeenCalled();
  });

  it("toggles mute and rejects unexpected args", async () => {
    const { host, toggleMute } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/mute")).resolves.toEqual({
      ok: true,
      message: "AUDIO MUTED",
    });
    await expect(registry.dispatch("/mute")).resolves.toEqual({
      ok: true,
      message: "AUDIO RESTORED",
    });
    expect(toggleMute).toHaveBeenCalledTimes(2);

    await expect(registry.dispatch("/mute loud")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
    expect(toggleMute).toHaveBeenCalledTimes(2);
  });

  it("fabricates field structures and rejects unknown blueprints", async () => {
    const { host, buildItem } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/build beacon")).resolves.toEqual({
      ok: true,
      message: "FABRICATED · SURVEY BEACON",
    });
    expect(buildItem).toHaveBeenCalledWith("beacon");

    await expect(registry.dispatch("/build nope")).resolves.toEqual({
      ok: false,
      message: "UNKNOWN BLUEPRINT",
    });
    await expect(registry.dispatch("/build")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
  });

  it("installs gear and rejects unknown or owned tokens", async () => {
    const { host, installGear } = createHost();
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/gear thruster-coil-i")).resolves.toEqual({
      ok: true,
      message: "INSTALLED · THRUSTER COIL I",
    });
    expect(installGear).toHaveBeenCalledWith("thruster-coil-i");

    await expect(registry.dispatch("/gear focus-lens-i")).resolves.toEqual({
      ok: false,
      message: "ALREADY INSTALLED",
    });
    await expect(registry.dispatch("/gear nope")).resolves.toEqual({
      ok: false,
      message: "UNKNOWN SCHEMATIC",
    });
    await expect(registry.dispatch("/gear")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
  });

  it("installs the full gear loadout with /gimme everything", async () => {
    const owned = new Set<string>();
    const installGear = vi.fn((token: string) => {
      if (owned.has(token)) {
        return { ok: false as const, reason: "already-owned" as const };
      }
      owned.add(token);
      return { ok: true as const, label: token };
    });
    const { host } = createHost({ installGear });
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/gimme everything")).resolves.toEqual({
      ok: true,
      message: "FULL LOADOUT · 14 INSTALLED",
    });
    expect(installGear).toHaveBeenCalledTimes(14);

    await expect(registry.dispatch("/gimme everything")).resolves.toEqual({
      ok: true,
      message: "FULL LOADOUT ALREADY INSTALLED",
    });
    await expect(registry.dispatch("/gimme")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
    await expect(registry.dispatch("/gimme stuff")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
  });

  it("adopts a random pet and rejects when one already exists", async () => {
    const adoptPet = vi.fn(async (): Promise<
      | { ok: true; label: string }
      | { ok: false; reason: "has-pet" | "no-world" }
    > => ({
      ok: true,
      label: "Yeti",
    }));
    const { host } = createHost({ adoptPet });
    const registry = createCommandRegistry(createBuiltinCommands(host));

    await expect(registry.dispatch("/adopt pet")).resolves.toEqual({
      ok: true,
      message: "COMPANION BONDED · YETI",
    });
    expect(adoptPet).toHaveBeenCalledTimes(1);

    adoptPet.mockResolvedValueOnce({
      ok: false,
      reason: "has-pet",
    });
    await expect(registry.dispatch("/adopt pet")).resolves.toEqual({
      ok: false,
      message: "ALREADY HAVE A COMPANION",
    });

    adoptPet.mockResolvedValueOnce({
      ok: false,
      reason: "no-world",
    });
    await expect(registry.dispatch("/adopt pet")).resolves.toEqual({
      ok: false,
      message: "NO PLANET UNDERFOOT — LAND FIRST",
    });

    await expect(registry.dispatch("/adopt")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
    await expect(registry.dispatch("/adopt dog")).resolves.toEqual({
      ok: false,
      message: "INCOMPLETE SIGNAL",
    });
  });
});
