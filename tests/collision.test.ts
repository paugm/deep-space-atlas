import { describe, expect, it } from "vitest";

import {
  resolveCapsuleAgainstSolids,
  slideVelocityFromCorrection,
} from "../js/collision.ts";
import { EYE_HEIGHT, PLAYER_RADIUS } from "../js/config.ts";

describe("resolveCapsuleAgainstSolids", () => {
  it("leaves a clear capsule unchanged", () => {
    const result = resolveCapsuleAgainstSolids(
      {
        x: 0,
        y: EYE_HEIGHT,
        z: 0,
        radius: PLAYER_RADIUS,
        eyeHeight: EYE_HEIGHT,
      },
      [
        {
          kind: "sphere",
          x: 10,
          y: 1,
          z: 0,
          radius: 1,
        },
      ],
    );
    expect(result.x).toBe(0);
    expect(result.y).toBe(EYE_HEIGHT);
    expect(result.z).toBe(0);
    expect(result.correctionX).toBe(0);
    expect(result.correctionY).toBe(0);
    expect(result.correctionZ).toBe(0);
  });

  it("pushes the capsule out of an overlapping rock sphere", () => {
    const result = resolveCapsuleAgainstSolids(
      {
        x: 0,
        y: EYE_HEIGHT,
        z: 0,
        radius: PLAYER_RADIUS,
        eyeHeight: EYE_HEIGHT,
      },
      [
        {
          kind: "sphere",
          x: 0.2,
          y: 0.8,
          z: 0,
          radius: 0.9,
        },
      ],
    );
    expect(result.x).not.toBeCloseTo(0, 5);
    const gap = Math.hypot(result.x - 0.2, result.y - 0.8, result.z);
    expect(gap).toBeGreaterThanOrEqual(PLAYER_RADIUS + 0.9 - 0.02);
  });

  it("pushes the capsule out of a lander AABB", () => {
    const result = resolveCapsuleAgainstSolids(
      {
        x: 0,
        y: EYE_HEIGHT,
        z: 0,
        radius: PLAYER_RADIUS,
        eyeHeight: EYE_HEIGHT,
      },
      [
        {
          kind: "aabb",
          minX: -1,
          minY: 0,
          minZ: -1,
          maxX: 1,
          maxY: 3,
          maxZ: 1,
        },
      ],
    );
    const outsideX = result.x <= -1 - PLAYER_RADIUS + 0.02 ||
      result.x >= 1 + PLAYER_RADIUS - 0.02;
    const outsideZ = result.z <= -1 - PLAYER_RADIUS + 0.02 ||
      result.z >= 1 + PLAYER_RADIUS - 0.02;
    const outsideY = result.y - EYE_HEIGHT + PLAYER_RADIUS >= 3 - 0.02 ||
      result.y - PLAYER_RADIUS <= 0 + 0.02;
    expect(outsideX || outsideZ || outsideY).toBe(true);
  });
});

describe("slideVelocityFromCorrection", () => {
  it("removes velocity into the correction normal", () => {
    const slid = slideVelocityFromCorrection(2, 0, 0, -1, 0, 0);
    expect(slid.x).toBeCloseTo(0, 8);
    expect(slid.y).toBe(0);
    expect(slid.z).toBe(0);
  });

  it("keeps velocity that already separates from the solid", () => {
    const slid = slideVelocityFromCorrection(2, 0, 0, 1, 0, 0);
    expect(slid.x).toBe(2);
    expect(slid.y).toBe(0);
    expect(slid.z).toBe(0);
  });
});
