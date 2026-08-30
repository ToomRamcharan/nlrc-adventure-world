import * as THREE from 'three';
import { PAL } from '../world/palette.js';
import { softDot, sandWisp } from '../render/textures.js';

/**
 * Atmosphere stack:
 *  - Dust motes drifting in the sun (additive points, always around camera)
 *  - Sand-storm streaks (billboards blowing across screen)
 *  - God rays: soft additive planes aligned to the sun
 *  - Heat shimmer handled in post
 */

export class DustMotes {
  constructor(scene, count = 900) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const siz = new Float32Array(count);
    const spd = new Float32Array(count * 3);
    const R = 46;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * R * 2;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = (Math.random() - 0.5) * R * 2;
      siz[i] = 0.05 + Math.random() * 0.28;
      spd[i * 3] = (Math.random() - 0.5) * 0.7;
      spd[i * 3 + 1] = 0.06 + Math.random() * 0.30;
      spd[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));

    this.speeds = spd;
    this.count = count;
    this.R = R;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTex: { value: softDot(0xffe0b0, 0.2) },
        uOpacity: { value: 0.55 },
        uColor: { value: new THREE.Color(PAL.dust) },
        uPix: { value: 1 },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        uniform float uPix;
        varying float vFade;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float d = -mv.z;
          vFade = smoothstep(1.0, 6.0, d) * (1.0 - smoothstep(30.0, 70.0, d));
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * 320.0 * uPix / max(d, 0.6);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vFade;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(uColor, 1.0) * t.a * uOpacity * vFade;
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.mat = mat;
    scene.add(this.points);
  }

  update(dt, camPos, windX = 0.6, intensity = 1) {
    const p = this.points.geometry.attributes.position;
    const arr = p.array;
    const R = this.R;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      arr[i3] += (this.speeds[i3] + windX) * dt;
      arr[i3 + 1] += this.speeds[i3 + 1] * dt;
      arr[i3 + 2] += this.speeds[i3 + 2] * dt;
      // wrap around camera
      const dx = arr[i3] - camPos.x;
      const dz = arr[i3 + 2] - camPos.z;
      if (dx > R) arr[i3] -= R * 2; else if (dx < -R) arr[i3] += R * 2;
      if (dz > R) arr[i3 + 2] -= R * 2; else if (dz < -R) arr[i3 + 2] += R * 2;
      if (arr[i3 + 1] > 18) arr[i3 + 1] = 0.2;
    }
    p.needsUpdate = true;
    this.mat.uniforms.uOpacity.value = 0.5 * intensity;
  }
}

export class SandStorm {
  constructor(scene, count = 160) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.items = [];
    const tex = sandWisp();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        color: new THREE.Color(PAL.dust).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1),
      });
      const s = new THREE.Sprite(mat);
      const sc = 2.5 + Math.random() * 9;
      s.scale.set(sc, sc * 0.32, 1);
      this.group.add(s);
      this.items.push({
        spr: s,
        x: (Math.random() - 0.5) * 70,
        y: Math.random() * 9,
        z: (Math.random() - 0.5) * 70,
        vx: -(6 + Math.random() * 22),
        vy: (Math.random() - 0.5) * 0.9,
        phase: Math.random() * 6.28,
      });
    }
    this.intensity = 0;
  }

  update(dt, camPos, target) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.5);
    if (this.intensity < 0.005) { this.group.visible = false; return; }
    this.group.visible = true;
    for (const it of this.items) {
      it.x += it.vx * dt;
      it.y += it.vy * dt + Math.sin(it.phase) * dt * 0.5;
      it.phase += dt * 2.4;
      if (it.x < -40) { it.x = 40; it.z = camPos.z + (Math.random() - 0.5) * 70; it.y = Math.random() * 9; }
      if (it.y < 0.2) it.y = 0.2;
      if (it.y > 11) it.y = 11;
      const dz = it.z - camPos.z;
      if (dz < -30) it.z += 70;
      if (dz > 50) it.z -= 70;
      it.spr.position.set(camPos.x + it.x, it.y, it.z);
      it.spr.material.opacity = this.intensity * (0.10 + Math.abs(Math.sin(it.phase)) * 0.22);
    }
  }
}

