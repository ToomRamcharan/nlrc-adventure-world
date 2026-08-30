import * as THREE from 'three';
import { PAL } from '../world/palette.js';
import { mulberry32 } from '../util/rng.js';
import { blitNoise, normalMapCanvas, fbmField, fieldToCanvas } from './noisetex.js';

/**
 * All world textures are generated procedurally at runtime.
 *
 * Performance contract: every generator must stay well under ~15ms. That means
 * NO per-output-pixel JS loops at full resolution. Noise comes from the
 * low-res lattice + native upscale path in noisetex.js; crisp detail is drawn
 * as vectors. See noisetex.js for the rationale.
 */

const cache = new Map();
let genCount = 0;
let genMs = 0;

function memo(key, fn) {
  if (!cache.has(key)) {
    const t0 = performance.now();
    cache.set(key, fn());
    const dt = performance.now() - t0;
    genCount++; genMs += dt;
  }
  return cache.get(key);
}

export function texStats() {
  return { unique: cache.size, generated: genCount, totalMs: +genMs.toFixed(1) };
}

/**
 * Texture variant quantisation.
 *
 * Callers pass semantically-random seeds (e.g. `rng.i(1,999)` per train car) so
 * that individual props look different. If those seeds reached the memo key
 * directly, every prop would generate its OWN texture set — that is exactly
 * what made level generation take 23s and blew up VRAM.
 *
 * Instead we fold any seed into a small fixed number of VARIANTS. Visual
 * variety is preserved (multiple distinct looks, plus per-instance mesh colour
 * and geometry jitter), while the texture count stays bounded and cache hits
 * become the norm.
 */
