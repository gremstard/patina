// §10 — The grid, and §4 — World scale.
//
// HARD RULE 10: Never hard-code 2.5. Reference MODULE.
//
// 2.5 m is a *choice*, not a measurement. It survives because the derived street
// cross-section lands on real-world numbers and everything is built around it.

// ── The master unit (§10) ────────────────────────────────────────────────────
export const MODULE = 2.5; // m — the master unit
export const HALF = MODULE / 2; // 1.25 m
export const FLOOR = MODULE; // floor height == module
export const LANE = MODULE * 1.5; // 3.75 m  ✓ real lanes are 3.5–3.7
export const SIDEWALK = MODULE; // 2.5 m
export const CORRIDOR = LANE * 2 + SIDEWALK * 2; // 12.5 m = 5 modules ✓ real: 12–15
export const BLOCK = MODULE * 24; // 60 m
export const PED_H = 1.8; // m — ped height
export const FOG_FAR = 100; // m — the most important number in the game (§3)

// ── World scale (§4) ─────────────────────────────────────────────────────────
export const WORLD_KM = 128; // 128 × 128 km bounded world
export const WORLD_M = WORLD_KM * 1000; // 128_000 m
export const HALF_WORLD_M = WORLD_M / 2; // world spans [-64000, +64000]

// The build-time world index (§4): the region grid is a TABLE, not a search.
// 128 km / 8 km regions = 16 × 16 = 256 regions.
export const REGION_KM = 8;
export const REGION_M = REGION_KM * 1000; // 8_000 m
export const REGION_COUNT = WORLD_KM / REGION_KM; // 16 per axis
export const REGION_TOTAL = REGION_COUNT * REGION_COUNT; // 256

// ── Settlement tiers (§4) ────────────────────────────────────────────────────
export const TIER = Object.freeze({
  METRO: 'metro',
  CITY: 'city',
  TOWN: 'town',
  HAMLET: 'hamlet', // POI / unlabelled
});

// Ordered most-important → least. Generation places tiers in this order so a
// dense metro never lands on top of a town.
export const TIER_ORDER = [TIER.METRO, TIER.CITY, TIER.TOWN, TIER.HAMLET];

// City radius in metres (§7 CITY_R, extended with a hamlet footprint).
export const CITY_R = Object.freeze({
  metro: 2000,
  city: 800,
  town: 300,
  hamlet: 80,
});

// Target counts and spacing (§4 "Targets" table). These are THE SPEC. An early
// prototype produced 21 metros / 92 cities / 290 towns because it was tuned to
// look good in a thumbnail — the counts are pinned in the determinism test (§5)
// so they can't drift.
export const TIER_TARGET = Object.freeze({
  metro: 5, //   ~5   metros   · spacing ~57 km
  city: 35, //  ~35   cities   · spacing ~20 km
  town: 150, // ~150   towns    · spacing  ~9 km
  hamlet: 1000, // ~1000 POIs     · spacing  ~4 km
});

// Minimum centre-to-centre spacing per tier, in metres. Enforced against every
// already-placed (higher-or-equal importance) settlement during selection, so
// the density of the map reads as real geography, not salt-and-pepper.
export const TIER_SPACING_M = Object.freeze({
  metro: 40000, //  metros sit far apart (real metros: 100–300 km; world is 128)
  city: 14000,
  town: 6000,
  hamlet: 3000,
});
