// Patina — the world (Phase 5). Drive the full bounded 128 × 128 km world. Cities
// stream in as you approach and are DELETED when they fall behind the fog (§6,
// hard rule 6) — "chunks like Minecraft", keyed to settlements.
//
// Coordinates (§8): the sim runs in ABSOLUTE world metres — JS numbers are
// float64, so there is no jitter in the simulation at 64 km out. Floating origin
// is a RENDER concern only: a world group is offset by -renderOrigin (which snaps
// to the player) so the GPU only ever sees small float32 coordinates near the
// car. This is why §8 had to exist before this phase.

import * as THREE from 'three';
import { generateWorldIndex } from '../src/worldgen/worldIndex.js';
import { generateCity } from '../src/worldgen/city.js';
import { buildCar } from '../src/render/car.js';
import { makeCityMaterial, makeGroundMaterial, PSXPass } from '../src/render/psx.js';
import { createCar, stepCar, interpCar } from '../src/sim/vehicle.js';
import { buildColliderGrid, resolveCollision } from '../src/sim/collision.js';
import { settlementsToLoad, inStreamRange, nearestLabelled } from '../src/worldgen/streaming.js';
import { FOG_FAR, BLOCK, CORRIDOR, HALF_WORLD_M, WORLD_M } from '../src/core/constants.js';

const PITCH = BLOCK + CORRIDOR; // 72.5 m
const $ = (id) => document.getElementById(id);
const canvas = $('view');
const WORLD_SEED = 8829;
const index = generateWorldIndex(WORLD_SEED);
const CULT = { anglic: '#c05a3e', iberic: '#d99a4e', rustbelt: '#8593a0', conlang: '#9fae86' };

// ── Renderer / scene ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
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

// the world group holds all streamed geometry at ABSOLUTE positions; its offset
// is the floating origin
const worldGroup = new THREE.Group();
scene.add(worldGroup);
const renderOrigin = { x: 0, z: 0 };

// endless ground plane, centred on the player each frame (render space)
const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
groundPlane.geometry = flatGround(1800);
scene.add(groundPlane);
function flatGround(size) {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = 0.165; col[i * 3 + 1] = 0.14; col[i * 3 + 2] = 0.11; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const carGeoData = buildCar();
const carMesh = new THREE.Mesh(bufGeo(carGeoData), mat);
scene.add(carMesh);
function bufGeo(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  return g;
}

// ── Streaming ────────────────────────────────────────────────────────────────
const loaded = new Map(); // id -> { s, meshes:[], colliders:[] }
let grid = buildColliderGrid([]);

function rebuildGrid() {
  const all = [];
  for (const e of loaded.values()) for (const c of e.colliders) all.push(c);
  grid = buildColliderGrid(all);
}

function loadCity(s) {
  const city = generateCity(s.id, s.tier, s.palette); // citySeed = settlement id (deterministic)
  const struct = new THREE.Mesh(bufGeo(city), mat);
  const gnd = new THREE.Mesh(bufGeo(city.ground), groundMat);
  struct.position.set(s.x, 0, s.z);
  gnd.position.set(s.x, 0, s.z);
  worldGroup.add(struct, gnd);
  const meshes = [struct, gnd];

  // parked cars for this city (instanced, offset to world position)
  if (city.parking.length) {
    const inst = new THREE.InstancedMesh(bufGeo(carGeoData), mat, city.parking.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < city.parking.length; i++) {
      const pk = city.parking[i];
      q.setFromAxisAngle(up, pk.yaw);
      p.set(s.x + pk.x, 0, s.z + pk.z);
      m.compose(p, q, sc);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    worldGroup.add(inst);
    meshes.push(inst);
  }

  // colliders in WORLD space (buildings + parked cars)
  const colliders = [];
  for (const c of city.colliders) colliders.push({ x: s.x + c.x, z: s.z + c.z, hw: c.hw, hd: c.hd });
  for (const pk of city.parking) {
    const alongZ = Math.abs(Math.cos(pk.yaw)) > 0.5;
    colliders.push({ x: s.x + pk.x, z: s.z + pk.z, hw: alongZ ? 0.95 : 2.1, hd: alongZ ? 2.1 : 0.95 });
  }
  loaded.set(s.id, { s, meshes, colliders });
  rebuildGrid();
}

function unloadCity(id) {
  const e = loaded.get(id);
  if (!e) return;
  for (const m of e.meshes) {
    worldGroup.remove(m);
    m.geometry.dispose();
  }
  loaded.delete(id);
  rebuildGrid();
}

let streamTick = 0;
function updateStreaming(px, pz) {
  // unload first (hysteresis 1.35×)
  for (const [id, e] of loaded) {
    if (!inStreamRange(e.s, px, pz, 1.35)) unloadCity(id);
  }
  // load at most one per pass to spread the generation cost
  for (const s of settlementsToLoad(index, px, pz)) {
    if (!loaded.has(s.id)) { loadCity(s); break; }
  }
}

// ── Spawn / fast travel ──────────────────────────────────────────────────────
const car = createCar();
function spawnAt(s) {
  // clear the world, move the player onto a street near the settlement centre
  for (const id of [...loaded.keys()]) unloadCity(id);
  car.x = s.x + PITCH * 0.5;
  car.z = s.z;
  car.yaw = 0; car.vx = 0; car.vz = 0; car.steer = 0; car.speed = 0;
  car.prevX = car.x; car.prevZ = car.z; car.prevYaw = 0; car.prevSteer = 0;
  renderOrigin.x = car.x; renderOrigin.z = car.z;
  worldGroup.position.set(-renderOrigin.x, 0, -renderOrigin.z);
  updateStreaming(car.x, car.z);
  // nudge out if we spawned inside something
  for (let k = 0; k < 6 && (resolveCollision(car, grid, 0.95, 1.4) + resolveCollision(car, grid, 0.95, -1.4)) > 0; k++) {
    car.z += 6;
  }
  car.vx = 0; car.vz = 0;
  acc = 0; camReady = false;
}

// pick the metro nearest world centre as the start
function startMetro() {
  let best = null; let bd = Infinity;
  for (const s of index.settlements) {
    if (s.tier !== 'metro') continue;
    const d = s.x * s.x + s.z * s.z;
    if (d < bd) { bd = d; best = s; }
  }
  return best || index.settlements[0];
}

// ── Sim loop ─────────────────────────────────────────────────────────────────
const DT = 1 / 60;
let acc = 0;
let last = 0;
const input = { throttle: false, brake: false, steer: 0 };
const rc = { x: 0, z: 0, yaw: 0, steer: 0 };
const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
const fwd = new THREE.Vector3();
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 400);
let camReady = false;
let camYaw = 0;

const keys = new Set();
const PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
window.addEventListener('keydown', (e) => { if (PREVENT[e.code]) e.preventDefault(); keys.add(e.code); if (e.code === 'KeyM') toggleMap(); });
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function readInput() {
  input.throttle = keys.has('ArrowUp') || keys.has('KeyW');
  input.brake = keys.has('ArrowDown') || keys.has('KeyS');
  input.steer = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
}

function placeCamera(x, z, yaw) {
  if (!camReady) camYaw = yaw;
  else { let d = yaw - camYaw; if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; camYaw += d * 0.07; }
  fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  const tx = x - fwd.x * 8.5;
  const tz = z - fwd.z * 8.5;
  if (!camReady) { camPos.set(tx, 3.6, tz); camReady = true; }
  else { camPos.x += (tx - camPos.x) * 0.2; camPos.z += (tz - camPos.z) * 0.2; camPos.y += (3.6 - camPos.y) * 0.2; }
  camera.position.copy(camPos);
  camAim.set(x + fwd.x * 6, 1.2, z + fwd.z * 6);
  camera.lookAt(camAim);
}

function frame(now) {
  if (!last) last = now;
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= DT) {
    readInput();
    stepCar(car, input, DT);
    resolveCollision(car, grid, 0.95, 1.4);
    resolveCollision(car, grid, 0.95, -1.4);
    acc -= DT;
  }

  // floating-origin rebase (§8)
  const ox = car.x - renderOrigin.x;
  const oz = car.z - renderOrigin.z;
  if (ox * ox + oz * oz > 500 * 500) {
    renderOrigin.x = car.x; renderOrigin.z = car.z;
    worldGroup.position.set(-renderOrigin.x, 0, -renderOrigin.z);
  }

  // stream every ~10 frames (cheap, but loads cost — spread them)
  if ((streamTick++ % 10) === 0) updateStreaming(car.x, car.z);

  const alpha = acc / DT;
  interpCar(car, alpha, rc);
  const rx = rc.x - renderOrigin.x;
  const rz = rc.z - renderOrigin.z;
  carMesh.position.set(rx, 0, rz);
  carMesh.rotation.y = rc.yaw;
  groundPlane.position.set(rx, -0.12, rz);
  placeCamera(rx, rz, rc.yaw);

  post.render(scene, camera);
  updateHud();
  requestAnimationFrame(frame);
}

