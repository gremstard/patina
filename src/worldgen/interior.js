// §17 (re-decided) — Interiors, GTA III style: "separate loaded cells behind a
// door, not rooms in the world." A door hands us a seed and a type; this builds
// the whole interior cell as one merged geometry + colliders. Pure and
// deterministic — the same door always opens the same room.
//
// One room per building for now, furnished by type. Coordinates: room centred at
// origin, x ∈ [-W/2, W/2], z ∈ [-D/2, D/2], y 0..H. The door/exit is the front
// wall (z = -D/2); the player spawns just inside facing +z.

import { MeshBuilder } from '../render/meshbuilder.js';
import { hash, unit } from '../core/hash.js';

const FLOOR_WOOD = [0.29, 0.22, 0.15];
const FLOOR_TILE = [0.36, 0.38, 0.39];
const CARPET = [0.34, 0.26, 0.24];
const WALL = [0.54, 0.5, 0.45];
const CEIL = [0.36, 0.34, 0.3];
const DESK = [0.34, 0.26, 0.17];
const METAL = [0.4, 0.43, 0.46];
const COUNTER = [0.3, 0.24, 0.17];
const SHELF = [0.32, 0.25, 0.16];
const BED = [0.45, 0.4, 0.35];
const SOFA = [0.3, 0.34, 0.3];
const VAULT = [0.22, 0.26, 0.29];
const WOODDK = [0.2, 0.15, 0.1];
const GOODS = [[0.6, 0.3, 0.24], [0.3, 0.4, 0.5], [0.7, 0.6, 0.3], [0.4, 0.5, 0.4]];

const SPEC = {
  office: { w: 15, d: 12, h: 3.2, floor: FLOOR_TILE, label: 'Office' },
  shop: { w: 13, d: 11, h: 3.4, floor: FLOOR_TILE, label: 'Shop' },
  apartment: { w: 11, d: 9, h: 2.9, floor: FLOOR_WOOD, label: 'Apartment' },
  house: { w: 12, d: 10, h: 2.9, floor: FLOOR_WOOD, label: 'House' },
  bank: { w: 17, d: 13, h: 4.0, floor: FLOOR_TILE, label: 'Bank' },
};

// a solid box that is both drawn and (optionally) a collider
function solid(mb, col, x, y, z, w, h, d, color) {
  mb.box(x, y + h / 2, z, w, h, d, color);
  if (col) col.push({ x, z, hw: w / 2 + 0.15, hd: d / 2 + 0.15 });
}

export function generateInterior(seed, type = 'house') {
  seed = seed >>> 0;
  const sp = SPEC[type] || SPEC.house;
  const W = sp.w;
  const D = sp.d;
  const H = sp.h;
  const mb = new MeshBuilder();
  const col = [];
  const hw = W / 2;
  const hd = D / 2;
  const t = 0.25; // wall thickness

  // shell: floor, ceiling, four walls (walls are colliders)
  mb.plane(0, 0, W, D, 0, sp.floor);
  mb.box(0, H + 0.1, 0, W, 0.2, D, CEIL, true);
  solid(mb, col, 0, 0, hd, W, H, t, WALL); // back (+z)
  solid(mb, col, -hw, 0, 0, t, H, D, WALL); // left
  solid(mb, col, hw, 0, 0, t, H, D, WALL); // right
  // front wall in two pieces, leaving a door gap in the middle
  const gap = 1.5;
  solid(mb, col, -(hw + gap / 2) / 2 - gap / 4, 0, -hd, hw - gap / 2, H, t, WALL);
  solid(mb, col, (hw + gap / 2) / 2 + gap / 4, 0, -hd, hw - gap / 2, H, t, WALL);

  const R = (salt) => unit(hash(seed, salt));

  if (type === 'office') {
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const x = -hw + 3 + c * 4;
        const z = -hd + 4 + r * 4;
        solid(mb, col, x, 0, z, 1.7, 0.75, 0.9, DESK);
        mb.box(x, 0.82, z, 1.2, 0.05, 0.6, METAL); // monitor/desk top
        solid(mb, null, x, 0, z - 1.0, 0.5, 0.9, 0.5, METAL); // chair
      }
    }
  } else if (type === 'shop') {
    solid(mb, col, 0, 0, -hd + 3.2, W - 4, 1.0, 0.8, COUNTER); // service counter
    for (let s = 0; s < 4; s++) {
      const x = -hw + 1.2 + s * ((W - 2.4) / 3);
      solid(mb, col, x, 0, hd - 1.2, 1.4, 2.2, 0.6, SHELF); // shelves on back wall
      for (let g = 0; g < 3; g++) mb.box(x, 0.6 + g * 0.7, hd - 1.2, 1.0, 0.3, 0.4, GOODS[(g + s) % GOODS.length]);
    }
  } else if (type === 'bank') {
    solid(mb, col, 0, 0, 1.0, W - 3, 1.1, 1.2, COUNTER); // teller counter across
    for (let i = 0; i < 4; i++) mb.box(-hw + 3 + i * 3, 1.6, 1.0, 0.1, 1.0, 0.1, METAL); // teller posts
    solid(mb, col, hw - 2.4, 0, hd - 1.6, 3.6, H - 0.6, 2.0, VAULT); // the vault
    mb.box(hw - 2.4, (H - 0.6) / 2, hd - 2.55, 1.8, 1.8, 0.15, METAL); // vault door
  } else {
    // apartment / house
    mb.plane(-hw + 3, 0, 4, 3, 0.02, CARPET); // rug
    solid(mb, col, -hw + 2.6, 0, hd - 2.0, 3.4, 0.6, 2.0, BED); // bed
    solid(mb, col, hw - 2.4, 0, -hd + 3.4, 1.6, 0.8, 1.2, DESK); // table
    solid(mb, col, hw - 3.2, 0, hd - 1.3, 2.6, 0.8, 0.9, SOFA); // sofa
    solid(mb, col, hw - 0.6, 0, 0, 0.6, 2.0, D - 4, WOODDK); // wardrobe against wall
  }

  const geo = mb.build();
  return {
    seed, type, label: sp.label,
    positions: geo.positions, normals: geo.normals, colors: geo.colors, indices: geo.indices,
    colliders: col,
    spawn: { x: 0, z: -hd + 1.2, yaw: 0 },
    exit: { x: 0, z: -hd + 1.0 },
    size: { W, D, H },
    stats: { triangles: geo.triangles },
  };
}
