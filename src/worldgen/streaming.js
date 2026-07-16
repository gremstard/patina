// §6 / hard rule 6 — streaming the bounded world.
//
// "Nothing exists beyond the fog." The world is 1037 settlements at fixed world
// positions (the build-time index, §4). As the player moves, settlements near
// them get their geometry generated; far ones are DELETED (not culled). This is
// the "chunks like Minecraft" idea, keyed to settlements because settlements are
// the content — everything between them is cheap connective tissue (§1).
//
// Pure helpers, no three.js. The app owns the meshes; this owns the "what should
// be loaded right now" decision.

import { CITY_R } from '../core/constants.js';

// How close before a settlement's geometry must exist. Its own extent plus a
// margin, so it is built before it emerges from the 100 m fog rather than
// popping in. Hamlets are skipped by the streamer (unlabelled, tiny).
export function streamRadius(tier) {
  return (CITY_R[tier] ?? 100) + 900;
}

// Is settlement `s` within (mul × its stream radius) of world point (x, z)?
// mul > 1 gives unload hysteresis so a settlement on the boundary doesn't thrash.
export function inStreamRange(s, x, z, mul = 1) {
  const r = streamRadius(s.tier) * mul;
  const dx = s.x - x;
  const dz = s.z - z;
  return dx * dx + dz * dz < r * r;
}

// The labelled settlements (metro/city/town) whose geometry should be loaded at
// world point (x, z). Iterating all ~1000 is trivial (it's a distance check) so
// no spatial index is needed — the world being BOUNDED is what makes this cheap.
export function settlementsToLoad(index, x, z) {
  const out = [];
  for (const s of index.settlements) {
    if (s.tier === 'hamlet') continue;
    if (inStreamRange(s, x, z)) out.push(s);
  }
  return out;
}

// Nearest labelled settlement to (x, z), with its distance — for the HUD compass
// and "you are near …" readout.
export function nearestLabelled(index, x, z) {
  let best = null;
  let bd = Infinity;
  for (const s of index.settlements) {
    if (s.tier === 'hamlet') continue;
    const dx = s.x - x;
    const dz = s.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { s: best, dist: Math.sqrt(bd) } : null;
}
