// §14 / §16 — ambient life: pedestrians on the sidewalks and traffic on the
// streets, as a BUBBLE around the player (hard rule 6). Now with real behaviour:
// agents move on the city's grid, TURN at intersections, cars keep their distance
// (so they don't overlap), peds cross at corners, and everything spawns BEHIND
// the camera so you never see it pop in.
//
// Gameplay RNG (mulberry32), separate stream from worldgen (hard rule 2).
// Allocation-free in update(); the app reads each agent's rx/rz/yaw to render and
// collide (agents are solid against the player).

import { BLOCK, CORRIDOR, PED_H } from '../core/constants.js';

const PITCH = BLOCK + CORRIDOR;
const HALF = BLOCK / 2;
const BUBBLE = 112;
const SPAWN_MIN = 24;
const PED_SPEED = 1.3;
const LANEOFF = 2.2; // cars drive this far to the right of the street centre

// discrete headings: 0 +x, 1 +z, 2 -x, 3 -z
const DVX = [1, 0, -1, 0];
const DVZ = [0, 1, 0, -1];
const DYAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
// unit "right" vector per heading (for lane offset and rendering)
const RVX = [0, 1, 0, -1];
const RVZ = [-1, 0, 1, 0];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// nearest street centre / sidewalk line to coord c, given grid origin o
const streetLine = (c, o) => o + (Math.round((c - o) / PITCH - 0.5) + 0.5) * PITCH;
function sidewalkLine(c, o) {
  const n = Math.round((c - o) / PITCH);
  const base = o + n * PITCH;
  return c >= base ? base + HALF : base - HALF;
}
// next street centre strictly ahead of c in sign direction
function nextCenter(c, sign, o) {
  const base = o + 0.5 * PITCH;
  const m = Math.floor((c - base) / PITCH);
  let cand = base + (sign > 0 ? m + 1 : m) * PITCH;
  if (sign > 0 && cand <= c + 0.01) cand += PITCH;
  if (sign < 0 && cand >= c - 0.01) cand -= PITCH;
  return cand;
}

export class Ambient {
  constructor(pedCount = 60, carCount = 20, seed = 1) {
    this.rng = mulberry32(seed >>> 0);
    this.active = false;
    this.ox = 0; this.oz = 0; this.radius = 0;
    this.peds = [];
    this.cars = [];
    for (let i = 0; i < pedCount; i++) this.peds.push(this._blankPed());
    for (let i = 0; i < carCount; i++) this.cars.push(this._blankCar());
  }
  _blankPed() { return { x: 0, z: 0, dir: 0, node: 0, cross: 0, rx: 0, rz: 0, yaw: 0, bob: 0, live: false, r: 0.45, kx: 0, kz: 0 }; }
  _blankCar() { return { x: 0, z: 0, dir: 0, node: 0, speed: 0, cruise: 0, type: 0, color: 0, rx: 0, rz: 0, yaw: 0, vyaw: 0, live: false, r: 1.5, kx: 0, kz: 0 }; }

  // apply and decay a knockback impulse (set by collision.resolveAgents when the
  // player shoves this agent). Returns the stagger this frame so locomotion can
  // stand down while the agent is being flung.
  _knock(a, dt) {
    const k = Math.sqrt(a.kx * a.kx + a.kz * a.kz);
    if (k < 0.05) { a.kx = 0; a.kz = 0; return 0; }
    a.x += a.kx * dt;
    a.z += a.kz * dt;
    const decay = Math.max(0, 1 - 7 * dt); // ~7/s friction
    a.kx *= decay;
    a.kz *= decay;
    return k;
  }

  setCity(ox, oz, radius, active) { this.ox = ox; this.oz = oz; this.radius = radius; this.active = active; }
  inCity(x, z) { const dx = x - this.ox; const dz = z - this.oz; return dx * dx + dz * dz < this.radius * this.radius; }

