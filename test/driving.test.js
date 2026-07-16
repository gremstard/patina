// §12 / §5 — the sim must be deterministic. Same inputs + fixed DT → the same
// trajectory, on any machine. This is the property LAN multiplayer will lean on
// (both peers step identical inputs and never sync positions), so it is pinned
// now, while the controller is small.
//
// The model is deliberately SIMPLE (on rails): W/S move along the path, steering
// curves the path, no lateral slip. These tests lock that in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCar, stepCar } from '../src/sim/vehicle.js';
import { createPed, stepPed } from '../src/sim/pedestrian.js';
import { buildColliderGrid, resolveCollision } from '../src/sim/collision.js';
import { generateCity } from '../src/worldgen/city.js';
import { hash } from '../src/core/hash.js';

const DT = 1 / 60;

// Accelerate, hold a right-hand turn, then coast.
function scriptedInput(step) {
  if (step < 90) return { throttle: true, steer: 0 };
  if (step < 210) return { throttle: true, steer: 1 };
  return { steer: 0 };
}

function runScript(withCollision) {
  const car = createCar(36, 0, 0);
  let grid = null;
  if (withCollision) grid = buildColliderGrid(generateCity(1997, 'city', 'redbrick').colliders);
  for (let s = 0; s < 360; s++) {
    stepCar(car, scriptedInput(s), DT);
    if (grid) resolveCollision(car, grid, 2.0);
  }
  return car;
}

function stateDigest(o) {
  let h = 2166136261 >>> 0;
  for (const v of [o.x, o.z, o.yaw, o.vx, o.vz, o.speed]) h = hash(h, Math.round(v * 1000));
  return (h >>> 0).toString(16).padStart(8, '0');
}

const PINNED_FREE = '8dfecad2';
const PINNED_CITY = 'c3d1cc28';

test('vehicle sim is deterministic and matches the pinned free-run trajectory', () => {
  assert.equal(stateDigest(runScript(false)), stateDigest(runScript(false)));
  assert.equal(stateDigest(runScript(false)), PINNED_FREE);
});

test('driving through a city (with collision) is deterministic and pinned', () => {
  assert.equal(stateDigest(runScript(true)), stateDigest(runScript(true)));
  assert.equal(stateDigest(runScript(true)), PINNED_CITY);
});

test('the car is on rails — velocity always along heading, zero slip', () => {
  const car = createCar(0, 0, 0);
  for (let s = 0; s < 300; s++) {
    stepCar(car, scriptedInput(s), DT);
    // velocity must point along the heading (no lateral component)
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const lateral = car.vx * fx * 0 + (car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw));
    assert.ok(Math.abs(lateral) < 1e-6, `lateral velocity ${lateral} at step ${s}`);
    assert.equal(car.slip, 0);
  }
});

test('steering curves the path (right turn bends off the straight line)', () => {
  const car = createCar(0, 0, 0);
  for (let s = 0; s < 90; s++) stepCar(car, { throttle: true }, DT); // straight
  assert.ok(Math.abs(car.x) < 0.01, 'went straight before steering');
  const zStraight = car.z;
  for (let s = 0; s < 60; s++) stepCar(car, { throttle: true, steer: 1 }, DT); // ~90° turn
  assert.ok(Math.abs(car.x) > 5, `path did not curve: x=${car.x.toFixed(2)}`);
  assert.ok(car.z > zStraight, 'kept moving forward through a gentle turn');
  // a long hard turn loops back on itself — the path is a real arc, not a slide
  for (let s = 0; s < 120; s++) stepCar(car, { throttle: true, steer: 1 }, DT);
  assert.ok(Math.hypot(car.x, car.z) > 10, 'travelled a real distance');
});

test('a car cannot drive through a building', () => {
  const grid = buildColliderGrid([{ x: 0, z: 20, hw: 8, hd: 8 }]);
  const car = createCar(0, 0, 0); // faces +z, wall near face at z=12
  for (let s = 0; s < 600; s++) {
    stepCar(car, { throttle: true }, DT);
    resolveCollision(car, grid, 2.0);
  }
  assert.ok(car.z < 12 - 2 + 0.5, `car penetrated the wall: z=${car.z.toFixed(2)}`);
  assert.ok(car.z > 8, `car ended up somewhere impossible: z=${car.z.toFixed(2)}`);
});

test('the walker moves and turns deterministically', () => {
  function walk() {
    const p = createPed(0, 0, 0);
    for (let s = 0; s < 240; s++) {
      const input = s < 60 ? { throttle: true } : s < 120 ? { throttle: true, steer: 1 } : { throttle: true };
      stepPed(p, input, DT);
    }
    return p;
  }
  const a = walk();
  const b = walk();
  assert.equal(stateDigest(a), stateDigest(b));
  // it actually went somewhere and turned
  assert.ok(Math.hypot(a.x, a.z) > 5, 'walker barely moved');
  assert.ok(Math.abs(a.yaw) > 0.1, 'walker never turned');
});
