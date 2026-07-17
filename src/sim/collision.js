// §12 — Collision, pure and allocation-free in the step.
//
// The car is a circle; buildings are the axis-aligned footprints the city
// generator emits. A uniform grid buckets colliders once at load so the step
// only tests the car's cell and its neighbours — a 9,000-building metro costs
// the same as a village. Integer cell keys, so resolve() allocates nothing
// (hard rule 3).
//
// Runs in city space: for a single city (±~2 km) that is well within float
// precision, so the floating-origin rebase (§8) is a render-only concern here
// and switches on at world scale in a later phase.

import { BLOCK, CORRIDOR } from '../core/constants.js';

const CELL = BLOCK + CORRIDOR; // 72.5 m — one block + its streets
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Pack two smallish signed cell indices into one integer key (no strings).
const key = (i, j) => ((i + 4096) << 13) | (j + 4096);

// Build the broadphase grid from the generator's colliders. One-time.
export function buildColliderGrid(colliders) {
  const grid = new Map();
  for (let n = 0; n < colliders.length; n++) {
    const c = colliders[n];
    const i0 = Math.floor((c.x - c.hw) / CELL);
    const i1 = Math.floor((c.x + c.hw) / CELL);
    const j0 = Math.floor((c.z - c.hd) / CELL);
    const j1 = Math.floor((c.z + c.hd) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(c);
      }
    }
  }
  return { grid, cell: CELL };
}

// Bucket a single collider into the grid (used when a driven car is parked again
// at a new spot). Leaves any stale references in old cells harmless — they read
// the collider's current coords, so they just stop matching there.
export function addCollider(cg, c) {
  const { grid, cell } = cg;
  const i0 = Math.floor((c.x - c.hw) / cell);
  const i1 = Math.floor((c.x + c.hw) / cell);
  const j0 = Math.floor((c.z - c.hd) / cell);
  const j1 = Math.floor((c.z + c.hd) / cell);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(c);
    }
  }
}

// Resolve a body circle against nearby building/parked-car AABBs. Pushes the body
// out of penetration and cancels the velocity component into the wall (a scrape,
// not a bounce — arcade). Mutates body.{x,z,vx,vz}; returns the contact count.
//
// `off` samples the circle at a point `off` metres ALONG the body's heading, so
// an elongated car can be covered by two smaller circles (front + rear) instead
// of one oversized one — which is why you were stopping "in mid-air". The
// correction still moves the body centre. Allocation-free.
export function resolveCollision(body, cg, radius = 1.0, off = 0) {
  const { grid, cell } = cg;
  let px = body.x;
  let pz = body.z;
  if (off) {
    px += Math.sin(body.yaw) * off;
    pz += Math.cos(body.yaw) * off;
  }
  const ci = Math.floor(px / cell);
  const cj = Math.floor(pz / cell);
  const r2 = radius * radius;
  let contacts = 0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const arr = grid.get(key(i, j));
      if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const b = arr[n];
        if (b.taken) continue; // a parked car you've driven off in no longer blocks
        const nx = clamp(px, b.x - b.hw, b.x + b.hw);
        const nz = clamp(pz, b.z - b.hd, b.z + b.hd);
        const dx = px - nx;
        const dz = pz - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;

        contacts++;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const inv = 1 / d;
          const push = radius - d;
          const nX = dx * inv;
          const nZ = dz * inv;
          body.x += nX * push;
          body.z += nZ * push;
          px += nX * push;
          pz += nZ * push;
          const vn = body.vx * nX + body.vz * nZ;
          if (vn < 0) {
            body.vx -= vn * nX;
            body.vz -= vn * nZ;
          }
        } else {
          // dead centre on an edge — shove out along the smaller overlap axis
          const ox = b.hw + radius - Math.abs(px - b.x);
          const oz = b.hd + radius - Math.abs(pz - b.z);
          if (ox < oz) {
            const s = px < b.x ? -ox : ox;
            body.x += s;
            px += s;
            body.vx = 0;
          } else {
            const s = pz < b.z ? -oz : oz;
            body.z += s;
            pz += s;
            body.vz = 0;
          }
        }
      }
    }
  }
  return contacts;
}

