// §12 / §5 — the sim must be deterministic. Same inputs + fixed DT → the same
// trajectory, on any machine. This is the property LAN multiplayer will lean on
// (both peers step identical inputs and never sync positions), so it is pinned
// now, while the controller is small.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCar, stepCar } from '../src/sim/vehicle.js';
import { buildColliderGrid, resolveCollision } from '../src/sim/collision.js';
import { generateCity } from '../src/worldgen/city.js';
import { hash } from '../src/core/hash.js';

const DT = 1 / 60;

// A fixed input script: accelerate, then a long right-hand drift, then coast.
function scriptedInput(step) {
  if (step < 90) return { throttle: true, steer: 0 };
  if (step < 180) return { throttle: true, steer: 1 };
  if (step < 240) return { steer: 1, handbrake: true };
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

function stateDigest(car) {
  let h = 2166136261 >>> 0;
  for (const v of [car.x, car.z, car.yaw, car.vx, car.vz, car.speed]) {
    h = hash(h, Math.round(v * 1000));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Pinned trajectory digests (no-collision, and driving through a real city).
const PINNED_FREE = '6ee921c1';
const PINNED_CITY = '0935533e';

test('vehicle sim is deterministic and matches the pinned free-run trajectory', () => {
  const a = runScript(false);
  const b = runScript(false);
  assert.equal(stateDigest(a), stateDigest(b), 'two runs diverged — non-determinism in the sim');
  assert.equal(stateDigest(a), PINNED_FREE, `free-run trajectory drifted: ${stateDigest(a)} !== ${PINNED_FREE}`);
});

test('driving through a city (with collision) is deterministic and pinned', () => {
  const a = runScript(true);
  const b = runScript(true);
  assert.equal(stateDigest(a), stateDigest(b));
  assert.equal(stateDigest(a), PINNED_CITY, `city-run trajectory drifted: ${stateDigest(a)} !== ${PINNED_CITY}`);
});

test('a car cannot drive through a building', () => {
  // one building dead ahead; slam the throttle straight at it
  const grid = buildColliderGrid([{ x: 0, z: 20, hw: 8, hd: 8 }]);
  const car = createCar(0, 0, 0); // faces +z, toward the wall at z=12
  for (let s = 0; s < 600; s++) {
    stepCar(car, { throttle: true }, DT);
    resolveCollision(car, grid, 2.0);
  }
  // the near face is at z = 12; with a 2 m radius the car centre must stop before it
  assert.ok(car.z < 12 - 2 + 0.5, `car penetrated the wall: z=${car.z.toFixed(2)}`);
  assert.ok(car.z > 8, `car ended up somewhere impossible: z=${car.z.toFixed(2)}`);
});

test('handbrake produces more slip than a gripped turn (drift exists)', () => {
  const spinup = () => { const c = createCar(); for (let i = 0; i < 120; i++) stepCar(c, { throttle: true }, DT); return c; };
  const grip = spinup();
  let gripSlip = 0;
  for (let i = 0; i < 120; i++) { stepCar(grip, { throttle: true, steer: 1 }, DT); gripSlip = Math.max(gripSlip, grip.slip); }
  const hb = spinup();
  let hbSlip = 0;
  for (let i = 0; i < 120; i++) { stepCar(hb, { steer: 1, handbrake: true }, DT); hbSlip = Math.max(hbSlip, hb.slip); }
  assert.ok(hbSlip > gripSlip * 1.4, `handbrake slip ${hbSlip.toFixed(2)} not meaningfully > grip slip ${gripSlip.toFixed(2)}`);
});
