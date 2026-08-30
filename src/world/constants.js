/** Global tuning constants for the Desert Canyon world. */

export const LANE_W = 2.55;          // lane spacing (metres)
export const LANES = [-LANE_W, 0, LANE_W];
export const TRACK_HALF = LANE_W * 1.5;

export const CHUNK_LEN = 30;          // metres per world chunk
export const CHUNKS_AHEAD = 16;       // chunks kept in front of player
export const CHUNKS_BEHIND = 3;

export const VIEW_FAR = 900;
export const FOG_NEAR = 95;
export const FOG_FAR = 430;

export const PLAYER = {
  radius: 0.42,
  height: 1.62,
  laneSwitchTime: 0.155,
  jumpVel: 9.35,
  gravity: -26.0,
  rollTime: 0.62,
  startSpeed: 15.0,
  maxSpeed: 40.0,
  accel: 0.155,          // m/s per second
  hurtSpeedLoss: 0.25,
};

export const CAM = {
  fov: 62,
  height: 3.22,
  back: 6.55,
  lookAhead: 13.5,
  lookHeight: 1.62,
  laneLag: 0.16,
};

export const RAIL = {
  gauge: 1.16,
  railW: 0.085,
  railH: 0.13,
  headY: 0.185,
  sleeperW: 1.86,
  sleeperT: 0.115,
  sleeperD: 0.30,
  sleeperGap: 0.72,
  ballastH: 0.075,
};

/** Named biome/zone sections cycled along the run. */
export const ZONES = [
  { id: 'open',     name: 'CANYON MOUTH',     len: 8,  fogFar: 470, tunnel: false },
  { id: 'narrow',   name: 'NARROW GORGE',     len: 6,  fogFar: 380, tunnel: false },
  { id: 'tunnel',   name: 'MINE TUNNELS',     len: 5,  fogFar: 150, tunnel: true  },
  { id: 'bridge',   name: 'TRESTLE BRIDGE',   len: 5,  fogFar: 520, tunnel: false },
  { id: 'storm',    name: 'SAND STORM',       len: 6,  fogFar: 210, tunnel: false },
  { id: 'mesa',     name: 'MESA FLATS',       len: 7,  fogFar: 560, tunnel: false },
];

export const COIN = { r: 0.34, thick: 0.075, y: 1.02, spin: 2.6 };
