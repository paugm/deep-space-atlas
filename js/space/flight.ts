/**
 * Pure cockpit flight integration: slow inertial cruise with optional
 * jetpack-style boost (limited burn, then recharge).
 */

export const IDLE_FORWARD_ACCELERATION = 55;
export const THRUST_ACCELERATION = 140;
export const BRAKE_ACCELERATION = 180;
export const STRAFE_ACCELERATION = 95;
export const VERTICAL_ACCELERATION = 85;
/** Survey cruise speed that leaves nearby bodies readable. */
export const CRUISE_SPEED = 220;
/** Peak speed while boost fuel remains. */
export const BOOST_SPEED = 980;
export const BOOST_ACCELERATION = 520;
/** Seconds of continuous boost from a full tank. */
export const BOOST_BURN_SECONDS = 3.0;
/** Seconds to refill an empty boost tank while not boosting. */
export const BOOST_RECHARGE_SECONDS = 3.6;
/** Damps speed along the current velocity (gentle coast). */
export const LONGITUDINAL_DRAG = 0.55;
/** Damps sideways slip harder so the nose leads the motion. */
export const LATERAL_DRAG = 2.8;

export interface FlightAxes {
  forward: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
}

export interface FlightInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  /** Player is holding boost; actual boost applies only when fuel remains. */
  boost: boolean;
}

export interface FlightState {
  vx: number;
  vy: number;
  vz: number;
}

export interface FlightStepResult {
  velocity: FlightState;
  speed: number;
  thrustIntensity: number;
  speedRatio: number;
  accelerating: boolean;
  boosting: boolean;
}

export interface BoostFuelStepResult {
  fuel: number;
  boosting: boolean;
}

export function stepBoostFuel(options: {
  fuel: number;
  wantsBoost: boolean;
  deltaTime: number;
  burnSeconds?: number;
  rechargeSeconds?: number;
}): BoostFuelStepResult {
  const burnSeconds = options.burnSeconds ?? BOOST_BURN_SECONDS;
  const rechargeSeconds = options.rechargeSeconds ?? BOOST_RECHARGE_SECONDS;
  let fuel = options.fuel;
  const boosting = options.wantsBoost && fuel > 0;
  if (boosting) {
    fuel = Math.max(0, fuel - options.deltaTime / burnSeconds);
  } else {
    fuel = Math.min(1, fuel + options.deltaTime / rechargeSeconds);
  }
  return { fuel, boosting };
}

