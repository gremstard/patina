// Patina — world-map explorer (Phase 2 visualization).
//
// Imports the real, tested worldgen modules so the page and the determinism
// test can never drift. The bundler (scripts/bundle-web.js) inlines these for
// the self-contained build; in the browser / on Pages they load natively.

import { generateWorldIndex, counts, digest } from '../src/worldgen/worldIndex.js';
import { habitability } from '../src/worldgen/field.js';
import { zoneAt, rules } from '../src/core/zoning.js';
import { CITY_R, HALF_WORLD_M, WORLD_M, REGION_COUNT, REGION_M } from '../src/core/constants.js';

// ── Presentation data (UI owns these; worldgen stays pure) ───────────────────
const CULT = {
  anglic: { color: '#c05a3e', name: 'Anglic', feel: 'rust belt · New England' },
  iberic: { color: '#d99a4e', name: 'Iberic', feel: 'southwest' },
  rustbelt: { color: '#8593a0', name: 'Rustbelt', feel: 'industrial' },
  conlang: { color: '#9fae86', name: 'Conlang', feel: 'old-country · no word list' },
};
const TIER_META = {
  metro: { key: 'metros', target: '~5', color: '#e89a5a' },
  city: { key: 'cities', target: '~35', color: '#d99a4e' },
  town: { key: 'towns', target: '~150', color: '#9fae86' },
  hamlet: { key: 'hamlets', target: '~1000', color: '#6b746f' },
};
const cultureColor = (k) => (CULT[k] ? CULT[k].color : '#8593a0');

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d', { alpha: false });
const tooltip = $('tooltip');

// ── State ────────────────────────────────────────────────────────────────────
const cam = { cx: 0, cz: 0, scale: 1 }; // cx/cz = world-metre centre, scale = px per metre
const show = { terrain: true, grid: false, labels: true };
let index = null;
let seed = 8829;
let hover = null;
let selected = null;
let fieldCanvas = null; // offscreen habitability raster (per seed)
let viewW = 0;
let viewH = 0;
let dpr = 1;

// ── Coordinate transforms ────────────────────────────────────────────────────
const worldToScreenX = (wx) => (wx - cam.cx) * cam.scale + viewW / 2;
const worldToScreenY = (wz) => (wz - cam.cz) * cam.scale + viewH / 2;
const screenToWorldX = (sx) => (sx - viewW / 2) / cam.scale + cam.cx;
const screenToWorldY = (sy) => (sy - viewH / 2) / cam.scale + cam.cz;

function fitWorld() {
  cam.cx = 0;
  cam.cz = 0;
  cam.scale = Math.min(viewW, viewH) / (WORLD_M * 1.06);
  draw();
}

// ── Sizing ───────────────────────────────────────────────────────────────────
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  viewW = r.width;
  viewH = r.height;
  // Slight internal downscale for the PSX pixel crunch (§3), upscaled by CSS.
  dpr = 0.82;
  canvas.width = Math.max(1, Math.round(viewW * dpr));
  canvas.height = Math.max(1, Math.round(viewH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  draw();
}

// ── Habitability raster (§6) — why cities cluster ────────────────────────────
function buildField() {
  const N = 168; // samples per axis across the world
  const off = document.createElement('canvas');
  off.width = N;
  off.height = N;
  const octx = off.getContext('2d');
  const img = octx.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = -HALF_WORLD_M + ((i + 0.5) / N) * WORLD_M;
      const wz = -HALF_WORLD_M + ((j + 0.5) / N) * WORLD_M;
      let h = habitability(seed, wx, wz); // roughly [-1, 1], usually 0..0.9
      h = Math.max(0, Math.min(1, h));
      // Dark teal wilderness -> warm olive habitable. Stays in the CRT palette.
      const t = h;
      const rr = Math.round(12 + t * t * 116);
      const gg = Math.round(18 + t * 92);
      const bb = Math.round(20 + t * 40);
      const o = (j * N + i) * 4;
      img.data[o] = rr;
      img.data[o + 1] = gg;
      img.data[o + 2] = bb;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  fieldCanvas = off;
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  if (!index) return;
  ctx.fillStyle = '#07090a';
  ctx.fillRect(0, 0, viewW, viewH);

  // world bounds on screen
  const x0 = worldToScreenX(-HALF_WORLD_M);
  const y0 = worldToScreenY(-HALF_WORLD_M);
  const wpx = WORLD_M * cam.scale;

  // terrain
  if (show.terrain && fieldCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(fieldCanvas, x0, y0, wpx, wpx);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#0a0f11';
    ctx.fillRect(x0, y0, wpx, wpx);
  }

  // world border
  ctx.strokeStyle = 'rgba(208,112,60,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, wpx, wpx);

  // region grid
  if (show.grid) {
    ctx.strokeStyle = 'rgba(200,208,203,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= REGION_COUNT; k++) {
      const wp = -HALF_WORLD_M + k * REGION_M;
      const sx = worldToScreenX(wp);
      const sy = worldToScreenY(wp);
      ctx.moveTo(sx, y0);
      ctx.lineTo(sx, y0 + wpx);
      ctx.moveTo(x0, sy);
      ctx.lineTo(x0 + wpx, sy);
    }
    ctx.stroke();
  }

  // settlements — draw small→large so metros land on top
  const order = ['hamlet', 'town', 'city', 'metro'];
  const sizeFor = (tier) => (tier === 'metro' ? 7 : tier === 'city' ? 4.5 : tier === 'town' ? 3 : 1.6);
  for (const tier of order) {
    for (const s of index.settlements) {
      if (s.tier !== tier) continue;
      const sx = worldToScreenX(s.x);
      const sy = worldToScreenY(s.z);
      if (sx < -20 || sy < -20 || sx > viewW + 20 || sy > viewH + 20) continue;
      const sz = sizeFor(tier);
      ctx.fillStyle = cultureColor(s.culture);
      if (tier === 'metro') {
        ctx.shadowColor = cultureColor(s.culture);
        ctx.shadowBlur = 10;
      }
      ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      ctx.shadowBlur = 0;
    }
  }

  // selection: zoning rings (§7) + crosshair
  if (selected) drawSelection(selected);

  // labels
  if (show.labels) drawLabels();

  updateTooltip();
  updateScaleBadge();
}

