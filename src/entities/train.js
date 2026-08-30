import * as THREE from 'three';
import { PAL } from '../world/palette.js';
import { trainSideTexture, trainFrontTexture, metalTexture, softDot } from '../render/textures.js';
import { metalMat, flatMat, emitMat } from './props.js';
import { boxGeo, cylGeo, torusGeo, circleGeo, planeGeo, geo, q } from '../render/geocache.js';
import { LANE_W } from '../world/constants.js';

/**
 * Train construction.
 *  - Modern subway car (blue) matching the reference left lane
 *  - Freight boxcar (green/grey)
 *  - Diesel loco with hood, cab, exhaust stack
 *  - Flatbed with crates
 *
 * Each car: rounded body (BoxGeometry with bevel-ish scaling), roof detail,
 * bogies with visible wheels, coupler, side textures with windows/livery,
 * headlights (emissive + sprite glow), and a soft blob contact shadow.
 */

const CAR_W = LANE_W * 0.90;
const CAR_H = 2.72;

/**
 * Rounded-box car shell. Car lengths are randomised per-car, so we quantise
 * the length to 0.5m buckets; a handful of buffers then serve every car in the
 * game instead of one per car.
 */
function roundedBoxGeometry(wIn, hIn, dIn, r = 0.18, seg = 3) {
  const w = q(wIn, 0.05), h = q(hIn, 0.05), d = q(dIn, 0.5);
  return geo(`rbox|${w}|${h}|${d}|${r}`, () => buildRoundedBox(w, h, d, r, seg));
}

function buildRoundedBox(w, h, d, r, seg) {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, Math.max(3, Math.round(d / 2)));
  const p = geo.attributes.position;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // round the vertical edges along the length (x-y corners)
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ax > hw - r && ay > hh - r) {
      const cx = Math.sign(x) * (hw - r), cy = Math.sign(y) * (hh - r);
      const dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy) || 1;
      x = cx + (dx / l) * r;
      y = cy + (dy / l) * r;
      p.setXY(i, x, y);
    }
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makeBogie(rng, w, opts = {}) {
  const g = new THREE.Group();
  const frameMat = metalMat(PAL.metalDark, 0.55, 61);
  const wheelMat = metalMat(0x3a3f46, 0.6, 62);
  const frame = new THREE.Mesh(boxGeo(w * 0.86, 0.26, 1.9), frameMat);
  frame.position.y = 0.42;
  g.add(frame);
  const wheels = [];
  for (const sz of [-0.62, 0.62]) {
    for (const sx of [-1, 1]) {
      const wh = new THREE.Mesh(cylGeo(0.34, 0.34, 0.10, 16), wheelMat);
      wh.rotation.z = Math.PI / 2;
      wh.position.set(sx * w * 0.40, 0.34, sz);
      wh.castShadow = true;
      g.add(wh);
      wheels.push(wh);
      // wheel face detail ring
      const ring = new THREE.Mesh(torusGeo(0.22, 0.028, 5, 12), metalMat(PAL.metal, 0.4, 63));
      ring.position.copy(wh.position);
      ring.position.x += sx * 0.055;
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
    }
    // axle
    const ax = new THREE.Mesh(cylGeo(0.055, 0.055, w * 0.82, 8), wheelMat);
    ax.rotation.z = Math.PI / 2;
    ax.position.set(0, 0.34, sz);
    g.add(ax);
  }
  // brake cylinders
  for (const sx of [-1, 1]) {
    const bc = new THREE.Mesh(cylGeo(0.075, 0.075, 0.3, 8), frameMat);
    bc.rotation.z = Math.PI / 2;
    bc.position.set(sx * w * 0.3, 0.58, 0);
    g.add(bc);
  }
  g.userData.wheels = wheels;
  return g;
}

function addCoupler(g, w, z) {
  const mm = metalMat(PAL.metalDark, 0.6, 64);
  const shank = new THREE.Mesh(boxGeo(0.16, 0.16, 0.42), mm);
  shank.position.set(0, 0.62, z);
  g.add(shank);
  const knuckle = new THREE.Mesh(boxGeo(0.32, 0.26, 0.18), mm);
  knuckle.position.set(0, 0.62, z + Math.sign(z) * 0.28);
  g.add(knuckle);
}

