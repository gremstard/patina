// Patina — the world (Phase 5). Drive the full bounded 128 × 128 km world ON FOOT
// or behind the wheel. Cities stream in on approach and are DELETED behind the
// fog (§6, hard rule 6) — "chunks like Minecraft", keyed to settlements.
//
// Coordinates (§8): the sim runs in ABSOLUTE world metres — JS numbers are
// float64, so no jitter at 64 km out. Floating origin is a RENDER concern only: a
// world group offset by -renderOrigin keeps the GPU near 0.
//
// Your active car has a dedicated mesh so it survives its origin city unloading;
// entering a parked street car hides that instance (the ones you leave behind
// despawn, GTA-style).

import * as THREE from 'three';
import { generateWorldIndex } from '../src/worldgen/worldIndex.js';
import { generateCity } from '../src/worldgen/city.js';
import { buildCar } from '../src/render/car.js';
import { buildPed } from '../src/render/ped.js';
import { makeCityMaterial, makeGroundMaterial, PSXPass } from '../src/render/psx.js';
import { createCar, stepCar, interpCar } from '../src/sim/vehicle.js';
import { createPed, stepPed, interpPed } from '../src/sim/pedestrian.js';
import { buildColliderGrid, resolveCollision, nearestParked } from '../src/sim/collision.js';
import { settlementsToLoad, inStreamRange, nearestLabelled } from '../src/worldgen/streaming.js';
import { FOG_FAR, BLOCK, CORRIDOR, HALF_WORLD_M, WORLD_M } from '../src/core/constants.js';

const PITCH = BLOCK + CORRIDOR;
const $ = (id) => document.getElementById(id);
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
const sun = new THREE.DirectionalLight(0xffe1b0, 1.9);
sun.position.set(-0.5, 0.9, 0.4);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xacc0d6, 0x3a352c, 0.95));
scene.add(new THREE.AmbientLight(0xffffff, 0.26));

const mat = makeCityMaterial();
const groundMat = makeGroundMaterial();
const worldGroup = new THREE.Group();
scene.add(worldGroup);
const renderOrigin = { x: 0, z: 0 };

function bufGeo(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  return g;
}

