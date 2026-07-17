// Patina — the world (Phase 5+). Drive/walk the full 128 × 128 km world, now
// with varied cars and ambient life: pedestrians on the sidewalks and traffic on
// the streets, in a bubble around you, deleted beyond the fog (§14/§16).
//
// Coordinates (§8): sim in absolute world metres (float64, no jitter); floating
// origin is render-only. Cities stream in on approach, deleted behind (§6). The
// active car survives its origin city unloading (dedicated mesh); street cars you
// take just vanish from their instance.

import * as THREE from 'three';
import { generateWorldIndex } from '../src/worldgen/worldIndex.js';
import { generateCity } from '../src/worldgen/city.js';
import { buildCarType, CAR_TYPES, CAR_COLORS } from '../src/render/car.js';
import { buildPed } from '../src/render/ped.js';
import { makeCityMaterial, makeGroundMaterial, PSXPass } from '../src/render/psx.js';
import { createCar, stepCar, interpCar } from '../src/sim/vehicle.js';
import { createPed, stepPed, interpPed } from '../src/sim/pedestrian.js';
import { buildColliderGrid, resolveCollision, resolveAgents, nearestParked, nearestDoor, pointBlocked } from '../src/sim/collision.js';
import { generateInterior, BUILDING_LABEL, floorType } from '../src/worldgen/interior.js';
import { settlementsToLoad, inStreamRange, nearestLabelled } from '../src/worldgen/streaming.js';
import { Ambient } from '../src/sim/ambient.js';
import { loadPlayer, savePlayer, addMoney, spend, addItem, removeItem, countItem, itemList } from '../src/sim/player.js';
import { buildRoads, segDist2 } from '../src/worldgen/roads.js';
import { buildTree } from '../src/render/props.js';
import { MeshBuilder } from '../src/render/meshbuilder.js';
import { SURFACE } from '../src/render/palette.js';
import { hash, unit } from '../src/core/hash.js';
import { FOG_FAR, BLOCK, CORRIDOR, HALF_WORLD_M, WORLD_M, CITY_R } from '../src/core/constants.js';

const PITCH = BLOCK + CORRIDOR;
const $ = (id) => document.getElementById(id);
// nearest street-junction (corridor intersection) of the city centred at (cx,cz)
function snapJunction(x, z, cx, cz) {
  const kx = Math.round((x - cx) / PITCH - 0.5);
  const kz = Math.round((z - cz) / PITCH - 0.5);
  return [cx + (kx + 0.5) * PITCH, cz + (kz + 0.5) * PITCH];
}
const index = generateWorldIndex(8829);
const CULT = { anglic: '#c05a3e', iberic: '#d99a4e', rustbelt: '#8593a0', conlang: '#9fae86' };

// ── Renderer / scene ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const post = new PSXPass(renderer, { internalHeight: 240, levels: 20 });
const scene = new THREE.Scene();
const FOG = new THREE.Color(0x6b5c50);
scene.background = FOG.clone();
scene.fog = new THREE.Fog(FOG.clone(), 12, FOG_FAR);
const sun = new THREE.DirectionalLight(0xffe1b0, 2.15);
sun.position.set(-0.5, 0.9, 0.4);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd0e2, 0x453f36, 1.15));
const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambLight);

const mat = makeCityMaterial();
const groundMat = makeGroundMaterial();
const interiorMat = makeGroundMaterial(); // non-snapped, for close-up interiors
const worldGroup = new THREE.Group();
scene.add(worldGroup);
const interiorGroup = new THREE.Group(); // a separate loaded cell (§17), at origin
interiorGroup.visible = false;
scene.add(interiorGroup);
let interiorMesh = null;
let interiorGrid = null;
let returnDoor = null;
let interior = null; // { seed, type, w, d, floors, cur, elevator }
const renderOrigin = { x: 0, z: 0 };

function bufGeo(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  return g;
}

// shared car-type geometries + the colour palette as THREE.Colors
const typeGeo = CAR_TYPES.map((t) => bufGeo(buildCarType(t)));
const carColors = CAR_COLORS.map((c) => new THREE.Color(c[0], c[1], c[2]));
const pedGeo = bufGeo(buildPed());

// endless ground (grass/scrub), centred on the player
const groundPlane = new THREE.Mesh(makeFlatGround(2000), groundMat);
scene.add(groundPlane);
function makeFlatGround(size) {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = 0.17; col[i * 3 + 1] = 0.21; col[i * 3 + 2] = 0.12; } // muted grass
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ── Roads (highways) + roadside trees, rebuilt as the player moves ───────────
const roads = buildRoads(index);
// annotate each interstate with the radius of the city at each end, so it can be
// clipped to meet the city's outer streets instead of plunging to the centre.
{
  const rad = new Map();
  for (const s of index.settlements) rad.set(`${s.x},${s.z}`, CITY_R[s.tier] || 120);
  for (const e of roads) { e.ra = rad.get(`${e.ax},${e.az}`) || 120; e.rb = rad.get(`${e.bx},${e.bz}`) || 120; }
}
const roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), groundMat);
roadMesh.frustumCulled = false; // absolute-coord geometry, mesh sits at origin
worldGroup.add(roadMesh); // MUST be in the floating-origin group, not the scene
const treeGeo = bufGeo(buildTree());
const TREE_MAX = 320;
const treeInst = new THREE.InstancedMesh(treeGeo, mat, TREE_MAX);
treeInst.frustumCulled = false;
worldGroup.add(treeInst); // same — absolute coords under the world group
let sceneryX = 1e9;
let sceneryZ = 1e9;
const ROADW = 16; // interstate width — wide enough to spot across open country