function addRoofDetail(g, w, len, h, rng, style = 'subway') {
  const mm = metalMat(PAL.metalDark, 0.5, 65);
  if (style === 'subway') {
    // AC units + vents
    const n = Math.max(2, Math.floor(len / 4.5));
    for (let i = 0; i < n; i++) {
      const z = -len / 2 + (i + 0.5) * (len / n);
      const ac = new THREE.Mesh(boxGeo(w * 0.62, 0.24, 1.35), mm);
      ac.position.set(0, h + 0.12, z);
      ac.castShadow = true;
      g.add(ac);
      // fins
      for (let f = 0; f < 5; f++) {
        const fin = new THREE.Mesh(boxGeo(w * 0.63, 0.03, 0.05), metalMat(PAL.metal, 0.3, 66));
        fin.position.set(0, h + 0.245, z - 0.5 + f * 0.25);
        g.add(fin);
      }
    }
    // pantograph-ish cable run
    const cable = new THREE.Mesh(boxGeo(0.06, 0.06, len * 0.92), mm);
    cable.position.set(w * 0.28, h + 0.06, 0);
    g.add(cable);
  } else if (style === 'freight') {
    // catwalk + hatches
    const walk = new THREE.Mesh(boxGeo(w * 0.42, 0.05, len * 0.96), metalMat(PAL.rust, 0.9, 67));
    walk.position.set(0, h + 0.04, 0);
    g.add(walk);
    const n = Math.max(2, Math.floor(len / 3.2));
    for (let i = 0; i < n; i++) {
      const z = -len / 2 + (i + 0.5) * (len / n);
      const hatch = new THREE.Mesh(cylGeo(0.28, 0.28, 0.12, 10), metalMat(PAL.rust, 0.9, 68));
      hatch.position.set(0, h + 0.10, z);
      g.add(hatch);
    }
  } else if (style === 'loco') {
    // exhaust stack + horn
    const stack = new THREE.Mesh(cylGeo(0.20, 0.24, 0.34, 10), mm);
    stack.position.set(0, h + 0.16, -len * 0.18);
    g.add(stack);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 8), metalMat(PAL.trainGrey, 0.4, 69));
    horn.rotation.x = Math.PI / 2 + 0.2;
    horn.position.set(0.22, h + 0.14, -len * 0.32);
    g.add(horn);
    const fan = new THREE.Mesh(cylGeo(0.32, 0.32, 0.10, 12), mm);
    fan.position.set(0, h + 0.06, len * 0.10);
    g.add(fan);
  }
}

function addSideRibs(g, w, len, h, count, matr) {
  for (let i = 0; i < count; i++) {
    const z = -len / 2 + (i + 0.5) * (len / count);
    for (const s of [-1, 1]) {
      const rib = new THREE.Mesh(boxGeo(0.05, h * 0.80, 0.09), matr);
      rib.position.set(s * (w / 2 + 0.02), h * 0.52, z);
      g.add(rib);
    }
  }
}

function addHeadlights(g, w, h, z, dir = 1) {
  const grp = new THREE.Group();
  for (const sx of [-1, 1]) {
    const housing = new THREE.Mesh(cylGeo(0.16, 0.19, 0.12, 12), metalMat(PAL.metalDark, 0.5, 70));
    housing.rotation.x = Math.PI / 2;
    housing.position.set(sx * w * 0.30, h * 0.42, z);
    grp.add(housing);
    const lens = new THREE.Mesh(circleGeo(0.145, 14), emitMat(PAL.trainLight, 3.2));
    lens.position.set(sx * w * 0.30, h * 0.42, z + dir * 0.07);
    if (dir < 0) lens.rotation.y = Math.PI;
    grp.add(lens);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot(0xfff0c0, 0.10), color: 0xffeeb8,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
    }));
    spr.scale.setScalar(1.55);
    spr.position.set(sx * w * 0.30, h * 0.42, z + dir * 0.12);
    grp.add(spr);
  }
  // marker light strip
  const strip = new THREE.Mesh(boxGeo(w * 0.34, 0.06, 0.04), emitMat(0xffd070, 2.0));
  strip.position.set(0, h * 0.80, z + dir * 0.03);
  grp.add(strip);
  g.add(grp);
  return grp;
}

