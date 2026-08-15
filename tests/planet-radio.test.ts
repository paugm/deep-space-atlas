import { describe, expect, it } from "vitest";

import {
  midiToFrequency,
  planetRadioPatch,
} from "../js/planet-radio.ts";

describe("planetRadioPatch", () => {
  it("is deterministic for a seed and class", () => {
    const first = planetRadioPatch(0xc0ffee, "lush-paradise");
    const second = planetRadioPatch(0xc0ffee, "lush-paradise");
    expect(first).toEqual(second);
    expect(first.notes).toHaveLength(8);
    expect(first.bpm).toBeGreaterThanOrEqual(48);
    expect(first.bpm).toBeLessThan(76);
  });

  it("changes with seed or class", () => {
    const lush = planetRadioPatch(1, "lush-paradise");
    const night = planetRadioPatch(1, "nightworld");
    const otherSeed = planetRadioPatch(2, "lush-paradise");
    expect(lush).not.toEqual(night);
    expect(lush).not.toEqual(otherSeed);
  });
});

describe("midiToFrequency", () => {
  it("maps A4 to 440 Hz", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 8);
  });
});
