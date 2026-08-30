/** Deterministic RNG (mulberry32) so world generation is reproducible per-seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1337) { this.r = mulberry32(seed); }
  f(a = 0, b = 1) { return a + this.r() * (b - a); }
  i(a, b) { return Math.floor(this.f(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
  sign() { return this.r() < 0.5 ? -1 : 1; }
  /** weighted pick: [[item, w], ...] */
  weighted(pairs) {
    let total = 0;
    for (const p of pairs) total += p[1];
    let x = this.r() * total;
    for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Cheap 1D value noise with smooth interpolation. */
export function valueNoise1D(seed = 7) {
  const r = mulberry32(seed);
  const N = 1024;
  const table = new Float32Array(N);
  for (let i = 0; i < N; i++) table[i] = r();
  return function (x) {
    const xi = Math.floor(x);
    const t = x - xi;
    const s = t * t * (3 - 2 * t);
    const a = table[((xi % N) + N) % N];
    const b = table[(((xi + 1) % N) + N) % N];
    return a + (b - a) * s;
  };
}

/** fBm from 1D value noise */
export function fbm1D(seed = 7, octaves = 4, lac = 2.0, gain = 0.5) {
  const noises = [];
  for (let i = 0; i < octaves; i++) noises.push(valueNoise1D(seed + i * 977));
  return function (x) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noises[i](x * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm;
  };
}

/** 2D value noise (bilinear + smoothstep) */
export function valueNoise2D(seed = 11, size = 256) {
  const r = mulberry32(seed);
  const t = new Float32Array(size * size);
  for (let i = 0; i < t.length; i++) t[i] = r();
  const at = (x, y) => t[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

export function fbm2D(seed = 11, octaves = 5, lac = 2.03, gain = 0.5) {
  const ns = [];
  for (let i = 0; i < octaves; i++) ns.push(valueNoise2D(seed + i * 613));
  return function (x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += ns[i](x * freq, y * freq) * amp;
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  };
}
