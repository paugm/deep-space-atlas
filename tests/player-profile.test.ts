import { describe, expect, it } from "vitest";

import { MATERIAL_ORDER } from "../js/config.ts";
import {
  DEFAULT_AUDIO_MUTED,
  DEFAULT_PLAYER_NAME,
  PLAYER_PROFILE_VERSION,
  PLAYER_PROFILE_VERSION_V1,
  PLAYER_PROFILE_VERSION_V2,
  PLAYER_PROFILE_VERSION_V3,
  PLAYER_PROFILE_VERSION_V4,
  PROFILE_DOCUMENT_ID,
  checksumPlayerProfile,
  createEmptyInventory,
  createEmptyPlayerProfile,
  formatPlayTime,
  lastVisitedSeedHex,
  normalizePlayerName,
  parsePlayerProfile,
  sealPlayerProfile,
} from "../js/player-profile.ts";
import type { PlayerProfile } from "../js/player-profile.ts";

function sealedProfile(
  overrides: Partial<Omit<PlayerProfile, "checksum" | "id">> = {},
): PlayerProfile {
  return sealPlayerProfile({
    v: PLAYER_PROFILE_VERSION,
    id: PROFILE_DOCUMENT_ID,
    name: DEFAULT_PLAYER_NAME,
    inventory: createEmptyInventory(),
    playTimeMs: 0,
    muted: DEFAULT_AUDIO_MUTED,
    gear: [],
    visited: [],
    ...overrides,
  });
}

describe("normalizePlayerName", () => {
  it("trims, collapses whitespace, and clamps length", () => {
    expect(normalizePlayerName("  Nova   Pilot  ")).toBe("Nova Pilot");
    expect(normalizePlayerName("")).toBe(DEFAULT_PLAYER_NAME);
    expect(normalizePlayerName("   ")).toBe(DEFAULT_PLAYER_NAME);
    expect(normalizePlayerName("A".repeat(40))).toHaveLength(24);
  });
});

describe("formatPlayTime", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatPlayTime(0)).toBe("0s");
    expect(formatPlayTime(4500)).toBe("4s");
    expect(formatPlayTime(65_000)).toBe("1m 05s");
    expect(formatPlayTime(3_661_000)).toBe("1h 01m");
  });
});

describe("lastVisitedSeedHex", () => {
  it("returns the most recent visit seed, or null when empty", () => {
    expect(lastVisitedSeedHex([])).toBeNull();
    expect(
      lastVisitedSeedHex([
        {
          seed: "AAAAAAAA",
          name: "Latest",
          firstVisitedAt: 1,
          lastVisitedAt: 99,
          hasPet: false,
        },
        {
          seed: "BBBBBBBB",
          name: "Older",
          firstVisitedAt: 1,
          lastVisitedAt: 10,
          hasPet: false,
        },
      ]),
    ).toBe("AAAAAAAA");
  });
});

describe("checksum and seal", () => {
  it("is stable for the same body and ignores an existing checksum", () => {
    const body: Omit<PlayerProfile, "checksum"> = {
      v: PLAYER_PROFILE_VERSION,
      id: PROFILE_DOCUMENT_ID,
      name: "Scout",
      inventory: createEmptyInventory(),
      playTimeMs: 1200,
      muted: false,
      gear: ["thruster-coil-i"],
      lookSensitivity: 1,
      reduceCrtMotion: false,
      crew: null,
      postcards: [],
      visited: [
        {
          seed: "DEADBEEF",
          name: "Kepler Reach",
          firstVisitedAt: 1,
          lastVisitedAt: 2,
          hasPet: true,
        },
      ],
    };
    const first = checksumPlayerProfile({ ...body, checksum: "IGNORED" });
    const second = checksumPlayerProfile({ ...body, checksum: "OTHER" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-F]{8}$/);
  });

  it("sealPlayerProfile writes a checksum that parse accepts", () => {
    const inventory = createEmptyInventory();
    inventory.iron = 3;
    inventory.crystal = 1;
    const sealed = sealedProfile({
      name: "Rook",
      inventory,
      playTimeMs: 90_000,
      muted: true,
      visited: [
        {
          seed: "0000ABCD",
          name: "Ash Spire",
          firstVisitedAt: 10,
          lastVisitedAt: 20,
          hasPet: false,
        },
      ],
    });
    expect(parsePlayerProfile(sealed)).toEqual(sealed);
    expect(sealed.muted).toBe(true);
  });

  it("createEmptyPlayerProfile is unmuted by default and parseable", () => {
    const empty = createEmptyPlayerProfile();
    expect(parsePlayerProfile(empty)).toEqual(empty);
    expect(empty.muted).toBe(false);
    expect(empty.gear).toEqual([]);
    expect(empty.lookSensitivity).toBe(1);
    expect(empty.reduceCrtMotion).toBe(false);
    expect(empty.crew).toBeNull();
    expect(empty.postcards).toEqual([]);
    expect(DEFAULT_AUDIO_MUTED).toBe(false);
    for (const materialId of MATERIAL_ORDER) {
      expect(empty.inventory[materialId]).toBe(0);
    }
  });
});

