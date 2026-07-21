import { describe, expect, it } from "vitest";

import { VERTICES_PER_ROW } from "../js/config.ts";
import {
  PLANET_SAVE_VERSION,
  WORLD_CONTENT_REVISION,
  caveBrushesArray,
  checksumPlanetDocument,
  createEmptyPlanetDocument,
  hexToSeed,
  mergeTerrainSamples,
  mergeCaveBrush,
  packHeights,
  parsePlanetDocument,
  recordDepositRemaining,
  sealPlanetDocument,
  seedToHex,
  setFullTerrainFromHeights,
  shouldCompactTerrain,
  unpackHeights,
} from "../js/planet-save.ts";
import type { PlanetDocument } from "../js/planet-save.ts";
import type { CaveBrush } from "../js/world/caves.ts";

const VERTEX_COUNT = VERTICES_PER_ROW * VERTICES_PER_ROW;

function sealedPlanet(
  overrides: Partial<Omit<PlanetDocument, "checksum">> = {},
): PlanetDocument {
  return sealPlanetDocument({
    v: PLANET_SAVE_VERSION,
    seed: "DEADBEEF",
    contentRevision: WORLD_CONTENT_REVISION,
    entities: [],
    ...overrides,
  });
}

describe("seedToHex / hexToSeed", () => {
  it("round-trips 32-bit seeds with zero-padded uppercase hex", () => {
    expect(seedToHex(0)).toBe("00000000");
    expect(seedToHex(0xdeadbeef)).toBe("DEADBEEF");
    expect(seedToHex(0xffffffff)).toBe("FFFFFFFF");
    expect(hexToSeed("deadbeef")).toBe(0xdeadbeef);
    expect(hexToSeed("  ABCD  ")).toBe(0xabcd);
    expect(seedToHex(hexToSeed("00ff")!)).toBe("000000FF");
  });

  it("rejects malformed hex seeds", () => {
    expect(hexToSeed("")).toBeNull();
    expect(hexToSeed("GGGG")).toBeNull();
    expect(hexToSeed("123456789")).toBeNull();
    expect(hexToSeed("xyz")).toBeNull();
  });

  it("treats negative seeds as unsigned 32-bit", () => {
    expect(seedToHex(-1)).toBe("FFFFFFFF");
    expect(hexToSeed("FFFFFFFF")).toBe(0xffffffff);
  });
});

describe("checksum and seal", () => {
  it("is stable for the same body and ignores an existing checksum field", () => {
    const body = {
      v: PLANET_SAVE_VERSION,
      seed: "00000001",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [
        { id: "pet", kind: "pet", x: 1, y: 2, z: 3 },
      ] as PlanetDocument["entities"],
    };
    const first = checksumPlanetDocument({ ...body, checksum: "IGNORED" });
    const second = checksumPlanetDocument({ ...body, checksum: "OTHER" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-F]{8}$/);
  });

  it("changes when document content changes", () => {
    const base = checksumPlanetDocument({
      v: PLANET_SAVE_VERSION,
      seed: "00000001",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [],
    });
    const changed = checksumPlanetDocument({
      v: PLANET_SAVE_VERSION,
      seed: "00000002",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [],
    });
    expect(base).not.toBe(changed);
  });

  it("sealPlanetDocument writes a checksum that parse accepts", () => {
    const sealed = sealedPlanet({
      terrain: { kind: "sparse", cells: [[0, 12.5], [10, -3]] },
      deposits: { iron: [{ id: "iron:1:2", remaining: 4 }] },
    });
    expect(parsePlanetDocument(sealed)).toEqual(sealed);
  });
});

