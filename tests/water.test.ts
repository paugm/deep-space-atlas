import { describe, expect, it } from "vitest";

import { EYE_HEIGHT, WATER_DEPTH_FOR_FULL_FOG } from "../js/config.ts";
import {
  blendUnderwaterFogColor,
  sampleWaterImmersion,
  underwaterFogParams,
} from "../js/water.ts";

describe("sampleWaterImmersion", () => {
  it("reports dry when the body is above the plane", () => {
    const sample = sampleWaterImmersion(12, EYE_HEIGHT, 8);
    expect(sample.eyeSubmerged).toBe(false);
    expect(sample.bodyInWater).toBe(false);
    expect(sample.eyeDepth).toBe(0);
  });

  it("slows the body while wading before the eye goes under", () => {
    const waterLevel = 10;
    const eyeY = waterLevel + 0.2;
    const sample = sampleWaterImmersion(eyeY, EYE_HEIGHT, waterLevel);
    expect(sample.eyeSubmerged).toBe(false);
    expect(sample.bodyInWater).toBe(true);
    expect(sample.eyeDepth).toBe(0);
  });

  it("marks full submersion from eye depth", () => {
    const sample = sampleWaterImmersion(6, EYE_HEIGHT, 10);
    expect(sample.eyeSubmerged).toBe(true);
    expect(sample.bodyInWater).toBe(true);
    expect(sample.eyeDepth).toBe(4);
  });
});

describe("underwaterFogParams", () => {
  it("keeps surface fog at zero depth", () => {
    const fog = underwaterFogParams(0, 55, 330);
    expect(fog.strength).toBe(0);
    expect(fog.near).toBe(55);
    expect(fog.far).toBe(330);
  });

  it("reaches full strength at the configured depth", () => {
    const fog = underwaterFogParams(WATER_DEPTH_FOR_FULL_FOG, 55, 330);
    expect(fog.strength).toBe(1);
    expect(fog.near).toBeLessThan(55);
    expect(fog.far).toBeLessThan(330);
  });
});

describe("blendUnderwaterFogColor", () => {
  it("returns the surface color at strength 0", () => {
    const color = blendUnderwaterFogColor(1, 0.8, 0.6, 0.1, 0.4, 0.5, 0);
    expect(color.r).toBeCloseTo(1, 8);
    expect(color.g).toBeCloseTo(0.8, 8);
    expect(color.b).toBeCloseTo(0.6, 8);
  });

  it("pulls toward a darkened water tint at full strength", () => {
    const color = blendUnderwaterFogColor(1, 1, 1, 0.2, 0.6, 0.8, 1);
    expect(color.r).toBeCloseTo(0.2 * 0.35, 8);
    expect(color.g).toBeCloseTo(0.6 * 0.45, 8);
    expect(color.b).toBeCloseTo(0.8 * 0.55, 8);
  });
});
