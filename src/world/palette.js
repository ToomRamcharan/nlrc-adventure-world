import * as THREE from 'three';

/**
 * Palette extracted from the Desert Canyon reference art.
 * Golden-hour canyon: peach sky -> dusty violet horizon, terracotta strata,
 * warm golden sand, olive cacti, steel rails on chocolate sleepers.
 */
export const PAL = {
  // sky
  skyTop:      0x1f3a72,
  skyHigh:     0x6b5f9c,
  skyMid:      0xc98ba8,
  skyLow:      0xf9b585,
  skyHorizon:  0xf6c393,
  sunCore:     0xfff4d6,
  sunGlow:     0xffb166,

  // rock strata (top -> bottom)
  rock0:       0xc9683b,
  rock1:       0xb2532f,
  rock2:       0x8e3d22,
  rock3:       0xa9563a,
  rock4:       0x7c3a25,
  rockFar:     0xa9737c,
  rockFarther: 0xb4909d,
  mesaHaze:    0xc9a1a8,

  // ground
  sand:        0xd88b55,
  sandDark:    0xb06a3c,
  sandLight:   0xecb783,
  ballast:     0x9c6741,
  ballastDark: 0x77492c,

  // track
  rail:        0xb6bcc4,
  railDark:    0x6d757e,
  sleeper:     0x4a2c1d,
  sleeperAlt:  0x5a3724,

  // props
  cactus:      0x5e7a3d,
  cactusDark:  0x3f5628,
  cactusLight: 0x86a352,
  wood:        0x8a5a33,
  woodDark:    0x5b3a1f,
  woodLight:   0xb2814f,
  crate:       0xa36c3c,
  signYellow:  0xf7c73c,
  signWhite:   0xf2ece0,
  signRed:      0xd0342c,
  metal:       0x8d949c,
  metalDark:   0x4d545c,
  rust:        0x8c4a26,
  lampGlass:   0xffcf7a,

  // trains
  trainBlue:   0x2f6fb5,
  trainBlueDk: 0x1d4b80,
  trainGreen:  0x4f7c4a,
  trainGreenDk:0x33552f,
  trainGrey:   0xb9bec5,
  trainGreyDk: 0x7b8189,
  trainYellow: 0xe0a83a,
  trainRoof:   0x2b2f36,
  trainWindow: 0x1a2836,
  trainLight:  0xfff0b8,

  // gameplay
  coin:        0xffc328,
  coinDark:    0xd18b0d,
  coinHi:      0xfff0a8,

  // atmosphere
  fog:         0xd98f60,
  fogDeep:     0xc87a4e,
  dust:        0xf6cfa2,
};

export const C = Object.fromEntries(
  Object.entries(PAL).map(([k, v]) => [k, new THREE.Color(v)])
);

export function col(hex) { return new THREE.Color(hex); }

/** slight per-instance color jitter so nothing looks flat/cloned */
export function jitter(base, amt = 0.05, rnd = Math.random) {
  const c = new THREE.Color(base);
  const h = { h: 0, s: 0, l: 0 };
  c.getHSL(h);
  c.setHSL(
    (h.h + (rnd() - 0.5) * amt * 0.35 + 1) % 1,
    THREE.MathUtils.clamp(h.s + (rnd() - 0.5) * amt * 1.2, 0, 1),
    THREE.MathUtils.clamp(h.l + (rnd() - 0.5) * amt * 1.6, 0.02, 0.98)
  );
  return c;
}
