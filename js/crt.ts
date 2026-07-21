/**
 * Shared CRT-style post chain for planet and space.
 * Built on threejs-psx-shader; scene/camera swap per mode.
 */

import type { Camera, Scene, WebGLRenderer } from "three";
import {
  CRTEffect,
  PixelationEffect,
  PSXPipeline,
} from "threejs-psx-shader";

export interface CrtPipeline {
  render(scene: Scene, camera: Camera, deltaTime: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Soft pixelation + color crush + CRT (curvature, vignette, scanlines,
 * grain, chromatic aberration). Library fog is omitted because planets already
 * use THREE.Fog, and space distances would wash out the starfield.
 */
export function createCrtPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): CrtPipeline {
  const pipeline = new PSXPipeline(renderer, scene, camera, {
    effects: [
      new PixelationEffect({
        resolutionHeight: 800,
        colorCrush: true,
        steps: 64,
      }),
      new CRTEffect({
        bend: 6,
        vignetteAmount: 0.5,
        scanlineWeight: 0.6,
        grainWeight: 0.05,
        chromatic: 1,
        grilleOpacity: 0,
      }),
    ],
  });

  return {
    render(nextScene, nextCamera, deltaTime) {
      pipeline.scene = nextScene;
      pipeline.camera = nextCamera;
      pipeline.render(deltaTime);
    },
    setSize(width, height) {
      pipeline.setSize(width, height);
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
