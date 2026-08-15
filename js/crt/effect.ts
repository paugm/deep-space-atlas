import * as THREE from "three";

import {
  FULLSCREEN_VERTEX_SHADER,
  FullScreenQuad,
} from "./fullscreen-quad.ts";

export type EffectSpace = "linear" | "display" | "output";

export interface EffectContext {
  time: number;
  lowRes: THREE.Vector2;
  outRes: THREE.Vector2;
}

export function requireUniform(
  uniforms: Record<string, THREE.IUniform | undefined>,
  name: string,
): THREE.IUniform {
  const uniform = uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing CRT uniform ${name}`);
  }
  return uniform;
}

export class CrtPass {
  readonly name: string;
  readonly space: EffectSpace;
  enabled = true;
  readonly material: THREE.ShaderMaterial;

  constructor(
    name: string,
    space: EffectSpace,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform> = {},
  ) {
    this.name = name;
    this.space = space;
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        ...uniforms,
      },
    });
  }

  updateUniforms(_ctx: EffectContext): void {}

  render(
    renderer: THREE.WebGLRenderer,
    quad: FullScreenQuad,
    ctx: EffectContext,
    inputTexture: THREE.Texture,
    outputTarget: THREE.WebGLRenderTarget | null,
  ): void {
    requireUniform(this.material.uniforms, "tDiffuse").value = inputTexture;
    this.updateUniforms(ctx);
    renderer.setRenderTarget(outputTarget);
    quad.render(renderer, this.material);
  }

  dispose(): void {
    this.material.dispose();
  }
}
