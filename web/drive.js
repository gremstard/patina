// Patina — driving (Phase 4). A car in one city, at 320×240-through-100m-of-fog.
//
// §12 is the load-bearing part: a FIXED timestep via an accumulator, the sim
// stepped on INPUT (throttle/steer/brake/handbrake) not positions, rendering
// interpolated on top. Zero allocation in the loop (hard rule 3) — temporaries
// are preallocated. The vehicle and collision are the pure src/sim modules.

import * as THREE from 'three';
import { generateCity } from '../src/worldgen/city.js';
import { buildCar } from '../src/render/car.js';
import { makeCityMaterial, PSXPass } from '../src/render/psx.js';
import { createCar, stepCar, interpCar, CAR } from '../src/sim/vehicle.js';
import { buildColliderGrid, resolveCollision } from '../src/sim/collision.js';
import { FOG_FAR } from '../src/core/constants.js';
import { CULTURES } from '../src/worldgen/names.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

// ── Renderer / scene ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const post = new PSXPass(renderer, { internalHeight: 240, levels: 20 }); // §3: 240 lines

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x6b5c50); // dusty horizon — the fog IS the budget (§3)
scene.background = FOG.clone();
scene.fog = new THREE.Fog(FOG.clone(), 14, FOG_FAR); // 100 m — the most important number

const sun = new THREE.DirectionalLight(0xffe1b0, 1.9);
sun.position.set(-0.5, 0.9, 0.4);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xacc0d6, 0x3a352c, 0.95));
scene.add(new THREE.AmbientLight(0xffffff, 0.24));

const cityMat = makeCityMaterial();
let cityMesh = null;
let grid = null;

// car mesh (one merged geometry)
const carGeoData = buildCar();
const carGeo = new THREE.BufferGeometry();
carGeo.setAttribute('position', new THREE.BufferAttribute(carGeoData.positions, 3));
carGeo.setAttribute('normal', new THREE.BufferAttribute(carGeoData.normals, 3));
carGeo.setAttribute('color', new THREE.BufferAttribute(carGeoData.colors, 3));
carGeo.setIndex(new THREE.BufferAttribute(carGeoData.indices, 1));
const carMesh = new THREE.Mesh(carGeo, makeCityMaterial());
scene.add(carMesh);

// ── Sim state ────────────────────────────────────────────────────────────────
const DT = 1 / 60; // §12 — FIXED. Not deltaTime.
let acc = 0;
let last = 0;
const car = createCar();
const input = { throttle: false, brake: false, steer: 0, handbrake: false };
const render = { x: 0, z: 0, yaw: 0, steer: 0 };
let current = { seed: 1997, tier: 'city', palette: 'redbrick' };

// preallocated temporaries (no per-frame allocation)
const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
const fwd = new THREE.Vector3();
const camera = new THREE.PerspectiveCamera(68, 1, 0.3, 400);
let camReady = false;