function addBlobShadow(g, w, len) {
  const geo = planeGeo(w * 1.7, len * 1.02, 0.5);
  const mtl = new THREE.MeshBasicMaterial({
    color: 0x3a1608, transparent: true, opacity: 0.34, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mtl);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.035;
  g.add(m);
}

/* ================================================================== *
 *  CAR FACTORIES
 * ================================================================== */

export function makeSubwayCar(rng, opts = {}) {
  const len = opts.len ?? rng.f(8.5, 11.5);
  const body = opts.body ?? PAL.trainBlue;
  const g = new THREE.Group();

  const geo = roundedBoxGeometry(CAR_W, CAR_H, len, 0.26);
  const sideTex = trainSideTexture(body, PAL.trainRoof, opts.seed ?? 2, {
    windows: Math.max(4, Math.round(len / 1.45)),
    stripe: opts.stripe ?? 0xffd24a,
    stripeY: 152,
  });
  const sideTexA = sideTex.clone();
  sideTexA.repeat.set(len / 11, 1);
  sideTexA.needsUpdate = true;
  const frontTex = trainFrontTexture(body, PAL.trainRoof, (opts.seed ?? 2) + 5);

  const sideMat = new THREE.MeshStandardMaterial({
    map: sideTexA, roughness: 0.42, metalness: 0.32, envMapIntensity: 1.1,
  });
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex, roughness: 0.40, metalness: 0.32, envMapIntensity: 1.1,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PAL.trainRoof), roughness: 0.72, metalness: 0.42,
  });
  const underMat = flatMat(0x1c1f24, 0.9, 0.2);

  // Box material order: +x, -x, +y, -y, +z, -z
  const mats = [sideMat, sideMat, roofMat, underMat, frontMat, frontMat];
  const shell = new THREE.Mesh(geo, mats);
  shell.position.y = CAR_H / 2 + 0.72;
  shell.castShadow = true; shell.receiveShadow = true;
  g.add(shell);

  // skirt
  const skirt = new THREE.Mesh(boxGeo(CAR_W * 1.02, 0.5, len * 0.98, 0.5), underMat);
  skirt.position.y = 0.62;
  skirt.castShadow = true;
  g.add(skirt);

  addRoofDetail(g, CAR_W, len, CAR_H + 0.72, rng, 'subway');
  addSideRibs(g, CAR_W, len, CAR_H + 0.5, Math.max(3, Math.round(len / 2.6)), metalMat(body, 0.2, 71));

  // bogies
  for (const sz of [-1, 1]) {
    const b = makeBogie(rng, CAR_W);
    b.position.z = sz * (len / 2 - 1.7);
    g.add(b);
  }
  addCoupler(g, CAR_W, len / 2 + 0.1);
  addCoupler(g, CAR_W, -len / 2 - 0.1);
  addHeadlights(g, CAR_W, CAR_H + 0.72, len / 2 + 0.02, 1);
  addBlobShadow(g, CAR_W, len);

  g.userData.len = len;
  return g;
}