  // spawn on the grid, in the rear arc behind the view so it can't be seen popping
  _spawn(px, pz, viewYaw, isCar) {
    const r = this.rng;
    for (let t = 0; t < 10; t++) {
      const ang = viewYaw + Math.PI + (r() - 0.5) * Math.PI * 1.15;
      const rad = SPAWN_MIN + (BUBBLE - SPAWN_MIN) * r();
      const x = px + Math.sin(ang) * rad;
      const z = pz + Math.cos(ang) * rad;
      if (!this.inCity(x, z)) continue;
      const horiz = r() < 0.5;
      const dir = horiz ? (r() < 0.5 ? 0 : 2) : (r() < 0.5 ? 1 : 3);
      const sign = dir === 0 || dir === 1 ? 1 : -1;
      if (isCar) {
        const gx = horiz ? x : streetLine(x, this.ox);
        const gz = horiz ? streetLine(z, this.oz) : z;
        const node = horiz ? nextCenter(gx, sign, this.ox) : nextCenter(gz, sign, this.oz);
        return { x: gx, z: gz, dir, node };
      }
      const gx = horiz ? x : sidewalkLine(x, this.ox);
      const gz = horiz ? sidewalkLine(z, this.oz) : z;
      const travel = horiz ? gx : gz;
      return { x: gx, z: gz, dir, node: travel + sign * (14 + r() * 22) };
    }
    return null;
  }

  _renderCar(c) {
    c.rx = c.x + RVX[c.dir] * LANEOFF;
    c.rz = c.z + RVZ[c.dir] * LANEOFF;
    c.yaw = c.vyaw; // eased toward the heading (see update) → turns arc, not snap
  }
  _renderPed(p) { p.rx = p.x; p.rz = p.z; p.yaw = DYAW[p.dir]; }

