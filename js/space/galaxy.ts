/**
 * Deterministic galaxy math: seed ↔ position, cell streaming, scan rays.
 *
 * No DOM or Three.js. A 32-bit Feistel permutation maps every
 * seed to a fixed cell + intra-cell offset, so positions are stable forever
 * and cells can enumerate their member seeds without scanning the seed space.
 */

import { clamp, mulberry32 } from "../config.ts";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ShipPose {
  position: Vec3;
  yaw: number;
  pitch: number;
}

export interface PlanetProxySpec {
  seed: number;
  position: Vec3;
  radius: number;
}

export const CELLS_PER_AXIS = 64;
export const CELL_SIZE = 16000;
export const GALAXY_HALF = (CELLS_PER_AXIS * CELL_SIZE) / 2;

/** Seeds surfaced as browsable proxies per cell (of ~16k that live there). */
export const SLOTS_PER_CELL = 2;
/**
 * LOAD_RADIUS below CELL_SIZE keeps the ±1 Moore neighborhood a superset of
 * the load sphere; with 2 slots per cell it averages ~3–4 interactive bodies.
 */
export const LOAD_RADIUS = 12000;
export const UNLOAD_RADIUS = 14000;
export const MAX_LOADED_PROXIES = 16;
/**
 * Far backdrop discs: ceil(HORIZON_LOAD_RADIUS / CELL_SIZE) so the Moore ring
 * still covers the load sphere at cell edges. Unlit / low-poly in the runtime.
 */
export const HORIZON_CELL_RING = 4;
export const HORIZON_LOAD_RADIUS = 56000;
export const HORIZON_UNLOAD_RADIUS = 64000;
export const MAX_HORIZON_PROXIES = 28;
/**
 * Center-distance at/below which proxies read at full brightness. Beyond this
 * they darken smoothly out to {@link HORIZON_UNLOAD_RADIUS}.
 */
export const PROXY_FULL_VISIBILITY_RADIUS = 4000;
/** Floor so the farthest horizon discs stay barely readable before unload. */
export const PROXY_VISIBILITY_FLOOR = 0.06;

export const PROXY_MIN_RADIUS = 320;
export const PROXY_RADIUS_SPAN = 1080;
/** Surface range below which the LAND affordance unlocks. */
export const LAND_RANGE = 1600;
/**
 * Surface standoff that triggers an automatic crash-landing cinematic.
 * Kept well below LAND_RANGE so voluntary E-land stays distinct.
 */
export const CRASH_STANDOFF = 180;

/** Low bits of the permuted value that stay inside one cell. */
const SLOT_BITS = 14;
const FEISTEL_KEYS = [0x9e37, 0x79b9, 0x85eb, 0xca6b] as const;

function feistelRound(half: number, key: number): number {
  return (Math.imul(half ^ key, 0x45d9f3b) >>> 16) & 0xffff;
}

/** Bijective 32-bit scramble; sequential seeds land in unrelated cells. */
export function feistelForward(seed: number): number {
  let left = (seed >>> 16) & 0xffff;
  let right = seed & 0xffff;
  for (const key of FEISTEL_KEYS) {
    const next = left ^ feistelRound(right, key);
    left = right;
    right = next;
  }
  return ((left << 16) | right) >>> 0;
}

export function feistelInverse(value: number): number {
  let left = (value >>> 16) & 0xffff;
  let right = value & 0xffff;
  for (let index = FEISTEL_KEYS.length - 1; index >= 0; index -= 1) {
    const previous = right ^ feistelRound(left, FEISTEL_KEYS[index]!);
    right = left;
    left = previous;
  }
  return ((left << 16) | right) >>> 0;
}

export interface GalaxyCell {
  x: number;
  y: number;
  z: number;
}

export function cellIndexOf(cell: GalaxyCell): number {
  return (cell.x << 12) | (cell.y << 6) | cell.z;
}

export function cellOfSeed(seed: number): GalaxyCell {
  const cellIndex = feistelForward(seed) >>> SLOT_BITS;
  return {
    x: (cellIndex >>> 12) & 63,
    y: (cellIndex >>> 6) & 63,
    z: cellIndex & 63,
  };
}