function variant(seed, buckets) {
  const s = Math.abs(Math.round(Number(seed) || 0));
  return s % buckets;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTex(canvas, repX = 1, repY = 1, aniso = 8, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function rgb(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lerpHex(a, b, t) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}
function mixRgb(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ================================================================== *
 *  SAND / GROUND
 * ================================================================== */
export function sandTexture() {
  return memo('sand', () => {
    const S = 1024;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');

    // base colour from a broad dune field
    blitNoise(g, S, S, {
      seed: 21, freqX: 3, freqY: 5, octaves: 4, res: 128,
      contrast: 1.7,
      ramp: [
        [0.00, mixRgb(PAL.sandDark, 0x000000, 0.18)],
        [0.34, rgb(PAL.sandDark)],
        [0.56, rgb(PAL.sand)],
        [0.80, rgb(PAL.sandLight)],
        [1.00, mixRgb(PAL.sandLight, 0xffffff, 0.22)],
      ],
    });
    // wind-direction streaking (anisotropic: high freq in Y, low in X)
    blitNoise(g, S, S, {
      seed: 88, freqX: 2, freqY: 26, octaves: 3, res: 128,
      alpha: 0.26, mode: 'overlay', contrast: 1.5,
    });
    // fine grain
    blitNoise(g, S, S, {
      seed: 405, freqX: 40, freqY: 40, octaves: 2, res: 256,
      alpha: 0.15, mode: 'overlay', contrast: 1.25,
    });

    // vector detail: pebbles + ripple lines (crisp at full res, cheap)
    const r = mulberry32(9);
    for (let i = 0; i < 1800; i++) {
      const x = r() * S, y = r() * S, rad = 0.7 + r() * 2.4;
      g.globalAlpha = 0.10 + r() * 0.28;
      g.fillStyle = r() < 0.5 ? hex(PAL.sandDark) : hex(PAL.ballastDark);
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      // tiny sun-side highlight so pebbles read as 3D
      g.globalAlpha *= 0.6;
      g.fillStyle = hex(PAL.sandLight);
      g.beginPath(); g.arc(x - rad * 0.35, y - rad * 0.35, rad * 0.5, 0, 7); g.fill();
    }
    g.globalAlpha = 0.075;
    g.lineWidth = 1.3;
    for (let i = 0; i < 170; i++) {
      g.strokeStyle = r() < 0.5 ? hex(PAL.sandLight) : hex(PAL.sandDark);
      const y = r() * S, x = r() * S, len = 50 + r() * 300;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 16, x + len * 0.7, y + (r() - 0.5) * 16, x + len, y + (r() - 0.5) * 9);
      g.stroke();
    }
    g.globalAlpha = 1;
    return toTex(c, 1, 1, 16);
  });
}

export function sandNormal() {
  return memo('sandN', () => {
    const c = normalMapCanvas(512, 512, { seed: 77, freqX: 10, freqY: 14, octaves: 4, res: 128, strength: 4.5 });
    return toTex(c, 1, 1, 4, false);
  });
}

/* ================================================================== *
 *  ROCK / CANYON STRATA
 * ================================================================== */
export function rockTexture(variant = 0) {
  return memo('rock' + variant, () => {
    const W = 512, H = 1024;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const r = mulberry32(101 + variant * 37);

    // --- 1. sedimentary bands as vector fills (crisp, cheap, art-directed) ---
    const strata = [PAL.rock0, PAL.rock1, PAL.rock2, PAL.rock3, PAL.rock4];
    let y = 0;
    let idx = Math.floor(r() * strata.length);
    while (y < H) {
      const bh = 16 + r() * 82;
      const a = strata[idx % strata.length];
      const b = strata[(idx + 1) % strata.length];
      const grad = g.createLinearGradient(0, y, 0, y + bh);
      grad.addColorStop(0, lerpHex(a, b, r() * 0.2));
      grad.addColorStop(0.5, lerpHex(a, b, 0.3 + r() * 0.2));
      grad.addColorStop(1, lerpHex(a, b, 0.6 + r() * 0.35));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, y);
      const segs = 10;
      for (let i = 1; i <= segs; i++) {
        const px = (i / segs) * W;
        g.lineTo(px, y + Math.sin(i * 1.7 + variant * 2.1) * 5 * r());
      }
      g.lineTo(W, y + bh);
      for (let i = segs - 1; i >= 0; i--) {
        const px = (i / segs) * W;
        g.lineTo(px, y + bh + Math.sin(i * 2.3 + variant) * 4 * r());
      }
      g.closePath(); g.fill();

      // hard bedding plane line at the top of each band
      g.globalAlpha = 0.22;
      g.strokeStyle = '#3d1a0e'; g.lineWidth = 0.9 + r() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      for (let i = 1; i <= segs; i++) g.lineTo((i / segs) * W, y + Math.sin(i * 1.7 + variant * 2.1) * 5 * r());
      g.stroke();
      g.globalAlpha = 1;

      y += bh; idx++;
    }

    // --- 2. noise layers for weathering, blotching, grain ---
    blitNoise(g, W, H, { seed: 220 + variant, freqX: 4, freqY: 8, octaves: 4, res: 96, alpha: 0.30, mode: 'overlay', contrast: 1.5 });
    blitNoise(g, W, H, { seed: 640 + variant, freqX: 14, freqY: 20, octaves: 3, res: 160, alpha: 0.20, mode: 'overlay', contrast: 1.35 });
    // large-scale sun/shade patchiness that breaks up tiling
    blitNoise(g, W, H, { seed: 990 + variant, freqX: 1.6, freqY: 2.4, octaves: 3, res: 64, alpha: 0.17, mode: 'soft-light', contrast: 1.9 });

    // --- 3. vertical erosion channels (desert varnish streaks) ---
    g.globalAlpha = 0.15;
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      const w = 3 + r() * 18;
      g.fillStyle = r() < 0.55 ? '#4a2113' : '#eaa87a';
      g.beginPath();
      g.moveTo(x, 0);
      for (let yy = 0; yy <= H; yy += 96) g.lineTo(x + Math.sin(yy * 0.011 + i) * 10, yy);
      for (let yy = H; yy >= 0; yy -= 96) g.lineTo(x + w + Math.sin(yy * 0.011 + i) * 10, yy);
      g.closePath(); g.fill();
    }

    // --- 4. cracks / joints ---
    g.globalAlpha = 0.30;
    g.strokeStyle = '#361509';
    g.lineCap = 'round';
    for (let i = 0; i < 80; i++) {
      g.lineWidth = 0.6 + r() * 2.0;
      let px = r() * W, py = r() * H;
      g.beginPath(); g.moveTo(px, py);
      for (let s = 0; s < 5; s++) {
        px += (r() - 0.5) * 66; py += (r() - 0.25) * 56;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    // bright edge next to some cracks = chipped rock catching the sun
    g.globalAlpha = 0.14;
    g.strokeStyle = '#ffd0a0';
    for (let i = 0; i < 40; i++) {
      g.lineWidth = 0.6 + r() * 1.3;
      let px = r() * W, py = r() * H;
      g.beginPath(); g.moveTo(px, py);
      for (let s = 0; s < 4; s++) { px += (r() - 0.5) * 50; py += (r() - 0.3) * 44; g.lineTo(px, py); }
      g.stroke();
    }
    g.globalAlpha = 1;
    return toTex(c, 1, 1, 16);
  });
}

export function rockNormal(variant = 0) {
  return memo('rockN' + variant, () => {
    const c = normalMapCanvas(256, 512, {
      seed: 400 + variant, freqX: 5, freqY: 16, octaves: 4, res: 128, strength: 7,
    });
    return toTex(c, 1, 1, 4, false);
  });
}

/* ================================================================== *
 *  BALLAST
 * ================================================================== */
export function ballastTexture() {
  return memo('ballast', () => {
    const S = 512;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    blitNoise(g, S, S, {
      seed: 55, freqX: 8, freqY: 8, octaves: 3, res: 128, contrast: 1.4,
      ramp: [
        [0.0, mixRgb(PAL.ballastDark, 0x000000, 0.2)],
        [0.45, rgb(PAL.ballastDark)],
        [0.7, rgb(PAL.ballast)],
        [1.0, rgb(PAL.sandLight)],
      ],
    });
    // angular gravel chips with a lit facet — this is what sells crushed stone
    const r = mulberry32(55);
    for (let i = 0; i < 5200; i++) {
      const x = r() * S, y = r() * S, rad = 1.6 + r() * 4.6;
      const t = r();
      const base = t < 0.34 ? PAL.ballastDark : t < 0.68 ? PAL.sandDark : PAL.ballast;
      g.globalAlpha = 0.45 + r() * 0.45;
      // body
      const pts = [];
      const nSides = 4 + ((r() * 2) | 0);
      for (let a = 0; a < nSides; a++) {
        const ang = (a / nSides) * Math.PI * 2 + r() * 0.5;
        pts.push([x + Math.cos(ang) * rad * (0.6 + r() * 0.7), y + Math.sin(ang) * rad * (0.6 + r() * 0.7)]);
      }
      g.fillStyle = hex(base);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let a = 1; a < pts.length; a++) g.lineTo(pts[a][0], pts[a][1]);
      g.closePath(); g.fill();
      // lit top-left facet
      g.globalAlpha *= 0.55;
      g.fillStyle = hex(PAL.sandLight);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      g.lineTo(pts[1][0], pts[1][1]);
      g.lineTo(x - rad * 0.2, y - rad * 0.2);
      g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    return toTex(c, 1, 1, 16);
  });
}

/* ================================================================== *
 *  WOOD
 * ================================================================== */
const WOOD_VARIANTS = 4;
export function woodTexture(base = PAL.wood, seedIn = 3) {
  const seed = variant(seedIn, WOOD_VARIANTS) * 977 + 13;
  return memo('wood' + base + '#' + variant(seedIn, WOOD_VARIANTS), () => {
    const W = 256, H = 256;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, W, H);
    // grain: strongly anisotropic noise = wood
    blitNoise(g, W, H, { seed, freqX: 2, freqY: 34, octaves: 3, res: 96, alpha: 0.42, mode: 'overlay', contrast: 1.65 });
    blitNoise(g, W, H, { seed: seed + 91, freqX: 1.5, freqY: 9, octaves: 3, res: 64, alpha: 0.26, mode: 'multiply', contrast: 1.25, bias: 0.14 });

    const r = mulberry32(seed);
    // crisp grain lines
    for (let i = 0; i < 90; i++) {
      const y = r() * H;
      g.globalAlpha = 0.07 + r() * 0.20;
      g.strokeStyle = r() < 0.5 ? '#2b1809' : '#dcaa6e';
      g.lineWidth = 0.7 + r() * 2.2;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.6);
      g.stroke();
    }
    // knots
    g.globalAlpha = 0.38;
    for (let i = 0; i < 4; i++) {
      const x = r() * W, y = r() * H, rad = 4 + r() * 9;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, '#301d0d'); grad.addColorStop(0.6, 'rgba(48,29,13,0.5)'); grad.addColorStop(1, 'rgba(48,29,13,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      // grain deflection ring
      g.strokeStyle = 'rgba(40,24,10,0.45)'; g.lineWidth = 1.1;
      g.beginPath(); g.ellipse(x, y, rad * 1.6, rad * 0.8, 0, 0, 7); g.stroke();
    }
    // plank seams
    g.globalAlpha = 0.5;
    g.strokeStyle = '#241305'; g.lineWidth = 2.2;
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i + r() * 6 - 3;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.globalAlpha = 1;
    return toTex(c, 1, 1, 8);
  });
}