export class GodRays {
  /** additive quads that fan out from the sun direction */
  constructor(scene, sunDir, count = 7) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.sunDir = sunDir.clone().normalize();
    this.planes = [];
    const tex = softDot(0xffd9a0, 0.05);
    for (let i = 0; i < count; i++) {
      const w = 6 + Math.random() * 22;
      const h = 120 + Math.random() * 140;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.055 + Math.random() * 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        color: new THREE.Color(0xffcf94),
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 900;
      this.group.add(m);
      this.planes.push({ m, off: (Math.random() - 0.5) * 1.4, baseOp: mat.opacity, ph: Math.random() * 6.28 });
    }
    this.t = 0;
  }

  update(dt, camera, strength = 1) {
    this.t += dt;
    // Place rays between the camera and the sun, oriented to face camera
    const sunPos = this.sunDir.clone().multiplyScalar(280).add(camera.position);
    for (let i = 0; i < this.planes.length; i++) {
      const P = this.planes[i];
      const t = (i / this.planes.length - 0.5) * 2;
      const p = sunPos.clone();
      // fan spread perpendicular to sun dir
      const right = new THREE.Vector3().crossVectors(this.sunDir, new THREE.Vector3(0, 1, 0)).normalize();
      p.addScaledVector(right, t * 55 + P.off * 12);
      p.y -= 20 + i * 6;
      P.m.position.copy(p);
      P.m.lookAt(camera.position);
      P.m.rotation.z += Math.sin(this.t * 0.2 + P.ph) * 0.02;
      P.m.material.opacity = P.baseOp * strength * (0.75 + Math.sin(this.t * 0.6 + P.ph) * 0.25);
    }
    this.group.visible = strength > 0.02;
  }
}

/** floating embers/sparkles for tunnel sections */
export class TunnelSparks {
  constructor(scene, count = 120) {
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    const tex = softDot(0xffb765, 0.1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        color: new THREE.Color().setHSL(0.07 + Math.random() * 0.05, 0.9, 0.62),
      });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.10 + Math.random() * 0.22);
      this.group.add(s);
      this.items.push({
        spr: s, x: (Math.random() - 0.5) * 7, y: Math.random() * 4.6, z: (Math.random() - 0.5) * 50,
        vy: 0.2 + Math.random() * 0.7, ph: Math.random() * 6.28,
      });
    }
    this.intensity = 0;
  }
  update(dt, camPos, target) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 2.5);
    if (this.intensity < 0.01) { this.group.visible = false; return; }
    this.group.visible = true;
    for (const it of this.items) {
      it.y += it.vy * dt;
      it.ph += dt * 3;
      if (it.y > 5.0) { it.y = 0.1; it.z = camPos.z + (Math.random() - 0.2) * 50; it.x = (Math.random() - 0.5) * 7; }
      const dz = it.z - camPos.z;
      if (dz < -20) it.z += 50;
      if (dz > 40) it.z -= 50;
      it.spr.position.set(it.x + Math.sin(it.ph) * 0.25, it.y, it.z);
      it.spr.material.opacity = this.intensity * (0.4 + Math.sin(it.ph * 1.7) * 0.3);
    }
  }
}

/** Simple pooled sprite burst for coin pickups and impacts */
export class Bursts {
  constructor(scene, count = 90) {
    this.items = [];
    const tex = softDot(0xffe08a, 0.15);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.items.push({ spr: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1 });
    }
  }

  spawn(pos, color = 0xffe08a, n = 5, spread = 1.4, scale = 0.5) {
    let spawned = 0;
    for (const it of this.items) {
      if (it.life > 0) continue;
      it.spr.visible = true;
      it.spr.position.copy(pos);
      it.spr.material.color.set(color);
      it.life = it.max = 0.34 + Math.random() * 0.22;
      it.vx = (Math.random() - 0.5) * spread * 3;
      it.vy = Math.random() * spread * 2.4 + 0.6;
      it.vz = (Math.random() - 0.5) * spread * 3;
      it.s0 = scale * (0.55 + Math.random() * 0.7);
      it.spr.scale.setScalar(it.s0);
      if (++spawned >= n) break;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) { if (it.spr.visible) { it.spr.visible = false; } continue; }
      it.life -= dt;
      it.spr.position.x += it.vx * dt;
      it.spr.position.y += it.vy * dt;
      it.spr.position.z += it.vz * dt;
      it.vy -= 5.5 * dt;
      const t = Math.max(0, it.life / it.max);
      it.spr.material.opacity = t;
      it.spr.scale.setScalar(it.s0 * (1.6 - t * 0.6));
    }
  }
}