export function cellContaining(position: Vec3): GalaxyCell {
  const toCell = (value: number): number =>
    clamp(
      Math.floor((value + GALAXY_HALF) / CELL_SIZE),
      0,
      CELLS_PER_AXIS - 1,
    );
  return {
    x: toCell(position.x),
    y: toCell(position.y),
    z: toCell(position.z),
  };
}

function proxyTraits(seed: number): PlanetProxySpec {
  const value = feistelForward(seed);
  const cellIndex = value >>> SLOT_BITS;
  const cellX = (cellIndex >>> 12) & 63;
  const cellY = (cellIndex >>> 6) & 63;
  const cellZ = cellIndex & 63;
  const random = mulberry32(value);
  const offset = (): number => 0.1 + random() * 0.8;
  const axis = (cell: number, within: number): number =>
    -GALAXY_HALF + (cell + within) * CELL_SIZE;
  const position: Vec3 = {
    x: axis(cellX, offset()),
    y: axis(cellY, offset()),
    z: axis(cellZ, offset()),
  };
  const sizeDraw = random();
  return {
    seed,
    position,
    radius:
      PROXY_MIN_RADIUS + sizeDraw * sizeDraw * PROXY_RADIUS_SPAN,
  };
}

export function seedPosition(seed: number): Vec3 {
  return proxyTraits(seed).position;
}

/** Vary nearby proxy sizes by seed. */
export function proxyRadius(seed: number): number {
  return proxyTraits(seed).radius;
}

/** Cell membership follows the Feistel mapping. */
export function candidateSeedsForCell(cell: GalaxyCell): number[] {
  const base = cellIndexOf(cell) << SLOT_BITS;
  const seeds: number[] = [];
  for (let slot = 0; slot < SLOTS_PER_CELL; slot += 1) {
    seeds.push(feistelInverse((base | slot) >>> 0));
  }
  return seeds;
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * 0..1 how clearly a proxy surface should read at a center-to-ship distance.
 * Full nearby; fades toward {@link PROXY_VISIBILITY_FLOOR} at the horizon
 * unload sphere. The runtime maps this onto a black overlay (not surface alpha).
 */
export function proxyDistanceVisibility(distance: number): number {
  if (distance <= PROXY_FULL_VISIBILITY_RADIUS) return 1;
  if (distance >= HORIZON_UNLOAD_RADIUS) return PROXY_VISIBILITY_FLOOR;
  const t =
    (distance - PROXY_FULL_VISIBILITY_RADIUS) /
    (HORIZON_UNLOAD_RADIUS - PROXY_FULL_VISIBILITY_RADIUS);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth * (1 - PROXY_VISIBILITY_FLOOR);
}

/**
 * Opacity of the black tint shell over an opaque planet surface.
 * Near (visibility 1) → transparent; far (visibility floor) → 0.99.
 */
export function proxyDarkOverlayOpacity(visibility: number): number {
  const clamped = Math.max(
    PROXY_VISIBILITY_FLOOR,
    Math.min(1, visibility),
  );
  if (clamped >= 1) return 0;
  return (
    (0.99 * (1 - clamped)) / (1 - PROXY_VISIBILITY_FLOOR)
  );
}

export function surfaceRange(
  shipPosition: Vec3,
  proxy: PlanetProxySpec,
): number {
  return Math.max(
    0,
    distanceBetween(shipPosition, proxy.position) - proxy.radius,
  );
}

function candidateSeedsNear(position: Vec3, ring: number): Set<number> {
  const center = cellContaining(position);
  const seeds = new Set<number>();
  for (let dx = -ring; dx <= ring; dx += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        const cell: GalaxyCell = {
          x: center.x + dx,
          y: center.y + dy,
          z: center.z + dz,
        };
        if (
          cell.x < 0 ||
          cell.y < 0 ||
          cell.z < 0 ||
          cell.x >= CELLS_PER_AXIS ||
          cell.y >= CELLS_PER_AXIS ||
          cell.z >= CELLS_PER_AXIS
        ) {
          continue;
        }
        for (const seed of candidateSeedsForCell(cell)) {
          seeds.add(seed);
        }
      }
    }
  }
  return seeds;
}

function takeNearestProxies(
  proxies: PlanetProxySpec[],
  maxCount: number,
  pinned: ReadonlySet<number>,
): PlanetProxySpec[] {
  if (proxies.length <= maxCount) return proxies;
  const kept = proxies.slice(0, maxCount);
  for (const proxy of proxies.slice(maxCount)) {
    if (pinned.has(proxy.seed)) kept.push(proxy);
  }
  return kept;
}

