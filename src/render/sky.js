import * as THREE from 'three';
import { PAL } from '../world/palette.js';

/**
 * Golden-hour sky.
 *
 * IMPLEMENTATION NOTE — why a fullscreen quad and not a sky sphere:
 * The obvious approach (huge inverted sphere, depthTest off) is broken. Even
 * with depth testing disabled, the GPU still clips primitives against the
 * near/far CLIP planes, so a sphere of radius 4000 in front of a camera with
 * far = 620 is culled entirely and you get a black sky. Scaling the sphere to
 * sit inside the far plane instead makes it intersect terrain.
 *
 * So we draw a single fullscreen triangle in NDC and reconstruct the world-space
 * view ray per pixel from the inverse projection + camera world matrix. The sky
 * is then mathematically infinite, immune to clipping, costs one primitive, and
 * always renders behind everything (depth write off, drawn first).
 *
 * Content: 5-stop vertical gradient, low sun disc with three scatter lobes,
 * crepuscular streaks, three drifting fbm cloud decks with sun-facing rim
 * lighting, horizon haze band, plus storm and tunnel blends.
 */

const VERT = /* glsl */`
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vNdc;

uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uTop, uHigh, uMid, uLow, uHorizon, uSunCore, uSunGlow;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uStorm;
uniform float uTunnel;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<6;i++){ s += vnoise(p)*a; p *= 2.03; p += 17.3; a *= 0.5; }
  return s;
}

void main(){
  // --- reconstruct the world-space view ray for this pixel ---
  vec4 clip = vec4(vNdc, -1.0, 1.0);
  vec4 vpos = uInvProj * clip;
  vec3 viewRay = normalize(vpos.xyz / vpos.w);
  vec3 dir = normalize((uCamWorld * vec4(viewRay, 0.0)).xyz);

  float h = dir.y;

  // ---- base vertical gradient -------------------------------------
  vec3 sky;
  float t = clamp(h, 0.0, 1.0);
  if (t < 0.055)      sky = mix(uHorizon, uLow,  smoothstep(0.0,   0.055, t));
  else if (t < 0.20)  sky = mix(uLow,     uMid,  smoothstep(0.055, 0.20,  t));
  else if (t < 0.46)  sky = mix(uMid,     uHigh, smoothstep(0.20,  0.46,  t));
  else                sky = mix(uHigh,    uTop,  smoothstep(0.46,  1.0,   t));
  // below the horizon: warm ground-bounce haze (canyon walls cover most of it)
  sky = mix(sky, uHorizon * 0.90, smoothstep(0.0, -0.28, h));

  // ---- sun ---------------------------------------------------------
  vec3 sd = normalize(uSunDir);
  float cosA = dot(dir, sd);
  float ang  = acos(clamp(cosA, -1.0, 1.0));

  float wide  = exp(-ang * 1.30) * 0.95;
  float mid   = exp(-ang * 4.00) * 0.90;
  float tight = exp(-ang * 15.0) * 1.10;
  float disc  = smoothstep(0.0300, 0.0180, ang);
  float aureole = smoothstep(0.17, 0.02, ang);

  sky += uSunGlow * (wide * 0.40 + mid * 0.60);
  sky += uSunCore * (tight * 0.62 + aureole * 0.46);
  sky += uSunCore * disc * 2.6;

  // ---- crepuscular streaks ----------------------------------------
  float az = atan(dir.x, dir.z);
  float rays = fbm(vec2(az * 5.2, dir.y * 2.4 + uTime * 0.008));
  rays = pow(clamp(rays, 0.0, 1.0), 2.4);
  sky += uSunGlow * rays * exp(-ang * 2.0) * 0.32;

  // ---- clouds ------------------------------------------------------
  float py = max(dir.y, 0.014);
  vec2 cp = dir.xz / py;

  float c1 = smoothstep(0.50, 0.92, fbm(cp * 0.60 + vec2(uTime * 0.0075, uTime * 0.0032)));
  float c2 = smoothstep(0.56, 0.95, fbm(cp * 1.32 + vec2(-uTime * 0.014, uTime * 0.006) + 31.7));
  float c3 = smoothstep(0.46, 0.86, fbm(cp * 0.27 + vec2(uTime * 0.004, 0.0) + 77.1));

  float cover = clamp(c1 * 0.55 + c2 * 0.30 + c3 * 0.45, 0.0, 1.0);
  cover *= smoothstep(0.015, 0.26, dir.y);
  cover *= 1.0 - smoothstep(0.72, 1.0, dir.y) * 0.32;

  float litAmt = pow(clamp(cosA * 0.5 + 0.5, 0.0, 1.0), 2.2);
  vec3 cloudLit  = mix(vec3(1.00, 0.87, 0.70), uSunCore, 0.55);
  vec3 cloudDark = vec3(0.44, 0.35, 0.47);
  vec3 cloudCol  = mix(cloudDark, cloudLit, litAmt * 0.85 + 0.15);
  cloudCol += uSunGlow * exp(-ang * 3.0) * 0.60;

  sky = mix(sky, cloudCol, cover * 0.70);

  // ---- horizon haze band ------------------------------------------
  sky = mix(sky, uHorizon, exp(-abs(dir.y) * 11.0) * 0.50);

  // ---- storm -------------------------------------------------------
  vec3 stormCol = vec3(0.88, 0.62, 0.40);
  stormCol *= 0.82 + fbm(cp * 2.4 + vec2(uTime * 0.08, uTime * 0.03)) * 0.36;
  sky = mix(sky, stormCol, uStorm * 0.80);

  // ---- tunnel ------------------------------------------------------
  sky = mix(sky, vec3(0.030, 0.020, 0.017), uTunnel);

  sky += (hash(gl_FragCoord.xy * 0.5 + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export class Sky {
  constructor(scene, sunDir) {
    // single fullscreen triangle in NDC
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));

    this.uniforms = {
      uInvProj:  { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uTop:      { value: new THREE.Color(PAL.skyTop) },
      uHigh:     { value: new THREE.Color(PAL.skyHigh) },
      uMid:      { value: new THREE.Color(PAL.skyMid) },
      uLow:      { value: new THREE.Color(PAL.skyLow) },
      uHorizon:  { value: new THREE.Color(PAL.skyHorizon) },
      uSunCore:  { value: new THREE.Color(PAL.sunCore) },
      uSunGlow:  { value: new THREE.Color(PAL.sunGlow) },
      uSunDir:   { value: sunDir.clone().normalize() },
      uTime:     { value: 0 },
      uStorm:    { value: 0 },
      uTunnel:   { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;
    // never let three.js cull or transform it
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  update(dt, camera, storm = 0, tunnel = 0) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uStorm.value += (storm - u.uStorm.value) * Math.min(1, dt * 2.4);
    u.uTunnel.value += (tunnel - u.uTunnel.value) * Math.min(1, dt * 3.2);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
  }
}
