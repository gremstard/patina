// Cars from primitives (§10), in a few body types and many faded colours.
//
// Bodies are built in TINTABLE greys: panels ~1.0 (white), trim darker, and the
// wheels/glass near-black so they survive tinting. The colour comes from either
// the instance colour (parked cars = one InstancedMesh per type, per-instance
// colour) or the material colour (the car you drive) — three multiplies both
// into the vertex colour. So a whole city of varied cars stays a handful of draw
// calls, and the car you get into matches the one you took.
//
// Every type faces +z, ~4 m long, mesh origin on the ground (wheels touch y=0).

import { MeshBuilder } from './meshbuilder.js';

const PANEL = [1.0, 1.0, 1.0]; // tinted to the car colour
const PANEL2 = [0.72, 0.72, 0.72];
const TRIM = [0.42, 0.42, 0.42];
const GLASS = [0.11, 0.12, 0.14];
const TIRE = [0.05, 0.05, 0.06];
const BUMP = [0.34, 0.35, 0.37];
const LIGHT = [0.95, 0.92, 0.7];
const TAIL = [0.6, 0.12, 0.1];

// Faded / oxidized car colours — the game is about patina. These multiply the
// (white) panels, so they read as the body colour with the trim a shade darker.
export const CAR_COLORS = [
  [0.72, 0.33, 0.24], // rust red
  [0.30, 0.38, 0.50], // faded blue
  [0.80, 0.64, 0.31], // mustard
  [0.80, 0.76, 0.63], // cream
  [0.37, 0.50, 0.46], // teal
  [0.44, 0.44, 0.25], // olive
  [0.44, 0.19, 0.19], // maroon
  [0.55, 0.57, 0.58], // primer grey
  [0.61, 0.52, 0.39], // tan
  [0.79, 0.44, 0.21], // oxide orange
];

export const CAR_TYPES = ['hatch', 'sedan', 'van', 'pickup'];

function wheels(mb, wx, wz, wy = 0.34, r = 0.34) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(sx * wx, wy, sz * wz, 0.34, r * 2, 0.72, TIRE);
}
function lights(mb, hw, frontZ, backZ) {
  mb.box(-hw + 0.28, 0.62, frontZ, 0.32, 0.2, 0.06, LIGHT);
  mb.box(hw - 0.28, 0.62, frontZ, 0.32, 0.2, 0.06, LIGHT);
  mb.box(-hw + 0.3, 0.66, backZ, 0.3, 0.2, 0.06, TAIL);
  mb.box(hw - 0.3, 0.66, backZ, 0.3, 0.2, 0.06, TAIL);
  mb.box(0, 0.42, frontZ + 0.03, hw * 2 - 0.3, 0.26, 0.16, BUMP);
  mb.box(0, 0.42, backZ - 0.03, hw * 2 - 0.3, 0.26, 0.16, BUMP);
}

function hatch(mb) {
  const hw = 0.86;
  wheels(mb, hw, 1.3);
  mb.box(0, 0.4, 0, 1.78, 0.2, 3.7, TRIM);
  mb.box(0, 0.62, 0, 1.72, 0.62, 3.9, PANEL);
  mb.box(0, 0.9, 1.15, 1.62, 0.16, 1.5, PANEL2);
  mb.box(0, 1.16, -0.15, 1.5, 0.62, 2.0, PANEL);
  mb.box(0, 1.2, -0.15, 1.54, 0.36, 1.7, GLASS);
  mb.box(0, 1.44, -0.2, 1.44, 0.12, 1.7, PANEL2);
  lights(mb, hw, 1.98, -1.98);
}

function sedan(mb) {
  const hw = 0.88;
  wheels(mb, hw, 1.5);
  mb.box(0, 0.4, 0, 1.82, 0.2, 4.3, TRIM);
  mb.box(0, 0.6, 0, 1.76, 0.6, 4.5, PANEL);
  mb.box(0, 0.86, 1.5, 1.66, 0.2, 1.3, PANEL2); // hood
  mb.box(0, 0.86, -1.6, 1.66, 0.2, 1.1, PANEL2); // boot
  mb.box(0, 1.12, 0.0, 1.54, 0.6, 1.9, PANEL); // cabin
  mb.box(0, 1.16, 0.0, 1.58, 0.36, 1.6, GLASS);
  mb.box(0, 1.4, 0.0, 1.48, 0.12, 1.6, PANEL2);
  lights(mb, hw, 2.28, -2.28);
}

function van(mb) {
  const hw = 0.92;
  wheels(mb, hw, 1.5, 0.36, 0.36);
  mb.box(0, 0.44, 0, 1.9, 0.22, 4.3, TRIM);
  mb.box(0, 1.02, -0.1, 1.84, 1.5, 4.1, PANEL); // tall boxy body
  mb.box(0, 1.3, 1.6, 1.7, 0.7, 0.9, GLASS); // windscreen
  mb.box(0, 1.5, -0.1, 1.72, 0.5, 3.2, GLASS); // side windows band
  mb.box(0, 1.78, -0.1, 1.86, 0.12, 4.0, PANEL2); // roof
  lights(mb, hw, 2.14, -2.14);
}

function pickup(mb) {
  const hw = 0.9;
  wheels(mb, hw, 1.55, 0.38, 0.38);
  mb.box(0, 0.44, 0, 1.86, 0.22, 4.4, TRIM);
  mb.box(0, 0.66, 0, 1.8, 0.68, 4.4, PANEL); // chassis
  mb.box(0, 1.16, 1.05, 1.66, 0.66, 1.5, PANEL); // cab
  mb.box(0, 1.2, 1.05, 1.56, 0.4, 1.2, GLASS);
  mb.box(0, 1.44, 1.05, 1.6, 0.12, 1.4, PANEL2);
  mb.box(0, 1.02, -1.3, 1.74, 0.44, 1.9, TRIM); // bed walls
  mb.box(0, 0.9, -1.3, 1.5, 0.16, 1.7, PANEL2); // bed floor
  lights(mb, hw, 2.24, -2.24);
}

const BUILDERS = { hatch, sedan, van, pickup };

// Geometry for one body type (typed arrays; instance/mesh colour supplies hue).
export function buildCarType(type) {
  const mb = new MeshBuilder();
  (BUILDERS[type] || hatch)(mb);
  return mb.build();
}

// Back-compat default (a plain rust hatchback) for anything not asking for variety.
export function buildCar() {
  return buildCarType('hatch');
}
