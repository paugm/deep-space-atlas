import * as THREE from "three";

import { CrtEffect } from "./crt-effect.ts";
import { CrtPass, requireUniform, type EffectContext } from "./effect.ts";
import { FULLSCREEN_VERTEX_SHADER, FullScreenQuad } from "./fullscreen-quad.ts";
import { PixelationEffect } from "./pixelation-effect.ts";

const ENCODE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(
    c * 12.92,
    1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, c)
  );
}
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(toSRGB(t.rgb), t.a);
}
`;

const COPY_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

function makeTarget(
  width: number,
  height: number,
  withDepth: boolean,
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    depthBuffer: withDepth,
  });
  target.texture.generateMipmaps = false;
  if (withDepth) {
    target.depthTexture = new THREE.DepthTexture(width, height);
  }
  return target;
}

export class CrtPipeline {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  enabled = true;
  time = 0;
  readonly effects: CrtPass[];

  private readonly quad = new FullScreenQuad();
  private readonly sceneTarget = makeTarget(320, 240, true);
  private readonly ping = [makeTarget(320, 240, false), makeTarget(320, 240, false)];
  private pingIndex = 0;
  private readonly encodeMaterial: THREE.ShaderMaterial;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly outputSize = new THREE.Vector2(1, 1);
  private readonly lowRes = new THREE.Vector2(320, 240);

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    options: { effects?: CrtPass[] } = {},
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.effects = options.effects ?? [
      new PixelationEffect({ resolutionHeight: 240 }),
      new CrtEffect(),
    ];
    this.encodeMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: ENCODE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: { tDiffuse: { value: null } },
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: COPY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: { tDiffuse: { value: null } },
    });
    this.setSize(renderer.domElement.width, renderer.domElement.height);
  }

  getEffect(name: string): CrtPass | null {
    return this.effects.find((effect) => effect.name === name) ?? null;
  }

  setSize(width: number, height: number): void {
    this.outputSize.set(width, height);
    this.applyResolution();
  }

  private applyResolution(): void {
    const out = this.outputSize;
    const pixelation = this.getEffect("pixelation");
    let width = out.x;
    let height = out.y;
    if (
      pixelation instanceof PixelationEffect &&
      pixelation.enabled &&
      pixelation.settings.pixelate
    ) {
      height = Math.max(64, Math.round(pixelation.settings.resolutionHeight));
      width = Math.max(64, Math.round(height * (out.x / Math.max(out.y, 1))));
    }
    if (this.sceneTarget.width !== width || this.sceneTarget.height !== height) {
      this.sceneTarget.setSize(width, height);
      this.ping[0]?.setSize(width, height);
      this.ping[1]?.setSize(width, height);
    }
    this.lowRes.set(width, height);
  }

  private nextPing(): THREE.WebGLRenderTarget {
    this.pingIndex ^= 1;
    const target = this.ping[this.pingIndex];
    if (target === undefined) {
      throw new Error("CRT ping buffer missing.");
    }
    return target;
  }

  render(deltaTime = 0.016): void {
    this.time += deltaTime;
    const renderer = this.renderer;
    if (!this.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(this.scene, this.camera);
      return;
    }

    this.applyResolution();
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(this.scene, this.camera);

    const ctx: EffectContext = {
      time: this.time,
      lowRes: this.lowRes,
      outRes: this.outputSize,
    };

    let read: THREE.Texture = this.sceneTarget.texture;

    for (const effect of this.effects) {
      if (!effect.enabled || effect.space !== "linear") continue;
      const target = this.nextPing();
      effect.render(renderer, this.quad, ctx, read, target);
      read = target.texture;
    }

    {
      const target = this.nextPing();
      requireUniform(this.encodeMaterial.uniforms, "tDiffuse").value = read;
      renderer.setRenderTarget(target);
      this.quad.render(renderer, this.encodeMaterial);
      read = target.texture;
    }

    for (const effect of this.effects) {
      if (!effect.enabled || effect.space !== "display") continue;
      const target = this.nextPing();
      effect.render(renderer, this.quad, ctx, read, target);
      read = target.texture;
    }

    const output = [...this.effects]
      .reverse()
      .find((effect) => effect.enabled && effect.space === "output");
    if (output !== undefined) {
      output.render(renderer, this.quad, ctx, read, null);
    } else {
      requireUniform(this.copyMaterial.uniforms, "tDiffuse").value = read;
      renderer.setRenderTarget(null);
      this.quad.render(renderer, this.copyMaterial);
    }
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.ping[0]?.dispose();
    this.ping[1]?.dispose();
    this.encodeMaterial.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
    for (const effect of this.effects) effect.dispose();
  }
}
