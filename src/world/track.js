import * as THREE from 'three';
import { PAL } from './palette.js';
import { RAIL, LANES, LANE_W, CHUNK_LEN } from './constants.js';
import { ballastTexture, woodTexture, metalTexture, sandTexture, sandNormal } from '../render/textures.js';
import { Rng } from '../util/rng.js';

/**
 * Track builder: for each lane we emit
 *   - a ballast strip (gravel bed, slightly raised)
 *   - two rails (extruded profile, instanced along z)
 *   - sleepers (instanced boxes with per-instance jitter)
 * Everything is merged/instanced per-chunk-batch so draw calls stay low.
 */

function railProfileGeometry(len) {
  // I-beam-ish rail cross section extruded along z
  const s = new THREE.Shape();
  const w = RAIL.railW, h = RAIL.railH;
  const footW = w * 1.75, footH = h * 0.22;
  const webW = w * 0.42;
  const headW = w * 1.15, headH = h * 0.30;
  s.moveTo(-footW / 2, 0);
  s.lineTo(footW / 2, 0);
  s.lineTo(footW / 2, footH);
  s.lineTo(webW / 2, footH * 1.9);
  s.lineTo(webW / 2, h - headH);
  s.lineTo(headW / 2, h - headH * 0.85);
  s.lineTo(headW / 2, h - headH * 0.15);
  s.lineTo(headW / 2 * 0.8, h);
  s.lineTo(-headW / 2 * 0.8, h);
  s.lineTo(-headW / 2, h - headH * 0.15);
  s.lineTo(-headW / 2, h - headH * 0.85);
  s.lineTo(-webW / 2, h - headH);
  s.lineTo(-webW / 2, footH * 1.9);
  s.lineTo(-footW / 2, footH);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps: 1 });
  geo.computeVertexNormals();
  return geo;
}

export class Track {
  /**
   * @param {THREE.Scene} scene
   * @param {number} tileLen  length of one recycled track tile
   */
  constructor(scene, tileLen = 240) {
    this.scene = scene;
    this.tileLen = tileLen;
    this.group = new THREE.Group();
    this.group.name = 'track';
    scene.add(this.group);
    this.rng = new Rng(9091);
    this._build();
    this.tiles = [];
    this._makeTiles();
  }