export function makeFreightCar(rng, opts = {}) {
  const len = opts.len ?? rng.f(7.5, 10.0);
  const body = opts.body ?? (rng.chance(0.5) ? PAL.trainGreen : PAL.trainGrey);
  const g = new THREE.Group();

  const geo = roundedBoxGeometry(CAR_W, CAR_H * 0.94, len, 0.14);
  const sideTex = trainSideTexture(body, PAL.trainRoof, (opts.seed ?? 8), {
    windows: 0, stripe: 0x2c2f34, stripeY: 196,
  });
  // freight has no windows: regenerate a plate-look side
  const sideMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(body),
    map: metalTexture(body, 0.65, (opts.seed ?? 8) + 3),
    roughness: 0.66, metalness: 0.46,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PAL.rust), roughness: 0.9, metalness: 0.3,
  });
  const underMat = flatMat(0x1c1f24, 0.9, 0.2);
  const endMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(body).multiplyScalar(0.86),
    map: metalTexture(body, 0.8, (opts.seed ?? 8) + 9),
    roughness: 0.7, metalness: 0.4,
  });

  const shell = new THREE.Mesh(geo, [sideMat, sideMat, roofMat, underMat, endMat, endMat]);
  shell.position.y = (CAR_H * 0.94) / 2 + 0.78;
  shell.castShadow = true; shell.receiveShadow = true;
  g.add(shell);

  // sliding door frames
  const dm = metalMat(PAL.metalDark, 0.7, 72);
  for (const s of [-1, 1]) {
    const frame = new THREE.Mesh(boxGeo(0.06, CAR_H * 0.7, 2.4), dm);
    frame.position.set(s * (CAR_W / 2 + 0.03), CAR_H * 0.5 + 0.78, 0);
    g.add(frame);
    for (const dz of [-1.2, 1.2]) {
      const rail = new THREE.Mesh(boxGeo(0.08, 0.09, 0.09), dm);
      rail.position.set(s * (CAR_W / 2 + 0.05), CAR_H * 0.86 + 0.78, dz);
      g.add(rail);
    }
  }

  addRoofDetail(g, CAR_W, len, CAR_H * 0.94 + 0.78, rng, 'freight');
  addSideRibs(g, CAR_W, len, CAR_H * 0.9, Math.max(4, Math.round(len / 1.9)), metalMat(PAL.rust, 0.8, 73));

  const skirt = new THREE.Mesh(boxGeo(CAR_W * 1.0, 0.42, len * 0.98, 0.5), underMat);
  skirt.position.y = 0.68;
  g.add(skirt);

  for (const sz of [-1, 1]) {
    const b = makeBogie(rng, CAR_W);
    b.position.z = sz * (len / 2 - 1.6);
    g.add(b);
  }
  addCoupler(g, CAR_W, len / 2 + 0.1);
  addCoupler(g, CAR_W, -len / 2 - 0.1);
  addBlobShadow(g, CAR_W, len);
  g.userData.len = len;
  return g;
}

export function makeDieselLoco(rng, opts = {}) {
  const len = opts.len ?? rng.f(11.0, 13.0);
  const body = opts.body ?? PAL.trainYellow;
  const g = new THREE.Group();
  const underMat = flatMat(0x1c1f24, 0.9, 0.2);

  // long hood (rear 2/3)
  const hoodLen = len * 0.62;
  const hoodH = CAR_H * 0.72;
  const hoodGeo = roundedBoxGeometry(CAR_W * 0.86, hoodH, hoodLen, 0.18);
  const hoodTex = metalTexture(body, 0.5, (opts.seed ?? 12));
  const hoodMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(body), map: hoodTex, roughness: 0.5, metalness: 0.5,
  });
  const hood = new THREE.Mesh(hoodGeo, hoodMat);
  hood.position.set(0, hoodH / 2 + 1.05, -len / 2 + hoodLen / 2);
  hood.castShadow = true; hood.receiveShadow = true;
  g.add(hood);

  // radiator grilles on hood sides
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const gr = new THREE.Mesh(boxGeo(0.05, hoodH * 0.42, 0.62), metalMat(PAL.metalDark, 0.6, 74));
      gr.position.set(s * (CAR_W * 0.43 + 0.03), 1.05 + hoodH * 0.55, -len / 2 + 1.2 + i * 1.55);
      g.add(gr);
    }
  }

  // cab (front)
  const cabLen = len * 0.30;
  const cabH = CAR_H * 1.02;
  const cabGeo = roundedBoxGeometry(CAR_W * 0.94, cabH, cabLen, 0.22);
  const cabTex = trainFrontTexture(body, PAL.trainRoof, (opts.seed ?? 12) + 1);
  const cabSide = new THREE.MeshStandardMaterial({
    map: trainSideTexture(body, PAL.trainRoof, (opts.seed ?? 12) + 2, { windows: 2, stripe: 0x2c2f34, stripeY: 200 }),
    roughness: 0.46, metalness: 0.4,
  });
  const cabFront = new THREE.MeshStandardMaterial({ map: cabTex, roughness: 0.44, metalness: 0.4 });
  const cabRoof = new THREE.MeshStandardMaterial({ color: new THREE.Color(PAL.trainRoof), roughness: 0.7, metalness: 0.4 });
  const cab = new THREE.Mesh(cabGeo, [cabSide, cabSide, cabRoof, underMat, cabFront, cabFront]);
  cab.position.set(0, cabH / 2 + 1.05, len / 2 - cabLen / 2 - 0.5);
  cab.castShadow = true; cab.receiveShadow = true;
  g.add(cab);

  // nose (short, sloped)
  const noseGeo = new THREE.BoxGeometry(CAR_W * 0.88, CAR_H * 0.52, 1.1);
  {
    const p = noseGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) > 0) { p.setY(i, p.getY(i) * 0.72); p.setX(i, p.getX(i) * 0.90); }
    }
    noseGeo.computeVertexNormals();
  }
  const nose = new THREE.Mesh(noseGeo, hoodMat);
  nose.position.set(0, CAR_H * 0.26 + 1.05, len / 2 - 0.05);
  nose.castShadow = true;
  g.add(nose);

  // walkway deck
  const deck = new THREE.Mesh(boxGeo(CAR_W * 1.04, 0.14, len * 0.98, 0.5), metalMat(PAL.metalDark, 0.6, 75));
  deck.position.y = 1.02;
  g.add(deck);
  // handrails
  const hr = metalMat(PAL.trainGrey, 0.3, 76);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(boxGeo(0.04, 0.04, len * 0.9, 0.5), hr);
    rail.position.set(s * CAR_W * 0.5, 1.62, 0);
    g.add(rail);
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(boxGeo(0.035, 0.6, 0.035), hr);
      st.position.set(s * CAR_W * 0.5, 1.32, -len * 0.42 + i * (len * 0.84 / 5));
      g.add(st);
    }
  }

  // pilot / cow catcher
  const pilot = new THREE.Mesh(boxGeo(CAR_W * 0.98, 0.55, 0.3), metalMat(PAL.metalDark, 0.7, 77));
  pilot.position.set(0, 0.72, len / 2 + 0.18);
  g.add(pilot);
  for (let i = 0; i < 7; i++) {
    const tine = new THREE.Mesh(boxGeo(0.06, 0.5, 0.08), metalMat(PAL.rust, 0.85, 78));
    tine.position.set(-CAR_W * 0.42 + i * (CAR_W * 0.84 / 6), 0.5, len / 2 + 0.28);
    tine.rotation.x = 0.25;
    g.add(tine);
  }

  addRoofDetail(g, CAR_W * 0.86, hoodLen, hoodH + 1.05, rng, 'loco');

  const skirt = new THREE.Mesh(boxGeo(CAR_W * 0.98, 0.4, len * 0.95, 0.5), underMat);
  skirt.position.y = 0.72;
  g.add(skirt);

  for (const sz of [-1, 1]) {
    const b = makeBogie(rng, CAR_W);
    b.position.z = sz * (len / 2 - 2.1);
    g.add(b);
  }
  addCoupler(g, CAR_W, -len / 2 - 0.1);
  const hl = addHeadlights(g, CAR_W, CAR_H * 0.9, len / 2 + 0.55, 1);
  hl.position.y = 0.2;
  addBlobShadow(g, CAR_W, len);
  g.userData.len = len;
  return g;
}

