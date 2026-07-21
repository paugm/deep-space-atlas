/**
 * Pure timing curves for the land / launch cinematics. Everything here is a
 * deterministic function of elapsed time so the sequences stay testable
 * without Three.js or the DOM.
 */

/**
 * Landing: the player's hull detaches and dives at the planet in third
 * person for the hold, then the screen fades to black for the hard cut.
 */
export const LANDING_HOLD_MS = 2400;
export const LANDING_FADE_MS = 500;

/**
 * Launch: cockpit view rockets skyward with shake for the hold, then the
 * screen fades to black (space is black) for the hard cut.
 */
export const LAUNCH_HOLD_MS = 1600;
export const LAUNCH_FADE_MS = 400;

const LAUNCH_ACCELERATION = 240;
const LAUNCH_PITCH_UP = 0.4;
const LAUNCH_PITCH_RAMP_S = 0.9;
const LAUNCH_SHAKE_METERS = 0.18;
const LAUNCH_SHAKE_RAMP_S = 0.35;

/** Fraction of the landing hold after which the hull shrinks away. */
const LANDING_SHRINK_START = 0.82;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface LandingShipState {
  distance: number;
  /** Uniform hull scale: 1 while flying, easing to 0 as it "touches down". */
  scale: number;
}

/**
 * Third-person departure: ease-in so the hull pulls away slowly, then covers
 * the full travel distance super fast by the end of the hold. The extra
 * scale shrink guarantees the "saw it land and disappear" read even on short
 * crash-landing distances where perspective alone barely shrinks the hull.
 */
export function landingShipState(
  elapsedMs: number,
  travelDistance: number,
): LandingShipState {
  const t = clamp01(elapsedMs / LANDING_HOLD_MS);
  const progress = t * t * t;
  const shrink = clamp01(
    (t - LANDING_SHRINK_START) / (1 - LANDING_SHRINK_START),
  );
  return {
    distance: travelDistance * progress,
    scale: 1 - shrink,
  };
}

export interface LaunchAscentState {
  altitude: number;
  pitch: number;
  /** Vertical rumble offset in meters. Lateral shake reads wrong here. */
  offsetY: number;
}

/** Cockpit ascent: constant hard acceleration with rumble that ramps in. */
export function launchAscentState(elapsedMs: number): LaunchAscentState {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const ramp = clamp01(seconds / LAUNCH_SHAKE_RAMP_S);
  return {
    altitude: 0.5 * LAUNCH_ACCELERATION * seconds * seconds,
    pitch: LAUNCH_PITCH_UP * clamp01(seconds / LAUNCH_PITCH_RAMP_S),
    offsetY: LAUNCH_SHAKE_METERS * ramp * Math.sin(seconds * 47),
  };
}
