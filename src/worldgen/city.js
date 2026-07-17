// §6 / §7 — One city, generated whole.
//
// §6 altitude: the street grid is generated for the WHOLE CITY AT ONCE from a
// zone-driven template, then blocks subdivide into lots, then lots assemble
// buildings from primitives (§10). §7 is the load-bearing part: streets AND
// buildings both come from rules(tier, zone), so a cul-de-sac and a 6-floor
// tower can never meet — the density gradient (core towers → ring → suburban
// edge) is structural, not decorative.
//
// Pure and worker-ready (hard rule 5): returns the transferable typed-array set
// from MeshBuilder plus plain-data stats. No three.js, no Math.random (§0).

import { CITY_R, FLOOR, BLOCK, CORRIDOR, SIDEWALK } from '../core/constants.js';
import { hash, unit } from '../core/hash.js';
import { zoneAt, rules } from '../core/zoning.js';
import { MeshBuilder } from '../render/meshbuilder.js';
import { SURFACE, wall, roof, shade } from '../render/palette.js';

const ROAD = CORRIDOR; // 12.5 m street corridor between blocks
const PITCH = BLOCK + ROAD; // 72.5 m block-to-block
// Buildings occupy the INNER block; the perimeter is a walkable sidewalk ring
// (the light concrete you see around the buildings, where peds walk).
const INNER = BLOCK - 2 * SIDEWALK; // 55 m

const floorsOf = (r, seed) => r.floors[0] + (hash(seed, 'fl') % (r.floors[1] - r.floors[0] + 1));

// A window (or door) quad proud of a facade, with the outward normal so it isn't
// backface-culled. face: 0 +x, 1 +z, 2 -x, 3 -z.
function panel(mb, x, y, z, face, w, h, col) {
  const hw = w / 2;
  const hh = h / 2;
  if (face === 0) mb.quad(x, y - hh, z + hw, x, y - hh, z - hw, x, y + hh, z - hw, x, y + hh, z + hw, ...col);
  else if (face === 2) mb.quad(x, y - hh, z - hw, x, y - hh, z + hw, x, y + hh, z + hw, x, y + hh, z - hw, ...col);
  else if (face === 1) mb.quad(x - hw, y - hh, z, x + hw, y - hh, z, x + hw, y + hh, z, x - hw, y + hh, z, ...col);
  else mb.quad(x + hw, y - hh, z, x - hw, y - hh, z, x - hw, y + hh, z, x + hw, y + hh, z, ...col);
}

// A sparse, representative set of windows on the four facades — enough to read
// as "windows" through 100 m of fog without exploding the merged-mesh triangle
// count / generation time (a whole metro is 9k buildings; full grids cost 7 s).
// Full window detail is a job for the Web-Worker streaming path (hard rule 5).
function facadeWindows(mb, cx, cz, fw, fd, floors) {
  const rows = Math.min(floors, 5);
  const perSide = 2; // at most two windows per facade per floor
  const nz = Math.min(perSide, Math.max(1, Math.round(fd / 7)));
  const nx = Math.min(perSide, Math.max(1, Math.round(fw / 7)));
  for (let f = 0; f < rows; f++) {
    const y = f * FLOOR + 1.3;
    for (let k = 0; k < nz; k++) {
      const z = cz - fd / 2 + (k + 0.5) * (fd / nz);
      panel(mb, cx + fw / 2 + 0.03, y, z, 0, 1.0, 1.3, SURFACE.window);
      panel(mb, cx - fw / 2 - 0.03, y, z, 2, 1.0, 1.3, SURFACE.window);
    }
    for (let k = 0; k < nx; k++) {
      const x = cx - fw / 2 + (k + 0.5) * (fw / nx);
      panel(mb, x, y, cz + fd / 2 + 0.03, 1, 1.0, 1.3, SURFACE.window);
      panel(mb, x, y, cz - fd / 2 - 0.03, 3, 1.0, 1.3, SURFACE.window);
    }
  }
}

