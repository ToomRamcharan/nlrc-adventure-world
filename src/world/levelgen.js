import * as THREE from 'three';
import { Rng } from '../util/rng.js';
import { PAL } from './palette.js';
import { LANES, LANE_W, CHUNK_LEN, COIN, ZONES } from './constants.js';
import {
  makeSaguaro, makeBarrelCactus, makePricklyPear, makeDryBush, makeTumbleweed,
  makeWarningSign, makeMilepost, makeLampPost, makeTelegraphPole,
  makeBarrier, makeCrateStack, makeRamp, makeOverheadBeam, makeRockPile,
  makeWaterTower, makeWindmill, makeMineHeadframe, makeMineCart, makeShack,
  makeBarrel, makeSkull, flatMat, metalMat, woodMat, rockMat,
  makeHoodoo, makeBoulder, makeArch,
} from '../entities/props.js';
import { Train } from '../entities/train.js';
import { coinTexture, signTexture, softDot, woodTexture } from '../render/textures.js';

/**
 * Chunk-based level generator.
 *
 * A chunk is CHUNK_LEN metres of track. Each chunk gets:
 *  - a lane-safety guarantee (at least one lane always passable)
 *  - obstacles / trains laid out on a rhythm grid
 *  - coin runs (lines, arcs over ramps, zig-zags)
 *  - scenery bands on both shoulders
 *  - occasional set pieces / tunnels / bridges
 *
 * Chunks are pooled: when recycled, their contents are disposed to a free list.
 */

/* --------------------------- coin mesh --------------------------- */
let coinGeoCache = null, coinMatCache = null;
function coinMesh() {
  if (!coinGeoCache) {
    coinGeoCache = new THREE.CylinderGeometry(COIN.r, COIN.r, COIN.thick, 22, 1);
    coinGeoCache.rotateX(Math.PI / 2);
    const faceMat = new THREE.MeshStandardMaterial({
      map: coinTexture(), roughness: 0.28, metalness: 0.85,
      emissive: new THREE.Color(PAL.coin), emissiveIntensity: 0.22,
      envMapIntensity: 1.6,
    });
    const edgeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PAL.coinDark), roughness: 0.32, metalness: 0.9,
      envMapIntensity: 1.4,
    });
    coinMatCache = [edgeMat, faceMat, faceMat];
  }
  const m = new THREE.Mesh(coinGeoCache, coinMatCache);
  return m;
}

