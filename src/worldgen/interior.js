// §17 (re-decided) — Interiors, GTA III style: a separate loaded cell behind a
// door. Now SIZED TO THE BUILDING (its real footprint) and MULTI-FLOOR (its real
// floor count), with an elevator to move between floors.
//
// The player sim is 2D (x,z at ground level), so a skyscraper isn't one 3D
// volume — it's N flat rooms, one per floor, and the elevator switches which
// floor you're standing in. generateInterior() builds ONE floor on demand; the
// app rebuilds it when you take the elevator. Pure and deterministic.
//
// Room centred at origin: x ∈ [-W/2, W/2], z ∈ [-D/2, D/2], y 0..H. The entrance
// door/exit is the front wall (z = -D/2), on floor 0 only. The elevator is a
// shaft in the back-right corner, present on every floor.

import { MeshBuilder } from '../render/meshbuilder.js';
import { hash, unit } from '../core/hash.js';

const FLOOR_H = 3.2;
const FLOOR_WOOD = [0.29, 0.22, 0.15];
const FLOOR_TILE = [0.38, 0.4, 0.41];
const CARPET = [0.34, 0.26, 0.24];
const WALL = [0.58, 0.54, 0.48];
const CEIL = [0.4, 0.38, 0.34];
const DESK = [0.36, 0.27, 0.18];
const METAL = [0.44, 0.47, 0.5];
const LIFT = [0.5, 0.53, 0.56];
const COUNTER = [0.32, 0.25, 0.17];
const SHELF = [0.34, 0.26, 0.17];
const BED = [0.5, 0.44, 0.38];
const SOFA = [0.32, 0.36, 0.32];
const VAULT = [0.28, 0.32, 0.35];
const WOODDK = [0.22, 0.16, 0.11];
const GOODS = [[0.62, 0.32, 0.26], [0.32, 0.42, 0.52], [0.72, 0.62, 0.32], [0.42, 0.52, 0.42]];
const PLANT = [0.24, 0.36, 0.22];
const POT = [0.3, 0.22, 0.16];
const WATER = [0.32, 0.44, 0.52];
const CABINET = [0.42, 0.44, 0.46];
const PARTITION = [0.46, 0.44, 0.4];
const SCREEN = [0.09, 0.11, 0.13];

const LABEL = { office: 'Office', shop: 'Shop', apartment: 'Apartment', house: 'House', bank: 'Bank' };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function solid(mb, col, x, y, z, w, h, d, color) {
  mb.box(x, y + h / 2, z, w, h, d, color);
  if (col) col.push({ x, z, hw: w / 2 + 0.12, hd: d / 2 + 0.12 });
}

// a potted plant — decorative, blocks the player a little
function plant(mb, col, x, z) {
  mb.box(x, 0.2, z, 0.5, 0.4, 0.5, POT);
  mb.box(x, 0.85, z, 0.75, 0.9, 0.75, PLANT);
  if (col) col.push({ x, z, hw: 0.4, hd: 0.4 });
}

// a desk with a monitor and a chair tucked in
function workstation(mb, col, x, z, face) {
  solid(mb, col, x, 0, z, 1.7, 0.72, 0.9, DESK);
  mb.box(x, 0.8, z, 1.4, 0.05, 0.7, METAL); // desktop
  mb.box(x - 0.35, 1.02, z - 0.15 * face, 0.55, 0.4, 0.05, SCREEN); // monitor
  mb.box(x, 0.36, z + 0.85 * face, 0.5, 0.72, 0.5, METAL); // chair
}