export function makeFlatbedCar(rng, opts = {}) {
  const len = opts.len ?? rng.f(7.0, 9.5);
  const g = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x6b4a2c,
    map: metalTexture(0x7c5636, 0.7, 81),
    roughness: 0.85, metalness: 0.2,
  });
  const deck = new THREE.Mesh(boxGeo(CAR_W, 0.32, len, 0.5), deckMat);
  deck.position.y = 1.0;
  deck.castShadow = true; deck.receiveShadow = true;
  g.add(deck);

  // stake pockets
  const mm = metalMat(PAL.rust, 0.85, 82);
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(boxGeo(0.09, 0.5, 0.09), mm);
      st.position.set(s * CAR_W * 0.47, 1.4, -len * 0.42 + i * (len * 0.84 / 5));
      g.add(st);
    }
  }

  // cargo: crates + pipes under tarp
  const woodM = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.9 });
  const n = rng.i(2, 4);
  for (let i = 0; i < n; i++) {
    const s = rng.f(0.9, 1.5);
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), woodM);
    c.position.set(rng.f(-0.3, 0.3), 1.16 + s * 0.4, -len * 0.3 + i * (len * 0.6 / Math.max(1, n - 1)));
    c.rotation.y = rng.f(-0.2, 0.2);
    c.castShadow = true;
    g.add(c);
  }
  if (rng.chance(0.5)) {
    const tarp = new THREE.Mesh(new THREE.BoxGeometry(CAR_W * 0.9, 0.9, len * 0.4), flatMat(0x4a4b3f, 0.95));
    tarp.position.set(0, 1.6, len * 0.28);
    tarp.castShadow = true;
    g.add(tarp);
  }

  const underMat = flatMat(0x1c1f24, 0.9, 0.2);
  const skirt = new THREE.Mesh(boxGeo(CAR_W * 0.9, 0.3, len * 0.9, 0.5), underMat);
  skirt.position.y = 0.72;
  g.add(skirt);

  for (const sz of [-1, 1]) {
    const b = makeBogie(rng, CAR_W);
    b.position.z = sz * (len / 2 - 1.5);
    g.add(b);
  }
  addCoupler(g, CAR_W, len / 2 + 0.1);
  addCoupler(g, CAR_W, -len / 2 - 0.1);
  addBlobShadow(g, CAR_W, len);
  g.userData.len = len;
  return g;
}