/* ------------------------- tunnel section ------------------------ */
export function makeTunnel(rng, len = 60) {
  const g = new THREE.Group();
  const rockM = rockMat(rng.i(0, 2));
  const innerM = new THREE.MeshStandardMaterial({
    color: 0x4a2c1e, roughness: 1.0, metalness: 0,
  });

  const W = LANE_W * 3.4;
  const H = 5.4;

  // arched tube (open-ended half cylinder + walls)
  const arcGeo = new THREE.CylinderGeometry(W / 2, W / 2, len, 20, 1, true, 0, Math.PI);
  arcGeo.rotateZ(Math.PI / 2);
  arcGeo.rotateY(Math.PI / 2);
  const arc = new THREE.Mesh(arcGeo, innerM);
  arc.material.side = THREE.BackSide;
  arc.position.set(0, H - W / 2 + 0.4, len / 2);
  arc.receiveShadow = true;
  g.add(arc);

  // side walls
  for (const s of [-1, 1]) {
    const wGeo = new THREE.PlaneGeometry(len, H - W / 2 + 0.4, 12, 3);
    const p = wGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, rng.f(-0.12, 0.12));
    wGeo.computeVertexNormals();
    const w = new THREE.Mesh(wGeo, innerM);
    w.rotation.y = -s * Math.PI / 2;
    w.position.set(s * W / 2, (H - W / 2 + 0.4) / 2, len / 2);
    w.receiveShadow = true;
    g.add(w);
  }

  // exterior rock mass so it reads as a mountain from outside
  const shellGeo = new THREE.CylinderGeometry(W / 2 + 3.2, W / 2 + 4.5, len, 14, 1);
  shellGeo.rotateX(Math.PI / 2);
  const shell = new THREE.Mesh(shellGeo, rockM);
  shell.position.set(0, H - W / 2 + 0.4, len / 2);
  shell.castShadow = true;
  g.add(shell);

  // portals with timber framing at both ends
  for (const [z, dir] of [[0, -1], [len, 1]]) {
    const portal = new THREE.Group();
    const wm = woodMat(PAL.woodDark, 44);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 0.55, 0.55), wm);
    lintel.position.y = H + 0.1;
    portal.add(lintel);
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.55, H + 0.4, 0.55), wm);
      jamb.position.set(s * (W / 2 + 0.5), (H + 0.4) / 2, 0);
      portal.add(jamb);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.6, 0.36), wm);
      brace.position.set(s * (W / 2 + 0.1), H - 0.5, 0);
      brace.rotation.z = s * 0.72;
      portal.add(brace);
    }
    // stone facing arch
    const face = new THREE.Mesh(new THREE.TorusGeometry(W / 2 + 0.35, 0.55, 8, 20, Math.PI), rockM);
    face.position.y = H - W / 2 + 0.4;
    portal.add(face);

    // hanging lantern in the portal
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshStandardMaterial({
      color: 0xffd48a, emissive: new THREE.Color(0xffb347), emissiveIntensity: 3.2, roughness: 0.4,
    }));
    lamp.position.set(0, H - 0.6, dir * 0.4);
    portal.add(lamp);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot(0xffb85c, 0.12), color: 0xffb85c,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
    }));
    spr.scale.setScalar(2.6);
    spr.position.copy(lamp.position);
    portal.add(spr);

    // mine sign over the entry
    if (dir < 0) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 0.08), new THREE.MeshStandardMaterial({
        map: signTexture('mine'), roughness: 0.7,
      }));
      sign.position.set(0, H + 0.85, -0.1);
      portal.add(sign);
    }

    portal.position.z = z;
    g.add(portal);
  }

  // interior support timbers + lanterns along the length
  const nSup = Math.max(3, Math.floor(len / 9));
  for (let i = 1; i < nSup; i++) {
    const z = (i / nSup) * len;
    const wm = woodMat(PAL.woodDark, 45);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.34, 0.34), wm);
    beam.position.set(0, H - 0.25, z);
    g.add(beam);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.30, H, 0.30), wm);
      post.position.set(s * (W / 2 - 0.18), H / 2, z);
      g.add(post);
    }
    if (i % 2 === 0) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({
        color: 0xffcf85, emissive: new THREE.Color(0xff9d3c), emissiveIntensity: 3.6, roughness: 0.4,
      }));
      lamp.position.set(0, H - 0.62, z);
      g.add(lamp);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDot(0xff9d3c, 0.14), color: 0xffa855,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.72,
      }));
      spr.scale.setScalar(3.2);
      spr.position.copy(lamp.position);
      g.add(spr);
    }
  }

  g.userData.len = len;
  g.userData.isTunnel = true;
  return g;
}