  update(px, pz, viewYaw, dt) {
    const r = this.rng;
    // ── traffic ────────────────────────────────────────────────────────────
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const far = (c.x - px) ** 2 + (c.z - pz) ** 2 > BUBBLE * BUBBLE;
      if (!c.live || far || !this.active) {
        if (!this.active) { c.live = false; continue; }
        const s = this._spawn(px, pz, viewYaw, true);
        if (!s) { c.live = false; continue; }
        c.x = s.x; c.z = s.z; c.dir = s.dir; c.node = s.node; c.live = true;
        c.cruise = 7 + r() * 7; c.speed = c.cruise; c.vyaw = DYAW[s.dir];
        c.type = (r() * 4) | 0; c.color = (r() * 10) | 0; c.kx = 0; c.kz = 0;
        this._renderCar(c);
        continue;
      }
      // being shoved? slide with the impulse and ease off the gas while reeling
      const cstagger = this._knock(c, dt);
      // ease the visual heading toward the grid heading (arced turns)
      let dy = DYAW[c.dir] - c.vyaw;
      if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
      c.vyaw += dy * Math.min(1, 9 * dt);
      // car-following + a light yield: slow for a car close ahead in the same lane,
      // and for any car very close (cross-traffic at an intersection → no T-bones)
      c.speed = c.cruise;
      for (let j = 0; j < this.cars.length; j++) {
        if (j === i) continue;
        const o = this.cars[j];
        if (!o.live) continue;
        const ax = o.x - c.x; const az = o.z - c.z;
        const d2 = ax * ax + az * az;
        const ahead = ax * DVX[c.dir] + az * DVZ[c.dir];
        if (o.dir === c.dir) {
          const side = ax * RVX[c.dir] + az * RVZ[c.dir];
          if (ahead > 0.5 && ahead < 9 && Math.abs(side) < 2.4) {
            const target = Math.max(2.4, (c.cruise * (ahead - 4)) / 5);
            if (target < c.speed) c.speed = target;
          }
        } else if (ahead > -1 && d2 < 7 * 7 && j < i) {
          // a crossing car is near and has priority (lower index) → yield
          c.speed = Math.min(c.speed, 1.5);
        }
      }
      if (cstagger > 2) c.speed = Math.min(c.speed, 1.5); // reeling from a hit
      const horiz = c.dir === 0 || c.dir === 2;
      c.x += DVX[c.dir] * c.speed * dt;
      c.z += DVZ[c.dir] * c.speed * dt;
      const sign = c.dir === 0 || c.dir === 1 ? 1 : -1;
      const passed = horiz ? (sign > 0 ? c.x >= c.node : c.x <= c.node) : (sign > 0 ? c.z >= c.node : c.z <= c.node);
      if (passed) {
        if (horiz) c.x = c.node; else c.z = c.node;
        // decide at the intersection: mostly straight, sometimes turn
        const q = r();
        if (q < 0.62) { /* straight */ } else if (q < 0.81) c.dir = (c.dir + 1) % 4; else c.dir = (c.dir + 3) % 4;
        const h2 = c.dir === 0 || c.dir === 2;
        const cur = h2 ? c.x : c.z;
        const s2 = c.dir === 0 || c.dir === 1 ? 1 : -1;
        c.node = cur + s2 * PITCH;
      }
      this._renderCar(c);
    }
    // ── pedestrians ──────────────────────────────────────────────────────────
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const far = (p.x - px) ** 2 + (p.z - pz) ** 2 > BUBBLE * BUBBLE;
      if (!p.live || far || !this.active) {
        if (!this.active) { p.live = false; continue; }
        const s = this._spawn(px, pz, viewYaw, false);
        if (!s) { p.live = false; continue; }
        p.x = s.x; p.z = s.z; p.dir = s.dir; p.node = s.node; p.cross = 0; p.live = true; p.bob = r() * 6.28; p.kx = 0; p.kz = 0;
        this._renderPed(p);
        continue;
      }
      // knocked back? slide with the impulse and stop walking until it fades
      const pstagger = this._knock(p, dt);
      const walk = pstagger > 1.5 ? 0 : PED_SPEED;
      p.x += DVX[p.dir] * walk * dt;
      p.z += DVZ[p.dir] * walk * dt;
      p.bob += dt * 7;
      const horiz = p.dir === 0 || p.dir === 2;
      const sign = p.dir === 0 || p.dir === 1 ? 1 : -1;
      const travel = horiz ? p.x : p.z;
      const passed = sign > 0 ? travel >= p.node : travel <= p.node;
      if (passed) {
        if (p.cross) {
          // finished crossing the street — land on the far sidewalk, resume parallel
          if (horiz) p.z = sidewalkLine(p.z, this.oz); else p.x = sidewalkLine(p.x, this.ox);
          p.cross = 0;
          p.dir = r() < 0.5 ? (p.dir + 1) % 4 : (p.dir + 3) % 4;
          const t2 = p.dir === 0 || p.dir === 2 ? p.x : p.z;
          p.node = t2 + (p.dir === 0 || p.dir === 1 ? 1 : -1) * (16 + r() * 22);
        } else {
          const q = r();
          if (q < 0.55) {
            p.node = travel + sign * (16 + r() * 22); // keep going
          } else if (q < 0.82) {
            // turn a corner onto the perpendicular sidewalk
            p.dir = r() < 0.5 ? (p.dir + 1) % 4 : (p.dir + 3) % 4;
            if (p.dir === 0 || p.dir === 2) p.z = sidewalkLine(p.z, this.oz); else p.x = sidewalkLine(p.x, this.ox);
            const t2 = p.dir === 0 || p.dir === 2 ? p.x : p.z;
            p.node = t2 + (p.dir === 0 || p.dir === 1 ? 1 : -1) * (16 + r() * 22);
          } else {
            // cross the street: turn perpendicular and walk one corridor across
            p.dir = r() < 0.5 ? (p.dir + 1) % 4 : (p.dir + 3) % 4;
            p.cross = 1;
            const t2 = p.dir === 0 || p.dir === 2 ? p.x : p.z;
            p.node = t2 + (p.dir === 0 || p.dir === 1 ? 1 : -1) * (CORRIDOR + BLOCK * 0.5);
          }
        }
      }
      this._renderPed(p);
    }
  }
}

export const PED_HEIGHT = PED_H;