describe("parsePlanetDocument", () => {
  it("normalizes seed casing and padding before checksum verification", () => {
    const sealed = sealPlanetDocument({
      v: PLANET_SAVE_VERSION,
      seed: "0000ABCD",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [],
    });
    const parsed = parsePlanetDocument({
      v: sealed.v,
      seed: "abcd",
      checksum: sealed.checksum,
      contentRevision: sealed.contentRevision,
      entities: sealed.entities,
    });
    expect(parsed?.seed).toBe("0000ABCD");
  });

  it("rejects wrong version, bad checksum, and invalid shapes", () => {
    const good = sealedPlanet();
    expect(parsePlanetDocument({ ...good, v: 999 })).toBeNull();
    expect(parsePlanetDocument({ ...good, checksum: "00000000" })).toBeNull();
    expect(parsePlanetDocument({ ...good, seed: "not-hex" })).toBeNull();
    expect(parsePlanetDocument({ ...good, entities: "nope" })).toBeNull();
    expect(parsePlanetDocument(null)).toBeNull();
    expect(parsePlanetDocument("string")).toBeNull();
  });

  it("rejects sparse terrain cells that are not finite number pairs", () => {
    const sealed = sealedPlanet({
      terrain: { kind: "sparse", cells: [[1, 2]] },
    });
    expect(
      parsePlanetDocument({
        ...sealed,
        terrain: { kind: "sparse", cells: [[1, Number.NaN]] },
        checksum: sealed.checksum,
      }),
    ).toBeNull();
  });

  it("rejects deposit patches that use index instead of id", () => {
    const candidate = {
      v: PLANET_SAVE_VERSION,
      seed: "DEADBEEF",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [] as PlanetDocument["entities"],
      deposits: { iron: [{ index: 2, remaining: 4 }] },
      checksum: "",
    };
    candidate.checksum = checksumPlanetDocument(
      candidate as unknown as PlanetDocument,
    );
    expect(parsePlanetDocument(candidate)).toBeNull();
  });

  it("accepts packed terrain and round-trips heights", () => {
    const heights = Array.from({ length: VERTEX_COUNT }, (_, index) =>
      index % 17 === 0 ? -2.5 : 1.25,
    );
    const sealed = sealedPlanet({
      terrain: {
        kind: "packed",
        encoding: "f32le-b64",
        data: packHeights(heights),
      },
    });
    const parsed = parsePlanetDocument(sealed);
    expect(parsed?.terrain?.kind).toBe("packed");
    if (parsed?.terrain?.kind !== "packed") return;
    const unpacked = unpackHeights(parsed.terrain.data);
    expect(unpacked).not.toBeNull();
    expect(Array.from(unpacked!).slice(0, 5)).toEqual(heights.slice(0, 5));
  });

  it("explicitly migrates verified version 1 planets without caves", () => {
    const legacy = {
      v: 1,
      seed: "DEADBEEF",
      contentRevision: WORLD_CONTENT_REVISION,
      entities: [
        { id: "player", kind: "player", x: 1, y: 2, z: 3 },
      ] as PlanetDocument["entities"],
      terrain: {
        kind: "sparse" as const,
        cells: [[4, -2.5] as const],
      },
      deposits: { iron: [{ id: "iron:1:2", remaining: 3 }] },
      checksum: "",
    };
    legacy.checksum = checksumPlanetDocument(legacy);
    const migrated = parsePlanetDocument(legacy);
    expect(migrated?.v).toBe(PLANET_SAVE_VERSION);
    expect(migrated?.seed).toBe("DEADBEEF");
    expect(migrated?.caves).toBeUndefined();
    expect(migrated?.terrain).toEqual(legacy.terrain);
    expect(migrated?.deposits).toEqual(legacy.deposits);
    expect(migrated?.entities).toEqual(legacy.entities);
    expect(parsePlanetDocument(migrated)).toEqual(migrated);
  });
});

describe("createEmptyPlanetDocument", () => {
  it("creates a sealed empty patch for the seed", () => {
    const document = createEmptyPlanetDocument("00ABCDEF");
    expect(document.v).toBe(PLANET_SAVE_VERSION);
    expect(document.seed).toBe("00ABCDEF");
    expect(document.contentRevision).toBe(WORLD_CONTENT_REVISION);
    expect(document.entities).toEqual([]);
    expect(document.terrain).toBeUndefined();
    expect(document.deposits).toBeUndefined();
    expect(parsePlanetDocument(document)).toEqual(document);
  });
});

