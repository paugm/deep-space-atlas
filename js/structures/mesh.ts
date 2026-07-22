/**
 * Procedural meshes for field structures (no external assets).
 * Shelter shells render from the same layout recipe as collision
 * (`shelter.ts`), so the visible walls and door match what blocks you.
 */

import * as THREE from "three";

import type { BlueprintId } from "../blueprints.ts";
import {
  shelterLayoutFor,
  type ShelterLayout,
} from "./shelter.ts";

export function createStructureMesh(blueprintId: BlueprintId): THREE.Group {
  switch (blueprintId) {
    case "beacon":
      return createBeaconMesh();
    case "tent":
      return createTentMesh();
    case "planet-base":
      return createPlanetBaseMesh();
    default: {
      const exhaustive: never = blueprintId;
      throw new Error(`Unknown structure mesh: ${String(exhaustive)}`);
    }
  }
}

function standard(
  color: number,
  options: {
    metalness?: number;
    roughness?: number;
    emissive?: number;
    emissiveIntensity?: number;
  } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.1,
    roughness: options.roughness ?? 0.85,
    ...(options.emissive !== undefined
      ? {
          emissive: options.emissive,
          emissiveIntensity: options.emissiveIntensity ?? 1,
        }
      : {}),
  });
}

function addBox(
  root: THREE.Group,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  rotation: { x?: number; y?: number; z?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addCylinder(
  root: THREE.Group,
  material: THREE.Material,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  rotation: { x?: number; y?: number; z?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 8),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  mesh.castShadow = true;
  root.add(mesh);
  return mesh;
}

function addLocalBox(
  root: THREE.Group,
  material: THREE.Material,
  box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
): void {
  addBox(
    root,
    material,
    box.maxX - box.minX,
    box.maxY - box.minY,
    box.maxZ - box.minZ,
    (box.minX + box.maxX) * 0.5,
    (box.minY + box.maxY) * 0.5,
    (box.minZ + box.maxZ) * 0.5,
  );
}

/** Thin cylinder from `from` to `to` (guy ropes, struts). */
function addRod(
  root: THREE.Group,
  material: THREE.Material,
  radius: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length < 1e-4) return;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 6),
    material,
  );
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  root.add(mesh);
}

/**
 * Render the collision wall boxes. The buried foundation is hidden by the
 * plinth and the flat collision ceiling is replaced by each shelter's roof,
 * so walls are clipped to ground level and the ceiling entry is skipped.
 */
function addShellWalls(
  root: THREE.Group,
  layout: ShelterLayout,
  material: THREE.Material,
): void {
  for (const wall of layout.walls) {
    if (wall.minY >= layout.wallHeight) continue; // ceiling
    const minY = Math.max(wall.minY, 0);
    const height = wall.maxY - minY;
    if (height <= 0) continue; // fully buried (door sill)
    addBox(
      root,
      material,
      wall.maxX - wall.minX,
      height,
      wall.maxZ - wall.minZ,
      (wall.minX + wall.maxX) * 0.5,
      minY + height * 0.5,
      (wall.minZ + wall.maxZ) * 0.5,
    );
  }
}

/** Solid pedestal from the floor down; covers terrain gaps on slopes. */
function addPlinth(
  root: THREE.Group,
  layout: ShelterLayout,
  material: THREE.Material,
): void {
  const lip = 0.12;
  addBox(
    root,
    material,
    layout.halfWidth * 2 + lip,
    layout.foundationDepth,
    layout.halfDepth * 2 + lip,
    0,
    -layout.foundationDepth * 0.5,
    0,
  );
}

function createBeaconMesh(): THREE.Group {
  const root = new THREE.Group();
  const mast = standard(0x2a3a34, { metalness: 0.55, roughness: 0.45 });
  const band = standard(0x4a6a5c, { metalness: 0.4, roughness: 0.5 });
  const lampMaterial = standard(0x7cffb2, {
    metalness: 0.2,
    roughness: 0.35,
    emissive: 0x2a8f5c,
    emissiveIntensity: 1.4,
  });

  addCylinder(root, mast, 0.08, 0.11, 2.2, 0, 1.1, 0);
  addCylinder(root, band, 0.28, 0.34, 0.12, 0, 0.06, 0);
  addCylinder(root, band, 0.14, 0.14, 0.1, 0, 1.85, 0);

  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    lampMaterial,
  );
  lamp.position.y = 2.2;
  root.add(lamp);

  const light = new THREE.PointLight(0x7cffb2, 0.55, 14, 2);
  light.position.y = 2.2;
  root.add(light);

  return root;
}

