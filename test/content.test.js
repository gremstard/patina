// Car variety + ambient life. The car types are geometry (checked well-formed and
// cheap); ambient agents are transient gameplay (a separate RNG stream, hard rule
// 2) so they aren't pinned — but their invariants are: they stay within the fog
// bubble and vanish when the player leaves the city (nothing beyond the fog, §6).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCarType, CAR_TYPES, CAR_COLORS } from '../src/render/car.js';
import { Ambient } from '../src/sim/ambient.js';

test('every car type is well-formed, cheap geometry', () => {
  assert.ok(CAR_TYPES.length >= 4, 'a few body types');
  assert.ok(CAR_COLORS.length >= 6, 'several colours');
  for (const t of CAR_TYPES) {
    const g = buildCarType(t);
    assert.equal(g.positions.length, g.colors.length);
    assert.equal(g.indices.length % 3, 0);
    assert.ok(g.triangles < 400, `${t} too heavy: ${g.triangles} tris`);
    const vtx = g.positions.length / 3;
    for (const i of g.indices) assert.ok(i < vtx);
  }
});

test('ambient agents populate the city and stay inside the fog bubble', () => {
  const a = new Ambient(40, 16, 7);
  a.setCity(0, 0, 900, true);
  for (let i = 0; i < 300; i++) a.update(0, 0, 1 / 60);
  const livePeds = a.peds.filter((p) => p.live);
  const liveCars = a.cars.filter((c) => c.live);
  assert.ok(livePeds.length > 10, `expected a crowd, got ${livePeds.length}`);
  assert.ok(liveCars.length > 3, `expected traffic, got ${liveCars.length}`);
  for (const p of livePeds) assert.ok(Math.hypot(p.x, p.z) < 120, 'ped escaped the bubble');
  for (const c of liveCars) assert.ok(c.type >= 0 && c.type < CAR_TYPES.length && c.color >= 0 && c.color < CAR_COLORS.length);
});

test('nothing exists beyond the fog — leaving the city clears ambient life', () => {
  const a = new Ambient(40, 16, 7);
  a.setCity(0, 0, 900, true);
  for (let i = 0; i < 120; i++) a.update(0, 0, 1 / 60);
  assert.ok(a.peds.some((p) => p.live), 'populated while in the city');
  a.setCity(0, 0, 900, false); // out in open country
  a.update(0, 0, 1 / 60);
  assert.ok(!a.peds.some((p) => p.live), 'streets empty out of town');
  assert.ok(!a.cars.some((c) => c.live));
});

test('agents follow the player as they move (recycled ahead, not left behind)', () => {
  const a = new Ambient(40, 16, 7);
  a.setCity(0, 0, 4000, true); // big radius so the player stays in-city
  for (let i = 0; i < 60; i++) a.update(0, 0, 1 / 60);
  // teleport the player 1 km away; after a step, live agents should be near the new spot
  a.update(1000, 0, 1 / 60);
  for (let i = 0; i < 60; i++) a.update(1000, 0, 1 / 60);
  for (const p of a.peds.filter((x) => x.live)) assert.ok(Math.hypot(p.x - 1000, p.z) < 120, 'ped not re-homed to the player');
});
