// Roadside / countryside props from primitives (§10). Trees are the big one —
// scattered across the connective tissue between cities, instanced (one draw
// call) and streamed in a bubble around the player (§1: "roadside junk").
//
// Origin at the base (y=0), faces any way (radially symmetric enough for PSX).

import { MeshBuilder } from './meshbuilder.js';

const TRUNK = [0.24, 0.17, 0.12];
const LEAF = [0.26, 0.36, 0.2];
const LEAF2 = [0.22, 0.31, 0.17];

export function buildTree() {
  const mb = new MeshBuilder();
  mb.box(0, 1.4, 0, 0.4, 2.8, 0.4, TRUNK); // trunk
  mb.box(0, 3.2, 0, 2.6, 2.2, 2.6, LEAF); // lower canopy
  mb.box(0, 4.4, 0, 1.9, 1.6, 1.9, LEAF2); // upper canopy
  return mb.build();
}