export function integrateFlight(options: {
  velocity: FlightState;
  axes: FlightAxes;
  input: FlightInput;
  deltaTime: number;
  boosting?: boolean;
}): FlightStepResult {
  const { axes, input, deltaTime } = options;
  const boosting = options.boosting ?? false;
  let { vx, vy, vz } = options.velocity;
  const maxSpeed = boosting ? BOOST_SPEED : CRUISE_SPEED;

  let ax = 0;
  let ay = 0;
  let az = 0;
  let commandedThrust = 0;

  // Default cruise: ship always eases forward along the nose.
  if (!input.back) {
    ax += axes.forward.x * IDLE_FORWARD_ACCELERATION;
    ay += axes.forward.y * IDLE_FORWARD_ACCELERATION;
    az += axes.forward.z * IDLE_FORWARD_ACCELERATION;
    commandedThrust += IDLE_FORWARD_ACCELERATION;
  }

  if (input.forward) {
    ax += axes.forward.x * THRUST_ACCELERATION;
    ay += axes.forward.y * THRUST_ACCELERATION;
    az += axes.forward.z * THRUST_ACCELERATION;
    commandedThrust += THRUST_ACCELERATION;
  }
  if (boosting) {
    ax += axes.forward.x * BOOST_ACCELERATION;
    ay += axes.forward.y * BOOST_ACCELERATION;
    az += axes.forward.z * BOOST_ACCELERATION;
    commandedThrust += BOOST_ACCELERATION;
  }
  if (input.back) {
    ax -= axes.forward.x * BRAKE_ACCELERATION;
    ay -= axes.forward.y * BRAKE_ACCELERATION;
    az -= axes.forward.z * BRAKE_ACCELERATION;
    commandedThrust += BRAKE_ACCELERATION * 0.65;
  }
  if (input.right) {
    ax += axes.right.x * STRAFE_ACCELERATION;
    az += axes.right.z * STRAFE_ACCELERATION;
    commandedThrust += STRAFE_ACCELERATION * 0.45;
  }
  if (input.left) {
    ax -= axes.right.x * STRAFE_ACCELERATION;
    az -= axes.right.z * STRAFE_ACCELERATION;
    commandedThrust += STRAFE_ACCELERATION * 0.45;
  }
  if (input.up) {
    ay += VERTICAL_ACCELERATION;
    commandedThrust += VERTICAL_ACCELERATION * 0.45;
  }

  vx += ax * deltaTime;
  vy += ay * deltaTime;
  vz += az * deltaTime;

  // Split velocity into nose-aligned and lateral components for drag.
  const forwardDot =
    vx * axes.forward.x + vy * axes.forward.y + vz * axes.forward.z;
  const alongX = axes.forward.x * forwardDot;
  const alongY = axes.forward.y * forwardDot;
  const alongZ = axes.forward.z * forwardDot;
  let lateralX = vx - alongX;
  let lateralY = vy - alongY;
  let lateralZ = vz - alongZ;

  const longFactor = Math.exp(-LONGITUDINAL_DRAG * deltaTime);
  const latFactor = Math.exp(-LATERAL_DRAG * deltaTime);
  lateralX *= latFactor;
  lateralY *= latFactor;
  lateralZ *= latFactor;

  vx = alongX * longFactor + lateralX;
  vy = alongY * longFactor + lateralY;
  vz = alongZ * longFactor + lateralZ;

  let speed = Math.hypot(vx, vy, vz);
  if (speed > maxSpeed && speed > 0) {
    const scale = maxSpeed / speed;
    vx *= scale;
    vy *= scale;
    vz *= scale;
    speed = maxSpeed;
  }

  const peakThrust =
    IDLE_FORWARD_ACCELERATION + THRUST_ACCELERATION + BOOST_ACCELERATION;
  const thrustIntensity = Math.min(1, commandedThrust / peakThrust);
  const speedRatio = Math.min(1, speed / maxSpeed);
  const accelerating =
    input.forward ||
    input.back ||
    input.left ||
    input.right ||
    input.up ||
    boosting ||
    speedRatio > 0.08;

  return {
    velocity: { vx, vy, vz },
    speed,
    thrustIntensity,
    speedRatio,
    accelerating,
    boosting,
  };
}

/** Seed velocity so entering space already coasts forward. */
export function initialCruiseVelocity(axes: FlightAxes): FlightState {
  const speed = CRUISE_SPEED * 0.7;
  return {
    vx: axes.forward.x * speed,
    vy: axes.forward.y * speed,
    vz: axes.forward.z * speed,
  };
}

/** Map speed/thrust into a 0..1 visual intensity for FOV widen and bob. */
export function flightEffectIntensity(
  speedRatio: number,
  thrustIntensity: number,
  boosting = false,
): number {
  const base = Math.min(1, speedRatio * 0.72 + thrustIntensity * 0.55);
  return Math.min(1, base + (boosting ? 0.2 : 0));
}

export interface FlightCameraShake {
  bobY: number;
  /** Extra pitch jitter in radians (boost punch; no lateral roll). */
  pitchJitter: number;
}

/**
 * Cockpit rumble from flight intensity. Vertical bob carries cruise speed;
 * boost adds a faster pitch micro-shake so the burn is felt without wobble.
 */
export function flightCameraShake(options: {
  intensity: number;
  phase: number;
  boosting?: boolean;
  bobMax?: number;
  pitchMax?: number;
}): FlightCameraShake {
  const intensity = Math.max(0, Math.min(1, options.intensity));
  const bobMax = options.bobMax ?? 0.085;
  const pitchMax = options.pitchMax ?? 0.014;
  const boosting = options.boosting ?? false;
  const bobY =
    intensity * bobMax * (0.55 * Math.sin(options.phase * 2.3) +
      0.25 * Math.sin(options.phase * 5.1));
  const pitchJitter = boosting
    ? intensity *
      pitchMax *
      (0.65 * Math.sin(options.phase * 11.0) +
        0.35 * Math.sin(options.phase * 17.3))
    : intensity * pitchMax * 0.2 * Math.sin(options.phase * 7.0);
  return { bobY, pitchJitter };
}
