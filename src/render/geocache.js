import * as THREE from 'three';

/**
 * Shared geometry cache.
 *
 * The prop generators originally built fresh BufferGeometry for every instance,
 * which produced ~3000 live geometries for 18 chunks and destroyed frame rate
 * (every geometry is its own GPU buffer + draw call).
 *
 * Strategy: props request geometry by a QUANTISED key. A cactus of radius
 * 0.312 and one of radius 0.318 share a buffer; per-instance variety then comes
 * from node scale/rotation and material colour, which are free.
 *
 * `q()` snaps a float to a step so nearby values collapse to one key.
 */

const cache = new Map();
let hits = 0, misses = 0;

export function q(v, step = 0.1) { return Math.round(v / step) * step; }

export function geo(key, build) {
  let g = cache.get(key);
  if (g) { hits++; return g; }
  misses++;
  g = build();
  cache.set(key, g);
  return g;
}

export function geoStats() {
  return { unique: cache.size, hits, misses, hitRate: +(hits / Math.max(1, hits + misses)).toFixed(3) };
}

/* ---------------- common primitive helpers ---------------- */

export function boxGeo(w, h, d, step = 0.05) {
  const W = q(w, step), H = q(h, step), D = q(d, step);
  return geo(`box|${W}|${H}|${D}`, () => new THREE.BoxGeometry(W, H, D));
}

export function cylGeo(rt, rb, h, seg = 8, step = 0.05) {
  const A = q(rt, step), B = q(rb, step), H = q(h, step);
  return geo(`cyl|${A}|${B}|${H}|${seg}`, () => new THREE.CylinderGeometry(A, B, H, seg));
}

export function sphGeo(r, wSeg = 10, hSeg = 8, sx = 1, sy = 1, sz = 1, step = 0.05) {
  const R = q(r, step), X = q(sx, 0.05), Y = q(sy, 0.05), Z = q(sz, 0.05);
  return geo(`sph|${R}|${wSeg}|${hSeg}|${X}|${Y}|${Z}`, () => {
    const g = new THREE.SphereGeometry(R, wSeg, hSeg);
    if (X !== 1 || Y !== 1 || Z !== 1) g.scale(X, Y, Z);
    return g;
  });
}

export function capsGeo(r, len, step = 0.02) {
  const R = q(r, step), L = q(len, step);
  return geo(`caps|${R}|${L}`, () => new THREE.CapsuleGeometry(R, L, 4, 8));
}

export function torusGeo(r, tube, rSeg = 6, tSeg = 14, arc = Math.PI * 2, step = 0.02) {
  const R = q(r, step), T = q(tube, 0.01), A = q(arc, 0.1);
  return geo(`tor|${R}|${T}|${rSeg}|${tSeg}|${A}`, () => new THREE.TorusGeometry(R, T, rSeg, tSeg, A));
}

export function coneGeo(r, h, seg = 8, step = 0.05) {
  const R = q(r, step), H = q(h, step);
  return geo(`cone|${R}|${H}|${seg}`, () => new THREE.ConeGeometry(R, H, seg));
}

export function planeGeo(w, h, step = 0.05) {
  const W = q(w, step), H = q(h, step);
  return geo(`plane|${W}|${H}`, () => new THREE.PlaneGeometry(W, H));
}

export function circleGeo(r, seg = 14, step = 0.02) {
  const R = q(r, step);
  return geo(`circ|${R}|${seg}`, () => new THREE.CircleGeometry(R, seg));
}

/**
 * Irregular rock blob. `variant` selects one of N pre-distorted shapes, so we
 * get visual variety from a handful of buffers instead of one per rock.
 * Unit radius — scale the mesh node to size.
 */
const ROCK_VARIANTS = 8;
export function rockGeo(variant = 0, detail = 1) {
  const v = ((variant | 0) % ROCK_VARIANTS + ROCK_VARIANTS) % ROCK_VARIANTS;
  return geo(`rock|${v}|${detail}`, () => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    // deterministic distortion per variant
    let s = v * 9781 + 12345;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rnd() - 0.5) * 0.62;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * (0.62 + rnd() * 0.42), p.getZ(i) * k);
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  });
}

/** Chunky angular rubble (dodecahedron base) — unit radius */
const RUBBLE_VARIANTS = 6;
export function rubbleGeo(variant = 0) {
  const v = ((variant | 0) % RUBBLE_VARIANTS + RUBBLE_VARIANTS) % RUBBLE_VARIANTS;
  return geo(`rubble|${v}`, () => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    let s = v * 4421 + 777;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, p.getX(i) * (0.78 + rnd() * 0.44), p.getY(i) * (0.66 + rnd() * 0.44), p.getZ(i) * (0.78 + rnd() * 0.44));
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  });
}

/** Ribbed cactus barrel — unit radius sphere with rib displacement */
const CACTUS_VARIANTS = 4;
export function cactusBarrelGeo(variant = 0) {
  const v = ((variant | 0) % CACTUS_VARIANTS + CACTUS_VARIANTS) % CACTUS_VARIANTS;
  return geo(`cbarrel|${v}`, () => {
    const g = new THREE.SphereGeometry(1, 14, 11);
    const p = g.attributes.position;
    const ribs = 9 + v;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const ang = Math.atan2(z, x);
      const rib = 1 + Math.cos(ang * ribs) * 0.055;
      p.setX(i, x * rib); p.setZ(i, z * rib);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Saguaro trunk with swell + lean baked in — unit height, unit radius */
const TRUNK_VARIANTS = 4;
export function saguaroTrunkGeo(variant = 0) {
  const v = ((variant | 0) % TRUNK_VARIANTS + TRUNK_VARIANTS) % TRUNK_VARIANTS;
  return geo(`sagtrunk|${v}`, () => {
    const g = new THREE.CylinderGeometry(0.86, 1.0, 1.0, 10, 6);
    const lean = (v - 1.5) * 0.055;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = y + 0.5;                    // 0..1 up the trunk
      const swell = 1 + Math.sin(t * 3.0 + v) * 0.055;
      p.setX(i, p.getX(i) * swell + lean * t * t);
      p.setZ(i, p.getZ(i) * swell);
    }
    g.computeVertexNormals();
    return g;
  });
}

export function disposeGeoCache() {
  for (const g of cache.values()) g.dispose();
  cache.clear();
  hits = misses = 0;
}
