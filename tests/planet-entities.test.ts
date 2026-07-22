import { describe, expect, it } from "vitest";

import {
  createPlayerEntity,
  findPlayerEntity,
  parsePlayerSaveState,
  upsertPlayerEntity,
} from "../js/player-entity.ts";
import {
  createEmptyPlanetDocument,
  parsePlanetDocument,
  sealPlanetDocument,
  upsertPlanetEntity,
} from "../js/planet-save.ts";
import {
  createParkedShipEntity,
  findParkedShipEntity,
  parseParkedShipPose,
  upsertParkedShipEntity,
} from "../js/space/parked-ship-entity.ts";
import {
  createStructureEntity,
  listStructureEntities,
  parseStructurePose,
} from "../js/structures/entity.ts";

describe("player entity", () => {
  it("round-trips pose through create / parse / upsert", () => {
    const document = createEmptyPlanetDocument("DEADBEEF");
    const entity = createPlayerEntity({
      x: 12,
      y: 5.5,
      z: -8,
      yaw: 1.25,
      pitch: -0.2,
      fuel: 0.4,
    });
    upsertPlayerEntity(document, entity);

    const found = findPlayerEntity(document);
    expect(found).not.toBeNull();
    expect(parsePlayerSaveState(found!)).toEqual({
      x: 12,
      y: 5.5,
      z: -8,
      yaw: 1.25,
      pitch: -0.2,
      fuel: 0.4,
    });

    upsertPlayerEntity(
      document,
      createPlayerEntity({
        x: 1,
        y: 2,
        z: 3,
        yaw: 0,
        pitch: 0,
        fuel: 1,
      }),
    );
    expect(
      document.entities.filter((entry) => entry.kind === "player"),
    ).toHaveLength(1);
    expect(findPlayerEntity(document)?.x).toBe(1);
  });

  it("survives seal / parse checksum round-trip", () => {
    const document = createEmptyPlanetDocument("00000001");
    upsertPlayerEntity(
      document,
      createPlayerEntity({
        x: 3,
        y: 4,
        z: 5,
        yaw: 0.5,
        pitch: -0.05,
        fuel: 0.9,
      }),
    );
    const sealed = sealPlanetDocument(document);
    const parsed = parsePlanetDocument(sealed);
    expect(parsed).not.toBeNull();
    expect(parsePlayerSaveState(findPlayerEntity(parsed!)!)).toMatchObject({
      x: 3,
      z: 5,
      fuel: 0.9,
    });
  });
});

describe("parked ship entity", () => {
  it("round-trips pad pose and upserts a single entity", () => {
    const document = createEmptyPlanetDocument("CAFEBABE");
    upsertParkedShipEntity(
      document,
      createParkedShipEntity({ x: 20, z: -15, yaw: 2.1 }),
    );
    const found = findParkedShipEntity(document);
    expect(parseParkedShipPose(found!)).toEqual({
      x: 20,
      z: -15,
      yaw: 2.1,
    });

    upsertParkedShipEntity(
      document,
      createParkedShipEntity({ x: 0, z: 0, yaw: 0 }),
    );
    expect(
      document.entities.filter((entry) => entry.kind === "parked-ship"),
    ).toHaveLength(1);
    expect(findParkedShipEntity(document)?.x).toBe(0);
  });

  it("rejects malformed ship entities", () => {
    expect(
      parseParkedShipPose({
        id: "parked-ship",
        kind: "parked-ship",
        x: Number.NaN,
        y: 0,
        z: 1,
        yaw: 0,
      }),
    ).toBeNull();
    expect(
      parseParkedShipPose({
        id: "parked-ship",
        kind: "parked-ship",
        x: 1,
        y: 0,
        z: 1,
      }),
    ).toBeNull();
  });
});

describe("structure entity", () => {
  it("round-trips pose through create / parse / list", () => {
    const document = createEmptyPlanetDocument("DEADBEEF");
    const entity = createStructureEntity({
      id: "structure-0",
      blueprintId: "beacon",
      x: 4,
      z: -6,
      yaw: 0.5,
    });
    upsertPlanetEntity(document, entity);
    const listed = listStructureEntities(document);
    expect(listed).toHaveLength(1);
    expect(parseStructurePose(listed[0]!)).toEqual({
      id: "structure-0",
      blueprintId: "beacon",
      x: 4,
      z: -6,
      yaw: 0.5,
    });
  });

  it("rejects malformed structure entities", () => {
    expect(
      parseStructurePose({
        id: "structure-0",
        kind: "structure",
        x: 1,
        y: 0,
        z: 1,
        yaw: 0,
        data: { blueprintId: "nope" },
      }),
    ).toBeNull();
  });
});