// Resolve a body against ambient agents (peds / traffic). With `power > 0` the
// agents are PUSHABLE: the body shoves them out of the way and imparts its own
// momentum as a knockback (agents carry kx/kz, which ambient decays), so a car
// bowls people over and keeps going instead of dead-stopping on them. With
// `power === 0` they're immovable and the body is pushed out instead (a parked
// wall of a bus, or a person who can't budge a moving car). Allocation-free.
//
// `n` points from the body toward the agent.
export function resolveAgents(body, agents, bodyRadius, power = 0) {
  const bvx = body.vx || 0;
  const bvz = body.vz || 0;
  const bspeed = Math.sqrt(bvx * bvx + bvz * bvz);
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.live) continue;
    const dx = a.rx - body.x;
    const dz = a.rz - body.z;
    const rr = bodyRadius + a.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const inv = 1 / d;
    const nX = dx * inv;
    const nZ = dz * inv;
    const pen = rr - d;
    const closing = bvx * nX + bvz * nZ; // body speed INTO the agent (>0 = charging it)

    if (power > 0 && a.kx !== undefined) {
      // shove the agent clear of the body this frame …
      a.x += nX * pen;
      a.z += nZ * pen;
      // … and fling it: mostly the body's closing speed, a bump so a standing
      // agent still reacts, all scaled by this body's shoving power.
      const kick = (Math.max(0, closing) * 0.9 + bspeed * 0.2 + 1.2) * power;
      a.kx += nX * kick;
      a.kz += nZ * kick;
      // the body feels the contact but keeps most of its speed (momentum, not a wall)
      if (closing > 0) {
        const react = Math.min(closing, 3.5) * 0.18;
        body.vx -= nX * react;
        body.vz -= nZ * react;
      }
    } else {
      // immovable: push the body out and cancel its velocity into the agent
      body.x -= nX * pen;
      body.z -= nZ * pen;
      if (closing > 0) { body.vx -= closing * nX; body.vz -= closing * nZ; }
    }
  }
}

// Is world point (x,z) inside a BUILDING (not a parked car) within `margin`?
// Used to pull the chase camera in so it doesn't clip through walls.
export function pointBlocked(cg, x, z, margin = 0) {
  const { grid, cell } = cg;
  const ci = Math.floor(x / cell);
  const cj = Math.floor(z / cell);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const arr = grid.get(key(i, j));
      if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const b = arr[n];
        if (b.id !== undefined) continue; // buildings only (parked cars have an id)
        if (x > b.x - b.hw - margin && x < b.x + b.hw + margin && z > b.z - b.hd - margin && z < b.z + b.hd + margin) return true;
      }
    }
  }
  return false;
}

// Find the nearest enterable parked car to (x,z) within `radius`, using the same
// grid. Colliders that carry an `id` (>= 0) are parked cars; buildings don't.
// Returns the collider (with .id) or null. Allocation-free.
export function nearestParked(cg, x, z, radius) {
  const { grid, cell } = cg;
  const ci = Math.floor(x / cell);
  const cj = Math.floor(z / cell);
  const r2 = radius * radius;
  let best = null;
  let bestD = r2;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const arr = grid.get(key(i, j));
      if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const c = arr[n];
        if (c.id === undefined || c.taken) continue;
        const dx = c.x - x;
        const dz = c.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = c;
        }
      }
    }
  }
  return best;
}

// Nearest building door within `radius` (door records carry door:true). Used for
// the "enter building" prompt.
export function nearestDoor(cg, x, z, radius) {
  const { grid, cell } = cg;
  const ci = Math.floor(x / cell);
  const cj = Math.floor(z / cell);
  let best = null;
  let bestD = radius * radius;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const arr = grid.get(key(i, j));
      if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const c = arr[n];
        if (!c.door) continue;
        const dx = c.x - x;
        const dz = c.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) { bestD = d2; best = c; }
      }
    }
  }
  return best;
}
