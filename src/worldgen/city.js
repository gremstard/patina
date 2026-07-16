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

import { CITY_R, FLOOR, BLOCK, CORRIDOR } from '../core/constants.js';
import { hash, unit } from '../core/hash.js';
import { zoneAt, rules } from '../core/zoning.js';
import { MeshBuilder } from '../render/meshbuilder.js';
import { SURFACE, wall, roof, shade } from '../render/palette.js';

const ROAD = CORRIDOR; // 12.5 m street corridor between blocks
const PITCH = BLOCK + ROAD; // 72.5 m block-to-block

const floorsOf = (r, seed) => r.floors[0] + (hash(seed, 'fl') % (r.floors[1] - r.floors[0] + 1));

// Place one building mass with its roof. fw/fd = footprint (already set back).
function placeBuilding(mb, cx, cz, fw, fd, floors, roofType, palette, seed, maxH) {
  const height = floors * FLOOR;
  const wc = shade(wall(palette, hash(seed, 'w')), 0.82 + 0.4 * unit(hash(seed, 'ws')));
  mb.box(cx, height / 2, cz, fw, height, fd, wc);
  if (roofType === 'gable') {
    // Pitch scales with span but is CAPPED — a wide mass must not sprout a barn
    // roof (a 50 m footprint at 0.4 span = 20 m of ridge). Real wide-span gables
    // are low-pitch. Cap near one floor.
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

function placeTree(mb, x, z, seed) {
  const h = 2.2 + unit(hash(seed, 'th')) * 2.4;
  mb.box(x, h * 0.4, z, 0.32, h * 0.8, 0.32, SURFACE.trunk);
  mb.box(x, h, z, 1.7, 1.9, 1.7, shade(SURFACE.foliage, 0.85 + 0.3 * unit(hash(seed, 'tf'))));
}

// Attached masses — offices, stores, apartments, main-street rows (§7 lots that
// are NOT detached). Pack the block into a few masses with the zone's setback
// and roof. Never gabled, so wide spans stay flat/parapet — no barn roofs.
function massBlock(mb, bx, bz, r, palette, seed, maxH) {
  const sb = r.setback;
  const nx = 1 + (hash(seed, 'nx') % 2);
  const nz = 1 + (hash(seed, 'nz') % 2);
  const cw = BLOCK / nx;
  const cd = BLOCK / nz;
  const roofType = r.roof === 'gable' ? 'flat' : r.roof; // safety: masses never gable
  let n = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const cx = bx - BLOCK / 2 + cw * (a + 0.5);
      const cz = bz - BLOCK / 2 + cd * (b + 0.5);
      const s = hash(seed, a, b);
      // 0-setback cores share walls (tiny reveal); set-back masses pull in.
      const fw = cw - Math.max(1, 2 * sb) + (sb === 0 ? 0.5 : 0);
      const fd = cd - Math.max(1, 2 * sb) + (sb === 0 ? 0.5 : 0);
      placeBuilding(mb, cx, cz, fw, fd, floorsOf(r, s), roofType, palette, s, maxH);
      n++;
    }
  }
  return n;
}

// Detached houses — the suburb. A sparse lot grid with gabled houses; the gaps
// ARE the density gradient. `emptyP` thins the edge more than the ring, so a
// town's ring reads as denser houses than its cul-de-sac edge (§7).
function houseBlock(mb, bx, bz, zone, r, palette, seed, maxH) {
  const grid = 3;
  const lot = BLOCK / grid;
  const sb = Math.min(r.setback, lot * 0.26);
  const emptyP = zone === 'edge' ? 0.34 : 0.14;
  let n = 0;
  for (let a = 0; a < grid; a++) {
    for (let b = 0; b < grid; b++) {
      const s = hash(seed, a, b);
      if (unit(hash(s, 'empty')) < emptyP) continue;
      const cx = bx - BLOCK / 2 + lot * (a + 0.5);
      const cz = bz - BLOCK / 2 + lot * (b + 0.5);
      const fw = lot - 2 * sb;
      const fd = lot - 2 * sb;
      placeBuilding(mb, cx, cz, fw, fd, floorsOf(r, s), 'gable', palette, s, maxH);
      if (unit(hash(s, 'tree')) < 0.45) placeTree(mb, cx + lot * 0.32, cz + lot * 0.32, s);
      n++;
    }
  }
  return n;
}

// §7: the branch is `detached`, the doc's own flag — not the zone name. Town
// rings are detached houses; metro cores are attached towers. This is what
// keeps a cul-de-sac and six floors from ever meeting.
function buildBlock(mb, bx, bz, zone, r, palette, seed, maxH) {
  return r.detached
    ? houseBlock(mb, bx, bz, zone, r, palette, seed, maxH)
    : massBlock(mb, bx, bz, r, palette, seed, maxH);
}

// Generate a whole city centred on local (0,0). `paletteKey` binds to naming
// culture (§9) — pass settlement.palette from the world index.
export function generateCity(citySeed, tier = 'city', paletteKey = 'greyconcrete') {
  citySeed = citySeed >>> 0;
  const R = CITY_R[tier];
  const mb = new MeshBuilder();
  const maxH = { v: 0 };

  // scrub ground under the whole thing
  const span = (R + PITCH) * 2.4;
  mb.plane(0, 0, span, span, -0.06, SURFACE.ground);

  const N = Math.ceil(R / PITCH) + 1;
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

      // asphalt tile (block + its share of the streets) then the sidewalk pad
      mb.plane(bx, bz, PITCH, PITCH, -0.02, SURFACE.asphalt);
      mb.plane(bx, bz, BLOCK, BLOCK, 0.02, SURFACE.sidewalk);

      buildings += buildBlock(mb, bx, bz, zone, rules(tier, zone), paletteKey, blockSeed, maxH);
    }
  }

  const geo = mb.build();
  return {
    seed: citySeed,
    tier,
    palette: paletteKey,
    radius: R,
    maxHeight: maxH.v,
    positions: geo.positions,
    normals: geo.normals,
    colors: geo.colors,
    indices: geo.indices,
    stats: { blocks, buildings, zones, triangles: geo.triangles, vertices: geo.vertices },
  };
}

// A stable digest of a city's geometry (§5 — pin it so generation can't silently
// drift). Folds vertex count, triangle count, and quantized position/colour data
// through the hash chain.
export function cityDigest(city) {
  let h = 2166136261 >>> 0;
  h = hash(h, city.seed, city.stats.vertices, city.stats.triangles, city.stats.blocks, city.stats.buildings);
  const p = city.positions;
  // sample every 7th component, quantized to mm, so the digest is robust to
  // harmless float noise but catches any real geometry change.
  for (let i = 0; i < p.length; i += 7) h = hash(h, Math.round(p[i] * 1000));
  const c = city.colors;
  for (let i = 0; i < c.length; i += 13) h = hash(h, Math.round(c[i] * 255));
  return (h >>> 0).toString(16).padStart(8, '0');
}
