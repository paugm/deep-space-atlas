/**
 * Fullscreen triangle for post passes. Vendored (MIT) from
 * threejs-psx-shader — only the pieces this game uses.
 */

import * as THREE from "three";

export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export class FullScreenQuad {
  private readonly mesh: THREE.Mesh;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    );
    geometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
    );
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera();
  }

  render(renderer: THREE.WebGLRenderer, material: THREE.Material): void {
    this.mesh.material = material;
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
