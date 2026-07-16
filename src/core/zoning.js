// §7 — Zoning. The section whose absence produced 5-storey buildings in
// cul-de-sacs. Two axes, not one: settlement TIER is half the picture; the other
// half is DISTANCE FROM CENTRE.
//
// A big city is a core of towers, wrapped in a ring, wrapped in an edge of houses
// and cul-de-sacs — which is most of its area. A town isn't "no core"; it's a
// two-storey main street.
//
// THE KEY INVARIANT: street template and building rule come from the SAME
// function, rules(tier, zone). A single function would have to contradict itself
// to emit a cul-de-sac and 6 floors together. So they can never meet.

import { CITY_R } from './constants.js';

// Fraction of city radius. See §7.
const CORE_R = { metro: 0.26, city: 0.16, town: 0.09 };
const RING_R = { metro: 0.62, city: 0.46, town: 0.30 };

// Which concentric zone a point falls in, given its settlement tier and its
// distance (m) from the settlement centre.
//
// ⚠️ §7: if zones look inverted — towers on the rim, bungalows downtown — check
// the sign on the distance term. That's a two-character bug that produces a
// correct-LOOKING implementation.
export function zoneAt(tier, dist) {
  const t = dist / CITY_R[tier];
  if (t < CORE_R[tier]) return 'core';
  if (t < RING_R[tier]) return 'ring';
  return 'edge';
}

// rules(tier, zone) → { floors:[min,max], lot, setback, roof, detached, streets }
//
// This encodes the §7 table directly. `streets` is the template the road
// subdivider must honour; `roof`/`setback`/`detached`/`floors` drive building
// assembly (§10). Because both come from here, a 6-floor office can never be
// emitted onto a cul-de-sac.
//
//   streets:  'tight' | 'grid' | 'culdesac'
//   roof:     'parapet' | 'flat' | 'gable'
const TABLE = {
  metro: {
    core: { floors: [6, 12], lot: 'office', setback: 0, roof: 'parapet', detached: false, streets: 'tight' },
    ring: { floors: [3, 5], lot: 'apartment', setback: 1.25, roof: 'flat', detached: false, streets: 'grid' },
    edge: { floors: [1, 2], lot: 'house', setback: 7.5, roof: 'gable', detached: true, streets: 'culdesac' },
  },
  city: {
    core: { floors: [3, 5], lot: 'store', setback: 0, roof: 'parapet', detached: false, streets: 'grid' },
    ring: { floors: [2, 3], lot: 'apartment', setback: 1.25, roof: 'flat', detached: false, streets: 'grid' },
    edge: { floors: [1, 2], lot: 'house', setback: 7.5, roof: 'gable', detached: true, streets: 'culdesac' },
  },
  town: {
    core: { floors: [2, 2], lot: 'mainstreet', setback: 0, roof: 'flat', detached: false, streets: 'grid' },
    ring: { floors: [1, 2], lot: 'house', setback: 5, roof: 'gable', detached: true, streets: 'grid' },
    edge: { floors: [1, 1], lot: 'house', setback: 7.5, roof: 'gable', detached: true, streets: 'culdesac' },
  },
};

// Hamlets are a handful of buildings — treat the whole footprint as a town edge.
const HAMLET_RULE = { floors: [1, 1], lot: 'house', setback: 7.5, roof: 'gable', detached: true, streets: 'culdesac' };

export function rules(tier, zone) {
  if (tier === 'hamlet') return HAMLET_RULE;
  const byZone = TABLE[tier];
  if (!byZone) throw new Error(`zoning.rules: unknown tier ${tier}`);
  const r = byZone[zone];
  if (!r) throw new Error(`zoning.rules: unknown zone ${zone}`);
  return r;
}