const OUTDX = [1, 0, -1, 0];
const OUTDZ = [0, 1, 0, -1];
// Which KIND of building a door leads to, from the block's zoned lot type. The
// zone gives the dominant use (a tower core is mostly offices); a per-building
// hash sprinkles the mix real streets have — a hotel, a bank, mixed-use with
// shops below flats. The building type drives per-floor interiors (interior.js).
function buildingType(lot, seed) {
  const r = unit(hash(seed, 'btype'));
  if (lot === 'office') {
    // downtown towers: mostly offices, some hotels/mixed-use, a rare bank
    if (r < 0.06) return 'bank';
    if (r < 0.20) return 'hotel';
    if (r < 0.40) return 'mixed';   // shop / offices / flats stacked
    if (r < 0.52) return 'apartment';
    if (r < 0.60) return 'mixed2';  // shop below, flats above
    return 'office';
  }
  if (lot === 'store' || lot === 'mainstreet') {
    // shopping streets: mostly stores, some shop-and-flats, a rare bank/office
    if (r < 0.06) return 'bank';
    if (r < 0.28) return 'mixed2';
    if (r < 0.40) return 'mixed';
    if (r < 0.48) return 'office';
    return 'store';
  }
  if (lot === 'apartment') {
    // mid-rise ring: flats, some ground-floor shops, the odd hotel
    if (r < 0.16) return 'mixed2';
    if (r < 0.24) return 'hotel';
    return 'apartment';
  }
  return 'house'; // the suburbs — one family, 1-2 floors
}

// Door on the facade that faces the street (outward from the block centre) + an
// interactable door record for interiors. Carries the building's real footprint
// and floor count so the interior matches the building's size.
function addDoor(mb, doors, bx, bz, cx, cz, fw, fd, floors, seed, lot) {
  const ox = cx - bx;
  const oz = cz - bz;
  const face = Math.abs(ox) >= Math.abs(oz) ? (ox >= 0 ? 0 : 2) : (oz >= 0 ? 1 : 3);
  let dx = cx;
  let dz = cz;
  if (face === 0) dx = cx + fw / 2 + 0.04;
  else if (face === 2) dx = cx - fw / 2 - 0.04;
  else if (face === 1) dz = cz + fd / 2 + 0.04;
  else dz = cz - fd / 2 - 0.04;
  panel(mb, dx, 1.1, dz, face, 1.3, 2.2, SURFACE.door);
  doors.push({
    x: dx + OUTDX[face] * 0.9, z: dz + OUTDZ[face] * 0.9,
    yaw: Math.atan2(-OUTDX[face], -OUTDZ[face]), // face into the building
    seed: hash(seed, 'interior') >>> 0, btype: buildingType(lot, seed),
    w: fw, d: fd, floors,
  });
}

// Place one building mass with windows, a door, and its roof. fw/fd = footprint.
function placeBuilding(mb, col, doors, bx, bz, cx, cz, fw, fd, floors, roofType, palette, seed, maxH, lot) {
  const height = floors * FLOOR;
  const wc = shade(wall(palette, hash(seed, 'w')), 0.82 + 0.4 * unit(hash(seed, 'ws')));
  mb.box(cx, height / 2, cz, fw, height, fd, wc);
  col.push({ x: cx, z: cz, hw: fw / 2, hd: fd / 2 });
  facadeWindows(mb, cx, cz, fw, fd, floors);
  addDoor(mb, doors, bx, bz, cx, cz, fw, fd, floors, seed, lot);
  if (roofType === 'gable') {
    const rise = Math.min(Math.min(fw, fd) * (0.35 + 0.18 * unit(hash(seed, 'rr'))), FLOOR * 1.5);
    mb.gable(cx, height, cz, fw, fd, rise, roof(palette, hash(seed, 'r')));
    maxH.v = Math.max(maxH.v, height + rise);
  } else if (roofType === 'parapet') {
    mb.box(cx, height + 0.35, cz, fw + 0.4, 0.7, fd + 0.4, SURFACE.parapet);
    maxH.v = Math.max(maxH.v, height + 0.7);
  } else {
    maxH.v = Math.max(maxH.v, height);
  }
}