/**
 * Expedition ridge tent: canvas shell, gabled roof sloping down and outward,
 * rolled-open door flaps, guy ropes staked around it, and a porch tarp.
 */
function createTentMesh(): THREE.Group {
  const layout = requireShelterLayout("tent");
  const root = new THREE.Group();

  const canvas = standard(0x97865c, { roughness: 0.92 });
  const canvasDark = standard(0x6d5f41, { roughness: 0.94 });
  const wood = standard(0x4a3c2a, { roughness: 0.8, metalness: 0.05 });
  const tarp = standard(0x474033, { roughness: 0.96 });
  const earth = standard(0x33302a, { roughness: 1 });
  const rope = standard(0xcfc3a0, { roughness: 0.9 });

  const { halfWidth, halfDepth, wallHeight, doorWidth } = layout;
  const rise = 0.75;
  const ridgeY = wallHeight + rise;

  addPlinth(root, layout, earth);
  addShellWalls(root, layout, canvas);

  // Floor tarp and porch pad in front of the door.
  addBox(root, tarp, halfWidth * 2 - 0.08, 0.05, halfDepth * 2 - 0.08, 0, 0.025, 0);
  addBox(
    root,
    tarp,
    doorWidth + 0.4,
    0.05,
    layout.porchDepth,
    0,
    0.025,
    halfDepth + layout.porchDepth * 0.5,
  );

  // Gabled roof: panels slope DOWN from the ridge toward each eave.
  const slopeLength = Math.hypot(halfWidth, rise);
  const overhang = 0.3;
  const panelLength = slopeLength + overhang;
  const roofDepth = halfDepth * 2 + 0.5;
  for (const side of [-1, 1]) {
    const directionX = (side * halfWidth) / slopeLength;
    const directionY = -rise / slopeLength;
    const alongMid = panelLength * 0.5 - 0.06;
    addBox(
      root,
      canvasDark,
      panelLength,
      0.06,
      roofDepth,
      directionX * alongMid,
      ridgeY + directionY * alongMid,
      0,
      { z: Math.atan2(directionY, directionX) + (side < 0 ? Math.PI : 0) },
    );
  }

  // Gable triangles close the roof above the front and back walls.
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-halfWidth, wallHeight);
  gableShape.lineTo(halfWidth, wallHeight);
  gableShape.lineTo(0, ridgeY);
  gableShape.closePath();
  const gableGeometry = new THREE.ExtrudeGeometry(gableShape, {
    depth: 0.05,
    bevelEnabled: false,
  });
  for (const z of [halfDepth - 0.06, -halfDepth + 0.01]) {
    const gable = new THREE.Mesh(gableGeometry, canvasDark);
    gable.position.z = z;
    gable.castShadow = true;
    root.add(gable);
  }

  // Ridge pole and back support pole (front stays clear for the door).
  addBox(root, wood, 0.08, 0.08, halfDepth * 2 + 0.55, 0, ridgeY, 0);
  addCylinder(root, wood, 0.05, 0.06, ridgeY, 0, ridgeY * 0.5, -halfDepth + 0.16);

  // Rolled-open door flaps: vertical rolls at the jambs, one above the door.
  const doorHalf = doorWidth * 0.5;
  for (const side of [-1, 1]) {
    addCylinder(
      root,
      canvasDark,
      0.08,
      0.08,
      layout.doorHeight - 0.1,
      side * (doorHalf + 0.09),
      (layout.doorHeight - 0.1) * 0.5,
      halfDepth - 0.02,
    );
  }
  addCylinder(root, canvasDark, 0.07, 0.07, doorWidth + 0.3, 0, layout.doorHeight + 0.08, halfDepth - 0.02, {
    z: Math.PI / 2,
  });

  // Guy ropes from the eaves to stakes.
  for (const sideX of [-1, 1]) {
    for (const sideZ of [-1, 1]) {
      const eave = new THREE.Vector3(
        sideX * (halfWidth + 0.15),
        wallHeight - 0.05,
        sideZ * (halfDepth - 0.35),
      );
      const stake = new THREE.Vector3(
        sideX * (halfWidth + 1.05),
        -0.25,
        sideZ * (halfDepth + 0.35),
      );
      addRod(root, rope, 0.015, eave, stake);
      addCylinder(root, wood, 0.03, 0.02, 0.4, stake.x, 0.05, stake.z, {
        z: sideX * 0.35,
      });
    }
  }

  // Warm lantern hanging from the back of the ridge.
  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    standard(0xffd9a0, { emissive: 0xcf9440, emissiveIntensity: 1.3 }),
  );
  lantern.position.set(0, wallHeight - 0.25, -halfDepth + 0.55);
  root.add(lantern);
  const light = new THREE.PointLight(0xffc98a, 0.5, 7, 2);
  light.position.copy(lantern.position);
  root.add(light);

  return root;
}

