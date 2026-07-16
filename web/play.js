// Patina — on foot & behind the wheel (the vision: walk the streets, find a
// parked car, get in, drive it, get out). One city, 320×240 through 100 m of fog.
//
// Two modes share one fixed-timestep loop (§12): FOOT (tank-style walker) and
// DRIVE (on-rails arcade car). Both are the pure src/sim modules; collision is
// the shared grid. Parked cars are one InstancedMesh (1 draw call). Zero
// allocation in the loop (hard rule 3) — every temporary is preallocated.

import * as THREE from 'three';
import { generateCity } from '../src/worldgen/city.js';
import { buildCar } from '../src/render/car.js';
import { buildPed } from '../src/render/ped.js';
import { makeCityMaterial, makeGroundMaterial, PSXPass } from '../src/render/psx.js';
import { createCar, stepCar, interpCar } from '../src/sim/vehicle.js';
import { createPed, stepPed, interpPed } from '../src/sim/pedestrian.js';
import { buildColliderGrid, resolveCollision, nearestParked, addCollider } from '../src/sim/collision.js';
import { FOG_FAR } from '../src/core/constants.js';
import { CULTURES } from '../src/worldgen/names.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

// ── Renderer / scene ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const post = new PSXPass(renderer, { internalHeight: 240, levels: 20 });

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x6b5c50);
scene.background = FOG.clone();
scene.fog = new THREE.Fog(FOG.clone(), 12, FOG_FAR); // 100 m — the whole budget (§3)
const sun = new THREE.DirectionalLight(0xffe1b0, 1.9);
sun.position.set(-0.5, 0.9, 0.4);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xacc0d6, 0x3a352c, 0.95));
scene.add(new THREE.AmbientLight(0xffffff, 0.26));

const mat = makeCityMaterial(); // structures, car, ped, parked instances (snapped)
const groundMat = makeGroundMaterial(); // flat ground / roads (not snapped)

// static meshes rebuilt per city
let cityMesh = null;
let groundMesh = null;
let parkedInst = null;
let grid = null;
let parking = null;
let parkColliders = null;

// player meshes
const carMesh = new THREE.Mesh(bufGeo(buildCar()), mat);
const pedMesh = new THREE.Mesh(bufGeo(buildPed()), mat);
scene.add(carMesh);
scene.add(pedMesh);

function bufGeo(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return g;
}

// ── Sim state ────────────────────────────────────────────────────────────────
const DT = 1 / 60;
let acc = 0;
let last = 0;
let mode = 'foot'; // 'foot' | 'drive'
let drivingIndex = -1;
const car = createCar();
const ped = createPed();
const input = { throttle: false, brake: false, steer: 0, run: false };
const rc = { x: 0, z: 0, yaw: 0, steer: 0 };
const rp = { x: 0, z: 0, yaw: 0 };
let current = { seed: 1997, tier: 'city', palette: 'redbrick' };

// preallocated temporaries
const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
const fwd = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const zeroS = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 400);
let camReady = false;

const carGeoData = buildCar();

// ── Build / rebuild the city ─────────────────────────────────────────────────
function rebuild() {
  const t0 = performance.now();
  const city = generateCity(current.seed, current.tier, current.palette);
  const t1 = performance.now();

  if (cityMesh) { cityMesh.geometry.dispose(); scene.remove(cityMesh); }
  cityMesh = new THREE.Mesh(bufGeo(city), mat);
  scene.add(cityMesh);

  if (groundMesh) { groundMesh.geometry.dispose(); scene.remove(groundMesh); }
  groundMesh = new THREE.Mesh(bufGeo(city.ground), groundMat);
  scene.add(groundMesh);

  // parked cars: colliders + one instanced mesh
  parking = city.parking;
  parkColliders = parking.map((p, i) => {
    const alongZ = Math.abs(Math.cos(p.yaw)) > 0.5; // yaw 0/π → long axis on z
    return { x: p.x, z: p.z, hw: alongZ ? 0.95 : 2.1, hd: alongZ ? 2.1 : 0.95, id: i, taken: false };
  });
  grid = buildColliderGrid(city.colliders.concat(parkColliders));

  if (parkedInst) { parkedInst.geometry.dispose(); scene.remove(parkedInst); }
  parkedInst = new THREE.InstancedMesh(bufGeo(carGeoData), mat, Math.max(1, parking.length));
  for (let i = 0; i < parking.length; i++) setInstance(i, parking[i].x, parking[i].z, parking[i].yaw);
  parkedInst.instanceMatrix.needsUpdate = true;
  scene.add(parkedInst);

  spawnFoot();
  drivingIndex = -1;
  mode = 'foot';
  camReady = false;

  $('s-tier').textContent = current.tier;
  $('s-parked').textContent = parking.length.toLocaleString();
  $('s-gen').textContent = `${(t1 - t0).toFixed(0)} ms`;
}