// opts: { w, d, floors, floor }
export function generateInterior(seed, type = 'house', opts = {}) {
  seed = seed >>> 0;
  const floors = Math.max(1, opts.floors || 1);
  const fl = clamp(opts.floor || 0, 0, floors - 1);
  const W = clamp(opts.w || 12, 9, 46);
  const D = clamp(opts.d || 10, 9, 46);
  const H = FLOOR_H;
  const hw = W / 2;
  const hd = D / 2;
  const t = 0.25;
  const floorCol = type === 'apartment' || type === 'house' ? FLOOR_WOOD : FLOOR_TILE;
  const mb = new MeshBuilder();
  const col = [];
  const R = (salt) => unit(hash(seed, fl, salt));

  // shell
  mb.plane(0, 0, W, D, 0, floorCol);
  mb.box(0, H + 0.1, 0, W, 0.2, D, CEIL, true);
  solid(mb, col, 0, 0, hd, W, H, t, WALL); // back
  solid(mb, col, -hw, 0, 0, t, H, D, WALL); // left
  solid(mb, col, hw, 0, 0, t, H, D, WALL); // right
  // front wall: solid on upper floors; door gap on the ground floor
  const isGround = fl === 0;
  if (isGround) {
    const gap = 1.6;
    const seg = (W - gap) / 2;
    solid(mb, col, -(gap / 2 + seg / 2), 0, -hd, seg, H, t, WALL);
    solid(mb, col, gap / 2 + seg / 2, 0, -hd, seg, H, t, WALL);
  } else {
    solid(mb, col, 0, 0, -hd, W, H, t, WALL);
  }

  // elevator shaft in the back-right corner (present on every floor)
  const ex = hw - 1.7;
  const ez = hd - 1.7;
  solid(mb, col, ex, 0, ez, 2.4, H, 2.4, LIFT); // shaft (solid)
  mb.box(ex - 1.25, H * 0.42, ez, 0.08, 1.9, 1.3, METAL); // lift doors (front face)
  const elevator = { x: ex - 2.6, z: ez }; // stand here to call the lift

  // usable region (avoid walls, elevator corner, entrance strip)
  const usable = (x, z) => {
    if (x < -hw + 1.2 || x > hw - 1.2 || z < -hd + 1.2 || z > hd - 1.2) return false;
    if (x > ex - 3.4 && z > ez - 3.4) return false; // elevator corner
    if (isGround && Math.abs(x) < 1.6 && z < -hd + 3.2) return false; // doorway
    return true;
  };

  if (type === 'office') {
    // ground floor gets a reception counter + waiting area near the entrance
    if (isGround) {
      solid(mb, col, 0, 0, -hd + 3.4, Math.min(W - 6, 7), 1.05, 1.0, COUNTER);
      solid(mb, col, -hw + 2.2, 0, -hd + 2.2, 2.6, 0.7, 0.9, SOFA);
      plant(mb, col, hw - 1.4, -hd + 1.8);
    }
    // cubicle rows: desks in facing pairs with a low partition down the middle
    const z0 = -hd + (isGround ? 6.6 : 3.4);
    for (let z = z0; z < hd - 2.4; z += 3.6) {
      // a partition wall runs the length of the row (skip the elevator corner)
      const partEnd = Math.min(ex - 3.6, hw - 1.6);
      if (usable(0, z)) mb.box((-hw + 2.4 + partEnd) / 2, 0.85, z, partEnd - (-hw + 2.4), 1.3, 0.09, PARTITION);
      for (let x = -hw + 2.6; x < ex - 3.6; x += 2.5) {
        if (usable(x, z - 1)) workstation(mb, col, x, z - 1, -1); // facing -z
        if (usable(x, z + 1)) workstation(mb, col, x, z + 1, +1); // facing +z
      }
    }
    // filing cabinets along the left wall, a water cooler, corner plants
    for (let z = -hd + 3; z < hd - 2.4; z += 1.5) {
      if (usable(-hw + 1.3, z)) solid(mb, col, -hw + 0.9, 0, z, 0.7, 1.3, 1.2, CABINET);
    }
    if (usable(-hw + 2.2, hd - 2.0)) {
      solid(mb, col, -hw + 2.0, 0, hd - 1.6, 0.5, 1.25, 0.5, WATER); // water cooler
    }
    plant(mb, col, -hw + 1.6, hd - 1.6);
    if (!isGround && unit(hash(seed, fl, 'meet')) > 0.45 && usable(hw - 3.2, hd - 4.0)) {
      // a small meeting table with chairs on upper floors, sometimes
      solid(mb, col, ex - 5.0, 0, hd - 4.2, 2.4, 0.75, 1.4, DESK);
      mb.box(ex - 5.0, 0.36, hd - 5.2, 0.5, 0.72, 0.5, METAL);
      mb.box(ex - 5.0, 0.36, hd - 3.2, 0.5, 0.72, 0.5, METAL);
    }
  } else if (type === 'shop') {
    if (isGround) solid(mb, col, 0, 0, -hd + 3.4, Math.min(W - 4, 8), 1.0, 0.8, COUNTER);
    // shelves along the back and side walls
    for (let x = -hw + 1.6; x < ex - 3.6; x += 3.0) {
      solid(mb, col, x, 0, hd - 1.1, 1.4, 2.2, 0.5, SHELF);
      for (let g = 0; g < 3; g++) mb.box(x, 0.6 + g * 0.7, hd - 1.1, 1.0, 0.28, 0.35, GOODS[((g + (x | 0)) % GOODS.length + GOODS.length) % GOODS.length]);
    }
    for (let z = -hd + 3.5; z < hd - 2.5; z += 3.4) {
      solid(mb, col, -hw + 1.1, 0, z, 0.5, 2.0, 1.4, SHELF);
    }
  } else if (type === 'bank') {
    if (isGround) {
      solid(mb, col, 0, 0, 1.0, Math.min(W - 3, 12), 1.1, 1.2, COUNTER);
      solid(mb, col, -hw + 2.4, 0, -hd + 2.6, 3.6, H - 0.6, 2.0, VAULT); // vault (front-left)
      mb.box(-hw + 2.4, (H - 0.6) / 2, -hd + 1.55, 1.8, 1.8, 0.15, METAL);
    } else {
      for (let x = -hw + 3; x < hw - 2; x += 4.2) if (usable(x, 0)) solid(mb, col, x, 0, 0, 1.7, 0.75, 0.9, DESK);
    }
  } else {
    // apartment / house — a few furnished pieces, scaled to the room
    solid(mb, col, -hw + 2.6, 0, hd - 2.0, 3.2, 0.6, 2.0, BED);
    mb.plane(-hw + 3, 0, Math.min(4, W - 3), 3, 0.02, CARPET);
    solid(mb, col, 0, 0, -hd + 3.0, 1.8, 0.8, 1.2, DESK); // table
    solid(mb, col, hw - 3.6, 0, hd - 1.4, 2.8, 0.8, 0.9, SOFA);
    solid(mb, col, hw - 0.7, 0, -1, 0.6, 2.0, Math.min(D - 5, 5), WOODDK); // wardrobe
  }

  const geo = mb.build();
  return {
    seed, type, floor: fl, floors, label: LABEL[type] || 'Room',
    positions: geo.positions, normals: geo.normals, colors: geo.colors, indices: geo.indices,
    colliders: col,
    spawn: { x: 0, z: -hd + 1.2, yaw: 0 },
    exit: { x: 0, z: -hd + 1.0 },
    elevator,
    size: { W, D, H },
    stats: { triangles: geo.triangles },
  };
}