function drawSelection(s) {
  const sx = worldToScreenX(s.x);
  const sy = worldToScreenY(s.z);

  if (s.tier !== 'hamlet' && CITY_R[s.tier]) {
    // §7 rings: core / ring / edge as fractions of CITY_R
    const R = CITY_R[s.tier];
    const bands = [
      { z: 'edge', r: R, col: cultureColor(s.culture), a: 0.10 },
      { z: 'ring', r: R * ringFrac(s.tier, 'ring'), col: cultureColor(s.culture), a: 0.16 },
      { z: 'core', r: R * ringFrac(s.tier, 'core'), col: '#e89a5a', a: 0.26 },
    ];
    for (const b of bands) {
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, b.r * cam.scale), 0, Math.PI * 2);
      ctx.fillStyle = hexA(b.col, b.a);
      ctx.fill();
      ctx.strokeStyle = hexA(b.col, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // crosshair
  ctx.strokeStyle = '#e89a5a';
  ctx.lineWidth = 1;
  const c = 9;
  ctx.beginPath();
  ctx.moveTo(sx - c, sy); ctx.lineTo(sx - 3, sy);
  ctx.moveTo(sx + 3, sy); ctx.lineTo(sx + c, sy);
  ctx.moveTo(sx, sy - c); ctx.lineTo(sx, sy - 3);
  ctx.moveTo(sx, sy + 3); ctx.lineTo(sx, sy + c);
  ctx.stroke();
}

// Find the fractional radius where a zone begins, by probing zoneAt (keeps the
// UI honest — it reads the same thresholds the generator uses).
function ringFrac(tier, zone) {
  const R = CITY_R[tier];
  let lastCore = 0;
  let lastRing = 0;
  for (let f = 0; f <= 1.0001; f += 0.005) {
    const z = zoneAt(tier, f * R);
    if (z === 'core') lastCore = f;
    if (z === 'core' || z === 'ring') lastRing = f;
  }
  return zone === 'core' ? lastCore + 0.005 : lastRing + 0.005;
}

function drawLabels() {
  ctx.font = '11px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  const seen = [];
  const px = cam.scale; // px per metre
  for (const s of index.settlements) {
    if (s.tier === 'hamlet') continue;
    // show metros always; cities when reasonably zoomed; towns only when close
    const minPx = s.tier === 'metro' ? 0 : s.tier === 'city' ? 0.0016 : 0.006;
    if (px < minPx) continue;
    const sx = worldToScreenX(s.x);
    const sy = worldToScreenY(s.z);
    if (sx < 0 || sy < 0 || sx > viewW || sy > viewH) continue;
    // cheap declutter: skip if too close to an already-placed label
    let clash = false;
    for (const p of seen) {
      if (Math.abs(p.x - sx) < 54 && Math.abs(p.y - sy) < 12) { clash = true; break; }
    }
    if (clash && s.tier !== 'metro') continue;
    seen.push({ x: sx, y: sy });
    const off = s.tier === 'metro' ? 11 : 8;
    const label = s.name;
    ctx.fillStyle = 'rgba(6,9,10,0.72)';
    const w = ctx.measureText(label).width;
    ctx.fillRect(sx + off - 2, sy - 6, w + 4, 12);
    ctx.fillStyle = s.tier === 'metro' ? '#f0d9c2' : '#c8d0cb';
    ctx.fillText(label, sx + off, sy + 0.5);
  }
}

// ── HUD panels ───────────────────────────────────────────────────────────────
function renderCounts() {
  const c = counts(index);
  const map = { metros: c.metros, cities: c.cities, towns: c.towns, hamlets: c.hamlets };
  const el = $('counts');
  el.innerHTML = '';
  for (const tier of ['metro', 'city', 'town', 'hamlet']) {
    const m = TIER_META[tier];
    const tile = document.createElement('div');
    tile.className = `tile ${tier}`;
    tile.innerHTML = `<div class="n">${map[m.key]}</div><div class="k">${m.key} <span>/ ${m.target}</span></div>`;
    el.appendChild(tile);
  }
  $('digest').textContent = digest(index);
}

function renderLegend() {
  const el = $('legend');
  el.innerHTML = '';
  for (const k of Object.keys(CULT)) {
    const cu = CULT[k];
    const row = document.createElement('div');
    row.className = 'cult';
    row.innerHTML = `<span class="swatch" style="background:${cu.color}"></span><div><div class="nm">${cu.name}</div><div class="fl">${cu.feel}</div></div>`;
    el.appendChild(row);
  }
}

function renderInspector(s) {
  const el = $('inspector');
  if (!s) {
    el.innerHTML = `<div class="empty"><h2 style="margin-bottom:12px">Inspector</h2><p><kbd>Drag</kbd> to pan · <kbd>Wheel</kbd> to zoom · <kbd>Click</kbd> a settlement.</p></div>`;
    return;
  }
  const cu = CULT[s.culture] || { name: s.culture, feel: '' };
  const kmx = (s.x / 1000).toFixed(1);
  const kmz = (s.z / 1000).toFixed(1);
  let zoneHtml = '';
  if (s.tier !== 'hamlet') {
    const rings = [
      { z: 'core', col: '#e89a5a' },
      { z: 'ring', col: cultureColor(s.culture) },
      { z: 'edge', col: hexA(cultureColor(s.culture), 0.55) },
    ];
    zoneHtml =
      `<div class="zoning"><h3>§7 zoning · ${CITY_R[s.tier]} m radius</h3>` +
      rings
        .map((r) => {
          const ru = rules(s.tier, r.z);
          const fl = ru.floors[0] === ru.floors[1] ? `${ru.floors[0]}` : `${ru.floors[0]}–${ru.floors[1]}`;
          return `<div class="zone-row"><span class="zone-swatch" style="background:${r.col}"></span><span class="zn">${r.z}</span><span class="zd"><b>${fl} floor${ru.floors[1] > 1 ? 's' : ''}</b> · ${ru.lot} · ${ru.roof} · ${ru.streets}</span></div>`;
        })
        .join('') +
      `</div>`;
  }
  el.innerHTML =
    `<div><h1 class="sel-name">${s.name || 'Unnamed hamlet'}</h1>` +
    `<div class="sel-tier">${s.tier}</div>` +
    `<dl class="kv">` +
    `<dt>culture</dt><dd>${cu.name}<span class="dot" style="background:${cultureColor(s.culture)}"></span></dd>` +
    `<dt>feel</dt><dd>${cu.feel || '—'}</dd>` +
    `<dt>region</dt><dd>${regionLabel(s)}</dd>` +
    `<dt>position</dt><dd>${kmx}, ${kmz} km</dd>` +
    `<dt>id</dt><dd>0x${(s.id >>> 0).toString(16).padStart(8, '0')}</dd>` +
    `</dl>${zoneHtml}</div>`;
}

function regionLabel(s) {
  const rx = Math.min(REGION_COUNT - 1, Math.max(0, Math.floor((s.x + HALF_WORLD_M) / REGION_M)));
  const rz = Math.min(REGION_COUNT - 1, Math.max(0, Math.floor((s.z + HALF_WORLD_M) / REGION_M)));
  return `${rx}, ${rz}`;
}

// ── Tooltip + scale ──────────────────────────────────────────────────────────
function updateTooltip() {
  if (!hover) { tooltip.style.opacity = '0'; return; }
  const sx = worldToScreenX(hover.x);
  const sy = worldToScreenY(hover.z);
  tooltip.style.left = `${sx}px`;
  tooltip.style.top = `${sy}px`;
  const cu = CULT[hover.culture] || { name: hover.culture };
  tooltip.innerHTML = `<span class="t-name">${hover.name || 'hamlet'}</span> <span class="t-meta">· ${hover.tier} · ${cu.name}</span>`;
  tooltip.style.opacity = '1';
}

function updateScaleBadge() {
  // pick a round km value ~120px wide
  const targetPx = 120;
  const metres = targetPx / cam.scale;
  const km = metres / 1000;
  const nice = [1, 2, 5, 10, 20, 50, 100].reduce((a, b) => (Math.abs(b - km) < Math.abs(a - km) ? b : a));
  $('scalebar').style.width = `${nice * 1000 * cam.scale}px`;
  $('scaletext').textContent = `${nice} km`;
}

// ── Hit testing ──────────────────────────────────────────────────────────────
function pick(sx, sy) {
  let best = null;
  let bestD = 14 * 14; // px radius
  for (const s of index.settlements) {
    const dx = worldToScreenX(s.x) - sx;
    const dy = worldToScreenY(s.z) - sy;
    const d = dx * dx + dy * dy;
    const bias = s.tier === 'metro' ? 40 : s.tier === 'city' ? 20 : s.tier === 'town' ? 8 : 0;
    if (d - bias < bestD) { bestD = d - bias; best = s; }
  }
  return best;
}

// ── Color helpers ────────────────────────────────────────────────────────────
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Regenerate ───────────────────────────────────────────────────────────────
function regen(newSeed) {
  seed = (Number(newSeed) >>> 0) || 0;
  const t0 = performance.now();
  index = generateWorldIndex(seed);
  const t1 = performance.now();
  buildField();
  renderCounts();
  selected = null;
  renderInspector(null);
  $('genstat').textContent = `gen ${(t1 - t0).toFixed(1)} ms · ${index.settlements.length} settlements`;
  draw();
}

// ── Events ───────────────────────────────────────────────────────────────────
let dragging = false;
let dragMoved = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragMoved = false;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  if (dragging) {
    const ddx = e.clientX - lastX;
    const ddy = e.clientY - lastY;
    if (Math.abs(ddx) + Math.abs(ddy) > 2) dragMoved = true;
    cam.cx -= ddx / cam.scale;
    cam.cz -= ddy / cam.scale;
    lastX = e.clientX;
    lastY = e.clientY;
    hover = null;
    draw();
  } else {
    const h = pick(sx, sy);
    if (h !== hover) { hover = h; draw(); }
  }
});
function endDrag(e) {
  if (dragging) canvas.classList.remove('dragging');
  dragging = false;
  if (e) try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
}
canvas.addEventListener('pointerup', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  endDrag(e);
  if (!dragMoved) {
    selected = pick(sx, sy);
    renderInspector(selected);
    draw();
  }
});
canvas.addEventListener('pointerleave', () => { hover = null; draw(); });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = screenToWorldX(sx);
  const wy = screenToWorldY(sy);
  const factor = Math.exp(-e.deltaY * 0.0014);
  const minScale = Math.min(viewW, viewH) / (WORLD_M * 1.4);
  const maxScale = 0.06;
  cam.scale = Math.max(minScale, Math.min(maxScale, cam.scale * factor));
  // zoom about cursor
  cam.cx = wx - (sx - viewW / 2) / cam.scale;
  cam.cz = wy - (sy - viewH / 2) / cam.scale;
  draw();
}, { passive: false });

// controls
const toggle = (id, key) => $(id).addEventListener('click', () => {
  show[key] = !show[key];
  $(id).classList.toggle('on', show[key]);
  draw();
});
toggle('t-terrain', 'terrain');
toggle('t-grid', 'grid');
toggle('t-labels', 'labels');
$('t-fit').addEventListener('click', fitWorld);

$('seed').addEventListener('change', (e) => regen(e.target.value));
$('reroll').addEventListener('click', () => {
  // choosing which seed to VIEW is UI, not worldgen — a plain random pick is fine
  const s = Math.floor(Math.random() * 0xffffffff) >>> 0;
  $('seed').value = String(s);
  regen(s);
});

window.addEventListener('resize', resize);

// ── Boot ─────────────────────────────────────────────────────────────────────
renderLegend();
regen(seed);
resize();
fitWorld();
