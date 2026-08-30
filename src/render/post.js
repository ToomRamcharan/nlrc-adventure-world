import * as THREE from 'three';

/**
 * Lightweight custom post stack (no EffectComposer dependency):
 *   scene -> HDR RT -> bright-pass + 3-tap blur chain -> composite
 * Composite applies: bloom add, ACES-ish tonemap, vignette, chromatic
 * aberration, heat shimmer, dust grain, warm/cool color grade, speed blur.
 */

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uDir;      // texel-scaled direction
varying vec2 vUv;
void main(){
  // 9-tap gaussian
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
  s += texture2D(tDiffuse, vUv + uDir * 1.3846).rgb * 0.316216;
  s += texture2D(tDiffuse, vUv - uDir * 1.3846).rgb * 0.316216;
  s += texture2D(tDiffuse, vUv + uDir * 3.2308).rgb * 0.070270;
  s += texture2D(tDiffuse, vUv - uDir * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(s, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform sampler2D tBloom2;
uniform float uBloom;
uniform float uExposure;
uniform float uVignette;
uniform float uChroma;
uniform float uShimmer;
uniform float uGrain;
uniform float uTime;
uniform float uSpeedBlur;
uniform float uStorm;
uniform float uHurt;
uniform float uTunnel;
uniform vec2 uResolution;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
varying vec2 vUv;

float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p,p+19.19); return fract(p.x*p.y); }

// ACES filmic approximation (Narkowicz)
vec3 aces(vec3 x){
  const float a = 2.51; const float b = 0.03;
  const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}

vec3 grade(vec3 c){
  c = c + uLift * (1.0 - c);
  c = pow(max(c, 0.0), uGamma);
  c = c * uGain;
  return c;
}

void main(){
  vec2 uv = vUv;
  vec2 center = uv - 0.5;
  float r2 = dot(center, center);

  // ---- heat shimmer (horizontal wobble stronger near the ground) ----
  float groundW = smoothstep(0.62, 0.15, uv.y);
  float wob = sin(uv.y * 130.0 + uTime * 3.4) * 0.00055
            + sin(uv.y * 47.0 - uTime * 2.1) * 0.00085;
  uv.x += wob * uShimmer * groundW * 6.0;

  // ---- radial speed blur ----
  vec3 col = vec3(0.0);
  if (uSpeedBlur > 0.001) {
    float w = 0.0;
    for (int i = 0; i < 6; i++) {
      float t = float(i) / 5.0;
      float scale = 1.0 - t * 0.035 * uSpeedBlur * smoothstep(0.02, 0.35, r2);
      vec2 suv = 0.5 + center * scale;
      float wi = 1.0 - t * 0.55;
      col += texture2D(tDiffuse, suv).rgb * wi;
      w += wi;
    }
    col /= w;
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }

  // ---- chromatic aberration ----
  float ca = uChroma * (0.0016 + r2 * 0.010);
  if (ca > 0.00005) {
    vec2 dir = normalize(center + 1e-6);
    col.r = texture2D(tDiffuse, uv + dir * ca).r;
    col.b = texture2D(tDiffuse, uv - dir * ca).b;
  }

  // ---- bloom ----
  vec3 b1 = texture2D(tBloom, vUv).rgb;
  vec3 b2 = texture2D(tBloom2, vUv).rgb;
  col += (b1 * 0.62 + b2 * 0.85) * uBloom;

  // ---- exposure + tonemap ----
  col *= uExposure;
  col = aces(col);

  // ---- color grade ----
  col = grade(col);

  // ---- storm wash ----
  col = mix(col, col * vec3(1.10, 0.86, 0.66) + vec3(0.16, 0.10, 0.04), uStorm * 0.55);

  // ---- tunnel: crush blacks, warm the highlights ----
  col = mix(col, pow(col, vec3(1.22)) * vec3(1.06, 0.92, 0.78), uTunnel * 0.7);

  // ---- hurt flash ----
  col = mix(col, vec3(0.85, 0.15, 0.10), uHurt * 0.42);

  // ---- vignette ----
  float vig = 1.0 - uVignette * smoothstep(0.10, 0.86, r2 * 1.35);
  col *= vig;

  // ---- film grain / dust ----
  float g = hash(vUv * uResolution + uTime * 60.0) - 0.5;
  col += g * uGrain;

  // ---- subtle scanline-free dithering ----
  col += (hash(vUv * 1024.0 + uTime) - 0.5) / 255.0;

  // ---- linear -> sRGB OETF -----------------------------------------
  // The scene is rendered into a linear HalfFloat target and composited by a
  // raw ShaderMaterial. three.js only injects its output-colour-space
  // conversion into its OWN materials, so we must encode here or the whole
  // image is written as linear values into an sRGB framebuffer and looks
  // roughly 2 stops too dark / muddy.
  col = clamp(col, 0.0, 1.0);
  col = mix(col * 12.92,
            1.055 * pow(max(col, vec3(1e-5)), vec3(1.0/2.4)) - 0.055,
            step(vec3(0.0031308), col));

  gl_FragColor = vec4(col, 1.0);
}
`;

class FSQuad {
  constructor(material) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 2, 0, 0, 2,
    ]), 2));
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.cam);
  }
  get material() { return this.mesh.material; }
  set material(m) { this.mesh.material = m; }
}

export class PostFX {
  constructor(renderer, width, height, opts = {}) {
    this.renderer = renderer;
    this.dpr = renderer.getPixelRatio();
    this.enabled = true;
    this.bloomScale = opts.bloomScale ?? 4;

    const type = THREE.HalfFloatType;
    const rtOpts = {
      type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtScene.samples = opts.msaa ?? 0;

    const bOpts = { ...rtOpts, depthBuffer: false };
    this.rtBrightA = new THREE.WebGLRenderTarget(1, 1, bOpts);
    this.rtBrightB = new THREE.WebGLRenderTarget(1, 1, bOpts);
    this.rtBright2A = new THREE.WebGLRenderTarget(1, 1, bOpts);
    this.rtBright2B = new THREE.WebGLRenderTarget(1, 1, bOpts);

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: opts.threshold ?? 0.82 },
        uKnee: { value: 0.35 },
      },
      depthTest: false, depthWrite: false,
    });
    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        tBloom2: { value: null },
        uBloom: { value: opts.bloom ?? 0.62 },
        uExposure: { value: opts.exposure ?? 1.0 },
        uVignette: { value: opts.vignette ?? 0.42 },
        uChroma: { value: opts.chroma ?? 0.55 },
        uShimmer: { value: opts.shimmer ?? 0.55 },
        uGrain: { value: opts.grain ?? 0.020 },
        uTime: { value: 0 },
        uSpeedBlur: { value: 0 },
        uStorm: { value: 0 },
        uHurt: { value: 0 },
        uTunnel: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLift: { value: new THREE.Vector3(0.008, 0.002, 0.010) },
        uGamma: { value: new THREE.Vector3(1.045, 1.075, 1.130) },
        uGain: { value: new THREE.Vector3(1.070, 1.000, 0.930) },
      },
      depthTest: false, depthWrite: false,
    });

    this.quad = new FSQuad(this.matComposite);
    this.setSize(width, height);
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * dpr));
    const H = Math.max(2, Math.floor(h * dpr));
    this.width = W; this.height = H;
    this.rtScene.setSize(W, H);
    const s1 = Math.max(2, Math.floor(W / this.bloomScale));
    const t1 = Math.max(2, Math.floor(H / this.bloomScale));
    this.rtBrightA.setSize(s1, t1);
    this.rtBrightB.setSize(s1, t1);
    const s2 = Math.max(2, Math.floor(W / (this.bloomScale * 3)));
    const t2 = Math.max(2, Math.floor(H / (this.bloomScale * 3)));
    this.rtBright2A.setSize(s2, t2);
    this.rtBright2B.setSize(s2, t2);
    this.matComposite.uniforms.uResolution.value.set(W, H);
  }

  render(scene, camera, dt, state = {}) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }

    // 1. scene -> HDR
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // 2. bright pass
    this.quad.material = this.matBright;
    this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.quad.render(r, this.rtBrightA);

    // 3. blur chain (level 1)
    this.quad.material = this.matBlur;
    const w1 = this.rtBrightA.width, h1 = this.rtBrightA.height;
    for (let i = 0; i < 2; i++) {
      this.matBlur.uniforms.tDiffuse.value = this.rtBrightA.texture;
      this.matBlur.uniforms.uDir.value.set(1 / w1, 0);
      this.quad.render(r, this.rtBrightB);
      this.matBlur.uniforms.tDiffuse.value = this.rtBrightB.texture;
      this.matBlur.uniforms.uDir.value.set(0, 1 / h1);
      this.quad.render(r, this.rtBrightA);
    }

    // 4. downsample to level 2 + blur (wide halo)
    this.matBlur.uniforms.tDiffuse.value = this.rtBrightA.texture;
    const w2 = this.rtBright2A.width, h2 = this.rtBright2A.height;
    this.matBlur.uniforms.uDir.value.set(1 / w2, 0);
    this.quad.render(r, this.rtBright2A);
    for (let i = 0; i < 2; i++) {
      this.matBlur.uniforms.tDiffuse.value = this.rtBright2A.texture;
      this.matBlur.uniforms.uDir.value.set(0, 1 / h2);
      this.quad.render(r, this.rtBright2B);
      this.matBlur.uniforms.tDiffuse.value = this.rtBright2B.texture;
      this.matBlur.uniforms.uDir.value.set(1 / w2, 0);
      this.quad.render(r, this.rtBright2A);
    }

    // 5. composite
    const u = this.matComposite.uniforms;
    u.tDiffuse.value = this.rtScene.texture;
    u.tBloom.value = this.rtBrightA.texture;
    u.tBloom2.value = this.rtBright2A.texture;
    u.uTime.value += dt;
    if (state.speedBlur !== undefined) u.uSpeedBlur.value = state.speedBlur;
    if (state.storm !== undefined) u.uStorm.value = state.storm;
    if (state.hurt !== undefined) u.uHurt.value = state.hurt;
    if (state.tunnel !== undefined) u.uTunnel.value = state.tunnel;
    if (state.shimmer !== undefined) u.uShimmer.value = state.shimmer;
    this.quad.material = this.matComposite;
    this.quad.render(r, null);
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtBrightA, this.rtBrightB, this.rtBright2A, this.rtBright2B]) rt.dispose();
  }
}
