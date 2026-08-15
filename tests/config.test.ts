import { describe, expect, it } from "vitest";

import {
  LOOK_SENSITIVITY_DEFAULT,
  LOOK_SENSITIVITY_MAX,
  LOOK_SENSITIVITY_MIN,
  DEPOSIT_DEFINITIONS,
  DEPOSIT_TYPES,
  MATERIAL_ORDER,
  MATERIALS,
  clamp,
  createNoise2D,
  lerp,
  makeFbm,
  mulberry32,
  normalizeLookSensitivity,
  smoothstep,
} from "../js/config.ts";

describe("clamp", () => {
  it("keeps values inside the range and snaps out-of-range inputs", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("lerp", () => {
  it("interpolates and extrapolates by amount", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe("smoothstep", () => {
  it("is clamped Hermite interpolation between the edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    // At t=0.25: 0.25^2 * (3 - 0.5) = 0.0625 * 2.5 = 0.15625
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 10);
  });
});

describe("mulberry32", () => {
  it("is deterministic for the same seed and stays in [0, 1)", () => {
    const left = mulberry32(0xdeadbeef);
    const right = mulberry32(0xdeadbeef);
    const samples = Array.from({ length: 32 }, () => left());

    expect(samples).toEqual(Array.from({ length: 32 }, () => right()));
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const sequenceA = Array.from({ length: 8 }, () => a());
    const sequenceB = Array.from({ length: 8 }, () => b());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it("treats seeds as unsigned 32-bit values", () => {
    const negative = mulberry32(-1);
    const unsigned = mulberry32(0xffffffff);
    expect(negative()).toBe(unsigned());
  });
});

describe("createNoise2D / makeFbm", () => {
  it("produces the same field for the same seed", () => {
    const noiseA = createNoise2D(mulberry32(42));
    const noiseB = createNoise2D(mulberry32(42));
    const samples = [
      [0, 0],
      [1.5, -2.25],
      [10, 10],
      [-3.1, 7.7],
    ] as const;

    for (const [x, y] of samples) {
      expect(noiseA(x, y)).toBe(noiseB(x, y));
    }
  });

  it("keeps simplex samples in a bounded range", () => {
    const noise = createNoise2D(mulberry32(99));
    for (let x = -5; x <= 5; x += 0.37) {
      for (let y = -5; y <= 5; y += 0.41) {
        const value = noise(x, y);
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("normalizes fbm by amplitude sum so one octave matches the base noise", () => {
    const noise = createNoise2D(mulberry32(7));
    const fbm = makeFbm(noise);
    expect(fbm(1.25, -0.5, 1, 2, 0.5)).toBe(noise(1.25, -0.5));
  });

  it("is deterministic across multi-octave fbm", () => {
    const fbmA = makeFbm(createNoise2D(mulberry32(1234)));
    const fbmB = makeFbm(createNoise2D(mulberry32(1234)));
    expect(fbmA(3, 4, 5, 2, 0.5)).toBe(fbmB(3, 4, 5, 2, 0.5));
  });
});

describe("material and deposit tables", () => {
  it("keeps MATERIAL_ORDER aligned with MATERIALS keys", () => {
    expect([...MATERIAL_ORDER].sort()).toEqual(
      Object.keys(MATERIALS).sort(),
    );
  });

  it("keeps DEPOSIT_TYPES aligned with DEPOSIT_DEFINITIONS and excludes silicate", () => {
    expect([...DEPOSIT_TYPES].sort()).toEqual(
      Object.keys(DEPOSIT_DEFINITIONS).sort(),
    );
    expect(DEPOSIT_TYPES).not.toContain("silicate");
    for (const type of DEPOSIT_TYPES) {
      expect(type in MATERIALS).toBe(true);
    }
  });
});

describe("normalizeLookSensitivity", () => {
  it("defaults, clamps, and keeps in-range values", () => {
    expect(normalizeLookSensitivity(Number.NaN)).toBe(LOOK_SENSITIVITY_DEFAULT);
    expect(normalizeLookSensitivity(0)).toBe(LOOK_SENSITIVITY_MIN);
    expect(normalizeLookSensitivity(9)).toBe(LOOK_SENSITIVITY_MAX);
    expect(normalizeLookSensitivity(1.25)).toBe(1.25);
  });
});
