import * as THREE from 'three';
import { PAL } from './world/palette.js';
import {
  LANES, LANE_W, CAM, PLAYER, CHUNK_LEN, VIEW_FAR, FOG_NEAR, FOG_FAR, COIN, ZONES,
} from './world/constants.js';
import { Sky } from './render/sky.js';
import { CanyonWalls, makeMesaBackdrop } from './world/canyon.js';
import { Track, Ground } from './world/track.js';
import { LevelGen } from './world/levelgen.js';
import { Player } from './entities/player.js';
import { DustMotes, SandStorm, GodRays, TunnelSparks, Bursts } from './systems/atmosphere.js';
import { PostFX } from './render/post.js';
import { Rng } from './util/rng.js';
import { texStats } from './render/textures.js';
import { matStats } from './entities/props.js';
import { geoStats } from './render/geocache.js';

/* ================================================================== *
 *  BOOT PROFILER
 * ================================================================== */
const T0 = performance.now();
const marks = [];
function mark(label) {
  const t = performance.now();
  marks.push([label, +(t - T0).toFixed(1)]);
  console.log(`[boot] ${label} @ ${(t - T0).toFixed(1)}ms`);
}

/* ================================================================== *
 *  RENDERER + SCENE
 * ================================================================== */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;   // tonemap in post
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// Sky uses a fullscreen quad with depth test off; keep three's own sorting from
// interleaving it with opaque geometry.
scene.matrixWorldAutoUpdate = true;

/* ---- sun direction: low, behind-right, golden hour ---- */
const SUN_DIR = new THREE.Vector3(0.34, 0.115, 1.0).normalize();

/* ---- fog ---- */
scene.fog = new THREE.Fog(PAL.fog, FOG_NEAR, FOG_FAR);

/* ---- camera ---- */
const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.35, VIEW_FAR);
camera.position.set(0, CAM.height, -CAM.back);

/* ================================================================== *
 *  LIGHTING
 * ================================================================== */
const hemi = new THREE.HemisphereLight(0xffd9a8, 0x7a3f26, 0.52);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffcf90, 3.55);
sun.position.copy(SUN_DIR).multiplyScalar(70);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.camera.left = -34;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.032;
scene.add(sun);
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sun.target = sunTarget;

// warm bounce from the canyon floor
const bounce = new THREE.DirectionalLight(0xff9a5c, 0.62);
bounce.position.set(-0.5, -0.7, -0.4);
scene.add(bounce);

// cool sky fill from above-left
const fill = new THREE.DirectionalLight(0x9fb4e8, 0.42);
fill.position.set(-0.85, 0.9, -0.35);
scene.add(fill);

/* ---- procedural environment map so metals read correctly ---- */
function buildEnvMap() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#3f5ea8');
  grad.addColorStop(0.34, '#c39ab4');
  grad.addColorStop(0.50, '#ffd39a');
  grad.addColorStop(0.56, '#ffbc7c');
  grad.addColorStop(0.72, '#c0703e');
  grad.addColorStop(1, '#7c3f22');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  // sun blob
  const rg = g.createRadialGradient(size * 0.72, size * 0.50, 2, size * 0.72, size * 0.50, size * 0.22);
  rg.addColorStop(0, 'rgba(255,255,240,1)');
  rg.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = rg; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
const envMap = buildEnvMap();
scene.environment = envMap;
mark('envmap');

/* ================================================================== *
 *  WORLD
 * ================================================================== */
const sky = new Sky(scene, SUN_DIR);
mark('sky');
const canyon = new CanyonWalls(scene, { seed: 4242, segLen: 4.0, spanLen: 720 });
mark('canyon');
const ground = new Ground(scene, canyon, { tileLen: 300, width: 150 });
mark('ground');
const track = new Track(scene, 240);
mark('track');
const level = new LevelGen(scene, canyon, { seed: 20250830 });
mark('levelgen-ctor');

// distant mesa backdrop that follows the camera
const backdropRng = new Rng(777);
const mesaFar = makeMesaBackdrop(backdropRng, 30);
scene.add(mesaFar);
{
  // arrange mesas in an arc far ahead
  let i = 0;
  for (const m of mesaFar.children) {
    const t = (i / mesaFar.children.length) * 2 - 1;
    m.position.set(t * 300, 0, 360 + Math.abs(t) * -55 + backdropRng.f(-30, 30));
    m.scale.setScalar(backdropRng.f(0.8, 1.9));
    i++;
  }
}

