/**
 * Pet HUD compass math. Bearing is relative to look yaw
 * (0 = ahead, +π/2 = right).
 */

export interface PetCompassReading {
  distance: number;
  bearing: number;
  label: string;
}

export function computePetCompass(options: {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  petX: number;
  petZ: number;
  label: string;
}): PetCompassReading {
  const dx = options.petX - options.playerX;
  const dz = options.petZ - options.playerZ;
  const distance = Math.hypot(dx, dz);
  const worldBearing = distance > 1e-6 ? Math.atan2(dx, dz) : 0;
  return {
    distance,
    bearing: normalizeAngle(worldBearing - options.playerYaw),
    label: options.label,
  };
}

export function formatPetDistance(distance: number): string {
  if (distance < 10) return `${distance.toFixed(1)} m`;
  return `${Math.round(distance)} m`;
}

function normalizeAngle(radians: number): number {
  let value = radians;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value <= -Math.PI) value += Math.PI * 2;
  return value;
}
