import { describe, expect, it } from "vitest";

import {
  LANDING_FADE_MS,
  LANDING_HOLD_MS,
  LAUNCH_FADE_MS,
  LAUNCH_HOLD_MS,
  landingShipState,
  launchAscentState,
} from "../js/space/cinematic-math.ts";

describe("landingShipState", () => {
  const TRAVEL = 1400;

  it("starts at the departure point at full scale", () => {
    const state = landingShipState(0, TRAVEL);
    expect(state.distance).toBe(0);
    expect(state.scale).toBe(1);
  });

  it("covers the full travel distance and vanishes by the end of the hold", () => {
    const state = landingShipState(LANDING_HOLD_MS, TRAVEL);
    expect(state.distance).toBeCloseTo(TRAVEL, 6);
    expect(state.scale).toBe(0);
  });

  it("clamps past the hold instead of overshooting", () => {
    const state = landingShipState(LANDING_HOLD_MS * 3, TRAVEL);
    expect(state.distance).toBeCloseTo(TRAVEL, 6);
    expect(state.scale).toBe(0);
  });

  it("advances monotonically and shrinks monotonically", () => {
    let previous = landingShipState(0, TRAVEL);
    for (let ms = 50; ms <= LANDING_HOLD_MS; ms += 50) {
      const state = landingShipState(ms, TRAVEL);
      expect(state.distance).toBeGreaterThanOrEqual(previous.distance);
      expect(state.scale).toBeLessThanOrEqual(previous.scale);
      previous = state;
    }
  });

  it("accelerates: the second half covers far more ground than the first", () => {
    const midway = landingShipState(LANDING_HOLD_MS / 2, TRAVEL);
    const firstHalf = midway.distance;
    const secondHalf = TRAVEL - midway.distance;
    expect(secondHalf).toBeGreaterThan(firstHalf * 3);
  });

  it("keeps full scale until the shrink window near touchdown", () => {
    const state = landingShipState(LANDING_HOLD_MS * 0.7, TRAVEL);
    expect(state.scale).toBe(1);
  });
});

describe("launchAscentState", () => {
  it("starts on the pad, level, and still", () => {
    const state = launchAscentState(0);
    expect(state.altitude).toBe(0);
    expect(state.pitch).toBe(0);
    expect(state.offsetY).toBe(0);
  });

  it("climbs monotonically with acceleration", () => {
    const quarter = launchAscentState(500).altitude;
    const half = launchAscentState(1000).altitude;
    const full = launchAscentState(2000).altitude;
    expect(quarter).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(quarter * 2);
    expect(full).toBeGreaterThan(half * 2);
  });

  it("reaches the sky within the cinematic hold", () => {
    expect(launchAscentState(LAUNCH_HOLD_MS).altitude).toBeGreaterThan(150);
  });

  it("pitches up to a bounded nose-up attitude", () => {
    let previous = 0;
    for (let ms = 0; ms <= 2000; ms += 100) {
      const pitch = launchAscentState(ms).pitch;
      expect(pitch).toBeGreaterThanOrEqual(previous);
      expect(pitch).toBeLessThanOrEqual(0.5);
      previous = pitch;
    }
  });

  it("keeps the vertical rumble bounded", () => {
    for (let ms = 0; ms <= 2000; ms += 37) {
      const state = launchAscentState(ms);
      expect(Math.abs(state.offsetY)).toBeLessThanOrEqual(0.18);
    }
  });

  it("treats negative elapsed time as ignition", () => {
    expect(launchAscentState(-100).altitude).toBe(0);
  });
});

describe("cinematic durations", () => {
  it("keeps holds and fades positive with launch snappier than landing", () => {
    expect(LAUNCH_HOLD_MS).toBeGreaterThan(0);
    expect(LANDING_HOLD_MS).toBeGreaterThan(LAUNCH_HOLD_MS);
    expect(LANDING_FADE_MS).toBeGreaterThan(0);
    expect(LAUNCH_FADE_MS).toBeGreaterThan(0);
  });
});