const player = new Player(scene);
mark('player');

/* ---- atmosphere ---- */
const dust = new DustMotes(scene, 950);
const storm = new SandStorm(scene, 170);
const rays = new GodRays(scene, SUN_DIR, 8);
const sparks = new TunnelSparks(scene, 130);
const bursts = new Bursts(scene, 110);
mark('atmosphere');

/* ---- post ---- */
const post = new PostFX(renderer, window.innerWidth, window.innerHeight, {
  bloom: 0.52, exposure: 0.90, vignette: 0.50, chroma: 0.50,
  shimmer: 0.6, grain: 0.020, threshold: 0.80, bloomScale: 4,
});

/* ================================================================== *
 *  GAME STATE
 * ================================================================== */
const S = {
  mode: 'menu',        // menu | playing | dead
  time: 0,
  score: 0,
  coins: 0,
  distance: 0,
  best: Number(localStorage.getItem('dc_best') || 0),
  stormT: 0,
  tunnelT: 0,
  shakeT: 0,
  shakeAmt: 0,
  hurt: 0,
  lastZone: '',
  combo: 0,
  comboT: 0,
};

const el = {
  score: document.getElementById('score'),
  coins: document.getElementById('coins'),
  dist: document.getElementById('dist'),
  banner: document.getElementById('banner'),
  toast: document.getElementById('zone-toast'),
  rail: document.getElementById('feature-rail'),
  overlay: document.getElementById('overlay'),
  gameover: document.getElementById('gameover'),
  goDist: document.getElementById('go-dist'),
  goCoins: document.getElementById('go-coins'),
  goScore: document.getElementById('go-score'),
  loader: document.getElementById('loader'),
  btnPlay: document.getElementById('btn-play'),
  btnRetry: document.getElementById('btn-retry'),
  btnPause: document.getElementById('btn-pause'),
};

/* ================================================================== *
 *  INPUT
 * ================================================================== */
let paused = false;
function onKey(e) {
  if (S.mode === 'menu') { if (e.code === 'Space' || e.code === 'Enter') startGame(); return; }
  if (S.mode === 'dead') { if (e.code === 'Space' || e.code === 'Enter') startGame(); return; }
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': player.moveLane(-1); break;
    case 'ArrowRight': case 'KeyD': player.moveLane(1); break;
    case 'ArrowUp': case 'KeyW': case 'Space': player.jump(); e.preventDefault(); break;
    case 'ArrowDown': case 'KeyS': player.roll(); break;
    case 'KeyP': paused = !paused; break;
  }
}
window.addEventListener('keydown', onKey);

let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const dt = performance.now() - touchStart.t;
  touchStart = null;
  if (S.mode !== 'playing') { startGame(); return; }
  const TH = 26;
  if (Math.abs(dx) < TH && Math.abs(dy) < TH && dt < 300) { player.jump(); return; }
  if (Math.abs(dx) > Math.abs(dy)) player.moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) player.jump();
  else player.roll();
}, { passive: true });

// mouse click on menu
el.btnPlay.addEventListener('click', startGame);
el.btnRetry.addEventListener('click', startGame);
el.btnPause.addEventListener('click', () => { paused = !paused; });

/* ================================================================== *
 *  COLLISION
 * ================================================================== */
function collide(dt) {
  if (!player.alive) return;
  const pz = player.z;
  const px = player.x;
  const py = player.y;
  const pr = PLAYER.radius;
  const ph = player.collideHeight;

  const obs = level.nearbyObstacles(pz - 4, 20);
  for (const o of obs) {
    // z overlap
    const zPad = pr * 0.85;
    if (pz + zPad < o.zMin || pz - zPad > o.zMax) continue;
    // x overlap
    const xOverlap = Math.abs(px - o.x) < (o.w / 2 + pr * 0.72);
    if (!xOverlap) continue;

    if (o.type === 'roll') {
      // overhead beam: must be low
      if (py + ph > o.clearY) {
        hitObstacle(o, 'beam');
        return;
      }
      continue;
    }
    if (o.type === 'ramp') {
      // ramp lifts the player
      const t = THREE.MathUtils.clamp((pz - o.zMin) / (o.zMax - o.zMin), 0, 1);
      const rampY = t * (o.rampH ?? 1.15);
      if (py <= rampY + 0.12) {
        player.y = rampY;
        player.grounded = false;
        // launch at the top
        if (t > 0.86 && player.vy <= 0.1) {
          player.vy = PLAYER.jumpVel * 1.06;
          bursts.spawn(new THREE.Vector3(px, rampY, pz), 0xf0c68a, 6, 1.2, 0.5);
        }
      }
      continue;
    }
    // solid: pass over if high enough
    if (py > o.h - 0.06) continue;
    hitObstacle(o, o.type);
    return;
  }
}

