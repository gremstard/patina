// The player on foot — a rigid segmented figure from primitives (§14: "Real PSX
// characters mostly weren't skinned … rigid segmented meshes. The shoulder gaps
// were the hardware, not a bug."). One merged geometry, ~1.8 m tall, FEET AT
// y=0 (§14 spawn bug: the ped origin is between the feet, not the centre — spawn
// the mesh at ground level and it stands, not sinks).

import { MeshBuilder } from './meshbuilder.js';
import { PED_H } from '../core/constants.js';

const SHIRT = [0.42, 0.30, 0.26];
const PANTS = [0.16, 0.17, 0.20];
const SKIN = [0.52, 0.38, 0.30];
const SHOE = [0.09, 0.08, 0.08];
const HAIR = [0.14, 0.11, 0.09];

export function buildPed() {
  const mb = new MeshBuilder();
  const H = PED_H; // 1.8

  // legs (feet at 0)
  for (const sx of [-1, 1]) {
    mb.box(sx * 0.13, 0.02, 0, 0.24, 0.04, 0.3, SHOE); // shoe
    mb.box(sx * 0.13, 0.42, 0, 0.2, 0.8, 0.22, PANTS); // leg
  }
  // torso
  mb.box(0, H * 0.63, 0, 0.5, 0.62, 0.3, SHIRT);
  // arms
  for (const sx of [-1, 1]) {
    mb.box(sx * 0.33, H * 0.63, 0, 0.16, 0.6, 0.2, SHIRT);
  }
  // head + hair
  mb.box(0, H * 0.92, 0, 0.26, 0.28, 0.26, SKIN);
  mb.box(0, H * 0.99, -0.02, 0.28, 0.14, 0.28, HAIR);

  return mb.build();
}
