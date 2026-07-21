import { describe, expect, it } from "vitest";

import {
  GAME_SAVE_VERSION,
  checksumGameDocument,
  parseGameDocument,
  sealGameDocument,
} from "../js/game-save.ts";
import {
  PLANET_SAVE_VERSION,
  WORLD_CONTENT_REVISION,
  checksumPlanetDocument,
  createEmptyPlanetDocument,
  sealPlanetDocument,
} from "../js/planet-save.ts";
import {
  createEmptyInventory,
  createEmptyPlayerProfile,
  sealPlayerProfile,
} from "../js/player-profile.ts";

describe("game save seal and parse", () => {
  it("round-trips a campaign document with profile and planets", () => {
    const inventory = createEmptyInventory();
    inventory.iron = 5;
    const profile = sealPlayerProfile({
      ...createEmptyPlayerProfile(),
      name: "Rook",
      inventory,
      playTimeMs: 12_000,
      visited: [
        {
          seed: "DEADBEEF",
          name: "Ash Spire",
          firstVisitedAt: 1,
          lastVisitedAt: 2,
          hasPet: true,
        },
      ],
    });
    const planet = sealPlanetDocument({
      v: PLANET_SAVE_VERSION,
      seed: "DEADBEEF",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [],
      deposits: { iron: [{ id: "iron:1:2", remaining: 3 }] },
    });
    const sealed = sealGameDocument({
      v: GAME_SAVE_VERSION,
      savedAt: 1_700_000_000_000,
      lastSeed: "deadbeef",
      profile,
      planets: [planet],
    });
    expect(sealed.lastSeed).toBe("DEADBEEF");
    expect(parseGameDocument(sealed)).toEqual(sealed);
  });

  it("checksum is stable and ignores an existing checksum field", () => {
    const body = {
      v: GAME_SAVE_VERSION,
      savedAt: 100,
      lastSeed: "00000001",
      profile: createEmptyPlayerProfile(),
      planets: [createEmptyPlanetDocument("00000001")],
    };
    const first = checksumGameDocument({ ...body, checksum: "IGNORED" });
    const second = checksumGameDocument({ ...body, checksum: "OTHER" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-F]{8}$/);
  });

  it("rejects bad checksums, wrong versions, and duplicate planet seeds", () => {
    const sealed = sealGameDocument({
      v: GAME_SAVE_VERSION,
      savedAt: 1,
      lastSeed: "00000001",
      profile: createEmptyPlayerProfile(),
      planets: [createEmptyPlanetDocument("00000001")],
    });
    expect(parseGameDocument({ ...sealed, checksum: "DEADBEEF" })).toBeNull();
    expect(parseGameDocument({ ...sealed, v: 99 })).toBeNull();
    expect(
      parseGameDocument({
        ...sealed,
        planets: [
          createEmptyPlanetDocument("00000001"),
          createEmptyPlanetDocument("00000001"),
        ],
        checksum: sealed.checksum,
      }),
    ).toBeNull();
  });

  it("migrates version 1 campaigns and nested planet patches", () => {
    const profile = createEmptyPlayerProfile();
    const legacyPlanet = {
      v: 1,
      seed: "00000001",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [],
      checksum: "",
    };
    legacyPlanet.checksum = checksumPlanetDocument(legacyPlanet);
    const legacyGame = {
      v: 1,
      savedAt: 100,
      lastSeed: "00000001",
      profile,
      planets: [legacyPlanet],
      checksum: "",
    };
    legacyGame.checksum = checksumGameDocument(legacyGame);

    const migrated = parseGameDocument(legacyGame);
    expect(migrated?.v).toBe(GAME_SAVE_VERSION);
    expect(migrated?.planets[0]?.v).toBe(PLANET_SAVE_VERSION);
    expect(parseGameDocument(migrated)).toEqual(migrated);
  });
});
