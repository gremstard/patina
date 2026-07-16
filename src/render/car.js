// The car — a rusted hatchback from primitives (§10). Built once into one merged
// geometry (typed arrays, no three.js), so it renders in a single draw call and
// stays consistent with the box/plane/gable vocabulary. Faces +z (yaw 0).
//
// About 4.0 m long, 1.8 m wide; the mesh origin sits on the ground so wheels
// touch y=0. Rust is the whole point of the game, so the body is oxidized and
// blotchy rather than clean.

import { MeshBuilder } from './meshbuilder.js';

const RUST = [0.44, 0.22, 0.16];
const RUST_2 = [0.38, 0.19, 0.15];
const RUST_DK = [0.26, 0.14, 0.12];
const GLASS = [0.07, 0.09, 0.11];
const TIRE = [0.05, 0.05, 0.06];
const CHROME = [0.30, 0.31, 0.33];
const HEAD = [0.85, 0.82, 0.6];
const TAIL = [0.5, 0.08, 0.07];

export function buildCar() {
  const mb = new MeshBuilder();

  // wheels first (dark), at the four corners, half-sunk so they read as round-ish
  const wx = 0.86;
  const wz = 1.32;
  const wy = 0.34;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      mb.box(sx * wx, wy, sz * wz, 0.34, 0.66, 0.7, TIRE);
    }
  }

  // chassis (lower body)
  mb.box(0, 0.62, 0, 1.72, 0.62, 3.9, RUST);
  // sills / rocker shade
  mb.box(0, 0.4, 0, 1.78, 0.2, 3.7, RUST_DK);
  // hood (front, +z) slightly lower than cabin
  mb.box(0, 0.9, 1.15, 1.62, 0.16, 1.5, RUST_2);
  // rear hatch deck
  mb.box(0, 0.9, -1.35, 1.62, 0.16, 1.1, RUST_2);

  // cabin — pulled in, sat back a touch
  mb.box(0, 1.16, -0.15, 1.5, 0.62, 2.0, RUST);
  // window band (dark), slightly proud of the cabin sides
  mb.box(0, 1.2, -0.15, 1.54, 0.36, 1.7, GLASS);
  // roof cap over the glass
  mb.box(0, 1.44, -0.2, 1.44, 0.12, 1.7, RUST_2);

  // bumpers
  mb.box(0, 0.42, 1.98, 1.7, 0.28, 0.22, CHROME);
  mb.box(0, 0.42, -1.98, 1.7, 0.28, 0.22, CHROME);

  // lights
  mb.box(-0.6, 0.66, 2.02, 0.34, 0.2, 0.08, HEAD);
  mb.box(0.6, 0.66, 2.02, 0.34, 0.2, 0.08, HEAD);
  mb.box(-0.62, 0.7, -2.02, 0.3, 0.22, 0.08, TAIL);
  mb.box(0.62, 0.7, -2.02, 0.3, 0.22, 0.08, TAIL);

  return mb.build();
}