// Parked cars along a block's kerbs. Only the +x and +z edges are used so the
// two blocks sharing a street don't both fill it. Cars sit just off the kerb in
// the street, facing along it, with deterministic gaps (sparse & believable).
const CAR_LEN = 4.2;
const PARK_SLOT = CAR_LEN + 1.6;
function placeParking(park, bx, bz, seed) {
  const half = BLOCK / 2;
  const kerb = half + 1.1; // hug the kerb, leaving a clear driving lane mid-street
  const slots = Math.floor(BLOCK / PARK_SLOT); // ~ per edge
  // +x edge — cars face ±z (along the street)
  for (let s = 0; s < slots; s++) {
    const h = hash(seed, 'px', s);
    if (unit(h) < 0.9) continue; // sparse — don't wall off the street
    const along = -half + (s + 0.5) * PARK_SLOT;
    const yaw = h & 1 ? 0 : Math.PI;
    park.push({ x: bx + kerb, z: bz + along, yaw });
  }
  // +z edge — cars face ±x
  for (let s = 0; s < slots; s++) {
    const h = hash(seed, 'pz', s);
    if (unit(h) < 0.9) continue;
    const along = -half + (s + 0.5) * PARK_SLOT;
    const yaw = h & 1 ? Math.PI / 2 : -Math.PI / 2;
    park.push({ x: bx + along, z: bz + kerb, yaw });
  }
}

function placeTree(mb, x, z, seed) {
  const h = 2.2 + unit(hash(seed, 'th')) * 2.4;
  mb.box(x, h * 0.4, z, 0.32, h * 0.8, 0.32, SURFACE.trunk);
  mb.box(x, h, z, 1.7, 1.9, 1.7, shade(SURFACE.foliage, 0.85 + 0.3 * unit(hash(seed, 'tf'))));
}

// Attached masses — offices, stores, apartments, main-street rows (§7 lots that
// are NOT detached). Pack the block into a few masses with the zone's setback
// and roof. Never gabled, so wide spans stay flat/parapet — no barn roofs.
function massBlock(mb, col, doors, bx, bz, r, palette, seed, maxH) {
  const sb = r.setback;
  const nx = 1 + (hash(seed, 'nx') % 2);
  const nz = 1 + (hash(seed, 'nz') % 2);
  const cw = INNER / nx;
  const cd = INNER / nz;
  const roofType = r.roof === 'gable' ? 'flat' : r.roof; // safety: masses never gable
  let n = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const cx = bx - INNER / 2 + cw * (a + 0.5);
      const cz = bz - INNER / 2 + cd * (b + 0.5);
      const s = hash(seed, a, b);
      // 0-setback cores share walls (tiny reveal); set-back masses pull in.
      const fw = cw - Math.max(1, 2 * sb) + (sb === 0 ? 0.5 : 0);
      const fd = cd - Math.max(1, 2 * sb) + (sb === 0 ? 0.5 : 0);
      placeBuilding(mb, col, doors, bx, bz, cx, cz, fw, fd, floorsOf(r, s), roofType, palette, s, maxH, r.lot);
      n++;
    }
  }
  return n;
}

// Detached houses — the suburb. A sparse lot grid with gabled houses; the gaps
// ARE the density gradient. `emptyP` thins the edge more than the ring, so a
// town's ring reads as denser houses than its cul-de-sac edge (§7).
function houseBlock(mb, col, doors, bx, bz, zone, r, palette, seed, maxH) {
  const grid = 3;
  const lot = INNER / grid;
  const sb = Math.min(r.setback, lot * 0.26);
  const emptyP = zone === 'edge' ? 0.34 : 0.14;
  let n = 0;
  for (let a = 0; a < grid; a++) {
    for (let b = 0; b < grid; b++) {
      const s = hash(seed, a, b);
      if (unit(hash(s, 'empty')) < emptyP) continue;
      const cx = bx - INNER / 2 + lot * (a + 0.5);
      const cz = bz - INNER / 2 + lot * (b + 0.5);
      const fw = lot - 2 * sb;
      const fd = lot - 2 * sb;
      placeBuilding(mb, col, doors, bx, bz, cx, cz, fw, fd, floorsOf(r, s), 'gable', palette, s, maxH, r.lot);
      if (unit(hash(s, 'tree')) < 0.45) placeTree(mb, cx + lot * 0.32, cz + lot * 0.32, s);
      n++;
    }
  }
  return n;
}