// endless ground, centred on the player each frame
const groundPlane = new THREE.Mesh(makeFlatGround(1800), groundMat);
scene.add(groundPlane);
function makeFlatGround(size) {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = 0.165; col[i * 3 + 1] = 0.14; col[i * 3 + 2] = 0.11; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// player meshes (in worldGroup, positioned at absolute world coords)
const carGeoData = buildCar();
const carMesh = new THREE.Mesh(bufGeo(carGeoData), mat);
const pedMesh = new THREE.Mesh(bufGeo(buildPed()), mat);
worldGroup.add(carMesh);
worldGroup.add(pedMesh);

// ── Streaming ────────────────────────────────────────────────────────────────
const loaded = new Map(); // id -> { s, meshes:[], colliders:[] }
let grid = buildColliderGrid([]);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const zeroS = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function rebuildGrid() {
  const all = [];
  for (const e of loaded.values()) for (const c of e.colliders) all.push(c);
  grid = buildColliderGrid(all);
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

  let inst = null;
  if (city.parking.length) {
    inst = new THREE.InstancedMesh(bufGeo(carGeoData), mat, city.parking.length);
    for (let i = 0; i < city.parking.length; i++) {
      const pk = city.parking[i];
      tmpQ.setFromAxisAngle(UP, pk.yaw);
      tmpP.set(s.x + pk.x, 0, s.z + pk.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      inst.setMatrixAt(i, tmpM);
      const alongZ = Math.abs(Math.cos(pk.yaw)) > 0.5;
      // parked-car collider carries what enter() needs: which instance to hide
      colliders.push({
        x: s.x + pk.x, z: s.z + pk.z,
        hw: alongZ ? 0.95 : 2.1, hd: alongZ ? 2.1 : 0.95,
        id: i, yaw: pk.yaw, inst, pidx: i, taken: false,
      });
    }
    inst.instanceMatrix.needsUpdate = true;
    worldGroup.add(inst);
    meshes.push(inst);
  }
  loaded.set(s.id, { s, meshes, colliders });
  rebuildGrid();
}

function unloadCity(id) {
  const e = loaded.get(id);
  if (!e) return;
  for (const m of e.meshes) { worldGroup.remove(m); m.geometry.dispose(); }
  loaded.delete(id);
  rebuildGrid();
}

let streamTick = 0;
function updateStreaming(px, pz) {
  for (const [id, e] of loaded) if (!inStreamRange(e.s, px, pz, 1.35)) unloadCity(id);
  for (const s of settlementsToLoad(index, px, pz)) if (!loaded.has(s.id)) { loadCity(s); break; }
}

// ── Player state ─────────────────────────────────────────────────────────────
const car = createCar(); // world coords; the dedicated active car
const ped = createPed();
let mode = 'foot'; // 'foot' | 'drive'

function activeX() { return mode === 'drive' ? car.x : ped.x; }
function activeZ() { return mode === 'drive' ? car.z : ped.z; }

function spawnAt(s) {
  for (const id of [...loaded.keys()]) unloadCity(id);
  const cx = s.x + PITCH * 0.5;
  const cz = s.z;
  car.x = cx; car.z = cz; car.yaw = 0; car.vx = 0; car.vz = 0; car.steer = 0; car.speed = 0;
  car.prevX = cx; car.prevZ = cz; car.prevYaw = 0; car.prevSteer = 0;
  renderOrigin.x = cx; renderOrigin.z = cz;
  worldGroup.position.set(-cx, 0, -cz);
  updateStreaming(cx, cz);
  // nudge the parked car out of anything
  for (let k = 0; k < 6 && (resolveCollision(car, grid, 0.95, 1.4) + resolveCollision(car, grid, 0.95, -1.4)) > 0; k++) car.z += 6;
  car.vx = 0; car.vz = 0;
  // stand the player just beside their car, on foot
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
    if (Math.abs(car.speed) > 2.2) return; // slow to get out
    const rx = Math.cos(car.yaw);
    const rz = -Math.sin(car.yaw);
    ped.x = car.x + rx * 2.6; ped.z = car.z + rz * 2.6; ped.yaw = car.yaw;
    ped.vx = 0; ped.vz = 0; ped.speed = 0; ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
    mode = 'foot';
    camReady = false;
    return;
  }
  // on foot: enter your own car if closest, else the nearest street car
  const dOwn = Math.hypot(car.x - ped.x, car.z - ped.z);
  const street = nearestParked(grid, ped.x, ped.z, 4.4);
  const dStreet = street ? Math.hypot(street.x - ped.x, street.z - ped.z) : Infinity;
  if (dOwn > 4.4 && !street) return;
  if (street && dStreet < dOwn) {
    // take the street car — hide its instance, make it the active car
    street.taken = true;
    hideInstance(street.inst, street.pidx);
    car.x = street.x; car.z = street.z; car.yaw = street.yaw;
    car.vx = 0; car.vz = 0; car.steer = 0; car.speed = 0;
    car.prevX = car.x; car.prevZ = car.z; car.prevYaw = car.yaw; car.prevSteer = 0;
  } else {
    // resume your own parked car
    car.vx = 0; car.vz = 0; car.speed = 0; car.prevX = car.x; car.prevZ = car.z; car.prevYaw = car.yaw;
  }
  mode = 'drive';
  camReady = false;
}

// ── Sim loop ─────────────────────────────────────────────────────────────────
const DT = 1 / 60;
let acc = 0;
let last = 0;
const input = { throttle: false, brake: false, steer: 0, run: false };
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
    if (e.code === 'KeyE') toggleCar();
    if (e.code === 'KeyM') toggleMap();
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

function placeCamera(x, z, yaw, dist, height) {
  if (!camReady) camYaw = yaw;
  else { let d = yaw - camYaw; if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; camYaw += d * 0.07; }
  fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  const tx = x - fwd.x * dist;
  const tz = z - fwd.z * dist;
  if (!camReady) { camPos.set(tx, height, tz); camReady = true; }
  else { camPos.x += (tx - camPos.x) * 0.2; camPos.z += (tz - camPos.z) * 0.2; camPos.y += (height - camPos.y) * 0.2; }
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
    if (mode === 'drive') {
      stepCar(car, input, DT);
      resolveCollision(car, grid, 0.95, 1.4);
      resolveCollision(car, grid, 0.95, -1.4);
    } else {
      stepPed(ped, input, DT);
      resolveCollision(ped, grid, 0.5);
    }
    acc -= DT;
  }

  const ax = activeX();
  const az = activeZ();
  const dox = ax - renderOrigin.x;
  const doz = az - renderOrigin.z;
  if (dox * dox + doz * doz > 500 * 500) {
    renderOrigin.x = ax; renderOrigin.z = az;
    worldGroup.position.set(-renderOrigin.x, 0, -renderOrigin.z);
  }
  if ((streamTick++ % 10) === 0) updateStreaming(ax, az);

  const alpha = acc / DT;
  // the parked car sits at its world coords; the ped too
  carMesh.position.set(car.x, 0, car.z);
  carMesh.rotation.y = car.yaw;
  if (mode === 'drive') {
    interpCar(car, alpha, rc);
    carMesh.position.set(rc.x, 0, rc.z);
    carMesh.rotation.y = rc.yaw;
    pedMesh.visible = false;
    const rx = rc.x - renderOrigin.x;
    const rz = rc.z - renderOrigin.z;
    groundPlane.position.set(rx, -0.12, rz);
    placeCamera(rx, rz, rc.yaw, 8.5, 3.6);
  } else {
    interpPed(ped, alpha, rp);
    pedMesh.visible = true;
    pedMesh.position.set(rp.x, 0, rp.z);
    pedMesh.rotation.y = rp.yaw;
    const rx = rp.x - renderOrigin.x;
    const rz = rp.z - renderOrigin.z;
    groundPlane.position.set(rx, -0.12, rz);
    placeCamera(rx, rz, rp.yaw, 5.5, 3.1);
    // enter prompt: near your car or a street car
    const dOwn = Math.hypot(car.x - ped.x, car.z - ped.z);
    promptCar = dOwn < 4.4 || !!nearestParked(grid, ped.x, ped.z, 4.4);
  }

  post.render(scene, camera);
  updateHud();
  requestAnimationFrame(frame);
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function updateHud() {
  $('s-pos').textContent = `${(activeX() / 1000).toFixed(1)}, ${(activeZ() / 1000).toFixed(1)} km`;
  const spd = mode === 'drive' ? Math.abs(car.speed * 3.6).toFixed(0) : '0';
  $('s-speed').textContent = spd;
  $('s-speed2').textContent = spd;
  $('s-loaded').textContent = loaded.size;
  $('s-mode').textContent = mode === 'drive' ? 'driving' : 'on foot';
  $('prompt').style.opacity = mode === 'foot' && promptCar ? '1' : '0';
  const n = nearestLabelled(index, activeX(), activeZ());
  if (n) {
    const here = n.dist < 30;
    $('s-near').textContent = here ? `${n.s.name} (here)` : `${n.s.name} · ${(n.dist / 1000).toFixed(1)} km`;
    $('s-near2').textContent = here ? `${n.s.name}` : `${n.s.name} · ${(n.dist / 1000).toFixed(1)} km`;
    const bearing = Math.atan2(n.s.x - activeX(), n.s.z - activeZ());
    $('compass').style.transform = `rotate(${bearing - (mode === 'drive' ? car.yaw : ped.yaw)}rad)`;
    $('compass').style.opacity = here ? '0.25' : '1';
  }
  drawMap();
}

// ── Minimap + fast travel ────────────────────────────────────────────────────
const mapCanvas = $('map');
const mctx = mapCanvas.getContext('2d');
let mapOpen = false;
function toggleMap() { mapOpen = !mapOpen; mapCanvas.classList.toggle('open', mapOpen); }
mapCanvas.addEventListener('click', (e) => {
  const r = mapCanvas.getBoundingClientRect();
  const wx = (((e.clientX - r.left) / r.width) * 2 - 1) * HALF_WORLD_M;
  const wz = (((e.clientY - r.top) / r.height) * 2 - 1) * HALF_WORLD_M;
  let best = null; let bd = Infinity;
  for (const s of index.settlements) {
    if (s.tier === 'hamlet') continue;
    const dx = s.x - wx; const dz = s.z - wz; const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = s; }
  }
  if (best) { spawnAt(best); toggleMap(); }
});
function drawMap() {
  const W = mapCanvas.width;
  const s = W / WORLD_M;
  const toX = (x) => (x + HALF_WORLD_M) * s;
  const toZ = (z) => (z + HALF_WORLD_M) * s;
  mctx.fillStyle = '#0a0d0f';
  mctx.fillRect(0, 0, W, W);
  mctx.strokeStyle = 'rgba(208,112,60,0.4)';
  mctx.strokeRect(0.5, 0.5, W - 1, W - 1);
  for (const st of index.settlements) {
    if (st.tier === 'hamlet') continue;
    const sz = st.tier === 'metro' ? 3 : st.tier === 'city' ? 2 : 1.2;
    mctx.fillStyle = CULT[st.culture] || '#8593a0';
    mctx.fillRect(toX(st.x) - sz / 2, toZ(st.z) - sz / 2, sz, sz);
  }
  const px = toX(activeX()); const pz = toZ(activeZ());
  mctx.fillStyle = '#f0d9c2';
  mctx.beginPath();
  mctx.arc(px, pz, 2.5, 0, Math.PI * 2);
  mctx.fill();
  const yaw = mode === 'drive' ? car.yaw : ped.yaw;
  mctx.strokeStyle = '#e89a5a';
  mctx.beginPath();
  mctx.moveTo(px, pz);
  mctx.lineTo(px + Math.sin(yaw) * 8, pz + Math.cos(yaw) * 8);
  mctx.stroke();
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
requestAnimationFrame(frame);