function setInstance(i, x, z, yaw) {
  tmpQ.setFromAxisAngle(UP, yaw);
  tmpP.set(x, 0, z);
  tmpM.compose(tmpP, tmpQ, tmpS);
  parkedInst.setMatrixAt(i, tmpM);
}
function hideInstance(i) {
  tmpM.compose(tmpP.set(0, -9999, 0), tmpQ.identity(), zeroS);
  parkedInst.setMatrixAt(i, tmpM);
  parkedInst.instanceMatrix.needsUpdate = true;
}

// spawn the player on foot beside the parked car nearest the centre
function spawnFoot() {
  let best = null;
  let bd = Infinity;
  for (const p of parking) {
    const d = p.x * p.x + p.z * p.z;
    if (d < bd) { bd = d; best = p; }
  }
  if (best) {
    const toC = Math.hypot(best.x, best.z) || 1;
    ped.x = best.x - (best.x / toC) * 3.2;
    ped.z = best.z - (best.z / toC) * 3.2;
    ped.yaw = Math.atan2(best.x - ped.x, best.z - ped.z); // face the car
  } else {
    ped.x = 36; ped.z = 0; ped.yaw = 0;
  }
  ped.vx = 0; ped.vz = 0; ped.speed = 0;
  ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
  acc = 0;
}

// ── Enter / exit ─────────────────────────────────────────────────────────────
let promptCar = null;
function enterCar() {
  if (mode !== 'foot' || !promptCar) return;
  const i = promptCar.id;
  drivingIndex = i;
  parkColliders[i].taken = true; // don't collide with the car you're in
  hideInstance(i);
  car.x = parking[i].x; car.z = parking[i].z; car.yaw = parking[i].yaw;
  car.vx = 0; car.vz = 0; car.steer = 0; car.speed = 0;
  car.prevX = car.x; car.prevZ = car.z; car.prevYaw = car.yaw; car.prevSteer = 0;
  mode = 'drive';
  camReady = false;
  promptCar = null;
}
function exitCar() {
  if (mode !== 'drive' || Math.abs(car.speed) > 2.2) return; // slow down to get out
  const i = drivingIndex;
  // drop the ped beside the car (to its left)
  const rx = Math.cos(car.yaw);
  const rz = -Math.sin(car.yaw);
  ped.x = car.x + rx * 2.4; ped.z = car.z + rz * 2.4; ped.yaw = car.yaw;
  ped.vx = 0; ped.vz = 0; ped.speed = 0;
  ped.prevX = ped.x; ped.prevZ = ped.z; ped.prevYaw = ped.yaw;
  // the car stays where you parked it: reposition its collider + instance, re-enable
  const c = parkColliders[i];
  const alongZ = Math.abs(Math.cos(car.yaw)) > 0.5;
  c.x = car.x; c.z = car.z; c.hw = alongZ ? 0.95 : 2.1; c.hd = alongZ ? 2.1 : 0.95; c.taken = false;
  parking[i] = { x: car.x, z: car.z, yaw: car.yaw };
  addCollider(grid, c);
  setInstance(i, car.x, car.z, car.yaw);
  parkedInst.instanceMatrix.needsUpdate = true;
  drivingIndex = -1;
  mode = 'foot';
  camReady = false;
}