// §7: the branch is `detached`, the doc's own flag — not the zone name. Town
// rings are detached houses; metro cores are attached towers. This is what
// keeps a cul-de-sac and six floors from ever meeting.
function buildBlock(mb, col, doors, bx, bz, zone, r, palette, seed, maxH) {
  return r.detached
    ? houseBlock(mb, col, doors, bx, bz, zone, r, palette, seed, maxH)
    : massBlock(mb, col, doors, bx, bz, r, palette, seed, maxH);
}

// Generate a whole city centred on local (0,0). `paletteKey` binds to naming
// culture (§9) — pass settlement.palette from the world index.
export function generateCity(citySeed, tier = 'city', paletteKey = 'greyconcrete') {
  citySeed = citySeed >>> 0;
  const R = CITY_R[tier];
  const mb = new MeshBuilder(); // structures — buildings, roofs, trees (snapped)
  const gb = new MeshBuilder(); // ground — scrub, roads, kerbs (NOT snapped: a
  //           huge flat quad warps badly under the vertex-snap shader, §3)
  const maxH = { v: 0 };

  // scrub ground under the whole thing
  const span = (R + PITCH) * 2.4;
  gb.plane(0, 0, span, span, -0.06, SURFACE.ground);

  const N = Math.ceil(R / PITCH) + 1;
  const colliders = []; // building footprints (city space) for the driving sim
  const park = []; // parked-car spots {x,z,yaw} along the kerbs
  const doors = []; // interactable building doors → interiors
  let blocks = 0;
  let buildings = 0;
  const zones = { core: 0, ring: 0, edge: 0 };

  for (let j = -N; j <= N; j++) {
    for (let i = -N; i <= N; i++) {
      const bx = i * PITCH;
      const bz = j * PITCH;
      const dist = Math.hypot(bx, bz);
      const blockSeed = hash(citySeed, i, j);
      const wobble = 0.82 + 0.34 * unit(hash(blockSeed, 'edge')); // irregular outline
      if (dist > R * wobble) continue;
      const zone = zoneAt(tier, dist);
      const gapP = zone === 'core' ? 0.05 : zone === 'ring' ? 0.1 : 0.16;
      if (unit(hash(blockSeed, 'gap')) < gapP) continue; // plazas / parks / lots
      zones[zone]++;
      blocks++;

      // asphalt tile (block + its share of the streets), then a raised sidewalk
      // slab — a real 12 cm curb you can see peds walk on (a plane has no edge).
      gb.plane(bx, bz, PITCH, PITCH, -0.02, SURFACE.asphalt);
      gb.box(bx, 0.06, bz, BLOCK, 0.12, BLOCK, SURFACE.sidewalk);

      buildings += buildBlock(mb, colliders, doors, bx, bz, zone, rules(tier, zone), paletteKey, blockSeed, maxH);
      placeParking(park, bx, bz, blockSeed);
    }
  }

  const geo = mb.build();
  const gnd = gb.build();
  return {
    seed: citySeed,
    tier,
    palette: paletteKey,
    radius: R,
    maxHeight: maxH.v,
    // structures (snapped)
    positions: geo.positions,
    normals: geo.normals,
    colors: geo.colors,
    indices: geo.indices,
    // ground (flat, not snapped)
    ground: {
      positions: gnd.positions,
      normals: gnd.normals,
      colors: gnd.colors,
      indices: gnd.indices,
    },
    colliders,
    parking: park,
    doors,
    stats: {
      blocks, buildings, zones, parked: park.length, doors: doors.length,
      triangles: geo.triangles + gnd.triangles,
      vertices: geo.vertices + gnd.vertices,
    },
  };
}

// A stable digest of a city's geometry (§5 — pin it so generation can't silently
// drift). Folds vertex count, triangle count, and quantized position/colour data
// through the hash chain.
export function cityDigest(city) {
  let h = 2166136261 >>> 0;
  h = hash(h, city.seed, city.stats.vertices, city.stats.triangles, city.stats.blocks, city.stats.buildings);
  // sample every 7th position component (mm) + every 13th colour (byte), across
  // both structures and ground, so the digest is robust to harmless float noise
  // but catches any real geometry change.
  for (const g of [city, city.ground]) {
    const p = g.positions;
    for (let i = 0; i < p.length; i += 7) h = hash(h, Math.round(p[i] * 1000));
    const c = g.colors;
    for (let i = 0; i < c.length; i += 13) h = hash(h, Math.round(c[i] * 255));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