/**
 * Deterministic bounded set of interactive proxies near a position. Pinned
 * seeds (the planet just left or targeted) are always included regardless of
 * slot. These are the scan / land / crash bodies.
 */
export function proxiesNear(
  position: Vec3,
  pinnedSeeds: readonly number[] = [],
): PlanetProxySpec[] {
  const pinned = new Set(pinnedSeeds.map((seed) => seed >>> 0));
  const seeds = candidateSeedsNear(position, 1);
  for (const seed of pinned) seeds.add(seed);

  const proxies = [...seeds]
    .map(proxyTraits)
    .filter(
      (proxy) =>
        pinned.has(proxy.seed) ||
        distanceBetween(position, proxy.position) <= LOAD_RADIUS,
    )
    .sort(
      (a, b) =>
        distanceBetween(position, a.position) -
        distanceBetween(position, b.position),
    );

  return takeNearestProxies(proxies, MAX_LOADED_PROXIES, pinned);
}

/**
 * Far backdrop proxies within the horizon load sphere. Excludes any seed
 * already held as a near / pinned body so the runtime can draw cheap discs
 * without doubling the interactive shells.
 */
export function horizonProxiesNear(
  position: Vec3,
  excludeSeeds: readonly number[] = [],
): PlanetProxySpec[] {
  const excluded = new Set(excludeSeeds.map((seed) => seed >>> 0));
  const proxies = [...candidateSeedsNear(position, HORIZON_CELL_RING)]
    .map(proxyTraits)
    .filter((proxy) => {
      if (excluded.has(proxy.seed)) return false;
      return distanceBetween(position, proxy.position) <= HORIZON_LOAD_RADIUS;
    })
    .sort(
      (a, b) =>
        distanceBetween(position, a.position) -
        distanceBetween(position, b.position),
    );

  return takeNearestProxies(proxies, MAX_HORIZON_PROXIES, new Set());
}

/**
 * Surface clearance when leaving a planet or spawning beside a seed.
 * Just outside {@link LAND_RANGE} so the body fills the view and LAND is one
 * nudge away.
 */
export const ENTRY_SURFACE_STANDOFF = LAND_RANGE + 280;

/** Center distance used by {@link entryPoseForSeed}. */
export function entryStandoffForRadius(radius: number): number {
  return radius + ENTRY_SURFACE_STANDOFF;
}

/**
 * Ship pose near a seed's proxy: offset away from the galaxy origin with the
 * nose aimed at the body, so it is in view when space resumes.
 */
export function entryPoseForSeed(seed: number): ShipPose {
  const proxy = proxyTraits(seed);
  const length = Math.hypot(
    proxy.position.x,
    proxy.position.y,
    proxy.position.z,
  );
  const away: Vec3 =
    length < 1
      ? { x: 0, y: 1, z: 0 }
      : {
          x: proxy.position.x / length,
          y: proxy.position.y / length,
          z: proxy.position.z / length,
        };
  const standoff = entryStandoffForRadius(proxy.radius);
  const position: Vec3 = {
    x: proxy.position.x + away.x * standoff,
    y: proxy.position.y + away.y * standoff,
    z: proxy.position.z + away.z * standoff,
  };
  // Aim from the ship back toward the planet (Three.js YXZ, -Z forward).
  const toPlanet: Vec3 = {
    x: proxy.position.x - position.x,
    y: proxy.position.y - position.y,
    z: proxy.position.z - position.z,
  };
  const horizontal = Math.hypot(toPlanet.x, toPlanet.z);
  return {
    position,
    yaw: Math.atan2(-toPlanet.x, -toPlanet.z),
    pitch: Math.atan2(toPlanet.y, horizontal),
  };
}

/** Three.js YXZ camera forward is local -Z. */
export function poseForward(pose: ShipPose): Vec3 {
  const cosPitch = Math.cos(pose.pitch);
  return {
    x: -Math.sin(pose.yaw) * cosPitch,
    y: Math.sin(pose.pitch),
    z: -Math.cos(pose.yaw) * cosPitch,
  };
}