/* ------------------------- trestle bridge ----------------------- */
export function makeTrestle(rng, len = 72) {
  const g = new THREE.Group();
  const wm = woodMat(PAL.woodDark, 46);
  const wmL = woodMat(PAL.wood, 47);
  const W = LANE_W * 3.35;
  const depth = 14;   // how far the chasm drops

  // deck stringers
  for (const s of [-1, 0, 1]) {
    const str = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.44, len), wm);
    str.position.set(s * (W / 2 - 0.4), -0.28, len / 2);
    str.castShadow = true;
    g.add(str);
  }
  // deck planks (visual floor between ties)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, len), wmL);
  deck.position.set(0, -0.07, len / 2);
  deck.receiveShadow = true;
  g.add(deck);

  // bents (support frames)
  const nBents = Math.max(4, Math.floor(len / 7));
  for (let i = 0; i <= nBents; i++) {
    const z = (i / nBents) * len;
    const bent = new THREE.Group();
    const spread = W / 2 + 0.4;
    for (const s of [-1, 1]) {
      // splayed legs
      const legLen = Math.hypot(depth, 1.8);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, legLen, 0.28), wm);
      leg.position.set(s * (spread * 0.6), -depth / 2 - 0.3, 0);
      leg.rotation.z = s * Math.atan2(1.8, depth);
      leg.castShadow = true;
      bent.add(leg);
      // inner vertical
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.24, depth, 0.24), wm);
      inner.position.set(s * spread * 0.25, -depth / 2 - 0.3, 0);
      bent.add(inner);
    }
    // cap beam
    const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.30, 0.30), wm);
    cap.position.y = -0.62;
    bent.add(cap);
    // X braces
    for (let lvl = 0; lvl < 3; lvl++) {
      const y = -1.6 - lvl * (depth / 3.4);
      const bw = W + 0.6 + lvl * 0.7;
      for (const d of [-1, 1]) {
        const diag = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bw, depth / 3.4), 0.14, 0.14), wm);
        diag.position.set(0, y - depth / 6.8, 0);
        diag.rotation.z = d * Math.atan2(depth / 3.4, bw);
        bent.add(diag);
      }
      const horiz = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.16, 0.16), wm);
      horiz.position.y = y;
      bent.add(horiz);
    }
    bent.position.z = z;
    g.add(bent);
  }

  // side guard rails with posts
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), wmL);
    rail.position.set(s * (W / 2 + 0.18), 0.92, len / 2);
    g.add(rail);
    const nPosts = Math.floor(len / 3.2);
    for (let i = 0; i <= nPosts; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.0, 0.11), wmL);
      post.position.set(s * (W / 2 + 0.18), 0.42, (i / nPosts) * len);
      post.castShadow = true;
      g.add(post);
    }
  }

  g.userData.len = len;
  g.userData.isBridge = true;
  return g;
}

/* ================================================================== *
 *  CHUNK
 * ================================================================== */
class Chunk {
  constructor() {
    this.group = new THREE.Group();
    this.z0 = 0;
    this.obstacles = [];    // { x, w, zMin, zMax, h, type, clearY }
    this.coins = [];        // { mesh, x, y, z, taken }
    this.trains = [];
    this.dynamic = [];      // objects needing per-frame update
    this.isTunnel = false;
    this.isBridge = false;
  }
  clear() {
    // dispose children groups back to nothing (geometry/materials are shared)
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.obstacles.length = 0;
    this.coins.length = 0;
    this.trains.length = 0;
    this.dynamic.length = 0;
    this.isTunnel = false;
    this.isBridge = false;
  }
}

export class LevelGen {
  constructor(scene, canyon, opts = {}) {
    this.scene = scene;
    this.canyon = canyon;
    this.rng = new Rng(opts.seed ?? 20250830);
    this.group = new THREE.Group();
    this.group.name = 'level';
    scene.add(this.group);

    this.chunks = [];
    this.pool = [];
    this.nextZ = 0;
    this.chunkIndex = 0;

    // zone scheduling
    this.zoneOrder = ['open', 'narrow', 'tunnel', 'open', 'bridge', 'storm', 'mesa', 'narrow', 'tunnel', 'mesa'];
    this.zonePtr = 0;
    this.zoneRemaining = 6;   // chunks left in current zone
    this.zone = ZONES.find((z) => z.id === 'open');
    this.zoneChanged = true;

    // difficulty
    this.difficulty = 0;

    // cross-chunk state so obstacle rhythm doesn't clump
    this.lastObstacleZ = -999;
    this.lastLane = 1;
    this.blockedRun = 0;
  }

  _advanceZone() {
    this.zoneRemaining--;
    if (this.zoneRemaining <= 0) {
      this.zonePtr = (this.zonePtr + 1) % this.zoneOrder.length;
      const id = this.zoneOrder[this.zonePtr];
      this.zone = ZONES.find((z) => z.id === id);
      this.zoneRemaining = this.zone.len;
      this.zoneChanged = true;
    }
  }

