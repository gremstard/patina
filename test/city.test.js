// §5 (extended to Phase 3) — city geometry must be deterministic. Same seed +
// tier → the same buildings, forever. Pins the geometry digest so a stray
// Math.random() or a reordered loop in the generator fails loudly.
//
// Also guards the §7 invariants at the geometry level: the density gradient is
// monotonic (metro taller than city taller than town) and cul-de-sac zones stay
// low — the whole point of driving streets and buildings from one rules() call.

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCity, cityDigest } from '../src/worldgen/city.js';
import { MeshBuilder } from '../src/render/meshbuilder.js';

const SEED = 1997;

// Pinned geometry digests. Regenerate ONLY when you change the generator on
// purpose (node -e "import('./src/worldgen/city.js')..." prints them).
const PINNED = {
  metro: '9e4b7119',
  city: 'b2bf241d',
  town: '62215904',
};

test('city geometry digest matches the checked-in value', () => {
  for (const tier of ['metro', 'city', 'town']) {
    const d = cityDigest(generateCity(SEED, tier, 'redbrick'));
    assert.equal(d, PINNED[tier], `${tier} geometry drifted: ${d} !== ${PINNED[tier]}`);
  }
});

test('generateCity is stable within a process', () => {
  const a = generateCity(SEED, 'city', 'redbrick');
  const b = generateCity(SEED, 'city', 'redbrick');
  assert.equal(cityDigest(a), cityDigest(b));
  assert.deepEqual(Array.from(a.indices.slice(0, 64)), Array.from(b.indices.slice(0, 64)));
});

test('density gradient is monotonic: metro > city > town (§7)', () => {
  const metro = generateCity(SEED, 'metro', 'redbrick');
  const city = generateCity(SEED, 'city', 'redbrick');
  const town = generateCity(SEED, 'town', 'redbrick');
  assert.ok(metro.maxHeight > city.maxHeight, `metro ${metro.maxHeight} !> city ${city.maxHeight}`);
  assert.ok(city.maxHeight > town.maxHeight, `city ${city.maxHeight} !> town ${town.maxHeight}`);
  // and the tally of buildings scales with tier too
  assert.ok(metro.stats.buildings > city.stats.buildings);
  assert.ok(city.stats.buildings > town.stats.buildings);
});

test('a town never sprouts a tower (§7 — no barn roofs, no downtown in a village)', () => {
  // town buildings top out around a 2-floor main street plus a capped gable —
  // comfortably under 12 m. This is the geometry-level version of the §7
  // cul-de-sac invariant already unit-tested in determinism.test.js.
  for (const s of [1, 8829, 1997, 424242]) {
    const town = generateCity(s, 'town', 'greyconcrete');
    assert.ok(town.maxHeight < 12, `seed ${s}: town maxHeight ${town.maxHeight} — too tall for a town`);
  }
});

test('MeshBuilder emits well-formed, in-range geometry', () => {
  const mb = new MeshBuilder();
  mb.box(0, 5, 0, 4, 10, 4, [0.5, 0.4, 0.3]);
  mb.plane(0, 0, 8, 8, 0, [0.2, 0.2, 0.2]);
  mb.gable(0, 10, 0, 4, 4, 2, [0.3, 0.2, 0.2]);
  const g = mb.build();
  assert.equal(g.positions.length % 3, 0);
  assert.equal(g.positions.length, g.normals.length);
  assert.equal(g.positions.length, g.colors.length);
  assert.equal(g.indices.length % 3, 0);
  // every index points at a real vertex
  const vtx = g.positions.length / 3;
  for (const i of g.indices) assert.ok(i < vtx, `index ${i} out of range (${vtx} verts)`);
  // normals are unit length
  for (let i = 0; i < g.normals.length; i += 3) {
    const len = Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5, `non-unit normal ${len}`);
  }
});
