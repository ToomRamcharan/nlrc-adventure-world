# NLRC Street Runner — World 3: Desert Canyon

A playable 3D endless-runner world built to match the supplied **Desert Canyon**
reference art: golden-hour canyon walls, three-lane narrow-gauge track, trains,
timber obstacles, mine tunnels, a trestle bridge and sand storms.

Everything is generated procedurally at runtime — no external art assets, no
model downloads. Textures, meshes, sky, weather and level layout are all code.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # static bundle in dist/
npm run preview
```

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Switch lane | `A` / `D` or `←` / `→` | swipe left / right |
| Jump | `W` / `Space` / `↑` | swipe up or tap |
| Roll | `S` / `↓` | swipe down |
| Pause | `P` | pause button |

## Architecture

```
src/
  main.js                game loop, camera, collision, state machine
  world/
    palette.js           colour palette extracted from the reference art
    constants.js         lane/rail/camera/player tuning
    canyon.js            canyon wall ribbon loft + hoodoos, arches, mesas
    track.js             rails, sleepers, ballast, sand ground
    levelgen.js          chunked level generator, zones, tunnels, bridges
  entities/
    player.js            runner rig + procedural run/jump/roll animation
    train.js             subway / freight / diesel / flatbed cars + consists
    props.js             cacti, signs, lamp posts, obstacles, set pieces
  render/
    sky.js               full-dome golden-hour sky shader
    noisetex.js          fast lattice-noise -> canvas pipeline
    textures.js          every procedural texture in the game
    post.js              bloom + ACES + grade + shimmer + speed blur
  systems/
    atmosphere.js        dust motes, sand storm, god rays, embers, bursts
  ui/hud.css             HUD, banner, feature rail, overlays
tools/
  shoot.py               headless capture of 11 scripted game states
  probe.py               boot-time / fps / draw-call probe
progress/
  index.html             live build-progress page
  state.json             progress data (drives the page)
```

### Zones

The run cycles through named sections, each with its own fog, lighting,
obstacle mix and atmosphere:

**Canyon Mouth** → **Narrow Gorge** → **Mine Tunnels** → **Trestle Bridge** →
**Sand Storm** → **Mesa Flats**

## Performance notes

Procedural texture generation is the main boot cost. Two rules keep it fast:

1. **No per-output-pixel JS noise.** Noise is evaluated on a small lattice
   (64–256 px) and upscaled by the native canvas bilinear filter
   (`render/noisetex.js`). This took canyon texture generation from 72s to
   under 1s.
2. **Seeds are quantised into a small number of variants.** Callers pass random
   per-prop seeds for visual variety; the texture layer folds them into 3–4
   buckets so the texture/material count stays bounded. Per-instance variety
   then comes from mesh colour and geometry jitter instead.

Adaptive quality drops pixel ratio, shadow resolution and bloom scale
automatically if the frame rate falls below target.

## Progress page

`progress/index.html` shows the state of every work stream, the critic's
current "biggest remaining gap", round history and the latest rendered
captures. It reads `progress/state.json` and refreshes every 10s.