// ── Build / rebuild the city ─────────────────────────────────────────────────
function rebuild() {
  const t0 = performance.now();
  const city = generateCity(current.seed, current.tier, current.palette);
  const t1 = performance.now();

  if (cityMesh) {
    cityMesh.geometry.dispose();
    scene.remove(cityMesh);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(city.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(city.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(city.colors, 3));
  g.setIndex(new THREE.BufferAttribute(city.indices, 1));
  cityMesh = new THREE.Mesh(g, cityMat);
  scene.add(cityMesh);

  grid = buildColliderGrid(city.colliders);
  respawn(city);

  $('s-tier').textContent = current.tier;
  $('s-bldg').textContent = city.stats.buildings.toLocaleString();
  $('s-gen').textContent = `${(t1 - t0).toFixed(0)} ms`;
  camReady = false;
}

// Spawn on a street near the centre, nudged until clear of buildings.
function respawn(city) {
  const PITCH = 72.5;
  const candidates = [
    [PITCH * 0.5, 0], [-PITCH * 0.5, 0], [0, PITCH * 0.5], [PITCH * 0.5, PITCH * 0.5],
    [PITCH * 1.5, 0], [0, 0],
  ];
  let sx = PITCH * 0.5;
  let sz = 0;
  for (const [cx, cz] of candidates) {
    car.x = cx; car.z = cz; car.vx = 0; car.vz = 0;
    if (grid && resolveCollision(car, grid, 2.0) === 0) { sx = cx; sz = cz; break; }
  }
  car.x = sx; car.z = sz;
  car.vx = 0; car.vz = 0; car.yaw = 0; car.steer = 0; car.speed = 0;
  car.prevX = sx; car.prevZ = sz; car.prevYaw = 0; car.prevSteer = 0;
  acc = 0;
}

// ── Input ────────────────────────────────────────────────────────────────────
const keys = new Set();
const DOWN = { ArrowUp: 1, KeyW: 1, ArrowDown: 1, KeyS: 1, ArrowLeft: 1, KeyA: 1, ArrowRight: 1, KeyD: 1, Space: 1 };
window.addEventListener('keydown', (e) => {
  if (DOWN[e.code]) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR') rebuild();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  input.throttle = keys.has('ArrowUp') || keys.has('KeyW');
  input.brake = keys.has('ArrowDown') || keys.has('KeyS');
  input.handbrake = keys.has('Space');
  input.steer = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
}

// ── Controls ─────────────────────────────────────────────────────────────────
function setTier(t) {
  current.tier = t;
  for (const x of ['metro', 'city', 'town']) $(`t-${x}`).classList.toggle('on', x === t);
  rebuild();
}
['metro', 'city', 'town'].forEach((t) => $(`t-${t}`).addEventListener('click', () => setTier(t)));
$('seed').addEventListener('change', (e) => { current.seed = (Number(e.target.value) >>> 0) || 0; rebuild(); });
$('reroll').addEventListener('click', () => { const s = Math.floor(Math.random() * 0xffffffff) >>> 0; $('seed').value = String(s); current.seed = s; rebuild(); });
$('respawn').addEventListener('click', () => rebuild());
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

// Chase camera: behind and above the car, looking a little ahead. Smoothed at
// render rate; positions written into preallocated vectors (no allocation).
function placeCamera(alpha, snap) {
  fwd.set(Math.sin(render.yaw), 0, Math.cos(render.yaw));
  const dist = 8.5;
  const height = 3.6;
  const tx = render.x - fwd.x * dist;
  const tz = render.z - fwd.z * dist;
  if (snap || !camReady) {
    camPos.set(tx, height, tz);
    camReady = true;
  } else {
    camPos.x += (tx - camPos.x) * 0.18;
    camPos.z += (tz - camPos.z) * 0.18;
    camPos.y += (height - camPos.y) * 0.18;
  }
  camera.position.copy(camPos);
  camAim.set(render.x + fwd.x * 6, 1.2, render.z + fwd.z * 6);
  camera.lookAt(camAim);
}

let contacts = 0;
function frame(now) {
  if (!last) last = now;
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;

  // fixed-step sim (§12)
  while (acc >= DT) {
    readInput();
    stepCar(car, input, DT);
    contacts = resolveCollision(car, grid, 2.0);
    acc -= DT;
  }

  // interpolate + place (§12: render interpolates on top)
  const alpha = acc / DT;
  interpCar(car, alpha, render);
  carMesh.position.set(render.x, 0, render.z);
  carMesh.rotation.y = render.yaw;
  placeCamera(alpha);

  post.render(scene, camera);

  // HUD
  $('s-speed').textContent = Math.abs(car.speed * 3.6).toFixed(0);
  $('s-slip').textContent = car.slip > 3 ? 'SLIP' : '·';
  $('s-slip').className = 'v ' + (car.slip > 3 ? 'accent' : '');
  $('s-calls').textContent = renderer.info.render.calls;
  requestAnimationFrame(frame);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setTier('city');
resize();
requestAnimationFrame(frame);
