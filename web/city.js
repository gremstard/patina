// Patina — city viewer (Phase 3). Renders one procedurally generated city in
// PSX style: pan around it, change tier/seed/culture, watch the §7 density
// gradient stand up in 3D. The whole city is ONE merged BufferGeometry.

import * as THREE from 'three';
import { generateCity, cityDigest } from '../src/worldgen/city.js';
import { makeCityMaterial, makeGroundMaterial, PSXPass } from '../src/render/psx.js';
import { CITY_R } from '../src/core/constants.js';
import { CULTURES } from '../src/worldgen/names.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

// ── Renderer / scene ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); // PSX: no supersampling
const post = new PSXPass(renderer, { internalHeight: 260, levels: 22 });

const scene = new THREE.Scene();

// Gradient dusk sky (§3: PSX time-of-day was a fog/palette shift). A tiny canvas
// texture as a screen backdrop — darker zenith, warm rust horizon — so the city
// silhouettes instead of floating in black.
function makeSky() {
  const cv = document.createElement('canvas');
  cv.width = 8;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#3a3d4a'); // zenith
  grad.addColorStop(0.62, '#4d4740'); // mid
  grad.addColorStop(1.0, '#7a6350'); // horizon dusk
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeSky();
const HORIZON = new THREE.Color(0x7a6350);
// Phase 3 fog is atmospheric/distant so the gradient is visible; the 100 m
// gameplay fog is Phase 4. The toggle previews it. Fog fades into the horizon.
scene.fog = new THREE.Fog(HORIZON.clone(), 200, 2400);

const sun = new THREE.DirectionalLight(0xffe1b0, 2.1);
sun.position.set(-0.55, 0.9, 0.4);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd0e6, 0x3a352c, 1.0)); // sky / ground fill
scene.add(new THREE.AmbientLight(0xffffff, 0.22)); // lift the shadowed faces

const material = makeCityMaterial();
const groundMaterial = makeGroundMaterial();
let cityMesh = null;
let groundMesh = null;

// ── Orbit camera (small, no dependency) ──────────────────────────────────────
const camera = new THREE.PerspectiveCamera(56, 1, 0.5, 8000);
const orbit = { az: Math.PI * 0.25, pol: 1.14, rad: 600, target: new THREE.Vector3(0, 8, 0), auto: true };

function applyCamera() {
  const { az, pol, rad, target } = orbit;
  const sp = Math.sin(pol);
  camera.position.set(
    target.x + rad * sp * Math.cos(az),
    target.y + rad * Math.cos(pol),
    target.z + rad * sp * Math.sin(az),
  );
  camera.lookAt(target);
}

// ── Build / rebuild the city ─────────────────────────────────────────────────
let current = { seed: 1997, tier: 'city', palette: 'redbrick' };

function rebuild() {
  const t0 = performance.now();
  const city = generateCity(current.seed, current.tier, current.palette);
  const t1 = performance.now();

  if (cityMesh) {
    cityMesh.geometry.dispose();
    scene.remove(cityMesh);
    groundMesh.geometry.dispose();
    scene.remove(groundMesh);
  }
  const mkGeo = (d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    return g;
  };
  cityMesh = new THREE.Mesh(mkGeo(city), material);
  scene.add(cityMesh);
  groundMesh = new THREE.Mesh(mkGeo(city.ground), groundMaterial);
  scene.add(groundMesh);

  // frame the camera to the city — a lower, closer angle so the skyline reads
  orbit.rad = city.radius * 1.55;
  orbit.target.set(0, Math.max(5, city.maxHeight * 0.5), 0);
  fitFog(city);

  // HUD
  $('s-tris').textContent = city.stats.triangles.toLocaleString();
  $('s-bldg').textContent = city.stats.buildings.toLocaleString();
  $('s-blocks').textContent = city.stats.blocks.toLocaleString();
  $('s-gen').textContent = `${(t1 - t0).toFixed(1)} ms`;
  $('s-digest').textContent = cityDigest(city);
  $('s-zones').textContent = `${city.stats.zones.core} · ${city.stats.zones.ring} · ${city.stats.zones.edge}`;
  $('s-maxh').textContent = `${city.maxHeight.toFixed(0)} m`;
}

let gameplayFog = false;
function fitFog(city) {
  const r = city.radius;
  if (gameplayFog) {
    scene.fog.near = 5;
    scene.fog.far = 100; // §3 / Phase 4 preview — the real budget
  } else {
    scene.fog.near = r * 0.15;
    scene.fog.far = r * 2.4;
  }
}

// ── Interaction ──────────────────────────────────────────────────────────────
let dragging = false;
let lx = 0;
let ly = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; orbit.auto = false; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.az -= (e.clientX - lx) * 0.005;
  orbit.pol = Math.max(0.15, Math.min(1.45, orbit.pol - (e.clientY - ly) * 0.005));
  lx = e.clientX;
  ly = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.rad = Math.max(40, Math.min(4000, orbit.rad * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

// ── Controls ─────────────────────────────────────────────────────────────────
function setTier(tier) {
  current.tier = tier;
  for (const t of ['metro', 'city', 'town']) $(`t-${t}`).classList.toggle('on', t === tier);
  rebuild();
}
['metro', 'city', 'town'].forEach((t) => $(`t-${t}`).addEventListener('click', () => setTier(t)));

$('seed').addEventListener('change', (e) => { current.seed = (Number(e.target.value) >>> 0) || 0; rebuild(); });
$('reroll').addEventListener('click', () => {
  const s = Math.floor(Math.random() * 0xffffffff) >>> 0;
  $('seed').value = String(s);
  current.seed = s;
  rebuild();
});

// palette selector (bound to culture, §9)
const palSel = $('palette');
for (const c of CULTURES) {
  const o = document.createElement('option');
  o.value = c.palette;
  o.textContent = `${c.key} · ${c.palette}`;
  palSel.appendChild(o);
}
palSel.value = current.palette;
palSel.addEventListener('change', (e) => { current.palette = e.target.value; rebuild(); });

$('t-fog').addEventListener('click', () => {
  gameplayFog = !gameplayFog;
  $('t-fog').classList.toggle('on', gameplayFog);
  $('t-fog').textContent = gameplayFog ? '◉ Gameplay fog 100m' : '○ Gameplay fog 100m';
  const city = { radius: CITY_R[current.tier] };
  fitFog(city);
});
$('t-auto').addEventListener('click', () => {
  orbit.auto = !orbit.auto;
  $('t-auto').classList.toggle('on', orbit.auto);
});
$('t-wire').addEventListener('click', () => {
  material.wireframe = !material.wireframe;
  $('t-wire').classList.toggle('on', material.wireframe);
});

// ── Resize / loop ────────────────────────────────────────────────────────────
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  post.setSize(r.width, r.height);
}
window.addEventListener('resize', resize);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame() {
  if (orbit.auto && !reduceMotion) orbit.az += 0.0016;
  applyCamera();
  post.render(scene, camera);
  $('s-calls').textContent = renderer.info.render.calls;
  requestAnimationFrame(frame);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setTier('city');
resize();
frame();
