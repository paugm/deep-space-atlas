import * as THREE from "three";

/** Callers own dispose of cloned geometry. */

export interface ProxyBandColors {
  pole: THREE.Color;
  temperate: THREE.Color;
  equator: THREE.Color;
}

const colorScratch = new THREE.Color();

/**
 * Unit-sphere Y (−1..1) → band color. Equator at Y≈0, poles at |Y|→1.
 */
export function spaceProxyColorAtLatitude(
  unitY: number,
  bands: ProxyBandColors,
  output: THREE.Color = colorScratch,
): THREE.Color {
  const absY = Math.min(1, Math.abs(unitY));
  if (absY < 0.42) {
    return output
      .copy(bands.equator)
      .lerp(bands.temperate, absY / 0.42);
  }
  return output
    .copy(bands.temperate)
    .lerp(bands.pole, (absY - 0.42) / 0.58);
}

/** Write a `color` attribute from unit-sphere positions (call on a clone). */
export function paintLatitudeVertexColors(
  geometry: THREE.BufferGeometry,
  bands: ProxyBandColors,
): void {
  const positions = geometry.getAttribute("position");
  if (!(positions instanceof THREE.BufferAttribute)) {
    throw new Error("Proxy geometry is missing a position attribute.");
  }
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    spaceProxyColorAtLatitude(positions.getY(index), bands, colorScratch);
    colors[index * 3] = colorScratch.r;
    colors[index * 3 + 1] = colorScratch.g;
    colors[index * 3 + 2] = colorScratch.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}
