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

const LABEL = {
  office: 'Office', shop: 'Shop', apartment: 'Apartment', house: 'House',
  bank: 'Bank', hotel: 'Hotel room', lobby: 'Lobby',
};
// Friendly name for the whole building (used by the "enter …" prompt).
export const BUILDING_LABEL = {
  office: 'office', store: 'store', shop: 'shop', mixed: 'mixed-use',
  mixed2: 'shops & flats', apartment: 'apartments', house: 'house',
  bank: 'bank', hotel: 'hotel',
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Jobs you can work, keyed by the room type you're standing in. pay is per shift;
// shift is seconds of work. (Bank tellers earn most; shop work least.)
const JOBS = {
  office: { role: 'Computer worker', pay: 16, shift: 3.2 },
  shop: { role: 'Shopkeeper', pay: 12, shift: 2.8 },
  bank: { role: 'Bank teller', pay: 26, shift: 3.8 },
  lobby: { role: 'Front desk clerk', pay: 15, shift: 3.2 },
};

// Interior floors come in a FIXED set of footprint side-lengths (multiples of the
// 2.5 m module), so an interior is always one of a small number of sizes — easy
// to author real floor assets for. A building's footprint snaps to the nearest.
export const FLOOR_SIZES = [12.5, 25, 37.5, 45]; // metres per side
const snapSize = (v) => FLOOR_SIZES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

// A building type spans several floors of different uses. Given the building
// type and which floor you're on, what room do you actually stand in? Anything
// that is already a plain room type (the test harness passes those) falls
// through unchanged.
export function floorType(btype, floor, floors) {
  const isGround = floor === 0;
  switch (btype) {
    case 'store': return 'shop';
    case 'bank': return isGround ? 'bank' : 'office';
    case 'hotel': return isGround ? 'lobby' : 'hotel';
    case 'apartment': return isGround && floors >= 4 ? 'lobby' : 'apartment';
    case 'house': return 'house';
    case 'mixed': {
      if (isGround) return 'shop';
      return floor <= Math.ceil(floors / 2) ? 'office' : 'apartment';
    }
    case 'mixed2': return isGround ? 'shop' : 'apartment';
    case 'office': return 'office';
    default: return btype; // already a room type
  }
}

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

// opts: { w, d, floors, floor }. `btype` is the whole building's type; the room
// you actually stand in depends on which floor it is (floorType).
export function generateInterior(seed, btype = 'house', opts = {}) {
  seed = seed >>> 0;
  const floors = Math.max(1, opts.floors || 1);
  const fl = clamp(opts.floor || 0, 0, floors - 1);
  const type = floorType(btype, fl, floors);
  const W = snapSize(clamp(opts.w || 12, 9, 46));
  const D = snapSize(clamp(opts.d || 10, 9, 46));
  const H = FLOOR_H;
  const hw = W / 2;
  const hd = D / 2;
  const t = 0.25;
  const soft = type === 'apartment' || type === 'house' || type === 'hotel';
  const floorCol = soft ? FLOOR_WOOD : FLOOR_TILE;
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
  } else if (type === 'lobby') {
    // an entrance lobby: reception desk at the back, a seating cluster, plants
    solid(mb, col, ex - 4.5, 0, hd - 1.4, Math.min(W - 5, 6), 1.05, 1.0, COUNTER);
    mb.plane(0, 0, Math.min(W - 4, 7), Math.min(D - 6, 6), 0.02, CARPET);
    solid(mb, col, -hw + 2.6, 0, 0.5, 2.8, 0.7, 0.9, SOFA);
    solid(mb, col, -hw + 2.6, 0, -2.2, 2.8, 0.7, 0.9, SOFA);
    solid(mb, col, -hw + 2.6, 0, -0.85, 1.1, 0.45, 1.1, DESK); // coffee table
    plant(mb, col, hw - 1.4, -hd + 1.8);
    plant(mb, col, -hw + 1.5, hd - 1.6);
  } else if (type === 'hotel') {
    // a hotel room: bed(s) against the back wall, nightstand, wardrobe, TV, desk
    const two = W >= 16;
    const bx = two ? -hw + 3.0 : 0;
    solid(mb, col, bx, 0, hd - 2.0, 3.0, 0.6, 2.4, BED);
    solid(mb, col, bx - 1.9, 0, hd - 1.2, 0.7, 0.5, 0.7, WOODDK); // nightstand
    if (two) solid(mb, col, hw - 3.0, 0, hd - 2.0, 3.0, 0.6, 2.4, BED);
    mb.plane(bx, 0, Math.min(4, W - 3), 3, 0.02, CARPET);
    solid(mb, col, -hw + 0.7, 0, -1, 0.6, 2.0, Math.min(D - 5, 4.5), WOODDK); // wardrobe
    solid(mb, col, 0, 0, -hd + 2.6, 1.6, 0.75, 0.7, DESK); // desk
    mb.box(0, 1.5, -hd + t + 0.06, 1.4, 0.85, 0.08, SCREEN); // wall-mounted TV
  } else {
    // apartment / house — a small home, scaled to the room
    solid(mb, col, -hw + 2.6, 0, hd - 2.0, 3.2, 0.6, 2.0, BED);
    mb.plane(-hw + 3, 0, Math.min(4, W - 3), 3, 0.02, CARPET);
    solid(mb, col, 0, 0, -hd + 3.0, 1.8, 0.8, 1.2, DESK); // dining table
    solid(mb, col, hw - 3.6, 0, hd - 1.4, 2.8, 0.8, 0.9, SOFA); // sofa
    solid(mb, col, hw - 0.7, 0, -1, 0.6, 2.0, Math.min(D - 5, 5), WOODDK); // wardrobe
    solid(mb, col, hw - 3.6, 0, -hd + 2.4, 1.2, 0.9, 1.0, SHELF); // kitchen counter
    plant(mb, col, -hw + 1.4, -hd + 1.8);
  }

  // A job station: a spot you can clock in and work a shift for pay. Only the
  // working room types have one (homes/hotel-rooms don't). The stand point is
  // clear floor beside the relevant fixture (counter / desk).
  let job = null;
  const jd = JOBS[type];
  if (jd) {
    let jx = -hw + 3.4; let jz = -hd + 4.4; // office: at a front desk
    if (type === 'shop') { jx = 0; jz = isGround ? -hd + 4.9 : -hd + 3.2; }
    else if (type === 'bank') { jx = 0; jz = 2.7; } // behind the teller counter
    else if (type === 'lobby') { jx = ex - 4.5; jz = hd - 3.0; } // in front of reception
    job = { role: jd.role, pay: jd.pay, shift: jd.shift, x: jx, z: jz };
    mb.box(jx, 1.05, jz, 0.5, 0.35, 0.4, SCREEN); // a little terminal marks the spot
    mb.box(jx, 0.72, jz, 0.7, 0.7, 0.6, DESK);
  }

  const geo = mb.build();
  return {
    seed, type, floor: fl, floors, label: LABEL[type] || 'Room',
    positions: geo.positions, normals: geo.normals, colors: geo.colors, indices: geo.indices,
    colliders: col,
    spawn: { x: 0, z: -hd + 1.2, yaw: 0 },
    exit: { x: 0, z: -hd + 1.0 },
    elevator, job,
    size: { W, D, H },
    stats: { triangles: geo.triangles },
  };
}
