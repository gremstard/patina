// The player on foot — a tank-style walker (Resident Evil / PSX-correct): W/S
// walk forward/back along facing, A/D turn the body in place. Pure and
// deterministic like the vehicle (§12), same fixed-DT step, velocity kept as
// (vx,vz) so the same collision resolver applies. No slip, no momentum tricks —
// walking should feel immediate.

export const PED = {
  WALK: 3.4, // m/s
  RUN: 6.2, // m/s with the run modifier held
  ACCEL: 22, // m/s^2 approach to target speed
  TURN: 2.7, // rad/s turn-in-place
};

// Match the vehicle's screen-right convention (camera looks +z).
const STEER_SIGN = -1;

const approach = (cur, target, rate, dt) => {
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
};

export function createPed(x = 0, z = 0, yaw = 0) {
  return {
    x, z, yaw,
    vx: 0, vz: 0,
    speed: 0,
    moving: 0, // 0..1 for a walk-cycle bob later
    prevX: x, prevZ: z, prevYaw: yaw,
  };
}

// input: {throttle(forward), brake(back), steer:-1..1, run}
export function stepPed(ped, input, dt) {
  ped.prevX = ped.x;
  ped.prevZ = ped.z;
  ped.prevYaw = ped.yaw;

  // turn in place (works at any speed)
  ped.yaw += STEER_SIGN * (input.steer || 0) * PED.TURN * dt;

  const fx = Math.sin(ped.yaw);
  const fz = Math.cos(ped.yaw);
  let speed = ped.vx * fx + ped.vz * fz;

  const top = input.run ? PED.RUN : PED.WALK;
  const target = input.throttle ? top : input.brake ? -PED.WALK * 0.6 : 0;
  speed = approach(speed, target, PED.ACCEL, dt);

  ped.vx = fx * speed;
  ped.vz = fz * speed;
  ped.x += ped.vx * dt;
  ped.z += ped.vz * dt;

  ped.speed = speed;
  ped.moving = Math.min(1, Math.abs(speed) / PED.WALK);
}

export function interpPed(ped, alpha, out) {
  let dyaw = ped.yaw - ped.prevYaw;
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  out.x = ped.prevX + (ped.x - ped.prevX) * alpha;
  out.z = ped.prevZ + (ped.z - ped.prevZ) * alpha;
  out.yaw = ped.prevYaw + dyaw * alpha;
  return out;
}
