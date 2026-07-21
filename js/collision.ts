/**
 * Lightweight static solid resolution for the planet character capsule.
 * No physics engine, just spheres and AABBs (rocks / lander hull).
 */

import { PLAYER_COLLISION_ITERATIONS, PLAYER_RADIUS } from "./config.ts";

export interface CapsulePose {
  /** Eye-space position (same as gameplay player.position). */
  x: number;
  y: number;
  z: number;
  radius: number;
  eyeHeight: number;
}

export interface SphereCollider {
  kind: "sphere";
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface AabbCollider {
  kind: "aabb";
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export type SolidCollider = SphereCollider | AabbCollider;

export interface CapsuleResolveResult {
  x: number;
  y: number;
  z: number;
  correctionX: number;
  correctionY: number;
  correctionZ: number;
}

interface CapsuleSegment {
  x: number;
  z: number;
  bottomY: number;
  topY: number;
  radius: number;
}

function capsuleSegment(pose: CapsulePose): CapsuleSegment {
  const feetY = pose.y - pose.eyeHeight;
  const bottomY = feetY + pose.radius;
  const topY = Math.max(bottomY, pose.y - pose.radius);
  return {
    x: pose.x,
    z: pose.z,
    bottomY,
    topY,
    radius: pose.radius,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function syncSegment(segment: CapsuleSegment, pose: CapsulePose): void {
  segment.x = pose.x;
  segment.z = pose.z;
  segment.bottomY = pose.y - pose.eyeHeight + pose.radius;
  segment.topY = Math.max(segment.bottomY, pose.y - pose.radius);
}

/** Y on the capsule segment closest to the AABB's vertical extent. */
function segmentYTowardAabb(
  segment: CapsuleSegment,
  minY: number,
  maxY: number,
): number {
  if (segment.bottomY > maxY) return segment.bottomY;
  if (segment.topY < minY) return segment.topY;
  return clamp((minY + maxY) * 0.5, segment.bottomY, segment.topY);
}

function pushFromSurface(
  fromX: number,
  fromY: number,
  fromZ: number,
  surfaceX: number,
  surfaceY: number,
  surfaceZ: number,
  radius: number,
): { dx: number; dy: number; dz: number } | null {
  const offsetX = fromX - surfaceX;
  const offsetY = fromY - surfaceY;
  const offsetZ = fromZ - surfaceZ;
  const distanceSquared =
    offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
  if (distanceSquared >= radius * radius) return null;

  if (distanceSquared < 1e-10) {
    return { dx: 0, dy: radius, dz: 0 };
  }

  const distance = Math.sqrt(distanceSquared);
  const scale = (radius - distance) / distance;
  return {
    dx: offsetX * scale,
    dy: offsetY * scale,
    dz: offsetZ * scale,
  };
}

function resolveSphere(
  segment: CapsuleSegment,
  solid: SphereCollider,
): { dx: number; dy: number; dz: number } | null {
  const sampleY = clamp(solid.y, segment.bottomY, segment.topY);
  return pushFromSurface(
    segment.x,
    sampleY,
    segment.z,
    solid.x,
    solid.y,
    solid.z,
    segment.radius + solid.radius,
  );
}

function resolveAabb(
  segment: CapsuleSegment,
  solid: AabbCollider,
): { dx: number; dy: number; dz: number } | null {
  const sampleY = segmentYTowardAabb(segment, solid.minY, solid.maxY);
  const surfaceX = clamp(segment.x, solid.minX, solid.maxX);
  const surfaceY = clamp(sampleY, solid.minY, solid.maxY);
  const surfaceZ = clamp(segment.z, solid.minZ, solid.maxZ);

  const inside =
    segment.x >= solid.minX &&
    segment.x <= solid.maxX &&
    sampleY >= solid.minY &&
    sampleY <= solid.maxY &&
    segment.z >= solid.minZ &&
    segment.z <= solid.maxZ;

  if (inside) {
    const toMinX = segment.x - solid.minX;
    const toMaxX = solid.maxX - segment.x;
    const toMinY = sampleY - solid.minY;
    const toMaxY = solid.maxY - sampleY;
    const toMinZ = segment.z - solid.minZ;
    const toMaxZ = solid.maxZ - segment.z;
    const smallest = Math.min(
      toMinX,
      toMaxX,
      toMinY,
      toMaxY,
      toMinZ,
      toMaxZ,
    );
    if (smallest === toMinX) {
      return { dx: -(toMinX + segment.radius), dy: 0, dz: 0 };
    }
    if (smallest === toMaxX) {
      return { dx: toMaxX + segment.radius, dy: 0, dz: 0 };
    }
    if (smallest === toMinY) {
      return { dx: 0, dy: -(toMinY + segment.radius), dz: 0 };
    }
    if (smallest === toMaxY) {
      return { dx: 0, dy: toMaxY + segment.radius, dz: 0 };
    }
    if (smallest === toMinZ) {
      return { dx: 0, dy: 0, dz: -(toMinZ + segment.radius) };
    }
    return { dx: 0, dy: 0, dz: toMaxZ + segment.radius };
  }

  return pushFromSurface(
    segment.x,
    sampleY,
    segment.z,
    surfaceX,
    surfaceY,
    surfaceZ,
    segment.radius,
  );
}

/**
 * Iteratively push an eye-space capsule out of static solids.
 * Returns the resolved pose and total correction (for velocity sliding).
 */
export function resolveCapsuleAgainstSolids(
  pose: CapsulePose,
  solids: readonly SolidCollider[],
  iterations: number = PLAYER_COLLISION_ITERATIONS,
): CapsuleResolveResult {
  const working: CapsulePose = {
    x: pose.x,
    y: pose.y,
    z: pose.z,
    radius: pose.radius > 0 ? pose.radius : PLAYER_RADIUS,
    eyeHeight: pose.eyeHeight,
  };
  const startX = working.x;
  const startY = working.y;
  const startZ = working.z;
  const segment = capsuleSegment(working);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let moved = false;
    syncSegment(segment, working);
    for (const solid of solids) {
      let push: { dx: number; dy: number; dz: number } | null = null;
      switch (solid.kind) {
        case "sphere":
          push = resolveSphere(segment, solid);
          break;
        case "aabb":
          push = resolveAabb(segment, solid);
          break;
        default: {
          const exhaustive: never = solid;
          throw new Error(`Unknown collider: ${String(exhaustive)}`);
        }
      }
      if (push === null) continue;
      working.x += push.dx;
      working.y += push.dy;
      working.z += push.dz;
      syncSegment(segment, working);
      moved = true;
    }
    if (!moved) break;
  }

  return {
    x: working.x,
    y: working.y,
    z: working.z,
    correctionX: working.x - startX,
    correctionY: working.y - startY,
    correctionZ: working.z - startZ,
  };
}

/** Remove velocity component that points into a collision correction. */
export function slideVelocityFromCorrection(
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  correctionX: number,
  correctionY: number,
  correctionZ: number,
): { x: number; y: number; z: number } {
  const lengthSquared =
    correctionX * correctionX +
    correctionY * correctionY +
    correctionZ * correctionZ;
  if (lengthSquared < 1e-10) {
    return { x: velocityX, y: velocityY, z: velocityZ };
  }
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  const normalX = correctionX * inverseLength;
  const normalY = correctionY * inverseLength;
  const normalZ = correctionZ * inverseLength;
  const into =
    velocityX * normalX + velocityY * normalY + velocityZ * normalZ;
  if (into >= 0) {
    return { x: velocityX, y: velocityY, z: velocityZ };
  }
  return {
    x: velocityX - normalX * into,
    y: velocityY - normalY * into,
    z: velocityZ - normalZ * into,
  };
}