function hitObstacle(o, kind) {
  if (o.type === 'train' || kind === 'train') {
    kill('train');
    return;
  }
  // small obstacles are survivable once, then fatal at high speed
  if (o.h > 1.25 || player.speed > 30) { kill(kind); return; }
  player.hurt();
  S.hurt = 1;
  S.shakeT = 0.34; S.shakeAmt = 0.5;
  S.combo = 0;
  bursts.spawn(new THREE.Vector3(player.x, 0.6, player.z + 0.4), 0xd8a06a, 10, 1.8, 0.7);
  // nudge the player past the obstacle so we don't re-collide
  player.z = o.zMax + 0.3;
}

function kill(cause) {
  if (!player.alive) return;
  player.die();
  S.mode = 'dead';
  S.shakeT = 0.7; S.shakeAmt = 1.4;
  S.hurt = 1;
  bursts.spawn(new THREE.Vector3(player.x, 1.0, player.z), 0xffb060, 22, 3.0, 0.9);
  const finalScore = Math.floor(S.score);
  if (finalScore > S.best) { S.best = finalScore; localStorage.setItem('dc_best', String(finalScore)); }
  el.goDist.textContent = Math.floor(S.distance);
  el.goCoins.textContent = S.coins;
  el.goScore.textContent = finalScore;
  setTimeout(() => { el.gameover.classList.remove('hidden'); }, 620);
}

function pickCoins() {
  const pz = player.z;
  const coins = level.nearbyCoins(pz - 2, 10);
  for (const c of coins) {
    const dz = c.z - pz;
    if (Math.abs(dz) > 0.95) continue;
    if (Math.abs(c.x - player.x) > 0.92) continue;
    const bodyY = player.y + (player.rolling ? 0.42 : 0.95);
    if (Math.abs(c.y - bodyY) > 1.25) continue;
    c.taken = true;
    c.mesh.visible = false;
    S.coins++;
    S.combo++;
    S.comboT = 1.4;
    S.score += 12 + Math.min(40, S.combo * 1.2);
    bursts.spawn(c.mesh.position, 0xffd75e, 4, 1.0, 0.34);
  }
}

/* ================================================================== *
 *  CAMERA
 * ================================================================== */
const camLook = new THREE.Vector3();
let camX = 0, camShakeX = 0, camShakeY = 0, camRoll = 0;

function updateCamera(dt) {
  const spdT = (player.speed - PLAYER.startSpeed) / (PLAYER.maxSpeed - PLAYER.startSpeed);

  // lateral lag toward the player's lane
  camX += (player.x * 0.86 - camX) * Math.min(1, dt / CAM.laneLag);

  const back = CAM.back + spdT * 1.35;
  const height = CAM.height + spdT * 0.34 + (player.rolling ? -0.30 : 0) + player.y * 0.30;

  // shake
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    const k = Math.max(0, S.shakeT) * S.shakeAmt;
    camShakeX = (Math.random() - 0.5) * k * 0.9;
    camShakeY = (Math.random() - 0.5) * k * 0.7;
  } else { camShakeX *= 0.85; camShakeY *= 0.85; }

  camera.position.set(
    camX + camShakeX,
    height + camShakeY,
    player.z - back
  );

  camLook.set(
    player.x * 0.42 + camX * 0.30,
    CAM.lookHeight + player.y * 0.42,
    player.z + CAM.lookAhead + spdT * 4.2
  );
  camera.lookAt(camLook);

  // dutch roll on lane switch
  const targetRoll = -(player.x - camX) * 0.028 - player.lean * 0.035;
  camRoll += (targetRoll - camRoll) * Math.min(1, dt * 7);
  camera.rotation.z += camRoll;

  // fov punch with speed
  const targetFov = CAM.fov + spdT * 7.5;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 2.2);
  camera.updateProjectionMatrix();
}