  _getChunk() {
    const c = this.pool.pop() || new Chunk();
    c.clear();
    this.group.add(c.group);
    return c;
  }

  _recycle(c) {
    this.group.remove(c.group);
    c.clear();
    this.pool.push(c);
  }

  /* --------------------- scenery placement --------------------- */
  _scatterScenery(chunk, z0, zoneId) {
    const rng = this.rng;
    const g = chunk.group;
    const len = CHUNK_LEN;
    const hwAt = (z) => this.canyon.halfWidthAt(z);

    // near-shoulder band: 3.9 .. 8m from centre
    const nearCount = rng.i(4, 9);
    for (let i = 0; i < nearCount; i++) {
      const z = z0 + rng.f(0, len);
      const side = rng.sign();
      const x = side * rng.f(4.0, Math.max(5.2, Math.min(9.0, hwAt(z) - 1.2)));
      const pick = rng.weighted([
        ['saguaro', zoneId === 'mesa' ? 3 : 2],
        ['barrel', 2],
        ['pear', 2],
        ['bush', 4],
        ['boulder', 3],
        ['skull', 0.5],
        ['barrelProp', 0.8],
      ]);
      let obj = null;
      if (pick === 'saguaro') obj = makeSaguaro(rng, rng.f(0.85, 1.25));
      else if (pick === 'barrel') obj = makeBarrelCactus(rng, rng.f(0.9, 1.3));
      else if (pick === 'pear') obj = makePricklyPear(rng, rng.f(0.8, 1.2));
      else if (pick === 'bush') obj = makeDryBush(rng, rng.f(0.8, 1.5));
      else if (pick === 'boulder') obj = makeBoulder(rng, rng.f(0.35, 1.25));
      else if (pick === 'skull') obj = makeSkull(rng);
      else obj = makeBarrel(rng);
      obj.position.set(x, 0, z);
      obj.rotation.y = rng.f(0, 6.28);
      g.add(obj);
    }

    // mid band: 9 .. 20m — bigger silhouettes
    const midCount = rng.i(2, 5);
    for (let i = 0; i < midCount; i++) {
      const z = z0 + rng.f(0, len);
      const side = rng.sign();
      const base = Math.max(9.5, hwAt(z) - 0.5);
      const x = side * rng.f(base, base + 9);
      const pick = rng.weighted([
        ['hoodoo', 2.4],
        ['saguaro', 2.2],
        ['boulderBig', 2.0],
        ['bushCluster', 1.6],
      ]);
      let obj = null;
      if (pick === 'hoodoo') obj = makeHoodoo(rng, rng.f(0.7, 1.5));
      else if (pick === 'saguaro') obj = makeSaguaro(rng, rng.f(1.0, 1.6));
      else if (pick === 'boulderBig') obj = makeBoulder(rng, rng.f(1.2, 2.8));
      else {
        obj = new THREE.Group();
        for (let k = 0; k < rng.i(3, 6); k++) {
          const b = makeDryBush(rng, rng.f(0.9, 1.6));
          b.position.set(rng.f(-2.5, 2.5), 0, rng.f(-2.5, 2.5));
          obj.add(b);
        }
      }
      obj.position.set(x, rng.f(-0.1, 0.35), z);
      obj.rotation.y = rng.f(0, 6.28);
      g.add(obj);
    }

    // trackside furniture rhythm — lamp posts / telegraph poles alternate
    const poleGap = 11.5;
    const firstPole = Math.ceil(z0 / poleGap) * poleGap;
    for (let z = firstPole; z < z0 + len; z += poleGap) {
      const side = (Math.round(z / poleGap) % 2 === 0) ? -1 : 1;
      const x = side * rng.f(5.0, 5.9);
      const useLamp = Math.round(z / poleGap) % 3 !== 0;
      const obj = useLamp ? makeLampPost(rng) : makeTelegraphPole(rng);
      obj.position.set(x, 0, z);
      obj.rotation.y = side > 0 ? Math.PI : 0;
      g.add(obj);
      if (obj.userData.glow) chunk.dynamic.push({ type: 'flicker', obj: obj.userData.glow, phase: rng.f(0, 6.28) });
    }

    // warning signs
    if (rng.chance(0.42)) {
      const side = rng.sign();
      const kind = rng.weighted([['falling-rocks', 4], ['speed', 1.4], ['nlrc', 1.2], ['mine', 1]]);
      const s = makeWarningSign(rng, kind);
      s.position.set(side * rng.f(4.4, 5.6), 0, z0 + rng.f(4, len - 4));
      s.rotation.y = side > 0 ? Math.PI + rng.f(-0.2, 0.2) : rng.f(-0.2, 0.2);
      g.add(s);
    }
    if (rng.chance(0.3)) {
      const side = rng.sign();
      const mp = makeMilepost(rng);
      mp.position.set(side * rng.f(3.9, 4.4), 0, z0 + rng.f(2, len - 2));
      mp.rotation.y = side > 0 ? Math.PI : 0;
      g.add(mp);
    }

    // set pieces
    const spChance = zoneId === 'mesa' ? 0.5 : zoneId === 'open' ? 0.42 : 0.22;
    if (rng.chance(spChance)) {
      const side = rng.sign();
      const pick = rng.weighted([
        ['waterTower', 2.0],
        ['windmill', 2.0],
        ['shack', 2.2],
        ['mineHead', 1.4],
        ['mineCart', 1.6],
        ['arch', 1.0],
      ]);
      let obj = null;
      if (pick === 'waterTower') obj = makeWaterTower(rng);
      else if (pick === 'windmill') { obj = makeWindmill(rng); chunk.dynamic.push({ type: 'rotor', obj: obj.userData.rotor, spd: rng.f(1.2, 3.0) }); }
      else if (pick === 'shack') obj = makeShack(rng);
      else if (pick === 'mineHead') { obj = makeMineHeadframe(rng); chunk.dynamic.push({ type: 'wheel', obj: obj.userData.wheel, spd: rng.f(0.4, 1.1) }); }
      else if (pick === 'mineCart') obj = makeMineCart(rng);
      else obj = makeArch(rng, rng.f(0.7, 1.2));

      const dist = pick === 'arch' ? rng.f(16, 26) : rng.f(7.5, 13);
      obj.position.set(side * dist, 0, z0 + rng.f(6, len - 6));
      g.add(obj);
    }

    // ground clutter: small rocks near ballast for grounding
    for (let i = 0; i < rng.i(6, 14); i++) {
      const z = z0 + rng.f(0, len);
      const side = rng.sign();
      const r = makeBoulder(rng, rng.f(0.08, 0.28));
      r.position.set(side * rng.f(3.6, 6.5), rng.f(0, 0.06), z);
      g.add(r);
    }
  }

