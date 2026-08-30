import * as THREE from 'three';
import { PAL } from '../world/palette.js';
import {
  woodTexture, metalTexture, signTexture, cactusTexture,
  rockTexture, rockNormal, softDot,
} from '../render/textures.js';
import {
  boxGeo, cylGeo, sphGeo, capsGeo, torusGeo, coneGeo, planeGeo, circleGeo,
  rockGeo, rubbleGeo, cactusBarrelGeo, saguaroTrunkGeo, geo, q,
} from '../render/geocache.js';
import { LANE_W } from '../world/constants.js';

/* ================================================================== *
 *  SHARED MATERIALS
 *
 *  Props are instantiated thousands of times per run, so every material and
 *  geometry MUST come from a cache. Per-instance variety is achieved with
 *  node-level scale/rotation and (where useful) cloned materials with only a
 *  colour tweak — never fresh textures.
 * ================================================================== */
const M = {};
function mat(key, make) { if (!M[key]) M[key] = make(); return M[key]; }
export function matStats() { return { materials: Object.keys(M).length }; }

export function woodMat(base = PAL.wood, seed = 3) {
  const v = Math.abs(seed | 0) % 4;
  return mat('w' + base + '#' + v, () => new THREE.MeshStandardMaterial({
    map: woodTexture(base, v), roughness: 0.90, metalness: 0.0,
  }));
}
export function metalMat(base = PAL.metal, rust = 0.4, seed = 5) {
  const v = Math.abs(seed | 0) % 3;
  const rq = Math.round(Math.min(1, Math.max(0, rust)) * 3) / 3;
  return mat('m' + base + '|' + rq + '#' + v, () => new THREE.MeshStandardMaterial({
    map: metalTexture(base, rq, v), roughness: 0.5, metalness: 0.72,
    envMapIntensity: 1.0,
  }));
}
export function rockMat(v = 0) {
  const k = Math.abs(v | 0) % 3;
  return mat('r' + k, () => new THREE.MeshStandardMaterial({
    map: rockTexture(k), normalMap: rockNormal(k), roughness: 0.94, metalness: 0,
  }));
}
export function flatMat(color, rough = 0.8, metal = 0.0) {
  return mat('f' + color + rough + metal, () => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
  }));
}
export function emitMat(color, intensity = 1.4) {
  return mat('e' + color + intensity, () => new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color), emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0.0,
  }));
}
function cactusMat(tint = 0) {
  const k = Math.abs(tint | 0) % 3;
  const tints = [PAL.cactus, PAL.cactusLight, PAL.cactusDark];
  return mat('cac' + k, () => new THREE.MeshStandardMaterial({
    map: cactusTexture(), roughness: 0.74, metalness: 0.0,
    color: new THREE.Color(tints[k]).lerp(new THREE.Color(0xffffff), 0.35),
  }));
}
function signMat(kind) {
  return mat('sg' + kind, () => new THREE.MeshStandardMaterial({
    map: signTexture(kind), roughness: 0.66, metalness: 0.04,
  }));
}

/* small helper: cached-geo mesh with shadows on */
function m(geometry, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  return mesh;
}

/* ================================================================== *
 *  CACTUS FAMILY
 * ================================================================== */