/* ================================================================== *
 *  METAL
 * ================================================================== */
const METAL_VARIANTS = 3;
export function metalTexture(base = PAL.metal, rustIn = 0.4, seedIn = 5) {
  // quantise rust to 4 levels so slightly-different values share a texture
  const rustAmt = Math.round(THREE.MathUtils.clamp(rustIn, 0, 1) * 3) / 3;
  const v = variant(seedIn, METAL_VARIANTS);
  const seed = v * 881 + 29;
  return memo('metal' + base + '|' + rustAmt + '#' + v, () => {
    const W = 256, H = 256;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, W, H);
    // brushed anisotropy
    blitNoise(g, W, H, { seed: seed + 3, freqX: 1.5, freqY: 46, octaves: 2, res: 128, alpha: 0.20, mode: 'overlay', contrast: 1.4 });
    // broad panel shading
    blitNoise(g, W, H, { seed: seed + 17, freqX: 2.5, freqY: 2.5, octaves: 3, res: 64, alpha: 0.16, mode: 'soft-light', contrast: 1.7 });

    const r = mulberry32(seed);
    // rust patches (radial, layered for depth)
    const patches = Math.floor(rustAmt * 46);
    for (let i = 0; i < patches; i++) {
      const x = r() * W, y = r() * H, rad = 5 + r() * 30;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, '#7a3a17');
      grad.addColorStop(0.45, hex(PAL.rust));
      grad.addColorStop(1, 'rgba(140,74,38,0)');
      g.globalAlpha = 0.20 + r() * 0.42;
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      // pitted core
      g.globalAlpha *= 0.7;
      g.fillStyle = '#4d2410';
      for (let k = 0; k < 5; k++) {
        g.beginPath(); g.arc(x + (r() - 0.5) * rad, y + (r() - 0.5) * rad, 0.8 + r() * 2.2, 0, 7); g.fill();
      }
    }
    // rust streaks running down from patches
    g.globalAlpha = 0.16;
    g.strokeStyle = hex(PAL.rust);
    for (let i = 0; i < Math.floor(rustAmt * 30); i++) {
      g.lineWidth = 1 + r() * 4;
      const x = r() * W, y = r() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y + 12 + r() * 60); g.stroke();
    }
    // scratches
    g.globalAlpha = 0.13;
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = r() < 0.5 ? '#0d0d0d' : '#f2f2f2'; g.lineWidth = 0.5 + r() * 1.3;
      const x = r() * W, y = r() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 70, y + (r() - 0.5) * 14); g.stroke();
    }
    g.globalAlpha = 1;
    return toTex(c, 1, 1, 8);
  });
}

