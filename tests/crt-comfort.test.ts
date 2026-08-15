import { describe, expect, it } from "vitest";

import { crtComfortSettings, prefersReducedMotion } from "../js/crt.ts";

describe("crtComfortSettings", () => {
  it("zeros grain and chroma when reducing motion", () => {
    expect(crtComfortSettings(true)).toEqual({
      grainWeight: 0,
      chromatic: 0,
      scanlineSpeed: 0,
    });
    expect(crtComfortSettings(false).grainWeight).toBeGreaterThan(0);
    expect(crtComfortSettings(false).chromatic).toBeGreaterThan(0);
  });
});

describe("prefersReducedMotion", () => {
  it("reads a media-query-like object", () => {
    expect(prefersReducedMotion({ matches: true })).toBe(true);
    expect(prefersReducedMotion({ matches: false })).toBe(false);
  });
});