  /* -------------------- obstacle + coin layout ------------------- */
  _layoutGameplay(chunk, z0, zoneId) {
    const rng = this.rng;
    const g = chunk.group;
    const len = CHUNK_LEN;
    const diff = this.difficulty;

    // no obstacles on bridges (they're the breather) but coins yes
    if (chunk.isBridge) {
      this._coinLine(chunk, rng.pick(LANES), z0 + 3, z0 + len - 3, rng.i(7, 12));
      return;
    }

    // slot grid: obstacles every ~7-11m
    const slotGap = THREE.MathUtils.lerp(11.0, 6.6, Math.min(1, diff));
    let z = z0 + rng.f(1.5, slotGap);
    while (z < z0 + len - 2) {
      // pick how many lanes to block: 0,1,2  (never 3)
      const maxBlock = diff < 0.25 ? 1 : diff < 0.6 ? 2 : 2;
      let nBlock = rng.weighted([[0, 1.1], [1, 4.0], [2, maxBlock === 2 ? 2.2 + diff * 1.6 : 0]]);
      if (this.blockedRun >= 3) nBlock = Math.min(nBlock, 1);

      if (nBlock === 0) { this.blockedRun = 0; z += slotGap * rng.f(0.8, 1.2); continue; }
      this.blockedRun += 1;

      // choose lanes
      const laneIdx = rng.shuffle([0, 1, 2]).slice(0, nBlock);

      // trains occupy a lane for a long stretch, so gate them
      const trainRoll = rng.chance(zoneId === 'tunnel' ? 0.12 : 0.26) && nBlock === 1;

      if (trainRoll) {
        const li = laneIdx[0];
        const moving = rng.chance(0.42);
        const tr = new Train(rng, {
          lane: LANES[li],
          z: z + rng.f(6, 14),
          cars: rng.i(2, moving ? 3 : 4),
          speed: moving ? rng.f(-9, -4) : 0,   // negative = coming toward player
          kind: rng.weighted([['subway', 3], ['freight', 2.4], ['mixed', 1.8]]),
        });
        g.add(tr.group);
        chunk.trains.push(tr);
        // side coins next to the train so the player is rewarded for the dodge
        const sideLane = LANES[(li + (li === 2 ? -1 : 1))];
        this._coinLine(chunk, sideLane, z, z + tr.totalLen * 0.7, rng.i(5, 9));
        z += tr.totalLen + rng.f(10, 20);
        this.blockedRun = 0;
        continue;
      }

      for (const li of laneIdx) {
        const lx = LANES[li];
        const kind = rng.weighted([
          ['barrier', 3.4],
          ['crate', 2.6],
          ['crateTall', 1.5],
          ['ramp', 1.9],
          ['beam', 1.7 + diff],
          ['rocks', zoneId === 'narrow' || zoneId === 'storm' ? 3.2 : 1.9],
        ]);
        let obj, hit;
        if (kind === 'barrier') { obj = makeBarrier(rng); hit = obj.userData.hit; }
        else if (kind === 'crate') { obj = makeCrateStack(rng, false); hit = obj.userData.hit; }
        else if (kind === 'crateTall') { obj = makeCrateStack(rng, true); hit = obj.userData.hit; }
        else if (kind === 'ramp') { obj = makeRamp(rng); hit = obj.userData.hit; }
        else if (kind === 'beam') { obj = makeOverheadBeam(rng); hit = obj.userData.hit; }
        else { obj = makeRockPile(rng, rng.f(0.85, 1.2)); hit = obj.userData.hit; }

        obj.position.set(lx, 0, z);
        g.add(obj);
        chunk.obstacles.push({
          x: lx, w: hit.w, h: hit.h, d: hit.d,
          zMin: z - hit.d / 2, zMax: z + hit.d / 2,
          type: hit.type, clearY: hit.clearY ?? 0,
          rampLen: obj.userData.rampLen, rampH: obj.userData.rampH,
        });

        // ramp -> coin arc
        if (kind === 'ramp') this._coinArc(chunk, lx, z, 8.5, rng.i(6, 9));
      }

      // coins in a free lane
      const freeLanes = [0, 1, 2].filter((i) => !laneIdx.includes(i));
      if (freeLanes.length && rng.chance(0.75)) {
        const fl = LANES[rng.pick(freeLanes)];
        this._coinLine(chunk, fl, z - 2.5, z + 2.5, rng.i(3, 6));
      }

      z += slotGap * rng.f(0.85, 1.3);
    }

    // bonus coin run somewhere in the chunk
    if (rng.chance(0.55)) {
      const lane = rng.pick(LANES);
      const zs = z0 + rng.f(2, len * 0.5);
      this._coinLine(chunk, lane, zs, zs + rng.f(6, 14), rng.i(6, 11));
    }
    // zig-zag pattern occasionally
    if (rng.chance(0.28)) {
      let zz = z0 + rng.f(2, len - 14);
      let li = rng.i(0, 2);
      for (let k = 0; k < rng.i(6, 12); k++) {
        this._addCoin(chunk, LANES[li], COIN.y, zz);
        zz += 1.55;
        if (k % 3 === 2) li = THREE.MathUtils.clamp(li + rng.sign(), 0, 2);
      }
    }
  }