/* ================================================================== *
 *  SIGNS
 * ================================================================== */
export function signTexture(kind = 'falling-rocks') {
  return memo('sign' + kind, () => {
    const S = 256;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const FONT = '"Bai Jamjuree", "Arial Black", Arial, sans-serif';

    if (kind === 'falling-rocks') {
      g.fillStyle = hex(PAL.signYellow); g.fillRect(0, 0, S, S);
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 9;
      g.strokeRect(9, 9, S - 18, S - 18);
      g.fillStyle = '#1b1b1b';
      g.beginPath(); g.moveTo(28, 152); g.lineTo(96, 42); g.lineTo(96, 152); g.closePath(); g.fill();
      const rocks = [[128, 64, 16], [164, 100, 13], [140, 124, 10], [188, 138, 15], [118, 148, 9]];
      for (const [x, y, r0] of rocks) {
        g.beginPath();
        g.moveTo(x + r0, y);
        for (let a = 1; a < 6; a++) {
          const ang = (a / 6) * Math.PI * 2;
          g.lineTo(x + Math.cos(ang) * r0 * (0.7 + (a % 2) * 0.4), y + Math.sin(ang) * r0 * (0.75 + (a % 3) * 0.25));
        }
        g.closePath(); g.fill();
      }
      g.textAlign = 'center';
      g.font = `bold 33px ${FONT}`;
      g.fillText('CAUTION', S / 2, 196);
      g.font = `bold 24px ${FONT}`;
      g.fillText('FALLING ROCKS', S / 2, 224);
    } else if (kind === 'chevron') {
      g.fillStyle = hex(PAL.signWhite); g.fillRect(0, 0, S, S);
      g.fillStyle = hex(PAL.signRed);
      for (let i = -1; i < 5; i++) {
        const y = i * 56;
        g.beginPath();
        g.moveTo(0, y); g.lineTo(S / 2, y + 34); g.lineTo(S, y);
        g.lineTo(S, y + 28); g.lineTo(S / 2, y + 62); g.lineTo(0, y + 28);
        g.closePath(); g.fill();
      }
    } else if (kind === 'mine') {
      g.fillStyle = '#2a2016'; g.fillRect(0, 0, S, S);
      g.fillStyle = hex(PAL.signYellow);
      g.font = `bold 40px ${FONT}`; g.textAlign = 'center';
      g.fillText('MINE', S / 2, 100);
      g.fillText('No. 7', S / 2, 150);
      g.strokeStyle = hex(PAL.signYellow); g.lineWidth = 6; g.strokeRect(14, 14, S - 28, S - 28);
    } else if (kind === 'speed') {
      g.fillStyle = hex(PAL.signWhite); g.fillRect(0, 0, S, S);
      g.strokeStyle = hex(PAL.signRed); g.lineWidth = 22;
      g.beginPath(); g.arc(S / 2, S / 2, 100, 0, 7); g.stroke();
      g.fillStyle = '#181818'; g.font = `bold 104px ${FONT}`; g.textAlign = 'center';
      g.fillText('40', S / 2, S / 2 + 36);
    } else if (kind === 'nlrc') {
      const grad = g.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, '#ff9d3f'); grad.addColorStop(1, '#dd5c12');
      g.fillStyle = grad; g.fillRect(0, 0, S, S);
      g.fillStyle = '#fff'; g.font = `italic bold 60px ${FONT}`; g.textAlign = 'center';
      g.fillText('NLRC', S / 2, 112);
      g.font = `bold 24px ${FONT}`;
      g.fillText('STREET RUNNER', S / 2, 152);
      g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(12, 12, S - 24, S - 24);
    }

    // grime + sun-bleach pass so signage doesn't look freshly printed
    blitNoise(g, S, S, { seed: kind.length * 31 + 7, freqX: 5, freqY: 5, octaves: 3, res: 64, alpha: 0.13, mode: 'overlay', contrast: 1.6 });
    const r = mulberry32(kind.length * 17 + 3);
    g.globalAlpha = 0.11;
    for (let i = 0; i < 60; i++) {
      g.fillStyle = r() < 0.6 ? '#2a1a10' : '#fff5e0';
      g.beginPath(); g.arc(r() * S, r() * S, 1 + r() * 13, 0, 7); g.fill();
    }
    // rust bleed from the mounting bolts
    g.globalAlpha = 0.22;
    for (const [bx, by] of [[S * 0.5, 26], [S * 0.5, S - 26]]) {
      g.fillStyle = '#5c2f14';
      g.beginPath(); g.arc(bx, by, 5, 0, 7); g.fill();
      const grad = g.createLinearGradient(bx, by, bx, by + 40);
      grad.addColorStop(0, 'rgba(120,58,28,0.55)'); grad.addColorStop(1, 'rgba(120,58,28,0)');
      g.fillStyle = grad; g.fillRect(bx - 4, by, 8, 40);
    }
    g.globalAlpha = 1;

    const t = toTex(c, 1, 1, 8);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* ================================================================== *
 *  TRAIN SIDE / FRONT
 * ================================================================== */
const TRAIN_VARIANTS = 3;
export function trainSideTexture(bodyHex, roofHex, seedIn = 2, opts = {}) {
  const v = variant(seedIn, TRAIN_VARIANTS);
  const seed = v * 613 + 7;
  // window count also quantised: it only affects layout density
  const wq = opts.windows === 0 ? 0 : Math.max(4, Math.round((opts.windows ?? 7) / 2) * 2);
  const key = `train|${bodyHex}|${roofHex}|${wq}|${opts.stripe ?? 'x'}|${opts.stripeY ?? 'x'}#${v}`;
  opts = { ...opts, windows: wq };
  return memo(key, () => {
    const W = 1024, H = 256;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const r = mulberry32(seed);

    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, lerpHex(bodyHex, 0xffffff, 0.22));
    grad.addColorStop(0.28, hex(bodyHex));
    grad.addColorStop(0.60, lerpHex(bodyHex, 0x000000, 0.10));
    grad.addColorStop(1, lerpHex(bodyHex, 0x000000, 0.36));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    // panel shading noise so the flank isn't a flat gradient
    blitNoise(g, W, H, { seed: seed + 41, freqX: 12, freqY: 3, octaves: 3, res: 128, alpha: 0.10, mode: 'overlay', contrast: 1.5 });

    g.fillStyle = hex(roofHex); g.fillRect(0, 0, W, 34);
    g.fillStyle = 'rgba(255,255,255,0.11)'; g.fillRect(0, 30, W, 5);
    g.fillStyle = lerpHex(bodyHex, 0x000000, 0.52); g.fillRect(0, H - 40, W, 40);

    const stripeY = opts.stripeY ?? 150;
    g.fillStyle = opts.stripe ? hex(opts.stripe) : lerpHex(bodyHex, 0xffffff, 0.75);
    g.fillRect(0, stripeY, W, 12);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, stripeY + 12, W, 3);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, stripeY - 2, W, 2);

    const count = opts.windows ?? 7;
    if (count > 0) {
      const wy = 56, wh = 76, pad = 44;
      const span = (W - pad * 2) / count;
      for (let i = 0; i < count; i++) {
        const x = pad + i * span + span * 0.10;
        const w = span * 0.80;
        g.fillStyle = lerpHex(bodyHex, 0x000000, 0.48);
        roundRect(g, x - 4, wy - 4, w + 8, wh + 8, 9); g.fill();
        const gg = g.createLinearGradient(x, wy, x + w, wy + wh);
        gg.addColorStop(0, '#43657f');
        gg.addColorStop(0.40, '#13202d');
        gg.addColorStop(0.58, '#254056');
        gg.addColorStop(1, '#0b1319');
        g.fillStyle = gg;
        roundRect(g, x, wy, w, wh, 7); g.fill();
        // sky reflection streak
        g.save(); roundRect(g, x, wy, w, wh, 7); g.clip();
        g.globalAlpha = 0.26; g.fillStyle = '#d6ecff';
        g.beginPath(); g.moveTo(x, wy + wh * 0.74); g.lineTo(x + w * 0.55, wy); g.lineTo(x + w * 0.82, wy); g.lineTo(x + w * 0.22, wy + wh); g.closePath(); g.fill();
        // warm sunset glint low in the glass
        g.globalAlpha = 0.16; g.fillStyle = '#ffcf90';
        g.fillRect(x, wy + wh * 0.80, w, wh * 0.2);
        g.restore(); g.globalAlpha = 1;
      }
      // door seams
      for (let i = 1; i < count; i += 3) {
        const x = pad + i * span;
        g.strokeStyle = 'rgba(0,0,0,0.36)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x - 6, 40); g.lineTo(x - 6, H - 42); g.stroke();
        g.beginPath(); g.moveTo(x - 6 + span * 0.9, 40); g.lineTo(x - 6 + span * 0.9, H - 42); g.stroke();
      }
    }

    // rivets with highlight
    for (let x = 20; x < W; x += 26) {
      g.fillStyle = 'rgba(0,0,0,0.26)';
      g.beginPath(); g.arc(x, 44, 2.2, 0, 7); g.fill();
      g.beginPath(); g.arc(x, H - 48, 2.2, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.20)';
      g.beginPath(); g.arc(x - 0.7, 43.2, 1.1, 0, 7); g.fill();
      g.beginPath(); g.arc(x - 0.7, H - 48.8, 1.1, 0, 7); g.fill();
    }

    // desert dust accumulation at the bottom — critical for "this train lives here"
    const gr = g.createLinearGradient(0, H - 110, 0, H);
    gr.addColorStop(0, 'rgba(150,92,48,0)');
    gr.addColorStop(0.55, 'rgba(150,92,48,0.20)');
    gr.addColorStop(1, 'rgba(160,102,56,0.55)');
    g.fillStyle = gr; g.fillRect(0, H - 110, W, 110);
    blitNoise(g, W, H, { seed: seed + 77, freqX: 18, freqY: 4, octaves: 3, res: 128, alpha: 0.09, mode: 'multiply', contrast: 1.4, bias: 0.2 });

    g.globalAlpha = 0.13;
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = r() < 0.5 ? '#0a0a0a' : '#ffffff'; g.lineWidth = 0.6 + r() * 1.3;
      const x = r() * W, y = r() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 56, y + (r() - 0.5) * 11); g.stroke();
    }
    g.globalAlpha = 1;

    const t = toTex(c, 1, 1, 8);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

