/**
 * Shared CRT-style post chain for planet and space.
 * Pixelation + CRT passes vendored (MIT) from threejs-psx-shader.
 */

import type { Camera, Scene, WebGLRenderer } from "three";

import { CrtEffect } from "./crt/crt-effect.ts";
import { CrtPipeline } from "./crt/pipeline.ts";
import { PixelationEffect } from "./crt/pixelation-effect.ts";

export interface CrtComfortSettings {
  grainWeight: number;
  chromatic: number;
  scanlineSpeed: number;
}

/** Soft CRT vs a calmer pass for prefers-reduced-motion / profile toggle. */
export function crtComfortSettings(reduceMotion: boolean): CrtComfortSettings {
  if (reduceMotion) {
    return { grainWeight: 0, chromatic: 0, scanlineSpeed: 0 };
  }
  return { grainWeight: 0.05, chromatic: 1, scanlineSpeed: 0 };
}

export function prefersReducedMotion(
  media: { matches: boolean } | null = null,
): boolean {
  if (media !== null) return media.matches;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface CrtPipelineHandle {
  render(scene: Scene, camera: Camera, deltaTime: number): void;
  setSize(width: number, height: number): void;
  setReduceMotion(reduceMotion: boolean): void;
  dispose(): void;
}

/**
 * Soft pixelation + color crush + CRT (curvature, vignette, scanlines,
 * grain, chromatic aberration). Scene fog is left to THREE.Fog.
 */
export function createCrtPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  options: { reduceMotion?: boolean } = {},
): CrtPipelineHandle {
  const pixelation = new PixelationEffect({
    resolutionHeight: 800,
    colorCrush: true,
    steps: 64,
  });
  const crtEffect = new CrtEffect({
    bend: 6,
    vignetteAmount: 0.5,
    scanlineWeight: 0.6,
    grainWeight: 0.05,
    chromatic: 1,
    grilleOpacity: 0,
  });
  const pipeline = new CrtPipeline(renderer, scene, camera, {
    effects: [pixelation, crtEffect],
  });

  function applyComfort(reduceMotion: boolean): void {
    const comfort = crtComfortSettings(reduceMotion);
    crtEffect.settings.grainWeight = comfort.grainWeight;
    crtEffect.settings.chromatic = comfort.chromatic;
    crtEffect.settings.scanlineSpeed = comfort.scanlineSpeed;
  }

  applyComfort(options.reduceMotion === true);

  return {
    render(nextScene, nextCamera, deltaTime) {
      pipeline.scene = nextScene;
      pipeline.camera = nextCamera;
      pipeline.render(deltaTime);
    },
    setSize(width, height) {
      pipeline.setSize(width, height);
    },
    setReduceMotion(reduceMotion) {
      applyComfort(reduceMotion);
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
