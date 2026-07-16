// §8 — Floating origin. The section whose absence is why the full map glitched
// while the beta city was fine.
//
// float32 has 24 bits of mantissa. At 128 km: 128000 / 2^23 ≈ 1.5 cm. Vertices
// jitter, the depth buffer fights itself, physics integration accumulates error
// every step. It works near the origin and falls apart the moment you drive away.
//
// The fix: keep the player within ~250–1000 m of (0,0,0) and MOVE THE WORLD.
//
// HARD RULE 9: Nothing that renders or simulates may store an absolute world
// coordinate. Everything is local. Absolute coords exist only in:
//   - the build-time world index (§4), which is data, not simulation
//   - the save delta map (§13), which is hashed, not positional
//   - `origin`, which is the one place allowed to know
// Convert at the boundary: world = local + origin.

// Rebase once the player drifts this far from the local origin. Comfortably
// inside the ~250–1000 m safe band, with headroom before float precision bites.
export const REBASE_AT = 500; // m

// The one place allowed to know the absolute offset. `count` is exposed for
// tests/telemetry: it should climb steadily as you drive, never in bursts.
export const origin = { x: 0, z: 0, count: 0 };

// Reset the origin (new game / load / test isolation).
export function resetOrigin(x = 0, z = 0) {
  origin.x = x;
  origin.z = z;
  origin.count = 0;
}

// local coord -> absolute world coord. Use this ONLY at the boundary (§8):
// looking up which region/city a local point sits in, writing a save hash, etc.
export function toWorld(localX, localZ) {
  return { x: localX + origin.x, z: localZ + origin.z };
}

// absolute world coord -> local coord. The inverse boundary conversion — e.g.
// placing a world-index city relative to the current origin so it can render.
export function toLocal(worldX, worldZ) {
  return { x: worldX - origin.x, z: worldZ - origin.z };
}

// Call once per sim step, AFTER integrating the car, BEFORE rendering.
//
// `car` carries local coordinates {x, z}. `scene` is anything with a mutable
// {position:{x,z}} — the three.js world root. When the car strays past REBASE_AT
// we fold its offset into `origin`, shove the whole world the opposite way, and
// snap the car back to (0,0). Nothing visibly moves; the numbers just get small
// again. Returns true if a rebase happened (handy for invalidating caches).
//
// Kept allocation-free (HARD RULE 3): mutates in place, returns a boolean.
export function rebaseIfNeeded(car, scene) {
  if (Math.hypot(car.x, car.z) < REBASE_AT) return false;
  origin.x += car.x;
  origin.z += car.z;
  if (scene && scene.position) {
    scene.position.x -= car.x;
    scene.position.z -= car.z;
  }
  car.x = 0;
  car.z = 0;
  origin.count++;
  return true;
}