describe("mergeTerrainSamples", () => {
  it("builds sparse terrain and overwrites duplicate indices", () => {
    const document = createEmptyPlanetDocument("00000001");
    mergeTerrainSamples(document, [
      { index: 5, height: 1 },
      { index: 8, height: 2 },
      { index: 5, height: 9 },
    ]);
    expect(document.terrain).toEqual({
      kind: "sparse",
      cells: [
        [5, 9],
        [8, 2],
      ],
    });
  });

  it("ignores out-of-range indices and no-op empty sample lists", () => {
    const document = createEmptyPlanetDocument("00000001");
    mergeTerrainSamples(document, []);
    expect(document.terrain).toBeUndefined();

    mergeTerrainSamples(document, [
      { index: -1, height: 3 },
      { index: VERTEX_COUNT, height: 3 },
      { index: 0, height: 4 },
    ]);
    expect(document.terrain).toEqual({
      kind: "sparse",
      cells: [[0, 4]],
    });
  });

  it("updates packed terrain in place; seal re-encodes the base64", () => {
    const heights = Array.from({ length: VERTEX_COUNT }, () => 0);
    const document = createEmptyPlanetDocument("00000001");
    setFullTerrainFromHeights(document, heights);
    mergeTerrainSamples(document, [{ index: 3, height: 7.5 }]);
    expect(document.terrain?.kind).toBe("packed");
    const sealed = sealPlanetDocument(document);
    if (sealed.terrain?.kind !== "packed") return;
    const unpacked = unpackHeights(sealed.terrain.data);
    expect(unpacked?.[3]).toBe(7.5);
  });

  it("keeps decoded heights for in-place merges and encodes once at seal", () => {
    const heights = Array.from({ length: VERTEX_COUNT }, () => 1);
    const document = createEmptyPlanetDocument("00000001");
    setFullTerrainFromHeights(document, heights);

    // Decode once via terrainHeightsArray, then merge twice: both craters
    // land in the same live buffer instead of re-encoding each time.
    mergeTerrainSamples(document, [{ index: 0, height: 5 }]);
    mergeTerrainSamples(document, [{ index: 1, height: 6 }]);
    if (document.terrain?.kind !== "packed") return;
    expect(document.terrain.heights?.[0]).toBe(5);
    expect(document.terrain.heights?.[1]).toBe(6);

    const sealed = sealPlanetDocument(document);
    if (sealed.terrain?.kind !== "packed") return;
    // The sealed patch carries no live buffer; data round-trips via parse.
    expect(sealed.terrain.heights).toBeUndefined();
    const unpacked = unpackHeights(sealed.terrain.data);
    expect(unpacked?.[0]).toBe(5);
    expect(unpacked?.[1]).toBe(6);
    expect(unpacked?.[2]).toBe(1);
    expect(parsePlanetDocument(sealed)).not.toBeNull();
  });

  it("seal re-encodes stale data after heights mutate in place", () => {
    const heights = Array.from({ length: VERTEX_COUNT }, () => 2);
    const document = createEmptyPlanetDocument("00000001");
    setFullTerrainFromHeights(document, heights);
    const firstSeal = sealPlanetDocument(document);
    if (firstSeal.terrain?.kind !== "packed") return;
    const firstData = firstSeal.terrain.data;

    mergeTerrainSamples(document, [{ index: 4, height: -3 }]);
    const secondSeal = sealPlanetDocument(document);
    if (secondSeal.terrain?.kind !== "packed") return;
    expect(secondSeal.terrain.data).not.toBe(firstData);
    expect(unpackHeights(secondSeal.terrain.data)?.[4]).toBe(-3);
  });
});

describe("cave patches", () => {
  it("keeps decoded brushes live and encodes them once at seal", () => {
    const brush: CaveBrush = {
      start: { x: 1, y: 2, z: 3 },
      end: { x: 2.65, y: 2, z: 3 },
      radius: 1.6,
    };
    const document = createEmptyPlanetDocument("00000001");
    mergeCaveBrush(document, brush);
    mergeCaveBrush(document, {
      start: { x: 2.6, y: 2, z: 3 },
      end: { x: 4, y: 2, z: 3 },
      radius: 1.6,
    });
    const compacted = {
      ...brush,
      end: { x: 4, y: 2, z: 3 },
    };
    expect(document.caves?.brushes).toEqual([compacted]);

    const sealed = sealPlanetDocument(document);
    expect(sealed.caves?.brushes).toBeUndefined();
    const parsed = parsePlanetDocument(sealed);
    expect(parsed?.caves).toBeDefined();
    if (parsed?.caves === undefined) return;
    expect(caveBrushesArray(parsed.caves)).toEqual([compacted]);
  });
});

describe("shouldCompactTerrain / setFullTerrainFromHeights", () => {
  it("compacts only after sparse edits cross the ratio", () => {
    const document = createEmptyPlanetDocument("00000001");
    expect(shouldCompactTerrain(document)).toBe(false);
    const samples = Array.from(
      { length: Math.ceil(VERTEX_COUNT * 0.12) },
      (_, index) => ({ index, height: 1 }),
    );
    mergeTerrainSamples(document, samples);
    expect(shouldCompactTerrain(document)).toBe(true);
    setFullTerrainFromHeights(
      document,
      Array.from({ length: VERTEX_COUNT }, () => 2),
    );
    expect(document.terrain?.kind).toBe("packed");
    expect(shouldCompactTerrain(document)).toBe(false);
  });
});

describe("recordDepositRemaining", () => {
  it("upserts by stable id and sorts", () => {
    const document = createEmptyPlanetDocument("00000001");
    recordDepositRemaining(document, "iron", "iron:2:3", 4);
    recordDepositRemaining(document, "iron", "iron:1:1", 2);
    recordDepositRemaining(document, "iron", "iron:2:3", 1);
    expect(document.deposits?.iron).toEqual([
      { id: "iron:1:1", remaining: 2 },
      { id: "iron:2:3", remaining: 1 },
    ]);
  });
});