function rebuildScenery(px, pz) {
  // roads within view range → one merged strip mesh (absolute coords)
  const mb = new MeshBuilder();
  const near = [];
  for (const e of roads) {
    if (segDist2(px, pz, e.ax, e.az, e.bx, e.bz) > 720 * 720) continue;
    near.push(e);
    let dx = e.bx - e.ax; let dz = e.bz - e.az;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // clip the ends to ~0.85 of each city radius: the interstate meets the city's
    // outer streets (overlapping them, so you can drive on/off) instead of running
    // to the centre through the buildings.
    const a = Math.min(e.ra * 0.85, len * 0.45);
    const b = len - Math.min(e.rb * 0.85, len * 0.45);
    if (b <= a) continue;
    // snap each end to the nearest street junction of ITS city, so the
    // interstate branches from a real road rather than a random point.
    const [ax, az] = snapJunction(e.ax + dx * a, e.az + dz * a, e.ax, e.az);
    const [bx, bz] = snapJunction(e.ax + dx * b, e.az + dz * b, e.bx, e.bz);
    const nx = -dz * ROADW * 0.5; const nz = dx * ROADW * 0.5;
    mb.quad(
      ax + nx, 0.0, az + nz, bx + nx, 0.0, bz + nz,
      bx - nx, 0.0, bz - nz, ax - nx, 0.0, az - nz, ...SURFACE.asphalt,
    );
  }
  roadMesh.geometry.dispose();
  roadMesh.geometry = mb.pos.length ? bufGeo(mb.build()) : new THREE.BufferGeometry();

  // trees on a coarse grid, skipping cities and roads
  const CELL = 24;
  let ti = 0;
  const R = 7;
  const ci = Math.round(px / CELL);
  const cj = Math.round(pz / CELL);
  for (let i = -R; i <= R && ti < TREE_MAX; i++) {
    for (let j = -R; j <= R && ti < TREE_MAX; j++) {
      const cx = ci + i; const cz = cj + j;
      if (unit(hash(cx, cz, 'td')) > 0.2) continue; // ~20% of cells
      const wx = cx * CELL + (unit(hash(cx, cz, 'tx')) - 0.5) * CELL * 0.8;
      const wz = cz * CELL + (unit(hash(cx, cz, 'tz')) - 0.5) * CELL * 0.8;
      if ((wx - px) ** 2 + (wz - pz) ** 2 > 168 * 168) continue;
      let skip = false;
      for (const e of loaded.values()) { const dx = wx - e.s.x; const dz = wz - e.s.z; if (dx * dx + dz * dz < (CITY_R[e.s.tier] + 25) ** 2) { skip = true; break; } }
      if (!skip) for (const e of near) { if (segDist2(wx, wz, e.ax, e.az, e.bx, e.bz) < 8 * 8) { skip = true; break; } }
      if (skip) continue;
      tmpQ.setFromAxisAngle(UP, unit(hash(cx, cz, 'ty')) * 6.28);
      tmpS.setScalar(0.8 + unit(hash(cx, cz, 'ts')) * 0.6);
      tmpP.set(wx, 0, wz);
      tmpM.compose(tmpP, tmpQ, tmpS);
      treeInst.setMatrixAt(ti++, tmpM);
    }
  }
  for (let k = ti; k < TREE_MAX; k++) { tmpM.compose(tmpP.set(0, -9999, 0), tmpQ.identity(), zeroS); treeInst.setMatrixAt(k, tmpM); }
  tmpS.setScalar(1);
  treeInst.instanceMatrix.needsUpdate = true;
  sceneryX = px; sceneryZ = pz;
}

// player car (dedicated, tintable) + ped
const carMat = makeCityMaterial();
let carType = 0;
let carColorIdx = 0;
const carMesh = new THREE.Mesh(typeGeo[0], carMat);
const pedMesh = new THREE.Mesh(pedGeo, mat);
worldGroup.add(carMesh);
worldGroup.add(pedMesh);
function setPlayerCar(type, colorIdx) {
  carType = type; carColorIdx = colorIdx;
  carMesh.geometry = typeGeo[type];
  carMat.color.copy(carColors[colorIdx]);
}

// ── Ambient life ─────────────────────────────────────────────────────────────
const PED_N = 72;
const CAR_N = 8;
const ambient = new Ambient(PED_N, CAR_N, 12345);
const pedInst = new THREE.InstancedMesh(pedGeo, mat, PED_N);
pedInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
// Instances carry their positions in the instance matrices while the mesh sits at
// the origin — which, under the floating-origin world group, is ~18 km from the
// camera. Three would frustum-cull the whole crowd on the base geometry's sphere.
// Disable culling so the agents actually render where they are.
pedInst.frustumCulled = false;
worldGroup.add(pedInst);
const trafficInst = typeGeo.map((g) => {
  const im = new THREE.InstancedMesh(g, mat, CAR_N);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAR_N * 3).fill(1), 3);
  im.frustumCulled = false;
  worldGroup.add(im);
  return im;
});

// ── Streaming ────────────────────────────────────────────────────────────────
const loaded = new Map();
let grid = buildColliderGrid([]);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const zeroS = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function rebuildGrid() {
  const all = [];
  const alld = [];
  for (const e of loaded.values()) {
    for (const c of e.colliders) all.push(c);
    for (const d of e.doors) alld.push(d);
  }
  grid = buildColliderGrid(all);
  doorGrid = buildColliderGrid(alld);
}