// ── Input ────────────────────────────────────────────────────────────────────
const keys = new Set();
const PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1 };
window.addEventListener('keydown', (e) => {
  if (PREVENT[e.code]) e.preventDefault();
  if (!keys.has(e.code)) {
    if (e.code === 'KeyE') mode === 'foot' ? enterCar() : exitCar();
    if (e.code === 'KeyR') rebuild();
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

// ── Controls (city) ──────────────────────────────────────────────────────────
function setTier(t) {
  current.tier = t;
  for (const x of ['metro', 'city', 'town']) $(`t-${x}`).classList.toggle('on', x === t);
  rebuild();
}
['metro', 'city', 'town'].forEach((t) => $(`t-${t}`).addEventListener('click', () => setTier(t)));
$('seed').addEventListener('change', (e) => { current.seed = (Number(e.target.value) >>> 0) || 0; rebuild(); });
$('reroll').addEventListener('click', () => { const s = Math.floor(Math.random() * 0xffffffff) >>> 0; $('seed').value = String(s); current.seed = s; rebuild(); });
const palSel = $('palette');
for (const c of CULTURES) { const o = document.createElement('option'); o.value = c.palette; o.textContent = `${c.key} · ${c.palette}`; palSel.appendChild(o); }
palSel.value = current.palette;
palSel.addEventListener('change', (e) => { current.palette = e.target.value; rebuild(); });

// ── Resize / loop ────────────────────────────────────────────────────────────
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  post.setSize(r.width, r.height);
}
window.addEventListener('resize', resize);

function placeCamera(x, z, yaw, dist, height, aimY) {
  fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  const tx = x - fwd.x * dist;
  const tz = z - fwd.z * dist;
  if (!camReady) { camPos.set(tx, height, tz); camReady = true; }
  else {
    camPos.x += (tx - camPos.x) * 0.2;
    camPos.z += (tz - camPos.z) * 0.2;
    camPos.y += (height - camPos.y) * 0.2;
  }
  camera.position.copy(camPos);
  camAim.set(x + fwd.x * 6, aimY, z + fwd.z * 6);
  camera.lookAt(camAim);
}

function frame(now) {
  if (!last) last = now;
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;

  while (acc >= DT) {
    readInput();
    if (mode === 'foot') {
      stepPed(ped, input, DT);
      resolveCollision(ped, grid, 0.5);
    } else {
      stepCar(car, input, DT);
      // two circles (front + rear) approximate the car's shape far better than
      // one oversized circle — no more stopping "in mid-air"
      resolveCollision(car, grid, 0.95, 1.4);
      resolveCollision(car, grid, 0.95, -1.4);
    }
    acc -= DT;
  }
  const alpha = acc / DT;

  if (mode === 'foot') {
    interpPed(ped, alpha, rp);
    pedMesh.visible = true;
    carMesh.visible = false;
    pedMesh.position.set(rp.x, 0, rp.z);
    pedMesh.rotation.y = rp.yaw;
    placeCamera(rp.x, rp.z, rp.yaw, 5.5, 3.1, 1.4);
    // enter prompt
    promptCar = nearestParked(grid, ped.x, ped.z, 4.2);
    $('prompt').style.opacity = promptCar ? '1' : '0';
    $('s-speed').textContent = '0';
  } else {
    interpCar(car, alpha, rc);
    pedMesh.visible = false;
    carMesh.visible = true;
    carMesh.position.set(rc.x, 0, rc.z);
    carMesh.rotation.y = rc.yaw;
    placeCamera(rc.x, rc.z, rc.yaw, 8.5, 3.6, 1.2);
    $('prompt').style.opacity = '0';
    $('s-speed').textContent = Math.abs(car.speed * 3.6).toFixed(0);
  }

  post.render(scene, camera);
  $('s-calls').textContent = renderer.info.render.calls;
  $('s-mode').textContent = mode === 'foot' ? 'on foot' : 'driving';
  requestAnimationFrame(frame);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setTier('city');
resize();
requestAnimationFrame(frame);