export function makeSaguaro(rng, scale = 1) {
  const g = new THREE.Group();
  const skin = cactusMat(rng.i(0, 2));
  const v = rng.i(0, 3);

  const h = rng.f(3.4, 6.6) * scale;
  const r = rng.f(0.26, 0.40) * scale;

  // unit trunk geometry scaled to size — one buffer for every saguaro
  const trunk = m(saguaroTrunkGeo(v), skin);
  trunk.scale.set(r, h, r);
  trunk.position.y = h / 2;
  g.add(trunk);

  const top = m(sphGeo(1, 10, 8), skin);
  top.scale.set(r * 0.87, r * 0.80, r * 0.87);
  top.position.y = h;
  g.add(top);

  const arms = rng.i(0, 3);
  for (let a = 0; a < arms; a++) {
    const side = a % 2 === 0 ? 1 : -1;
    const attachY = rng.f(0.38, 0.72) * h;
    const armLen = rng.f(0.9, 1.9) * scale;
    const armR = r * rng.f(0.62, 0.82);

    const arm = new THREE.Group();
    const seg1 = m(capsGeo(0.1, 1.0), skin);
    seg1.scale.set(armR / 0.1, armLen, armR / 0.1);
    seg1.rotation.z = side * Math.PI / 2 * rng.f(0.72, 0.95);
    seg1.position.set(side * armLen * 0.34, armLen * 0.16, 0);
    arm.add(seg1);

    const upLen = rng.f(1.0, 2.4) * scale;
    const seg2 = m(capsGeo(0.1, 1.0), skin);
    seg2.scale.set(armR / 0.1 * 0.92, upLen, armR / 0.1 * 0.92);
    seg2.position.set(side * armLen * 0.72, armLen * 0.36 + upLen / 2, 0);
    arm.add(seg2);

    const cap = m(sphGeo(1, 8, 6), skin);
    cap.scale.setScalar(armR * 0.88);
    cap.position.set(side * armLen * 0.72, armLen * 0.36 + upLen, 0);
    arm.add(cap);

    arm.position.y = attachY;
    arm.rotation.y = rng.f(0, 6.28);
    g.add(arm);
  }

  if (rng.chance(0.30)) {
    const fm = flatMat(0xf4e6a8, 0.7);
    for (let i = 0; i < rng.i(2, 5); i++) {
      const f = m(sphGeo(1, 6, 5), fm, false, false);
      f.scale.setScalar(r * 0.22);
      const ang = rng.f(0, 6.28);
      f.position.set(Math.cos(ang) * r * 0.6, h + r * 0.72, Math.sin(ang) * r * 0.6);
      g.add(f);
    }
  }
  return g;
}

export function makeBarrelCactus(rng, scale = 1) {
  const skin = cactusMat(rng.i(0, 2));
  const r = rng.f(0.32, 0.62) * scale;
  const mesh = m(cactusBarrelGeo(rng.i(0, 3)), skin);
  mesh.scale.set(r, r * rng.f(0.8, 1.35), r);
  mesh.position.y = r * 0.85;
  mesh.rotation.y = rng.f(0, 6.28);
  return mesh;
}

export function makePricklyPear(rng, scale = 1) {
  const g = new THREE.Group();
  const skin = cactusMat(1);
  const pads = rng.i(3, 7);
  for (let i = 0; i < pads; i++) {
    const w = rng.f(0.30, 0.62) * scale;
    const pad = m(sphGeo(1, 9, 7), skin);
    pad.scale.set(w, w * 1.35, w * 0.30);
    pad.position.set(rng.f(-0.5, 0.5) * scale, w * rng.f(0.9, 2.1), rng.f(-0.35, 0.35) * scale);
    pad.rotation.set(rng.f(-0.3, 0.3), rng.f(0, 6.28), rng.f(-0.45, 0.45));
    g.add(pad);
  }
  return g;
}

export function makeDryBush(rng, scale = 1) {
  const g = new THREE.Group();
  const m1 = flatMat(0x8a7340, 0.95);
  const n = rng.i(6, 12);
  for (let i = 0; i < n; i++) {
    const len = rng.f(0.25, 0.75) * scale;
    const s = m(cylGeo(0.02, 0.03, 1.0, 4), m1, false, false);
    s.scale.set(0.6, len, 0.6);
    const ang = rng.f(0, 6.28);
    const tilt = rng.f(0.5, 1.25);
    s.position.set(Math.cos(ang) * len * 0.3, len * 0.42, Math.sin(ang) * len * 0.3);
    s.rotation.set(Math.cos(ang) * tilt, 0, Math.sin(ang) * tilt);
    g.add(s);
  }
  return g;
}

export function makeTumbleweed(rng, scale = 1) {
  const g = new THREE.Group();
  const m1 = flatMat(0x9c8450, 0.96);
  const R = rng.f(0.30, 0.52) * scale;
  for (let i = 0; i < 20; i++) {
    const s = m(cylGeo(0.01, 0.015, 1.0, 3), m1, false, false);
    s.scale.set(1, R * rng.f(1.1, 1.9), 1);
    s.position.set(rng.f(-1, 1) * R * 0.4, rng.f(-1, 1) * R * 0.4, rng.f(-1, 1) * R * 0.4);
    s.rotation.set(rng.f(0, 6.28), rng.f(0, 6.28), rng.f(0, 6.28));
    g.add(s);
  }
  g.userData.radius = R;
  return g;
}

