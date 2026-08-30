/**
 * Fast procedural noise -> canvas layers.
 *
 * The naive approach (evaluate fbm per output pixel) costs millions of JS calls
 * and took ~70s for the canyon texture set. Instead we:
 *   1. evaluate noise on a SMALL lattice (e.g. 96x192) into an ImageData
 *   2. let the GPU/native canvas bilinear-upscale it via drawImage
 *   3. composite several such layers at different frequencies
 *   4. draw crisp detail (cracks, bands, streaks) as vectors at full res
 *
 * Visual result is equivalent (noise is smooth by definition) but ~100x faster.
 */

import { mulberry32 } from '../util/rng.js';

/* ---------- lattice noise: flat typed arrays, no closures per sample ---------- */

function lattice(seed, size) {
  const r = mulberry32(seed);
  const t = new Float32Array(size * size);
  for (let i = 0; i < t.length; i++) t[i] = r();
  return t;
}

const latCache = new Map();
function getLat(seed, size) {
  const k = seed + ':' + size;
  let v = latCache.get(k);
  if (!v) { v = lattice(seed, size); latCache.set(k, v); }
  return v;
}

/**
 * Render fbm noise into a Float32Array of w*h in [0,1].
 * freq = lattice cells across the width.
 */
export function fbmField(w, h, {
  seed = 1, freqX = 4, freqY = 4, octaves = 4, gain = 0.5, lac = 2.0, latSize = 64,
} = {}) {
  const out = new Float32Array(w * h);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { norm += amp; amp *= gain; }
  amp = 1;

  for (let o = 0; o < octaves; o++) {
    const lat = getLat(seed + o * 7919, latSize);
    const fx = freqX * Math.pow(lac, o);
    const fy = freqY * Math.pow(lac, o);
    const sx = fx / w, sy = fy / h;
    const a = amp / norm;

    for (let y = 0; y < h; y++) {
      const gy = y * sy;
      const yi = Math.floor(gy);
      let ty = gy - yi;
      ty = ty * ty * (3 - 2 * ty);
      const y0 = ((yi % latSize) + latSize) % latSize;
      const y1 = (y0 + 1) % latSize;
      const row0 = y0 * latSize, row1 = y1 * latSize;
      const base = y * w;

      for (let x = 0; x < w; x++) {
        const gx = x * sx;
        const xi = Math.floor(gx);
        let tx = gx - xi;
        tx = tx * tx * (3 - 2 * tx);
        const x0 = ((xi % latSize) + latSize) % latSize;
        const x1 = (x0 + 1) % latSize;

        const v00 = lat[row0 + x0], v10 = lat[row0 + x1];
        const v01 = lat[row1 + x0], v11 = lat[row1 + x1];
        const top = v00 + (v10 - v00) * tx;
        const bot = v01 + (v11 - v01) * tx;
        out[base + x] += (top + (bot - top) * ty) * a;
      }
    }
    amp *= gain;
  }
  return out;
}

/**
 * Turn a scalar field into an RGBA canvas by mapping through a colour ramp.
 * @param {Float32Array} field
 * @param {Array<[number, [number,number,number]]>} ramp  [[stop, [r,g,b]], ...]
 */
export function fieldToCanvas(field, w, h, ramp, alpha = 255) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const n = ramp.length;
  for (let i = 0; i < field.length; i++) {
    const v = field[i] < 0 ? 0 : field[i] > 1 ? 1 : field[i];
    // find ramp segment
    let k = 0;
    while (k < n - 2 && v > ramp[k + 1][0]) k++;
    const a = ramp[k], b = ramp[k + 1];
    const span = b[0] - a[0] || 1;
    const t = (v - a[0]) / span;
    const i4 = i * 4;
    d[i4] = a[1][0] + (b[1][0] - a[1][0]) * t;
    d[i4 + 1] = a[1][1] + (b[1][1] - a[1][1]) * t;
    d[i4 + 2] = a[1][2] + (b[1][2] - a[1][2]) * t;
    d[i4 + 3] = alpha;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Field -> greyscale canvas (for use as an overlay mask / multiply layer) */
export function fieldToGrey(field, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < field.length; i++) {
    const v = (field[i] < 0 ? 0 : field[i] > 1 ? 1 : field[i]) * 255;
    const i4 = i * 4;
    d[i4] = d[i4 + 1] = d[i4 + 2] = v;
    d[i4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Composite a noise layer onto a target context, upscaled with smoothing.
 * `mode` is any canvas globalCompositeOperation.
 */
export function blitNoise(ctx, W, H, opts = {}) {
  const {
    seed = 1, freqX = 4, freqY = 4, octaves = 4, latSize = 64,
    res = 96, resY = null, ramp = null, alpha = 1, mode = 'source-over',
    contrast = 1, bias = 0,
  } = opts;
  const w = res;
  const h = resY ?? Math.max(4, Math.round(res * (H / W)));
  let f = fbmField(w, h, { seed, freqX, freqY, octaves, latSize });
  if (contrast !== 1 || bias !== 0) {
    for (let i = 0; i < f.length; i++) f[i] = (f[i] - 0.5) * contrast + 0.5 + bias;
  }
  const layer = ramp ? fieldToCanvas(f, w, h, ramp) : fieldToGrey(f, w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, 0, 0, W, H);
  ctx.restore();
}

/**
 * Build a normal map from an fbm height field. Runs on the SMALL field then
 * upscales, which is where the old version wasted all its time.
 */
export function normalMapCanvas(W, H, opts = {}) {
  const { seed = 1, freqX = 5, freqY = 5, octaves = 4, res = 128, strength = 6, latSize = 64 } = opts;
  const w = res;
  const h = Math.max(4, Math.round(res * (H / W)));
  const f = fbmField(w, h, { seed, freqX, freqY, octaves, latSize });

  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const sg = small.getContext('2d');
  const img = sg.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => f[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      const i4 = (y * w + x) * 4;
      d[i4] = (nx / l * 0.5 + 0.5) * 255;
      d[i4 + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i4 + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i4 + 3] = 255;
    }
  }
  sg.putImageData(img, 0, 0);

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, W, H);
  return c;
}

export function clearLatticeCache() { latCache.clear(); }
