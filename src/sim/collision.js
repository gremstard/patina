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

// Resolve the car circle against nearby building AABBs. Pushes the car out of
// penetration and cancels the velocity component into the wall (a scrape, not a
// bounce — arcade). Mutates car.{x,z,vx,vz}; returns the number of contacts (for
// crunch/audio feedback later). Allocation-free.
export function resolveCollision(car, cg, radius = 2.0) {
  const { grid, cell } = cg;
  const ci = Math.floor(car.x / cell);
  const cj = Math.floor(car.z / cell);
  let contacts = 0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const arr = grid.get(key(i, j));
      if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const b = arr[n];
        const nx = clamp(car.x, b.x - b.hw, b.x + b.hw);
        const nz = clamp(car.z, b.z - b.hd, b.z + b.hd);
        const dx = car.x - nx;
        const dz = car.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;

        contacts++;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const inv = 1 / d;
          const push = radius - d;
          const nX = dx * inv;
          const nZ = dz * inv;
          car.x += nX * push;
          car.z += nZ * push;
          const vn = car.vx * nX + car.vz * nZ;
          if (vn < 0) {
            car.vx -= vn * nX;
            car.vz -= vn * nZ;
          }
        } else {
          // dead centre on an edge — shove out along the smaller overlap axis
          const ox = b.hw + radius - Math.abs(car.x - b.x);
          const oz = b.hd + radius - Math.abs(car.z - b.z);
          if (ox < oz) {
            car.x += car.x < b.x ? -ox : ox;
            car.vx = 0;
          } else {
            car.z += car.z < b.z ? -oz : oz;
            car.vz = 0;
          }
        }
      }
    }
  }
  return contacts;
}
