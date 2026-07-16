// §6 — streaming decisions are pure functions of the world index and the player
// position. Determinism carries over: same seed → same settlements → same load
// set at any point.

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorldIndex } from '../src/worldgen/worldIndex.js';
import { streamRadius, inStreamRange, settlementsToLoad, nearestLabelled } from '../src/worldgen/streaming.js';

const index = generateWorldIndex(8829);

test('stream radius grows with tier', () => {
  assert.ok(streamRadius('metro') > streamRadius('city'));
  assert.ok(streamRadius('city') > streamRadius('town'));
});

test('a settlement loads at its centre and not from far away', () => {
  const m = index.settlements.find((s) => s.tier === 'metro');
  assert.ok(inStreamRange(m, m.x, m.z), 'metro should load when you are on it');
  assert.ok(!inStreamRange(m, m.x + 50000, m.z), 'metro should not load from 50 km away');
});

test('load set near a metro contains that metro and is small', () => {
  const m = index.settlements.find((s) => s.tier === 'metro');
  const load = settlementsToLoad(index, m.x, m.z);
  assert.ok(load.some((s) => s.id === m.id), 'the metro you stand on is in the load set');
  // labelled settlements are kilometres apart, so only a handful load at once
  assert.ok(load.length <= 8, `too many settlements loaded at once: ${load.length}`);
  // never hamlets
  assert.ok(load.every((s) => s.tier !== 'hamlet'));
});

test('nearestLabelled finds the metro you are standing on', () => {
  const m = index.settlements.find((s) => s.tier === 'metro');
  const near = nearestLabelled(index, m.x, m.z);
  assert.equal(near.s.id, m.id);
  assert.ok(near.dist < 1);
});

test('streaming decisions are deterministic across index rebuilds', () => {
  const a = settlementsToLoad(generateWorldIndex(8829), 0, 0).map((s) => s.id).sort((x, y) => x - y);
  const b = settlementsToLoad(generateWorldIndex(8829), 0, 0).map((s) => s.id).sort((x, y) => x - y);
  assert.deepEqual(a, b);
});
