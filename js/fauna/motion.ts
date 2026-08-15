import { WALK_SPEED } from "../config.ts";

export const FAUNA_WALK_SPEED = 5.2;
/** Slower than on-foot walk so the player can pull ahead. */
export const PET_FOLLOW_SPEED = WALK_SPEED * 0.72;
export const FAUNA_FOLLOW_STOP_DISTANCE = 2.6;
export const FAUNA_WANDER_RADIUS = 14;
export const FAUNA_WANDER_PAUSE_MIN = 1.4;
export const FAUNA_WANDER_PAUSE_MAX = 3.8;
export const PET_GREET_SECONDS = 2.2;
export const PET_SPAWN_OFFSET = 3.6;
export const TAME_TIME = 1.35;
/** Hold-extract on your pet to enlist them as traveling crew. */
export const ENLIST_TIME = 1.2;

export interface Pose2 {
  x: number;
  z: number;
  yaw: number;
}

export interface FollowStepInput {
  pose: Pose2;
  targetX: number;
  targetZ: number;
  deltaTime: number;
  walkSpeed?: number;
  stopDistance?: number;
}

export interface FollowStepResult {
  pose: Pose2;
  moving: boolean;
}

/**
 * Walk toward the target at a fixed speed. If the player is far away, the pet
 * keeps walking toward them instead of teleporting.
 */
export function stepFollow(input: FollowStepInput): FollowStepResult {
  const walkSpeed = input.walkSpeed ?? PET_FOLLOW_SPEED;
  const stopDistance = input.stopDistance ?? FAUNA_FOLLOW_STOP_DISTANCE;

  const dx = input.targetX - input.pose.x;
  const dz = input.targetZ - input.pose.z;
  const distance = Math.hypot(dx, dz);
  const faceYaw = distance > 1e-6 ? Math.atan2(dx, dz) : input.pose.yaw;

  if (distance <= stopDistance) {
    return {
      pose: {
        x: input.pose.x,
        z: input.pose.z,
        yaw: turnToward(input.pose.yaw, faceYaw, input.deltaTime * 4),
      },
      moving: false,
    };
  }

  const step = Math.min(
    Math.max(0, distance - stopDistance * 0.35),
    walkSpeed * input.deltaTime,
  );
  const inv = 1 / distance;
  return {
    pose: {
      x: input.pose.x + dx * inv * step,
      z: input.pose.z + dz * inv * step,
      yaw: turnToward(input.pose.yaw, faceYaw, input.deltaTime * 8),
    },
    moving: true,
  };
}

export interface WanderStepInput {
  pose: Pose2;
  goalX: number;
  goalZ: number;
  pauseRemaining: number;
  deltaTime: number;
  random: () => number;
  homeX: number;
  homeZ: number;
  walkSpeed?: number;
  wanderRadius?: number;
}

export interface WanderStepResult {
  pose: Pose2;
  goalX: number;
  goalZ: number;
  pauseRemaining: number;
  moving: boolean;
}

export function stepWander(input: WanderStepInput): WanderStepResult {
  const walkSpeed = input.walkSpeed ?? FAUNA_WALK_SPEED;
  const wanderRadius = input.wanderRadius ?? FAUNA_WANDER_RADIUS;

  if (input.pauseRemaining > 0) {
    return {
      pose: input.pose,
      goalX: input.goalX,
      goalZ: input.goalZ,
      pauseRemaining: Math.max(0, input.pauseRemaining - input.deltaTime),
      moving: false,
    };
  }

  const dx = input.goalX - input.pose.x;
  const dz = input.goalZ - input.pose.z;
  const distance = Math.hypot(dx, dz);

  if (distance < 0.6) {
    const next = pickWanderGoal(
      input.homeX,
      input.homeZ,
      wanderRadius,
      input.random,
    );
    const pause =
      FAUNA_WANDER_PAUSE_MIN +
      input.random() * (FAUNA_WANDER_PAUSE_MAX - FAUNA_WANDER_PAUSE_MIN);
    return {
      pose: input.pose,
      goalX: next.x,
      goalZ: next.z,
      pauseRemaining: pause,
      moving: false,
    };
  }

  const step = Math.min(distance, walkSpeed * 0.72 * input.deltaTime);
  const inv = 1 / distance;
  const faceYaw = Math.atan2(dx, dz);
  return {
    pose: {
      x: input.pose.x + dx * inv * step,
      z: input.pose.z + dz * inv * step,
      yaw: turnToward(input.pose.yaw, faceYaw, input.deltaTime * 6),
    },
    goalX: input.goalX,
    goalZ: input.goalZ,
    pauseRemaining: 0,
    moving: true,
  };
}

export function pickWanderGoal(
  homeX: number,
  homeZ: number,
  radius: number,
  random: () => number,
): { x: number; z: number } {
  const angle = random() * Math.PI * 2;
  const dist = random() * radius;
  return {
    x: homeX + Math.cos(angle) * dist,
    z: homeZ + Math.sin(angle) * dist,
  };
}

export function petWaitPose(
  spawnX: number,
  spawnZ: number,
  random: () => number,
): Pose2 {
  const angle = random() * Math.PI * 2;
  return {
    x: spawnX + Math.cos(angle) * PET_SPAWN_OFFSET,
    z: spawnZ + Math.sin(angle) * PET_SPAWN_OFFSET,
    yaw: angle + Math.PI,
  };
}

function turnToward(current: number, target: number, maxDelta: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