/* ================================================================== *
 *  SIGNS
 * ================================================================== */
export function makeWarningSign(rng, kind = 'falling-rocks') {
  const g = new THREE.Group();
  const postH = rng.f(2.2, 3.0);
  const post = m(cylGeo(0.07, 0.08, 1.0, 7), woodMat(PAL.woodDark, 8));
  post.scale.set(1, postH, 1);
  post.position.y = postH / 2;
  g.add(post);

  const size = kind === 'falling-rocks' ? 1.28 : 1.0;
  const edgeMat = flatMat(0x3a3128, 0.8);
  const board = new THREE.Mesh(boxGeo(size, size, 0.055),
    [edgeMat, edgeMat, edgeMat, edgeMat, signMat(kind), edgeMat]);
  board.castShadow = true;
  board.position.y = postH - size * 0.52;
  board.rotation.y = rng.f(-0.10, 0.10);
  g.add(board);

  const br = m(boxGeo(0.10, 0.10, 0.16), metalMat(PAL.metalDark, 0.6, 1), false, false);
  br.position.set(0, postH - size * 0.52, 0.09);
  g.add(br);
  return g;
}

export function makeMilepost(rng) {
  const g = new THREE.Group();
  const h = 1.05;
  const post = m(boxGeo(0.09, h, 0.09), woodMat(PAL.woodLight, 2));
  post.position.y = h / 2;
  g.add(post);
  const plate = m(boxGeo(0.36, 0.26, 0.03), flatMat(0xe8e0cc, 0.7), false, false);
  plate.position.set(0, h - 0.16, 0.055);
  g.add(plate);
  return g;
}

/* ================================================================== *
 *  LAMP POST / TELEGRAPH POLE
 * ================================================================== */
export function makeLampPost(rng, opts = {}) {
  const g = new THREE.Group();
  const h = opts.height ?? rng.f(4.2, 5.6);
  const pole = m(cylGeo(0.08, 0.11, 1.0, 8), woodMat(PAL.woodDark, 1));
  pole.scale.set(1, h, 1);
  pole.position.y = h / 2;
  g.add(pole);

  const arm = m(boxGeo(0.95, 0.08, 0.08), woodMat(PAL.woodDark, 1));
  arm.position.y = h - 0.28;
  g.add(arm);

  for (const s of [-1, 1]) {
    const ins = m(cylGeo(0.05, 0.05, 0.10, 6), flatMat(0x5c7b8c, 0.55), false, false);
    ins.position.set(s * 0.40, h - 0.20, 0);
    g.add(ins);
  }

  const lg = new THREE.Group();
  const cage = m(cylGeo(0.16, 0.20, 0.30, 6), metalMat(PAL.metalDark, 0.7, 2), true, false);
  lg.add(cage);
  const glass = m(sphGeo(0.15, 10, 8), emitMat(PAL.lampGlass, 2.8), false, false);
  lg.add(glass);
  const hood = m(coneGeo(0.24, 0.14, 7), metalMat(PAL.metalDark, 0.7, 2), true, false);
  hood.position.y = 0.21;
  lg.add(hood);
  lg.position.set(0, h - 0.48, 0.06);
  g.add(lg);

  const spr = new THREE.Sprite(mat('lampGlow', () => new THREE.SpriteMaterial({
    map: softDot(PAL.lampGlass, 0.12),
    color: 0xffd08a, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
  })).clone());
  spr.scale.setScalar(2.1);
  spr.position.copy(lg.position);
  g.add(spr);
  g.userData.glow = spr;
  return g;
}

