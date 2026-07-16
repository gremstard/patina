// §4 / §6 — The build-time world index.
//
// Because the world is bounded, the region grid is a TABLE, not a search problem.
// Run this generator once, offline; ship the result as a ~40–100 KB blob. It is
// the ONE place absolute world coordinates are allowed (§8) — it is data, not
// simulation.
//
// §6 generation altitude: settlement anchors are placed at region altitude by a
// "jittered grid, habitability-weighted" method. Everything BELOW city level
// stays runtime-hashed and stateless — it is not in here.
//
// Determinism (§5): pure function of worldSeed. No Math.random, no Set iteration
// for decisions (a Set is used only for O(1) name-collision membership, never
// iterated to drive a choice), no floating-point order dependence beyond a
// total-ordered sort with a hash tie-break.

import { hash, unit } from '../core/hash.js';
import {
  HALF_WORLD_M,
  WORLD_M,
  REGION_M,
  REGION_COUNT,
  TIER,
  TIER_ORDER,
  TIER_TARGET,
  TIER_SPACING_M,
} from '../core/constants.js';
import { habitability, cultureIndex } from './field.js';
import { CULTURES, makeName } from './names.js';

// A fine candidate lattice: 64 × 64 cells over 128 km ⇒ 2 km cells. The lattice
// is intentionally denser than any tier's spacing so the greedy min-spacing
// selection always has enough choices — hamlets (§4 target ~1000, ~4 km spacing)
// need the surplus, since habitability falloff removes edge candidates. Every
// candidate is a jittered point + habitability.
const CAND_PER_AXIS = 64;
const CAND_CELL = WORLD_M / CAND_PER_AXIS; // 4000 m

// Deterministic per-tier count with a little jitter, clamped to the §4 spec band
// so the determinism test's count assertions can never drift. Metros land 4..6
// (inside the pinned [3,7]); others stay near target.
function tierCount(worldSeed, tier) {
  const base = TIER_TARGET[tier];
  const spread = tier === TIER.metro ? 1 : Math.max(1, Math.round(base * 0.12));
  const j = (hash(worldSeed, tier, 'count') % (2 * spread + 1)) - spread;
  return Math.max(1, base + j);
}

function candidates(worldSeed) {
  const out = [];
  for (let cz = 0; cz < CAND_PER_AXIS; cz++) {
    for (let cx = 0; cx < CAND_PER_AXIS; cx++) {
      const jx = unit(hash(worldSeed, cx, cz, 'jx'));
      const jz = unit(hash(worldSeed, cx, cz, 'jz'));
      const x = -HALF_WORLD_M + (cx + jx) * CAND_CELL;
      const z = -HALF_WORLD_M + (cz + jz) * CAND_CELL;
      out.push({
        x,
        z,
        hab: habitability(worldSeed, x, z),
        // Stable id: total-order tie-break for the sort, and the settlement's
        // identity hash (used for save deltas §13 and naming).
        id: hash(worldSeed, Math.round(x), Math.round(z)),
        tier: null,
      });
    }
  }
  // Most habitable first; hash id breaks ties so the order is total and stable.
  out.sort((a, b) => b.hab - a.hab || a.id - b.id);
  return out;
}

// Greedy min-spacing (Poisson-disk-ish) selection. Walk candidates best-first;
// accept one for `tier` only if it clears TIER_SPACING_M[tier] from every
// already-placed settlement (higher tiers were placed first with larger radii,
// so this also keeps a city off a metro). O(n·m), fine at build time.
function place(cands, placed, tier, count) {
  const minD = TIER_SPACING_M[tier];
  const minD2 = minD * minD;
  let got = 0;
  for (let i = 0; i < cands.length && got < count; i++) {
    const c = cands[i];
    if (c.tier) continue;
    let ok = true;
    for (let j = 0; j < placed.length; j++) {
      const p = placed[j];
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      if (dx * dx + dz * dz < minD2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    c.tier = tier;
    placed.push(c);
    got++;
  }
}

function regionOf(worldX, worldZ) {
  const rx = Math.min(REGION_COUNT - 1, Math.max(0, Math.floor((worldX + HALF_WORLD_M) / REGION_M)));
  const rz = Math.min(REGION_COUNT - 1, Math.max(0, Math.floor((worldZ + HALF_WORLD_M) / REGION_M)));
  return { rx, rz };
}

// Build the full index for a world seed. Returns a plain, JSON-able object.
export function generateWorldIndex(worldSeed) {
  worldSeed = worldSeed >>> 0;
  const cands = candidates(worldSeed);

  const placed = [];
  // Place tiers most-important → least so dense metros never land on towns.
  for (const tier of TIER_ORDER) {
    const count = tier === TIER.HAMLET
      ? cands.length // hamlets are "everything else that still spaces"
      : tierCount(worldSeed, tier);
    place(cands, placed, tier, count);
  }

  // Cap hamlets near the §4 target (~1000) for a bounded blob size. `placed` is
  // already in deterministic acceptance order (metros, then cities, ...); the
  // cap trims the tail of least-habitable hamlets deterministically.
  const nonHamlet = placed.filter((p) => p.tier !== TIER.HAMLET);
  const hamlets = placed.filter((p) => p.tier === TIER.HAMLET).slice(0, TIER_TARGET.hamlet);
  const kept = nonHamlet.concat(hamlets);

  // Assign culture (region noise) + globally-deduped names. Process in a fixed
  // order so dedup is deterministic. Labelled tiers get names; hamlets don't (§4).
  kept.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.id - b.id);
  const usedNames = new Set(); // membership only — never iterated for a decision
  const settlements = [];
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const { rx, rz } = regionOf(s.x, s.z);
    const ci = cultureIndex(worldSeed, rx, rz, CULTURES.length);
    const culture = CULTURES[ci];
    const regionSeed = hash(worldSeed, rx, rz);

    let name = null;
    if (s.tier !== TIER.HAMLET) {
      // Re-roll with an incrementing salt on collision — deterministic because
      // the iteration order above is deterministic.
      let salt = 0;
      do {
        name = makeName(culture, hash(s.id, 'name', salt), regionSeed);
        salt++;
      } while (usedNames.has(name) && salt < 64);
      usedNames.add(name);
    }

    settlements.push({
      id: s.id,
      tier: s.tier,
      x: Math.round(s.x), // integer metres — canonical for the digest
      z: Math.round(s.z),
      rx,
      rz,
      culture: culture.key,
      palette: culture.palette,
      name,
    });
  }

  return { seed: worldSeed, settlements };
}

// Tally by tier (§4 spec check).
export function counts(worldSeed) {
  const idx = worldSeed && worldSeed.settlements ? worldSeed : generateWorldIndex(worldSeed);
  const c = { metros: 0, cities: 0, towns: 0, hamlets: 0 };
  for (const s of idx.settlements) {
    if (s.tier === TIER.METRO) c.metros++;
    else if (s.tier === TIER.CITY) c.cities++;
    else if (s.tier === TIER.TOWN) c.towns++;
    else c.hamlets++;
  }
  return c;
}

// A stable digest of the whole index (§5 check #3 — the real guard against
// silent drift across processes and refactors). Canonical serialization →
// hash chain → 8-hex string.
export function digest(index) {
  let h = 2166136261 >>> 0;
  h = hash(h, index.seed);
  for (const s of index.settlements) {
    h = hash(h, s.id, s.tier.length, s.x, s.z, s.rx, s.rz);
    // fold the strings so a renamed city changes the digest
    const label = `${s.tier}|${s.culture}|${s.name || ''}`;
    h = hash(h, label);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