export function trainFrontTexture(bodyHex, roofHex, seedIn = 4) {
  const v = variant(seedIn, TRAIN_VARIANTS);
  const seed = v * 431 + 11;
  return memo('trainF|' + bodyHex + '|' + roofHex + '#' + v, () => {
    const S = 512;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, lerpHex(bodyHex, 0xffffff, 0.20));
    grad.addColorStop(0.52, hex(bodyHex));
    grad.addColorStop(1, lerpHex(bodyHex, 0x000000, 0.44));
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    g.fillStyle = hex(roofHex); g.fillRect(0, 0, S, 62);

    blitNoise(g, S, S, { seed: seed + 9, freqX: 4, freqY: 4, octaves: 3, res: 96, alpha: 0.09, mode: 'overlay', contrast: 1.5 });

    // windshield
    const gg = g.createLinearGradient(0, 90, S, 250);
    gg.addColorStop(0, '#53788f'); gg.addColorStop(0.48, '#15232f'); gg.addColorStop(1, '#0a1117');
    g.fillStyle = gg;
    roundRect(g, 54, 94, S - 108, 150, 22); g.fill();
    g.strokeStyle = lerpHex(bodyHex, 0x000000, 0.52); g.lineWidth = 10;
    roundRect(g, 54, 94, S - 108, 150, 22); g.stroke();
    g.fillStyle = lerpHex(bodyHex, 0x000000, 0.52);
    g.fillRect(S / 2 - 6, 94, 12, 150);
    g.save(); roundRect(g, 54, 94, S - 108, 150, 22); g.clip();
    g.globalAlpha = 0.24; g.fillStyle = '#dcf0ff';
    g.beginPath(); g.moveTo(54, 232); g.lineTo(242, 94); g.lineTo(322, 94); g.lineTo(122, 244); g.closePath(); g.fill();
    g.globalAlpha = 0.18; g.fillStyle = '#ffd39a';
    g.fillRect(54, 208, S - 108, 36);
    // wiper arcs
    g.globalAlpha = 0.30; g.strokeStyle = '#0d1318'; g.lineWidth = 4;
    g.beginPath(); g.arc(S * 0.30, 244, 70, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
    g.beginPath(); g.arc(S * 0.70, 244, 70, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
    g.restore(); g.globalAlpha = 1;

    // headlights
    for (const x of [116, S - 116]) {
      const rg = g.createRadialGradient(x, 320, 2, x, 320, 48);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.30, '#ffeaa8'); rg.addColorStop(1, 'rgba(255,200,90,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, 320, 48, 0, 7); g.fill();
      g.fillStyle = '#fffbe4'; g.beginPath(); g.arc(x, 320, 19, 0, 7); g.fill();
      g.strokeStyle = '#282d34'; g.lineWidth = 5; g.beginPath(); g.arc(x, 320, 22, 0, 7); g.stroke();
      // chrome bezel
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, 320, 26, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    }

    // hazard stripes
    g.save();
    g.beginPath(); g.rect(0, S - 92, S, 60); g.clip();
    g.fillStyle = '#f2ece0'; g.fillRect(0, S - 92, S, 60);
    g.fillStyle = '#d0342c';
    for (let i = -1; i < 14; i++) {
      const x = i * 44;
      g.beginPath();
      g.moveTo(x, S - 92); g.lineTo(x + 22, S - 92); g.lineTo(x + 22 - 34, S - 32); g.lineTo(x - 34, S - 32);
      g.closePath(); g.fill();
    }
    g.restore();

    g.fillStyle = '#282d34'; g.fillRect(S / 2 - 52, S - 34, 104, 34);

    // dust film low on the nose
    const dgr = g.createLinearGradient(0, S - 160, 0, S);
    dgr.addColorStop(0, 'rgba(150,92,48,0)'); dgr.addColorStop(1, 'rgba(155,98,52,0.42)');
    g.fillStyle = dgr; g.fillRect(0, S - 160, S, 160);

    const t = toTex(c, 1, 1, 8);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* ================================================================== *
 *  COIN
 * ================================================================== */
export function coinTexture() {
  return memo('coin', () => {
    const S = 256;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const grad = g.createRadialGradient(S * 0.36, S * 0.32, 6, S / 2, S / 2, S / 2);
    grad.addColorStop(0, '#fff8cc');
    grad.addColorStop(0.42, hex(PAL.coin));
    grad.addColorStop(1, hex(PAL.coinDark));
    g.fillStyle = grad;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.fill();
    g.strokeStyle = hex(PAL.coinDark); g.lineWidth = 14;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 10, 0, 7); g.stroke();
    g.strokeStyle = '#ffeb92'; g.lineWidth = 5;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 22, 0, 7); g.stroke();
    // reeded edge ticks
    g.strokeStyle = 'rgba(140,90,8,0.5)'; g.lineWidth = 2.4;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * (S / 2 - 17), S / 2 + Math.sin(a) * (S / 2 - 17));
      g.lineTo(S / 2 + Math.cos(a) * (S / 2 - 4), S / 2 + Math.sin(a) * (S / 2 - 4));
      g.stroke();
    }
    // star
    g.fillStyle = '#fff2ac';
    g.strokeStyle = hex(PAL.coinDark); g.lineWidth = 6;
    g.beginPath();
    const cx = S / 2, cy = S / 2 + 4, R = 62, r0 = 26;
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? R : r0;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath(); g.fill(); g.stroke();
    // star inner bevel
    g.globalAlpha = 0.4; g.strokeStyle = '#fffbe0'; g.lineWidth = 2.6;
    g.stroke(); g.globalAlpha = 1;

    const t = toTex(c, 1, 1, 8);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* ================================================================== *
 *  PARTICLE SPRITES
 * ================================================================== */
export function softDot(colorHex = 0xffffff, hardness = 0.25) {
  return memo('dot' + colorHex + hardness, () => {
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const col = new THREE.Color(colorHex);
    const rr = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, `rgba(${rr},1)`);
    grad.addColorStop(hardness, `rgba(${rr},0.74)`);
    grad.addColorStop(0.60, `rgba(${rr},0.23)`);
    grad.addColorStop(1, `rgba(${rr},0)`);
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function sandWisp() {
  return memo('wisp', () => {
    const W = 256, H = 128;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(246,207,162,0)');
    grad.addColorStop(0.32, 'rgba(246,207,162,0.55)');
    grad.addColorStop(0.60, 'rgba(255,226,186,0.78)');
    grad.addColorStop(1, 'rgba(246,207,162,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(W / 2, H / 2, W / 2, H * 0.26, 0, 0, 7); g.fill();
    // texture the wisp so it doesn't read as a clean blob
    g.globalCompositeOperation = 'destination-in';
    blitNoise(g, W, H, { seed: 313, freqX: 9, freqY: 4, octaves: 3, res: 64, alpha: 0.9, mode: 'destination-in', contrast: 1.35, bias: 0.24 });
    g.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/* ================================================================== *
 *  CACTUS
 * ================================================================== */
export function cactusTexture() {
  return memo('cactus', () => {
    const W = 128, H = 512;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, hex(PAL.cactusDark));
    grad.addColorStop(0.26, hex(PAL.cactus));
    grad.addColorStop(0.46, hex(PAL.cactusLight));
    grad.addColorStop(0.68, hex(PAL.cactus));
    grad.addColorStop(1, hex(PAL.cactusDark));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    // ribs
    for (let i = 0; i < 9; i++) {
      const x = (i / 9) * W + 4;
      g.globalAlpha = 0.30;
      g.strokeStyle = '#28391a'; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.globalAlpha = 0.18;
      g.strokeStyle = '#aecb72'; g.lineWidth = 1.7;
      g.beginPath(); g.moveTo(x + 5, 0); g.lineTo(x + 5, H); g.stroke();
    }
    g.globalAlpha = 1;
    // organic mottling
    blitNoise(g, W, H, { seed: 88, freqX: 3, freqY: 12, octaves: 3, res: 64, alpha: 0.20, mode: 'overlay', contrast: 1.5 });

    // spine clusters sitting on the rib crests
    const r = mulberry32(88);
    g.fillStyle = '#efe6b4';
    for (let i = 0; i < 300; i++) {
      const rib = Math.floor(r() * 9);
      const x = (rib / 9) * W + 4 + (r() - 0.5) * 3;
      const y = r() * H;
      g.globalAlpha = 0.45 + r() * 0.4;
      g.beginPath(); g.arc(x, y, 0.7 + r() * 1.3, 0, 7); g.fill();
      // tiny shadow under the spine
      g.globalAlpha *= 0.5;
      g.fillStyle = '#1f3010';
      g.beginPath(); g.arc(x + 0.8, y + 1.0, 0.8, 0, 7); g.fill();
      g.fillStyle = '#efe6b4';
    }
    g.globalAlpha = 1;
    return toTex(c, 1, 1, 8);
  });
}

/* ================================================================== *
 *  BLOB SHADOW
 * ================================================================== */
export function blobShadow() {
  return memo('blob', () => {
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(58,22,9,0.66)');
    grad.addColorStop(0.45, 'rgba(58,22,9,0.34)');
    grad.addColorStop(1, 'rgba(58,22,9,0)');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function disposeTextureCache() {
  for (const t of cache.values()) if (t.dispose) t.dispose();
  cache.clear();
}
