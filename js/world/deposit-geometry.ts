import * as THREE from "three";

import type { DepositType, RandomSource } from "../config.ts";
import { getBufferAttribute } from "./util.ts";

function mergeGeometries(
  geometries: readonly THREE.BufferGeometry[],
): THREE.BufferGeometry {
  let vertexCount = 0;
  for (const geometry of geometries) {
    vertexCount += getBufferAttribute(geometry, "position").count;
  }

  const positions = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (const geometry of geometries) {
    const source = getBufferAttribute(geometry, "position").array;
    positions.set(source, offset);
    offset += source.length;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  result.computeVertexNormals();
  for (const geometry of geometries) geometry.dispose();
  return result;
}

function transformPart(
  baseGeometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
): THREE.BufferGeometry {
  const geometry = baseGeometry.index
    ? baseGeometry.toNonIndexed()
    : baseGeometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotationX, rotationY, rotationZ),
    ),
    new THREE.Vector3(scaleX, scaleY, scaleZ),
  );
  geometry.applyMatrix4(matrix);
  baseGeometry.dispose();
  return geometry;
}

export function createDepositGeometry(
  type: DepositType,
  random: RandomSource,
): THREE.BufferGeometry {
  const signedRandom = (): number => random() * 2 - 1;
  const parts: THREE.BufferGeometry[] = [];

  switch (type) {
    case "iron":
      for (let index = 0; index < 4; index += 1) {
        const radius = 0.45 + random() * 0.3;
        parts.push(
          transformPart(
            new THREE.DodecahedronGeometry(radius),
            signedRandom() * 0.55,
            0.15 + random() * 0.2,
            signedRandom() * 0.55,
            1,
            0.65 + random() * 0.25,
            1,
            random() * 3,
            random() * 3,
            random() * 3,
          ),
        );
      }
      break;
    case "carbon":
      for (let index = 0; index < 5; index += 1) {
        const height = 0.9 + random() * 0.8;
        parts.push(
          transformPart(
            new THREE.OctahedronGeometry(1),
            signedRandom() * 0.5,
            height * 0.4,
            signedRandom() * 0.5,
            0.3,
            height,
            0.3,
            signedRandom() * 0.45,
            random() * 3,
            signedRandom() * 0.45,
          ),
        );
      }
      break;
    case "copper":
      for (let index = 0; index < 5; index += 1) {
        const radius = 0.38 + random() * 0.3;
        parts.push(
          transformPart(
            new THREE.IcosahedronGeometry(radius),
            signedRandom() * 0.6,
            0.2 + random() * 0.35,
            signedRandom() * 0.6,
            1,
            0.85,
            1,
            random() * 3,
            random() * 3,
            random() * 3,
          ),
        );
      }
      break;
    case "crystal":
      for (let index = 0; index < 7; index += 1) {
        const height = 1.1 + random() * 1.2;
        const width = 0.16 + random() * 0.1;
        parts.push(
          transformPart(
            new THREE.OctahedronGeometry(1),
            signedRandom() * 0.4,
            height * 0.42,
            signedRandom() * 0.4,
            width,
            height,
            width,
            signedRandom() * 0.55,
            random() * 3,
            signedRandom() * 0.55,
          ),
        );
      }
      break;
    default: {
      const exhaustiveType: never = type;
      throw new Error(`Unknown deposit type: ${exhaustiveType}`);
    }
  }

  return mergeGeometries(parts);
}