/* ================================================================== *
 *  ZONE / MOOD
 * ================================================================== */
function updateMood(dt) {
  const z = player.z;
  const tunnelFac = level.tunnelFactor(z);
  const zoneId = level.zoneAt(z);
  const stormTarget = zoneId === 'storm' ? 1 : 0;

  S.tunnelT += (tunnelFac - S.tunnelT) * Math.min(1, dt * 3.0);
  S.stormT += (stormTarget - S.stormT) * Math.min(1, dt * 0.85);

  // fog
  const zoneDef = ZONES.find((q) => q.id === zoneId) || ZONES[0];
  let fogFar = zoneDef.fogFar;
  fogFar = THREE.MathUtils.lerp(fogFar, 42, S.tunnelT);
  fogFar = THREE.MathUtils.lerp(fogFar, 110, S.stormT);
  scene.fog.far += (fogFar - scene.fog.far) * Math.min(1, dt * 1.1);
  scene.fog.near = THREE.MathUtils.lerp(FOG_NEAR, 4, Math.max(S.tunnelT, S.stormT * 0.6));

  const fogCol = new THREE.Color(PAL.fog);
  fogCol.lerp(new THREE.Color(0x2a1a12), S.tunnelT);
  fogCol.lerp(new THREE.Color(0xd18a56), S.stormT * 0.85);
  scene.fog.color.lerp(fogCol, Math.min(1, dt * 2.4));

  // lighting response
  sun.intensity = THREE.MathUtils.lerp(3.55, 0.24, S.tunnelT) * THREE.MathUtils.lerp(1, 0.52, S.stormT);
  hemi.intensity = THREE.MathUtils.lerp(0.52, 0.26, S.tunnelT) * THREE.MathUtils.lerp(1, 1.25, S.stormT);
  fill.intensity = THREE.MathUtils.lerp(0.42, 0.10, S.tunnelT);
  bounce.intensity = THREE.MathUtils.lerp(0.62, 0.34, S.tunnelT);
  hemi.color.lerp(new THREE.Color(S.tunnelT > 0.5 ? 0xff9d55 : 0xffd9a8), Math.min(1, dt * 2));

  // zone toast
  if (zoneId !== S.lastZone && S.mode === 'playing') {
    S.lastZone = zoneId;
    const def = ZONES.find((q) => q.id === zoneId);
    if (def) showToast(def.name);
  }
}

let toastTimer = null;
function showToast(text) {
  el.toast.textContent = text;
  el.toast.classList.remove('show');
  void el.toast.offsetWidth;
  el.toast.classList.add('show');
}

/* ================================================================== *
 *  LOOP
 * ================================================================== */
let last = performance.now();
let frames = 0, fpsAccum = 0, avgFps = 60;
let qualityLevel = 2;   // 2 = high, 1 = med, 0 = low

