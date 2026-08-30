import * as THREE from 'three';
import { PLAYER, LANES, LANE_W } from '../world/constants.js';
import { flatMat } from './props.js';
import { blobShadow, softDot } from '../render/textures.js';

/**
 * Stylised runner rig matching the reference:
 *  red beanie, blonde pigtails, white tank top, blue jeans with red waist trim,
 *  white sneakers.  Built from primitives with a procedural run cycle.
 */

const SKIN = 0xf0c39a;
const SKIN_SH = 0xd9a67c;
const HAIR = 0xf1cf6a;
const BEANIE = 0xd8352c;
const BEANIE_DK = 0xa8241d;
const TANK = 0xf6f2ea;
const JEANS = 0x3f6ea8;
const JEANS_DK = 0x2d5382;
const BELT = 0xcf3a30;
const SHOE = 0xfbfaf6;
const SHOE_SOLE = 0xd8d4cc;
const SHOE_ACC = 0xe0554a;

function box(w, h, d, m, seg = 1) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}
function caps(r, h, m) {
  const g = new THREE.CapsuleGeometry(r, h, 4, 8);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}
function sph(r, m, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 14, 12);
  g.scale(sx, sy, sz);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'player';
    scene.add(this.root);

    this.body = new THREE.Group();
    this.root.add(this.body);

    this.laneIndex = 1;
    this.x = 0;
    this.targetX = 0;
    this.laneT = 1;
    this.y = 0;
    this.vy = 0;
    this.z = 0;
    this.grounded = true;
    this.rolling = false;
    this.rollT = 0;
    this.speed = PLAYER.startSpeed;
    this.runPhase = 0;
    this.alive = true;
    this.hurtFlash = 0;
    this.lean = 0;
    this.jumpSquash = 0;

    this._build();
    this._buildShadow();
  }

  _build() {
    const mSkin = flatMat(SKIN, 0.72);
    const mSkinSh = flatMat(SKIN_SH, 0.75);
    const mHair = flatMat(HAIR, 0.68);
    const mBeanie = flatMat(BEANIE, 0.82);
    const mBeanieDk = flatMat(BEANIE_DK, 0.84);
    const mTank = flatMat(TANK, 0.78);
    const mJeans = flatMat(JEANS, 0.86);
    const mJeansDk = flatMat(JEANS_DK, 0.88);
    const mBelt = flatMat(BELT, 0.8);
    const mShoe = flatMat(SHOE, 0.6);
    const mSole = flatMat(SHOE_SOLE, 0.7);
    const mAcc = flatMat(SHOE_ACC, 0.7);

    /* ---------- torso ---------- */
    this.torso = new THREE.Group();
    this.torso.position.y = 1.02;
    this.body.add(this.torso);

    const chest = sph(0.235, mTank, 1.02, 1.18, 0.78);
    chest.position.y = 0.09;
    this.torso.add(chest);
    // tank top straps
    for (const s of [-1, 1]) {
      const strap = box(0.052, 0.20, 0.14, mTank);
      strap.position.set(s * 0.115, 0.26, -0.005);
      strap.rotation.z = -s * 0.14;
      this.torso.add(strap);
    }
    // upper chest / shoulders skin
    const shoulders = sph(0.185, mSkin, 1.10, 0.62, 0.82);
    shoulders.position.y = 0.30;
    this.torso.add(shoulders);
    // waist
    const waist = sph(0.185, mTank, 1.0, 0.72, 0.78);
    waist.position.y = -0.12;
    this.torso.add(waist);
    // red waist trim
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.196, 0.203, 0.075, 14), mBelt);
    belt.position.y = -0.215;
    belt.scale.z = 0.80;
    belt.castShadow = true;
    this.torso.add(belt);

    /* ---------- hips / jeans ---------- */
    this.hips = new THREE.Group();
    this.hips.position.y = 0.76;
    this.body.add(this.hips);
    const hipMesh = sph(0.195, mJeans, 1.06, 0.78, 0.86);
    hipMesh.position.y = 0.02;
    this.hips.add(hipMesh);

    /* ---------- head ---------- */
    this.head = new THREE.Group();
    this.head.position.y = 1.40;
    this.body.add(this.head);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.10, 10), mSkin);
    neck.position.y = -0.11;
    this.head.add(neck);

    const skull = sph(0.155, mSkin, 1.0, 1.08, 0.98);
    this.head.add(skull);

    // jaw hint
    const jaw = sph(0.115, mSkin, 1.0, 0.72, 1.0);
    jaw.position.set(0, -0.055, 0.03);
    this.head.add(jaw);

    // hair back mass
    const hairBack = sph(0.163, mHair, 1.02, 1.02, 0.86);
    hairBack.position.set(0, 0.012, -0.028);
    this.head.add(hairBack);

    // beanie
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.172, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mBeanie);
    beanie.position.y = 0.028;
    beanie.castShadow = true;
    this.head.add(beanie);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.032, 8, 20), mBeanieDk);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.048;
    this.head.add(brim);
    const pom = sph(0.045, mBeanieDk);
    pom.position.y = 0.205;
    this.head.add(pom);

    // pigtails
    this.pigtails = [];
    for (const s of [-1, 1]) {
      const pt = new THREE.Group();
      pt.position.set(s * 0.145, -0.015, -0.055);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.014, 6, 10), mBeanieDk);
      tie.rotation.y = Math.PI / 2;
      pt.add(tie);
      const t1 = caps(0.052, 0.13, mHair);
      t1.position.set(s * 0.035, -0.10, -0.02);
      t1.rotation.z = -s * 0.30;
      pt.add(t1);
      const t2 = caps(0.042, 0.10, mHair);
      t2.position.set(s * 0.075, -0.235, -0.045);
      t2.rotation.z = -s * 0.5;
      pt.add(t2);
      const tip = sph(0.040, mHair);
      tip.position.set(s * 0.105, -0.325, -0.062);
      pt.add(tip);
      this.head.add(pt);
      this.pigtails.push(pt);
    }

    /* ---------- arms ---------- */
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.205, 1.28, 0);
      this.body.add(shoulder);

      const upper = caps(0.058, 0.17, mSkin);
      upper.position.y = -0.115;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.235;
      shoulder.add(elbow);

      const lower = caps(0.050, 0.16, mSkinSh);
      lower.position.y = -0.105;
      elbow.add(lower);

      const hand = sph(0.058, mSkin, 1.0, 1.15, 0.75);
      hand.position.y = -0.215;
      elbow.add(hand);

      this.arms.push({ shoulder, elbow, side: s });
    }

    /* ---------- legs ---------- */
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.105, 0.74, 0);
      this.body.add(hip);

      const thigh = caps(0.082, 0.21, mJeans);
      thigh.position.y = -0.155;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.32;
      hip.add(knee);

      const shin = caps(0.068, 0.20, mJeansDk);
      shin.position.y = -0.14;
      knee.add(shin);

      // rolled cuff
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.079, 0.075, 0.055, 10), mJeans);
      cuff.position.y = -0.265;
      knee.add(cuff);

      // ankle
      const ankle = new THREE.Group();
      ankle.position.y = -0.295;
      knee.add(ankle);

      const shoeBody = box(0.115, 0.078, 0.235, mShoe);
      shoeBody.position.set(0, -0.035, 0.045);
      ankle.add(shoeBody);
      const toe = sph(0.062, mShoe, 0.92, 0.62, 1.0);
      toe.position.set(0, -0.038, 0.155);
      ankle.add(toe);
      const sole = box(0.125, 0.036, 0.255, mSole);
      sole.position.set(0, -0.082, 0.048);
      ankle.add(sole);
      const swoosh = box(0.012, 0.030, 0.11, mAcc);
      swoosh.position.set(s * 0.058, -0.026, 0.045);
      ankle.add(swoosh);
      const heel = box(0.108, 0.055, 0.06, mShoe);
      heel.position.set(0, -0.020, -0.062);
      ankle.add(heel);

      this.legs.push({ hip, knee, ankle, side: s });
    }

    // dust puff sprites at feet
    this.puffs = [];
    for (let i = 0; i < 8; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDot(0xe8bb8a, 0.28), transparent: true, opacity: 0,
        depthWrite: false,
      }));
      spr.scale.setScalar(0.5);
      this.root.add(spr);
      this.puffs.push({ spr, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.puffTimer = 0;
  }

  _buildShadow() {
    const geo = new THREE.PlaneGeometry(1.15, 1.6);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadow(), transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.shadow = new THREE.Mesh(geo, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.scene.add(this.shadow);
  }

  reset() {
    this.laneIndex = 1;
    this.x = 0; this.targetX = 0; this.laneT = 1;
    this.y = 0; this.vy = 0; this.z = 0;
    this.grounded = true; this.rolling = false; this.rollT = 0;
    this.speed = PLAYER.startSpeed;
    this.alive = true;
    this.hurtFlash = 0;
    this.lean = 0;
  }

  moveLane(dir) {
    if (!this.alive) return false;
    const next = THREE.MathUtils.clamp(this.laneIndex + dir, 0, LANES.length - 1);
    if (next === this.laneIndex) return false;
    this.prevX = this.x;
    this.laneIndex = next;
    this.targetX = LANES[next];
    this.laneT = 0;
    this.lean = dir * 0.55;
    return true;
  }

  jump() {
    if (!this.alive) return false;
    if (!this.grounded) return false;
    this.vy = PLAYER.jumpVel;
    this.grounded = false;
    this.rolling = false;
    this.jumpSquash = 1;
    return true;
  }

  roll() {
    if (!this.alive) return false;
    if (!this.grounded) {
      // fast-fall into a roll
      this.vy = Math.min(this.vy, -8);
      this.rolling = true;
      this.rollT = PLAYER.rollTime;
      return true;
    }
    this.rolling = true;
    this.rollT = PLAYER.rollTime;
    return true;
  }

  hurt() {
    this.hurtFlash = 0.42;
    this.speed = Math.max(PLAYER.startSpeed * 0.8, this.speed * (1 - PLAYER.hurtSpeedLoss));
  }

  die() { this.alive = false; }

  /** current collision capsule height (crouched when rolling) */
  get collideHeight() { return this.rolling ? 0.72 : PLAYER.height; }

  update(dt, groundY = 0) {
    // ---- lane interpolation with ease-out ----
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / PLAYER.laneSwitchTime);
      const t = 1 - Math.pow(1 - this.laneT, 3);
      this.x = THREE.MathUtils.lerp(this.prevX ?? this.x, this.targetX, t);
    } else {
      this.x = this.targetX;
    }
    this.lean += (0 - this.lean) * Math.min(1, dt * 8);

    // ---- vertical ----
    if (!this.grounded) {
      this.vy += PLAYER.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY) {
        this.y = groundY; this.vy = 0; this.grounded = true;
        this.jumpSquash = -1;
        this._burstPuff(6);
      }
    } else {
      this.y = groundY;
    }

    // ---- rolling timer ----
    if (this.rolling) {
      this.rollT -= dt;
      if (this.rollT <= 0) this.rolling = false;
    }

    // ---- speed ramp ----
    if (this.alive) {
      this.speed = Math.min(PLAYER.maxSpeed, this.speed + PLAYER.accel * dt);
      this.z += this.speed * dt;
    }

    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.jumpSquash += (0 - this.jumpSquash) * Math.min(1, dt * 9);

    this._animate(dt);
    this._updateShadow();
    this._updatePuffs(dt);

    this.root.position.set(this.x, this.y, this.z);
  }

  _animate(dt) {
    const spd = this.speed;
    const cadence = 1.55 + (spd / PLAYER.maxSpeed) * 1.35;
    this.runPhase += dt * cadence * Math.PI * 2 * 1.35;
    const p = this.runPhase;

    const airborne = !this.grounded;
    const roll = this.rolling && this.grounded;

    // body bob & lean
    const bob = airborne ? 0 : Math.abs(Math.sin(p)) * 0.055;
    const squash = this.jumpSquash;
    this.body.position.y = bob + (roll ? -0.34 : 0);
    this.body.scale.set(1 + squash * 0.06, 1 - squash * 0.10, 1 + squash * 0.06);
    this.body.rotation.z = this.lean * 0.5;
    this.body.rotation.y = -this.lean * 0.35;
    this.body.rotation.x = roll ? 0.85 : (airborne ? -0.14 : 0.13 + Math.sin(p * 2) * 0.02);

    // head counter-rotation
    this.head.rotation.x = roll ? -0.5 : -0.06 + Math.sin(p * 2) * 0.03;
    this.head.rotation.z = -this.lean * 0.25;
    // pigtail flop
    for (let i = 0; i < this.pigtails.length; i++) {
      const s = i === 0 ? -1 : 1;
      const pt = this.pigtails[i];
      pt.rotation.x = -0.55 + Math.sin(p * 2 + i) * 0.20 + (airborne ? -0.25 : 0);
      pt.rotation.z = s * (0.18 + Math.sin(p + i * 1.7) * 0.16) - this.lean * 0.5;
    }

    if (roll) {
      // tuck
      for (const L of this.legs) {
        L.hip.rotation.x = 1.5;
        L.knee.rotation.x = -1.9;
        L.ankle.rotation.x = 0.4;
      }
      for (const A of this.arms) {
        A.shoulder.rotation.x = 1.3;
        A.elbow.rotation.x = -1.6;
      }
      this.torso.rotation.x = 0.4;
      return;
    }
    this.torso.rotation.x = 0;

    if (airborne) {
      const up = this.vy > 0;
      // legs: front leg tucked, back leg trailing
      this.legs[0].hip.rotation.x = up ? -0.95 : -0.45;
      this.legs[0].knee.rotation.x = up ? -1.5 : -0.85;
      this.legs[0].ankle.rotation.x = 0.2;
      this.legs[1].hip.rotation.x = up ? 0.55 : 0.30;
      this.legs[1].knee.rotation.x = up ? -0.55 : -1.15;
      this.legs[1].ankle.rotation.x = 0.35;
      // arms up
      this.arms[0].shoulder.rotation.x = up ? -1.75 : -1.1;
      this.arms[0].elbow.rotation.x = -0.55;
      this.arms[1].shoulder.rotation.x = up ? -1.45 : -0.85;
      this.arms[1].elbow.rotation.x = -0.75;
      for (const A of this.arms) A.shoulder.rotation.z = A.side * 0.22;
      return;
    }

    // ---- ground run cycle ----
    for (let i = 0; i < this.legs.length; i++) {
      const L = this.legs[i];
      const ph = p + (i === 0 ? 0 : Math.PI);
      const swing = Math.sin(ph);
      const lift = Math.max(0, Math.sin(ph + 0.5));

      L.hip.rotation.x = swing * 0.92 - 0.10;
      // knee bends most during recovery
      L.knee.rotation.x = -Math.max(0.06, lift * 1.55 + 0.10);
      L.ankle.rotation.x = 0.16 - swing * 0.42;
      L.hip.rotation.z = 0;
    }
    for (let i = 0; i < this.arms.length; i++) {
      const A = this.arms[i];
      const ph = p + (i === 0 ? Math.PI : 0);
      const swing = Math.sin(ph);
      A.shoulder.rotation.x = -swing * 0.98 - 0.32;
      A.shoulder.rotation.z = A.side * (0.20 + Math.max(0, swing) * 0.10);
      A.elbow.rotation.x = -0.85 - Math.max(0, -swing) * 0.85;
    }

    // dust while running
    this.puffTimer -= dt;
    if (this.puffTimer <= 0) {
      this.puffTimer = 0.075;
      this._burstPuff(1);
    }
  }

  _burstPuff(n) {
    for (let k = 0; k < n; k++) {
      const pf = this.puffs.find((q) => q.life <= 0);
      if (!pf) return;
      pf.life = 0.55;
      pf.spr.position.set((Math.random() - 0.5) * 0.3, 0.07, -0.15 + (Math.random() - 0.5) * 0.2);
      pf.vx = (Math.random() - 0.5) * 0.7;
      pf.vy = 0.5 + Math.random() * 0.9;
      pf.vz = -1.4 - Math.random() * 2.6;
      pf.spr.scale.setScalar(0.28 + Math.random() * 0.18);
    }
  }

  _updatePuffs(dt) {
    for (const pf of this.puffs) {
      if (pf.life <= 0) { pf.spr.material.opacity = 0; continue; }
      pf.life -= dt;
      pf.spr.position.x += pf.vx * dt;
      pf.spr.position.y += pf.vy * dt;
      pf.spr.position.z += pf.vz * dt;
      pf.vy -= 0.6 * dt;
      const t = Math.max(0, pf.life / 0.55);
      pf.spr.material.opacity = t * 0.5;
      pf.spr.scale.setScalar(pf.spr.scale.x + dt * 0.85);
    }
  }

  _updateShadow() {
    const airFade = THREE.MathUtils.clamp(1 - this.y / 3.4, 0.15, 1);
    this.shadow.position.set(this.x, 0.035, this.z - 0.05);
    const s = 0.72 + airFade * 0.42;
    this.shadow.scale.set(s, s * (this.rolling ? 0.8 : 1.0), 1);
    this.shadowMat.opacity = 0.52 * airFade;
  }
}
