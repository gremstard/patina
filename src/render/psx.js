// §3 — PSX rendering. The three.js layer (the only file here that imports three).
//
//   makeCityMaterial()  MeshLambertMaterial + fog + vertex-snapping shader
//   PSXPass             renders the scene to a 240-line target, then upscales
//                       with NearestFilter + posterize + ordered dither
//
// "Texel density is not what sells PSX. The palette, NearestFilter, dithering,
//  and the low-res target do that work." So this file, not the geometry, is where
//  the look lives.

import {
  MeshLambertMaterial,
  Vector2,
  WebGLRenderTarget,
  NearestFilter,
  Scene,
  OrthographicCamera,
  ShaderMaterial,
  Mesh,
  PlaneGeometry,
} from 'three';

// Vertex-snapping material (§3). Injects the fixed-point snap into the vertex
// shader — "Do not fake it in JS." uSnap ≈ (160, 120): vertices land on a coarse
// grid, and the jitter hides LOD popping.
export function makeCityMaterial() {
  const mat = new MeshLambertMaterial({ vertexColors: true, fog: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = { value: new Vector2(160, 120) };
    shader.vertexShader =
      'uniform vec2 uSnap;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         gl_Position.xyz /= gl_Position.w;
         gl_Position.xy = floor(uSnap * gl_Position.xy) / uSnap;
         gl_Position.xyz *= gl_Position.w;`,
      );
    mat.userData.shader = shader;
  };
  return mat;
}

// Flat ground / roads. Same lambert + fog look, but NO vertex snapping — a large
// flat quad warps badly when its corners snap to the pixel grid (§3), and flat
// ground has no LOD popping for snapping to hide anyway.
export function makeGroundMaterial() {
  return new MeshLambertMaterial({ vertexColors: true, fog: true });
}

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Sample the low-res target with Nearest, add a 4×4 ordered-dither offset, then
// posterize each channel. Dither + posterize = the palettized signature (§3).
const POST_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform float uLevels;
  varying vec2 vUv;

  float bayer(vec2 p) {
    // 4x4 Bayer matrix, returns 0..1
    mat4 m = mat4(
       0.0,  8.0,  2.0, 10.0,
      12.0,  4.0, 14.0,  6.0,
       3.0, 11.0,  1.0,  9.0,
      15.0,  7.0, 13.0,  5.0
    );
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    return m[y][x] / 16.0;
  }

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float d = (bayer(gl_FragCoord.xy) - 0.5) / uLevels;
    c += d;
    c = floor(c * uLevels + 0.5) / uLevels;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export class PSXPass {
  constructor(renderer, { internalHeight = 240, levels = 24 } = {}) {
    this.renderer = renderer;
    this.internalHeight = internalHeight;
    this.rt = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.scene = new Scene();
    this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, uLevels: { value: levels } },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
  }

  // Internal buffer stays 240 lines tall; width tracks aspect. The output canvas
  // is full resolution — the Nearest upscale in the post pass does the crunch, so
  // fill rate is spent on 240 lines, not the display (§3: "fill rate is free").
  setSize(cssW, cssH) {
    const aspect = cssW / cssH;
    const rh = this.internalHeight;
    const rw = Math.max(1, Math.round(rh * aspect));
    this.rt.setSize(rw, rh);
    this.renderer.setSize(cssW, cssH, false);
  }

  render(scene, camera) {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
