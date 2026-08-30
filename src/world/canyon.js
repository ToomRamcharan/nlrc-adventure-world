import * as THREE from 'three';
import { PAL } from './palette.js';
import { fbm1D, fbm2D, Rng } from '../util/rng.js';
import { rockTexture, rockNormal } from '../render/textures.js';
import { CHUNK_LEN } from './constants.js';

/**
 * Procedural canyon walls built as ribbon meshes.
 * Each side is a lofted surface: profile (height ramp) x length (z),
 * displaced by multi-octave noise for buttes, ledges, alcoves and hoodoos.
 *
 * Three depth layers per side:
 *   L0  near wall   (detailed, casts the strongest silhouette)
 *   L1  mid ridge   (pushed back, taller)
 *   L2  far mesas   (hazed, very tall, low detail)
 */

/**
 * Wall cross-section profile: [u, radialOffset, height].
 *
 * Composition note: the reference frames a WIDE band of sunset sky above the
 * canyon rim. Walls that are both tall and close seal the sky off and the shot
 * turns into a dark corridor. So the near wall is deliberately kept low
 * (~13m) and its foot pushed out; height comes from the mid/far layers which
 * sit further back and therefore stay below the skyline.
 */
const PROFILE = [
  // u,    radialOffset, height
  [0.00,  0.00,  0.00],   // buried foot
  [0.08, -0.35,  0.42],   // talus / scree slope meeting the sand
  [0.18, -0.90,  1.30],
  [0.30, -0.75,  2.45],   // first bench
  [0.42, -1.55,  3.85],
  [0.54, -1.20,  5.40],   // mid ledge (catches the sun)
  [0.66, -2.10,  7.10],
  [0.77, -1.75,  8.85],
  [0.86, -2.60, 10.40],
  [0.93, -2.20, 11.70],
  [0.98, -3.00, 12.80],
  [1.00, -2.40, 13.40],   // rim
];

export class CanyonWalls {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.seed = opts.seed ?? 4242;
    this.segLen = opts.segLen ?? 4.0;          // z resolution
    this.spanLen = opts.spanLen ?? 700;        // total ribbon length
    this.rng = new Rng(this.seed);

    // Noise fields
    this.nWidth = fbm1D(this.seed + 1, 4);      // canyon width variation
    this.nOffsetL = fbm1D(this.seed + 11, 5);
    this.nOffsetR = fbm1D(this.seed + 21, 5);
    this.nHeightL = fbm1D(this.seed + 31, 4);
    this.nHeightR = fbm1D(this.seed + 41, 4);
    this.nDetail = fbm2D(this.seed + 51, 5);
    this.nLedge = fbm2D(this.seed + 61, 3);

    this.group = new THREE.Group();
    this.group.name = 'canyon';
    scene.add(this.group);