/**
 * Planet base: raised hab module with corner pillars, portholes, roof gear
 * (dome, antenna, solar panel), a lit doorway, porch deck, and bunk inside.
 */
function createPlanetBaseMesh(): THREE.Group {
  const layout = requireShelterLayout("planet-base");
  const root = new THREE.Group();

  const hull = standard(0x333f3b, { metalness: 0.45, roughness: 0.55 });
  const hullDark = standard(0x232c29, { metalness: 0.5, roughness: 0.6 });
  const trim = standard(0x3d7a62, { metalness: 0.35, roughness: 0.45 });
  const deck = standard(0x2a3330, { metalness: 0.3, roughness: 0.7 });
  const glow = standard(0x7cffb2, {
    metalness: 0.2,
    roughness: 0.4,
    emissive: 0x1f6a48,
    emissiveIntensity: 1.1,
  });
  const windowGlass = standard(0x9fffcf, {
    metalness: 0.1,
    roughness: 0.25,
    emissive: 0x2a8f5c,
    emissiveIntensity: 0.9,
  });

  const { halfWidth, halfDepth, wallHeight, doorWidth, doorHeight } = layout;

  addPlinth(root, layout, hullDark);
  addShellWalls(root, layout, hull);

  // Deck floor and porch with a lip and short approach ramp.
  addBox(root, deck, halfWidth * 2 - 0.1, 0.1, halfDepth * 2 - 0.1, 0, 0.05, 0);
  const porchWidth = doorWidth + 0.5;
  addBox(
    root,
    deck,
    porchWidth,
    0.1,
    layout.porchDepth,
    0,
    0.05,
    halfDepth + layout.porchDepth * 0.5,
  );
  addBox(
    root,
    trim,
    porchWidth,
    0.05,
    0.08,
    0,
    0.08,
    halfDepth + layout.porchDepth - 0.04,
  );
  addBox(
    root,
    hullDark,
    porchWidth,
    0.09,
    0.85,
    0,
    -0.13,
    halfDepth + layout.porchDepth + 0.36,
    { x: 0.32 },
  );

  // Corner pillars.
  for (const sideX of [-1, 1]) {
    for (const sideZ of [-1, 1]) {
      addBox(
        root,
        hullDark,
        0.3,
        wallHeight + 0.18,
        0.3,
        sideX * (halfWidth - 0.12),
        (wallHeight + 0.18) * 0.5,
        sideZ * (halfDepth - 0.12),
      );
    }
  }

  // Trim bands as hollow frames (edge strips, not slabs through the room).
  for (const y of [0.45, wallHeight - 0.25]) {
    const span = halfWidth * 2 + 0.1;
    addBox(root, trim, span, 0.07, 0.07, 0, y, halfDepth + 0.02);
    addBox(root, trim, span, 0.07, 0.07, 0, y, -halfDepth - 0.02);
    addBox(root, trim, 0.07, 0.07, span, halfWidth + 0.02, y, 0);
    addBox(root, trim, 0.07, 0.07, span, -halfWidth - 0.02, y, 0);
  }

  // Portholes on the back and side walls.
  const portholeRing = new THREE.TorusGeometry(0.3, 0.05, 8, 20);
  const portholeGlass = new THREE.CircleGeometry(0.27, 20);
  const portholes: Array<{ x: number; z: number; ry: number }> = [
    { x: 0, z: -halfDepth - 0.03, ry: 0 },
    { x: -halfWidth - 0.03, z: 0, ry: Math.PI / 2 },
    { x: halfWidth + 0.03, z: 0, ry: Math.PI / 2 },
  ];
  for (const spot of portholes) {
    const ring = new THREE.Mesh(portholeRing, trim);
    ring.position.set(spot.x, 1.55, spot.z);
    ring.rotation.y = spot.ry;
    root.add(ring);
    const glass = new THREE.Mesh(portholeGlass, windowGlass);
    glass.material.side = THREE.DoubleSide;
    glass.position.set(spot.x, 1.55, spot.z);
    glass.rotation.y = spot.ry;
    root.add(glass);
  }

  // Roof: slab, rim, skylight dome, antenna, and a tilted solar panel.
  const roofY = wallHeight + 0.12;
  addBox(root, hull, halfWidth * 2 + 0.3, 0.14, halfDepth * 2 + 0.3, 0, roofY, 0);
  const rimSpan = halfWidth * 2 + 0.3;
  addBox(root, hullDark, rimSpan, 0.12, 0.12, 0, roofY + 0.12, halfDepth + 0.09);
  addBox(root, hullDark, rimSpan, 0.12, 0.12, 0, roofY + 0.12, -halfDepth - 0.09);
  addBox(root, hullDark, 0.12, 0.12, rimSpan, halfWidth + 0.09, roofY + 0.12, 0);
  addBox(root, hullDark, 0.12, 0.12, rimSpan, -halfWidth - 0.09, roofY + 0.12, 0);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    windowGlass,
  );
  dome.position.set(-1.15, roofY + 0.07, -0.85);
  root.add(dome);

  addCylinder(root, hullDark, 0.035, 0.05, 1.6, 1.6, roofY + 0.85, 1.4);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow);
  antennaTip.position.set(1.6, roofY + 1.7, 1.4);
  root.add(antennaTip);

  addBox(root, hullDark, 1.6, 0.05, 0.08, 0.9, roofY + 0.32, -1.35);
  addBox(root, windowGlass, 1.6, 0.04, 1.1, 0.9, roofY + 0.5, -1.55, { x: -0.5 });

  // Doorway: proud frame, glowing header, and jamb lamps.
  const frameDepth = 0.12;
  const doorHalf = doorWidth * 0.5;
  for (const side of [-1, 1]) {
    addBox(
      root,
      trim,
      0.14,
      doorHeight + 0.1,
      frameDepth,
      side * (doorHalf + 0.08),
      (doorHeight + 0.1) * 0.5,
      halfDepth + 0.02,
    );
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glow);
    lamp.position.set(side * (doorHalf + 0.08), doorHeight - 0.25, halfDepth + 0.1);
    root.add(lamp);
  }
  addBox(root, trim, doorWidth + 0.44, 0.14, frameDepth, 0, doorHeight + 0.12, halfDepth + 0.02);
  addBox(root, glow, doorWidth - 0.1, 0.07, 0.05, 0, doorHeight + 0.02, halfDepth + 0.04);

  // Interior: ceiling light panel, then furniture from the collision boxes
  // (bunk first, crate second) so props block the player where they stand.
  addBox(root, glow, 1.25, 0.05, 1.25, 0, wallHeight - 0.09, 0);
  const light = new THREE.PointLight(0x7cffb2, 0.75, 10, 2);
  light.position.set(0, wallHeight - 0.3, 0);
  root.add(light);

  const [bunk, crate] = layout.furniture;
  if (bunk !== undefined) {
    addLocalBox(root, hullDark, bunk);
    addBox(
      root,
      trim,
      bunk.maxX - bunk.minX - 0.1,
      0.09,
      bunk.maxZ - bunk.minZ - 0.1,
      (bunk.minX + bunk.maxX) * 0.5,
      bunk.maxY + 0.045,
      (bunk.minZ + bunk.maxZ) * 0.5,
    );
  }
  if (crate !== undefined) {
    addLocalBox(root, hullDark, crate);
    addBox(
      root,
      trim,
      crate.maxX - crate.minX + 0.04,
      0.07,
      crate.maxZ - crate.minZ + 0.04,
      (crate.minX + crate.maxX) * 0.5,
      crate.maxY - 0.06,
      (crate.minZ + crate.maxZ) * 0.5,
    );
  }

  return root;
}

function requireShelterLayout(blueprintId: BlueprintId): ShelterLayout {
  const layout = shelterLayoutFor(blueprintId);
  if (layout === null) {
    throw new Error(`No shelter layout for ${blueprintId}`);
  }
  return layout;
}