  _build() {
    const rng = this.rng;

    /* ---------- shared materials ---------- */
    const ballastTex = ballastTexture();
    ballastTex.repeat.set(2.0, 40);
    this.matBallast = new THREE.MeshStandardMaterial({
      map: ballastTex, roughness: 1.0, metalness: 0.0,
    });

    const sleeperTex = woodTexture(PAL.sleeper, 12);
    this.matSleeper = new THREE.MeshStandardMaterial({
      map: sleeperTex, roughness: 0.92, metalness: 0.0,
    });

    const railTex = metalTexture(PAL.rail, 0.35, 17);
    railTex.repeat.set(1, 26);
    this.matRail = new THREE.MeshStandardMaterial({
      map: railTex,
      color: 0xffffff,
      // Polished rail heads are the strongest "this is steel" cue in the
      // reference: a bright specular line running down the track toward the
      // sun. Low roughness + high envMapIntensity gives us that streak.
      roughness: 0.18,
      metalness: 0.95,
      envMapIntensity: 2.2,
    });
    this.matRailSide = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PAL.railDark), roughness: 0.62, metalness: 0.7,
    });

    /* ---------- geometry protos ---------- */
    this.railGeo = railProfileGeometry(this.tileLen);
    this.sleeperGeo = new THREE.BoxGeometry(RAIL.sleeperW, RAIL.sleeperT, RAIL.sleeperD);
    // chamfer the sleeper edges a touch by scaling top face inward
    {
      const p = this.sleeperGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.985); p.setZ(i, p.getZ(i) * 0.92); }
      }
      this.sleeperGeo.computeVertexNormals();
    }
  }

  _makeTile() {
    const g = new THREE.Group();
    const rng = this.rng;
    const L = this.tileLen;

    /* ---- ballast strips per lane ---- */
    for (const lx of LANES) {
      const geo = new THREE.BoxGeometry(LANE_W * 0.96, RAIL.ballastH * 2, L);
      // taper the shoulders
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) p.setX(i, p.getX(i) * 0.80);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.matBallast);
      m.position.set(lx, RAIL.ballastH * 0.5, L / 2);
      m.receiveShadow = true;
      g.add(m);
    }

    /* ---- sleepers (instanced) ---- */
    const nSleepers = Math.floor(L / RAIL.sleeperGap);
    const sleeperCount = nSleepers * LANES.length;
    const inst = new THREE.InstancedMesh(this.sleeperGeo, this.matSleeper, sleeperCount);
    inst.castShadow = true; inst.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const colr = new THREE.Color();
    let idx = 0;
    for (let li = 0; li < LANES.length; li++) {
      for (let i = 0; i < nSleepers; i++) {
        const z = i * RAIL.sleeperGap + RAIL.sleeperGap * 0.5;
        pos.set(LANES[li] + rng.f(-0.035, 0.035), RAIL.ballastH * 0.92 + RAIL.sleeperT * 0.5, z);
        e.set(rng.f(-0.02, 0.02), rng.f(-0.035, 0.035), rng.f(-0.02, 0.02));
        q.setFromEuler(e);
        scl.set(rng.f(0.96, 1.04), rng.f(0.9, 1.1), rng.f(0.94, 1.06));
        m4.compose(pos, q, scl);
        inst.setMatrixAt(idx, m4);
        const t = rng.f(0, 1);
        colr.set(t < 0.5 ? PAL.sleeper : PAL.sleeperAlt);
        colr.offsetHSL(0, rng.f(-0.05, 0.05), rng.f(-0.07, 0.07));
        inst.setColorAt(idx, colr);
        idx++;
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);

    /* ---- rails ---- */
    for (const lx of LANES) {
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(this.railGeo, this.matRail);
        rail.position.set(lx + s * RAIL.gauge / 2, RAIL.ballastH * 0.92 + RAIL.sleeperT, 0);
        rail.castShadow = true;
        rail.receiveShadow = true;
        g.add(rail);
      }
      // rail spikes / baseplates: thin dark strip under each rail for contact shadow
      for (const s of [-1, 1]) {
        const plateGeo = new THREE.BoxGeometry(RAIL.railW * 2.6, 0.02, L);
        const plate = new THREE.Mesh(plateGeo, this.matRailSide);
        plate.position.set(lx + s * RAIL.gauge / 2, RAIL.ballastH * 0.92 + RAIL.sleeperT + 0.005, L / 2);
        g.add(plate);
      }
    }

    return g;
  }

  _makeTiles() {
    const proto = this._makeTile();
    this.group.add(proto);
    this.tiles.push(proto);
    // 3 tiles cycling
    for (let i = 1; i < 4; i++) {
      const clone = proto.clone(true);
      clone.position.z = i * this.tileLen;
      this.group.add(clone);
      this.tiles.push(clone);
    }
  }

  update(playerZ) {
    const L = this.tileLen;
    const total = L * this.tiles.length;
    const startZ = Math.floor((playerZ - L * 1.2) / L) * L;
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i].position.z = startZ + i * L;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  GROUND: sand plane + shoulder berms alongside the track
 * ------------------------------------------------------------------ */
export class Ground {
  constructor(scene, canyon, opts = {}) {
    this.scene = scene;
    this.canyon = canyon;
    this.tileLen = opts.tileLen ?? 300;
    this.width = opts.width ?? 130;

    const tex = sandTexture();
    tex.repeat.set(this.width / 14, this.tileLen / 14);
    const nrm = sandNormal();
    nrm.repeat.set(this.width / 6, this.tileLen / 6);
    this.mat = new THREE.MeshStandardMaterial({
      map: tex,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.98,
      metalness: 0.0,
    });

    this.group = new THREE.Group();
    this.group.name = 'ground';
    scene.add(this.group);

    this.tiles = [];
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.PlaneGeometry(this.width, this.tileLen, 48, 64);
      // undulate the sand away from the tracks
      const p = geo.attributes.position;
      const rng = new Rng(700 + i);
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const y = p.getY(k);
        const away = Math.max(0, Math.abs(x) - 5.2);
        const h = Math.sin(x * 0.31 + y * 0.12) * 0.16 + Math.sin(x * 0.09 - y * 0.27) * 0.28;
        p.setZ(k, h * Math.min(1, away / 6) * 1.5 + rng.f(-0.03, 0.03) * Math.min(1, away / 3));
      }
      geo.computeVertexNormals();
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.mat);
      m.receiveShadow = true;
      m.position.z = i * this.tileLen + this.tileLen / 2;
      this.group.add(m);
      this.tiles.push(m);
    }
  }

  update(playerZ) {
    const L = this.tileLen;
    const startZ = Math.floor((playerZ - L * 1.3) / L) * L;
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i].position.z = startZ + i * L + L / 2;
    }
  }
}
