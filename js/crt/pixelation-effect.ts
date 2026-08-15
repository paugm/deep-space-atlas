import { CrtPass, requireUniform } from "./effect.ts";

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uLevels;

void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  if (uLevels >= 1.0) {
    c.rgb = floor(c.rgb * uLevels + 0.5) / uLevels;
  }
  gl_FragColor = c;
}
`;

export interface PixelationSettings {
  pixelate: boolean;
  resolutionHeight: number;
  colorCrush: boolean;
  steps: number;
}

export class PixelationEffect extends CrtPass {
  settings: PixelationSettings;

  constructor(settings: Partial<PixelationSettings> = {}) {
    super("pixelation", "display", FRAGMENT, {
      uLevels: { value: 31 },
    });
    this.settings = {
      pixelate: true,
      resolutionHeight: 240,
      colorCrush: true,
      steps: 32,
      ...settings,
    };
  }

  override updateUniforms(): void {
    const settings = this.settings;
    requireUniform(this.material.uniforms, "uLevels").value = settings.colorCrush
      ? settings.steps - 1
      : 0;
  }
}