/* ================================================================== *
 *  TRAIN CONSIST (a full multi-car train, moving or parked)
 * ================================================================== */
export class Train {
  /**
   * @param {Rng} rng
   * @param {object} o  { lane, z, cars, speed, kind, parked }
   */
  constructor(rng, o = {}) {
    this.group = new THREE.Group();
    this.lane = o.lane ?? 0;
    this.speed = o.speed ?? 0;           // m/s along +z (world direction of travel)
    this.parked = o.parked ?? (this.speed === 0);
    this.cars = [];
    this.wheelSets = [];

    const kind = o.kind ?? rng.weighted([['subway', 3], ['freight', 3], ['mixed', 2]]);
    const nCars = o.cars ?? rng.i(2, 4);
    let z = 0;
    const gap = 0.75;

    const bodyForSubway = rng.pick([PAL.trainBlue, PAL.trainBlue, 0x2c7f9e, 0x3f5fa8]);
    const bodyForFreight = rng.pick([PAL.trainGreen, PAL.trainGrey, 0x6c7078, 0x4a6f52]);

    if (kind === 'mixed') {
      const loco = makeDieselLoco(rng, { seed: rng.i(0, 2) });
      loco.position.z = z;
      this.group.add(loco); this.cars.push(loco);
      z -= loco.userData.len / 2;
      for (let i = 0; i < nCars; i++) {
        const car = rng.chance(0.4)
          ? makeFlatbedCar(rng, { seed: rng.i(0, 2) })
          : makeFreightCar(rng, { body: bodyForFreight, seed: rng.i(0, 2) });
        z -= car.userData.len / 2 + gap;
        car.position.z = z;
        z -= car.userData.len / 2;
        this.group.add(car); this.cars.push(car);
      }
    } else if (kind === 'subway') {
      for (let i = 0; i < nCars; i++) {
        const car = makeSubwayCar(rng, { body: bodyForSubway, seed: rng.i(0, 2) });
        if (i > 0) z -= gap;
        z -= car.userData.len / 2;
        car.position.z = z;
        z -= car.userData.len / 2;
        this.group.add(car); this.cars.push(car);
      }
    } else {
      for (let i = 0; i < nCars; i++) {
        const car = rng.chance(0.3)
          ? makeFlatbedCar(rng, { seed: rng.i(0, 2) })
          : makeFreightCar(rng, { body: bodyForFreight, seed: rng.i(0, 2) });
        if (i > 0) z -= gap;
        z -= car.userData.len / 2;
        car.position.z = z;
        z -= car.userData.len / 2;
        this.group.add(car); this.cars.push(car);
      }
    }

    this.totalLen = Math.abs(z);
    this.group.position.set(this.lane, 0, o.z ?? 0);

    // collect wheels for rotation
    this.group.traverse((n) => {
      if (n.userData && n.userData.wheels) this.wheelSets.push(n.userData.wheels);
    });
  }

  update(dt) {
    if (this.speed !== 0) {
      this.group.position.z += this.speed * dt;
      const w = (this.speed * dt) / 0.34;
      for (const set of this.wheelSets) for (const wh of set) wh.rotation.x -= w;
    }
  }

  /** AABBs in world space for collision (one per car, front-most first) */
  getBoxes() {
    const out = [];
    const baseZ = this.group.position.z;
    for (const car of this.cars) {
      const len = car.userData.len;
      out.push({
        x: this.lane, w: CAR_W,
        zMin: baseZ + car.position.z - len / 2,
        zMax: baseZ + car.position.z + len / 2,
        h: CAR_H + 0.9,
      });
    }
    return out;
  }
}

export { CAR_W, CAR_H };