    this.layers = [];
    this._build();
  }

  /** base half-width of the canyon at world z */
  halfWidthAt(z) {
    const w = this.nWidth(z * 0.0042);
    const w2 = this.nWidth(z * 0.017 + 40);
    // 13 .. 27 metres. Wider than a "real" gorge on purpose: it keeps the rim
    // low in frame so the sunset sky stays visible, which is the single
    // strongest feature of the reference art.
    return 13.0 + w * 11.5 + w2 * 2.6;
  }

  _makeLayer(side, layerIdx, mat) {
    const { segLen, spanLen } = this;
    const nz = Math.ceil(spanLen / segLen) + 1;
    const nu = PROFILE.length;

    const positions = new Float32Array(nz * nu * 3);
    const normals = new Float32Array(nz * nu * 3);
    const uvs = new Float32Array(nz * nu * 2);
    const indices = [];

    // Layer staging: each layer sits further back AND taller, so the skyline
    // reads as receding ridges rather than one solid wall. Because they are
    // pushed back, their extra height still lands below the frame's sky band.
    const push = layerIdx === 0 ? 0 : layerIdx === 1 ? 13.0 : 34.0;
    const hScale = layerIdx === 0 ? 1.0 : layerIdx === 1 ? 1.62 : 2.55;
    const nOff = side < 0 ? this.nOffsetL : this.nOffsetR;
    const nH = side < 0 ? this.nHeightL : this.nHeightR;
    const detailAmp = layerIdx === 0 ? 1.0 : layerIdx === 1 ? 1.5 : 2.2;

    for (let iz = 0; iz < nz; iz++) {
      const z = iz * segLen;
      const hw = this.halfWidthAt(z) + push;
      // low-freq lateral wander of the wall foot
      const wander = (nOff(z * 0.011 + layerIdx * 13) - 0.5) * (2.4 + layerIdx * 3.4);
      const heightMul = 0.62 + nH(z * 0.008 + layerIdx * 7) * 0.95;
      // butte spikes
      const butte = Math.pow(nH(z * 0.031 + 100 + layerIdx * 5), 4.0) * 12.0;

      for (let iu = 0; iu < nu; iu++) {
        const [u, radial, hgt] = PROFILE[iu];
        // per-vertex detail: alcoves, ledges, spires
        const d1 = (this.nDetail(z * 0.055 + layerIdx * 20, u * 5.5) - 0.5) * 3.1 * detailAmp;
        const d2 = (this.nDetail(z * 0.19 + 300, u * 12.0) - 0.5) * 1.15 * detailAmp;
        const ledge = Math.pow(this.nLedge(z * 0.024, u * 3.0), 3.0) * 3.4 * detailAmp;

        const rOff = (radial + d1 + d2 - ledge) * (0.85 + layerIdx * 0.35);
        let x = side * (hw + wander - rOff);
        let y = (hgt * heightMul * hScale) + butte * u + (this.nDetail(z * 0.09, u * 2.0) - 0.5) * 1.2 * detailAmp;
        if (u === 0) y = -0.6; // bury the foot

        const i3 = (iz * nu + iu) * 3;
        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;

        const i2 = (iz * nu + iu) * 2;
        uvs[i2] = z / 26.0;
        uvs[i2 + 1] = y / 30.0;
      }
    }

    for (let iz = 0; iz < nz - 1; iz++) {
      for (let iu = 0; iu < nu - 1; iu++) {
        const a = iz * nu + iu;
        const b = iz * nu + iu + 1;
        const c = (iz + 1) * nu + iu;
        const d = (iz + 1) * nu + iu + 1;
        if (side < 0) { indices.push(a, c, b, b, c, d); }
        else { indices.push(a, b, c, b, d, c); }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = layerIdx === 0;
    mesh.receiveShadow = layerIdx <= 1;
    mesh.frustumCulled = false;
    return mesh;
  }

  _build() {
    const matNear = new THREE.MeshStandardMaterial({
      map: rockTexture(0),
      normalMap: rockNormal(0),
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughness: 0.94,
      metalness: 0.0,
      color: 0xffffff,
    });
    const matMid = new THREE.MeshStandardMaterial({
      map: rockTexture(1),
      normalMap: rockNormal(1),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.96,
      metalness: 0.0,
      color: new THREE.Color(PAL.rockFar).lerp(new THREE.Color(0xffffff), 0.35),
    });
    const matFar = new THREE.MeshStandardMaterial({
      map: rockTexture(2),
      roughness: 1.0,
      metalness: 0.0,
      color: new THREE.Color(PAL.rockFarther),
    });
    matNear.map.repeat.set(1, 1);

    this.mats = { matNear, matMid, matFar };

    for (const side of [-1, 1]) {
      for (let layer = 0; layer < 3; layer++) {
        const mat = layer === 0 ? matNear : layer === 1 ? matMid : matFar;
        const mesh = this._makeLayer(side, layer, mat);
        // two copies scrolling for infinite illusion
        const wrap = new THREE.Group();
        wrap.add(mesh);
        this.group.add(wrap);
        this.layers.push({ wrap, mesh, side, layer, baseZ: 0 });
      }
    }

    // second tile for seamless recycling
    this.tileB = [];
    for (const L of this.layers) {
      const clone = new THREE.Mesh(L.mesh.geometry, L.mesh.material);
      clone.castShadow = L.mesh.castShadow;
      clone.receiveShadow = L.mesh.receiveShadow;
      clone.frustumCulled = false;
      clone.position.z = this.spanLen;
      L.wrap.add(clone);
      this.tileB.push(clone);
    }
  }

  /** shift the ribbon so it always straddles the player */
  update(playerZ) {
    // ribbon repeats every spanLen; keep origin at floor(playerZ/span)*span - margin
    const span = this.spanLen;
    const base = Math.floor((playerZ - 120) / span) * span;
    this.group.position.z = base;
  }

  setFogInfluence(v) {
    // mid/far layers get tinted toward haze as fog increases
    const c = new THREE.Color(PAL.mesaHaze);
    this.mats.matFar.color.copy(c).lerp(new THREE.Color(PAL.rockFarther), 1 - v);
  }
}

/* Hero rock formations (makeHoodoo / makeBoulder / makeArch) now live in
 * entities/props.js so they can share the geometry cache. */

/** Distant mesa silhouette cards for the far horizon (very cheap) */
export function makeMesaBackdrop(rng, count = 26) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PAL.mesaHaze),
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < count; i++) {
    const w = rng.f(40, 130);
    const h = rng.f(16, 62);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    const steps = rng.i(5, 9);
    let x = -w / 2;
    let y = 0;
    for (let s = 0; s < steps; s++) {
      const nx = x + w / steps;
      const ny = s < steps / 2 ? y + rng.f(0.1, 0.42) * h : y - rng.f(0.05, 0.30) * h;
      shape.lineTo(x, Math.max(2, ny));
      shape.lineTo(nx, Math.max(2, ny));
      x = nx; y = Math.max(2, ny);
    }
    shape.lineTo(w / 2, 0);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const m = new THREE.Mesh(geo, mat.clone());
    m.material.opacity = rng.f(0.55, 0.95);
    m.material.color = new THREE.Color(PAL.mesaHaze).lerp(new THREE.Color(PAL.rockFar), rng.f(0, 0.5));
    group.add(m);
  }
  return group;
}