// ── HUD ──────────────────────────────────────────────────────────────────────
const near = { s: null, dist: 0 };
function updateHud() {
  $('s-pos').textContent = `${(car.x / 1000).toFixed(1)}, ${(car.z / 1000).toFixed(1)} km`;
  const spd = Math.abs(car.speed * 3.6).toFixed(0);
  $('s-speed').textContent = spd;
  $('s-speed2').textContent = spd;
  $('s-loaded').textContent = loaded.size;
  const n = nearestLabelled(index, car.x, car.z);
  if (n) {
    near.s = n.s; near.dist = n.dist;
    const here = n.dist < 30;
    $('s-near').textContent = here ? `${n.s.name} (here)` : `${n.s.name} · ${(n.dist / 1000).toFixed(1)} km`;
    $('s-near2').textContent = here ? `${n.s.name} — you're here` : `${n.s.name} · ${(n.dist / 1000).toFixed(1)} km`;
    // compass arrow points to the nearest city, relative to heading
    const bearing = Math.atan2(n.s.x - car.x, n.s.z - car.z);
    $('compass').style.transform = `rotate(${bearing - car.yaw}rad)`;
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
  const mx = ((e.clientX - r.left) / r.width) * 2 - 1; // -1..1
  const mz = ((e.clientY - r.top) / r.height) * 2 - 1;
  const wx = mx * HALF_WORLD_M;
  const wz = mz * HALF_WORLD_M;
  // fast travel to the labelled settlement nearest the click
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
  const s = W / WORLD_M; // px per metre
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
  // player
  const px = toX(car.x); const pz = toZ(car.z);
  mctx.fillStyle = '#f0d9c2';
  mctx.beginPath();
  mctx.arc(px, pz, 2.5, 0, Math.PI * 2);
  mctx.fill();
  mctx.strokeStyle = '#e89a5a';
  mctx.beginPath();
  mctx.moveTo(px, pz);
  mctx.lineTo(px + Math.sin(car.yaw) * 8, pz + Math.cos(car.yaw) * 8);
  mctx.stroke();
}

// ── Controls / resize / boot ─────────────────────────────────────────────────
$('travel').addEventListener('click', toggleMap);
$('respawn').addEventListener('click', () => spawnAt(startMetro()));
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  post.setSize(r.width, r.height);
}
window.addEventListener('resize', resize);

spawnAt(startMetro());
resize();
requestAnimationFrame(frame);
