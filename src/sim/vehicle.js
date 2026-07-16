// §12 — The vehicle, as a pure deterministic sim.
//
// "GTA's handling was never rigid-body sim. Custom is simpler, deterministic by
//  construction, and one less dependency." This file has no three.js and no DOM:
//  it is stepped at a FIXED DT by an accumulator (§12), takes INPUT not positions
//  ({throttle, steer, brake, handbrake} — the multiplayer shape), and mutates the
//  car in place (hard rule 3: zero allocation in the step).
//
// Coordinates are the render-local frame (§8): small numbers near the origin.
// The car's true city position is (local + origin); the driver applies the
// floating-origin rebase after stepping.
//
// Model: a grip/slip arcade car. Velocity lives in world axes; each step it is
// split into forward/lateral, the engine and brakes act along forward, tyre grip
// eats lateral speed (handbrake loosens it → slides), and steering turns the
// heading at a speed-scaled rate. No global RNG.

// Handling constants. Tuned so top speed ≈ 33 m/s (~120 km/h), 0–100 km/h in a
// few seconds, and a sane turning circle. All SI-ish (metres, seconds).
export const CAR = {
  ENGINE: 11.0, // forward accel under throttle (m/s^2)
  BRAKE: 20.0, // decel under brake while moving forward
  REVERSE: 6.0, // accel backwards once stopped
  ROLL: 2.6, // linear rolling resistance (m/s^2)
  DRAG: 0.0075, // quadratic air drag (per (m/s)^2) → sets top speed
  MAX_STEER: 0.55, // rad at full lock, low speed
  STEER_SPEED: 3.2, // rad/s the steering input approaches its target
  WHEELBASE: 3.1, // m — bicycle-model turn geometry
  GRIP: 7.5, // lateral grip (1/s); higher = less slide
  HANDBRAKE_GRIP: 1.4, // loosened rear grip under handbrake
  MASS_EASE: 6.0, // how fast throttle/brake ramps (input smoothing, 1/s)
};

export function createCar(x = 0, z = 0, yaw = 0) {
  return {
    x,
    z,
    yaw, // heading (rad); 0 faces +z
    vx: 0,
    vz: 0, // velocity in world axes (m/s)
    steer: 0, // current front-wheel angle (rad), eased toward input
    speed: 0, // signed forward speed (m/s) — for HUD / camera
    slip: 0, // |lateral speed| — for skid feedback
    // previous state, for render interpolation (§12: render interpolates on top)
    prevX: x,
    prevZ: z,
    prevYaw: yaw,
    prevSteer: 0,
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (cur, target, rate, dt) => {
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
};

// Advance one fixed step. `input`: {throttle, brake, steer:-1..1, handbrake}
// (all optional; throttle/brake/handbrake are 0/1 or boolean).
export function stepCar(car, input, dt) {
  // snapshot for interpolation
  car.prevX = car.x;
  car.prevZ = car.z;
  car.prevYaw = car.yaw;
  car.prevSteer = car.steer;

  // heading basis: forward (sin,cos), right (cos,-sin)
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  const rx = Math.cos(car.yaw);
  const rz = -Math.sin(car.yaw);

  // split velocity into forward / lateral
  let vForward = car.vx * fx + car.vz * fz;
  let vLateral = car.vx * rx + car.vz * rz;

  // longitudinal forces
  const throttle = input.throttle ? 1 : 0;
  const brake = input.brake ? 1 : 0;
  let accel = throttle * CAR.ENGINE;
  if (brake) accel -= vForward > 0.3 ? CAR.BRAKE : CAR.REVERSE;
  // rolling resistance + quadratic drag oppose motion
  accel -= Math.sign(vForward) * CAR.ROLL;
  accel -= vForward * Math.abs(vForward) * CAR.DRAG;
  const nextForward = vForward + accel * dt;
  // don't let resistance push a near-stopped car backwards
  vForward = brake || throttle || Math.abs(vForward) > 0.05 ? nextForward : 0;

  // tyre grip eats lateral velocity; handbrake loosens it → slide
  const grip = input.handbrake ? CAR.HANDBRAKE_GRIP : CAR.GRIP;
  vLateral -= vLateral * clamp(grip * dt, 0, 1);

  // Recompose in the CURRENT heading frame — velocity lives in world axes and
  // does NOT rotate rigidly with the car. The lag between where the car points
  // and where it travels IS the slip; grip closes it over time, the handbrake
  // lets it open up (drift). Recomposing in the new frame instead would put the
  // car on rails and grip would do nothing.
  car.vx = fx * vForward + rx * vLateral;
  car.vz = fz * vForward + rz * vLateral;

  // steering: ease the wheel toward input, reduce lock at speed
  const speedLockScale = 1 - 0.55 * clamp(Math.abs(vForward) / 34, 0, 1);
  const targetSteer = clamp(input.steer || 0, -1, 1) * CAR.MAX_STEER * speedLockScale;
  car.steer = approach(car.steer, targetSteer, CAR.STEER_SPEED, dt);

  // bicycle-model yaw rate (only turns when rolling). Heading turns AFTER the
  // velocity is set, so next step it reads as slip.
  const yawRate = (vForward / CAR.WHEELBASE) * Math.tan(car.steer);
  car.yaw += yawRate * dt;

  // integrate position
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  car.speed = vForward;
  car.slip = Math.abs(vLateral);
}

// Interpolated render transform between prev and current state (§12).
// Writes into `out` (a plain {x,z,yaw,steer}) to avoid allocation.
export function interpCar(car, alpha, out) {
  // shortest-arc yaw interpolation
  let dyaw = car.yaw - car.prevYaw;
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  out.x = car.prevX + (car.x - car.prevX) * alpha;
  out.z = car.prevZ + (car.z - car.prevZ) * alpha;
  out.yaw = car.prevYaw + dyaw * alpha;
  out.steer = car.prevSteer + (car.steer - car.prevSteer) * alpha;
  return out;
}
