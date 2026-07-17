// §14 / §16 — ambient life: pedestrians walking the sidewalks and traffic on the
// streets, as a BUBBLE around the player. Nothing exists beyond the fog (hard
// rule 6): a fixed pool of agents is recycled to the fog edge as the player
// moves, so a whole living city costs a constant handful of agents.
//
// Anchored to a city's regular block grid (origin + PITCH). Agents move on grid
// lines: peds on sidewalk lines at block edges, cars on street centre lines with
// a lane offset. No pathfinding yet — straight runs, recycled at the edge — which
// through 100 m of fog reads as a populated city. Turning/among-agent avoidance
// is the obvious next polish.
//
// Uses a GAMEPLAY rng (mulberry32), a separate stream from worldgen (hard rule
// 2): these agents are transient and never persisted, so they need no worldgen
// determinism. Allocation-free in update() (hard rule 3).

import { BLOCK, CORRIDOR, LANE } from '../core/constants.js';
import { CAR_TYPES, CAR_COLORS } from '../render/car.js';

const PITCH = BLOCK + CORRIDOR;
const HALF = BLOCK / 2;
const BUBBLE = 108; // just beyond the 100 m fog
const SPAWN_MIN = 20; // recycle into the visible near-field, not the fog band
const PED_SPEED = 1.25;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// nearest sidewalk line (a block edge) to coordinate c, given grid origin o
function sidewalkLine(c, o) {
  const n = Math.round((c - o) / PITCH);
  const base = o + n * PITCH;
  return c >= base ? base + HALF : base - HALF;
}
// nearest street centre line to c
function streetLine(c, o) {
  return o + (Math.round((c - o) / PITCH - 0.5) + 0.5) * PITCH;
}

export class Ambient {
  constructor(pedCount = 60, carCount = 20, seed = 1) {
    this.rng = mulberry32(seed >>> 0);
    this.active = false;
    this.ox = 0; this.oz = 0; this.radius = 0; // city anchor
    this.peds = [];
    this.cars = [];
    for (let i = 0; i < pedCount; i++) this.peds.push({ x: 0, z: 0, yaw: 0, ax: 0, dir: 1, bob: 0, live: false });
    for (let i = 0; i < carCount; i++) this.cars.push({ x: 0, z: 0, yaw: 0, ax: 0, dir: 1, speed: 0, type: 0, color: 0, live: false });
  }

  // Anchor to a loaded city (world position + radius). Pass active=false when the
  // player is out in open country so the streets go empty (§1).
  setCity(ox, oz, radius, active) {
    this.ox = ox; this.oz = oz; this.radius = radius; this.active = active;
  }

  inCity(x, z) {
    const dx = x - this.ox; const dz = z - this.oz;
    return dx * dx + dz * dz < this.radius * this.radius;
  }

  // pick a point on the far side of the bubble from the player, on a grid line
  _spawn(px, pz, isCar) {
    const r = this.rng;
    for (let t = 0; t < 8; t++) {
      const ang = r() * Math.PI * 2;
      const rad = SPAWN_MIN + (BUBBLE - SPAWN_MIN) * r();
      const x = px + Math.cos(ang) * rad;
      const z = pz + Math.sin(ang) * rad;
      if (!this.inCity(x, z)) continue;
      const ax = r() < 0.5 ? 0 : 1; // 0 = travel along x, 1 = along z
      const dir = r() < 0.5 ? 1 : -1;
      if (ax === 0) {
        const line = isCar ? streetLine(z, this.oz) + dir * (LANE * 0.5) : sidewalkLine(z, this.oz);
        return { x, z: line, ax, dir, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
      }
      const line = isCar ? streetLine(x, this.ox) + dir * (LANE * 0.5) : sidewalkLine(x, this.ox);
      return { x: line, z, ax, dir, yaw: dir > 0 ? 0 : Math.PI };
    }
    return null;
  }

  update(px, pz, dt) {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const dx = p.x - px; const dz = p.z - pz;
      const far = dx * dx + dz * dz > BUBBLE * BUBBLE;
      if (!p.live || far || !this.active) {
        if (!this.active) { p.live = false; continue; }
        const s = this._spawn(px, pz, false);
        if (!s) { p.live = false; continue; }
        p.x = s.x; p.z = s.z; p.ax = s.ax; p.dir = s.dir; p.yaw = s.yaw; p.live = true; p.bob = this.rng() * 6.28;
        continue;
      }
      if (p.ax === 0) p.x += p.dir * PED_SPEED * dt;
      else p.z += p.dir * PED_SPEED * dt;
      p.bob += dt * 8;
    }
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const dx = c.x - px; const dz = c.z - pz;
      const far = dx * dx + dz * dz > BUBBLE * BUBBLE;
      if (!c.live || far || !this.active) {
        if (!this.active) { c.live = false; continue; }
        const s = this._spawn(px, pz, true);
        if (!s) { c.live = false; continue; }
        c.x = s.x; c.z = s.z; c.ax = s.ax; c.dir = s.dir; c.yaw = s.yaw; c.live = true;
        c.speed = 7 + this.rng() * 7;
        c.type = (this.rng() * CAR_TYPES.length) | 0;
        c.color = (this.rng() * CAR_COLORS.length) | 0;
        continue;
      }
      if (c.ax === 0) c.x += c.dir * c.speed * dt;
      else c.z += c.dir * c.speed * dt;
    }
  }
}
