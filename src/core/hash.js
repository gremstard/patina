// §5 — The seed chain.
//
// Nothing is stored. Everything is a pure function of position + seed.
//
//   worldSeed (u32)
//     └─ regionSeed = hash(worldSeed, rx, rz)
//          └─ citySeed  = hash(regionSeed, cityIndex)
//               └─ blockSeed = hash(citySeed, bx, bz)
//                    └─ lotSeed = hash(blockSeed, lotIndex)
//                         └─ propSeed = hash(lotSeed, propIndex)
//
// HARD RULE 1: No Math.random() in worldgen. Ever. All generation is a pure
// function of (seed, coordinates) through this hash chain. No global RNG state.
//
// HARD RULE 2: Worldgen RNG and gameplay RNG are separate streams. That is a
// discipline enforced by the *caller* — keep gameplay rolls out of the argument
// lists that place buildings. This module is stateless, so it cannot leak one
// stream into another on its own.
//
// Invariant (§5): any node must be computable without computing its siblings.

// Fold a string into a u32 so it can enter the mixer as an integer. Strings are
// common seed arguments (§9: hash(pedSeed, 'name')), and `'name' | 0` is 0 —
// which would collapse every string label to the same value. This runs first.
export function strhash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// A frozen FNV-1a-derived integer mixer with two avalanche rounds per argument.
// Do not "improve" this. Its output is pinned in the determinism test (§5);
// changing a single constant invalidates every save in existence.
//
// String arguments are folded via strhash first (see above). Numeric-only calls
// — the entire hot path — are byte-identical to the spec's mixer, so the pinned
// constant hash(1,2,3) is unaffected.
export function hash(...a) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < a.length; i++) {
    const v = typeof a[i] === 'string' ? strhash(a[i]) : a[i];
    h ^= v | 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 2246822519) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

// h -> [0, 1). Drops the low 8 bits (weakest avalanche) before normalizing.
export const unit = (h) => (h >>> 8) / 16777216;

// (...args) -> [0, 1). The everyday entry point for "give me a roll here".
export const rng = (...a) => unit(hash(...a));