function loadCity(s) {
  const city = generateCity(s.id, s.tier, s.palette);
  const struct = new THREE.Mesh(bufGeo(city), mat);
  const gnd = new THREE.Mesh(bufGeo(city.ground), groundMat);
  struct.position.set(s.x, 0, s.z);
  gnd.position.set(s.x, 0, s.z);
  worldGroup.add(struct, gnd);
  const meshes = [struct, gnd];
  const colliders = [];
  for (const c of city.colliders) colliders.push({ x: s.x + c.x, z: s.z + c.z, hw: c.hw, hd: c.hd });

  // parked cars: assign a type + colour per spot, group into one InstancedMesh
  // per type (per-instance colour), and remember how to hide each for enter().
  const byType = CAR_TYPES.map(() => []);
  for (let i = 0; i < city.parking.length; i++) {
    const t = hash(s.id, 'ct', i) % CAR_TYPES.length;
    byType[t].push(i);
  }
  for (let t = 0; t < CAR_TYPES.length; t++) {
    const list = byType[t];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(typeGeo[t], mat, list.length);
    im.frustumCulled = false; // instances live far from the mesh origin (see above)
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    for (let k = 0; k < list.length; k++) {
      const pk = city.parking[list[k]];
      tmpQ.setFromAxisAngle(UP, pk.yaw);
      tmpP.set(s.x + pk.x, 0, s.z + pk.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      im.setMatrixAt(k, tmpM);
      const ci = hash(s.id, 'cc', list[k]) % carColors.length;
      im.setColorAt(k, carColors[ci]);
      const alongZ = Math.abs(Math.cos(pk.yaw)) > 0.5;
      colliders.push({
        x: s.x + pk.x, z: s.z + pk.z, hw: alongZ ? 0.95 : 2.1, hd: alongZ ? 2.1 : 0.95,
        id: list[k], yaw: pk.yaw, inst: im, pidx: k, type: t, color: ci, taken: false,
      });
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    worldGroup.add(im);
    meshes.push(im);
  }
  const doorRecs = city.doors.map((d) => ({
    x: s.x + d.x, z: s.z + d.z, hw: 0.6, hd: 0.6, door: true, yaw: d.yaw, seed: d.seed, btype: d.btype,
    w: d.w, d: d.d, floors: d.floors, sid: s.id,
  }));
  loaded.set(s.id, { s, meshes, colliders, doors: doorRecs, streets: city.streets });
  rebuildGrid();
}

function unloadCity(id) {
  const e = loaded.get(id);
  if (!e) return;
  for (const m of e.meshes) worldGroup.remove(m);
  // meshes[0]=structures, [1]=ground own unique geometry → dispose. The rest are
  // parked-car InstancedMeshes that reference SHARED typeGeo → never dispose those.
  e.meshes[0].geometry.dispose();
  e.meshes[1].geometry.dispose();
  loaded.delete(id);
  rebuildGrid();
}

let streamTick = 0;
function updateStreaming(px, pz) {
  for (const [id, e] of loaded) if (!inStreamRange(e.s, px, pz, 1.35)) unloadCity(id);
  for (const s of settlementsToLoad(index, px, pz)) if (!loaded.has(s.id)) { loadCity(s); break; }
}

// nearest loaded city (for anchoring ambient life)
function nearestLoaded(px, pz) {
  let best = null; let bd = Infinity;
  for (const e of loaded.values()) {
    const dx = e.s.x - px; const dz = e.s.z - pz; const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = e; }
  }
  return best; // the loaded entry {s, streets, …}
}

// ── Player state ─────────────────────────────────────────────────────────────
const car = createCar();
const ped = createPed();
let mode = 'foot';
const activeX = () => (mode === 'drive' ? car.x : ped.x);
const activeZ = () => (mode === 'drive' ? car.z : ped.z);

// ── Economy: wallet + inventory (persisted) ──────────────────────────────────
const player = loadPlayer();
let invOpen = false;
function renderMoney() { $('money').textContent = '$' + player.money; }
function renderInventory() {
  const list = itemList(player);
  const el = $('inv-list');
  el.innerHTML = list.length
    ? list.map((it) => `<div class="row"><span>${it.name}</span><span class="q">×${it.qty}</span></div>`).join('')
    : '<div class="empty">empty</div>';
}
let toastT = 0;
function toast(msg, color = '#8fcf7a') {
  const el = $('toast');
  el.textContent = msg; el.style.color = color; el.style.opacity = '1';
  toastT = 1.6;
}
// central mutators so the HUD + save always stay in sync
function gainMoney(amt) { addMoney(player, amt); renderMoney(); toast((amt >= 0 ? '+$' : '-$') + Math.abs(amt)); savePlayer(player); }
function paySpend(amt) { const ok = spend(player, amt); if (ok) { renderMoney(); toast('-$' + amt, '#e0b36a'); savePlayer(player); } return ok; }
function giveItem(id, name, value, qty = 1) { addItem(player, id, name, value, qty); renderInventory(); toast('+ ' + name, '#a9c8e0'); savePlayer(player); }
function takeItem(id, qty = 1) { const ok = removeItem(player, id, qty); if (ok) { renderInventory(); savePlayer(player); } return ok; }
function toggleInv() { invOpen = !invOpen; $('inv').classList.toggle('open', invOpen); if (invOpen) renderInventory(); }
renderMoney(); renderInventory();

// ── Crime: wanted level + cops ────────────────────────────────────────────────
let wanted = 0; // 0..5 stars
let heat = 0; // seconds of clean behaviour before a star drops
const WANTED_DECAY = 14; // one star cools off every 14 s clean
let robbing = null; // { target, t, dur, haul } while a hold-up is in progress
function renderWanted() {
  const el = $('wanted');
  el.classList.toggle('hot', wanted > 0);
  let s = '';
  for (let i = 0; i < 5; i++) s += i < wanted ? '★' : '<span class="off">★</span>';
  el.innerHTML = s;
}
function addHeat(stars) { wanted = Math.min(5, wanted + stars); heat = WANTED_DECAY; renderWanted(); }
function coolHeat(dt) {
  if (wanted <= 0 || robbing) return;
  heat -= dt;
  if (heat <= 0) { wanted = Math.max(0, wanted - 1); heat = WANTED_DECAY; renderWanted(); if (wanted === 0) despawnCop(); }
}
renderWanted();

// A police cruiser that homes in once you're wanted; touch = busted.
const policeMat = makeCityMaterial();
policeMat.color = new THREE.Color(0.4, 0.46, 0.8); // navy cruiser
const policeMesh = new THREE.Mesh(typeGeo[1], policeMat);
policeMesh.visible = false;
policeMesh.frustumCulled = false;
worldGroup.add(policeMesh);
const cop = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, active: false };
function spawnCop() {
  if (cop.active) return;
  const vy = mode === 'drive' ? car.yaw : ped.yaw;
  cop.x = activeX() - Math.sin(vy) * 48; cop.z = activeZ() - Math.cos(vy) * 48;
  cop.vx = 0; cop.vz = 0; cop.active = true; policeMesh.visible = true;
}
function despawnCop() { cop.active = false; policeMesh.visible = false; }
function stepCop(dt) {
  if (!cop.active) return;
  const dx = activeX() - cop.x; const dz = activeZ() - cop.z;
  const dist = Math.hypot(dx, dz) || 1;
  const spd = mode === 'drive' ? 16 : 8.5; // catches a runner; a car can outrun it
  cop.vx = (dx / dist) * spd; cop.vz = (dz / dist) * spd;
  cop.x += cop.vx * dt; cop.z += cop.vz * dt;
  resolveCollision(cop, grid, 1.1); // no driving through walls
  cop.yaw = Math.atan2(dx, dz);
  if (dist < 3.4 && mode !== 'interior') busted();
}
function busted() {
  const fine = Math.min(player.money, 40 + wanted * 30);
  if (fine > 0) { addMoney(player, -fine); renderMoney(); savePlayer(player); }
  toast(`BUSTED · -$${fine}`, '#e05a4a');
  wanted = 0; heat = 0; renderWanted(); despawnCop();
}

