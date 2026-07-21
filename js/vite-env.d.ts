/// <reference types="vite/client" />

declare module "threejs-psx-shader" {
  import type {
    Camera,
    Scene,
    ShaderMaterial,
    WebGLRenderer,
    WebGLRenderTarget,
  } from "three";

  export type EffectSpace = "linear" | "display" | "output";

  export class PSXEffect {
    name: string;
    space: EffectSpace;
    enabled: boolean;
    material: ShaderMaterial;
    constructor(
      name: string,
      space: EffectSpace,
      fragmentShader: string,
      uniforms?: Record<string, { value: unknown }>,
    );
    updateUniforms(ctx: unknown): void;
    render(
      renderer: WebGLRenderer,
      quad: unknown,
      ctx: unknown,
      read: unknown,
      target: WebGLRenderTarget | null,
    ): void;
    dispose(): void;
  }

  export class PixelationEffect extends PSXEffect {
    settings: {
      pixelate: boolean;
      resolutionHeight: number;
      colorCrush: boolean;
      steps: number;
    };
    constructor(settings?: Partial<PixelationEffect["settings"]>);
  }

  export class CRTEffect extends PSXEffect {
    settings: {
      bend: number;
      vignetteAmount: number;
      vignetteSize: number;
      vignetteRounding: number;
      vignetteSmoothing: number;
      scanlineWeight: number;
      scanlineDensity: number;
      scanlineSpeed: number;
      grainWeight: number;
      chromatic: number;
      grilleOpacity: number;
    };
    constructor(settings?: Partial<CRTEffect["settings"]>);
  }

  export class PSXPipeline {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    enabled: boolean;
    time: number;
    effects: PSXEffect[];
    constructor(
      renderer: WebGLRenderer,
      scene: Scene,
      camera: Camera,
      options?: {
        effects?: PSXEffect[];
        resolutionHeight?: number;
      },
    );
    getEffect(name: string): PSXEffect | null;
    setSize(width: number, height: number): void;
    render(deltaTime?: number): void;
    dispose(): void;
  }
}