describe("parsePlayerProfile", () => {
  it("normalizes seed casing and pads to eight hex digits", () => {
    const sealed = sealPlayerProfile({
      v: PLAYER_PROFILE_VERSION,
      id: PROFILE_DOCUMENT_ID,
      name: "Pilot",
      inventory: createEmptyInventory(),
      playTimeMs: 5,
      muted: false,
      gear: [],
      visited: [
        {
          seed: "000000AB",
          name: "Ash",
          firstVisitedAt: 1,
          lastVisitedAt: 2,
          hasPet: false,
        },
      ],
    });
    const parsed = parsePlayerProfile({
      ...sealed,
      visited: [
        {
          seed: "ab",
          name: "Ash",
          firstVisitedAt: 1,
          lastVisitedAt: 2,
          hasPet: false,
        },
      ],
      checksum: sealPlayerProfile({
        v: PLAYER_PROFILE_VERSION,
        id: PROFILE_DOCUMENT_ID,
        name: "Pilot",
        inventory: createEmptyInventory(),
        playTimeMs: 5,
        muted: false,
        gear: [],
        visited: [
          {
            seed: "000000AB",
            name: "Ash",
            firstVisitedAt: 1,
            lastVisitedAt: 2,
            hasPet: false,
          },
        ],
      }).checksum,
    });
    expect(parsed?.visited[0]?.seed).toBe("000000AB");
  });

  it("rejects bad checksums and malformed inventory", () => {
    const sealed = sealedProfile({ name: "Valid" });
    expect(
      parsePlayerProfile({ ...sealed, checksum: "DEADBEEF" }),
    ).toBeNull();
    expect(
      parsePlayerProfile({
        ...sealed,
        inventory: { silicate: -1 },
        checksum: sealed.checksum,
      }),
    ).toBeNull();
  });

  it("upgrades valid v1 profiles to current with sound unmuted and empty gear", () => {
    const inventory = createEmptyInventory();
    inventory.carbon = 2;
    const v1Body = {
      v: PLAYER_PROFILE_VERSION_V1,
      id: PROFILE_DOCUMENT_ID,
      name: "Legacy",
      inventory,
      playTimeMs: 4000,
      visited: [
        {
          seed: "0000CAFE",
          name: "Old Reach",
          firstVisitedAt: 1,
          lastVisitedAt: 2,
          hasPet: false,
        },
      ],
    };
    // Reproduce the v1 FNV body (no muted field).
    const payload = JSON.stringify(v1Body);
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const checksum = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");

    const parsed = parsePlayerProfile({ ...v1Body, checksum });
    expect(parsed).not.toBeNull();
    expect(parsed?.v).toBe(PLAYER_PROFILE_VERSION);
    expect(parsed?.muted).toBe(false);
    expect(parsed?.gear).toEqual([]);
    expect(parsed?.name).toBe("Legacy");
    expect(parsed?.inventory.carbon).toBe(2);
    expect(parsePlayerProfile(parsed)).toEqual(parsed);
  });

  it("upgrades valid v2 profiles to current with empty gear", () => {
    const inventory = createEmptyInventory();
    inventory.iron = 4;
    const v2Body = {
      v: PLAYER_PROFILE_VERSION_V2,
      id: PROFILE_DOCUMENT_ID,
      name: "Mid",
      inventory,
      playTimeMs: 900,
      muted: true,
      visited: [] as const,
    };
    const payload = JSON.stringify(v2Body);
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const checksum = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");

    const parsed = parsePlayerProfile({ ...v2Body, checksum });
    expect(parsed?.v).toBe(PLAYER_PROFILE_VERSION);
    expect(parsed?.muted).toBe(true);
    expect(parsed?.gear).toEqual([]);
    expect(parsed?.inventory.iron).toBe(4);
  });

  it("upgrades valid v3 profiles with builds field to gear", () => {
    const inventory = createEmptyInventory();
    inventory.copper = 3;
    const v3Body = {
      v: PLAYER_PROFILE_VERSION_V3,
      id: PROFILE_DOCUMENT_ID,
      name: "Builder",
      inventory,
      playTimeMs: 1200,
      muted: false,
      builds: ["thruster-coil-i"],
      visited: [] as const,
    };
    const payload = JSON.stringify(v3Body);
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const checksum = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");

    const parsed = parsePlayerProfile({ ...v3Body, checksum });
    expect(parsed?.v).toBe(PLAYER_PROFILE_VERSION);
    expect(parsed?.gear).toEqual(["thruster-coil-i"]);
    expect(parsed?.inventory.copper).toBe(3);
    expect(parsePlayerProfile(parsed)).toEqual(parsed);
  });

  it("upgrades valid v4 profiles with look, CRT, crew, and postcard defaults", () => {
    const inventory = createEmptyInventory();
    inventory.silicate = 9;
    const v4Body = {
      v: PLAYER_PROFILE_VERSION_V4,
      id: PROFILE_DOCUMENT_ID,
      name: "Surveyor",
      inventory,
      playTimeMs: 2200,
      muted: true,
      gear: ["focus-lens-i"],
      visited: [] as const,
    };
    const payload = JSON.stringify(v4Body);
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const checksum = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");

    const parsed = parsePlayerProfile({ ...v4Body, checksum });
    expect(parsed?.v).toBe(PLAYER_PROFILE_VERSION);
    expect(parsed?.lookSensitivity).toBe(1);
    expect(parsed?.reduceCrtMotion).toBe(false);
    expect(parsed?.crew).toBeNull();
    expect(parsed?.postcards).toEqual([]);
    expect(parsed?.gear).toEqual(["focus-lens-i"]);
    expect(parsed?.muted).toBe(true);
  });

  it("clamps look sensitivity and keeps a valid crew postcard atlas", () => {
    const sealed = sealedProfile({
      lookSensitivity: 9,
      reduceCrtMotion: true,
      crew: {
        species: "panda",
        homeSeed: "ab",
        homeName: "Kepler Reach",
      },
      postcards: [
        {
          seed: "deadbeef",
          name: "Kepler Reach",
          capturedAt: 100,
          thumb: "data:image/jpeg;base64,QQ",
        },
      ],
    });
    expect(sealed.lookSensitivity).toBe(2);
    expect(sealed.reduceCrtMotion).toBe(true);
    expect(sealed.crew).toEqual({
      species: "panda",
      homeSeed: "000000AB",
      homeName: "Kepler Reach",
    });
    expect(sealed.postcards[0]?.seed).toBe("DEADBEEF");
    expect(parsePlayerProfile(sealed)).toEqual(sealed);
  });

  it("rejects profiles missing gear or with unknown gear ids", () => {
    const sealed = sealedProfile({ name: "NoGear" });
    const { gear: _ignored, ...withoutGear } = sealed;
    expect(parsePlayerProfile(withoutGear)).toBeNull();
    expect(
      parsePlayerProfile({
        ...sealed,
        gear: ["not-a-gear"],
        checksum: sealed.checksum,
      }),
    ).toBeNull();
  });

  it("rejects v2 profiles missing a boolean muted flag", () => {
    const sealed = sealedProfile({ name: "NoMute" });
    const { muted: _ignored, ...withoutMuted } = sealed;
    expect(parsePlayerProfile(withoutMuted)).toBeNull();
  });
});
