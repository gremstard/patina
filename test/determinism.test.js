// §5 — The determinism test. The entire premise is: same seed → same world.
// It is load-bearing, and it FAILS SILENTLY — someone adds a Math.random() for a
// "temporary" jitter, or iterates a Set, and the world quietly changes with no
// error. Old saves just point at a world that no longer exists.
//
// Written while the surface is a handful of modules, not thirty. Run: `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { hash, unit, rng, strhash } from '../src/core/hash.js';
import { generateWorldIndex, counts, digest } from '../src/worldgen/worldIndex.js';
import { asciiLint } from '../src/worldgen/names.js';
import { zoneAt, rules } from '../src/core/zoning.js';
import { origin, resetOrigin, rebaseIfNeeded, REBASE_AT, toWorld } from '../src/core/origin.js';

// Pinned constants. Regenerate ONLY with intent — changing either means every
// existing save points at a different world.
const KNOWN_HASH_123 = 3294357629;
const CHECKED_IN_DIGEST = '88aa783f';
const SEED = 8829;

// ── §5 check #1: the mixer itself is frozen ──────────────────────────────────
test('hash mixer is frozen (hash(1,2,3) === pinned constant)', () => {
  assert.equal(hash(1, 2, 3), KNOWN_HASH_123);
});

test('unit and rng stay in [0,1)', () => {
  for (let i = 0; i < 10000; i++) {
    const u = unit(hash(SEED, i));
    assert.ok(u >= 0 && u < 1, `unit out of range at ${i}: ${u}`);
    const r = rng('x', i);
    assert.ok(r >= 0 && r < 1);
  }
});

test('string arguments fold instead of collapsing to 0', () => {
  // 'name' | 0 === 0 and 'shirt' | 0 === 0 — without folding these would tie.
  assert.notEqual(hash(1, 'name'), hash(1, 'shirt'));
  assert.notEqual(strhash('name'), strhash('shirt'));
  // numeric-only calls are unaffected by the string path (the pinned constant).
  assert.equal(hash(1, 2, 3), KNOWN_HASH_123);
});

// ── §5 check #2: same process, twice ─────────────────────────────────────────
test('generateWorldIndex is stable within a process', () => {
  assert.deepEqual(generateWorldIndex(SEED), generateWorldIndex(SEED));
});

// ── §5 check #3: across processes and refactors — the REAL guard ─────────────
test('world index digest matches the checked-in value', () => {
  const d = digest(generateWorldIndex(SEED));
  assert.equal(
    d,
    CHECKED_IN_DIGEST,
    `\nWorld digest changed: ${d} !== ${CHECKED_IN_DIGEST}\n` +
      'If this was intentional (you changed worldgen on purpose), update\n' +
      'CHECKED_IN_DIGEST. If it was NOT, you introduced non-determinism —\n' +
      'a Math.random(), a Set iteration driving a choice, or float-order drift.',
  );
});

// ── §5 check #4: the spec, pinned (§4 counts can never drift) ────────────────
test('metro count sits in the pinned spec band [3,7]', () => {
  const c = counts(SEED);
  assert.ok(c.metros >= 3 && c.metros <= 7, `metros=${c.metros}, expected 3..7`);
});

test('city / town counts sit near their §4 targets', () => {
  const c = counts(SEED);
  assert.ok(c.cities >= 25 && c.cities <= 45, `cities=${c.cities}, expected ~35`);
  assert.ok(c.towns >= 120 && c.towns <= 190, `towns=${c.towns}, expected ~150`);
  assert.ok(c.hamlets >= 400, `hamlets=${c.hamlets}, expected the connective-tissue bulk`);
});

test('a spread of seeds all stay within the metro spec band', () => {
  for (const s of [1, 42, 1997, 8829, 123456, 0xdeadbeef]) {
    const c = counts(s);
    assert.ok(c.metros >= 3 && c.metros <= 7, `seed ${s}: metros=${c.metros}`);
  }
});

// ── §9: ASCII-only name tables (the Portराvenburg guard) ─────────────────────
test('name tables are ASCII only', () => {
  assert.ok(asciiLint());
});

test('labelled settlements are named and globally unique', () => {
  const idx = generateWorldIndex(SEED);
  const named = idx.settlements.filter((s) => s.tier !== 'hamlet');
  const names = named.map((s) => s.name);
  assert.ok(names.every((n) => typeof n === 'string' && n.length > 0), 'every labelled settlement has a name');
  assert.equal(new Set(names).size, names.length, 'names are globally deduped');
});

// ── §7: the zoning invariant — a cul-de-sac and 6 floors can never meet ──────
test('cul-de-sac streets never carry more than 2 floors (§7 invariant)', () => {
  for (const tier of ['metro', 'city', 'town']) {
    for (const zone of ['core', 'ring', 'edge']) {
      const r = rules(tier, zone);
      if (r.streets === 'culdesac') {
        assert.ok(r.floors[1] <= 2, `${tier}/${zone}: cul-de-sac with ${r.floors[1]} floors`);
      }
      // and the converse: tall buildings never sit on cul-de-sacs
      if (r.floors[1] >= 3) {
        assert.notEqual(r.streets, 'culdesac', `${tier}/${zone}: ${r.floors[1]} floors on a cul-de-sac`);
      }
    }
  }
});

test('zoneAt is monotonic centre → edge (§7 sign check)', () => {
  for (const tier of ['metro', 'city', 'town']) {
    assert.equal(zoneAt(tier, 0), 'core', `${tier} centre must be core`);
    assert.equal(zoneAt(tier, 1e9), 'edge', `${tier} far-out must be edge`);
  }
});

// ── §8: floating origin keeps local coords small, world coords exact ─────────
test('rebaseIfNeeded keeps the car near the local origin and conserves world position', () => {
  resetOrigin();
  const car = { x: 0, z: 0 };
  const scene = { position: { x: 0, z: 0 } };
  let worldX = 0;
  let worldZ = 0;
  // drive far in a straight line, one metre per step
  for (let i = 0; i < 5000; i++) {
    car.x += 1;
    car.z += 0.5;
    worldX += 1;
    worldZ += 0.5;
    rebaseIfNeeded(car, scene);
    // invariant: never allowed to drift past the rebase radius (plus one step)
    assert.ok(Math.hypot(car.x, car.z) < REBASE_AT + 2, `local drift too large at step ${i}`);
  }
  // world = local + origin must reconstruct the true absolute position exactly
  const w = toWorld(car.x, car.z);
  assert.ok(Math.abs(w.x - worldX) < 1e-6, `world X reconstruct: ${w.x} vs ${worldX}`);
  assert.ok(Math.abs(w.z - worldZ) < 1e-6, `world Z reconstruct: ${w.z} vs ${worldZ}`);
  assert.ok(origin.count > 0, 'expected at least one rebase over 5 km of driving');
});