export function makeTelegraphPole(rng) {
  const g = new THREE.Group();
  const h = rng.f(5.5, 7.6);
  const pole = m(cylGeo(0.09, 0.14, 1.0, 7), woodMat(PAL.woodDark, 1));
  pole.scale.set(1, h, 1);
  pole.position.y = h / 2;
  g.add(pole);
  const wm = woodMat(PAL.woodDark, 1);
  const im = flatMat(0x4f6f80, 0.5);
  for (let i = 0; i < 2; i++) {
    const arm = m(boxGeo(1.5, 0.09, 0.09), wm);
    arm.position.y = h - 0.35 - i * 0.62;
    g.add(arm);
    for (const s of [-1, 1]) {
      const ins = m(cylGeo(0.05, 0.06, 0.12, 6), im, false, false);
      ins.position.set(s * 0.65, h - 0.27 - i * 0.62, 0);
      g.add(ins);
    }
  }
  return g;
}

/* ================================================================== *
 *  OBSTACLES
 * ================================================================== */
export function makeBarrier(rng) {
  const g = new THREE.Group();
  const w = LANE_W * 0.86;
  const h = 0.86;
  const wm = woodMat(PAL.wood, 0);
  const wmD = woodMat(PAL.woodDark, 3);

  for (let i = 0; i < 3; i++) {
    const plank = m(boxGeo(w, 0.20, 0.10), wm);
    plank.position.set(0, 0.24 + i * 0.28, 0);
    plank.rotation.z = rng.f(-0.012, 0.012);
    g.add(plank);
  }
  for (const s of [-1, 1]) {
    const post = m(boxGeo(0.13, h + 0.10, 0.13), wmD);
    post.position.set(s * w * 0.46, (h + 0.10) / 2, 0);
    g.add(post);
  }
  const stripe = new THREE.Mesh(planeGeo(w, 0.20), signMat('chevron'));
  stripe.position.set(0, 0.24 + 2 * 0.28, -0.053);
  stripe.rotation.y = Math.PI;
  g.add(stripe);

  g.userData.hit = { w, h, d: 0.42, type: 'jump' };
  return g;
}

export function makeCrateStack(rng, tall = false) {
  const g = new THREE.Group();
  const wm = woodMat(PAL.crate, 0);
  const wmD = woodMat(PAL.woodDark, 3);
  const count = tall ? rng.i(3, 4) : rng.i(1, 2);
  let y = 0, maxW = 0;
  for (let i = 0; i < count; i++) {
    const s = q(rng.f(0.62, 0.86), 0.08);
    const box = new THREE.Group();
    box.add(m(boxGeo(s, s * 0.86, s), wm));
    const t = 0.045;
    for (const sy of [s * 0.43, -s * 0.43]) {
      const e = m(boxGeo(s * 1.02, t, s * 1.02), wmD, false, false);
      e.position.y = sy;
      box.add(e);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const e = m(boxGeo(t, s * 0.9, t), wmD, false, false);
      e.position.set(sx * s * 0.48, 0, sz * s * 0.48);
      box.add(e);
    }
    box.position.set(rng.f(-0.08, 0.08), y + s * 0.43, rng.f(-0.08, 0.08));
    box.rotation.y = rng.f(-0.24, 0.24);
    g.add(box);
    y += s * 0.86;
    maxW = Math.max(maxW, s);
  }
  g.userData.hit = { w: maxW, h: y, d: maxW, type: tall ? 'dodge' : 'jump' };
  return g;
}

