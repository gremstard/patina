// Car variety + ambient life. The car types are geometry (checked well-formed and
// cheap); ambient agents are transient gameplay (a separate RNG stream, hard rule
// 2) so they aren't pinned — but their invariants are: they stay within the fog
// bubble and vanish when the player leaves the city (nothing beyond the fog, §6).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCarType, CAR_TYPES, CAR_COLORS } from '../src/render/car.js';
import { Ambient } from '../src/sim/ambient.js';
import { resolveAgents } from '../src/sim/collision.js';
import { BLOCK, CORRIDOR } from '../src/core/constants.js';
import { buildRoads } from '../src/worldgen/roads.js';
import { generateWorldIndex } from '../src/worldgen/worldIndex.js';
import { generateInterior } from '../src/worldgen/interior.js';

test('every interior type generates a walled room with collision, deterministically', () => {
  for (const type of ['office', 'shop', 'apartment', 'house', 'bank']) {
    const a = generateInterior(4242, type);
    const b = generateInterior(4242, type);
    assert.ok(a.positions.length > 0 && a.indices.length % 3 === 0, `${type} geometry`);
    assert.ok(a.colliders.length >= 4, `${type} needs walls to collide with`);
    assert.ok(a.spawn && a.exit && a.size.W > 0, `${type} has spawn/exit/size`);
    assert.deepEqual(Array.from(a.indices.slice(0, 40)), Array.from(b.indices.slice(0, 40)), `${type} deterministic`);
  }
});

test('a moving body knocks pushable agents back and keeps most of its speed', () => {
  // a fast body driving straight into an agent just ahead
  const body = { x: 0, z: 0, vx: 0, vz: 10 };
  const agent = { live: true, rx: 0, rz: 1.5, x: 0, z: 1.5, r: 0.45, kx: 0, kz: 0 };
  resolveAgents(body, [agent], 1.4, 1.0);
  assert.ok(agent.kz > 0, 'agent flung forward along the hit');
  assert.ok(body.vz > 8, `body keeps most of its momentum, got ${body.vz}`);
});

test('an immovable agent (power 0) stops the body instead of moving', () => {
  const body = { x: 0, z: 0, vx: 0, vz: 10 };
  const agent = { live: true, rx: 0, rz: 1.0, x: 0, z: 1.0, r: 1.5, kx: 0, kz: 0 };
  resolveAgents(body, [agent], 0.4, 0);
  assert.equal(agent.kz, 0, 'agent did not move');
  assert.ok(body.vz < 1, `body stopped at the wall, got ${body.vz}`);
  assert.ok(body.z < 0, 'body pushed back out of penetration');
});

test('with a street grid, ambient agents stay on real roads (never the gap block)', () => {
  const a = new Ambient(40, 16, 5);
  // 7×7 blocks all present except the centre (0,0) — a plaza gap
  const n = 3; const W = 2 * n + 1;
  const occ = new Uint8Array(W * W).fill(1);
  occ[(0 + n) * W + (0 + n)] = 0;
  a.setCity(0, 0, 4000, true, { occ, n, pitch: BLOCK + CORRIDOR });
  for (let i = 0; i < 300; i++) a.update(0, 0, 0, 1 / 60);
  const liveP = a.peds.filter((p) => p.live);
  const liveC = a.cars.filter((c) => c.live);
  assert.ok(liveP.length + liveC.length > 8, 'streets should still be populated around the gap');
  for (const c of liveC) assert.ok(a._carRoad(c.x, c.z, c.dir), 'a car is driving off the road grid');
  for (const p of liveP) if (!p.cross) assert.ok(a._pedWalk(p.x, p.z, p.dir), 'a ped is walking off the sidewalk grid');
});

test('the highway network is a spanning tree over every labelled settlement', () => {
  const index = generateWorldIndex(8829);
  const labelled = index.settlements.filter((s) => s.tier !== 'hamlet').length;
  const roads = buildRoads(index);
  // a spanning tree over N nodes has exactly N-1 edges and connects them all
  assert.equal(roads.length, labelled - 1, `MST should have ${labelled - 1} edges`);
  // deterministic
  assert.equal(buildRoads(generateWorldIndex(8829)).length, roads.length);
});

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
  for (let i = 0; i < 300; i++) a.update(0, 0, 0, 1 / 60);
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
  for (let i = 0; i < 120; i++) a.update(0, 0, 0, 1 / 60);
  assert.ok(a.peds.some((p) => p.live), 'populated while in the city');
  a.setCity(0, 0, 900, false); // out in open country
  a.update(0, 0, 0, 1 / 60);
  assert.ok(!a.peds.some((p) => p.live), 'streets empty out of town');
  assert.ok(!a.cars.some((c) => c.live));
});

test('agents follow the player as they move (recycled ahead, not left behind)', () => {
  const a = new Ambient(40, 16, 7);
  a.setCity(0, 0, 4000, true); // big radius so the player stays in-city
  for (let i = 0; i < 60; i++) a.update(0, 0, 0, 1 / 60);
  // teleport the player 1 km away; after a step, live agents should be near the new spot
  a.update(1000, 0, 0, 1 / 60);
  for (let i = 0; i < 60; i++) a.update(1000, 0, 0, 1 / 60);
  for (const p of a.peds.filter((x) => x.live)) assert.ok(Math.hypot(p.x - 1000, p.z) < 120, 'ped not re-homed to the player');
});