  _addCoin(chunk, x, y, z) {
    const m = coinMesh();
    m.position.set(x, y, z);
    m.rotation.y = Math.random() * 6.28;
    chunk.group.add(m);
    chunk.coins.push({ mesh: m, x, y, z, taken: false });
  }

  _coinLine(chunk, x, zA, zB, n) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this._addCoin(chunk, x, COIN.y, zA + (zB - zA) * t);
    }
  }

  _coinArc(chunk, x, zStart, length, n) {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = COIN.y + Math.sin(t * Math.PI) * 2.35;
      this._addCoin(chunk, x, y, zStart + t * length);
    }
  }

  /* --------------------------- generate -------------------------- */
  generateChunk() {
    const rng = this.rng;
    const chunk = this._getChunk();
    const z0 = this.nextZ;
    chunk.z0 = z0;
    chunk.group.position.z = 0;   // absolute coords

    const zoneId = this.zone.id;
    this.difficulty = Math.min(1, this.chunkIndex / 55);

    // ---- structural features ----
    let structural = null;
    if (zoneId === 'tunnel' && this.zoneChanged) {
      const tLen = CHUNK_LEN * (this.zone.len - 1);
      structural = makeTunnel(rng, tLen);
      structural.position.z = z0;
      chunk.group.add(structural);
      chunk.isTunnel = true;
      this.tunnelSpan = { zMin: z0, zMax: z0 + tLen };
    } else if (zoneId === 'tunnel') {
      chunk.isTunnel = true;
    } else if (zoneId === 'bridge' && this.zoneChanged) {
      const bLen = CHUNK_LEN * (this.zone.len - 1);
      structural = makeTrestle(rng, bLen);
      structural.position.z = z0;
      chunk.group.add(structural);
      chunk.isBridge = true;
      this.bridgeSpan = { zMin: z0, zMax: z0 + bLen };
    } else if (zoneId === 'bridge') {
      chunk.isBridge = true;
    }

    // scenery (skip inside tunnels, thin on bridges)
    if (!chunk.isTunnel) {
      if (chunk.isBridge) {
        // sparse: only far mid-band silhouettes
        for (let i = 0; i < rng.i(1, 3); i++) {
          const side = rng.sign();
          const obj = rng.chance(0.5) ? makeHoodoo(rng, rng.f(0.9, 1.8)) : makeBoulder(rng, rng.f(1.5, 3.2));
          obj.position.set(side * rng.f(18, 34), -rng.f(3, 9), z0 + rng.f(0, CHUNK_LEN));
          chunk.group.add(obj);
        }
      } else {
        this._scatterScenery(chunk, z0, zoneId);
      }
    } else {
      // inside tunnel: mine carts and rock rubble along the walls
      for (let i = 0; i < rng.i(1, 3); i++) {
        const side = rng.sign();
        const obj = rng.chance(0.5) ? makeMineCart(rng) : makeBoulder(rng, rng.f(0.3, 0.7));
        obj.position.set(side * rng.f(3.6, 4.1), 0, z0 + rng.f(2, CHUNK_LEN - 2));
        chunk.group.add(obj);
      }
    }

    this._layoutGameplay(chunk, z0, zoneId);

    // tumbleweeds crossing the track (ambient, harmless)
    if (rng.chance(0.35) && !chunk.isTunnel) {
      const tw = makeTumbleweed(rng, rng.f(0.8, 1.4));
      const side = rng.sign();
      tw.position.set(side * 9, 0.4, z0 + rng.f(0, CHUNK_LEN));
      chunk.group.add(tw);
      chunk.dynamic.push({ type: 'tumble', obj: tw, vx: -side * rng.f(2.2, 5.0), spin: rng.f(3, 8) });
    }

    this.chunks.push(chunk);
    this.nextZ += CHUNK_LEN;
    this.chunkIndex++;
    this.zoneChanged = false;
    this._advanceZone();
    return chunk;
  }

  update(dt, playerZ) {
    // generate ahead
    while (this.nextZ < playerZ + CHUNK_LEN * 16) this.generateChunk();
    // recycle behind
    while (this.chunks.length && this.chunks[0].z0 + CHUNK_LEN < playerZ - CHUNK_LEN * 2.5) {
      this._recycle(this.chunks.shift());
    }

    // per-chunk dynamics
    for (const c of this.chunks) {
      for (const tr of c.trains) tr.update(dt);
      for (const d of c.dynamic) {
        if (d.type === 'rotor') d.obj.rotation.z += d.spd * dt;
        else if (d.type === 'wheel') d.obj.rotation.z += d.spd * dt;
        else if (d.type === 'flicker') {
          d.phase += dt * 3.2;
          d.obj.material.opacity = 0.72 + Math.sin(d.phase) * 0.10 + Math.sin(d.phase * 3.7) * 0.05;
        } else if (d.type === 'tumble') {
          d.obj.position.x += d.vx * dt;
          d.obj.rotation.x += d.spin * dt;
          d.obj.rotation.z += d.spin * 0.6 * dt;
          d.obj.position.y = 0.35 + Math.abs(Math.sin(d.obj.rotation.x)) * 0.18;
          if (Math.abs(d.obj.position.x) > 14) d.vx *= -1;
        }
      }
      // spin coins
      for (const cn of c.coins) {
        if (cn.taken) continue;
        cn.mesh.rotation.y += COIN.spin * dt;
      }
    }
  }

  /** Is playerZ currently inside a tunnel? returns 0..1 blend */
  tunnelFactor(z) {
    let best = 0;
    for (const c of this.chunks) {
      if (!c.isTunnel) continue;
      const a = c.z0, b = c.z0 + CHUNK_LEN;
      if (z > a - 12 && z < b + 12) {
        // ramp in/out over 12m
        const inFac = THREE.MathUtils.smoothstep(z, a - 10, a + 4);
        const outFac = 1 - THREE.MathUtils.smoothstep(z, b - 4, b + 10);
        best = Math.max(best, Math.min(inFac, outFac));
      }
    }
    return best;
  }

  bridgeFactor(z) {
    let best = 0;
    for (const c of this.chunks) {
      if (!c.isBridge) continue;
      const a = c.z0, b = c.z0 + CHUNK_LEN;
      if (z > a - 8 && z < b + 8) {
        best = Math.max(best, Math.min(
          THREE.MathUtils.smoothstep(z, a - 6, a + 2),
          1 - THREE.MathUtils.smoothstep(z, b - 2, b + 6)
        ));
      }
    }
    return best;
  }

  /** current zone id at a given z (approx from chunk list) */
  zoneAt(z) {
    for (const c of this.chunks) {
      if (z >= c.z0 && z < c.z0 + CHUNK_LEN) {
        if (c.isTunnel) return 'tunnel';
        if (c.isBridge) return 'bridge';
      }
    }
    return this.zone.id;
  }

  /** gather colliders near the player */
  nearbyObstacles(z, range = 24) {
    const out = [];
    for (const c of this.chunks) {
      if (c.z0 + CHUNK_LEN < z - 6 || c.z0 > z + range) continue;
      for (const o of c.obstacles) out.push(o);
      for (const tr of c.trains) {
        for (const b of tr.getBoxes()) out.push({ ...b, type: 'train', d: b.zMax - b.zMin });
      }
    }
    return out;
  }

  nearbyCoins(z, range = 18) {
    const out = [];
    for (const c of this.chunks) {
      if (c.z0 + CHUNK_LEN < z - 4 || c.z0 > z + range) continue;
      for (const cn of c.coins) if (!cn.taken) out.push(cn);
    }
    return out;
  }

  reset() {
    while (this.chunks.length) this._recycle(this.chunks.shift());
    this.nextZ = 0;
    this.chunkIndex = 0;
    this.zonePtr = 0;
    this.zoneRemaining = 6;
    this.zone = ZONES.find((z) => z.id === 'open');
    this.zoneChanged = true;
    this.difficulty = 0;
    this.blockedRun = 0;
    for (let i = 0; i < 18; i++) this.generateChunk();
  }
}