export function makeRamp(rng) {
  const g = new THREE.Group();
  const w = LANE_W * 0.92;
  const len = 3.0;
  const h = 1.15;

  // wedge geometry is identical every time -> cache it once
  const wedgeGeo = geo(`ramp|${q(w,0.05)}|${len}|${h}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, h); shape.closePath();
    const gg = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    gg.rotateY(-Math.PI / 2);
    gg.translate(w / 2, 0, -len / 2);
    gg.computeVertexNormals();
    return gg;
  });
  g.add(m(wedgeGeo, woodMat(PAL.woodLight, 2)));

  const slopeLen = Math.hypot(len, h);
  const ang = Math.atan2(h, len);
  const plankMat = woodMat(PAL.wood, 0);
  for (let i = 0; i < 7; i++) {
    const plank = m(boxGeo(w * 0.98, 0.05, slopeLen / 7 * 0.9), plankMat, true, false);
    const t = (i + 0.5) / 7;
    plank.position.set(0, h * t + 0.03, -len / 2 + len * t);
    plank.rotation.x = -ang;
    g.add(plank);
  }

  const face = new THREE.Mesh(planeGeo(w, h * 1.02), signMat('chevron'));
  face.position.set(0, h / 2, len / 2 + 0.01);
  g.add(face);

  const railMat = woodMat(PAL.woodDark, 3);
  for (const s of [-1, 1]) {
    const rail = m(boxGeo(0.09, 0.14, slopeLen), railMat, true, false);
    rail.position.set(s * w * 0.49, h * 0.5 + 0.10, 0);
    rail.rotation.x = -ang;
    g.add(rail);
  }

  g.userData.hit = { w, h, d: len, type: 'ramp' };
  g.userData.rampLen = len;
  g.userData.rampH = h;
  return g;
}

export function makeOverheadBeam(rng, span = LANE_W * 1.05) {
  const g = new THREE.Group();
  const y = 1.42;
  const beam = m(boxGeo(span, 0.34, 0.30), woodMat(PAL.woodDark, 3));
  beam.position.y = y + 0.17;
  g.add(beam);
  const chMat = metalMat(PAL.metalDark, 0.8, 0);
  for (const s of [-0.32, 0.32]) {
    const ch = m(cylGeo(0.02, 0.02, 0.36, 5), chMat, false, false);
    ch.position.set(s * span, y + 0.36, 0);
    g.add(ch);
  }
  const tape = new THREE.Mesh(planeGeo(span, 0.16), signMat('chevron'));
  tape.position.set(0, y + 0.17, 0.16);
  g.add(tape);
  g.userData.hit = { w: span, h: 0.4, d: 0.32, type: 'roll', clearY: y };
  return g;
}

export function makeRockPile(rng, scale = 1) {
  const g = new THREE.Group();
  const rm = rockMat(rng.i(0, 2));
  const n = rng.i(3, 6);
  let maxH = 0;
  for (let i = 0; i < n; i++) {
    const s = rng.f(0.36, 0.78) * scale;
    const rock = m(rubbleGeo(rng.i(0, 5)), rm);
    rock.scale.setScalar(s);
    rock.position.set(rng.f(-0.6, 0.6) * scale, s * rng.f(0.5, 0.9), rng.f(-0.4, 0.4) * scale);
    rock.rotation.set(rng.f(0, 6.28), rng.f(0, 6.28), rng.f(0, 6.28));
    g.add(rock);
    maxH = Math.max(maxH, rock.position.y + s * 0.7);
  }
  g.userData.hit = { w: LANE_W * 0.8, h: maxH, d: 1.0 * scale, type: 'dodge' };
  return g;
}

/* ================================================================== *
 *  SET PIECES
 * ================================================================== */
export function makeWaterTower(rng) {
  const g = new THREE.Group();
  const legH = rng.f(4.0, 5.4);
  const tankR = rng.f(1.5, 2.1);
  const tankH = rng.f(2.2, 3.0);
  const wm = woodMat(PAL.woodDark, 1);

  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = m(boxGeo(0.16, 1.0, 0.16), wm);
    leg.scale.y = legH;
    leg.position.set(Math.cos(ang) * tankR * 0.72, legH / 2, Math.sin(ang) * tankR * 0.72);
    leg.rotation.y = ang;
    leg.rotation.z = Math.cos(ang) * 0.05;
    g.add(leg);
  }
  const braceLen = tankR * 0.72 * Math.SQRT2 * 1.02;
  for (let lvl = 1; lvl <= 2; lvl++) {
    const y = (legH / 3) * lvl;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      const ax = Math.cos(a0) * tankR * 0.72, az = Math.sin(a0) * tankR * 0.72;
      const bx = Math.cos(a1) * tankR * 0.72, bz = Math.sin(a1) * tankR * 0.72;
      const br = m(boxGeo(0.08, 0.08, braceLen), wm, false, false);
      br.position.set((ax + bx) / 2, y, (az + bz) / 2);
      br.rotation.y = Math.atan2(bx - ax, bz - az);
      g.add(br);
    }
  }
  const tank = m(cylGeo(1, 1, 1, 16), woodMat(PAL.wood, 0));
  tank.scale.set(tankR, tankH, tankR);
  tank.position.y = legH + tankH / 2;
  g.add(tank);
  const hoopMat = metalMat(PAL.metalDark, 0.65, 1);
  for (const t of [0.18, 0.5, 0.82]) {
    const hoop = m(torusGeo(1, 0.045, 6, 20), hoopMat, false, false);
    hoop.scale.set(tankR * 1.01, tankR * 1.01, 1);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = legH + tankH * t;
    g.add(hoop);
  }
  const roof = m(coneGeo(1, 1, 16), metalMat(PAL.rust, 0.85, 0));
  roof.scale.set(tankR * 1.12, tankR * 0.62, tankR * 1.12);
  roof.position.y = legH + tankH + tankR * 0.31;
  g.add(roof);
  const spout = m(cylGeo(0.13, 0.16, 2.0, 8), metalMat(PAL.metalDark, 0.7, 1), true, false);
  spout.position.set(tankR * 0.9, legH + 0.4, 0);
  spout.rotation.z = 0.85;
  g.add(spout);
  return g;
}

export function makeWindmill(rng) {
  const g = new THREE.Group();
  const h = rng.f(5.5, 8.0);
  const wm = metalMat(PAL.metalDark, 0.7, 0);
  const base = 0.95, topR = 0.28;
  const legLen = Math.hypot(base - topR, h);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = m(cylGeo(0.05, 0.07, 1.0, 5), wm, true, false);
    leg.scale.y = legLen;
    leg.position.set(Math.cos(ang) * (base + topR) / 2, h / 2, Math.sin(ang) * (base + topR) / 2);
    leg.rotation.z = Math.atan2(base - topR, h) * -Math.cos(ang);
    leg.rotation.x = Math.atan2(base - topR, h) * Math.sin(ang);
    g.add(leg);
  }
  for (let lvl = 1; lvl < 6; lvl++) {
    const t = lvl / 6;
    const r = base + (topR - base) * t;
    const ring = m(torusGeo(1, 0.028, 4, 4), wm, false, false);
    ring.scale.set(r * 1.02, r * 1.02, 1);
    ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 4;
    ring.position.y = h * t;
    g.add(ring);
  }
  const rotor = new THREE.Group();
  const hub = m(cylGeo(0.16, 0.16, 0.14, 10), wm, false, false);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  const bladeMat = metalMat(PAL.trainGrey, 0.5, 1);
  const N = 14;
  for (let i = 0; i < N; i++) {
    const blade = m(boxGeo(0.20, 0.62, 0.02), bladeMat, false, false);
    const ang = (i / N) * Math.PI * 2;
    blade.position.set(Math.cos(ang) * 0.62, Math.sin(ang) * 0.62, 0.02);
    blade.rotation.z = ang + Math.PI / 2;
    blade.rotation.y = 0.35;
    rotor.add(blade);
  }
  const rim = m(torusGeo(0.95, 0.026, 5, 22), wm, false, false);
  rotor.add(rim);
  rotor.position.set(0, h + 0.2, 0.35);
  g.add(rotor);
  g.userData.rotor = rotor;
  const vane = m(boxGeo(0.05, 0.7, 1.0), bladeMat, true, false);
  vane.position.set(0, h + 0.2, -1.15);
  g.add(vane);
  const boom = m(boxGeo(0.06, 0.06, 1.5), wm, false, false);
  boom.position.set(0, h + 0.2, -0.5);
  g.add(boom);
  return g;
}

export function makeMineHeadframe(rng) {
  const g = new THREE.Group();
  const h = rng.f(6.0, 8.5);
  const wm = woodMat(PAL.woodDark, 1);
  const mm = metalMat(PAL.rust, 0.85, 0);

  for (const s of [-1, 1]) {
    const len = Math.hypot(h, 2.0);
    const leg = m(boxGeo(0.20, 1.0, 0.20), wm);
    leg.scale.y = len;
    leg.position.set(s * 1.0, h / 2, 0);
    leg.rotation.z = -s * Math.atan2(2.0, h);
    g.add(leg);
  }
  for (const s of [-1, 1]) {
    const len = Math.hypot(h * 0.95, 3.4);
    const br = m(boxGeo(0.16, 1.0, 0.16), wm, true, false);
    br.scale.y = len;
    br.position.set(s * 0.6, h * 0.48, -1.7);
    br.rotation.x = Math.atan2(3.4, h * 0.95);
    br.rotation.z = -s * 0.08;
    g.add(br);
  }
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const w = Math.max(0.5, 2.0 * (1 - t) * 2);
    const r = m(boxGeo(w, 0.10, 0.10), wm, false, false);
    r.position.y = h * t;
    g.add(r);
  }
  const wheel = m(torusGeo(0.95, 0.13, 8, 22), mm, true, false);
  wheel.position.y = h + 0.2;
  g.add(wheel);
  for (let i = 0; i < 6; i++) {
    const spoke = m(boxGeo(0.07, 1.85, 0.07), mm, false, false);
    spoke.position.y = h + 0.2;
    spoke.rotation.z = (i / 6) * Math.PI;
    g.add(spoke);
  }
  g.userData.wheel = wheel;
  return g;
}

export function makeMineCart(rng) {
  const g = new THREE.Group();
  const body = m(boxGeo(0.86, 0.62, 1.30), metalMat(PAL.rust, 0.9, 0));
  body.position.y = 0.62;
  g.add(body);
  const oreMat = rockMat(1);
  for (let i = 0; i < 6; i++) {
    const o = m(rubbleGeo(rng.i(0, 5)), oreMat, false, false);
    o.scale.setScalar(rng.f(0.10, 0.20));
    o.position.set(rng.f(-0.3, 0.3), 0.90 + rng.f(0, 0.08), rng.f(-0.5, 0.5));
    o.rotation.set(rng.f(0, 6), rng.f(0, 6), rng.f(0, 6));
    g.add(o);
  }
  const wm = metalMat(PAL.metalDark, 0.8, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = m(cylGeo(0.20, 0.20, 0.07, 12), wm, false, false);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.46, 0.20, sz * 0.44);
    g.add(w);
  }
  g.rotation.y = rng.f(-0.3, 0.3);
  return g;
}

export function makeShack(rng) {
  const g = new THREE.Group();
  const w = q(rng.f(2.6, 4.2), 0.4), d = q(rng.f(2.4, 3.6), 0.4), h = q(rng.f(2.2, 3.0), 0.2);
  const wm = woodMat(PAL.wood, 0);
  const wmD = woodMat(PAL.woodDark, 3);
  const body = m(boxGeo(w, h, d), wm);
  body.position.y = h / 2;
  g.add(body);
  for (let i = 1; i < 6; i++) {
    const seam = m(boxGeo(w * 1.005, 0.035, d * 1.005), wmD, false, false);
    seam.position.y = (h / 6) * i;
    g.add(seam);
  }
  const roofMat = metalMat(PAL.rust, 0.9, 0);
  const roof = m(boxGeo(w * 1.18, 0.09, d * 1.20), roofMat);
  roof.position.y = h + 0.2;
  roof.rotation.x = 0.10;
  g.add(roof);
  for (let i = 0; i < 10; i++) {
    const rib = m(boxGeo(0.05, 0.05, d * 1.19), roofMat, false, false);
    rib.position.set(-w * 0.59 + (i / 9) * w * 1.18, h + 0.26, 0);
    rib.rotation.x = 0.10;
    g.add(rib);
  }
  const door = m(boxGeo(0.82, 1.75, 0.06), wmD, false, false);
  door.position.set(0, 0.88, d / 2 + 0.03);
  g.add(door);
  const win = new THREE.Mesh(planeGeo(0.62, 0.52), emitMat(0xffcf85, 1.6));
  win.position.set(w * 0.29, h * 0.62, d / 2 + 0.035);
  g.add(win);
  g.rotation.y = rng.f(-0.4, 0.4);
  return g;
}

export function makeBarrel(rng) {
  const g = new THREE.Group();
  const r = 0.30, h = 0.78;
  const body = m(cylGeo(r, r * 0.92, h, 12), woodMat(PAL.wood, 0));
  body.position.y = h / 2;
  g.add(body);
  const hm = metalMat(PAL.metalDark, 0.7, 1);
  for (const t of [0.22, 0.78]) {
    const hoop = m(torusGeo(r * 1.02, 0.028, 5, 14), hm, false, false);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = h * t;
    g.add(hoop);
  }
  g.rotation.y = rng.f(0, 6.28);
  return g;
}

export function makeSkull(rng) {
  const g = new THREE.Group();
  const bm = flatMat(0xe6ddc4, 0.85);
  const sk = m(sphGeo(0.20, 9, 7), bm, true, false);
  sk.scale.set(1, 0.85, 1.25);
  sk.position.y = 0.18;
  g.add(sk);
  for (const s of [-1, 1]) {
    const horn = m(torusGeo(0.16, 0.035, 5, 10, Math.PI * 1.1), bm, false, false);
    horn.position.set(s * 0.18, 0.26, 0);
    horn.rotation.set(Math.PI / 2, 0, s * 0.9);
    g.add(horn);
  }
  g.rotation.y = rng.f(0, 6.28);
  return g;
}

/* ================================================================== *
 *  ROCK FORMATIONS (shared-geometry versions)
 * ================================================================== */
export function makeBoulder(rng, size = 1) {
  const mesh = m(rockGeo(rng.i(0, 7), 1), rockMat(rng.i(0, 2)));
  mesh.scale.setScalar(size);
  mesh.rotation.set(rng.f(0, 6.28), rng.f(0, 6.28), rng.f(0, 6.28));
  return mesh;
}

export function makeHoodoo(rng, scale = 1) {
  const g = new THREE.Group();
  const rm = rockMat(rng.i(0, 2));
  let y = 0;
  const tiers = rng.i(4, 6);
  let r = rng.f(0.9, 1.6) * scale;
  for (let i = 0; i < tiers; i++) {
    const h = rng.f(0.7, 2.0) * scale;
    const rTop = r * rng.f(0.55, 0.95);
    const tier = m(cylGeo(1, 1, 1, 8), rm);
    tier.scale.set(rTop, h, rTop);
    // slight asymmetry via non-uniform scale + rotation instead of new geometry
    tier.scale.x *= rng.f(0.88, 1.14);
    tier.scale.z *= rng.f(0.88, 1.14);
    tier.position.set(rng.f(-0.1, 0.1) * scale, y + h / 2, rng.f(-0.1, 0.1) * scale);
    tier.rotation.y = rng.f(0, 6.28);
    g.add(tier);
    y += h * 0.96;
    r = rTop * rng.f(1.0, 1.45);
  }
  const cap = m(rockGeo(rng.i(0, 7), 1), rm);
  cap.scale.set(r * 1.35, r * 0.75, r * 1.35);
  cap.position.y = y + r * 0.35;
  g.add(cap);
  return g;
}

export function makeArch(rng, scale = 1) {
  const g = new THREE.Group();
  const rm = rockMat(1);
  const span = q(rng.f(9, 15) * scale, 1.0);
  const h = q(rng.f(9, 14) * scale, 1.0);
  const thick = q(rng.f(1.6, 2.8) * scale, 0.4);

  for (const s of [-1, 1]) {
    const leg = m(cylGeo(1, 1, 1, 8), rm);
    leg.scale.set(thick * 1.4, h, thick * 1.4);
    leg.position.set(s * span / 2, h / 2, 0);
    leg.rotation.y = rng.f(0, 6.28);
    g.add(leg);
  }
  const tube = geo(`arch|${span}|${h}|${thick}`, () => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-span / 2, h * 0.94, 0),
      new THREE.Vector3(-span * 0.26, h * 1.22, 0),
      new THREE.Vector3(0, h * 1.34, 0),
      new THREE.Vector3(span * 0.26, h * 1.22, 0),
      new THREE.Vector3(span / 2, h * 0.94, 0),
    ]);
    return new THREE.TubeGeometry(curve, 20, thick * 1.05, 8, false);
  });
  g.add(m(tube, rm));
  return g;
}
