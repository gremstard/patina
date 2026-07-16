// §12 — The vehicle, as a pure deterministic sim. SIMPLE on-rails handling:
// W/S move along the car's path, steering CURVES the path (no sideways slip, no
// drift). The velocity is always exactly along the heading — turning redirects
// it instantly. This is the "change the path, don't push the car sideways" feel.
//
// No three.js, no DOM. Stepped at a FIXED DT by an accumulator (§12), on INPUT
// {throttle, steer, brake} not positions (the multiplayer shape). Mutates in
// place (hard rule 3). No global RNG.
//
// Coordinates are the render-local frame (§8). Velocity is kept as (vx,vz) so the
// collision resolver can cancel the into-wall component; each step re-derives
// forward speed from it (any lateral part a collision introduced is dropped —
// that is what keeps the car on rails).

export const CAR = {
  ACCEL: 13, // m/s^2 under throttle
  BRAKE: 24, // m/s^2 under brake (while moving forward)
  REVERSE_MAX: 8, // m/s cap in reverse
  MAX_SPEED: 34, // m/s (~122 km/h)
  FRICTION: 6, // m/s^2 coast-down when off the pedals
  TURN: 1.55, // rad/s at full lock and full authority
  TURN_FULL_SPEED: 9, // m/s at which steering reaches full authority
  STEER_EASE: 5.0, // how fast the wheel approaches the input (1/s)
};

// The chase camera looks along +z, which flips screen left/right versus the
// math. -1 makes "steer right" curve right ON SCREEN. Flip here if it ever feels
// inverted again — one place, not scattered.
const STEER_SIGN = -1;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (cur, target, rate, dt) => {
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
};

export function createCar(x = 0, z = 0, yaw = 0) {
  return {
    x, z, yaw,
    vx: 0, vz: 0,
    steer: 0,
    speed: 0,
    slip: 0, // always 0 now (kept so HUD/tests referencing it don't break)
    prevX: x, prevZ: z, prevYaw: yaw, prevSteer: 0,
  };
}

// input: {throttle, brake, steer:-1..1}
export function stepCar(car, input, dt) {
  car.prevX = car.x;
  car.prevZ = car.z;
  car.prevYaw = car.yaw;
  car.prevSteer = car.steer;

  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);

  // forward speed re-derived from velocity, so a collision's velocity change
  // carries over and any lateral component is discarded (on rails, no slip)
  let speed = car.vx * fx + car.vz * fz;

  if (input.throttle) speed += CAR.ACCEL * dt;
  else if (input.brake) speed -= (speed > 0.2 ? CAR.BRAKE : CAR.ACCEL * 0.6) * dt;
  else {
    // coast toward 0
    const f = CAR.FRICTION * dt;
    speed = speed > 0 ? Math.max(0, speed - f) : Math.min(0, speed + f);
  }
  speed = clamp(speed, -CAR.REVERSE_MAX, CAR.MAX_SPEED);

  // steer wheel eases toward input; authority grows with speed and flips in
  // reverse (like a real car backing up)
  car.steer = approach(car.steer, clamp(input.steer || 0, -1, 1), CAR.STEER_EASE, dt);
  const authority = clamp(Math.abs(speed) / CAR.TURN_FULL_SPEED, 0, 1) * Math.sign(speed);
  car.yaw += STEER_SIGN * car.steer * CAR.TURN * authority * dt;

  // velocity strictly along the NEW heading → the path curved, nothing slid
  const nfx = Math.sin(car.yaw);
  const nfz = Math.cos(car.yaw);
  car.vx = nfx * speed;
  car.vz = nfz * speed;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  car.speed = speed;
  car.slip = 0;
}

// Interpolated render transform between prev and current state (§12).
export function interpCar(car, alpha, out) {
  let dyaw = car.yaw - car.prevYaw;
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  out.x = car.prevX + (car.x - car.prevX) * alpha;
  out.z = car.prevZ + (car.z - car.prevZ) * alpha;
  out.yaw = car.prevYaw + dyaw * alpha;
  out.steer = car.prevSteer + (car.steer - car.prevSteer) * alpha;
  return out;
}
