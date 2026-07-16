// §6 — Continuous fields: landmass/climate and the culture noise of §9.
//
// "Landmass, climate — continuous field — domain-warped fBm + radial falloff —
//  free, stateless." Every value here is a pure function of (seed, position)
// through the hash chain (§5). No Math.random, no lattice storage.

import { hash, unit } from '../core/hash.js';
import { HALF_WORLD_M, REGION_COUNT } from '../core/constants.js';

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Value noise on an integer lattice: hash the four corners, smoothstep-bilerp.
// Returns [0, 1).
function vnoise(seed, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const n00 = unit(hash(seed, xi, yi));
  const n10 = unit(hash(seed, xi + 1, yi));
  const n01 = unit(hash(seed, xi, yi + 1));
  const n11 = unit(hash(seed, xi + 1, yi + 1));
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

// Fractal Brownian motion — octaves of value noise at halving amplitude. [0, 1).
export function fbm(seed, x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise((seed + i * 0x9e3779b1) >>> 0, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Domain-warped fBm: perturb the sample coordinates by another fBm before
// sampling. This is what turns bland blobs into coastline-like structure (§6).
export function warpedFbm(seed, x, y) {
  const wx = x + 0.8 * (fbm((seed ^ 0x9e37) >>> 0, x, y, 3) - 0.5);
  const wy = y + 0.8 * (fbm((seed ^ 0x85eb) >>> 0, x, y, 3) - 0.5);
  return fbm(seed, wx, wy, 4);
}

// Habitability at a world point (metres). High where people would settle, low
// (even negative) at the edges of the 128 km square, so the coast/border reads
// as wilderness rather than a hard-cut grid of towns.
//
//   feature size ~20 km  ·  radial falloff begins at 55% out, full at the edge
export function habitability(seed, worldX, worldZ) {
  const nx = worldX / 20000 + 100; // +100 keeps us off the noise origin
  const nz = worldZ / 20000 + 100;
  let h = warpedFbm((seed ^ 0xabcd1234) >>> 0, nx, nz);

  const rx = Math.abs(worldX) / HALF_WORLD_M; // 0 centre .. 1 edge
  const rz = Math.abs(worldZ) / HALF_WORLD_M;
  const r = Math.max(rx, rz);
  const falloff = smooth(Math.max(0, (r - 0.55) / 0.45));
  return h - falloff;
}

// §9 — Regional naming culture from LOW-FREQUENCY noise, so cultures form
// contiguous blobs, not salt-and-pepper. `rx, rz` are region indices (0..15).
// The building-palette variant binds to this same field (§9) — one culture, one
// look. Returns an integer index into whatever culture table the caller holds.
export function cultureIndex(seed, rx, rz, cultureCount) {
  // 0.32 region-units per step ⇒ feature ~3 regions ≈ 24 km. Contiguous.
  const n = fbm((seed ^ 0xc0ffee) >>> 0, rx * 0.32 + 10, rz * 0.32 + 10, 3);
  return Math.min(cultureCount - 1, Math.floor(n * cultureCount));
}

// Guard: culture noise must be sampled on the real region grid.
export const CULTURE_GRID = REGION_COUNT;
