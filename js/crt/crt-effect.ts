import * as THREE from "three";

import { CrtPass, requireUniform, type EffectContext } from "./effect.ts";

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uLowRes;
uniform float uTime;
uniform float uBend;
uniform float uVignetteAmount;
uniform float uVignetteSize;
uniform float uVignetteRounding;
uniform float uVignetteSmoothing;
uniform float uScanlineWeight;
uniform float uScanlineDensity;
uniform float uScanlineSpeed;
uniform float uGrainWeight;
uniform float uChromatic;
uniform float uGrilleOpacity;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;

  if (uBend > 0.0) {
    vec2 cuv = uv * 2.0 - 1.0;
    float k = 1.0 / max(uBend, 0.0001);
    cuv.x *= 1.0 + pow(abs(cuv.y) * k, 2.0);
    cuv.y *= 1.0 + pow(abs(cuv.x) * k, 2.0);
    uv = cuv * 0.5 + 0.5;
  }

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col;
  if (uChromatic > 0.0) {
    vec2 dir = (uv - 0.5) * (uChromatic / uLowRes);
    col = vec3(
      texture2D(tDiffuse, uv + dir).r,
      texture2D(tDiffuse, uv).g,
      texture2D(tDiffuse, uv - dir).b
    );
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }

  if (uScanlineWeight > 0.0) {
    float s = sin(uv.y * uLowRes.y * uScanlineDensity * 6.28318 + uTime * uScanlineSpeed);
    col *= 1.0 - uScanlineWeight * (0.5 + 0.5 * s);
  }

  if (uGrainWeight > 0.0) {
    float g = hash21(floor(uv * uLowRes) + vec2(fract(uTime * 13.7) * 371.0));
    col += (g - 0.5) * uGrainWeight;
  }

  if (uGrilleOpacity > 0.0) {
    float m = mod(floor(gl_FragCoord.x), 3.0);
    vec3 grille = vec3(float(m == 0.0), float(m == 1.0), float(m == 2.0));
    col = mix(col, col * (0.33 + grille), uGrilleOpacity);
  }

  if (uVignetteAmount > 0.0) {
    vec2 vg = (uv - 0.5) * uVignetteSize;
    float v = 1.0 - sqrt(
      pow(abs(vg.x), uVignetteRounding) +
      pow(abs(vg.y), uVignetteRounding)
    ) * uVignetteAmount;
    v = smoothstep(0.0, uVignetteSmoothing, v);
    col *= v;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export interface CrtEffectSettings {
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
}

export class CrtEffect extends CrtPass {
  settings: CrtEffectSettings;

  constructor(settings: Partial<CrtEffectSettings> = {}) {
    super("crt", "output", FRAGMENT, {
      uLowRes: { value: new THREE.Vector2(320, 240) },
      uTime: { value: 0 },
      uBend: { value: 0 },
      uVignetteAmount: { value: 0.72 },
      uVignetteSize: { value: 1.1 },
      uVignetteRounding: { value: 2.6 },
      uVignetteSmoothing: { value: 0.7 },
      uScanlineWeight: { value: 0.1 },
      uScanlineDensity: { value: 0.5 },
      uScanlineSpeed: { value: 0 },
      uGrainWeight: { value: 0.06 },
      uChromatic: { value: 0.35 },
      uGrilleOpacity: { value: 0 },
    });
    this.settings = {
      bend: 0,
      vignetteAmount: 0.72,
      vignetteSize: 1.1,
      vignetteRounding: 2.6,
      vignetteSmoothing: 0.7,
      scanlineWeight: 0.1,
      scanlineDensity: 0.5,
      scanlineSpeed: 0,
      grainWeight: 0.06,
      chromatic: 0.35,
      grilleOpacity: 0,
      ...settings,
    };
  }

  override updateUniforms(ctx: EffectContext): void {
    const settings = this.settings;
    const uniforms = this.material.uniforms;
    (requireUniform(uniforms, "uLowRes").value as THREE.Vector2).copy(
      ctx.lowRes,
    );
    requireUniform(uniforms, "uTime").value = ctx.time;
    requireUniform(uniforms, "uBend").value = settings.bend;
    requireUniform(uniforms, "uVignetteAmount").value = settings.vignetteAmount;
    requireUniform(uniforms, "uVignetteSize").value = settings.vignetteSize;
    requireUniform(uniforms, "uVignetteRounding").value =
      settings.vignetteRounding;
    requireUniform(uniforms, "uVignetteSmoothing").value =
      settings.vignetteSmoothing;
    requireUniform(uniforms, "uScanlineWeight").value = settings.scanlineWeight;
    requireUniform(uniforms, "uScanlineDensity").value =
      settings.scanlineDensity;
    requireUniform(uniforms, "uScanlineSpeed").value = settings.scanlineSpeed;
    requireUniform(uniforms, "uGrainWeight").value = settings.grainWeight;
    requireUniform(uniforms, "uChromatic").value = settings.chromatic;
    requireUniform(uniforms, "uGrilleOpacity").value = settings.grilleOpacity;
  }
}