/**
 * Nearest proxy hit by a ray (reticle scan). Returns null when the ray
 * misses every bounding sphere.
 */
export function pickProxy(
  origin: Vec3,
  direction: Vec3,
  proxies: readonly PlanetProxySpec[],
): PlanetProxySpec | null {
  let best: PlanetProxySpec | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const proxy of proxies) {
    const toCenterX = proxy.position.x - origin.x;
    const toCenterY = proxy.position.y - origin.y;
    const toCenterZ = proxy.position.z - origin.z;
    const along =
      toCenterX * direction.x +
      toCenterY * direction.y +
      toCenterZ * direction.z;
    if (along <= 0) continue;
    const centerSquared =
      toCenterX * toCenterX +
      toCenterY * toCenterY +
      toCenterZ * toCenterZ;
    const offAxisSquared = centerSquared - along * along;
    if (offAxisSquared > proxy.radius * proxy.radius) continue;
    if (along < bestDistance) {
      bestDistance = along;
      best = proxy;
    }
  }
  return best;
}

/**
 * If the ship path from→to would enter a proxy's safe shell (radius +
 * standoff), return that body and a contact point just outside the surface.
 * Prefers the earliest hit along the segment when several bodies overlap.
 */
export function findCrashLanding(
  from: Vec3,
  to: Vec3,
  proxies: readonly PlanetProxySpec[],
  standoff: number = CRASH_STANDOFF,
): { proxy: PlanetProxySpec; contact: Vec3 } | null {
  let best: { proxy: PlanetProxySpec; contact: Vec3; along: number } | null =
    null;

  for (const proxy of proxies) {
    const hit = segmentSphereContact(from, to, proxy, standoff);
    if (hit === null) continue;
    if (best === null || hit.along < best.along) {
      best = { proxy, contact: hit.contact, along: hit.along };
    }
  }

  return best === null
    ? null
    : { proxy: best.proxy, contact: best.contact };
}

function segmentSphereContact(
  from: Vec3,
  to: Vec3,
  proxy: PlanetProxySpec,
  standoff: number,
): { contact: Vec3; along: number } | null {
  const safeRadius = proxy.radius + standoff;
  const safeRadiusSquared = safeRadius * safeRadius;
  const startOffset = {
    x: from.x - proxy.position.x,
    y: from.y - proxy.position.y,
    z: from.z - proxy.position.z,
  };
  const startDistanceSquared =
    startOffset.x * startOffset.x +
    startOffset.y * startOffset.y +
    startOffset.z * startOffset.z;

  if (startDistanceSquared <= safeRadiusSquared) {
    return {
      contact: pushOutToShell(from, proxy.position, safeRadius),
      along: 0,
    };
  }

  const move = {
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  };
  const moveLengthSquared = move.x * move.x + move.y * move.y + move.z * move.z;
  if (moveLengthSquared < 1e-12) return null;

  // Quadratic ray/sphere: |from + t * move - center|^2 = R^2, t in [0, 1].
  const a = moveLengthSquared;
  const b =
    2 *
    (startOffset.x * move.x +
      startOffset.y * move.y +
      startOffset.z * move.z);
  const c = startDistanceSquared - safeRadiusSquared;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);
  let t = Number.POSITIVE_INFINITY;
  if (t0 >= 0 && t0 <= 1) t = t0;
  if (t1 >= 0 && t1 <= 1 && t1 < t) t = t1;
  if (!Number.isFinite(t)) return null;

  const contactPoint: Vec3 = {
    x: from.x + move.x * t,
    y: from.y + move.y * t,
    z: from.z + move.z * t,
  };
  return {
    contact: pushOutToShell(contactPoint, proxy.position, safeRadius),
    along: t * Math.sqrt(moveLengthSquared),
  };
}

function pushOutToShell(
  point: Vec3,
  center: Vec3,
  safeRadius: number,
): Vec3 {
  const offset = {
    x: point.x - center.x,
    y: point.y - center.y,
    z: point.z - center.z,
  };
  const length = Math.hypot(offset.x, offset.y, offset.z);
  if (length < 1e-6) {
    return { x: center.x, y: center.y + safeRadius, z: center.z };
  }
  const scale = safeRadius / length;
  return {
    x: center.x + offset.x * scale,
    y: center.y + offset.y * scale,
    z: center.z + offset.z * scale,
  };
}