// ── Robbery + mugging ─────────────────────────────────────────────────────────
let promptRob = null;
function robTill() {
  if (robbing || !promptRob) return;
  const bank = promptRob.kind === 'bank';
  robbing = {
    kind: promptRob.kind, t: 0,
    dur: bank ? 3.6 : 2.2,
    haul: bank ? 220 + Math.floor(Math.random() * 380) : 30 + Math.floor(Math.random() * 60),
  };
  working = null; if (shopOpen) closeShop();
  addHeat(bank ? 3 : 1); // the alarm goes off the moment you pull the job
}
function stepRob(dt) {
  if (!robbing) return;
  robbing.t += dt;
  if (robbing.t >= robbing.dur) {
    gainMoney(robbing.haul);
    toast(`robbed $${robbing.haul}!`, '#e0b36a');
    robbing = null;
  }
}
function mugNearest() {
  // grab the closest ambient pedestrian on the street
  let best = null; let bd = 2.4 * 2.4;
  for (const p of ambient.peds) {
    if (!p.live) continue;
    const d = (p.rx - ped.x) ** 2 + (p.rz - ped.z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return false;
  const haul = 5 + Math.floor(Math.random() * 21);
  gainMoney(haul); toast(`mugged $${haul}`, '#e0b36a'); addHeat(1);
  // shove the victim away so they scatter
  const dx = best.rx - ped.x; const dz = best.rz - ped.z; const d = Math.hypot(dx, dz) || 1;
  best.kx = (dx / d) * 9; best.kz = (dz / d) * 9;
  return true;
}
function doRob() {
  if (robbing) { robbing = null; return; } // give up the hold-up
  if (mode === 'interior') { if (promptRob) robTill(); }
  else if (mode === 'foot') mugNearest();
}

function spawnAt(s) {
  for (const id of [...loaded.keys()]) unloadCity(id);
  const cx = s.x + PITCH * 0.5;
  const cz = s.z;
  car.x = cx; car.z = cz; car.yaw = 0; car.vx = 0; car.vz = 0; car.steer = 0; car.speed = 0;
  car.prevX = cx; car.prevZ = cz; car.prevYaw = 0; car.prevSteer = 0;
  setPlayerCar(hash(s.id, 'pt') % CAR_TYPES.length, hash(s.id, 'pc') % carColors.length);
  renderOrigin.x = cx; renderOrigin.z = cz;
  worldGroup.position.set(-cx, 0, -cz);
  updateStreaming(cx, cz);
  for (let k = 0; k < 6 && (resolveCollision(car, grid, 0.95, 1.4) + resolveCollision(car, grid, 0.95, -1.4)) > 0; k++) car.z += 6;
  car.vx = 0; car.vz = 0;
  ped.x = car.x - 2.6; ped.z = car.z; ped.yaw = Math.PI / 2;
  ped.vx = 0; ped.vz = 0; ped.speed = 0; ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
  mode = 'foot';
  acc = 0; camReady = false;
}
function startMetro() {
  let best = null; let bd = Infinity;
  for (const s of index.settlements) {
    if (s.tier !== 'metro') continue;
    const d = s.x * s.x + s.z * s.z;
    if (d < bd) { bd = d; best = s; }
  }
  return best || index.settlements[0];
}

// ── Enter / exit ─────────────────────────────────────────────────────────────
function hideInstance(inst, i) {
  tmpM.compose(tmpP.set(0, -9999, 0), tmpQ.identity(), zeroS);
  inst.setMatrixAt(i, tmpM);
  inst.instanceMatrix.needsUpdate = true;
}
function toggleCar() {
  if (mode === 'drive') {
    if (Math.abs(car.speed) > 2.2) return;
    const rx = Math.cos(car.yaw); const rz = -Math.sin(car.yaw);
    ped.x = car.x + rx * 2.6; ped.z = car.z + rz * 2.6; ped.yaw = car.yaw;
    ped.vx = 0; ped.vz = 0; ped.speed = 0; ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
    mode = 'foot'; camReady = false;
    return;
  }
  const dOwn = Math.hypot(car.x - ped.x, car.z - ped.z);
  const street = nearestParked(grid, ped.x, ped.z, 4.4);
  const dStreet = street ? Math.hypot(street.x - ped.x, street.z - ped.z) : Infinity;
  if (dOwn > 4.4 && !street) return;
  if (street && dStreet < dOwn) {
    street.taken = true;
    hideInstance(street.inst, street.pidx);
    setPlayerCar(street.type, street.color);
    car.x = street.x; car.z = street.z; car.yaw = street.yaw;
    car.vx = 0; car.vz = 0; car.steer = 0; car.speed = 0;
    car.prevX = car.x; car.prevZ = car.z; car.prevYaw = car.yaw; car.prevSteer = 0;
  } else {
    car.vx = 0; car.vz = 0; car.speed = 0; car.prevX = car.x; car.prevZ = car.z; car.prevYaw = car.yaw;
  }
  mode = 'drive'; camReady = false;
}

// ── Enter / exit a building (interiors, §17 — a separate loaded cell) ─────────
// Interiors are sized to the building's real footprint and have as many floors as
// the building is tall; the elevator (back-right corner) rebuilds the cell for the
// next floor. See src/worldgen/interior.js.
let promptDoor = null;
let promptLift = false;
let promptWork = null; // the nearby job station, if any
let working = null; // { job, t } while a shift is in progress
let promptShop = null; // the nearby shop counter, if any
let shopOpen = false;
function buildFloor(f, place) {
  const it = generateInterior(interior.seed, interior.btype, {
    w: interior.w, d: interior.d, floors: interior.floors, floor: f,
  });
  if (interiorMesh) { interiorMesh.geometry.dispose(); interiorGroup.remove(interiorMesh); }
  interiorMesh = new THREE.Mesh(bufGeo(it), interiorMat);
  interiorGroup.add(interiorMesh);
  interiorGrid = buildColliderGrid(it.colliders);
  interiorGroup.userData.exit = it.exit;
  interiorGroup.userData.label = it.label;
  interior.cur = f;
  interior.elevator = it.elevator;
  interior.spawn = it.spawn;
  interior.job = it.job;
  interior.shop = it.shop;
  interior.robbery = it.robbery;
  working = null; robbing = null; // changing floors ends any shift / hold-up
  if (shopOpen) closeShop();
  // where to stand: the lift (arriving by elevator) or the door (arriving from outside)
  const at = place === 'lift' ? { x: it.elevator.x, z: it.elevator.z } : it.spawn;
  ped.x = at.x; ped.z = at.z; ped.yaw = it.spawn.yaw;
  ped.vx = 0; ped.vz = 0; ped.speed = 0; ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
  return it;
}
// A building is private (residential) if its ground floor is a home — houses and
// apartment blocks. Those doors are locked unless it's the one you rent.
const RENT_COST = 150;
function isResidential(door) {
  const t = floorType(door.btype, 0, Math.max(1, door.floors || 1));
  return t === 'apartment' || t === 'house';
}
function isMyHome(door) {
  const h = player.home;
  return !!(h && h.sid === door.sid && Math.abs(h.x - door.x) < 1.5 && Math.abs(h.z - door.z) < 1.5);
}
// Can you walk through this door? Public buildings always; homes only if yours.
function canEnter(door) { return door && (!isResidential(door) || isMyHome(door)); }
function rentHome() {
  const door = promptDoor;
  if (!door || !isResidential(door) || player.home || isMyHome(door)) return;
  if (!paySpend(RENT_COST)) { toast(`need $${RENT_COST}`, '#c0605a'); return; }
  player.home = { sid: door.sid, x: door.x, z: door.z };
  savePlayer(player);
  toast('moved in — home rented', '#8fcf7a');
  enterBuilding();
}
function enterBuilding(force = false) {
  if (mode !== 'foot' || !promptDoor) return;
  const door = promptDoor;
  if (!force && !canEnter(door)) return; // locked — someone else's home

  interior = {
    seed: door.seed, btype: door.btype,
    w: door.w || 12, d: door.d || 10, floors: Math.max(1, door.floors || 1), cur: 0,
  };
  const it = buildFloor(0, 'door');
  // remember where to drop the player back outside
  returnDoor = { x: door.x, z: door.z, yaw: door.yaw };
  worldGroup.remove(pedMesh);
  interiorGroup.add(pedMesh);
  worldGroup.visible = false;
  groundPlane.visible = false;
  interiorGroup.visible = true;
  scene.fog.far = 70; // tighter fog indoors
  ambLight.intensity = 0.92; // interiors are lit
  mode = 'interior'; camReady = false; promptDoor = null; promptLift = false;
  $('s-near2').textContent = it.label;
}
// Jobs — clock in at a station, work a shift (locked in place), get paid. Press
// E again to clock out early (no pay for the unfinished shift).
function useJobOrLift() {
  if (mode !== 'interior') return;
  if (working) { working = null; return; } // clock out
  if (promptWork) { working = { job: promptWork, t: 0 }; return; }
  useElevator();
}
function stepWork(dt) {
  if (!working) return;
  working.t += dt;
  if (working.t >= working.job.shift) {
    gainMoney(working.job.pay);
    toast(`+$${working.job.pay} · ${working.job.role}`, '#8fcf7a');
    working.t = 0; // roll straight into the next shift while you stay clocked in
  }
}
// Buying — open the shop counter, click an item to buy it.
function openShop() {
  if (!promptShop) return;
  shopOpen = true;
  working = null; // can't work and shop at once
  $('shop-title').textContent = interiorGroup.userData.label || 'Shop';
  $('shop-sub').textContent = 'click an item to buy';
  renderShop();
  $('shop').classList.add('open');
}
function closeShop() { shopOpen = false; $('shop').classList.remove('open'); }
function renderShop() {
  const stock = promptShop ? promptShop.stock : [];
  $('shop-list').innerHTML = stock.map((it, i) =>
    `<div class="item${player.money < it.price ? ' cant' : ''}" data-i="${i}"><span>${it.name}</span><span class="price">$${it.price}</span></div>`,
  ).join('');
}
function buyFromShop(i) {
  const it = promptShop && promptShop.stock[i];
  if (!it) return;
  if (!paySpend(it.price)) { toast(`need $${it.price}`, '#c0605a'); return; }
  giveItem(it.id, it.name, it.price, 1);
  renderShop(); // refresh affordability
}
$('shop-list').addEventListener('click', (e) => {
  const row = e.target.closest('.item');
  if (row) buyFromShop(Number(row.dataset.i));
});
function useElevator() {
  if (mode !== 'interior' || !interior || interior.floors < 2) return;
  const next = (interior.cur + 1) % interior.floors;
  buildFloor(next, 'lift');
  camReady = false;
}
function exitBuilding() {
  if (mode !== 'interior') return;
  // the door only exists on the ground floor — no walking out a 2nd-storey wall
  if (interior && interior.cur !== 0) return;
  interiorGroup.remove(pedMesh);
  worldGroup.add(pedMesh);
  interiorGroup.visible = false;
  worldGroup.visible = true;
  groundPlane.visible = true;
  scene.fog.far = FOG_FAR;
  ambLight.intensity = 0.4;
  interior = null;
  // drop the player back outside, at the door
  ped.x = returnDoor.x; ped.z = returnDoor.z; ped.yaw = returnDoor.yaw + Math.PI;
  ped.vx = 0; ped.vz = 0; ped.speed = 0; ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
  renderOrigin.x = ped.x; renderOrigin.z = ped.z; worldGroup.position.set(-ped.x, 0, -ped.z);
  updateStreaming(ped.x, ped.z);
  mode = 'foot'; camReady = false;
}

// ── Sim loop ─────────────────────────────────────────────────────────────────
const DT = 1 / 60;
let acc = 0;
let last = 0;
const input = { throttle: false, brake: false, steer: 0, run: false };
const NO_INPUT = { throttle: false, brake: false, steer: 0, run: false };
const rc = { x: 0, z: 0, yaw: 0, steer: 0 };
const rp = { x: 0, z: 0, yaw: 0 };
const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
const fwd = new THREE.Vector3();
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 400);
let camReady = false;
let camYaw = 0;
let promptCar = false;

const keys = new Set();
const PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
window.addEventListener('keydown', (e) => {
  if (PREVENT[e.code]) e.preventDefault();
  if (!keys.has(e.code)) {
    if (e.code === 'KeyE') mode === 'interior' ? useJobOrLift() : toggleCar();
    if (e.code === 'KeyF') mode === 'interior' ? exitBuilding() : enterBuilding();
    if (e.code === 'KeyM') toggleMap();
    if (e.code === 'KeyI') toggleInv();
    if (e.code === 'KeyB') { if (shopOpen) closeShop(); else if (promptShop) openShop(); }
    if (e.code === 'KeyH' && mode === 'foot') rentHome();
    if (e.code === 'KeyR') doRob();
    if (e.code === 'Escape' && shopOpen) closeShop();
  }
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function readInput() {
  input.throttle = keys.has('ArrowUp') || keys.has('KeyW');
  input.brake = keys.has('ArrowDown') || keys.has('KeyS');
  input.steer = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
}
function placeCamera(x, z, yaw, dist, height, cg, ox, oz) {
  if (!camReady) camYaw = yaw;
  else { let d = yaw - camYaw; if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; camYaw += d * 0.07; }
  fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  // pull the camera in if a wall is between it and the player (no clipping)
  const pwx = x + ox;
  const pwz = z + oz;
  let clear = dist;
  for (let d = 1.2; d <= dist; d += 0.8) {
    if (pointBlocked(cg, pwx - fwd.x * d, pwz - fwd.z * d, 0.6)) { clear = Math.max(1.8, d - 1.0); break; }
  }
  const tx = x - fwd.x * clear; const tz = z - fwd.z * clear;
  if (!camReady) { camPos.set(tx, height, tz); camReady = true; }
  else { camPos.x += (tx - camPos.x) * 0.25; camPos.z += (tz - camPos.z) * 0.25; camPos.y += (height - camPos.y) * 0.2; }
  camera.position.copy(camPos);
  camAim.set(x + fwd.x * 6, 1.3, z + fwd.z * 6);
  camera.lookAt(camAim);
}

function frame(now) {
  if (!last) last = now;
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= DT) {
    readInput();
    coolHeat(DT);
    if (mode === 'interior') {
      if (working) {
        // clocked in — held at the station, working the shift
        if (input.throttle || input.brake || input.steer) working = null; // moving clocks you out
        else stepWork(DT);
      }
      if (robbing) {
        if (input.throttle || input.brake || input.steer) robbing = null; // bottled it
        else stepRob(DT);
      }
      const frozen = working || robbing || shopOpen; // held while working / robbing / shopping
      stepPed(ped, frozen ? NO_INPUT : input, DT);
      resolveCollision(ped, interiorGrid, 0.4);
    } else {
      const viewYaw = mode === 'drive' ? car.yaw : ped.yaw;
      ambient.update(activeX(), activeZ(), viewYaw, DT);
      if (mode === 'drive') {
        stepCar(car, input, DT);
        resolveCollision(car, grid, 0.95, 1.4);
        resolveCollision(car, grid, 0.95, -1.4);
        resolveAgents(car, ambient.cars, 1.4, 0.6); // shunt other traffic
        resolveAgents(car, ambient.peds, 1.4, 1.0); // bowl over pedestrians
      } else {
        stepPed(ped, input, DT);
        resolveCollision(ped, grid, 0.5);
        resolveAgents(ped, ambient.peds, 0.4, 0.5); // shove people aside
        resolveAgents(ped, ambient.cars, 0.4, 0);   // can't push a car on foot
      }
      // the law responds once you're properly wanted
      if (wanted >= 2 && !cop.active) spawnCop();
      stepCop(DT);
    }
    acc -= DT;
  }
  const alpha = acc / DT;

  // ── interior: a separate cell at the origin, no world/agents ───────────────
  if (mode === 'interior') {
    interpPed(ped, alpha, rp);
    pedMesh.visible = true;
    pedMesh.position.set(rp.x, 0, rp.z);
    pedMesh.rotation.y = rp.yaw;
    placeCamera(rp.x, rp.z, rp.yaw, 5.0, 2.8, interiorGrid, 0, 0);
    const ex = interiorGroup.userData.exit;
    // the exit door only exists on the ground floor
    promptDoor = interior && interior.cur === 0 && ex && Math.hypot(ped.x - ex.x, ped.z - ex.z) < 2.4 ? 'leave' : null;
    const lift = interior && interior.elevator;
    promptLift = !!(lift && interior.floors > 1 && Math.hypot(ped.x - lift.x, ped.z - lift.z) < 2.2);
    const jb = interior && interior.job;
    promptWork = jb && Math.hypot(ped.x - jb.x, ped.z - jb.z) < 2.2 ? jb : null;
    const sh = interior && interior.shop;
    promptShop = sh && Math.hypot(ped.x - sh.x, ped.z - sh.z) < 2.6 ? sh : null;
    if (shopOpen && !promptShop) closeShop(); // walked away from the counter
    const rb = interior && interior.robbery;
    promptRob = rb && Math.hypot(ped.x - rb.x, ped.z - rb.z) < 2.6 ? rb : null;
    post.render(scene, camera);
    updateHud();
    requestAnimationFrame(frame);
    return;
  }

  const ax = activeX(); const az = activeZ();
  if ((ax - renderOrigin.x) ** 2 + (az - renderOrigin.z) ** 2 > 500 * 500) {
    // rebase the floating origin — and slide the smoothed camera by the SAME
    // delta so it stays continuous. Without this the camera target jumps ~500 m
    // in render space and the lerp smears it across a few frames (the glitch).
    const dox = ax - renderOrigin.x; const doz = az - renderOrigin.z;
    renderOrigin.x = ax; renderOrigin.z = az;
    worldGroup.position.set(-renderOrigin.x, 0, -renderOrigin.z);
    camPos.x -= dox; camPos.z -= doz;
  }
  if ((streamTick++ % 10) === 0) {
    updateStreaming(ax, az);
    const e = nearestLoaded(ax, az);
    if (e) ambient.setCity(e.s.x, e.s.z, CITY_R[e.s.tier], nearIn(e.s, ax, az), e.streets);
    else ambient.setCity(0, 0, 0, false, null);
  }
  if ((ax - sceneryX) ** 2 + (az - sceneryZ) ** 2 > 150 * 150) rebuildScenery(ax, az);

  carMesh.position.set(car.x, 0, car.z);
  carMesh.rotation.y = car.yaw;
  let rx; let rz;
  if (mode === 'drive') {
    interpCar(car, alpha, rc);
    carMesh.position.set(rc.x, 0, rc.z); carMesh.rotation.y = rc.yaw;
    pedMesh.visible = false;
    rx = rc.x - renderOrigin.x; rz = rc.z - renderOrigin.z;
    placeCamera(rx, rz, rc.yaw, 8.5, 3.6, grid, renderOrigin.x, renderOrigin.z);
    promptDoor = null;
  } else {
    interpPed(ped, alpha, rp);
    pedMesh.visible = true;
    pedMesh.position.set(rp.x, 0, rp.z); pedMesh.rotation.y = rp.yaw;
    rx = rp.x - renderOrigin.x; rz = rp.z - renderOrigin.z;
    placeCamera(rx, rz, rp.yaw, 5.5, 3.1, grid, renderOrigin.x, renderOrigin.z);
    const dOwn = Math.hypot(car.x - ped.x, car.z - ped.z);
    promptCar = dOwn < 4.4 || !!nearestParked(grid, ped.x, ped.z, 4.4);
    promptDoor = nearestDoor(doorGrid, ped.x, ped.z, 2.4);
  }
  groundPlane.position.set(rx, -0.12, rz);
  if (cop.active) { policeMesh.position.set(cop.x, 0, cop.z); policeMesh.rotation.y = cop.yaw; }
  renderAmbient();

  post.render(scene, camera);
  updateHud();
  requestAnimationFrame(frame);
}

// helper: is (x,z) within the city radius + a margin
function nearIn(c, x, z) {
  const dx = x - c.x; const dz = z - c.z; const r = CITY_R[c.tier] + 40;
  return dx * dx + dz * dz < r * r;
}

function renderAmbient() {
  for (let i = 0; i < PED_N; i++) {
    const p = ambient.peds[i];
    if (p.live) {
      tmpQ.setFromAxisAngle(UP, p.yaw);
      tmpP.set(p.rx, 0.12 + Math.abs(Math.sin(p.bob)) * 0.05, p.rz);
      tmpM.compose(tmpP, tmpQ, tmpS);
    } else {
      tmpM.compose(tmpP.set(0, -9999, 0), tmpQ.identity(), zeroS);
    }
    pedInst.setMatrixAt(i, tmpM);
  }
  pedInst.instanceMatrix.needsUpdate = true;

  const counts = [0, 0, 0, 0];
  for (let i = 0; i < CAR_N; i++) {
    const c = ambient.cars[i];
    if (!c.live) continue;
    const im = trafficInst[c.type];
    const k = counts[c.type]++;
    tmpQ.setFromAxisAngle(UP, c.yaw);
    tmpP.set(c.rx, 0, c.rz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    im.setMatrixAt(k, tmpM);
    im.setColorAt(k, carColors[c.color]);
  }
  for (let t = 0; t < trafficInst.length; t++) {
    const im = trafficInst[t];
    for (let k = counts[t]; k < CAR_N; k++) {
      tmpM.compose(tmpP.set(0, -9999, 0), tmpQ.identity(), zeroS);
      im.setMatrixAt(k, tmpM);
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
  }
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function updateHud() {
  if (toastT > 0) { toastT -= 0.016; if (toastT <= 0) $('toast').style.opacity = '0'; }
  const inside = mode === 'interior';
  const wx = inside && returnDoor ? returnDoor.x : activeX();
  const wz = inside && returnDoor ? returnDoor.z : activeZ();
  $('s-pos').textContent = `${(wx / 1609.34).toFixed(1)}, ${(wz / 1609.34).toFixed(1)} mi`;
  const driving = mode === 'drive';
  const spd = driving ? Math.abs(car.speed * 2.23694).toFixed(0) : '0'; // m/s → mph
  $('s-speed').textContent = spd; $('s-speed2').textContent = spd;
  $('speedo').style.opacity = driving ? '1' : '0'; // only shown behind the wheel
  $('s-loaded').textContent = loaded.size;
  let live = 0;
  for (const p of ambient.peds) if (p.live) live++;
  $('s-people').textContent = inside ? 0 : live;
  $('s-mode').textContent = mode === 'drive' ? 'driving' : inside ? 'indoors' : 'on foot';
  if (inside && interior) {
    const lbl = interiorGroup.userData.label || 'Room';
    $('s-near2').textContent = interior.floors > 1 ? `${lbl} · floor ${interior.cur + 1}/${interior.floors}` : lbl;
  }

  let ph = '';
  if (inside) {
    if (working) {
      const pct = Math.floor((working.t / working.job.shift) * 10);
      const bar = '▓'.repeat(pct) + '░'.repeat(10 - pct);
      ph = `${working.job.role} · ${bar} · <kbd>E</kbd> clock out`;
    } else if (robbing) {
      const pct = Math.floor((robbing.t / robbing.dur) * 10);
      const bar = '▓'.repeat(pct) + '░'.repeat(10 - pct);
      ph = `robbing the ${robbing.kind}… ${bar} · <kbd>R</kbd> abort`;
    } else {
      const parts = [];
      if (promptWork) parts.push(`<kbd>E</kbd> ask for work · ${promptWork.role} $${promptWork.pay}/shift`);
      else if (promptLift) parts.push(`<kbd>E</kbd> elevator → floor ${(interior.cur + 1) % interior.floors + 1}`);
      if (promptShop && !shopOpen) parts.push('<kbd>B</kbd> shop');
      if (promptRob) parts.push(`<kbd>R</kbd> rob the ${promptRob.kind}`);
      if (promptDoor) parts.push('<kbd>F</kbd> leave');
      ph = parts.join(' &nbsp; ');
    }
  }
  else if (mode === 'foot') {
    if (promptDoor) {
      const d = promptDoor;
      const name = BUILDING_LABEL[d.btype] || d.btype;
      if (!isResidential(d)) ph = `<kbd>F</kbd> enter ${name}`;
      else if (isMyHome(d)) ph = '<kbd>F</kbd> enter home';
      else if (!player.home) ph = `🔒 <kbd>H</kbd> rent this home · $${RENT_COST}`;
      else ph = '🔒 locked';
    } else if (promptCar) ph = '<kbd>E</kbd> get in';
  }
  const pr = $('prompt');
  if (ph) pr.innerHTML = ph;
  pr.style.opacity = ph ? '1' : '0';

  const n = nearestLabelled(index, wx, wz);
  if (n) {
    const here = n.dist < 30;
    $('s-near').textContent = here ? `${n.s.name} (here)` : `${n.s.name} · ${(n.dist / 1609.34).toFixed(1)} mi`;
    if (!inside) $('s-near2').textContent = here ? `${n.s.name}` : `${n.s.name} · ${(n.dist / 1609.34).toFixed(1)} mi`;
    const bearing = Math.atan2(n.s.x - wx, n.s.z - wz);
    $('compass').style.transform = `rotate(${bearing - (mode === 'drive' ? car.yaw : ped.yaw)}rad)`;
    $('compass').style.opacity = here || inside ? '0.25' : '1';
  }
  drawMap(wx, wz);
}

// ── Minimap + fast travel ────────────────────────────────────────────────────
const mapCanvas = $('map');
const mctx = mapCanvas.getContext('2d');
let mapOpen = false;
// two views: 'world' (all cities + interstates, click to fast-travel) and
// 'city' (the street grid of the city you're in). M cycles world → city → closed.
let mapMode = 'world';
function applyMap() {
  mapCanvas.classList.toggle('open', mapOpen);
  const hint = $('maphint');
  if (hint) hint.textContent = !mapOpen ? 'M · open map'
    : mapMode === 'world' ? 'M · city roads · click a city to travel'
      : 'M · close';
  drawMap();
}
function cycleMap() {
  if (!mapOpen) { mapOpen = true; mapMode = 'world'; }
  else if (mapMode === 'world') mapMode = 'city';
  else mapOpen = false;
  applyMap();
}
function toggleMap() { cycleMap(); }
mapCanvas.addEventListener('click', (e) => {
  if (mapMode !== 'world') return; // fast-travel only from the world map
  const r = mapCanvas.getBoundingClientRect();
  const wx = (((e.clientX - r.left) / r.width) * 2 - 1) * HALF_WORLD_M;
  const wz = (((e.clientY - r.top) / r.height) * 2 - 1) * HALF_WORLD_M;
  let best = null; let bd = Infinity;
  for (const s of index.settlements) {
    if (s.tier === 'hamlet') continue;
    const dx = s.x - wx; const dz = s.z - wz; const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = s; }
  }
  if (best) { spawnAt(best); mapOpen = false; applyMap(); }
});
function drawMap(wx = activeX(), wz = activeZ()) {
  if (mapOpen && mapMode === 'city') return drawCityMap(wx, wz);
  return drawWorldMap(wx, wz);
}
function drawWorldMap(wx, wz) {
  const W = mapCanvas.width;
  const s = W / WORLD_M;
  const toX = (x) => (x + HALF_WORLD_M) * s;
  const toZ = (z) => (z + HALF_WORLD_M) * s;
  mctx.fillStyle = '#0a0d0f';
  mctx.fillRect(0, 0, W, W);
  mctx.strokeStyle = 'rgba(208,112,60,0.4)';
  mctx.strokeRect(0.5, 0.5, W - 1, W - 1);
  // interstates — the MST connecting the labelled settlements (blue)
  mctx.strokeStyle = '#4d8fd6';
  mctx.lineWidth = 1.4;
  mctx.beginPath();
  for (const e of roads) { mctx.moveTo(toX(e.ax), toZ(e.az)); mctx.lineTo(toX(e.bx), toZ(e.bz)); }
  mctx.stroke();
  for (const st of index.settlements) {
    if (st.tier === 'hamlet') continue;
    const sz = st.tier === 'metro' ? 3 : st.tier === 'city' ? 2 : 1.2;
    mctx.fillStyle = CULT[st.culture] || '#8593a0';
    mctx.fillRect(toX(st.x) - sz / 2, toZ(st.z) - sz / 2, sz, sz);
  }
  drawPlayerMark(toX(wx), toZ(wz));
}
function drawCityMap(wx, wz) {
  const W = mapCanvas.width;
  mctx.fillStyle = '#0a0d0f';
  mctx.fillRect(0, 0, W, W);
  mctx.strokeStyle = 'rgba(208,112,60,0.4)';
  mctx.strokeRect(0.5, 0.5, W - 1, W - 1);
  const e = nearestLoaded(wx, wz);
  if (!e || !e.streets) {
    mctx.fillStyle = '#8a8078';
    mctx.font = '12px monospace'; mctx.textAlign = 'center';
    mctx.fillText('out in open country — no city here', W / 2, W / 2);
    mctx.textAlign = 'left';
    return;
  }
  const { occ, n, pitch } = e.streets;
  const span = (n + 1) * pitch * 2;
  const s = W / span;
  const toX = (x) => W / 2 + (x - e.s.x) * s;
  const toZ = (z) => W / 2 + (z - e.s.z) * s;
  const gridN = 2 * n + 1;
  const pres = (i, j) => (i < -n || i > n || j < -n || j > n ? 0 : occ[(i + n) * gridN + (j + n)]);
  // faint lot fills so the streets read as gaps between blocks
  mctx.fillStyle = 'rgba(90,100,110,0.22)';
  const bs = pitch * s * 0.82;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    if (!pres(i, j)) continue;
    mctx.fillRect(toX(e.s.x + i * pitch) - bs / 2, toZ(e.s.z + j * pitch) - bs / 2, bs, bs);
  }
  // the streets themselves: a line down each corridor between two blocks
  mctx.strokeStyle = '#d8b074';
  mctx.lineWidth = Math.max(1.4, pitch * s * 0.12);
  mctx.lineCap = 'round';
  mctx.beginPath();
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    if (!pres(i, j)) continue;
    if (pres(i + 1, j)) { // vertical street on the east boundary
      const rx = toX(e.s.x + (i + 0.5) * pitch);
      mctx.moveTo(rx, toZ(e.s.z + (j - 0.5) * pitch)); mctx.lineTo(rx, toZ(e.s.z + (j + 0.5) * pitch));
    }
    if (pres(i, j + 1)) { // horizontal street on the north boundary
      const rz = toZ(e.s.z + (j + 0.5) * pitch);
      mctx.moveTo(toX(e.s.x + (i - 0.5) * pitch), rz); mctx.lineTo(toX(e.s.x + (i + 0.5) * pitch), rz);
    }
  }
  mctx.stroke();
  // interstate exits — blue, branching from a road junction out toward each
  // connected city.
  const cr = CITY_R[e.s.tier] || 300;
  mctx.strokeStyle = '#5a9ee0';
  mctx.lineWidth = Math.max(2.2, pitch * s * 0.2);
  mctx.lineCap = 'round';
  mctx.beginPath();
  for (const rd of roads) {
    let ox; let oz;
    if (Math.hypot(rd.ax - e.s.x, rd.az - e.s.z) < 1) { ox = rd.bx; oz = rd.bz; }
    else if (Math.hypot(rd.bx - e.s.x, rd.bz - e.s.z) < 1) { ox = rd.ax; oz = rd.az; }
    else continue;
    const len = Math.hypot(ox - e.s.x, oz - e.s.z) || 1;
    const dx = (ox - e.s.x) / len; const dz = (oz - e.s.z) / len;
    const [jx, jz] = snapJunction(e.s.x + dx * cr * 0.85, e.s.z + dz * cr * 0.85, e.s.x, e.s.z);
    const px = toX(jx); const pz = toZ(jz);
    mctx.moveTo(px, pz); mctx.lineTo(px + dx * W, pz + dz * W);
  }
  mctx.stroke();
  mctx.lineCap = 'butt';
  drawPlayerMark(toX(wx), toZ(wz));
}
function drawPlayerMark(px, pz) {
  mctx.fillStyle = '#f0d9c2';
  mctx.beginPath(); mctx.arc(px, pz, 2.5, 0, Math.PI * 2); mctx.fill();
  const yaw = mode === 'drive' ? car.yaw : ped.yaw;
  mctx.strokeStyle = '#e89a5a'; mctx.lineWidth = 1.5;
  mctx.beginPath(); mctx.moveTo(px, pz); mctx.lineTo(px + Math.sin(yaw) * 9, pz + Math.cos(yaw) * 9); mctx.stroke();
}

// ── Controls / resize / boot ─────────────────────────────────────────────────
$('travel').addEventListener('click', toggleMap);
$('respawn').addEventListener('click', () => spawnAt(startMetro()));
function resize() {
  const r = $('view').parentElement.getBoundingClientRect();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  post.setSize(r.width, r.height);
}
window.addEventListener('resize', resize);

spawnAt(startMetro());
resize();
if (typeof window !== 'undefined') window.__dbg = {
  get car() { return car; }, get mode() { return mode; }, get input() { return input; }, ambient, roads,
  teleport(x, z, yaw) {
    car.x = x; car.z = z; car.yaw = yaw ?? 0; car.vx = 0; car.vz = 0; car.speed = 0;
    car.prevX = x; car.prevZ = z; car.prevYaw = car.yaw;
    renderOrigin.x = x; renderOrigin.z = z; worldGroup.position.set(-x, 0, -z);
    mode = 'drive';
    updateStreaming(x, z); rebuildScenery(x, z); camReady = false; acc = 0;
  },
  enterNearest() {
    if (mode === 'drive') { mode = 'foot'; ped.x = car.x - 2.6; ped.z = car.z; }
    const d = nearestDoor(doorGrid, ped.x, ped.z, 1e9);
    if (!d) return null;
    ped.x = d.x; ped.z = d.z; promptDoor = d; enterBuilding(true);
    return d.btype;
  },
  exitBuilding: () => exitBuilding(),
  enterNearestTall() {
    if (mode === 'drive') { mode = 'foot'; ped.x = car.x - 2.6; ped.z = car.z; }
    let best = null;
    for (const e of loaded.values()) for (const d of e.doors) {
      if (!best || (d.floors || 1) > (best.floors || 1)) best = d;
    }
    if (!best) return null;
    ped.x = best.x; ped.z = best.z; promptDoor = best; enterBuilding(true);
    return { btype: best.btype, floors: best.floors, w: best.w, d: best.d };
  },
  gotoLift() {
    if (mode !== 'interior' || !interior || !interior.elevator) return;
    ped.x = interior.elevator.x; ped.z = interior.elevator.z;
    ped.prevX = ped.x; ped.prevZ = ped.z; acc = 0;
  },
  get player() { return player; },
  gotoJob() {
    if (mode !== 'interior' || !interior || !interior.job) return null;
    ped.x = interior.job.x; ped.z = interior.job.z; ped.prevX = ped.x; ped.prevZ = ped.z; acc = 0;
    return interior.job;
  },
  get working() { return working; },
  get promptWork() { return promptWork; },
  work() { useJobOrLift(); },
  gotoShop() {
    if (mode !== 'interior' || !interior || !interior.shop) return null;
    ped.x = interior.shop.x; ped.z = interior.shop.z; ped.prevX = ped.x; ped.prevZ = ped.z; acc = 0;
    return interior.shop.stock;
  },
  buy(i) { buyFromShop(i); },
  get shopOpen() { return shopOpen; },
  get promptShop() { return promptShop; },
  openShop() { openShop(); },
  findHome() {
    if (mode === 'drive') { mode = 'foot'; ped.x = car.x - 2.6; ped.z = car.z; }
    for (const e of loaded.values()) for (const d of e.doors) {
      if (isResidential(d)) {
        ped.x = d.x; ped.z = d.z; ped.prevX = d.x; ped.prevZ = d.z; promptDoor = d; acc = 0;
        return { btype: d.btype, residential: true, canEnter: canEnter(d), hasHome: !!player.home };
      }
    }
    return null;
  },
  rent() { rentHome(); },
  get home() { return player.home; },
  get wanted() { return wanted; },
  get cop() { return cop; },
  rob() { doRob(); },
  gotoRob() {
    if (mode !== 'interior' || !interior || !interior.robbery) return null;
    ped.x = interior.robbery.x; ped.z = interior.robbery.z; ped.prevX = ped.x; ped.prevZ = ped.z; acc = 0;
    return interior.robbery;
  },
  get robbing() { return robbing; },
  gotoPed() {
    if (mode !== 'foot') return null;
    let best = null; let bd = Infinity;
    for (const p of ambient.peds) { if (!p.live) continue; const d = (p.rx - ped.x) ** 2 + (p.rz - ped.z) ** 2; if (d < bd) { bd = d; best = p; } }
    if (!best) return null;
    ped.x = best.rx + 1.0; ped.z = best.rz; ped.prevX = ped.x; ped.prevZ = ped.z; acc = 0;
    return { dist: Math.sqrt(bd) };
  },
  gainMoney: (n) => gainMoney(n),
  giveItem: (id, name, v, q) => giveItem(id, name, v, q),
  enterType(btype) {
    if (mode === 'drive') { mode = 'foot'; ped.x = car.x - 2.6; ped.z = car.z; }
    let best = null;
    for (const e of loaded.values()) for (const d of e.doors) {
      if (d.btype === btype && (!best || (d.floors || 1) > (best.floors || 1))) best = d;
    }
    if (!best) return null;
    ped.x = best.x; ped.z = best.z; promptDoor = best; enterBuilding(true);
    return { btype: best.btype, floors: best.floors };
  },
};
if (typeof window !== 'undefined') window.__interior = () =>
  interior ? { btype: interior.btype, w: interior.w, d: interior.d, floors: interior.floors, cur: interior.cur } : null;
requestAnimationFrame(frame);