function tick(now) {
  requestAnimationFrame(tick);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.055) dt = 0.055;
  if (dt <= 0) return;

  // adaptive quality
  fpsAccum += dt; frames++;
  if (fpsAccum > 1.2) {
    avgFps = frames / fpsAccum;
    frames = 0; fpsAccum = 0;
    adaptQuality();
  }

  if (paused) { post.render(scene, camera, dt, moodState()); return; }

  S.time += dt;

  if (S.mode === 'playing') {
    player.update(dt, groundYFor(player.z));
    S.distance = player.z;
    S.score += dt * (10 + player.speed * 1.5);
    if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
    collide(dt);
    pickCoins();
  } else if (S.mode === 'menu') {
    // slow cinematic dolly
    player.z += dt * 5.2;
    player.runPhase += dt * 6;
    player.update(dt * 0.35, 0);
  } else {
    // dead: keep the world alive, slow down
    player.update(dt * 0.25, 0);
  }

  level.update(dt, player.z);
  canyon.update(player.z);
  ground.update(player.z);
  track.update(player.z);

  updateMood(dt);
  updateCamera(dt);

  // sun & shadow follow
  sunTarget.position.set(player.x * 0.4, 1.2, player.z + 16);
  sun.position.copy(SUN_DIR).multiplyScalar(64).add(sunTarget.position);

  // backdrop follows
  mesaFar.position.z = player.z;
  mesaFar.position.x = camera.position.x * 0.2;

  // atmosphere
  const windX = 0.55 + S.stormT * 9;
  dust.update(dt, camera.position, windX, 1 - S.tunnelT * 0.55 + S.stormT * 0.4);
  storm.update(dt, camera.position, S.stormT);
  rays.update(dt, camera, (1 - S.tunnelT) * (1 - S.stormT * 0.6) * 1.0);
  sparks.update(dt, camera.position, S.tunnelT);
  bursts.update(dt);
  sky.update(dt, camera, S.stormT, S.tunnelT);

  S.hurt = Math.max(0, S.hurt - dt * 2.6);

  // HUD
  el.score.textContent = Math.floor(S.score).toLocaleString();
  el.coins.textContent = S.coins;
  el.dist.textContent = Math.floor(S.distance);

  post.render(scene, camera, dt, moodState());
}

function moodState() {
  const spdT = (player.speed - PLAYER.startSpeed) / (PLAYER.maxSpeed - PLAYER.startSpeed);
  return {
    speedBlur: S.mode === 'playing' ? spdT * 1.15 : 0,
    storm: S.stormT,
    hurt: S.hurt,
    tunnel: S.tunnelT,
    shimmer: (1 - S.tunnelT) * (0.55 + S.stormT * 0.5),
  };
}

function groundYFor(z) {
  return 0;
}

function adaptQuality() {
  if (avgFps < 34 && qualityLevel > 0) {
    qualityLevel--;
    applyQuality();
  } else if (avgFps > 55 && qualityLevel < 2) {
    qualityLevel++;
    applyQuality();
  }
}

function applyQuality() {
  if (qualityLevel === 2) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    sun.shadow.mapSize.set(2048, 2048);
    post.enabled = true;
    post.bloomScale = 4;
  } else if (qualityLevel === 1) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    renderer.shadowMap.enabled = true;
    sun.shadow.mapSize.set(1024, 1024);
    post.enabled = true;
    post.bloomScale = 6;
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
    post.enabled = true;
    post.bloomScale = 8;
  }
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  post.setSize(window.innerWidth, window.innerHeight);
}

/* ================================================================== *
 *  START / RESET
 * ================================================================== */
function startGame() {
  S.mode = 'playing';
  S.score = 0; S.coins = 0; S.distance = 0;
  S.hurt = 0; S.combo = 0; S.comboT = 0;
  S.lastZone = '';
  player.reset();
  level.reset();
  el.overlay.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.banner.classList.add('gone');
  el.rail.classList.add('gone');
  showToast('CANYON MOUTH');
}

/* ================================================================== *
 *  RESIZE
 * ================================================================== */
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
}
window.addEventListener('resize', onResize);

/* ================================================================== *
 *  BOOT
 * ================================================================== */
mark('post');

// Staged boot: generate the initial chunks across a few frames so the main
// thread never blocks long enough to stall page load / first paint.
let booted = false;
function bootStep() {
  const target = 18;
  const budgetMs = 26;
  const t0 = performance.now();
  while (level.chunks.length < target && performance.now() - t0 < budgetMs) {
    level.generateChunk();
  }
  if (level.chunks.length < target) {
    requestAnimationFrame(bootStep);
    return;
  }
  const ts = texStats(), ms = matStats(), gs = geoStats();
  mark(`level-ready (${level.chunks.length} chunks, ${ts.unique} textures in ${ts.totalMs}ms, ${ms.materials} materials, ${gs.unique} geos, geo-hit ${gs.hitRate})`);
  booted = true;
  el.loader.classList.add('gone');
  setTimeout(() => el.loader.remove(), 700);
  requestAnimationFrame((t) => { last = t; tick(t); });
}
requestAnimationFrame(bootStep);

window.__bootMarks = marks;

// expose for the critic harness
window.__DC = { S, player, level, camera, scene, renderer, post, startGame, canyon, texStats, matStats, geoStats };
